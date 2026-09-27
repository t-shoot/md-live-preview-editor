import type { EditorView } from '@codemirror/view';
import { blockRevealChanged } from './cmUtils';
import { t } from '../shared/i18n';

/**
 * The "show me the source" control shared by every rendered "図" block
 * (tables, Mermaid/draw.io diagrams, frontmatter).
 *
 * Each of these widgets replaces a run of Markdown with a rendered view, and
 * each needs an explicit way back to the text behind it — to fix a diagram's
 * syntax, to add a table row, to correct a YAML key. These blocks change
 * appearance too drastically for a click on the rendered form, or the caret
 * merely landing nearby, to safely mean "show source" — a table's click edits
 * a cell in place, and a diagram's click pans it — so reaching the source is
 * this button's job alone, for every "図" block alike (see `isBlockRevealed`
 * in cmUtils.ts). `onReveal`, when given, marks the block explicitly revealed;
 * omitted by the one caller that *isn't* a "図" block — the generic fenced
 * code block's own `</>`, which only jumps the caret onto its already-visible
 * fence line and needs no such flag.
 */
export interface CodeModeButtonOptions {
	/** Element the button is positioned against; also the fallback caret target. */
	anchor: HTMLElement;
	/**
	 * Where to put the caret. Defaults to the anchor's own document position,
	 * which is the start of the block.
	 */
	caretPos?: () => number;
	/** Runs before the caret moves — used by the table to save a pending edit. */
	beforeShow?: () => number | null;
	/**
	 * Marks this button's own "図" block as explicitly revealed. Omit for a
	 * plain fenced code block's fence-reveal button, which isn't one.
	 */
	onReveal?: () => void;
}

/** Builds the `</>` button. The caller decides where to place it. */
export function createCodeModeButton(view: EditorView, options: CodeModeButtonOptions): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'mlp-code-mode-btn';
	// Icon only: the glyph is set in the editor's monospace face by the stylesheet
	// so it reads as code, and what it does is spelled out for pointer users in
	// `title` and for assistive tech in `aria-label`.
	button.textContent = '</>';
	button.title = t('code.toggle.title');
	button.setAttribute('aria-label', t('code.toggle.aria'));

	// The press must not reach the block underneath. Without this, the block's own
	// click-to-source handler (or, for a table, the cell under the button) would
	// fire first and the button would never get its turn.
	button.addEventListener('mousedown', (event) => {
		event.preventDefault();
		event.stopPropagation();
	});
	button.addEventListener('pointerdown', (event) => event.stopPropagation());
	button.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		options.onReveal?.();
		const committed = options.beforeShow?.() ?? null;
		const pos = committed ?? options.caretPos?.() ?? view.posAtDOM(options.anchor);
		view.dispatch({
			selection: { anchor: Math.min(Math.max(pos, 0), view.state.doc.length) },
			effects: options.onReveal ? blockRevealChanged.of(null) : undefined,
			scrollIntoView: true,
		});
		view.focus();
	});
	return button;
}

// A squared-plus reads as a simple grid, the same idea as `▦` (crosshatch
// fill) without that glyph's problem: most monospace fonts draw its ink
// noticeably above center within its own em box, which put it visibly off
// vertical-center inside the button next to the `</>` control's own glyph,
// centered normally. `⊞` sits centered the same way `</>` does.
const RENDER_MODE_GLYPH = '⊞';

/**
 * Builds the "▦" button that switches a "図" block's raw Markdown view back
 * to its rendered form.
 *
 * Deliberately just chrome: `onClick` does the entire mode switch (clearing
 * the explicit-reveal flag, moving the caret to a safe spot outside the
 * block, dispatching `blockRevealChanged`) because each block type finds its
 * own current extent differently — a table by re-reading its `Table` node
 * (see `caretPastTable`), a diagram or frontmatter by re-scanning for theirs.
 */
export function createRenderModeButton(onClick: () => void): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'mlp-render-mode-btn';
	button.textContent = RENDER_MODE_GLYPH;
	button.title = t('render.toggle.title');
	button.setAttribute('aria-label', t('render.toggle.aria'));
	// Same reasoning as the `</>` button's own mousedown handler: the press must
	// not reach the raw text underneath, or CodeMirror would place its own caret
	// there first.
	button.addEventListener('mousedown', (event) => {
		event.preventDefault();
		event.stopPropagation();
	});
	button.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		onClick();
	});
	return button;
}

/**
 * Wraps `inner` in a positioned box carrying a code-mode button in its corner.
 *
 * Returns the box, for the caller to hand to `wrapBlockWidget`.
 */
export function withCodeModeButton(
	view: EditorView,
	inner: HTMLElement,
	options: CodeModeButtonOptions,
): HTMLElement {
	const host = document.createElement('div');
	host.className = 'mlp-code-mode-host';
	host.appendChild(inner);
	host.appendChild(createCodeModeButton(view, options));
	return host;
}

/**
 * "Copy this code block" button.
 *
 * A fenced code block is not a widget — it stays as real editor lines, with the
 * ``` fences merely hidden while the caret is elsewhere. Selecting it by hand
 * therefore drags in those hidden fence lines and whatever indentation the
 * block sits under, so what lands on the clipboard needs cleaning up by hand.
 * This copies exactly the block's content instead.
 *
 * `getCode` is read at click time, not at build time, so the button copies what
 * the block says now rather than what it said when the button was created.
 */
/** Two overlapping sheets — the usual "copy" mark, and a glyph, not an icon font. */
const COPY_GLYPH = '⧉';

export function createCopyCodeButton(getCode: () => string): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	// Same shape and treatment as the `</>` control, so the two read as one family
	// of block chrome: a short glyph in the editor's monospace face, not a word.
	button.className = 'mlp-copy-code-btn';
	button.textContent = COPY_GLYPH;
	button.title = t('code.copy.title');
	button.setAttribute('aria-label', t('code.copy.aria'));

	// The press must not reach the editor underneath, or CodeMirror moves the
	// caret into the block — which un-hides the fences and reflows the lines the
	// button is sitting on.
	button.addEventListener('mousedown', (event) => {
		event.preventDefault();
		event.stopPropagation();
	});
	button.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		const done = (ok: boolean) => {
			// Feedback has to be visible: the clipboard gives none of its own, and
			// without it a click looks like nothing happened.
			button.textContent = ok ? '✓' : '✕';
			button.classList.toggle('mlp-copy-code-btn-done', ok);
			button.classList.toggle('mlp-copy-code-btn-failed', !ok);
			setTimeout(() => {
				button.textContent = COPY_GLYPH;
				button.classList.remove('mlp-copy-code-btn-done', 'mlp-copy-code-btn-failed');
			}, 1200);
		};
		// `navigator.clipboard` is unavailable in some webview configurations, and
		// rejects when the document is not focused; neither should throw past here.
		try {
			const clipboard = navigator.clipboard;
			if (!clipboard?.writeText) {
				done(false);
				return;
			}
			clipboard.writeText(getCode()).then(
				() => done(true),
				() => done(false),
			);
		} catch {
			done(false);
		}
	});
	return button;
}
