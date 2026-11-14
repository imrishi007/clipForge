import { expect, test } from 'playwright/test';

test('exports shows verified jobs and recovers cancelled jobs', async ({ page }) => {
  const job = {
    id: 'cut-export', projectId: 'project', clipId: 'clip', title: 'Opening cut',
    status: 'running', progress: 35, stage: 'Encoding H.264', createdAt: '2026-11-13T10:00:00Z',
    editRevision: 2, logs: [],
  };
  await page.route('**/api/exports', (route) => route.fulfill({ json: [job] }));
  await page.route('**/api/jobs/cut-export/cancel', (route) => {
    Object.assign(job, { status: 'cancelled', progress: null, stage: 'Cancelled' });
    return route.fulfill({ json: job });
  });
  await page.route('**/api/jobs/cut-export/retry', (route) => {
    Object.assign(job, { status: 'queued', progress: null, stage: 'Queued' });
    return route.fulfill({ json: job });
  });

  await page.goto('/exports');
  const row = page.getByRole('listitem').filter({ hasText: 'Opening cut' });
  await expect(row.getByRole('progressbar')).toHaveAttribute('value', '35');
  await expect(row.getByRole('link', { name: 'Download MP4' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Cancel' }).click();
  await expect(row.getByText('Cancelled', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Retry' }).click();
  await expect(row.getByText('Queued', { exact: true })).toBeVisible();
  Object.assign(job, { status: 'succeeded', progress: 100, stage: 'Validated', metadata: { width: 1080, height: 1920, durationMs: 30000, hasAudio: true } });
  await expect(row.getByRole('link', { name: 'Download MP4' })).toHaveAttribute('href', /\/api\/exports\/cut-export\/download$/);
  await expect(row.getByText(/1080 × 1920/)).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: `test-results/exports-${theme}.png`, animations: 'disabled' });
  }
});
