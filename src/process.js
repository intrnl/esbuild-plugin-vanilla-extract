import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import hash from '@emotion/hash';
import { transformCss } from '@vanilla-extract/css/transformCss';
import * as esbuild from 'esbuild';
import evalCode from 'eval';
import { stringify } from 'javascript-stringify';

export const RE_CSS_FILTER = /\.css\.(js|mjs|jsx|ts|mts|tsx)$/i;

/** @type {esbuild.Plugin} */
export const fileScopePlugin = {
	name: 'vanilla-extract-filescope',
	setup (build) {
		const cwd = build.initialOptions.absWorkingDir;

		build.onLoad({ filter: RE_CSS_FILTER }, async (args) => {
			const { path: filename } = args;

			const source = await fs.readFile(filename, 'utf-8');

			let pathname = path.relative(cwd, filename);

			if (process.platform === 'win32') {
				pathname = path.posix.join(...pathname.split(path.sep));
			}

			const code = `
				import { setFileScope, endFileScope } from "@vanilla-extract/css/fileScope";
				setFileScope(${JSON.stringify(pathname)});
				${source}
				endFileScope();
			`;

			return {
				loader: (/\.(ts|mts|tsx)$/i).test(filename) ? 'tsx' : 'jsx',
				contents: code,
			};
		});
	},
};

const KEY = 'c' + ('' + Math.random()).slice(2, 8);

export async function compileVanillaFile (options) {
	const { filename, cwd = process.cwd(), esbuildOptions = {} } = options;

	const result = await esbuild.build({
		bundle: true,
		write: false,
		metafile: true,
		format: 'cjs',
		platform: 'node',
		entryPoints: [filename],
		absWorkingDir: cwd,
		external: ['@vanilla-extract', ...(esbuildOptions.external || [])],
		plugins: [
			fileScopePlugin,
			...(esbuildOptions.plugins || []),
		],
		loader: esbuildOptions.loader,
		define: esbuildOptions.define,
	});

	const { outputFiles, metafile } = result;

	return {
		source: outputFiles[0].text,
		dependencies: Object.keys(metafile.inputs).map((pathname) => path.join(cwd, pathname)).reverse(),
	};
}

export function evaluateVanillaFile (options) {
	const { filename, source, outputCss = true, identOption = 'debug' } = options;

	const banner = `
(() => {
	const cssByFileScope = new Map();
	const localClassNames = new Set();
	const composedClassLists = [];
	const usedCompositions = new Set();

	const cssAdapter = {
		appendCss (css, fileScope) {${
		outputCss
			? `
			const filename = fileScope.filePath;
			const sources = cssByFileScope.get(filename) ?? [];

			sources.push(css);

			cssByFileScope.set(filename, sources);`
			: ''
	}
		},
		registerClassName (className) {
			localClassNames.add(className);
		},
		registerComposition (composedClassList) {
			composedClassLists.push(composedClassList);
		},
		markCompositionUsed (identifier) {
			usedCompositions.add(identifier);
		},
		onEndFileScope () {},
		getIdentOption () {
			return ${JSON.stringify(identOption)};
		},
	};

	globalThis.${KEY} = { cssByFileScope, localClassNames, composedClassLists, usedCompositions };
	require('@vanilla-extract/css/adapter').setAdapter(cssAdapter);
})();
`;

	const footer = `
(() => {
	require('@vanilla-extract/css/adapter').removeAdapter?.();
	module.exports = { ...globalThis.${KEY}, cssExports: module.exports };
})();
`;

	const globals = {
		console,
		process,
	};

	const sourcery = banner + source + footer;
	const result = evalCode(sourcery, filename, globals, true);

	return result;
}

export function processVanillaFile (options) {
	const { filename, cwd = process.cwd(), data, serializeImport } = options;
	const { cssByFileScope, localClassNames, composedClassLists, usedCompositions, cssExports } = data;

	const unusedCompositions = composedClassLists
		.filter(({ identifier }) => !usedCompositions.has(identifier))
		.map(({ identifier }) => identifier);

	const unusedCompositionRegex = unusedCompositions.length > 0
		? RegExp(`(${unusedCompositions.join('|')})\\s`, 'g')
		: null;

	const cssImports = [];
	let css = '';

	for (const [relname, sources] of cssByFileScope) {
		const pathname = path.join(cwd, relname);
		const isEntry = pathname === filename;

		if (isEntry) {
			css = transformCss({
				localClassNames: Array.from(localClassNames),
				composedClassLists: composedClassLists,
				cssObjs: sources,
			}).join('\n');
		}

		const imports = serializeImport(pathname, isEntry);
		cssImports.push(imports);
	}

	const js = serializeVanillaModule(cssImports, cssExports, unusedCompositionRegex);

	return { js, css };
}

function serializeVanillaModule (cssImports, cssExports, unusedRegex) {
	const recipeImports = new Set();

	const moduleExports = Object.keys(cssExports).map((key) => (
		key === 'default'
			? `export ${key} ${stringifyExports(recipeImports, cssExports[key], unusedRegex)};`
			: `export const ${key} = ${stringifyExports(recipeImports, cssExports[key], unusedRegex)};`
	));

	const outputCode = [...cssImports, ...recipeImports, ...moduleExports];

	return outputCode.join('\n');
}

function stringifyExports (recipeImports, value, unusedCompositionRegex) {
	const options = {
		references: true,
		maxDepth: Infinity,
		maxValues: Infinity,
	};

	return stringify(
		value,
		(value, _indent, next) => {
			const valueType = typeof value;

			if (
				valueType === 'boolean'
				|| valueType === 'number'
				|| valueType === 'undefined'
				|| value === null
				|| Array.isArray(value)
				|| isPlainObject(value)
			) {
				return next(value);
			}

			if (valueType === 'string') {
				const replacement = unusedCompositionRegex
					? value.replace(unusedCompositionRegex, '')
					: value;

				return next(replacement);
			}

			if (valueType === 'function' && (value.__function_serializer__ || value.__recipe__)) {
				const { importPath, importName, args } = value.__function_serializer__ || value.__recipe__;

				if (typeof importPath !== 'string' || typeof importName !== 'string' || !Array.isArray(args)) {
					throw new Error('Invalid recipe');
				}

				try {
					const hashedImportName = `_${hash(`${importName}${importPath}`).slice(0, 5)}`;
					recipeImports.add(`import { ${importName} as ${hashedImportName} } from ${JSON.stringify(importPath)};`);

					const stringifiedArgs = args
						.map((arg) => stringifyExports(recipeImports, arg, unusedCompositionRegex))
						.join(', ');

					return `${hashedImportName}(${stringifiedArgs})`;
				}
				catch (err) {
					console.error(err);
					throw new Error('Invalid recipe.');
				}
			}

			throw new Error('Invalid exports');
		},
		0,
		options,
	);
}

function isPlainObject (o) {
	if (!hasObjectPrototype(o)) {
		return false;
	}

	const ctor = o.constructor;
	if (typeof ctor === 'undefined') {
		return true;
	}

	const prot = ctor.prototype;
	if (!hasObjectPrototype(prot)) {
		return false;
	}

	if (!prot.hasOwnProperty('isPrototypeOf')) {
		return false;
	}

	return true;
}

function hasObjectPrototype (o) {
	return Object.prototype.toString.call(o) === '[object Object]';
}
