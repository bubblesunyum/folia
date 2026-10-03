import { index, type RouteConfig, route } from '@react-router/dev/routes'

// The route config must live at <appDirectory>/routes.ts, i.e. src/routes.ts,
// one level above the route modules in src/routes/**. Project pages are
// generic /:project ahead of breadth adding hoods; the case route reads its
// slugs from the content glob and 404s unknown ones (fol-ya7).
export default [
  index('./routes/home.tsx'),
  route(':project', './routes/project.tsx'),
  route(':project/:slug', './routes/project-case.tsx'),
] satisfies RouteConfig
