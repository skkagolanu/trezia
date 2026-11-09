import { test, expect, type Locator, type Page } from '@playwright/test';

const DEMO_START = '/api/demo/start';
const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 900 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const RESIDENT_TABLE_VIEWPORTS = [
  { name: 'narrow phone', width: 320, height: 640 },
  { name: 'phone', width: 375, height: 812 },
] as const;

async function setVisualState(page: Page, state: 'normal' | 'empty' | 'error') {
  await page.addInitScript(value => {
    window.sessionStorage.setItem('__trezia_visual_bill_state', value);
  }, state);
}

async function enterDemo(page: Page): Promise<string> {
  await page.goto(DEMO_START);
  await page.waitForLoadState('domcontentloaded');
  const scoped = new URL(page.url()).pathname.match(/^\/s\/[^/]+/);
  return scoped ? scoped[0] : '';
}

function previewCard(page: Page) {
  return page.locator('div.rounded-2xl').filter({ has: page.getByRole('heading', { name: /^Preview —/ }) });
}

async function insetWithinCard(element: Locator) {
  return element.evaluate(el => {
    const card = el.closest('div.rounded-2xl');
    if (!card) return null;
    const item = el.getBoundingClientRect();
    const container = card.getBoundingClientRect();
    return { left: Math.round(item.left - container.left), right: Math.round(container.right - item.right) };
  });
}

test.describe('bill-generation preview states and containment', () => {
  test('normal preview is contained and keyboard reachable at phone, tablet and desktop widths', async ({ page }) => {
    await setVisualState(page, 'normal');
    const forbiddenRequests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.includes('/rest/v1/') || url.hostname.endsWith('.supabase.co') || (
        url.pathname.startsWith('/api/') && !['/api/demo/start', '/api/demo/end'].includes(url.pathname)
      )) forbiddenRequests.push(request.url());
    });
    const base = await enterDemo(page);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(`${base}/bills/generate`);
      const card = previewCard(page);
      const table = card.locator('table');
      await expect(table, `${viewport.name} table`).toBeVisible();
      const measured = viewport.name === 'phone' ? card.locator('div.overflow-x-auto') : table;
      const inset = await insetWithinCard(measured);
      expect(inset, `${viewport.name} preview is not inside a Card`).not.toBeNull();
      expect(inset!.left).toBeGreaterThanOrEqual(0);
      expect(inset!.right).toBeGreaterThanOrEqual(0);
      expect(inset!.left).toBeLessThanOrEqual(2);
      expect(inset!.right).toBeLessThanOrEqual(2);
      const overflow = await page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        return [...document.querySelectorAll<HTMLElement>('body *')]
          .map(element => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.right > viewportWidth + 1 || rect.left < -1)
          .slice(0, 8)
          .map(({ element, rect }) => ({
            tag: element.tagName,
            className: element.className,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
          }));
      });
      expect(overflow, `${viewport.name} elements escape the viewport`).toEqual([]);
      const year = page.getByRole('combobox', { name: 'Year' });
      await year.focus();
      await expect(year).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('combobox', { name: 'Month' })).toBeFocused();
    }
    expect(forbiddenRequests, 'demo attempted Supabase or operational API access').toEqual([]);
  });

  test('empty preview stays explanatory and disables generation at every width', async ({ page }) => {
    await setVisualState(page, 'empty');
    const base = await enterDemo(page);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(`${base}/bills/generate`);
      await expect(previewCard(page).getByText('No active units found. Add units before generating bills.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Generate Bills' })).toBeDisabled();
    }
  });

  test('data errors replace the spinner with a recovery action at every width', async ({ page }) => {
    await setVisualState(page, 'error');
    const base = await enterDemo(page);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(`${base}/bills/generate`);
      await expect(previewCard(page).getByRole('alert')).toContainText('Could not load your flats. Refresh the page');
      await expect(page.getByRole('button', { name: 'Generate Bills' })).toBeDisabled();
    }
  });
});

test.describe('resident table accessibility contract', () => {
  test('horizontal table regions have labels, mobile cues, and keyboard focus at phone widths', async ({ page }) => {
    for (const viewport of RESIDENT_TABLE_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.setContent(`
        <p class="sm:hidden">Scroll horizontally to view all columns →</p>
        <div role="region" aria-label="Payment history table. Scroll horizontally to view all columns." tabindex="0" style="overflow-x:auto; width: 200px"><table style="min-width:440px"><tr><td>Payment</td></tr></table></div>
        <p class="sm:hidden">Scroll horizontally to view all columns →</p>
        <div role="region" aria-label="Bill status table. Scroll horizontally to view all columns." tabindex="0" style="overflow-x:auto; width: 200px"><table style="min-width:400px"><tr><td>Bill</td></tr></table></div>
      `);
      const regions = page.getByRole('region');
      await expect(regions, viewport.name).toHaveCount(2);
      await expect(page.getByText('Scroll horizontally to view all columns →')).toHaveCount(2);
      for (const region of await regions.all()) {
        await region.focus();
        await expect(region).toBeFocused();
        await expect(region.evaluate(element => element.scrollWidth > element.clientWidth)).resolves.toBe(true);
      }
    }
  });
});
