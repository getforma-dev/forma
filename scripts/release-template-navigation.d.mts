import type { Browser } from '@playwright/test';
type NavigationManifest = { routes: Record<string, { mode: string; js: string[]; navigation?: { group: string; owner: string; outlet: string | null } }> };
export function verifyNativeRouterTemplate(browser: Browser, origin: string, manifest: NavigationManifest, options?: {timeout?: number}): Promise<Record<string, unknown>>;
