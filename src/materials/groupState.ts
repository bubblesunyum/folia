// Per-group state as a tiny data texture (D-032's tiny-texture path): one
// RGBA float texel per slot — x lift in metres, y glow, z tint amount, w
// reserved. A hover writes one texel and flags one upload; every material
// program samples the same texture object, so one GPU upload serves them all.
//
// The read rides `texture2D` in the vertex stage (three defines it to
// `texture` under GLSL3, vertex prefix included), at ((slot + 0.5) / WIDTH,
// 0.5) with nearest filtering: no half-texel bleed, and no GLSL3-only
// `texelFetch` inside the injected chunks.

import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three'
import { MAX_GROUPS } from '../groupSlots'

/** Texels across: one per group slot. A single row; the texture is WIDTH * 4 floats. */
export const GROUP_STATE_WIDTH = MAX_GROUPS
export const GROUP_STATE_HEIGHT = 1

/** Bytes per full-texture upload: the whole texture goes in one update. */
export const GROUP_STATE_BYTES = GROUP_STATE_WIDTH * GROUP_STATE_HEIGHT * 4 * 4

const data = new Float32Array(GROUP_STATE_WIDTH * GROUP_STATE_HEIGHT * 4)

/** The shared texture every group feature samples; written via setGroupSlot. */
export const groupStateTexture = new DataTexture(
  data,
  GROUP_STATE_WIDTH,
  GROUP_STATE_HEIGHT,
  RGBAFormat,
  FloatType,
)
groupStateTexture.minFilter = NearestFilter
groupStateTexture.magFilter = NearestFilter
groupStateTexture.generateMipmaps = false
groupStateTexture.needsUpdate = true

/** Full-texture uploads since boot (or the last reset): one per hover/lift write, zero at rest. */
export let groupStateUploads = 0

function checkSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_GROUPS) {
    throw new Error(`group slot ${slot} is outside [0, ${MAX_GROUPS})`)
  }
}

function checkChannel(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`group slot ${name} must be finite, got ${value}`)
}

/** Writes one slot's texel (lift metres, glow, tint amount): one texture upload. */
export function setGroupSlot(slot: number, lift: number, glow: number, tint = 0): void {
  checkSlot(slot)
  checkChannel(lift, 'lift')
  checkChannel(glow, 'glow')
  checkChannel(tint, 'tint')
  const o = slot * 4
  data[o] = lift
  data[o + 1] = glow
  data[o + 2] = tint
  data[o + 3] = 0
  groupStateTexture.needsUpdate = true
  groupStateUploads += 1
}

/** Zeroes one slot's texel: one texture upload. */
export function clearGroupSlot(slot: number): void {
  setGroupSlot(slot, 0, 0, 0)
}

/** Reads one slot's texel back: the hover writer's mirror, and the tests'. */
export function readGroupSlot(slot: number): { lift: number; glow: number; tint: number } {
  checkSlot(slot)
  const o = slot * 4
  return { lift: data[o] ?? 0, glow: data[o + 1] ?? 0, tint: data[o + 2] ?? 0 }
}

/** Zeroes every texel and the upload count: tests reset here, leaving the rest pose. */
export function resetGroupState(): void {
  data.fill(0)
  groupStateTexture.needsUpdate = true
  groupStateUploads = 0
}

/** The u coordinate of `slot`'s texel centre, mirroring the shader's index math. */
export function groupSlotU(slot: number): number {
  checkSlot(slot)
  return (slot + 0.5) / GROUP_STATE_WIDTH
}
