import * as esbuild from 'esbuild';
import * as path from 'path';

import {
	compile,
	processVanillaFile,
	vanillaExtractFilescopePlugin
} from '@vanilla-extract/integration';

import { FSCache, getProjectRoot } from '@intrnl/fs-cache';


const RE_CSS_FILTER = /\.css\.(js|mjs|jsx|ts|mts|tsx)$/i;
const RE_VIRT_FILTER = /\?__css$/;
const NS = 'vanilla-extract';

const VERSION = 1;

/** @returns {esbuild.Plugin} */
export default function vanillaExtractPlugin (options = {}) {
	const {
		cache = true,
		runtime,
		processCss,
		outputCss,
		identifiers,
		externals = [],
	} = options;

	if (runtime) {
		return vanillaExtractFilescopePlugin();
	}

	return {
		name: '@intrnl/esbuild-plugin-vanilla-extract',
		async setup (build) {
			const cssCache = new Map();

			const cwd = build.initialOptions.absWorkingDir;
			const identOption = identifiers ?? (build.initialOptions.minify ? 'short' : 'debug');

			const fsCache = cache && new FSCache({
				...await getProjectRoot('@intrnl/esbuild-plugin-vanilla-extract'),
			});

			build.onLoad({ filter: RE_CSS_FILTER }, async (args) => {
				const { path: filename, namespace } = args;

				if (namespace !== 'file' && namespace !== '') {
					return null;
				}

				const key = [
					VERSION,
					outputCss,
					identOption,
					externals,
				];

				const result = cache
					? await fsCache.get(filename, key, () => loader(filename))
					: await loader(filename);

				cssCache.set(path.relative('.', filename), result.css);

				return {
					loader: 'js',
					contents: result.js,
					watchFiles: result.dependencies,
				};
			});

			build.onResolve({ filter: RE_VIRT_FILTER }, (args) => {
				const { path: file, importer } = args;

				const dirname = path.relative('.', path.dirname(importer));
				const filename = path.join(dirname, file.slice(0, -6));

				if (!cssCache.has(filename)) {
					return null;
				}

				return {
					namespace: NS,
					path: filename,
				};
			});

			build.onLoad({ filter: /./, namespace: NS }, async (args) => {
				const { path: filename } = args;

				let source = cssCache.get(filename);

				if (typeof processCss === 'function') {
					source = await processCss(source, filename);
				}

				return {
					loader: 'css',
					contents: source,
				};
			});

			async function loader (filePath) {
				const dirname = path.dirname(filePath);

				const { source, watchFiles } = await compile({
					filePath: filePath,
					cwd,
					externals,
				});

				let css = '';

				const js = await processVanillaFile({
					filePath: filePath,
					source,
					outputCss,
					identOption,
					serializeVirtualCssPath: ({ fileScope, source }) => {
						// Even though this also generates the corresponding CSS files for
						// dependencies, we're ignoring them and opt for importing its
						// original JS file instead.

						// We can't expect its dependencies to already exist in the cache
						// map, but we also don't want to fit the dependencies into another
						// file's cache data.

						const filename = path.resolve(fileScope.filePath);

						if (filePath === filename) {
							css = source;
							return `import ${JSON.stringify(basename(filename) + '?__css')};`;
						}
						else {
							return `import ${JSON.stringify(relative(dirname, filename))};`;
						}
					},
				});

				return {
					js,
					css,
					dependencies: watchFiles.reverse(),
				};
			}
		},
	};
}

function basename (pathname, ext) {
	return './' + path.basename(pathname, ext);
}

function relative (from, to) {
	let pathname = path.relative(from, to);

	if (pathname.slice(0, 3) !== '../') {
		pathname = './' + pathname;
	}

	return pathname;
}
