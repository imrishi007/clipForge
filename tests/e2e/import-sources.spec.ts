import { expect, test } from 'playwright/test';

test('YouTube reference loads only on request and stays a reference after saving', async ({ page }, info) => {
  await page.route('**/api/health', (route) => route.fulfill({ status: 503, json: { detail: 'Offline test workspace' } }));
  await page.route('**/api/projects', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/campaigns', (route) => route.fulfill({ json: [] }));
  let embedRequests = 0;
  await page.route('https://www.youtube-nocookie.com/**', (route) => {
    embedRequests++;
    return route.fulfill({ contentType: 'text/html', body: '<p>Preview test response</p>' });
  });
  await page.goto('/projects/new');
  await page.getByLabel('Source type').selectOption('reference');
  await page.getByLabel('YouTube video URL').fill('https://youtu.be/YGaGz7t8Ov4');
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(embedRequests).toBe(0);
  const next = page.getByRole('button', { name: 'Continue' });
  const offset = () => next.evaluate((button) => button.getBoundingClientRect().top + window.scrollY);
  const beforePreview = await offset();
  await page.getByRole('button', { name: 'Load YouTube preview' }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/YGaGz7t8Ov4');
  expect(await offset()).toBeCloseTo(beforePreview, 0);
  await next.click();
  await expect(page.getByLabel('Project name')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'YouTube reference', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create manual clip' }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Import source' })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: `test-results/import-reference-${theme}.png`, animations: 'disabled' });
  }
  const metrics = await page.context().newCDPSession(page);
  await metrics.send('Performance.enable');
  await info.attach('browser-metrics', { body: JSON.stringify(await metrics.send('Performance.getMetrics')), contentType: 'application/json' });
});
