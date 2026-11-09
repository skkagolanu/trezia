import {
  APP_ROLES,
  CAPABILITIES,
  hasCapability,
  isAppRole,
  roleHome,
  type AppRole,
  type Capability,
} from '@/lib/auth/roles';

const expected: Record<AppRole, readonly Capability[]> = {
  admin: CAPABILITIES,
  treasurer: ['manage_financial_setup', 'finance_read', 'finance_write', 'manage_residents', 'export_audit', 'operations_read', 'operations_write', 'use_agent'],
  resident: ['published_documents_read'],
  committee: [],
  auditor: [],
};

describe('role capabilities', () => {
  it.each(APP_ROLES)('%s receives exactly its declared capabilities', role => {
    for (const capability of CAPABILITIES) {
      expect(hasCapability(role, capability)).toBe(expected[role].includes(capability));
    }
  });

  it('denies missing and unrecognised roles by default', () => {
    for (const capability of CAPABILITIES) {
      expect(hasCapability(null, capability)).toBe(false);
      expect(hasCapability(undefined, capability)).toBe(false);
      expect(hasCapability('owner', capability)).toBe(false);
    }
  });

  it('accepts only exact application roles', () => {
    expect(APP_ROLES.every(isAppRole)).toBe(true);
    expect(isAppRole('owner')).toBe(false);
    expect(isAppRole('tenant')).toBe(false);
    expect(isAppRole('ADMIN')).toBe(false);
  });

  it('routes supported roles without granting unsupported roles an operator home', () => {
    expect(roleHome('admin')).toBe('/payments');
    expect(roleHome('treasurer')).toBe('/payments');
    expect(roleHome('resident')).toBe('/my-flat');
    expect(roleHome('committee')).toBe('/access-denied');
    expect(roleHome('auditor')).toBe('/access-denied');
    expect(roleHome(null)).toBe('/access-denied');
  });
});
