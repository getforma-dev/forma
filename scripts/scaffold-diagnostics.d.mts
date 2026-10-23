export const TIMING_ID: 'TIMING';
export const SNAPSHOT_TIMEOUT_MS: number;
export type TimingRow = {
  name: string; id: 'TIMING'; kind: string; label?: string; phases: Record<string, number>;
  budgets?: Record<string, number>; ok: boolean; [detail: string]: unknown;
};
/** `error` itself when it took the text or `text` is empty; otherwise a new Error (from a non-Error, or wrapping a frozen error as its `cause`). */
export function appendDiagnostics<E>(error: E, text: string): E | Error;
export function tail(text: string, limit?: number): string;
export function formatMs(ms: number): string;
export function describeScaffoldDir(dir: string): string;
export function processSnapshot(options?: { parentPid?: number; limit?: number; platform?: string; timeout?: number; run?: unknown }): string;
export function timingRow(kind: string, fields: { label?: string; phases: Record<string, number>; budgets?: Record<string, number>; ok?: boolean; [detail: string]: unknown }): TimingRow;
export function summarizeTimings(observations?: Array<Record<string, unknown>>, platform?: string): string;
