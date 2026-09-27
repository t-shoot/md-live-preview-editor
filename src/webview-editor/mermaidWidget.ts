import { EditorView, WidgetType } from '@codemirror/view';
import { wrapBlockWidget } from './blockWidgetWrap';
import { loadMermaidModule, type MermaidApi } from './mermaidLoader';
import { createCodeModeButton } from './codeModeButton';
import { setBlockRevealed } from './cmUtils';
import { t } from '../shared/i18n';

// The module load is cached by `loadMermaidModule`, but `initialize()` is
// re-applied on every call (it's cheap) so a diagram rendered after the user
// switches VS Code's color theme picks up the new palette instead of being
// stuck with whatever theme was active the first time any diagram rendered in
// this webview.
async function loadMermaid(): Promise<MermaidApi> {
	const m = await loadMermaidModule();
	const isDark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
	m.initialize({
		startOnLoad: false,
		securityLevel: 'strict',
		theme: isDark ? 'dark' : 'default',
		// `useMaxWidth` is left disabled for every diagram type: it only controls
		// whether Mermaid itself writes an inline `max-width` style on the SVG, and
		// that inline style always wins over any CSS rule we'd add to scale it back
		// down. Scaling for "fit" display mode below is done entirely via our own
		// CSS class instead, so Mermaid's own shrink-to-fit logic is kept off in
		// both display modes and the inline style is stripped after render.
		flowchart: { useMaxWidth: false },
		sequence: { useMaxWidth: false },
		class: { useMaxWidth: false },
		state: { useMaxWidth: false },
		er: { useMaxWidth: false },
		gantt: { useMaxWidth: false },
		journey: { useMaxWidth: false },
		pie: { useMaxWidth: false },
	});
	return m;
}

let renderCounter = 0;

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const DRAG_THRESHOLD_PX = 4;

type DisplayMode = 'fit' | 'native';

export class MermaidWidget extends WidgetType {
	constructor(
		private readonly code: string,
		private readonly blockFrom: number,
	) {
		super();
	}

	eq(other: MermaidWidget): boolean {
		return other.code === this.code && other.blockFrom === this.blockFrom;
	}

	toDOM(view: EditorView): HTMLElement {
		// `wrap` is the widget's root: it hosts the toolbar as an overlay that
		// must stay pinned to the corner regardless of scrolling. `container` is
		// the pan/zoom/scroll viewport used in "native size" mode (native
		// horizontal scrollbar via `overflow-x: auto`, plus drag-to-pan and
		// Ctrl+wheel zoom); `canvas` is moved/scaled via a CSS transform inside
		// it. Keeping the toolbar outside `container` means scrolling `container`
		// can never carry the toolbar away with it.
		const wrap = document.createElement('div');
		wrap.className = 'mlp-mermaid-wrap';

		const container = document.createElement('div');
		container.className = 'mlp-mermaid';
		wrap.appendChild(container);

		const canvas = document.createElement('div');
		canvas.className = 'mlp-mermaid-canvas';
		canvas.textContent = 'Rendering diagram…';
		container.appendChild(canvas);

		// ── Display mode ─────────────────────────────────────────────────────────
		// "fit" (default): the diagram shrinks to the available width, like a
		// normal Markdown preview (GitHub, VS Code's built-in preview) — no pan,
		// no zoom, no scrollbar needed. "native": the diagram renders at its real
		// size with the drag-to-pan / Ctrl+wheel-zoom / horizontal-scrollbar
		// controls below, for diagrams too dense to read once shrunk.
		let mode: DisplayMode = 'fit';

		// ── Pan / zoom state (native mode only) ──────────────────────────────────
		let scale = 1;
		let tx = 0;
		let ty = 0;
		const applyTransform = () => {
			canvas.style.transform = mode === 'native' ? `translate(${tx}px, ${ty}px) scale(${scale})` : '';
		};

		// Zoom by `factor` while keeping the point (px, py) — measured from the
		// container's top-left — visually fixed under the cursor.
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
			tx = Math.max(0, (container.clientWidth - canvas.offsetWidth) / 2); // re-center horizontally
			applyTransform();
		};

		// ── Toolbar: mode toggle always shown; zoom controls only in native mode ──
		const toolbar = document.createElement('div');
		toolbar.className = 'mlp-mermaid-toolbar';
		const makeButton = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'mlp-mermaid-btn';
			btn.textContent = label;
			btn.title = title;
			// Stop the container's pan/click handlers from also firing.
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
		// Resets all the way out to "fit", not just to scale 1. `resetPanZoom`
		// alone leaves the diagram in native mode, where scale 1 means *full size*
		// — so from a zoomed-in view the button appeared to only half-work: the
		// diagram shrank a little and stopped, still larger than the view it
		// started from. What "back to the original size" means to someone looking
		// at the diagram is the fitted view they began with.
		const zoomResetBtn = makeButton('↺', t('zoom.reset'), () => setMode('fit'));
		const modeToggleBtn = makeButton('', '', () => setMode(mode === 'fit' ? 'native' : 'fit'));
		// Same control every rendered "図" block carries, so the way back to the
		// source is in the same place whatever the block is. Clicking the
		// rendered diagram itself never does this — see `endDrag` below — so
		// this button is the only route in.
		const codeModeBtn = createCodeModeButton(view, {
			anchor: wrap,
			onReveal: () => setBlockRevealed(this.blockFrom, true),
		});
		toolbar.append(codeModeBtn, modeToggleBtn, zoomInBtn, zoomOutBtn, zoomResetBtn);
		wrap.appendChild(toolbar);

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
			// The two modes have different heights ('native' adds a horizontal
			// scrollbar and caps at `max-height: 70vh`), and CodeMirror has no way
			// to notice a widget resizing itself — tell it to re-measure.
			view.requestMeasure();
		}
		setMode('fit');

		// ── Ctrl/Cmd + wheel to zoom (plain wheel keeps scrolling the document) ──
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

		// ── Drag to pan (native mode only); a click without dragging enters the
		// source for editing ──────────────────────────────────────────────────────
		let dragging = false;
		let moved = false;
		let startX = 0;
		let startY = 0;
		let originTx = 0;
		let originTy = 0;
		container.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			// Let the native horizontal scrollbar (`overflow-x: auto`, native mode
			// only) work normally: a press landing on the scrollbar track/thumb —
			// below the actual content box — has `container` itself as the target
			// (the scrollbar isn't a descendant element). Without this check, a
			// short scrollbar drag reads as a plain click and drops the cursor into
			// the diagram's source instead of just scrolling.
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
			// Decide click-vs-drag from the *total* displacement at release time,
			// not only from whether `pointermove` ever set `moved` — on some
			// input devices (e.g. certain touchpad drivers) intermediate
			// `pointermove` events can be dropped or never delivered to this
			// handler at all (for instance if pointer capture silently fails for
			// that pointer type), which left `moved` stuck at `false` even though
			// the pointer clearly travelled: the release was then misread as a
			// plain click and dropped the cursor into edit mode instead of
			// panning. Recomputing the displacement here catches that case
			// regardless of why the intermediate events were missed.
			if (mode === 'native' && !moved) {
				const dx = e.clientX - startX;
				const dy = e.clientY - startY;
				if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
					tx = originTx + dx;
					ty = originTy + dy;
					applyTransform();
					return;
				}
			}
			// A plain click deliberately does nothing. It used to drop the cursor into
			// the diagram's source, which meant every stray click — and every drag
			// whose displacement fell under the threshold — replaced the diagram with
			// raw text mid-gesture, exactly when the user was trying to pan or zoom
			// it. Reaching the source is the `</>` button's job now, so panning and
			// clicking can never be mistaken for each other.
		};
		container.addEventListener('pointerup', endDrag);
		container.addEventListener('pointercancel', endDrag);

		// ── Render the diagram ───────────────────────────────────────────────────
		const code = this.code;
		loadMermaid()
			.then(async (m) => {
				const id = `mlp-mermaid-${renderCounter++}`;
				const { svg } = await m.render(id, code);
				canvas.innerHTML = svg;
				// Defensive: some diagram types still emit an inline `max-width` style
				// even with `useMaxWidth: false` in the config above. An inline style
				// always wins over the stylesheet's `max-width: none`, so strip it
				// here to guarantee "native" mode renders at true native size; "fit"
				// mode's own CSS (`.mlp-mermaid-canvas svg`) handles shrinking instead.
				canvas.querySelector('svg')?.style.removeProperty('max-width');
				if (mode === 'native') resetPanZoom(); // center once real dimensions are known
				// Rendering is asynchronous: CodeMirror measured this widget while it
				// still held the one-line "Rendering diagram…" placeholder, and has no
				// way to observe the swap. Without this the height map keeps that
				// placeholder height for the finished diagram — a difference of
				// hundreds of pixels that throws off every position below it until
				// some unrelated measure pass happens to correct it.
				view.requestMeasure();
			})
			.catch((err: unknown) => {
				canvas.textContent = `Mermaid error: ${err instanceof Error ? err.message : String(err)}`;
				canvas.classList.add('mlp-mermaid-error');
				view.requestMeasure(); // the error text is a different height too
			});

		return wrapBlockWidget(wrap);
	}

	// Height CodeMirror should assume for a diagram it hasn't measured yet (a
	// block still below the viewport). The default guess is derived from the
	// replaced text, which for a fenced block is only a few lines tall — far off
	// for a diagram, and enough to make the scrollbar jump as such blocks scroll
	// into view. A mid-sized diagram is the better standing guess; the real
	// height replaces it as soon as the block is measured.
	get estimatedHeight(): number {
		return 240;
	}

	// Return true so CodeMirror leaves this widget's mouse/pointer/wheel events
	// alone — the pan/zoom handlers above own them, and a plain click is turned
	// into a cursor move explicitly in endDrag.
	ignoreEvent(): boolean {
		return true;
	}
}
