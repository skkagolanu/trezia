import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';

const ROUTE_BUDGETS_KIB = [
  { route: '/', gzipKib: 270 },
  { route: '/login', gzipKib: 270 },
  { route: '/request-access', gzipKib: 275 },
] as const;

async function initialJavaScriptGzipBytes(page: Page, route: string): Promise<{ bytes: number; scripts: number }> {
  await page.goto(route);
  const sources = await page.locator('script[src]').evaluateAll(elements => [
    ...new Set(elements.map(element => (element as HTMLScriptElement).src)),
  ]);
  const bodies = await Promise.all(sources.map(async source => {
    const response = await page.request.get(source, { headers: { 'accept-encoding': 'identity' } });
    expect(response.ok(), `could not read initial script ${source}`).toBe(true);
    return response.body();
  }));
  return {
    bytes: bodies.reduce((total, body) => total + gzipSync(body, { level: 9 }).length, 0),
    scripts: sources.length,
  };
}

test.describe('initial JavaScript budgets', () => {
  for (const budget of ROUTE_BUDGETS_KIB) {
    test(`${budget.route} stays within ${budget.gzipKib} KiB gzip`, async ({ page }) => {
      const measured = await initialJavaScriptGzipBytes(page, budget.route);
      expect(
        measured.bytes,
        `${budget.route} loaded ${measured.scripts} initial scripts totaling ${(measured.bytes / 1024).toFixed(1)} KiB gzip`,
      ).toBeLessThanOrEqual(budget.gzipKib * 1024);
    });
  }

  test('login does not eagerly load the Supabase SDK', async ({ page }) => {
    await page.goto('/login');
    const sources = await page.locator('script[src]').evaluateAll(elements => [
      ...new Set(elements.map(element => (element as HTMLScriptElement).src)),
    ]);
    const initialCode = (await Promise.all(sources.map(async source => {
      const response = await page.request.get(source, { headers: { 'accept-encoding': 'identity' } });
      return response.text();
    }))).join('\n');

    expect(initialCode).not.toContain('SupabaseClient');
  });
});
