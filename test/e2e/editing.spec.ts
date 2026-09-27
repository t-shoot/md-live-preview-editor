import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

const DOC = '# Heading\n\nBefore ![alt](assets/pic.png) after.\n\nPlain paragraph.\n';

test.describe('live preview editing', () => {
	test.beforeEach(async ({ page }) => {
		await mountEditor(page, DOC);
	});

	test('the caret is drawn in the theme color, not black', async ({ page }) => {
		await page.locator('.cm-content').click();
		const color = await page.locator('.cm-cursor').first().evaluate(
			(el) => getComputedStyle(el).borderLeftColor,
		);
		// The library default is a hardcoded black, invisible on a dark theme.
		expect(color).not.toBe('rgb(0, 0, 0)');
		expect(color).toBe('rgb(174, 175, 173)'); // --vscode-editorCursor-foreground
	});

	test('an image renders in place of its markup', async ({ page }) => {
		await expect(page.locator('img.mlp-image')).toHaveCount(1);
		await expect(page.locator('.cm-content')).not.toContainText('assets/pic.png');
	});

	test('clicking an image reveals the markup behind it', async ({ page }) => {
		// The reported bug: a widget ignores events by default, so the click placed
		// no caret and the `![alt](url)` could never be reached by mouse.
		await page.locator('img.mlp-image').click();
		await expect(page.locator('.cm-content')).toContainText('assets/pic.png');
	});

	test('the markup hides again once the caret leaves', async ({ page }) => {
		await page.locator('img.mlp-image').click();
		await expect(page.locator('.cm-content')).toContainText('assets/pic.png');
		// Click a line well away from the image.
		await page.locator('.cm-line').last().click();
		await expect(page.locator('img.mlp-image')).toHaveCount(1);
	});

	test('a heading hides its hash once the caret leaves the line', async ({ page }) => {
		// A fresh document starts with the caret at position 0, i.e. on the
		// heading, so it legitimately shows its source until the caret moves.
		const first = page.locator('.cm-line').first();
		await expect(first).toContainText('#');
		await page.locator('.cm-line').last().click();
		await expect(page.locator('.cm-line').first()).not.toContainText('#');
	});

	test('a heading shows its hash again when the caret returns', async ({ page }) => {
		await page.locator('.cm-line').last().click();
		const first = page.locator('.cm-line').first();
		await expect(first).not.toContainText('#');
		await first.click();
		await expect(page.locator('.cm-line').first()).toContainText('#');
	});
});

test.describe('inline code sharing a line with unrelated text', () => {
	// Regression: `CodeMark` also names a fenced code block's own ``` fence,
	// where "caret on this line" is correctly "caret on the fence" (nothing
	// else lives there) — but the same line-level check applied to an inline
	// `` `code` `` span too, so editing the far end of an unrelated sentence
	// revealed its backticks just because both sat on the same line.
	const DOC = 'Before `**` and `#` after, plus a longer tail to click into.\n';

	test('a caret elsewhere on the line does not reveal either span', async ({ page }) => {
		await mountEditor(page, DOC);
		await page.locator('.cm-line').first().click();
		await page.keyboard.press('End');
		await expect(page.locator('.mlp-inline-code')).toHaveCount(2);
		await expect(page.locator('.cm-content')).not.toContainText('`**`');
		await expect(page.locator('.cm-content')).not.toContainText('`#`');
	});

	test('a caret inside one span reveals only that span', async ({ page }) => {
		await mountEditor(page, DOC);
		await page.locator('.mlp-inline-code').first().click();
		await expect(page.locator('.cm-content')).toContainText('`**`');
		await expect(page.locator('.cm-content')).not.toContainText('`#`');
	});
});

test.describe('leaving a table cell', () => {
	// Regression: committing an unchanged cell skipped placing the document
	// caret anywhere, so it stayed wherever `beginEditing` had parked it —
	// inside the table's own block-replaced range. Escape and Enter used to
	// call `view.focus()` right after committing, which asked CodeMirror to
	// show a real caret at that position; one with no coordinates inside a
	// widget rendered as a stray caret past the table's own right edge.
	//
	// Fixed by no longer focusing the document at all once a cell edit ends —
	// requested follow-up: a caret reappearing anywhere else read as "editing
	// resumed somewhere", which wasn't asked for. Table navigation (Tab past
	// the last cell, clicking elsewhere) already left the document unfocused
	// the same way.
	const DOC = [
		'| 名前 | 状態 |',
		'| --- | --- |',
		'| Alice | OK |',
		'',
		'After the table.',
		'',
	].join('\n');

	test('Escape leaves no cursor visible anywhere', async ({ page }) => {
		await mountEditor(page, DOC);
		await page.locator('.cm-line').filter({ hasText: 'After the table' }).click();

		const cell = page.locator('[data-mlp-row="1"][data-mlp-col="0"]'); // "Alice"
		await cell.click();
		await expect(cell).toHaveClass(/mlp-table-cell-editing/);
		await page.keyboard.press('Escape');
		await expect(cell).not.toHaveClass(/mlp-table-cell-editing/);

		await expect(page.locator('.cm-cursor')).not.toBeVisible();
		await expect(page.locator('.mlp-table')).toHaveCount(1); // stays rendered, not raw pipes

		// The document isn't focused, so a stray keystroke must not land in it.
		await page.keyboard.type('ZZZ');
		await expect(page.locator('.cm-content')).not.toContainText('ZZZ');
	});

	test('Enter leaves no cursor visible anywhere', async ({ page }) => {
		await mountEditor(page, DOC);
		await page.locator('.cm-line').filter({ hasText: 'After the table' }).click();

		const cell = page.locator('[data-mlp-row="1"][data-mlp-col="0"]'); // "Alice"
		await cell.click();
		await expect(cell).toHaveClass(/mlp-table-cell-editing/);
		await page.keyboard.press('Enter');
		await expect(cell).not.toHaveClass(/mlp-table-cell-editing/);

		await expect(page.locator('.cm-cursor')).not.toBeVisible();
	});
});

test.describe('moving between table cells', () => {
	// Regression guard: a table used to flip to raw pipe text mid Tab-navigation
	// (any keydown, Tab included, cleared a one-shot mouse-gesture guard before
	// the next cell's own caret-parking dispatch ran). Fixed at the root by
	// making a table — like every "図" block — never consult the caret at all;
	// only its own `</>`/"back" buttons can switch it (see `isBlockRevealed` in
	// cmUtils.ts). Kept as a regression test since nothing else here would catch
	// a future change that reintroduces caret-based reveal for tables.
	const DOC = [
		'| 名前 | 備考 | 状態 |',
		'| --- | --- | --- |',
		'| Alice |  | OK |',
		'|  | 保留 | NG |',
		'| Bob | 完了 |  |',
		'',
		'After the table.',
		'',
	].join('\n');

	test('Tab across several unchanged cells never flashes raw pipes', async ({ page }) => {
		await mountEditor(page, DOC);
		await page.locator('.cm-line').filter({ hasText: 'After the table' }).click();

		const first = page.locator('[data-mlp-row="1"][data-mlp-col="0"]');
		await first.click();
		await expect(first).toHaveClass(/mlp-table-cell-editing/);
		for (let i = 0; i < 8; i++) {
			await page.keyboard.press('Tab');
			await expect(page.locator('.mlp-table-cell-editing')).toHaveCount(1);
			await expect(page.locator('.mlp-table')).toHaveCount(1);
			await expect(page.locator('.mlp-table-raw')).toHaveCount(0);
		}
	});

	test('Shift+Tab backwards also stays rendered', async ({ page }) => {
		await mountEditor(page, DOC);
		await page.locator('.cm-line').filter({ hasText: 'After the table' }).click();

		const cell = page.locator('[data-mlp-row="2"][data-mlp-col="1"]'); // 保留
		await cell.click();
		await expect(cell).toHaveClass(/mlp-table-cell-editing/);
		for (let i = 0; i < 4; i++) {
			await page.keyboard.press('Shift+Tab');
			await expect(page.locator('.mlp-table-cell-editing')).toHaveCount(1);
			await expect(page.locator('.mlp-table')).toHaveCount(1);
			await expect(page.locator('.mlp-table-raw')).toHaveCount(0);
		}
	});

	test('an edit still commits correctly while tabbing through', async ({ page }) => {
		await mountEditor(page, DOC);
		await page.locator('.cm-line').filter({ hasText: 'After the table' }).click();

		const first = page.locator('[data-mlp-row="1"][data-mlp-col="0"]');
		await first.click();
		await page.keyboard.type('X');
		await page.keyboard.press('Tab');
		await expect(page.locator('[data-mlp-row="1"][data-mlp-col="0"]')).toHaveText('AliceX');
		await expect(page.locator('.mlp-table')).toHaveCount(1);
	});
});

test.describe('clicking a different table cell while one is being edited', () => {
	// Regression: `stopPropagation` on the table's mousedown keeps CodeMirror
	// from treating the press as a document click, but it does not cancel the
	// browser's own default action for a mousedown that moves focus. With the
	// old cell (contentEditable) about to lose focus and the newly clicked cell
	// not contentEditable yet, the browser's default landed that focus on
	// `.cm-content` instead — at whatever raw-text position the click's
	// coordinates happened to map to — for the press's duration, then vanished
	// once `mouseup` ran `beginEditing` and refocused the new cell. It read as
	// the caret flashing somewhere in the document on every cell-to-cell click.
	const DOC = ['| 名前 | 状態 |', '| --- | --- |', '| Alice | OK |', '| Bob | NG |', '', 'After.', ''].join('\n');

	test('shows no stray focus on .cm-content', async ({ page }) => {
		await mountEditor(page, DOC);
		await page.locator('.cm-line').filter({ hasText: 'After' }).click();

		await page.evaluate(() => {
			(window as unknown as { __sawStray: boolean }).__sawStray = false;
			document.addEventListener(
				'focusin',
				(e) => {
					if ((e.target as HTMLElement).classList?.contains('cm-content')) {
						(window as unknown as { __sawStray: boolean }).__sawStray = true;
					}
				},
				true,
			);
		});

		const cellA = page.locator('[data-mlp-row="1"][data-mlp-col="0"]'); // Alice
		const cellB = page.locator('[data-mlp-row="2"][data-mlp-col="0"]'); // Bob
		await cellA.click();
		await expect(cellA).toHaveClass(/mlp-table-cell-editing/);

		// The initial click into the table from a normal document line
		// legitimately focuses .cm-content first — reset right before the click
		// actually under test.
		await page.evaluate(() => ((window as unknown as { __sawStray: boolean }).__sawStray = false));
		await cellB.click();
		await expect(cellB).toHaveClass(/mlp-table-cell-editing/);
		await expect(cellA).not.toHaveClass(/mlp-table-cell-editing/);

		expect(await page.evaluate(() => (window as unknown as { __sawStray: boolean }).__sawStray)).toBe(false);
	});

	test('re-clicking the cell already being edited still works normally', async ({ page }) => {
		await mountEditor(page, DOC);
		await page.locator('.cm-line').filter({ hasText: 'After' }).click();

		const cellA = page.locator('[data-mlp-row="1"][data-mlp-col="0"]');
		await cellA.click();
		await expect(cellA).toHaveClass(/mlp-table-cell-editing/);
		await cellA.click({ position: { x: 5, y: 5 } });
		await expect(cellA).toHaveClass(/mlp-table-cell-editing/);
	});

	test('dragging across rendered cells to select text still works when nothing is being edited', async ({ page }) => {
		await mountEditor(page, DOC);
		await page.locator('.cm-line').filter({ hasText: 'After' }).click();

		const cellA = page.locator('[data-mlp-row="1"][data-mlp-col="0"]'); // Alice
		const cellB = page.locator('[data-mlp-row="1"][data-mlp-col="1"]'); // OK
		const boxA = await cellA.boundingBox();
		const boxB = await cellB.boundingBox();
		if (!boxA || !boxB) throw new Error('cells not found');

		await page.mouse.move(boxA.x + 5, boxA.y + boxA.height / 2);
		await page.mouse.down();
		await page.mouse.move(boxB.x + boxB.width - 5, boxB.y + boxB.height / 2, { steps: 5 });
		await page.mouse.up();

		await expect(page.locator('.mlp-table-cell-editing')).toHaveCount(0);
		const selectionText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selectionText.length).toBeGreaterThan(0);
	});
});

test.describe('viewing a table as raw Markdown', () => {
	// A rendered table's cells are edited in place, so its own `</>` button (see
	// TableWidget) is the only way to reach the raw pipe syntax at all — but
	// once there, there was no way *back* except moving the caret off the
	// table's lines by hand. `TableRenderButtonWidget` adds an explicit control
	// for that, styled with the same tinted-box treatment a fenced code block
	// gets, so raw form reads as "this is source" rather than "this table
	// broke".
	const DOC = ['| 名前 | 状態 |', '| --- | --- |', '| Alice | OK |', '', 'After the table.', ''].join('\n');

	test('the </> button reveals raw form, styled and with a way back', async ({ page }) => {
		await mountEditor(page, DOC);
		await page.locator('.cm-line').filter({ hasText: 'After the table' }).click();
		await expect(page.locator('.mlp-table')).toHaveCount(1);

		await page.locator('.mlp-code-mode-btn').click();
		await expect(page.locator('.mlp-table')).toHaveCount(0);
		await expect(page.locator('.mlp-line-table-raw')).toHaveCount(3); // header, delimiter, 1 row
		await expect(page.locator('.mlp-render-mode-btn')).toHaveCount(1);

		await page.locator('.mlp-render-mode-btn').click();
		await expect(page.locator('.mlp-table')).toHaveCount(1);
		await expect(page.locator('.mlp-line-table-raw')).toHaveCount(0);
	});

	test('the render button works even when the table is the last thing in the document', async ({ page }) => {
		// No trailing line after the table, so `caretPastTable` has nowhere to
		// land — the button must make its own landing spot rather than doing
		// nothing.
		const docNoTrailer = ['| 名前 | 状態 |', '| --- | --- |', '| Alice | OK |'].join('\n');
		await mountEditor(page, docNoTrailer);
		await expect(page.locator('.mlp-table')).toHaveCount(1); // starts rendered; nothing has revealed it yet
		await page.locator('.mlp-code-mode-btn').click();
		await expect(page.locator('.mlp-line-table-raw')).toHaveCount(3);
		await page.locator('.mlp-render-mode-btn').click();
		await expect(page.locator('.mlp-table')).toHaveCount(1);
	});
});
