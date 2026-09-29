declare module 'virtual:folia-assets' {
  /** Asset (`<hood>/<object>`) → content hash, from assets/manifest.json. */
  const hashes: Readonly<Record<string, string>>
  export default hashes
  /** Asset → group name → global `uGroupState` slot (D-061). */
  const groupSlots: Readonly<Record<string, Readonly<Record<string, number>>>>

  export { groupSlots }
}
