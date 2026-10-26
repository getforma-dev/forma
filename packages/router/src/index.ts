export { createRouter } from './router';
export { defineRoutes, matchRoutes } from './routes';
export { createBrowserAdapter } from './browser';
export { createNativeAdapter, type NavigationBootstrap } from './native';
export { createHtmlAdapter, type HtmlPage, type HtmlAdapterOptions } from './html';
export { Link, Outlet, type LinkProps } from './components';
export { NavigationError } from './types';
export type { Accessor, RouteDefinition, Match, LocationState, RenderContext, NavigationContext, PreparedView, Redirect, ActionOutcome, AdapterSession, RouteAdapter, RouterOptions, NavigationResult, SubmissionResult, Router } from './types';
