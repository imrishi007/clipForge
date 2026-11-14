import { expect, test } from 'playwright/test';
import { defaultEdit, type EditDocument } from '../../lib/model';

test('quiet gaps become editable source segments and playback skips them', async ({ page }) => {
  let edit: EditDocument = { ...defaultEdit(), sourceInMs: 1000, sourceOutMs: 9000,
    captions: [{ id: 'later', startMs: 5200, endMs: 6800, text: 'After the pause' }] };
  await page.route('**/api/health', route => route.fulfill({ json: { ffmpeg: true } }));
  await page.route('**/api/campaigns', route => route.fulfill({ json: [] }));
  await page.route('**/api/settings', route => route.fulfill({ json: {} }));
  await page.route('**/api/projects', route => route.fulfill({ json: [{ id: 'segments-project', title: 'Quiet gaps',
    mode: 'real', storage: 'server', media: { id: 'm', url: '/demo.mp4', name: 'fixture.mp4', durationMs: 12000, hasAudio: true },
    clips: [{ id: 'segments-clip', title: 'Segment study', edit }] }] }));
  await page.route('**/api/clips/segments-clip/edit-document', route => {
    edit = { ...route.request().postDataJSON(), revision: edit.revision + 1 };
    return route.fulfill({ json: edit });
  });
  await page.route('**/api/projects/segments-project/scenes', route => route.fulfill({ json: { result: null } }));
  await page.route('**/api/clips/segments-clip/waveform?**', route => route.fulfill({ json: { peaks: [.2, .3, .8, .2] } }));
  await page.route('**/api/clips/segments-clip/loudness', route => route.fulfill({ json: { gainDb: 4.5, loudnessLufs: -20.5 } }));
  await page.route('**/api/clips/segments-clip/silence?**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('intensity') === 'gentle') {
      expect(params.get('endMs')).toBe('8000');
      return route.fulfill({ json: { ranges: [{ startMs: 3000, endMs: 4000 }], speechProtected: false } });
    }
    expect(params.get('intensity')).toBe('tight');
    return route.fulfill({ json: { ranges: [{ startMs: 3000, endMs: 6000 }], speechProtected: true } });
  });
  await page.goto('/editor/segments-project/segments-clip');
  await page.getByRole('button', { name: 'Edit inspector' }).click();
  await page.getByRole('button', { name: 'Tighten opening pauses' }).click();
  await expect(page.getByText('Generate a source transcript in Analysis to tighten the opening safely.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Silence removal intensity' }).selectOption('tight');
  await page.getByRole('button', { name: 'Remove quiet gaps' }).click();
  await expect(page.getByText('Quiet gaps removed with transcript protection.')).toBeVisible();
  const segments = page.locator('.video-segment');
  await expect(segments).toHaveCount(2);
  await expect.poll(() => edit.captions[0].startMs).toBe(2200);
  const video = page.locator('.program-screen video');
  await expect(video).toHaveJSProperty('duration', 12);
  await segments.nth(1).click();
  await expect(video).toHaveJSProperty('currentTime', 6);
  await video.evaluate(node => { (node as HTMLVideoElement).currentTime = 3.25; });
  await expect(video).toHaveJSProperty('currentTime', 6);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(segments).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(segments).toHaveCount(2);
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption(theme);
    for (const [width, height] of [[1280, 800], [1440, 900], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect.poll(() => page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByRole('heading', { name: /Source segments/ }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/segments-${theme}-${width}.png`, animations: 'disabled' });
    }
  }
  await expect.poll(() => edit.sourceSegments).toHaveLength(2);
  await page.getByRole('slider', { name: /Fade at cuts/ }).fill('150');
  await expect.poll(() => edit.cutFadeMs).toBe(150);
  await segments.nth(1).click();
  await expect(video).toHaveCSS('filter', 'saturate(1) brightness(0)');
  await expect(page.getByRole('img', { name: 'Source audio waveform' })).toBeVisible();
  await page.getByRole('button', { name: 'Audio inspector' }).click();
  await page.getByRole('checkbox', { name: 'Reduce low-frequency rumble' }).check();
  await page.getByRole('button', { name: 'Normalize speech loudness' }).click();
  await expect(page.getByText('Measured -20.5 LUFS. Applied 4.5 dB gain.')).toBeVisible();
  await expect.poll(() => edit.loudnessGainDb).toBe(4.5);
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: `test-results/audio-${theme}.png`, animations: 'disabled' });
  }
  await page.reload();
  await expect(segments).toHaveCount(2);
  await page.getByRole('button', { name: 'Audio inspector' }).click();
  await expect(page.getByRole('checkbox', { name: 'Reduce low-frequency rumble' })).toBeChecked();
  await page.getByRole('button', { name: 'Edit inspector' }).click();
  await expect(page.getByRole('slider', { name: /Fade at cuts/ })).toHaveValue('150');
  await page.getByRole('button', { name: /Remove segment at 00:06/ }).click();
  await expect(segments).toHaveCount(1);
});
