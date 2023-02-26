import { BuildOptions, Plugin } from 'esbuild';

export default function vanillaExtractPlugin (options?: PluginOptions): Plugin;

export interface PluginOptions {
	cache?: boolean;
	outputCss?: boolean;
	esbuildOptions?: Pick<BuildOptions, 'plugins' | 'external' | 'define' | 'loader'>;
	runtime?: boolean;
	unsafe?: boolean;
	processCss?: (css: string) => Promise<string>;
	identifiers?: 'short' | 'debug';
}
