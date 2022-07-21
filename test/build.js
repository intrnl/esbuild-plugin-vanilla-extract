import * as esbuild from 'esbuild';

import vanillaExtractPlugin from '../src/index.js';


await esbuild.build({
	bundle: true,
	format: 'esm',
	entryPoints: ['./index.js'],
	outfile: './_app.js',
	plugins: [
		vanillaExtractPlugin({ cache: false }),
	],
});
