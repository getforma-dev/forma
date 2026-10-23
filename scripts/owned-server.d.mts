type Options = { env?: Record<string, string>; timeout?: number };
export type OwnedServerTimings = { pid: number | undefined; listeningMs: number | null; readyMs: number | null; elapsedMs: number; exited: boolean; code: number | null; exitedMs: number | null };
type Visit<T> = (response: Response, origin: string, output: () => string, timings: () => OwnedServerTimings) => T | Promise<T>;
export function withOwnedServer<T>(command: string, args: string[], cwd: string, visit: Visit<T>, options?: Options & { refusal?: false }): Promise<T>;
export function withOwnedServer(command: string, args: string[], cwd: string, visit: Visit<never>, options: Options & { refusal: true }): Promise<{code: number | null; output: string; accepted: boolean}>;
