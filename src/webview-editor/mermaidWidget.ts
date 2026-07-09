import { EditorView, WidgetType } from '@codemirror/view';

let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null;

// The module import is cached, but `initialize()` is re-applied on every call
// (it's cheap) so a diagram rendered after the user switches VS Code's color
// theme picks up the new palette instead of being stuck with whatever theme
// was active the first time any diagram rendered in this webview.
async function loadMermaid(): Promise<typeof import('mermaid')> {
	if (!mermaidModulePromise) {
		mermaidModulePromise = import('mermaid');
	}
	const m = await mermaidModulePromise;
	const isDark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
	m.default.initialize({
		startOnLoad: false,
		securityLevel: 'strict',
		theme: isDark ? 'dark' : 'default',
		// Render at native size instead of shrinking to fit the editor's content
		// width — the widget below provides its own pan/zoom for large diagrams.
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

export class MermaidWidget extends WidgetType {
	constructor(private readonly code: string) {
		super();
	}

	eq(other: MermaidWidget): boolean {
		return other.code === this.code;
	}

	toDOM(view: EditorView): HTMLElement {
		// `wrap` is the widget's root: it hosts the toolbar as an overlay that
		// must stay pinned to the corner regardless of scrolling. `container` is
		// the actual pan/zoom/scroll viewport (native horizontal scrollbar via
		// `overflow-x: auto`, plus drag-to-pan and Ctrl+wheel zoom); `canvas` is
		// moved/scaled via a CSS transform inside it. Keeping the toolbar outside
		// `container` means scrolling `container` can never carry the toolbar
		// away with it.
		const wrap = document.createElement('div');
		wrap.className = 'mlp-mermaid-wrap';

		const container = document.createElement('div');
		container.className = 'mlp-mermaid';
		wrap.appendChild(container);

		const canvas = document.createElement('div');
		canvas.className = 'mlp-mermaid-canvas';
		canvas.textContent = 'Rendering diagram…';
		container.appendChild(canvas);

		// ── Pan / zoom state ────────────────────────────────────────────────────
		let scale = 1;
		let tx = 0;
		let ty = 0;
		const applyTransform = () => {
			canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
		};
		applyTransform();

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
		const reset = () => {
			scale = 1;
			ty = 0;
			tx = Math.max(0, (container.clientWidth - canvas.offsetWidth) / 2); // re-center horizontally
			applyTransform();
		};

		// ── Toolbar (＋ / − / reset), shown on hover ─────────────────────────────
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
		toolbar.appendChild(makeButton('+', '拡大 (Ctrl+ホイールでも可)', () => zoomCenter(1.2)));
		toolbar.appendChild(makeButton('−', '縮小', () => zoomCenter(1 / 1.2)));
		toolbar.appendChild(makeButton('↺', '元のサイズに戻す', reset));
		wrap.appendChild(toolbar);

		// ── Ctrl/Cmd + wheel to zoom (plain wheel keeps scrolling the document) ──
		container.addEventListener(
			'wheel',
			(e) => {
				if (!(e.ctrlKey || e.metaKey)) return;
				e.preventDefault();
				const rect = container.getBoundingClientRect();
				zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
			},
			{ passive: false },
		);

		// ── Drag to pan; a click without dragging enters the source for editing ──
		let dragging = false;
		let moved = false;
		let startX = 0;
		let startY = 0;
		let originTx = 0;
		let originTy = 0;
		container.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			// Let the native horizontal scrollbar (`overflow-x: auto`) work
			// normally: a press landing on the scrollbar track/thumb — below the
			// actual content box — has `container` itself as the target (the
			// scrollbar isn't a descendant element). Without this check, a short
			// scrollbar drag reads as a plain click and drops the cursor into the
			// diagram's source instead of just scrolling.
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
			if (!dragging) return;
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
			if (!moved) {
				// A plain click: drop the cursor into the diagram's source so it can
				// be edited (the block reverts to raw text while the cursor is on it).
				const pos = view.posAtDOM(wrap);
				view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
				view.focus();
			}
		};
		container.addEventListener('pointerup', endDrag);
		container.addEventListener('pointercancel', endDrag);

		// ── Render the diagram ───────────────────────────────────────────────────
		const code = this.code;
		loadMermaid()
			.then(async (m) => {
				const id = `mlp-mermaid-${renderCounter++}`;
				const { svg } = await m.default.render(id, code);
				canvas.innerHTML = svg;
				// Defensive: some diagram types still emit an inline `max-width` style
				// even with `useMaxWidth: false` in the config above. An inline style
				// always wins over the stylesheet's `max-width: none`, so strip it
				// here to guarantee the diagram renders at its native size.
				canvas.querySelector('svg')?.style.removeProperty('max-width');
				reset(); // center once real dimensions are known
			})
			.catch((err: unknown) => {
				canvas.textContent = `Mermaid error: ${err instanceof Error ? err.message : String(err)}`;
				canvas.classList.add('mlp-mermaid-error');
			});

		return wrap;
	}

	// Return true so CodeMirror leaves this widget's mouse/pointer/wheel events
	// alone — the pan/zoom handlers above own them, and a plain click is turned
	// into a cursor move explicitly in endDrag.
	ignoreEvent(): boolean {
		return true;
	}
}
