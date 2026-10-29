import { test, expect } from '@playwright/test';
import { mountEditor, openSearch, postToWebview } from './harness';

const DOC = 'Intro\n\n# Parent\n\nParent body\n\n## Child\n\nHidden needle\n\n| Name | Value |\n| --- | --- |\n| A | 1 |\n\n# Next\n\nNext body\n';

test('folds nested sections, restores tables, and leaves the Markdown unchanged', async ({ page }) => {
	await mountEditor(page, DOC);
	const parentToggle = page.getByRole('button', { name: 'Collapse section: Parent', exact: true });
	await page.mouse.move(999, 699);
	await expect(parentToggle).toHaveCSS('opacity', '0');
	await page.locator('.mlp-line-h1', { hasText: 'Parent' }).hover();
	await expect(parentToggle).toHaveCSS('opacity', '0.8');
	const icon = await parentToggle.locator('svg').boundingBox();
	expect(icon!.width).toBeCloseTo(12, 0);
	expect(icon!.height).toBeCloseTo(12, 0);
	await page.getByRole('button', { name: 'Collapse section: Child', exact: true }).click();
	await expect(page.locator('.mlp-heading-fold-placeholder')).toHaveText('…');
	await expect(page.locator('.mlp-table')).toHaveCount(0);
	await page.getByRole('button', { name: 'Collapse section: Parent', exact: true }).click();
	await expect(page.locator('.cm-line', { hasText: 'Parent body' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Expand section: Child', exact: true })).toHaveCount(0);
	await expect(page.locator('.cm-line', { hasText: 'Next body' })).toBeVisible();
	await expect(page.locator('.mlp-heading-fold-placeholder')).toHaveCount(1);
	await page.locator('.mlp-heading-fold-placeholder').click();
	await expect(page.getByRole('button', { name: 'Expand section: Child', exact: true })).toBeVisible();
	await expect(page.locator('.mlp-table')).toHaveCount(0);
	await page.getByRole('button', { name: 'Expand section: Child', exact: true }).click();
	await expect(page.locator('.mlp-table')).toBeVisible();
	await expect(page.locator('.cm-line', { hasText: 'Hidden needle' })).toBeVisible();
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	await page.screenshot({ path: 'test-results/heading-fold-expanded.png' });
});

test('search and outline navigation reveal folded content', async ({ page }) => {
	await mountEditor(page, DOC);
	await page.getByRole('button', { name: 'Collapse section: Parent', exact: true }).click();
	await openSearch(page);
	await page.locator('.cm-search input[name="search"]').pressSequentially('Hidden needle');
	await page.locator('.cm-search input[name="search"]').press('Enter');
	await expect(page.locator('.cm-line', { hasText: 'Hidden needle' })).toBeVisible();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Collapse section: Parent', exact: true }).click();
	await postToWebview(page, { type: 'jumpToLine', line: 9 });
	await expect(page.locator('.cm-line', { hasText: 'Hidden needle' })).toBeVisible();
});

test('maps folds through external edits and supports keyboard toggles at narrow widths', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 800 });
	await mountEditor(page, DOC, 'ja');
	const toggle = page.getByRole('button', { name: '項目をたたむ: Parent', exact: true });
	await toggle.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('button', { name: '項目を開く: Parent', exact: true })).toHaveAttribute('aria-expanded', 'false');
	await postToWebview(page, { type: 'externalUpdate', changes: [{ from: 0, to: 0, insert: 'Added\n\n' }], version: 1 });
	await expect(page.locator('.mlp-heading-fold-placeholder')).toBeVisible();
	await expect(page.locator('.cm-line', { hasText: 'Next body' })).toBeVisible();
	await page.screenshot({ path: 'test-results/heading-fold-collapsed-360.png' });
	await page.locator('.mlp-heading-fold-placeholder').focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('.mlp-table')).toBeVisible();
	const metrics = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth }));
	expect(metrics.page).toBeLessThanOrEqual(metrics.width);
});

test('folding while a table cell is being edited preserves the edit', async ({ page }) => {
	await mountEditor(page, DOC);
	await page.locator('[data-mlp-row="1"][data-mlp-col="0"]').click();
	await page.keyboard.press('End');
	await page.keyboard.type(' changed');
	await page.getByRole('button', { name: 'Collapse section: Parent', exact: true }).click();
	await expect(page.locator('.mlp-table')).toHaveCount(0);
	await page.locator('.mlp-heading-fold-placeholder').click();
	await expect(page.locator('[data-mlp-row="1"][data-mlp-col="0"]')).toHaveText('A changed');
});

test('diagrams disappear and render again when their section is reopened', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n# Diagram\n\n```mermaid\ngraph TD;\n  A-->B;\n```\n\n# Next\n\nEnd\n');
	await expect(page.locator('.mlp-mermaid-canvas > svg')).toBeVisible({ timeout: 20_000 });
	await page.getByRole('button', { name: 'Collapse section: Diagram', exact: true }).click();
	await expect(page.locator('.mlp-mermaid-wrap')).toHaveCount(0);
	await page.locator('.mlp-heading-fold-placeholder').click();
	await expect(page.locator('.mlp-mermaid-canvas > svg')).toBeVisible({ timeout: 20_000 });
});
