/** @jest-environment node */

import '@testing-library/jest-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import SetupChecklist from '@/components/onboarding/SetupChecklist';
import { computeSetupItems } from '@/components/onboarding/setup-items';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));

function makeChain(result: { data?: unknown; count?: number; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = jest.fn(self);
  chain.eq = jest.fn(self);
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }));
  chain.then = (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? [], count: result.count, error: result.error ?? null }).then(resolve, reject);
  return chain;
}

function mockSupabase(options: {
  config?: unknown;
  configError?: unknown;
  activeUnitCount?: number;
  unitsError?: unknown;
}) {
  const configChain = makeChain({ data: options.config ?? null, error: options.configError });
  const unitsChain = makeChain({ count: options.activeUnitCount ?? 0, error: options.unitsError });
  const from = jest.fn((table: string) => {
    if (table === 'society_config') return configChain;
    if (table === 'units') return unitsChain;
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { from, configChain, unitsChain };
}

const FULL_CONFIG = {
  monthly_maintenance_amount: 2500,
  maintenance_payment_window_days: 7,
  upi_id: 'society@upi',
  upi_qr_object_key: 'societies/s1/qr.png',
};

beforeEach(() => {
  jest.clearAllMocks();
  (cookies as jest.Mock).mockResolvedValue({ get: jest.fn(() => undefined) });
});

describe('computeSetupItems (pure logic)', () => {
  it('returns nothing once billing, units and UPI are all configured', () => {
    expect(computeSetupItems(FULL_CONFIG, 5, 'green-acres', true)).toEqual([]);
  });

  it('flags missing billing config and missing units as blocking, and links directly to the fixing page', () => {
    const items = computeSetupItems(null, 0, 'green-acres', true);
    const ids = items.map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining(['billing_config', 'active_units']));
    const billing = items.find(i => i.id === 'billing_config')!;
    expect(billing.severity).toBe('blocking');
    expect(billing.href).toBe('/s/green-acres/settings');
    const units = items.find(i => i.id === 'active_units')!;
    expect(units.severity).toBe('blocking');
    expect(units.href).toBe('/s/green-acres/residents');
  });

  it('flags a missing UPI id/QR as recommended, not blocking, when billing is otherwise configured', () => {
    const items = computeSetupItems(
      { ...FULL_CONFIG, upi_id: null, upi_qr_object_key: null },
      5,
      'green-acres',
      true,
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('upi_payment');
    expect(items[0].severity).toBe('recommended');
  });

  it('does not flag UPI when only the QR image (not the id) is set', () => {
    const items = computeSetupItems({ ...FULL_CONFIG, upi_qr_object_key: null }, 5, null, true);
    expect(items).toEqual([]);
  });

  it('falls back to unscoped paths when there is no society slug (single-society mode)', () => {
    const items = computeSetupItems(null, 0, null, true);
    expect(items.find(i => i.id === 'billing_config')!.href).toBe('/settings');
    expect(items.find(i => i.id === 'active_units')!.href).toBe('/residents');
  });

  it('tells a Treasurer to ask an Admin when flat master data is missing', () => {
    const item = computeSetupItems(FULL_CONFIG, 0, 'green-acres', false)
      .find(candidate => candidate.id === 'active_units')!;
    expect(item.href).toBeUndefined();
    expect(item.title).toContain('Admin');
    expect(item.actionLabel).toBe('Admin action required');
  });
});

describe('SetupChecklist (server component)', () => {
  it('renders nothing for a resident, without ever querying the database', async () => {
    const supabase = mockSupabase({ config: FULL_CONFIG, activeUnitCount: 5 });
    (createClient as jest.Mock).mockResolvedValue(supabase);

    const el = await SetupChecklist({ role: 'resident', societyId: 'soc-1', societySlug: 'green-acres', isDemo: false });
    expect(el).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('renders nothing for a fully configured society', async () => {
    const supabase = mockSupabase({ config: FULL_CONFIG, activeUnitCount: 5 });
    (createClient as jest.Mock).mockResolvedValue(supabase);

    const el = await SetupChecklist({ role: 'treasurer', societyId: 'soc-1', societySlug: 'green-acres', isDemo: false });
    expect(el).toBeNull();
  });

  it('shows a retry state when the society configuration query fails', async () => {
    const supabase = mockSupabase({ configError: { message: 'config unavailable' }, activeUnitCount: 5 });
    (createClient as jest.Mock).mockResolvedValue(supabase);

    const el = await SetupChecklist({ role: 'admin', societyId: 'soc-1', societySlug: 'green-acres', isDemo: false });
    const html = renderToStaticMarkup(el as React.ReactElement);
    expect(html).toContain('Setup status unavailable');
    expect(html).toContain('Refresh the page to try again.');
    expect(html).not.toContain('Set your maintenance amount and billing window');
  });

  it('shows a retry state when the units query fails', async () => {
    const supabase = mockSupabase({ config: FULL_CONFIG, unitsError: { message: 'units unavailable' } });
    (createClient as jest.Mock).mockResolvedValue(supabase);

    const el = await SetupChecklist({ role: 'treasurer', societyId: 'soc-1', societySlug: 'green-acres', isDemo: false });
    const html = renderToStaticMarkup(el as React.ReactElement);
    expect(html).toContain('Setup status unavailable');
    expect(html).not.toContain('Add at least one flat');
  });

  it('does not turn a partial query failure into an actionable setup item', async () => {
    const supabase = mockSupabase({ config: FULL_CONFIG, unitsError: { message: 'units unavailable' } });
    (createClient as jest.Mock).mockResolvedValue(supabase);

    const el = await SetupChecklist({ role: 'admin', societyId: 'soc-1', societySlug: 'green-acres', isDemo: false });
    const html = renderToStaticMarkup(el as React.ReactElement);
    expect(html).toContain('Refresh the page to try again.');
    expect(html).not.toContain('/s/green-acres/residents');
  });

  it('shows the checklist with correctly-linked items for an unconfigured society (admin)', async () => {
    const supabase = mockSupabase({ config: null, activeUnitCount: 0 });
    (createClient as jest.Mock).mockResolvedValue(supabase);

    const el = await SetupChecklist({ role: 'admin', societyId: 'soc-1', societySlug: 'green-acres', isDemo: false });
    expect(el).not.toBeNull();
    const html = renderToStaticMarkup(el as React.ReactElement);
    expect(html).toContain('Set your maintenance amount and billing window');
    expect(html).toContain('/s/green-acres/settings');
    expect(html).toContain('Add at least one flat');
    expect(html).toContain('/s/green-acres/residents');
  });

  it('shows the checklist for a treasurer too, not just an admin', async () => {
    const supabase = mockSupabase({ config: null, activeUnitCount: 3 });
    (createClient as jest.Mock).mockResolvedValue(supabase);

    const el = await SetupChecklist({ role: 'treasurer', societyId: 'soc-1', societySlug: null, isDemo: false });
    expect(el).not.toBeNull();
  });

  it('never shows for demo, regardless of role', async () => {
    const supabase = mockSupabase({ config: null, activeUnitCount: 0 });
    (createClient as jest.Mock).mockResolvedValue(supabase);

    const el = await SetupChecklist({ role: 'admin', societyId: 'demo-society', societySlug: null, isDemo: true });
    expect(el).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('stays silent once dismissed, even though the society is still unconfigured', async () => {
    const supabase = mockSupabase({ config: null, activeUnitCount: 0 });
    (createClient as jest.Mock).mockResolvedValue(supabase);
    (cookies as jest.Mock).mockResolvedValue({ get: jest.fn(() => ({ value: '1' })) });

    const el = await SetupChecklist({ role: 'admin', societyId: 'soc-1', societySlug: 'green-acres', isDemo: false });
    expect(el).toBeNull();
  });
});
