import { BlenderAsset } from './BlenderAsset'

/**
 * The look-dev town (fol-9fh): the Cortico hero fragment plus the eastern
 * meadow annex, co-registered into the town-wide batches. Two assets sharing
 * batches prove isolated group slots, full material coverage, and a
 * growth-free fit. The forum (fol-l1r.4) adds the three pedestals — laptop,
 * phone and audio glyph — on the fragment's top terrace, each on its own
 * group slot for the pedestal hover in fol-l1r.5. The town skeleton (fol-p6f)
 * lays the terrain, river, walks, construction plots and baked forest
 * cards + skirt underneath it all; its registry presence retires the
 * runtime ForestEdge mid/skirt (fol-l7d.15), so exactly one side draws them.
 */
export function Fragment() {
  return (
    <>
      <BlenderAsset asset="town/skeleton" />
      <BlenderAsset asset="cortico/fragment" />
      <BlenderAsset asset="cortico/meadow" />
      <BlenderAsset asset="cortico/forum" />
    </>
  )
}
