import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor, postToWebview } from './harness';

const LONG = '    """' + 'Long documentation with Japanese 日本語 and more text. '.repeat(5) + '"""';
const CODE = 'def toggle_live_preview(path: str) -> None:\n\n' + LONG + '\n    print("Opened the Markdown file")';

// Chromium's headless default hides native scrollbar painting. Show it here
// so the screenshots also check where the actual track and thumb are drawn.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

for (const theme of ['vscode', 'github-like']) {
	test(`one scrollbar stays below all code lines with ${theme} CSS`, async ({ page }) => {
		await page.setViewportSize({ width: 480, height: 700 });
		await mountEditor(page, 'Intro\n\n```python\n' + CODE + '\n```\n\n```js\nconst short = 1;\n```\n\nAfter.\n');
		await page.evaluate(() => {
			document.body.className = 'vscode-dark';
			document.documentElement.style.setProperty('--vscode-textCodeBlock-background', '#2d333b');
		});
		await postToWebview(page, { type: 'applyCss', css: readFileSync(join(__dirname, '../../media/sample-styles', `${theme}.css`), 'utf8') });
		const bar = page.locator('.mlp-code-scrollbar[data-overflow="true"]');
		await expect(bar).toHaveCount(1);
		await expect(bar).toBeVisible();
		const background = await page.locator('.mlp-code-toolbar-line').first().evaluate(element => getComputedStyle(element).backgroundColor);
		await expect(bar).toHaveCSS('background-color', background);
		const last = page.locator('.mlp-line-code-last').first();
		const bodyEnd = (await last.boundingBox())!;
		const scroll = (await bar.boundingBox())!;
		expect(scroll.y).toBeGreaterThanOrEqual(bodyEnd.y + bodyEnd.height - 1);
		await expect(page.locator('.mlp-line-code:not(.mlp-code-toolbar-line)').first()).toHaveCSS('overflow-x', 'hidden');
		await bar.evaluate(element => { element.scrollLeft = 120; });
		await expect.poll(async () => page.locator('.mlp-code-scrollable-row').evaluateAll(rows => rows.every(row => row.scrollLeft >= 119))).toBe(true);
		await expect.poll(async () => page.locator('.mlp-line-code-last').last().evaluate(row => row.scrollLeft)).toBe(0);
		await page.screenshot({ path: `test-results/code-scroll-bottom-${theme}.png` });
		await page.setViewportSize({ width: 2800, height: 900 });
		await expect(page.locator('.mlp-code-scrollbar[data-overflow="true"]')).toHaveCount(0);
	});
}

test('scrolling keeps code editable and copying preserves the entire code', async ({ page }) => {
	await page.setViewportSize({ width: 480, height: 700 });
	await mountEditor(page, 'Intro\n\n```python\n' + CODE + '\n```\n\nAfter.\n');
	await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
		writeText: async (text: string) => { (window as any).__copied = text; },
	} }));
	const bar = page.locator('.mlp-code-scrollbar[data-overflow="true"]');
	await expect(bar).toBeVisible();
	await bar.evaluate(element => { element.scrollLeft = 120; });
	await page.locator('.mlp-copy-code-btn').click();
	expect(await page.evaluate(() => (window as any).__copied)).toBe(CODE);
	const last = page.locator('.mlp-line-code-last');
	await last.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' # edited');
	await expect(last).toContainText('# edited');
	await expect(bar).toBeVisible();
});

test('long blocks keep the widest offscreen line and their horizontal position after edits', async ({ page }) => {
	await page.setViewportSize({ width: 480, height: 350 });
	await mountEditor(page, 'Intro\n\n```python\n' + LONG + '\n' + '    short_line()\n'.repeat(180) + '```\n\nAfter.\n');
	const first = page.locator('.mlp-code-scrollable-row').first();
	await expect(first).toBeVisible();
	await first.hover();
	await page.mouse.wheel(120, 0);
	await expect.poll(() => first.evaluate(row => row.scrollLeft)).toBeGreaterThan(100);
	await page.locator('.cm-scroller').evaluate(element => { element.scrollTop = element.scrollHeight; });
	const bar = page.locator('.mlp-code-scrollbar[data-overflow="true"]');
	await expect(bar).toBeVisible();
	await expect.poll(() => bar.evaluate(element => element.scrollLeft)).toBeGreaterThan(100);
	await postToWebview(page, { type: 'externalUpdate', changes: [{ from: 0, to: 0, insert: 'Added\n\n' }], version: 1 });
	await expect(bar).toBeVisible();
	await bar.evaluate(element => { element.scrollLeft = 160; });
	await expect.poll(() => page.locator('.mlp-code-scrollable-row').evaluateAll(rows => rows.every(row => row.scrollLeft >= 159))).toBe(true);
});

test('nested code scrolls independently and disappears with its folded heading', async ({ page }) => {
	await page.setViewportSize({ width: 480, height: 700 });
	await mountEditor(page, 'Intro\n\n# Section\n\n- Nested\n\n  ```python\n  ' + LONG + '\n  short_line()\n  ```\n\n# Next\n\nAfter.\n');
	const bar = page.locator('.mlp-code-scrollbar[data-overflow="true"]');
	await expect(bar).toBeVisible();
	await page.getByRole('button', { name: 'Collapse section: Section', exact: true }).click();
	await expect(page.locator('.mlp-code-scrollbar:visible')).toHaveCount(0);
	await page.locator('.mlp-heading-fold-placeholder').click();
	await expect(bar).toBeVisible();
});
