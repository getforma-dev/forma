export const TIMING_ID: 'TIMING';
export type TimingRow = {
  name: string; id: 'TIMING'; kind: string; label?: string; phases: Record<string, number>;
  budgets?: Record<string, number>; ok: boolean; [detail: string]: unknown;
};
export function appendDiagnostics<E>(error: E, text: string): E extends Error ? E : Error;
export function tail(text: string, limit?: number): string;
export function formatMs(ms: number): string;
export function describeScaffoldDir(dir: string): string;
export function processSnapshot(options?: { parentPid?: number; limit?: number; platform?: string; run?: unknown }): string;
export function timingRow(kind: string, fields: { label?: string; phases: Record<string, number>; budgets?: Record<string, number>; ok?: boolean; [detail: string]: unknown }): TimingRow;
export function summarizeTimings(observations?: Array<Record<string, unknown>>, platform?: string): string;
