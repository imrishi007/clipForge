import { expect, test } from 'playwright/test';

test('campaign keeps linked clips, requirements and manual submission data', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Try sample project' }).first().click();
  await expect(page).toHaveURL('/projects/sample-studio');
  await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
  await page.getByRole('button', { name: 'New campaign' }).click();
  await page.getByLabel('Campaign name').fill('Story series');
  await page.getByLabel('Minimum seconds').fill('8');
  await page.getByLabel('Maximum seconds').fill('7');
  await page.getByRole('button', { name: 'Save campaign' }).click();
  await expect(page.getByText('Maximum duration must be at least the minimum.')).toBeVisible();
  await page.getByLabel('Maximum seconds').fill('12');
  await page.getByLabel('Required branding').fill('End card');
  await page.getByRole('button', { name: 'Save campaign' }).click();
  await expect(page).toHaveURL(/\/campaigns\/[^/]+$/);
  await page.getByLabel('Clip to attach').selectOption('sample-clip');
  await page.getByRole('button', { name: 'Attach clip' }).click();
  await expect(page.getByText('Duration outside required range')).toBeVisible();
  await expect(page.getByText('Branding: Manual review required')).toBeVisible();
  await page.getByRole('button', { name: 'Edit submission' }).click();
  await page.getByLabel('Submission link').fill('https://example.com/story');
  await page.getByLabel('Submission status').selectOption('submitted');
  await page.getByLabel('Views').fill('42');
  await page.getByRole('button', { name: 'Save submission' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Story series' })).toBeVisible();
  await expect(page.getByText('Submitted · 42 views', { exact: false })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: `test-results/campaign-${theme}.png`, animations: 'disabled' });
  }
});
