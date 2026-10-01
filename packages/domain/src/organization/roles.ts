/**
 * Clinic roles and the permissions they grant.
 *
 * Authorization lives here in the domain and is enforced by the API — never by a
 * UI component. The UI may hide an affordance a user cannot use; that is a
 * convenience, not the control.
 */
export const CLINIC_ROLES = ['ADMINISTRATOR', 'DENTIST', 'ASSISTANT', 'RECEPTIONIST'] as const;

export type ClinicRole = (typeof CLINIC_ROLES)[number];

export const CLINIC_PERMISSIONS = [
  'clinic:read',
  'clinic:manage',
  'staff:read',
  'staff:manage',
  'patients:read',
  'patients:write',
  'appointments:read',
  'appointments:write',
  'visits:read',
  'visits:write',
  'odontogram:read',
  'odontogram:write',
  'treatments:read',
  'treatments:write',
  'billing:read',
  'billing:write',
  'inventory:read',
  'inventory:write',
  'reports:read',
] as const;

export type ClinicPermission = (typeof CLINIC_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Readonly<Record<ClinicRole, readonly ClinicPermission[]>> = {
  ADMINISTRATOR: CLINIC_PERMISSIONS,
  DENTIST: [
    'clinic:read',
    'staff:read',
    'patients:read',
    'patients:write',
    'appointments:read',
    'appointments:write',
    'visits:read',
    'visits:write',
    'odontogram:read',
    'odontogram:write',
    'treatments:read',
    'treatments:write',
    'billing:read',
    'inventory:read',
    'reports:read',
  ],
  ASSISTANT: [
    'clinic:read',
    'patients:read',
    'patients:write',
    'appointments:read',
    'appointments:write',
    'visits:read',
    'visits:write',
    'odontogram:read',
    'treatments:read',
    'treatments:write',
    'inventory:read',
    'inventory:write',
  ],
  RECEPTIONIST: [
    'clinic:read',
    'patients:read',
    'patients:write',
    'appointments:read',
    'appointments:write',
    'visits:read',
    'billing:read',
    'billing:write',
    'inventory:read',
  ],
};

export function permissionsForRole(role: ClinicRole): readonly ClinicPermission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: ClinicRole, permission: ClinicPermission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasEveryPermission(
  role: ClinicRole,
  permissions: readonly ClinicPermission[],
): boolean {
  return permissions.every((permission) => hasPermission(role, permission));
}
