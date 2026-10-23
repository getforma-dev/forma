export type N8Row = {
  id: 'N8'; template: string; formaBytes: number; baselineBytes: number; addedBytes: number;
  formaStartMs: number[]; baselineStartMs: number[]; formaStartMedianMs: number; baselineStartMedianMs: number; addedStartMs: number;
  limits: { addedBytes: number; addedStartMs: number }; sizeOk: boolean; startOk: boolean; passed: boolean;
};
export const N8_MAX_ADDED_BYTES: number;
export const N8_MAX_ADDED_START_MS: number;
export const N8_TEMPLATES: string[];
export function n8Name(template: string): string;
export function buildBaseline(options: { dir: string; lockFile: string; targetDir?: string; env?: Record<string, string> }): string;
export function measureTemplate(options: { template: string; binary: string; cwd: string; baselineBinary: string; runs?: number; warmup?: number }): Promise<N8Row>;
export function describeN8(row: N8Row): string;
export function assertN8(row: N8Row): N8Row;
export function requireN8Observations(observations: Array<Record<string, unknown>>, platform: string, templates?: string[]): N8Row[];
export function summarizeN8(report: { platform?: string; observations?: Array<Record<string, unknown>> }): string;
