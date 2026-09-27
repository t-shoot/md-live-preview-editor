import { EditorView, WidgetType } from '@codemirror/view';
import { wrapBlockWidget } from './blockWidgetWrap';
import { createCodeModeButton } from './codeModeButton';
import { setBlockRevealed } from './cmUtils';
import {
	renderParsedDiagram,
	parseDrawioPages,
	usesAwsShapes,
	ensureAwsShapes,
	DrawioUnsupportedError,
} from './drawioRender';
import { readDrawioFile } from './drawioFileClient';
import type { DrawioDiagram } from '../shared/drawio';
import { t } from '../shared/i18n';

/**
 * Block widget for a rendered draw.io diagram.
 *
 * Deliberately shares the Mermaid widget's interaction model — fit/native
 * display modes, drag-to-pan, Ctrl+wheel zoom, and the same `</>` route back to
 * the source — because both are "a fenced block that became a picture", and a
 * diagram behaving differently depending on which tool drew it would be a
 * needless thing to learn. The CSS classes are shared with Mermaid for the same
 * reason (see media/webview-editor-theme.css).
 *
 * What is specific here is the page switcher: a `.drawio` file holds one
 * `<diagram>` per page, and a file with several would otherwise show only its
 * first with no hint the others exist.
 *
 * Rendering is synchronous — the parser is our own code with no dependency to
 * fetch, unlike Mermaid's 2.5MB bundle — so there is no loading placeholder and
 * no post-render `requestMeasure` for the swap.
 */

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const DRAG_THRESHOLD_PX = 4;

type DisplayMode = 'fit' | 'native';

export class DrawioWidget extends WidgetType {
	constructor(
		private readonly code: string,
		private readonly blockFrom: number,
	) {
		super();
	}

	eq(other: DrawioWidget): boolean {
		return other.code === this.code && other.blockFrom === this.blockFrom;
	}

	toDOM(view: EditorView): HTMLElement {
		// Same three-part structure as the Mermaid widget: `wrap` is the
		// positioning root that keeps the toolbar pinned while `container`
		// scrolls, and `canvas` is what gets transformed for pan/zoom.
		const wrap = document.createElement('div');
		wrap.className = 'mlp-mermaid-wrap mlp-drawio-wrap';

		const container = document.createElement('div');
		container.className = 'mlp-mermaid';
		wrap.appendChild(container);

		const canvas = document.createElement('div');
		canvas.className = 'mlp-mermaid-canvas';
		container.appendChild(canvas);

		let mode: DisplayMode = 'fit';
		let scale = 1;
		let tx = 0;
		let ty = 0;
		const applyTransform = () => {
			canvas.style.transform = mode === 'native' ? `translate(${tx}px, ${ty}px) scale(${scale})` : '';
		};

		const zoomAt = (factor: number, px: number, py: number) => {
			const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
			if (next === scale) return;
			const k = next / scale;
			tx = px - (px - tx) * k;
			ty = py - (py - ty) * k;
			scale = next;
			applyTransform();
		};
		const zoomCenter = (factor: number) => zoomAt(factor, container.clientWidth / 2, container.clientHeight / 2);
		const resetPanZoom = () => {
			scale = 1;
			ty = 0;
			tx = Math.max(0, (container.clientWidth - canvas.offsetWidth) / 2);
			applyTransform();
		};

		const toolbar = document.createElement('div');
		toolbar.className = 'mlp-mermaid-toolbar';
		const makeButton = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'mlp-mermaid-btn';
			btn.textContent = label;
			btn.title = title;
			btn.addEventListener('pointerdown', (e) => e.stopPropagation());
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				onClick();
			});
			return btn;
		};

		const zoomInBtn = makeButton('+', t('zoom.in'), () => zoomCenter(1.2));
		const zoomOutBtn = makeButton('−', t('zoom.out'), () => zoomCenter(1 / 1.2));
		const zoomResetBtn = makeButton('↺', t('zoom.reset'), () => setMode('fit'));
		const modeToggleBtn = makeButton('', '', () => setMode(mode === 'fit' ? 'native' : 'fit'));
		const codeModeBtn = createCodeModeButton(view, {
			anchor: wrap,
			onReveal: () => setBlockRevealed(this.blockFrom, true),
		});

		// ── Page switcher, shown only for a file that actually has pages to switch
		// between ────────────────────────────────────────────────────────────────
		let diagram: DrawioDiagram | null = null;
		let pageIndex = 0;
		const pageLabel = document.createElement('span');
		pageLabel.className = 'mlp-drawio-page-label';
		const prevPageBtn = makeButton('‹', t('page.prev'), () => showPage(pageIndex - 1));
		const nextPageBtn = makeButton('›', t('page.next'), () => showPage(pageIndex + 1));

		toolbar.append(codeModeBtn, prevPageBtn, pageLabel, nextPageBtn, modeToggleBtn, zoomInBtn, zoomOutBtn, zoomResetBtn);
		wrap.appendChild(toolbar);

		const showError = (message: string) => {
			canvas.textContent = message;
			canvas.classList.add('mlp-mermaid-error');
			view.requestMeasure();
		};

		function updatePageControls(): void {
			const count = diagram?.pages.length ?? 0;
			const multi = count > 1;
			prevPageBtn.style.display = multi ? '' : 'none';
			nextPageBtn.style.display = multi ? '' : 'none';
			pageLabel.style.display = multi ? '' : 'none';
			if (multi) {
				const name = diagram?.pages[pageIndex]?.name ?? '';
				pageLabel.textContent = `${pageIndex + 1}/${count}`;
				pageLabel.title = name;
			}
		}

		function showPage(next: number): void {
			if (!diagram) return;
			const count = diagram.pages.length;
			// Wrap around rather than clamping: with only a prev/next pair, clamping
			// leaves the last page a dead end that needs several clicks to escape.
			pageIndex = ((next % count) + count) % count;
			canvas.innerHTML = renderParsedDiagram(diagram, pageIndex);
			updatePageControls();
			if (mode === 'native') resetPanZoom();
			// A different page is almost never the same height as the one it
			// replaced, and CodeMirror cannot observe an innerHTML swap.
			view.requestMeasure();
		}

		function setMode(next: DisplayMode): void {
			mode = next;
			container.classList.toggle('mlp-mermaid-native', mode === 'native');
			zoomInBtn.style.display = mode === 'native' ? '' : 'none';
			zoomOutBtn.style.display = mode === 'native' ? '' : 'none';
			zoomResetBtn.style.display = mode === 'native' ? '' : 'none';
			modeToggleBtn.textContent = mode === 'fit' ? '⤢' : '⤡';
			modeToggleBtn.title = mode === 'fit' ? t('zoom.toActual') : t('zoom.toFit');
			if (mode === 'native') resetPanZoom();
			else applyTransform();
			view.requestMeasure();
		}

		container.addEventListener(
			'wheel',
			(e) => {
				if (mode !== 'native' || !(e.ctrlKey || e.metaKey)) return;
				e.preventDefault();
				const rect = container.getBoundingClientRect();
				zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
			},
			{ passive: false },
		);

		let dragging = false;
		let moved = false;
		let startX = 0;
		let startY = 0;
		let originTx = 0;
		let originTy = 0;
		container.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			// A press on the native scrollbar (native mode only) targets `container`
			// itself, outside its content box — let it scroll rather than treating
			// the gesture as a pan.
			if (e.target === container && (e.offsetX >= container.clientWidth || e.offsetY >= container.clientHeight)) {
				return;
			}
			dragging = true;
			moved = false;
			startX = e.clientX;
			startY = e.clientY;
			originTx = tx;
			originTy = ty;
			container.setPointerCapture(e.pointerId);
		});
		container.addEventListener('pointermove', (e) => {
			if (!dragging || mode !== 'native') return;
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
				moved = true;
				container.classList.add('mlp-mermaid-grabbing');
			}
			if (moved) {
				tx = originTx + dx;
				ty = originTy + dy;
				applyTransform();
			}
		});
		const endDrag = (e: PointerEvent) => {
			if (!dragging) return;
			dragging = false;
			container.classList.remove('mlp-mermaid-grabbing');
			try {
				container.releasePointerCapture(e.pointerId);
			} catch {
				/* pointer already released */
			}
			// Recompute the displacement at release: some input devices drop the
			// intermediate `pointermove` events, leaving `moved` false even though
			// the pointer clearly travelled — which would silently discard the pan.
			if (mode === 'native' && !moved) {
				const dx = e.clientX - startX;
				const dy = e.clientY - startY;
				if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
					tx = originTx + dx;
					ty = originTy + dy;
					applyTransform();
				}
			}
			// A plain click deliberately does nothing; `</>` is the route to source,
			// so panning can never be mistaken for a request to edit.
		};
		container.addEventListener('pointerup', endDrag);
		container.addEventListener('pointercancel', endDrag);

		setMode('fit');

		// ── Render ───────────────────────────────────────────────────────────────
		try {
			diagram = parseDrawioPages(this.code);
			canvas.innerHTML = renderParsedDiagram(diagram, 0);
			updatePageControls();
			// AWS symbols live in a multi-megabyte table fetched on demand, so the
			// first render draws plain coloured tiles. Redraw once it arrives —
			// only for a diagram that actually uses them, and only if this widget
			// is still on screen by then.
			if (usesAwsShapes(diagram)) {
				ensureAwsShapes(() => {
					if (!wrap.isConnected || !diagram) return;
					canvas.innerHTML = renderParsedDiagram(diagram, pageIndex);
					if (mode === 'native') resetPanZoom();
					view.requestMeasure();
				});
			}
		} catch (err) {
			// A compressed file is a supported-input problem with a concrete fix, so
			// its own message is surfaced verbatim rather than folded into a generic
			// parse failure the user can do nothing about.
			const message =
				err instanceof DrawioUnsupportedError
					? err.message
					: t('drawio.loadFailed', err instanceof Error ? err.message : String(err));
			showError(message);
			updatePageControls();
		}

		return wrapBlockWidget(wrap);
	}

	// Same standing guess as the Mermaid widget: a fenced block's own text height
	// is far too small for a diagram, and using it makes the scrollbar jump as
	// such blocks scroll into view.
	get estimatedHeight(): number {
		return 240;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

/**
 * Block widget for a diagram held in a separate `.drawio` file, referenced from
 * the document as `![alt](diagram.drawio)`.
 *
 * The rendering is identical to a fenced diagram's — this only differs in where
 * the XML comes from. The file is read asynchronously through the host (the
 * webview has no filesystem access), so unlike the fence widget this one shows a
 * placeholder first and re-measures once the content arrives.
 *
 * Implemented by delegating to `DrawioWidget.toDOM` rather than duplicating the
 * pan/zoom/toolbar wiring: the two must not drift apart, and there is nothing
 * about a file-backed diagram that should behave differently once it is drawn.
 */
export class DrawioFileWidget extends WidgetType {
	constructor(
		private readonly src: string,
		private readonly alt: string,
		private readonly blockFrom: number,
	) {
		super();
	}

	eq(other: DrawioFileWidget): boolean {
		return other.src === this.src && other.alt === this.alt && other.blockFrom === this.blockFrom;
	}

	toDOM(view: EditorView): HTMLElement {
		const host = document.createElement('div');
		host.className = 'mlp-block';

		const placeholder = document.createElement('div');
		placeholder.className = 'mlp-mermaid-wrap mlp-drawio-wrap';
		const canvas = document.createElement('div');
		canvas.className = 'mlp-mermaid-canvas';
		canvas.textContent = t('drawio.loading', this.src);
		placeholder.appendChild(canvas);
		host.appendChild(placeholder);

		readDrawioFile(this.src)
			.then((xml) => {
				if (!host.isConnected) return; // the widget was replaced while reading
				// `DrawioWidget.toDOM` returns an already-wrapped block; this widget's
				// own host is that wrapper, so swap in the wrapper's child to avoid
				// nesting two `.mlp-block` boxes and doubling the vertical padding.
				const rendered = new DrawioWidget(xml, this.blockFrom).toDOM(view);
				host.replaceChildren(...Array.from(rendered.childNodes));
				// The file arrived after CodeMirror measured the placeholder, and it
				// cannot observe the swap — without this the height map keeps the
				// one-line placeholder height for a full diagram.
				view.requestMeasure();
			})
			.catch((err: unknown) => {
				if (!host.isConnected) return;
				canvas.textContent = err instanceof Error ? err.message : String(err);
				canvas.classList.add('mlp-mermaid-error');
				view.requestMeasure();
			});

		return host;
	}

	get estimatedHeight(): number {
		return 240;
	}

	ignoreEvent(): boolean {
		return true;
	}
}
