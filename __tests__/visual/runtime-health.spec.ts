import { expect, test, type Page } from '@playwright/test';

const PUBLIC_ROUTES = ['/', '/login', '/request-access', '/privacy', '/offline'] as const;
const DEMO_ROUTES = [
  { name: 'payments', path: '/payments' },
  { name: 'bill generation', path: '/bills/generate' },
] as const;
const DEMO_LIFECYCLE_APIS = new Set(['/api/demo/start', '/api/demo/end']);
const SUPABASE_PATH_PREFIXES = [
  '/auth/v1/',
  '/functions/v1/',
  '/realtime/v1/',
  '/rest/v1/',
  '/storage/v1/',
] as const;

function formatLocation(page: Page, url = page.url()): string {
  return url || 'before navigation';
}

function isSupabaseRequest(url: URL): boolean {
  return url.hostname.endsWith('.supabase.co')
    || SUPABASE_PATH_PREFIXES.some(prefix => url.pathname.startsWith(prefix));
}

function observeRuntime(page: Page, route: string, enforceDemoIsolation = false) {
  const runtimeIssues: string[] = [];
  const forbiddenDemoRequests: string[] = [];

  page.on('console', message => {
    if (message.type() !== 'error') return;
    const location = message.location();
    const source = location.url
      ? `${location.url}:${location.lineNumber + 1}:${location.columnNumber + 1}`
      : formatLocation(page);
    runtimeIssues.push(`[${route}] console.error at ${source}: ${message.text()}`);
  });

  page.on('pageerror', error => {
    runtimeIssues.push(`[${route}] uncaught error at ${formatLocation(page)}: ${error.message}`);
  });

  page.on('requestfailed', request => {
    const reason = request.failure()?.errorText ?? 'unknown network failure';
    const url = new URL(request.url());
    // Next deliberately cancels speculative RSC prefetches when a navigation
    // supersedes them. Those same-origin aborts are browser scheduling, not a
    // failed application request; every other network failure remains fatal.
    if (reason === 'net::ERR_ABORTED' && url.origin === new URL(page.url()).origin && url.searchParams.has('_rsc')) {
      return;
    }
    runtimeIssues.push(`[${route}] request failed (${reason}): ${request.url()}`);
  });

  page.on('response', response => {
    if (response.status() < 500) return;
    runtimeIssues.push(`[${route}] HTTP ${response.status()} from ${response.url()}`);
  });

  if (enforceDemoIsolation) {
    page.on('request', request => {
      const url = new URL(request.url());
      const isOperationalApi = url.pathname.startsWith('/api/')
        && !DEMO_LIFECYCLE_APIS.has(url.pathname);
      if (isSupabaseRequest(url) || isOperationalApi) {
        forbiddenDemoRequests.push(`[${route}] ${request.method()} ${request.url()}`);
      }
    });
    page.on('websocket', socket => {
      const url = new URL(socket.url());
      if (isSupabaseRequest(url)) {
        forbiddenDemoRequests.push(`[${route}] WebSocket ${socket.url()}`);
      }
    });
  }

  return {
    assertHealthy() {
      expect(
        runtimeIssues,
        `${route} emitted browser errors, failed requests, or server failures:\n${runtimeIssues.join('\n')}`,
      ).toEqual([]);
      if (enforceDemoIsolation) {
        expect(
          forbiddenDemoRequests,
          `${route} contacted Supabase or an operational API:\n${forbiddenDemoRequests.join('\n')}`,
        ).toEqual([]);
      }
    },
  };
}

async function settleHydration(page: Page): Promise<void> {
  await expect(page.locator('body')).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

test.describe('public route runtime health', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} has no browser runtime failures`, async ({ page }) => {
      const runtime = observeRuntime(page, `public ${route}`);
      await page.goto(route);
      await settleHydration(page);
      runtime.assertHealthy();
    });
  }
});

test.describe('demo runtime health and isolation', () => {
  for (const demoRoute of DEMO_ROUTES) {
    test(`${demoRoute.name} stays healthy and fixture-only`, async ({ page }) => {
      const runtime = observeRuntime(page, `demo ${demoRoute.path}`, true);
      await page.goto('/api/demo/start');
      await settleHydration(page);

      const scopedRoot = new URL(page.url()).pathname.match(/^\/s\/[^/]+/)?.[0] ?? '';

      await page.goto(`${scopedRoot}${demoRoute.path}`);
      await settleHydration(page);
      runtime.assertHealthy();
    });
  }
});
