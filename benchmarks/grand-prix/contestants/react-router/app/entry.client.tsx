import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

startTransition(() => {
  // The framework's ordinary document hydration boundary, before native work.
  (window as any).__gpActivationStart = performance.now();
  hydrateRoot(document, <StrictMode><HydratedRouter /></StrictMode>);
});
