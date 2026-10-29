import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const TABLE = '| A | B | C |\n| --- | --- | --- |\n| one | two | three |';

test('one click switches to another cell after editing, in the correct table', async ({ page }) => {
	await mountEditor(page, TABLE + '\n\nBetween.\n\n' + TABLE + '\n\nAfter.\n');
	const table = page.locator('.mlp-table').nth(1);
	const first = table.locator('[data-mlp-row="1"][data-mlp-col="0"]');
	const next = table.locator('[data-mlp-row="1"][data-mlp-col="1"]');
	await first.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' edited');
	await next.click();
	await expect(next).toBeFocused();
	await expect(next).toHaveClass(/mlp-table-cell-editing/);
	await page.keyboard.press('End');
	await page.keyboard.type(' next');
	const last = table.locator('[data-mlp-row="1"][data-mlp-col="2"]');
	await last.click();
	await expect(last).toBeFocused();
	await page.keyboard.press('End');
	await page.keyboard.type(' last');
	await page.keyboard.press('Enter');
	await expect(first).toHaveText('one edited');
	await expect(next).toHaveText('two next');
	await expect(last).toHaveText('three last');
	await expect(page.locator('.mlp-table').first()).not.toContainText('edited');
});

test('clicking another cell after Tab selection is not mistaken for a drag', async ({ page }) => {
	await mountEditor(page, TABLE + '\n\nAfter.\n');
	await page.locator('[data-mlp-row="1"][data-mlp-col="0"]').click();
	await page.keyboard.press('Tab');
	await expect(page.locator('[data-mlp-row="1"][data-mlp-col="1"]')).toBeFocused();
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('two');
	const target = page.locator('[data-mlp-row="1"][data-mlp-col="2"]');
	await target.click();
	await expect(target).toBeFocused();
	await expect(target).toHaveClass(/mlp-table-cell-editing/);
});

for (const before of ['Before.\n\n', '']) {
	test(`Backspace below a table moves the caret above it${before ? '' : ' at the document start'}`, async ({ page }) => {
		const doc = before + TABLE + '\n\nAfter.\n';
		await mountEditor(page, doc);
		await page.locator('.cm-content').focus();
		await postToWebview(page, { type: 'setCursor', pos: doc.indexOf('\n\nAfter.') + 1 });
		await page.keyboard.press('Backspace');
		await expect(page.locator('.mlp-table')).toBeVisible();
		await expect(page.locator('.cm-cursor').first()).toBeVisible();
		const table = (await page.locator('.mlp-table').boundingBox())!;
		const cursor = (await page.locator('.cm-cursor').first().boundingBox())!;
		expect(cursor.y + cursor.height).toBeLessThanOrEqual(table.y);
		await page.keyboard.type('Typed above');
		await expect(page.locator('.cm-line', { hasText: 'Typed above' })).toBeVisible();
		await expect(page.locator('.mlp-table')).toContainText('three');
		await expect(page.locator('.mlp-table')).not.toContainText('Typed above');
		await expect(page.locator('.mlp-table')).not.toContainText('After.');
		await expect(page.locator('.cm-line', { hasText: 'After.' })).toBeVisible();
	});
}
