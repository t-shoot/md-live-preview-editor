import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

/**
 * Frontmatter is a "図" block like a table or a diagram: it switches between
 * its rendered key/value view and raw YAML only through its own buttons,
 * never by where the caret happens to be — see `isBlockRevealed` in
 * cmUtils.ts.
 */
test.describe('frontmatter', () => {
	test('renders a key/value view for valid YAML', async ({ page }) => {
		await mountEditor(page, '---\ntitle: Hello\n---\n\nBody text.\n');
		await expect(page.locator('.mlp-frontmatter')).toHaveCount(1);
		await expect(page.locator('.mlp-frontmatter')).toContainText('title');
		await expect(page.locator('.mlp-frontmatter')).toContainText('Hello');
	});

	test('does not auto-reveal as raw YAML even though the caret starts at position 0', async ({ page }) => {
		// Frontmatter always begins at the very start of the document, so the
		// caret sits on its own first line the instant the file opens — the exact
		// accidental-reveal case `isBlockRevealed` exists to rule out.
		await mountEditor(page, '---\ntitle: Hello\n---\n\nBody text.\n');
		await expect(page.locator('.mlp-frontmatter')).toHaveCount(1);
	});

	test('the </> button reveals raw YAML, and the render button returns it', async ({ page }) => {
		await mountEditor(page, '---\ntitle: Hello\n---\n\nBody text.\n');
		await expect(page.locator('.mlp-frontmatter')).toHaveCount(1);

		await page.locator('.mlp-code-mode-btn').first().click();
		await expect(page.locator('.mlp-frontmatter')).toHaveCount(0);
		await expect(page.locator('.cm-line', { hasText: 'title: Hello' })).toBeVisible();
		await expect(page.locator('.mlp-render-mode-btn')).toHaveCount(1);

		await page.locator('.mlp-render-mode-btn').click();
		await expect(page.locator('.mlp-frontmatter')).toHaveCount(1);
	});

	test('raw YAML gets the same tinted background as a raw table or diagram', async ({ page }) => {
		const doc = ['---', 'title: Hello', 'author: me', '---', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', ''].join(
			'\n',
		);
		await mountEditor(page, doc);
		await page.locator('.mlp-code-mode-btn').first().click(); // frontmatter's own button
		await page.locator('.mlp-code-mode-btn').first().click(); // the table's

		await expect(page.locator('.mlp-line-frontmatter-raw')).toHaveCount(4);
		const fmBg = await page
			.locator('.mlp-line-frontmatter-raw')
			.first()
			.evaluate((el) => getComputedStyle(el).backgroundColor);
		const tableBg = await page
			.locator('.mlp-line-table-raw')
			.first()
			.evaluate((el) => getComputedStyle(el).backgroundColor);
		expect(fmBg).toBe(tableBg);
		expect(fmBg).not.toBe('rgba(0, 0, 0, 0)'); // not left transparent

		// First/last lines round their corners like the table's own raw view does.
		const radius = await page
			.locator('.mlp-line-frontmatter-raw-first')
			.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
		expect(radius).not.toBe('0px');
	});

	test('the render button works even when frontmatter is the very last thing in the document', async ({ page }) => {
		await mountEditor(page, '---\ntitle: Hello\n---');
		await expect(page.locator('.mlp-frontmatter')).toHaveCount(1);
		await page.locator('.mlp-code-mode-btn').first().click();
		await expect(page.locator('.mlp-render-mode-btn')).toHaveCount(1);
		await page.locator('.mlp-render-mode-btn').click();
		await expect(page.locator('.mlp-frontmatter')).toHaveCount(1);
	});

	test('a YAML parse failure still offers a way to reach and return from the source', async ({ page }) => {
		await mountEditor(page, '---\ntitle: [unclosed\n---\n\nBody text.\n');
		await expect(page.locator('.mlp-frontmatter-error')).toHaveCount(1);

		await page.locator('.mlp-code-mode-btn').first().click();
		await expect(page.locator('.mlp-frontmatter-error')).toHaveCount(0);
		await expect(page.locator('.mlp-render-mode-btn')).toHaveCount(1);

		await page.locator('.mlp-render-mode-btn').click();
		await expect(page.locator('.mlp-frontmatter-error')).toHaveCount(1);
	});
});
