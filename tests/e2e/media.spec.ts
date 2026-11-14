import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from 'playwright/test';

test('imports a real video, saves Hindi captions and downloads a validated portrait MP4', async ({ page }, info) => {
  test.skip(process.env.CLIPFORGE_MEDIA_E2E !== '1', 'Requires an isolated media API and generated fixtures.');
  test.setTimeout(120_000);
  await page.goto('/projects/new');
  await expect(page.getByText('Media service connected', { exact: true })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(resolve('tests/fixtures/landscape.mp4'));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Project name').fill(`Portrait export ${Date.now()}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('checkbox', { name: /I own this footage/ }).check();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[\da-f-]+$/);
  await expect(page.locator('video')).toHaveJSProperty('duration', 44);

  await page.getByRole('button', { name: 'Create manual clip' }).first().click();
  await page.getByLabel('Clip title').fill('Hindi portrait cut');
  await page.getByLabel('Source in (seconds)').fill('2');
  await page.getByLabel('Source out (seconds)').fill('32');
  await page.getByRole('button', { name: 'Create clip', exact: true }).click();
  await expect(page).toHaveURL(/\/editor\/[^/]+\/[^/]+$/);
  await expect(page.locator('.program-screen video')).toHaveAttribute('src', /\?preview=/, { timeout: 45000 });
  await expect(page.locator('.program-screen video')).toHaveJSProperty('videoHeight', 360);
  const seekMetrics = await page.locator('.program-screen video').evaluate(async node => {
    const proxy = node as HTMLVideoElement;
    const original = document.createElement('video');
    original.preload = 'auto';
    const originalUrl = new URL(proxy.src);
    originalUrl.search = '?original=true';
    original.src = originalUrl.href;
    const waitForEvent = (video: HTMLVideoElement, event: string) => new Promise<void>((resolve, reject) => {
      const abort = new AbortController();
      const timer = setTimeout(() => { abort.abort(); reject(new Error(`Timed out waiting for ${event}`)); }, 5000);
      video.addEventListener(event, () => { clearTimeout(timer); abort.abort(); resolve(); }, { once: true, signal: abort.signal });
    });
    const measure = async (video: HTMLVideoElement) => {
      const elapsed = [];
      for (const at of [3, 27, 7, 29, 11, 18]) {
        const ready = waitForEvent(video, 'seeked');
        const start = performance.now();
        video.currentTime = at;
        await ready;
        elapsed.push(performance.now() - start);
      }
      return elapsed.map(ms => Math.round(ms));
    };
    if (original.readyState < 1) await waitForEvent(original, 'loadedmetadata');
    const originals = await measure(original);
    original.removeAttribute('src');
    original.load();
    return { original: originals, proxy: await measure(proxy) };
  });
  console.log('Seek milliseconds', seekMetrics);
  await info.attach('seek-timings', { body: JSON.stringify(seekMetrics), contentType: 'application/json' });
  await page.getByRole('button', { name: 'Add caption', exact: true }).click();
  const hindi = 'हर पल में एक कहानी है।';
  await page.getByLabel('Caption text').fill(hindi);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: hindi, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('combobox', { name: 'Frame rate' }).selectOption('source');
  await page.getByRole('combobox', { name: 'Encoding quality' }).selectOption('high');
  await page.getByRole('button', { name: 'Render MP4' }).click();
  await expect(page).toHaveURL('/exports');

  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Hindi portrait cut' }) });
  const download = row.getByRole('link', { name: 'Download MP4' });
  await expect(row.getByText(/^(Validated|Failed)$/)).toHaveText('Validated', { timeout: 75_000 });
  const downloaded = page.waitForEvent('download');
  await download.click();
  const path = info.outputPath('hindi-portrait.mp4');
  await (await downloaded).saveAs(path);
  const probe = JSON.parse(execFileSync(process.env.FFPROBE_BINARY || 'ffprobe',
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { encoding: 'utf8' }));
  expect(probe.streams).toEqual(expect.arrayContaining([
    expect.objectContaining({ codec_name: 'h264', width: 1080, height: 1920, pix_fmt: 'yuv420p', avg_frame_rate: '30/1' }),
    expect.objectContaining({ codec_name: 'aac' }),
  ]));
  expect(Number(probe.format.duration)).toBeCloseTo(30, 1);
  await info.attach('ffprobe', { body: JSON.stringify(probe, null, 2), contentType: 'application/json' });
});
