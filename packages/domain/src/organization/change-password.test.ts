import { describe, expect, it } from 'vitest';

import type { ClinicId, UserId } from '@denti-code-u3/types';

import { changePassword, MIN_PASSWORD_LENGTH } from './change-password.js';
import type { AuthenticatedUser } from './auth.js';
import { DomainError } from '../shared/errors.js';
import type { PasswordHasher } from '../shared/security.js';
import type { UserRepository } from '../ports/index.js';

const CLINIC = '22222222-2222-4222-8222-222222222222' as ClinicId;
const USER = '22222222-2222-4222-8222-222222222223' as UserId;

const plainHasher: PasswordHasher = {
  async hash(password) {
    return `plain:${password}`;
  },
  async verify(password, storedHash) {
    return storedHash === `plain:${password}`;
  },
};

function activeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: USER,
    clinicId: CLINIC,
    email: 'admin@clinic.test',
    fullName: 'Ada Admin',
    role: 'ADMINISTRATOR',
    isActive: true,
    ...overrides,
  };
}

function fakeUsers(
  overrides: {
    passwordHash?: string;
    isActive?: boolean;
    missing?: boolean;
  } = {},
) {
  const updates: { clinicId: string; userId: string; passwordHash: string }[] = [];
  const user = activeUser({ isActive: overrides.isActive ?? true });
  const repository: UserRepository = {
    async findByEmailForLogin() {
      return undefined;
    },
    async findCredentialsById(clinicId, userId) {
      expect(clinicId).toBe(CLINIC);
      expect(userId).toBe(USER);
      if (overrides.missing) {
        return undefined;
      }
      return { user, passwordHash: overrides.passwordHash ?? 'plain:old-password' };
    },
    async findById() {
      return user;
    },
    async listByClinic() {
      return [user];
    },
    async recordLogin() {},
    async save() {},
    async updatePasswordHash(clinicId, userId, passwordHash) {
      updates.push({ clinicId, userId, passwordHash });
    },
  };
  return { repository, updates };
}

function deps(users: UserRepository) {
  return { users, passwordHasher: plainHasher };
}

describe('changePassword', () => {
  it('hashes and stores the new password when the current one matches', async () => {
    const users = fakeUsers();
    await changePassword(
      CLINIC,
      USER,
      { currentPassword: 'old-password', newPassword: 'new-password-length' },
      deps(users.repository),
    );
    expect(users.updates).toEqual([
      { clinicId: CLINIC, userId: USER, passwordHash: 'plain:new-password-length' },
    ]);
  });

  it('refuses a wrong current password without writing', async () => {
    const users = fakeUsers();
    await expect(
      changePassword(
        CLINIC,
        USER,
        { currentPassword: 'wrong', newPassword: 'new-password-length' },
        deps(users.repository),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(users.updates).toEqual([]);
  });

  it('refuses short, empty and unchanged new passwords', async () => {
    const users = fakeUsers();
    const short = 'too-short';
    expect(short.length).toBeLessThan(MIN_PASSWORD_LENGTH);

    for (const input of [
      { currentPassword: 'old-password', newPassword: short },
      { currentPassword: 'old-password', newPassword: '' },
      { currentPassword: 'old-password', newPassword: 'old-password' },
    ]) {
      await expect(
        changePassword(CLINIC, USER, input, deps(users.repository)),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(users.updates).toEqual([]);
  });

  it('treats missing, inactive and hashless users as bad credentials', async () => {
    for (const overrides of [{ missing: true }, { isActive: false }, { passwordHash: '' }]) {
      const users = fakeUsers(overrides);
      let error: unknown;
      try {
        await changePassword(
          CLINIC,
          USER,
          { currentPassword: 'old-password', newPassword: 'new-password-length' },
          deps(users.repository),
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('UNAUTHENTICATED');
      expect(users.updates).toEqual([]);
    }
  });
});
