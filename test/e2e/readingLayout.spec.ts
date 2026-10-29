import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

for (const width of [1920, 1200, 360]) {
	test(`reading column fits ${width}px and remains editable`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await mountEditor(page, '---\ntitle: Sample\n---\n\n# Markdown Live Preview\n\n本文の読みやすさを確認します。長い文章も画面の幅に合わせて折り返します。\n\n## 主な機能\n\n- 表を編集する\n- 差分を色分けする\n\n| 機能 | 状態 |\n| --- | --- |\n| 表の編集 | 確認する |\n| 差分の色分け | 表示する |\n\n```diff\n-old\n+new\n```\n\n最後の段落。\n');
		const metrics = await page.locator('.cm-content').evaluate((el) => {
			const style = getComputedStyle(el);
			const rect = el.getBoundingClientRect();
			return { width: rect.width, contentWidth: rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), left: rect.left, right: rect.right, font: style.fontFamily, size: parseFloat(style.fontSize), viewport: innerWidth, pageWidth: document.documentElement.scrollWidth };
		});
		expect(metrics.size).toBe(15);
		expect(metrics.font).toContain('Yu Gothic UI');
		expect(metrics.right).toBeLessThanOrEqual(metrics.viewport + 1);
		expect(metrics.left).toBeGreaterThanOrEqual(0);
		const gutter = Math.min(120, Math.max(16, width * 0.0625));
		expect(metrics.width - metrics.contentWidth).toBeCloseTo(2 * gutter, 0);
		if (width >= 1200) expect(metrics.width).toBeGreaterThan(width - 20);
		expect(Math.abs((metrics.left + metrics.right) / 2 - metrics.viewport / 2)).toBeLessThanOrEqual(10);
		expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewport);
		const cell = page.locator('[data-mlp-row="1"][data-mlp-col="0"]');
		const before = await cell.evaluate(el => ({
			size: getComputedStyle(el).fontSize,
			padding: getComputedStyle(el).paddingTop,
			height: el.getBoundingClientRect().height,
		}));
		expect(before.size).toBe('14px');
		expect(before.padding).toBe('5px');
		await cell.click();
		expect(await cell.evaluate(el => getComputedStyle(el).fontSize)).toBe(before.size);
		expect((await cell.boundingBox())!.height).toBeCloseTo(before.height, 0);
		await page.keyboard.press('Escape');
		await page.locator('.cm-line', { hasText: '最後の段落。' }).click();
		await page.keyboard.press('End');
		await page.keyboard.type('編集');
		await expect(page.locator('.cm-line', { hasText: '最後の段落。編集' })).toBeVisible();
		await page.screenshot({ path: `test-results/reading-layout-${width}.png` });
	});
}
