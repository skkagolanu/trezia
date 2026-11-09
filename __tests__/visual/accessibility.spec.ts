import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_A_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PUBLIC_ROUTES = ['/', '/login', '/request-access', '/privacy', '/offline'] as const;

async function expectAccessiblePage(page: Page, routeName: string) {
  await expect(page.locator('body'), `${routeName} rendered`).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(WCAG_A_AA_TAGS)
    .analyze();

  const violations = results.violations.map(violation => ({
    rule: violation.id,
    nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })),
  }));
  expect(violations, `${routeName} has WCAG A/AA violations`).toEqual([]);
  await expect(page.locator('img:not([alt])'), `${routeName} has images without alt attributes`).toHaveCount(0);
}

async function enterDemo(page: Page): Promise<string> {
  await page.goto('/api/demo/start');
  await page.waitForLoadState('domcontentloaded');
  const scopedPath = new URL(page.url()).pathname.match(/^\/s\/[^/]+/);
  return scopedPath?.[0] ?? '';
}

test.describe('rendered accessibility', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} has no automated WCAG A/AA violations`, async ({ page }) => {
      await page.goto(route);
      await expectAccessiblePage(page, route);
    });
  }

  test('representative demo finance pages are accessible and isolated', async ({ page }) => {
    const forbiddenRequests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      const isSupabaseRequest = url.hostname.endsWith('.supabase.co') || url.pathname.includes('/rest/v1/');
      const isOperationalApi = url.pathname.startsWith('/api/')
        && !['/api/demo/start', '/api/demo/end'].includes(url.pathname);

      if (isSupabaseRequest || isOperationalApi) forbiddenRequests.push(request.url());
    });

    const base = await enterDemo(page);
    const demoRoutes = [`${base}/payments`, `${base}/bills/generate`];

    for (const route of demoRoutes) {
      await page.goto(route);
      await expectAccessiblePage(page, route);
    }

    expect(forbiddenRequests, 'demo attempted Supabase or operational API access').toEqual([]);
  });
});
