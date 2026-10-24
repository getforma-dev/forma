import { type RouteConfig, route } from "@react-router/dev/routes";
export default [
  route("health", "routes/health.ts"),
  route("ssr", "routes/ssr.tsx"),
  route("island", "routes/island.tsx"),
] satisfies RouteConfig;
