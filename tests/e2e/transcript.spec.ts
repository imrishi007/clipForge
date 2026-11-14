import { expect, test } from 'playwright/test';
import { defaultEdit, type Clip } from '../../lib/model';

test('detected cuts seek and trim at exact source times while retiming captions', async ({ page }) => {
  const edit = { ...defaultEdit(), sourceInMs: 2000, sourceOutMs: 8000,
    captions: [{ id: 'crossing', startMs: 2000, endMs: 4000, text: 'हर पल में एक कहानी है।' }] };
  const project = { id: 'scenes-project', title: 'Scene trim', mode: 'real', storage: 'server',
    media: { id: 'scenes-media', url: '/demo.mp4', name: 'fixture.mp4', durationMs: 12000, width: 1280, height: 720 },
    clips: [{ id: 'clip', projectId: 'scenes-project', title: 'Scene clip', edit }] };
  let saved = edit;
  await page.route('**/api/health', (route) => route.fulfill({ json: { ffmpeg: true, ffprobe: true } }));
  await page.route('**/api/campaigns', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/projects', (route) => route.fulfill({ json: [{ ...project, clips: [{ ...project.clips[0], edit: saved }] }] }));
  await page.route('**/api/clips/clip/edit-document', (route) => {
    saved = { ...route.request().postDataJSON(), revision: saved.revision + 1 };
    return route.fulfill({ json: saved });
  });
  await page.route('**/api/settings', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/projects/scenes-project/scenes', (route) => route.fulfill({ json: {
    result: { scenes: [{ startMs: 0 }, { startMs: 1000 }, { startMs: 4537 }, { startMs: 9000 }] },
  } }));
  await page.goto('/editor/scenes-project/clip');
  await page.getByRole('button', { name: 'Edit inspector' }).click();
  const select = page.getByLabel('Scene boundary (source time)');
  await expect(select.locator('option')).toHaveText(['00:04.537']);
  const video = page.locator('.program-screen video');
  await expect(video).toHaveJSProperty('duration', 12);
  await page.getByRole('button', { name: 'Preview boundary' }).click();
  await expect.poll(() => video.evaluate((node) => (node as HTMLVideoElement).currentTime)).toBeCloseTo(4.537, 2);
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: `test-results/scene-cut-${theme}-${viewport.width}.png`, animations: 'disabled' });
    }
  }
  await page.getByRole('button', { name: 'Set clip end' }).click();
  await expect(page.getByLabel('Source out (seconds)')).toHaveValue('4.537');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Source out (seconds)')).toHaveValue('8');
  await page.getByRole('button', { name: 'Set clip start' }).click();
  await expect(page.getByLabel('Source in (seconds)')).toHaveValue('4.537');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => saved.captions).toEqual([{ ...edit.captions[0], startMs: 0, endMs: 1463 }]);
  await page.reload();
  await page.getByRole('button', { name: 'Edit inspector' }).click();
  await expect(page.getByLabel('Source in (seconds)')).toHaveValue('4.537');
  await expect(page.getByText('No detected cut inside this clip.')).toBeVisible();
});

test('local highlight candidates retain source times and open in the existing editor', async ({ page }) => {
  const project = { id: 'interview', title: 'Interview', mode: 'real', storage: 'server', category: 'Personal',
    preferences: { language: 'Hindi' }, clips: [], media: { id: 'speech', name: 'interview.mp4', durationMs: 90000,
      width: 1280, height: 720, url: '/demo.mp4', thumbnail: '/sample.svg', hasAudio: true, sourceAvailable: true } };
  let ranked = false;
  let accepted: Clip | undefined;
  await page.route('**/api/projects', (route) => route.fulfill({ json: [{ ...project, clips: accepted ? [accepted] : [] }] }));
  await page.route('**/api/campaigns', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/health', (route) => route.fulfill({ json: { ffmpeg: true } }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/projects/interview/transcript', (route) => route.fulfill({ json: {
    available: true, hasAudio: true, job: { id: 'transcript-job', status: 'succeeded', stage: 'Transcript ready' },
    transcript: { revision: 0, model: 'whisper-small', language: 'hi', languageMode: 'Hindi', segments: [
      { id: '1', text: 'एक लंबी कहानी में अर्थपूर्ण शुरुआत और अंत आता है।', startMs: 0, endMs: 80000, words: [] },
    ] },
  } }));
  await page.route('**/api/projects/interview/scenes', (route) => route.fulfill({ json: { available: true, job: null, result: null } }));
  await page.route('**/api/projects/interview/highlights', (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toMatchObject({ targetCount: 4, minSeconds: 30, maxSeconds: 50, emphasis: 'Storytelling', language: 'Hindi' });
      ranked = true;
    }
    return route.fulfill({ json: { available: true, job: ranked ? { id: 'highlight-job', status: 'succeeded', stage: 'Highlights ready' } : null,
      result: ranked ? { candidates: [{ id: 1, startMs: 2000, endMs: 42000, title: 'कहानी का मोड़', reason: 'शुरुआत और निष्कर्ष एक साथ हैं।' }] } : null } });
  });
  await page.route('**/api/projects/interview/highlights/clip', (route) => {
    expect(route.request().postDataJSON()).toEqual({ jobId: 'highlight-job', candidateId: 1, framing: 'close-up' });
    accepted = {
      id: 'ranked-clip', projectId: project.id, title: 'कहानी का मोड़', sourceKind: 'ai_highlight', status: 'draft',
      notes: '', favorite: false,
      edit: { ...defaultEdit(), sourceInMs: 2000, sourceOutMs: 42000, zoomPercent: 115, color: '#F5D68C', fontSize: 46, bold: false,
        captions: [{ id: 'generated', startMs: 0, endMs: 2500, text: 'शुरुआत और निष्कर्ष' }] },
    };
    return route.fulfill({ status: 201, json: accepted });
  });
  await page.goto('/projects/interview/analyze');
  await page.getByText('Discovery settings', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Target clips' }).fill('4');
  await page.getByRole('combobox', { name: 'Highlight emphasis' }).selectOption('Storytelling');
  await expect(page.getByRole('button', { name: 'Find highlights' })).toBeEnabled();
  await page.getByRole('button', { name: 'Find highlights' }).click();
  await expect(page.getByRole('heading', { name: 'कहानी का मोड़' })).toBeVisible();
  await expect(page.getByRole('button', { name: '00:02.000–00:42.000' })).toBeVisible();
  await page.getByLabel('Highlight framing preset').selectOption('close-up');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(() => page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/highlights-${theme}-${viewport.width}.png`, animations: 'disabled' });
    }
  }
  await page.getByRole('button', { name: 'Open in editor' }).click();
  await expect(page).toHaveURL(/\/editor\/interview\/ranked-clip$/);
  await expect(page.getByText('Transcript draft · review before export')).toBeVisible();
  await expect(page.locator('.program-screen .preview-caption')).toHaveCSS('color', 'rgb(245, 214, 140)');
  await expect(page.locator('.program-screen video')).toHaveCSS('transform', 'matrix(1.15, 0, 0, 1.15, 0, 0)');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: `test-results/highlight-editor-${theme}.png`, animations: 'disabled' });
  }
});

test('analysis shows timed words and saves a corrected transcript', async ({ page }, info) => {
  const project = { id: 'interview', title: 'Interview', mode: 'real', storage: 'server', category: 'Personal',
    preferences: { language: 'Hindi' }, clips: [], media: { id: 'speech', name: 'demo.mp4', durationMs: 12000,
      width: 1280, height: 720, url: '/demo.mp4', hasAudio: true, sourceAvailable: true } };
  const transcript = { revision: 0, language: 'hi', languageMode: 'Hindi', model: 'whisper-small', segments: [
    { id: '1', text: 'नमस्ते दोस्त', startMs: 500, endMs: 1800, words: [{ text: 'नमस्ते', startMs: 500, endMs: 1000 }] },
  ] };
  let generated = false;
  let scenes = false;
  let resumed = false;
  await page.route('**/api/projects', (route) => route.fulfill({ json: [project] }));
  await page.route('**/api/campaigns', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/health', (route) => route.fulfill({ json: { ffmpeg: true } }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/projects/interview/scenes', (route) => {
    if (route.request().method() === 'POST') scenes = true;
    return route.fulfill({ json: { available: true, job: null, result: scenes ? { scenes: [{ startMs: 0, endMs: 12000 }] } : null } });
  });
  await page.route('**/api/jobs/interrupted-transcript/retry', route => {
    resumed = true;
    generated = true;
    return route.fulfill({ json: { id: 'interrupted-transcript', status: 'queued' } });
  });
  await page.route('**/api/projects/interview/transcript', (route) => {
    if (route.request().method() === 'POST') generated = true;
    if (route.request().method() === 'PUT') {
      expect(route.request().postDataJSON()).toEqual({ revision: 0, changes: { '1': 'नमस्ते दोस्तों' } });
      Object.assign(transcript.segments[0], { text: 'नमस्ते दोस्तों', words: [], corrected: true });
      transcript.revision++;
    }
    return route.fulfill({ json: { available: true, hasAudio: true,
      job: generated ? null : { id: 'interrupted-transcript', status: 'failed', stage: 'Interrupted' },
      transcript: generated ? { ...transcript, cachedChunks: resumed ? 2 : 0 } : null } });
  });
  await page.goto('/projects/interview/analyze');
  await page.getByRole('button', { name: 'Detect scenes' }).click();
  await expect(page.getByText('1 detected scene spans', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume previous transcription' }).click();
  await expect(page.getByText('Reused 2 completed transcription windows.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Source transcript' })).toBeVisible();
  await page.getByText('Word timestamps', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'नमस्ते', exact: true })).toBeVisible();
  await page.getByLabel('Transcript segment 1').fill('नमस्ते दोस्तों');
  await page.getByRole('button', { name: 'Save corrections' }).click();
  await expect(page.getByText('Corrected text uses segment timing.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Transcript segment 1')).toHaveValue('नमस्ते दोस्तों');
  await expect(page.getByRole('link', { name: 'Download source SRT' })).toHaveAttribute('href', /transcript\/subtitles$/);
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: `test-results/transcript-${theme}.png`, animations: 'disabled' });
  }
  const metrics = await page.context().newCDPSession(page);
  await metrics.send('Performance.enable');
  await info.attach('browser-metrics', { body: JSON.stringify(await metrics.send('Performance.getMetrics')), contentType: 'application/json' });
  await page.getByRole('button', { name: 'Create clip around this cue' }).click();
  await expect(page.getByRole('dialog', { name: 'Create clip from transcript' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Clip title' })).toHaveValue('नमस्ते दोस्तों');
  await page.getByRole('spinbutton', { name: 'Context end (source seconds)' }).fill('2.5');
  await page.route('**/api/projects/interview/transcript/clip', route => {
    expect(route.request().postDataJSON()).toMatchObject({ segmentId: '1', revision: 1, startMs: 500, endMs: 2500 });
    return route.fulfill({ status: 201, json: { id: 'transcript-clip' } });
  });
  await page.getByRole('button', { name: 'Approve and open editor' }).click();
  await expect(page).toHaveURL('/editor/interview/transcript-clip');
});

