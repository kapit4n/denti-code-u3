import type { ClinicId, UserId } from '@denti-code-u3/types';

import type { UserRepository } from '../ports/index.js';
import { DomainError } from '../shared/errors.js';
import type { PasswordHasher } from '../shared/security.js';
import { assertUserActive } from './auth.js';

export const MIN_PASSWORD_LENGTH = 12;

export interface ChangePasswordInput {
  readonly currentPassword: string;
  readonly newPassword: string;
}

export interface ChangePasswordDependencies {
  readonly users: UserRepository;
  readonly passwordHasher: PasswordHasher;
}

const WRONG_CREDENTIALS = 'The email or password is incorrect';

export async function changePassword(
  clinicId: ClinicId,
  userId: UserId,
  input: ChangePasswordInput,
  dependencies: ChangePasswordDependencies,
): Promise<void> {
  if (typeof input.currentPassword !== 'string' || input.currentPassword.length === 0) {
    throw new DomainError('INVALID_INPUT', 'The current password is required');
  }
  if (typeof input.newPassword !== 'string' || input.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new DomainError(
      'INVALID_INPUT',
      `The new password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
    );
  }
  if (input.newPassword === input.currentPassword) {
    throw new DomainError('INVALID_INPUT', 'The new password must be different');
  }

  const credentials = await dependencies.users.findCredentialsById(clinicId, userId);
  if (!credentials || !credentials.passwordHash) {
    throw new DomainError('UNAUTHENTICATED', WRONG_CREDENTIALS);
  }
  assertUserActive(credentials.user);

  const currentMatches = await dependencies.passwordHasher.verify(
    input.currentPassword,
    credentials.passwordHash,
  );
  if (!currentMatches) {
    throw new DomainError('UNAUTHENTICATED', WRONG_CREDENTIALS);
  }

  const passwordHash = await dependencies.passwordHasher.hash(input.newPassword);
  await dependencies.users.updatePasswordHash(clinicId, userId, passwordHash);
}
