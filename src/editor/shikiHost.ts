import * as vscode from 'vscode';
import { createHighlighterCore, type HighlighterCore } from '@shikijs/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import darkPlus from '@shikijs/themes/dark-plus';
import lightPlus from '@shikijs/themes/light-plus';
import githubDark from '@shikijs/themes/github-dark';
import githubLight from '@shikijs/themes/github-light';
import bash from '@shikijs/langs/bash';
import c from '@shikijs/langs/c';
import cpp from '@shikijs/langs/cpp';
import csharp from '@shikijs/langs/csharp';
import css from '@shikijs/langs/css';
import go from '@shikijs/langs/go';
import html from '@shikijs/langs/html';
import java from '@shikijs/langs/java';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import jsx from '@shikijs/langs/jsx';
import kotlin from '@shikijs/langs/kotlin';
import markdown from '@shikijs/langs/markdown';
import php from '@shikijs/langs/php';
import python from '@shikijs/langs/python';
import ruby from '@shikijs/langs/ruby';
import rust from '@shikijs/langs/rust';
import shellscript from '@shikijs/langs/shellscript';
import sql from '@shikijs/langs/sql';
import swift from '@shikijs/langs/swift';
import tsx from '@shikijs/langs/tsx';
import typescript from '@shikijs/langs/typescript';
import yaml from '@shikijs/langs/yaml';
import type { CodeBlockTokens } from '../shared/messages';

// VS Code's own built-in default themes (Dark+ / Light+), so highlighted code
// matches the colors of the editor next to it out of the box.
const DEFAULT_LIGHT_THEME = 'light-plus';
const DEFAULT_DARK_THEME = 'dark-plus';

// Statically-imported curated set so esbuild only bundles these grammars,
// instead of shiki's full ~200-language registry. Fenced code in a language
// outside this list renders without color (a documented MVP limitation).
const CURATED_LANGS = [
	bash, c, cpp, csharp, css, go, html, java, javascript, json, jsx, kotlin,
	markdown, php, python, ruby, rust, shellscript, sql, swift, tsx, typescript, yaml,
];
const LANG_ALIASES: Record<string, string> = { sh: 'shellscript', shell: 'shellscript', js: 'javascript', ts: 'typescript', 'c++': 'cpp', 'c#': 'csharp', yml: 'yaml', md: 'markdown' };

interface FenceBlock {
	from: number;
	to: number;
	contentStartLine: number;
	contentEndLine: number;
	lang: string;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
let supportedLangs: Set<string> | null = null;

async function getHighlighter(): Promise<HighlighterCore> {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighterCore({
			themes: [darkPlus, lightPlus, githubDark, githubLight],
			langs: CURATED_LANGS,
			engine: createJavaScriptRegexEngine(),
		});
	}
	return highlighterPromise;
}

function normalizeLang(lang: string): string {
	const lower = lang.trim().toLowerCase();
	return LANG_ALIASES[lower] ?? lower;
}

export function pickCodeTheme(): string {
	const configured = vscode.workspace.getConfiguration('mdLivePreview').get<string>('codeTheme', 'auto');
	if (configured && configured !== 'auto') {
		return configured;
	}
	const kind = vscode.window.activeColorTheme.kind;
	const isLight = kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
	return isLight ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
}

function findFences(document: vscode.TextDocument): FenceBlock[] {
	const blocks: FenceBlock[] = [];
	let open: { line: number; marker: string; lang: string } | null = null;

	for (let i = 0; i < document.lineCount; i++) {
		const lineText = document.lineAt(i).text;
		const trimmed = lineText.trimStart();
		const fenceMatch = /^(`{3,}|~{3,})\s*([\w#+.-]*)\s*$/.exec(trimmed);

		if (!open) {
			if (fenceMatch) {
				open = { line: i, marker: fenceMatch[1][0].repeat(fenceMatch[1].length), lang: fenceMatch[2] };
			}
			continue;
		}

		const closeMatch = /^(`{3,}|~{3,})\s*$/.exec(trimmed);
		if (closeMatch && closeMatch[1][0] === open.marker[0] && closeMatch[1].length >= open.marker.length) {
			const from = document.offsetAt(new vscode.Position(open.line, 0));
			const to = document.offsetAt(new vscode.Position(i, lineText.length));
			if (i > open.line + 1) {
				blocks.push({
					from,
					to,
					contentStartLine: open.line + 1,
					contentEndLine: i - 1,
					lang: normalizeLang(open.lang),
				});
			}
			open = null;
		}
	}

	return blocks;
}

export async function tokenizeDocument(document: vscode.TextDocument): Promise<CodeBlockTokens[]> {
	const fences = findFences(document);
	if (fences.length === 0) {
		return [];
	}

	const highlighter = await getHighlighter();
	if (!supportedLangs) {
		supportedLangs = new Set(highlighter.getLoadedLanguages());
	}
	const theme = pickCodeTheme();
	const results: CodeBlockTokens[] = [];

	for (const fence of fences) {
		if (!fence.lang || !supportedLangs.has(fence.lang)) {
			continue;
		}

		const lines: string[] = [];
		for (let li = fence.contentStartLine; li <= fence.contentEndLine; li++) {
			lines.push(document.lineAt(li).text);
		}
		const code = lines.join('\n');

		let tokenLines;
		try {
			tokenLines = highlighter.codeToTokensBase(code, { lang: fence.lang, theme });
		} catch {
			continue;
		}

		const tokens: CodeBlockTokens['tokens'] = [];
		for (let li = 0; li < tokenLines.length; li++) {
			let col = 0;
			for (const token of tokenLines[li]) {
				if (token.content.length > 0) {
					const startPos = new vscode.Position(fence.contentStartLine + li, col);
					const endPos = new vscode.Position(fence.contentStartLine + li, col + token.content.length);
					const styleParts = [`color:${token.color ?? '#999999'}`];
					const fontStyle = token.fontStyle ?? 0;
					if (fontStyle & 1) styleParts.push('font-style:italic');
					if (fontStyle & 2) styleParts.push('font-weight:bold');
					if (fontStyle & 4) styleParts.push('text-decoration:underline');
					tokens.push({
						from: document.offsetAt(startPos),
						to: document.offsetAt(endPos),
						style: styleParts.join(';'),
					});
				}
				col += token.content.length;
			}
		}

		results.push({ from: fence.from, to: fence.to, tokens });
	}

	return results;
}
