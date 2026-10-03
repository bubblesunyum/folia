// Types for build-time compiled MDX (D-019): every `.mdx` import is a React
// component produced by @mdx-js/rollup in vite.config.ts. The `components`
// prop injects overrides without @mdx-js/react, so the browser graph stays
// react-only (D-047).

declare module '*.mdx' {
  import type { ComponentType } from 'react'
  import type { MdxComponents } from './content/mdx-components'

  const Body: ComponentType<{ components?: MdxComponents }>
  export default Body
}
