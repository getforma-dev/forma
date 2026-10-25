import { __createCompiledTemplate as make } from '@getforma/core/compiled';
import * as compiled from '@getforma/core/compiled';

declare const markup: () => unknown;
export const row = make(markup, []); // expect: __createCompiledTemplate
export const another = compiled['__createCompiledTemplate'](markup, []); // expect: __createCompiledTemplate
export { __createCompiledTemplate as factory } from '@getforma/core/compiled'; // expect: __createCompiledTemplate
export { make as localFactory }; // expect: __createCompiledTemplate
const { __createCompiledTemplate: cjs } = require('@getforma/core/compiled');
export const required = cjs(markup, []); // expect: __createCompiledTemplate
export const forwarded = make; // expect: __createCompiledTemplate
