import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src/app/api/renewals/route.ts'), 'utf8');

it('queries overdue and upcoming dates for every renewal bucket', () => {
  expect(source).toContain(".lte('end_date', to)");
  expect(source).toContain(".lte('warranty_expires_on', to)");
  expect(source).toContain(".lte('next_service_date', to)");
  expect(source).not.toContain(".gte('end_date', from)");
  expect(source).not.toContain(".gte('warranty_expires_on', from)");
  expect(source).not.toContain(".gte('next_service_date', from)");
  expect(source).toContain('contract_end_dates');
  expect(source).toContain('asset_warranty_expiries');
  expect(source).toContain('asset_service_due_dates');
});
