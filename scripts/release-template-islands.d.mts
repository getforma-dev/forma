import type { Browser } from '@playwright/test';
type TemplateManifest = { routes: Record<string, { mode: string; js: string[]; css: string[]; ir?: string; modulepreload?: string[] }> };
export function verifyMinimalIsland(browser: Browser, origin: string, manifest: TemplateManifest, expectedCount?: number, options?: { timeout?: number }): Promise<Record<string, unknown>>;
export function verifyStaticTemplate(browser: Browser, origin: string, manifest: TemplateManifest, route?: string, options?: { staticHtml?: 'plain-v1' | 'legacy-v1' }): Promise<Record<string, unknown>>;
export function verifyDashboardTemplate(browser: Browser, origin: string, options?: { router?: boolean }): Promise<Record<string, unknown>>;
