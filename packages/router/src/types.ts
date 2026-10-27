export type Accessor<T> = () => T;
export interface RouteDefinition {
  readonly id: string;
  readonly path?: string;
  readonly index?: true;
  readonly children?: readonly RouteDefinition[];
  readonly adapter?: RouteAdapter;
  readonly render?: (context: RenderContext) => Element;
  readonly reuseKey?: (context: Match) => string;
}
export interface Match {
  readonly id: string;
  readonly params: Readonly<Record<string, string>>;
  readonly definition: RouteDefinition;
}
export interface LocationState {
  readonly url: URL;
  readonly key: string;
  readonly matches: readonly { readonly id: string; readonly params: Readonly<Record<string, string>> }[];
}
export interface RenderContext {
  /** Destination snapshot for one-time route initialization. */
  readonly url: URL;
  readonly location: Accessor<LocationState>;
  readonly params: Readonly<Record<string, string>>;
  readonly outlet: HTMLElement;
  /** Aborts if preparation is cancelled or this owner is released; retained owners stay live. */
  readonly signal: AbortSignal;
}
export interface NavigationContext {
  readonly url: URL;
  readonly matches: readonly Match[];
  readonly signal: AbortSignal;
  readonly revalidate: boolean;
  readonly location: Accessor<LocationState>;
}
export interface PreparedView {
  readonly title?: string;
  readonly status?: number;
  validate(): void;
  commit(): void;
  activate(): Promise<void>;
  dispose(): void;
}
export interface Redirect { readonly redirect: string }
export interface ActionOutcome {
  readonly outcome: 'success' | 'validation' | 'error' | 'redirect';
  readonly status: number;
  readonly data: Readonly<Record<string, unknown>>;
}
export interface AdapterSession {
  initialize?(context: NavigationContext): Promise<void>;
  prepare(context: NavigationContext): Promise<PreparedView | Redirect>;
  allowsAction?(url: URL): boolean;
  admitAction?(data: unknown, response: Response, url: URL): ActionOutcome;
  invalidate?(): void;
  dispose(): void;
}
export interface RouteAdapter {
  readonly kind: 'browser' | 'html' | 'native';
  connect(root: HTMLElement): AdapterSession;
}
export interface RouterOptions {
  readonly routes: readonly RouteDefinition[];
  readonly root: HTMLElement;
  readonly adapter: RouteAdapter;
  readonly base?: string;
  readonly statusRegion?: HTMLElement;
  readonly title?: (location: LocationState) => string;
  readonly onError?: (code: string) => void;
  readonly onAction?: (outcome: ActionOutcome, form: HTMLFormElement) => void;
  readonly checkContext?: (signal: AbortSignal) => Promise<boolean>;
  readonly contextChannel?: string;
  /** Public, build-specific recovery namespace. Never put a user identifier here. */
  readonly recoveryKey?: string;
  /** Explicit server/application attestation that this GET is safe to speculate. */
  readonly canPrefetch?: (url: URL) => boolean;
}
export type NavigationResult =
  | { kind: 'committed'; location: LocationState; ready: Promise<void> }
  | { kind: 'cancelled'; reason: 'superseded' | 'unchanged' | 'disposed' }
  | { kind: 'blocked' }
  | { kind: 'document-navigation'; reason: string }
  | { kind: 'failed'; code: string };
export type SubmissionResult =
  | { kind: 'success' }
  | { kind: 'validation' | 'error'; status: number; data: Readonly<Record<string, unknown>> }
  | { kind: 'busy' | 'unsupported' | 'uncertain' | 'disposed' };
export interface Router {
  readonly location: Accessor<LocationState>;
  readonly pending: Accessor<URL | undefined>;
  readonly mutation: Accessor<'idle' | 'submitting' | 'revalidating' | 'uncertain'>;
  readonly ready: Promise<void>;
  navigate(to: string | URL, options?: { replace?: boolean }): Promise<NavigationResult>;
  revalidate(): Promise<NavigationResult>;
  prefetch(to: string | URL): Promise<'completed' | 'skipped' | 'cancelled'>;
  submit(form: HTMLFormElement, submitter?: HTMLElement): Promise<SubmissionResult>;
  beforeLeave(check: (next: URL, signal: AbortSignal) => boolean | Promise<boolean>): () => void;
  invalidateContext(): void;
  /** Clear the unknown-outcome latch only after application status/idempotency evidence. */
  resolveUncertain(check: (signal: AbortSignal) => Promise<boolean>): Promise<boolean>;
  dispose(): void;
}
export class NavigationError extends Error {
  constructor(readonly code: string, readonly documentRecovery = false, readonly revoke = false) { super(code); this.name = 'NavigationError'; }
}
