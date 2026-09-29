import { button, useControls } from 'leva'
import { useEffect, useMemo, useRef, useState } from 'react'
import { applyPaletteToCss, type PaletteColor, palette } from '../palette'
import { clearBenchStatus, reportBenchStatus } from './benchStatus'
import type { LookDraft, LookSource } from './look'
import { postLookDraft } from './lookSave'

interface TimePanelProps {
  initialHours: number
  onChange: (hours: number) => void
  initialDraft: LookDraft
  onDraft: (draft: LookDraft) => void
}

/**
 * The `?panel` look-dev bench (D-034). Split out so `leva` only loads when
 * the panel is on — the main bundle never sees it.
 *
 * Hours scrub the gradient as before; `palette` recolors the base materials
 * and CSS; each `keyframes/<name>` folder edits that keyframe's look; `write
 * back` POSTs the working copy to the dev server, which validates it and
 * writes `palette.ts` / `keyframes.json` back to disk.
 */
export default function TimePanel({
  initialHours,
  onChange,
  initialDraft,
  onDraft,
}: TimePanelProps) {
  const { hours } = useControls('time of day', {
    hours: { value: initialHours, min: 0, max: 23.99, step: 0.05 },
  })
  useEffect(() => {
    onChange(hours)
  }, [hours, onChange])

  const [palValues, setPalValues] = useState<Record<PaletteColor, string>>(() => ({
    ...initialDraft.palette,
  }))
  const [kfValues, setKfValues] = useState<Record<string, FlatValues>>(() =>
    Object.fromEntries(initialDraft.keyframes.map((k) => [k.name, flattenLook(k.look)])),
  )
  // Stable schemas: the folders initialize from the files once, never from
  // the live state, so typing never rebuilds the controls underneath itself.
  const initialFlat = useMemo(
    () => Object.fromEntries(initialDraft.keyframes.map((k) => [k.name, flattenLook(k.look)])),
    [initialDraft],
  )
  const draft = useMemo<LookDraft>(
    () => ({
      palette: palValues,
      keyframes: initialDraft.keyframes.map((k) => ({
        name: k.name,
        hours: k.hours,
        ...(k.provisional ? { provisional: true as const } : {}),
        look: unflattenLook(k.look, kfValues[k.name] ?? {}),
      })),
    }),
    [palValues, kfValues, initialDraft],
  )
  useEffect(() => {
    onDraft(draft)
  }, [draft, onDraft])
  useEffect(() => {
    applyPaletteToCss(document.documentElement, draft.palette)
  }, [draft])

  const setKeyframe = (name: string) => (values: FlatValues) =>
    setKfValues((prev) => ({ ...prev, [name]: values }))

  return (
    <>
      <PaletteFolder initial={initialDraft.palette} onChange={setPalValues} />
      {initialDraft.keyframes.map((k) => (
        <KeyframeFolder
          key={k.name}
          name={k.name}
          initial={initialFlat[k.name] ?? {}}
          onChange={setKeyframe(k.name)}
        />
      ))}
      <WriteBack draft={draft} />
    </>
  )
}

/** One control per leaf, addressed by dotted path (`sky.glowIntensity`, `grade.lift.r`). */
type FlatValues = Record<string, number | string>

function sameRecord(
  a: Record<string, number | string>,
  b: Record<string, number | string>,
): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
}

/**
 * Reports leva values upward, once per actual change. `useControls` returns
 * a fresh object every render, so an unguarded effect would setState in a
 * loop (maximum update depth exceeded).
 */
function useStableValues<T extends Record<string, number | string>>(
  values: T,
  onChange: (values: T) => void,
): void {
  const prev = useRef(values)
  useEffect(() => {
    if (!sameRecord(prev.current, values)) {
      prev.current = values
      onChange(values)
    }
  }, [values, onChange])
}

function flattenLook(look: LookSource, prefix = ''): FlatValues {
  const out: FlatValues = {}
  for (const [key, value] of Object.entries(look)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'number' || typeof value === 'string') out[path] = value
    else if (Array.isArray(value)) {
      const [r, g, b] = value as [number, number, number]
      out[`${path}.r`] = r
      out[`${path}.g`] = g
      out[`${path}.b`] = b
    } else if (value && typeof value === 'object')
      Object.assign(out, flattenLook(value as LookSource, path))
  }
  return out
}

/** The inverse: `base` cloned, every flat entry written back through its path. */
function unflattenLook(base: LookSource, flat: FlatValues): LookSource {
  const out = structuredClone(base)
  for (const [dotted, value] of Object.entries(flat)) setPath(out, dotted, value)
  return out
}

const CHANNEL = { r: 0, g: 1, b: 2 } as const

function setPath(root: LookSource, dotted: string, value: number | string): void {
  const segs = dotted.split('.')
  const last = segs.pop() as string
  let node = root as unknown as Record<string, unknown>
  for (const seg of segs) node = node[seg] as Record<string, unknown>
  // No look field is a lone r/g/b, so a trailing one always addresses an RGB triple.
  if (last === 'r' || last === 'g' || last === 'b') {
    ;(node as unknown as (number | string)[])[CHANNEL[last]] = value
  } else {
    node[last] = value
  }
}

const paletteNames = Object.keys(palette)

function PaletteFolder({
  initial,
  onChange,
}: {
  initial: Record<PaletteColor, string>
  onChange: (values: Record<PaletteColor, string>) => void
}) {
  const schema = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(initial).map(([name, hex]) => [name, { value: hex }]),
      ) as Record<PaletteColor, { value: string }>,
    [initial],
  )
  const values = useControls('palette', schema)
  useStableValues(values, onChange)
  return null
}

function KeyframeFolder({
  name,
  initial,
  onChange,
}: {
  name: string
  initial: FlatValues
  onChange: (values: FlatValues) => void
}) {
  const schema = useMemo(() => {
    const out: Record<string, { value: number | string; step?: number; options?: string[] }> = {}
    for (const [path, value] of Object.entries(initial)) {
      // Every string leaf in a keyframe names a palette color; the select
      // keeps a typo from ever reaching the resolver.
      out[path] =
        typeof value === 'number' ? { value, step: 0.01 } : { value, options: paletteNames }
    }
    return out
  }, [initial])
  const values = useControls(`keyframes/${name}`, schema)
  // Leva's inference keeps the `{ value }` wrappers on index-signature
  // schemas; at runtime these are the unwrapped control values.
  useStableValues(values as unknown as FlatValues, onChange)
  return null
}

function WriteBack({ draft }: { draft: LookDraft }) {
  // No DOM nodes here: this component renders inside the Canvas reconciler,
  // where a `<div>` would crash R3F — failures report through the bench
  // status bridge to `<BenchStatusReadout/>` (DOM level) instead.
  //
  // The draft travels through a ref, read at click time: leva memoizes the
  // button handlers from the first render, so closing over the prop would
  // save the mount-time draft forever. One button writes both files, so a
  // save can never strand edits to the other file across the reload.
  const draftRef = useRef(draft)
  draftRef.current = draft
  useControls('write back', {
    writeBack: button(() => void save(draftRef.current)),
  })
  return null
}

/** Validates both files past the server, then reloads onto the saved truth. */
async function save(draft: LookDraft): Promise<void> {
  clearBenchStatus()
  try {
    await postLookDraft('palette', draft)
    await postLookDraft('keyframes', draft)
    window.location.reload()
  } catch (error) {
    reportBenchStatus(`write back failed: ${(error as Error).message}`)
  }
}
