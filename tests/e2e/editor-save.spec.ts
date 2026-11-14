import { expect, test } from 'playwright/test';
import { defaultEdit } from '../../lib/model';

test('an in-flight save keeps its clip and flushes the last edit after switching clips', async ({ page }) => {
  const clip = (id: string, title: string, revision: number) => ({
    id, title, projectId: 'project', sourceKind: 'manual', notes: '', status: 'draft', favorite: false,
    edit: { ...defaultEdit(), revision, captions: [{ id, startMs: 0, endMs: 1000, text: title }] },
  });
  const first = clip('first', 'First cut', 3);
  const second = clip('second', 'Second cut', 9);
  const project = { id: 'project', title: 'Source', storage: 'server', mode: 'real', clips: [first, second], media: {
    id: 'source', name: 'demo.mp4', durationMs: 12000, width: 1280, height: 720, hasAudio: true, url: '/demo.mp4',
  } };
  await page.route('**/api/health', (route) => route.fulfill({ json: { ffmpeg: true, ffprobe: true } }));
  await page.route('**/api/campaigns', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/projects', (route) => route.fulfill({ json: [project] }));
  let releaseFirst = () => {};
  const firstSaveBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const writes: { id: string; revision: number; text: string }[] = [];
  await page.route('**/api/clips/*/edit-document', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[3];
    const edit = route.request().postDataJSON() as typeof first.edit;
    writes.push({ id, revision: edit.revision, text: edit.captions[0].text });
    if (writes.length === 1) await firstSaveBlocked;
    await route.fulfill({ json: { ...edit, revision: edit.revision + 1 } });
  });

  await page.goto('/editor/project/first');
  await page.getByRole('button', { name: 'First cut', exact: true }).click();
  await page.getByLabel('Caption text').fill('First saved text');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  await page.getByLabel('Caption text').fill('Last edit before switching');
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.getByRole('link', { name: 'Edit clip', exact: true }).last().click();
  await expect(page).toHaveURL('/editor/project/second');
  releaseFirst();
  await expect.poll(() => writes.filter((write) => write.id === 'first').at(-1)).toEqual({ id: 'first', revision: 4, text: 'Last edit before switching' });

  await page.getByRole('button', { name: 'Second cut', exact: true }).click();
  await page.getByLabel('Caption text').fill('Second clip edit');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => writes.filter((write) => write.id === 'second')).toEqual([{ id: 'second', revision: 9, text: 'Second clip edit' }]);
});
