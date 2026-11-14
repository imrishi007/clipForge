import { expect, test } from 'playwright/test';

test('help filters working shortcuts and links to media settings', async ({ page }) => {
  await page.goto('/help');
  await expect(page.getByRole('heading', { name: 'Help & shortcuts' })).toBeVisible();
  await page.getByLabel('Search shortcuts').fill('split');
  await expect(page.getByRole('row').filter({ hasText: 'Split at playhead' })).toBeVisible();
  await expect(page.getByText('Play / pause', { exact: true })).toHaveCount(0);
  await page.getByLabel('Search shortcuts').clear();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: `test-results/help-${theme}.png`, animations: 'disabled' });
  }
  await page.getByRole('link', { name: 'Check media service' }).click();
  await expect(page).toHaveURL('/settings');
});
