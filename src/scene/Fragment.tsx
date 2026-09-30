import { BlenderAsset } from './BlenderAsset'

/**
 * The look-dev town (fol-9fh): the Cortico hero fragment plus the eastern
 * meadow annex, co-registered into the town-wide batches. Two assets sharing
 * batches prove isolated group slots, full material coverage, and a
 * growth-free fit. The forum (fol-l1r.4) adds the three pedestals — laptop,
 * phone and audio glyph — on the fragment's top terrace, each on its own
 * group slot for the pedestal hover in fol-l1r.5.
 */
export function Fragment() {
  return (
    <>
      <BlenderAsset asset="cortico/fragment" />
      <BlenderAsset asset="cortico/meadow" />
      <BlenderAsset asset="cortico/forum" />
    </>
  )
}
