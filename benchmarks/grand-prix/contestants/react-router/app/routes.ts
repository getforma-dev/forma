import { type RouteConfig, route } from "@react-router/dev/routes";
export default [
  route("health", "routes/health.ts"),
  route("ssr", "routes/ssr.tsx"),
] satisfies RouteConfig;
