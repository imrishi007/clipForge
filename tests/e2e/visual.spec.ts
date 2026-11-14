import { expect, test } from 'playwright/test';

for (const viewport of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
  test(`visual workspace and editor at ${viewport.width} × ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Try sample project' }).first().click();
    await expect(page).toHaveURL('/projects/sample-studio');

    const screens = [
      ['dashboard', '/dashboard', 'A good story starts here.'],
      ['project', '/projects/sample-studio', 'The quiet between moments'],
      ['discovery', '/projects/sample-studio/clips', 'Sample highlights'],
      ['editor', '/editor/sample-studio/sample-clip', 'Text style'],
    ];
    for (const [screen, url, title] of screens) {
      await page.goto(url);
      await expect(page.getByRole('heading', { name: title, exact: false }).first()).toBeVisible();
      if (screen === 'editor') await expect(page.locator('video').last()).toHaveJSProperty('duration', 12);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      for (const theme of ['light', 'dark']) {
        await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${screen} has page-level horizontal overflow`).toBeLessThanOrEqual(1);
        await page.screenshot({ path: `test-results/visual/${viewport.width}-${screen}-${theme}.png`, animations: 'disabled' });
      }
    }
  });
}
