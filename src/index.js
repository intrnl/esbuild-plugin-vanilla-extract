import * as path from 'node:path';

import { FSCache, getProjectRoot } from '@intrnl/fs-cache';
import * as esbuild from 'esbuild';
import {
	compileVanillaFile,
	evaluateVanillaFile,
	fileScopePlugin,
	processVanillaFile,
	RE_CSS_FILTER,
} from './process.js';

const SUFFIX = '?css';

const VERSION = 3;

/** @returns {esbuild.Plugin} */
export default function vanillaExtractPlugin (options = {}) {
	const {
		cache = true,
		runtime,
		processCss,
		outputCss = true,
		identifiers,
		esbuildOptions,
	} = options;

	if (runtime) {
		return fileScopePlugin;
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
				const { path: filename, namespace, suffix } = args;

				if (suffix === SUFFIX) {
					const source = cssCache.get(path.relative('.', filename));

					if (!source) {
						return null;
					}

					if (typeof processCss === 'function') {
						source = await processCss(source, filename);
					}

					return {
						loader: 'css',
						contents: source,
					};
				}

				if (namespace !== 'file' && namespace !== '') {
					return null;
				}

				const key = [
					VERSION,
					outputCss,
					identOption,
					esbuildOptions,
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

			async function loader (filename) {
				const dirname = path.dirname(filename);

				const { source, dependencies } = await compileVanillaFile({
					filename,
					cwd,
					esbuildOptions,
					outputCss,
					identOption,
				});

				const data = evaluateVanillaFile({ filename, source });

				const { js, css } = processVanillaFile({
					filename,
					cwd,
					data,
					serializeImport: (pathname, isEntry) => {
						if (isEntry) {
							return `import ${JSON.stringify(basename(pathname) + SUFFIX)};`;
						}
						else {
							return `import ${JSON.stringify(relative(dirname, pathname))};`;
						}
					},
				});

				return {
					js: js,
					css: css,
					dependencies: dependencies,
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
