import { BlenderAsset } from './BlenderAsset'

/**
 * The look-dev town (fol-9fh): the Cortico hero fragment plus the eastern
 * meadow annex, co-registered into the town-wide batches. Two assets sharing
 * batches prove isolated group slots, full material coverage, and a
 * growth-free fit.
 */
export function Fragment() {
  return (
    <>
      <BlenderAsset asset="cortico/fragment" />
      <BlenderAsset asset="cortico/meadow" />
    </>
  )
}
