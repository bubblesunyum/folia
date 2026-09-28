declare module 'virtual:folia-assets' {
  /** Asset (`<hood>/<object>`) → content hash, from assets/manifest.json. */
  const hashes: Readonly<Record<string, string>>
  export default hashes
}
