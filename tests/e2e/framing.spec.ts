import { expect, test } from 'playwright/test';
import { defaultEdit, type EditDocument } from '../../lib/model';

test('framing keyframes preview, edit, undo and autosave in both themes', async ({ page }) => {
  let saved: EditDocument = { ...defaultEdit(), sourceInMs: 2000, sourceOutMs: 8000 };
  const media = { id: 'framing-media', url: '/demo.mp4', name: 'fixture.mp4', durationMs: 12000, width: 1280, height: 720 };
  await page.route('**/api/health', route => route.fulfill({ json: { ffmpeg: true, ffprobe: true } }));
  await page.route('**/api/campaigns', route => route.fulfill({ json: [] }));
  await page.route('**/api/settings', route => route.fulfill({ json: {} }));
  await page.route('**/api/projects', route => route.fulfill({ json: [{ id: 'framing-project', title: 'Framing study',
    mode: 'real', storage: 'server', media, clips: [{ id: 'frame-clip', title: 'Framing clip', edit: saved }] }] }));
  await page.route('**/api/clips/frame-clip/edit-document', route => {
    saved = { ...route.request().postDataJSON(), revision: saved.revision + 1 };
    return route.fulfill({ json: saved });
  });
  await page.route('**/api/clips/frame-clip/framing', route => {
    expect(route.request().postDataJSON()).toEqual({ sourceInMs: 2000, sourceOutMs: 8000, ratio: '9:16', focalX: .5, focalY: .5 });
    return route.fulfill({ status: 202, json: { id: 'framing-job', status: 'queued' } });
  });
  await page.route('**/api/clips/frame-clip/framing/framing-job', route => route.fulfill({ json: {
    job: { id: 'framing-job', status: 'succeeded' }, result: { faceFrames: 29, sampledFrames: 30, keyframes: [
      { timeMs: 0, x: .2, y: .5 }, { timeMs: 2000, x: .8, y: .5 }, { timeMs: 4000, x: .15, y: .5, cut: true },
    ] },
  } }));
  await page.goto('/editor/framing-project/frame-clip');
  await page.getByRole('button', { name: 'Crop inspector' }).click();
  const video = page.locator('.program-screen video');
  await expect(video).toHaveJSProperty('duration', 12);
  await page.getByRole('button', { name: 'Track faces in clip' }).click();
  await expect(page.getByRole('status')).toContainText('29 of 30');
  await expect(video).toHaveCSS('object-position', '20% 50%');
  const select = page.getByRole('combobox', { name: 'Framing keyframe', exact: true });
  await select.selectOption('2000');
  await expect(video).toHaveCSS('object-position', '80% 50%');
  await page.getByLabel('Keyframe horizontal position').fill('0.7');
  await expect(video).toHaveCSS('object-position', '70% 50%');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(video).toHaveCSS('object-position', '80% 50%');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(video).toHaveCSS('object-position', '70% 50%');
  await expect.poll(() => saved.framingKeyframes?.[1].x).toBe(.7);
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(() => page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByRole('heading', { name: 'Framing keyframes' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/framing-${theme}-${viewport.width}.png`, animations: 'disabled' });
    }
  }
  await page.reload();
  await page.getByRole('button', { name: 'Crop inspector' }).click();
  await select.selectOption('4000');
  await expect(video).toHaveCSS('object-position', '15% 50%');
  await page.getByRole('button', { name: 'Use fixed framing' }).click();
  await expect(select).toHaveCount(0);
  await expect.poll(() => saved.framingKeyframes).toEqual([]);
});
