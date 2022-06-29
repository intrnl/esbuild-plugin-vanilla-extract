import { style } from '@vanilla-extract/css';

import { foo } from './foo.css.js';


export const bar = style([foo, {
	backgroundColor: 'red',
}], 'bar');
