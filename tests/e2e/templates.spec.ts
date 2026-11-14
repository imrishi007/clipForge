import { expect, test } from 'playwright/test';

test('a saved caption preset applies to a sample clip and survives reload', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Try sample project' }).first().click();
  await expect(page).toHaveURL('/projects/sample-studio');
  await page.getByRole('link', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'New preset' }).click();
  await page.getByLabel('Preset name').fill('Large captions');
  await page.getByLabel('Caption size').fill('74');
  await page.getByRole('combobox', { name: 'Preset caption motion' }).selectOption('pop');
  await page.getByRole('spinbutton', { name: 'Preset zoom' }).fill('113');
  await page.getByRole('spinbutton', { name: 'Preset saturation' }).fill('1.1');
  await page.getByRole('button', { name: 'Save preset' }).click();
  await page.getByLabel('Search templates').fill('Large captions');
  await page.getByLabel('Clip to style').selectOption('sample-clip');
  await page.getByRole('button', { name: 'Apply Large captions' }).click();
  await expect(page).toHaveURL('/editor/sample-studio/sample-clip');
  await expect(page.getByLabel('Size (1080 reference)')).toHaveValue('74');
  await expect(page.locator('.program-screen video')).toHaveCSS('filter', 'saturate(1.1)');
  await expect(page.locator('.program-screen video')).toHaveCSS('transform', 'matrix(1.13, 0, 0, 1.13, 0, 0)');
  await page.reload();
  await expect(page.getByLabel('Size (1080 reference)')).toHaveValue('74');
  await page.goto('/templates');
  await expect(page.getByRole('heading', { name: 'Large captions' })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: `test-results/templates-${theme}.png`, animations: 'disabled' });
  }
});
