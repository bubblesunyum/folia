// Town-wide group slots (D-061): `_ID` values are per-asset small ints, but
// `uGroupState` is one town-wide data texture shared by every material — one
// RGBA float texel per slot in a single row (see
// `materials/groupState.ts`) — so the pipeline remaps local ids to these
// slots at pack time and the shaders index them by slot.
// Kept here — not in `materials/features.ts` — so the asset pipeline can read
// the limit without importing three, and so shader edits don't change the
// asset content hash. Outgrowing the strip means raising this: the texture
// width and the shader keys follow from it. Listed in
// `assets/pipeline/build.ts` `assetSources`, so a change re-hashes every
// asset and re-exports every GLB even though packed slots stay stable.
export const MAX_GROUPS = 32
