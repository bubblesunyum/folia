import { index, type RouteConfig, route } from '@react-router/dev/routes'

// The route config must live at <appDirectory>/routes.ts, i.e. src/routes.ts,
// one level above the route modules in src/routes/**.
export default [
  index('./routes/home.tsx'),
  route('cortico', './routes/cortico.tsx'),
  route('cortico/:slug', './routes/cortico-case.tsx'),
] satisfies RouteConfig
