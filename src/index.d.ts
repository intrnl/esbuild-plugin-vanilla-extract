import { Plugin } from 'esbuild';
import { IdentifierOption } from '@vanilla-extract/integration';


export default function vanillaExtractPlugin (options?: PluginOptions): Plugin;

export interface PluginOptions {
	cache?: boolean;
  outputCss?: boolean;
  externals?: Array<string>;
  runtime?: boolean;
  processCss?: (css: string) => Promise<string>;
  identifiers?: IdentifierOption;
}
