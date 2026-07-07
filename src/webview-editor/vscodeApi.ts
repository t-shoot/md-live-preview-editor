import type { EditorToHostMessage, HostToEditorMessage } from '../shared/messages';

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export function postToHost(message: EditorToHostMessage): void {
	api.postMessage(message);
}

export function onHostMessage(handler: (message: HostToEditorMessage) => void): void {
	window.addEventListener('message', (event: MessageEvent<HostToEditorMessage>) => {
		handler(event.data);
	});
}
