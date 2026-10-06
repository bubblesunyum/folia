"""Town skeleton asset (fol-p6f): the town-wide read — terrain, river, walks,
construction plots, the art-hill crown, baked forest cards + horizon skirt.

Thin wrapper over the shared `folia.town` kit (D-001/D-002): the layout is
single-sourced in `content/town/` (one file per neighborhood plus
`river.json`), which the kit reads at bake and the runtime parses itself —
never a hand copy, both fail closed on drift. Build-only params
(resolution, sizes, bake) live in the sibling `skeleton.json`, the asset's
own params file per the D-034 convention (change the params or the script
and re-export); `folia/town.json` is the kit default it was copied from.

Mid/high split (D-072): the town read — ground, pads, scaffolds, river,
forest cards, horizon skirt — ships at `/`; the half-grown plot gardens
(planting foliage) stream at the town vantage.
"""

from folia.town import assemble  # noqa: F401
