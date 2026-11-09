import type { AppRole } from '@/types/database';
export type { AppRole } from '@/types/database';

export const APP_ROLES = ['admin', 'treasurer', 'resident', 'committee', 'auditor'] as const satisfies readonly AppRole[];

export type Capability =
  | 'manage_access'
  | 'manage_config'
  | 'manage_units'
  | 'manage_backups'
  | 'manage_financial_setup'
  | 'finance_read'
  | 'finance_write'
  | 'manage_residents'
  | 'export_audit'
  | 'operations_read'
  | 'operations_write'
  | 'published_documents_read'
  | 'use_agent';

export const CAPABILITIES = [
  'manage_access',
  'manage_config',
  'manage_units',
  'manage_backups',
  'manage_financial_setup',
  'finance_read',
  'finance_write',
  'manage_residents',
  'export_audit',
  'operations_read',
  'operations_write',
  'published_documents_read',
  'use_agent',
] as const satisfies readonly Capability[];

const ADMIN_CAPABILITIES: ReadonlySet<Capability> = new Set([
  'manage_access',
  'manage_config',
  'manage_units',
  'manage_backups',
  'manage_financial_setup',
  'finance_read',
  'finance_write',
  'manage_residents',
  'export_audit',
  'operations_read',
  'operations_write',
  'published_documents_read',
  'use_agent',
]);

const TREASURER_CAPABILITIES: ReadonlySet<Capability> = new Set([
  'manage_financial_setup',
  'finance_read',
  'finance_write',
  'manage_residents',
  'export_audit',
  'operations_read',
  'operations_write',
  'use_agent',
]);

const ROLE_CAPABILITIES: Record<AppRole, ReadonlySet<Capability>> = {
  admin: ADMIN_CAPABILITIES,
  treasurer: TREASURER_CAPABILITIES,
  resident: new Set(['published_documents_read']),
  committee: new Set(),
  auditor: new Set(),
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value);
}

export function hasCapability(role: unknown, capability: Capability): boolean {
  return isAppRole(role) && ROLE_CAPABILITIES[role].has(capability);
}

export function roleHome(role: AppRole | null | undefined): string {
  if (role === 'resident') return '/my-flat';
  if (hasCapability(role, 'finance_read')) return '/payments';
  return '/access-denied';
}
