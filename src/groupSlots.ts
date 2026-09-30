// Town-wide group slots (D-061): `_ID` values are per-asset small ints, but
// `uGroupState` is one global array shared by every material, so the pipeline
// remaps local ids to these slots at pack time and the shaders index them.
// Kept here — not in `materials/features.ts` — so the asset pipeline can read
// the limit without importing three, and so shader edits don't change the
// asset content hash. Outgrowing the array is D-032's tiny-texture path.
export const MAX_GROUPS = 16
