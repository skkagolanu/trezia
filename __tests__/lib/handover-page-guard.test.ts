import { readFileSync } from 'fs';
import { join } from 'path';

const page = readFileSync(
  join(process.cwd(), 'src/app/(app)/handovers/page.tsx'),
  'utf8',
);

describe('treasurer handover page guard', () => {
  it('uses the financial-reader guard before rendering the operator page', () => {
    expect(page).toMatch(/await\s+requireFinancialReader\s*\(\)/);
    expect(page).not.toMatch(/await\s+requireAuth\s*\(\)/);
    expect(page).toContain("auth.unauthorized?.status === 401");
    expect(page).toContain("redirect('/access-denied')");
  });
});
