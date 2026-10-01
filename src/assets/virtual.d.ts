declare module 'virtual:folia-assets' {
  /** Asset (`<hood>/<object>`) → content hash, from assets/manifest.json. */
  const hashes: Readonly<Record<string, string>>
  export default hashes
  /** Asset → group name → global `uGroupState` slot (D-061). */
  const groupSlots: Readonly<Record<string, Readonly<Record<string, number>>>>

  export { groupSlots }

  /** Asset → batch → baked triangles, sizing the town batch registry (D-032). */
  const assetTriangles: Readonly<Record<string, Readonly<Record<string, number>>>>

  export { assetTriangles }

  /** Asset → batch → pack-time vertex counts (fol-6po); absent for legacy records. */
  const assetVertices: Readonly<Record<string, Readonly<Record<string, number>>>>

  export { assetVertices }

  /** Asset → batch → pack-time index counts (fol-6po); absent for legacy records. */
  const assetIndices: Readonly<Record<string, Readonly<Record<string, number>>>>

  export { assetIndices }
}
