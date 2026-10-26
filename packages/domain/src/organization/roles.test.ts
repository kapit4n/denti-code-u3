/**
 * The role/permission matrix.
 *
 * Authorization is a domain rule, so it is pinned here rather than inferred from
 * the route configs. The assertions are chosen to catch the two mistakes that
 * matter: granting a role everything (so the matrix is really "always allow"),
 * and withholding a permission a role needs to do its job.
 */

import { describe, expect, it } from 'vitest';

import {
  CLINIC_PERMISSIONS,
  hasEveryPermission,
  hasPermission,
  permissionsForRole,
} from './roles.js';

describe('clinic roles', () => {
  it('gives the administrator every permission', () => {
    expect(permissionsForRole('ADMINISTRATOR')).toEqual(CLINIC_PERMISSIONS);
  });

  it('lets the receptionist take payments but not write clinical records', () => {
    expect(hasPermission('RECEPTIONIST', 'billing:write')).toBe(true);
    expect(hasPermission('RECEPTIONIST', 'appointments:write')).toBe(true);
    expect(hasPermission('RECEPTIONIST', 'treatments:write')).toBe(false);
    expect(hasPermission('RECEPTIONIST', 'odontogram:write')).toBe(false);
    expect(hasPermission('RECEPTIONIST', 'inventory:write')).toBe(false);
  });

  it('lets the dentist write clinical records but not manage the clinic or billing', () => {
    expect(hasPermission('DENTIST', 'odontogram:write')).toBe(true);
    expect(hasPermission('DENTIST', 'treatments:write')).toBe(true);
    expect(hasPermission('DENTIST', 'billing:read')).toBe(true);
    expect(hasPermission('DENTIST', 'billing:write')).toBe(false);
    expect(hasPermission('DENTIST', 'clinic:manage')).toBe(false);
    expect(hasPermission('DENTIST', 'staff:manage')).toBe(false);
  });

  it('lets the assistant assist but not bill or write the odontogram', () => {
    expect(hasPermission('ASSISTANT', 'visits:write')).toBe(true);
    expect(hasPermission('ASSISTANT', 'inventory:write')).toBe(true);
    expect(hasPermission('ASSISTANT', 'billing:read')).toBe(false);
    expect(hasPermission('ASSISTANT', 'odontogram:write')).toBe(false);
  });

  it('requires every named permission, not just one', () => {
    expect(hasEveryPermission('DENTIST', ['treatments:write', 'odontogram:write'])).toBe(true);
    expect(hasEveryPermission('DENTIST', ['treatments:write', 'billing:write'])).toBe(false);
  });
});
