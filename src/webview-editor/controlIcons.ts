/** Original 16px vector drawings. Shared geometry avoids font-dependent
 * baseline shifts in the editor's compact controls. */
const PATHS = {
	code: '<path d="M4.75 4.5 2.7 7.3q-.7.7 0 1.4l2.05 2.8m6.5-7 2.05 2.8q.7.7 0 1.4l-2.05 2.8M9 3 7 13"/>',
	render: '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M8 2.5v11M2.5 8h11"/>',
	copy: '<path d="M3.5 10.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1"/><rect x="5.5" y="5.5" width="8" height="8" rx="1.4"/>',
	expand: '<path d="M9.5 2.5h4v4m0-4-4.5 4.5M6.5 13.5h-4v-4m0 4L7 9"/>',
	collapse: '<path d="M13.5 2.5 9 7m.5-4.5v4h4M2.5 13.5 7 9m-4.5.5h4v4"/>',
	plus: '<path d="M8 3v10M3 8h10"/>',
	minus: '<path d="M3 8h10"/>',
	reset: '<path d="M3.5 5.5a5 5 0 1 1-.3 4M2.5 2.5v4h4"/>',
	previous: '<path d="m10 3-5 5 5 5"/>',
	next: '<path d="m6 3 5 5-5 5"/>',
	headingFold: '<path d="m4 3 8 5-8 5"/>',
} as const;

export type ControlIcon = keyof typeof PATHS;

export function setControlIcon(button: HTMLButtonElement, icon: ControlIcon): void {
	// Only the constant drawings above enter this markup; document text never does.
	button.innerHTML = `<svg class="mlp-control-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[icon]}</svg>`;
}
