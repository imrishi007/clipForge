import { expect, test } from 'playwright/test';
import { defaultEdit, type EditDocument } from '../../lib/model';

test('imports timed captions, highlights verified words and persists corrections', async ({ page }) => {
  let edit: EditDocument = defaultEdit();
  await page.route('**/api/health', route => route.fulfill({ json: {} }));
  await page.route('**/api/campaigns', route => route.fulfill({ json: [] }));
  await page.route('**/api/settings', route => route.fulfill({ json: {} }));
  await page.route('**/api/projects', route => route.fulfill({ json: [{ id: 'captions-project', title: 'Caption study',
    mode: 'real', storage: 'server', media: { id: 'media', url: '/demo.mp4', name: 'fixture.mp4', durationMs: 12000 },
    clips: [{ id: 'caption-clip', title: 'Caption clip', edit }] }] }));
  await page.route('**/api/clips/caption-clip/edit-document', route => {
    edit = { ...route.request().postDataJSON(), revision: edit.revision + 1 };
    return route.fulfill({ json: edit });
  });
  await page.route('**/api/clips/caption-clip/transcript-captions?**', route => route.fulfill({ json: [
    { id: 'mixed', startMs: 0, endMs: 2500, text: 'नमस्ते friend', words: [
      { startMs: 0, endMs: 900, text: 'नमस्ते' }, { startMs: 1000, endMs: 2400, text: 'friend' },
    ] }, { id: 'fallback', startMs: 2800, endMs: 4000, text: 'Sentence timing only', words: [] },
  ] }));
  await page.goto('/editor/captions-project/caption-clip');
  await page.getByRole('button', { name: 'Use source transcript' }).click();
  const preview = page.locator('.program-screen .preview-caption');
  await expect(preview.getByText('नमस्ते')).toHaveCSS('color', 'rgb(245, 214, 140)');
  await page.getByText('Edit aligned words', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Caption word' }).selectOption('1');
  await expect(preview.getByText('friend')).toHaveCSS('color', 'rgb(245, 214, 140)');
  await page.getByRole('textbox', { name: 'Word text' }).fill('ClipForge');
  await page.getByRole('spinbutton', { name: 'Word out (seconds)' }).fill('2.3');
  await page.getByRole('combobox', { name: 'Caption animation' }).selectOption('pop');
  await page.getByRole('button', { name: 'Move captions to short-video safe area' }).click();
  await expect(preview.getByText('ClipForge')).toHaveCSS('color', 'rgb(245, 214, 140)');
  await expect.poll(() => edit.captions[0]?.words?.[1]).toEqual({ text: 'ClipForge', startMs: 1000, endMs: 2300 });
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : width === 1440 ? 900 : 1080 });
      await expect.poll(() => page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByText('Edit aligned words', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/caption-alignment-${theme}-${width}.png`, animations: 'disabled' });
    }
  }
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => edit.captionY).toBe(78);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => edit.captionY).toBe(74);
  await page.reload();
  await page.locator('.caption-list').getByRole('button', { name: /Sentence timing only/ }).click();
  await expect(page.getByText('Sentence timing · word alignment unavailable.')).toBeVisible();
  await page.locator('.caption-list').getByRole('button', { name: /नमस्ते ClipForge/ }).click();
  await expect(page.getByRole('combobox', { name: 'Caption animation' })).toHaveValue('pop');
});
