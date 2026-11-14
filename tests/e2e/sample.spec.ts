import { expect, test } from 'playwright/test';

test('sample opens a playable editor in both themes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Try sample project' }).first().click();
  await expect(page).toHaveURL('/projects/sample-studio');
  await page.goto('/editor/sample-studio/sample-clip');
  const video = page.locator('video').last();
  await expect(video).toHaveJSProperty('duration', 12);
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).readyState), { timeout: 15_000 }).toBeGreaterThan(1);
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeCloseTo(2, 1);

  for (const theme of ['dark', 'light']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeCloseTo(2, 1);
    await page.screenshot({ path: `test-results/sample-editor-${theme}.png`, animations: 'disabled' });
  }
  expect(errors).toEqual([]);
});

test('clip zoom changes the program only, supports undo and survives reload', async ({ page }, info) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Try sample project' }).first().click();
  await expect(page).toHaveURL('/projects/sample-studio');
  await page.goto('/editor/sample-studio/sample-clip');
  await page.getByRole('button', { name: 'Effects inspector' }).click();
  const zoom = page.getByLabel('Zoom (%)');
  const video = page.locator('.program-screen video');
  await expect(zoom).toHaveValue('100');
  await zoom.focus();
  const started = performance.now();
  for (let n = 0; n < 5; n++) await zoom.press('ArrowRight');
  await expect(video).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)');
  const interactionMs = Math.round(performance.now() - started);
  await expect(page.locator('.source-screen video')).toHaveCSS('transform', 'none');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(zoom).toHaveValue('120');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(zoom).toHaveValue('125');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Effects inspector' }).click();
  await expect(zoom).toHaveValue('125');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: `test-results/zoom-${theme}-${viewport.width}.png`, animations: 'disabled' });
    }
  }
  const metrics = await page.context().newCDPSession(page);
  await metrics.send('Performance.enable');
  const heap = (await metrics.send('Performance.getMetrics')).metrics.find((metric) => metric.name === 'JSHeapUsedSize');
  console.log(`Zoom keyboard sequence ${interactionMs}ms, browser used heap ${heap?.value} bytes`);
  await info.attach('zoom-performance', { body: JSON.stringify({ interactionMs, heapBytes: heap?.value }), contentType: 'application/json' });
  await page.getByRole('button', { name: 'Reset zoom' }).click();
  await expect(zoom).toHaveValue('100');
});
