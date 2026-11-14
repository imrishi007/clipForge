import { expect, test } from 'playwright/test';

test('preferences persist and populate the import wizard', async ({ page }) => {
  await page.goto('/settings');
  await page.getByLabel('Default output aspect').selectOption('1:1');
  await page.getByLabel('Default caption style').selectOption('Cinematic Story');
  await page.getByLabel('Default clip length (seconds)').fill('22');
  await page.getByRole('combobox', { name: 'Performance profile' }).selectOption('balanced');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText('Preferences saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Default output aspect')).toHaveValue('1:1');
  await expect(page.getByLabel('Default clip length (seconds)')).toHaveValue('22');
  await expect(page.getByRole('combobox', { name: 'Performance profile' })).toHaveValue('balanced');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: `test-results/settings-${theme}.png`, animations: 'disabled' });
  }
  await page.goto('/projects/new');
  await page.locator('input[type=file]').setInputFiles('public/demo.mp4');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Output aspect')).toHaveValue('1:1');
  await expect(page.getByLabel('Caption style')).toHaveValue('Cinematic Story');
});

test('runtime hardware checks unlock an encoder and display laptop resources', async ({ page }) => {
  let saved = {};
  await page.route('**/api/health', route => route.fulfill({ json: { ffmpeg: true, ffprobe: true, workerRunning: true } }));
  await page.route('**/api/projects', route => route.fulfill({ json: [] }));
  await page.route('**/api/campaigns', route => route.fulfill({ json: [] }));
  await page.route('**/api/settings', route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    return route.fulfill({ json: saved });
  });
  await page.route('**/api/performance', route => route.fulfill({ json: { logicalCpus: 12, ramMiB: 16051, availableRamMiB: 7000,
    heavyJobs: 1, gpu: { name: 'NVIDIA GeForce RTX 2050', usedMiB: 325, totalMiB: 4096, temperatureC: 50 } } }));
  await page.route('**/api/performance/hardware', route => route.fulfill({ json: {
    h264_nvenc: { available: true, detail: '' }, h264_qsv: { available: true, detail: '' },
    h264_amf: { available: false, detail: 'AMF runtime unavailable' }, nvdec: { available: true, detail: '' },
  } }));
  await page.goto('/settings');
  const encoder = page.getByRole('combobox', { name: 'Export encoder' });
  await expect(encoder.locator('option[value=h264_nvenc]')).toHaveJSProperty('disabled', true);
  await page.getByRole('button', { name: 'Check connection and hardware' }).click();
  await expect(page.getByText('325 / 4096 MiB VRAM · 50 °C')).toBeVisible();
  await expect(encoder.locator('option[value=h264_amf]')).toHaveJSProperty('disabled', true);
  await encoder.selectOption('h264_qsv');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect.poll(() => saved).toMatchObject({ exportEncoder: 'h264_qsv' });
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: `test-results/hardware-settings-${theme}.png`, animations: 'disabled' });
  }
});
