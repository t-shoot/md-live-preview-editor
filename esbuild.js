const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** @type {import('esbuild').Plugin} */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',
	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				}
			});
			console.log('[watch] build finished');
		});
	},
};

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
	entryPoints: ['src/extension.ts'],
	bundle: true,
	outfile: 'dist/extension.js',
	platform: 'node',
	target: 'node18',
	format: 'cjs',
	external: ['vscode'],
	sourcemap: !production,
	minify: production,
	logLevel: 'silent',
	plugins: [esbuildProblemMatcherPlugin],
};

/** @type {import('esbuild').BuildOptions} */
const webviewEditorConfig = {
	entryPoints: ['src/webview-editor/main.ts'],
	bundle: true,
	outfile: 'dist/webview-editor.js',
	platform: 'browser',
	format: 'iife',
	target: 'es2022',
	sourcemap: !production,
	minify: production,
	logLevel: 'silent',
	plugins: [esbuildProblemMatcherPlugin],
};

/** @type {import('esbuild').BuildOptions} */
const webviewSidebarConfig = {
	entryPoints: ['src/webview-sidebar/main.ts'],
	bundle: true,
	outfile: 'dist/webview-sidebar.js',
	platform: 'browser',
	format: 'iife',
	target: 'es2022',
	sourcemap: !production,
	minify: production,
	logLevel: 'silent',
	plugins: [esbuildProblemMatcherPlugin],
};

/** @type {import('esbuild').BuildOptions} */
const webviewPreviewConfig = {
	entryPoints: ['src/webview-preview/main.ts'],
	bundle: true,
	outfile: 'dist/webview-preview.js',
	platform: 'browser',
	format: 'iife',
	target: 'es2022',
	sourcemap: !production,
	minify: production,
	logLevel: 'silent',
	plugins: [esbuildProblemMatcherPlugin],
};

async function main() {
	const configs = [extensionConfig, webviewEditorConfig, webviewSidebarConfig, webviewPreviewConfig];

	if (watch) {
		const contexts = await Promise.all(configs.map((cfg) => esbuild.context(cfg)));
		await Promise.all(contexts.map((ctx) => ctx.watch()));
	} else {
		await Promise.all(configs.map((cfg) => esbuild.build(cfg)));
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
