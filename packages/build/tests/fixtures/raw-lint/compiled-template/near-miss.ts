import { __createCompiledTemplate as other } from './application-owned';
export const ordinary = other('a name in a different package');
export const record = { __createCompiledTemplate: 'a property' };
export function unrelated(engine: { __createCompiledTemplate(value: string): unknown }) {
  return engine.__createCompiledTemplate('unrelated receiver');
}
