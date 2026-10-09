# South Ground Plan With West Stairs

The **תוכנית מצורפת** action in the combined-plan dialog selects a separate
south ground-floor interpretation of the image supplied on 2026-10-06. It does
not replace the locally bundled PDF, the original layout, or the family proposal.
The action uses shared undo/redo and browser/file persistence.

## Scope

- Straight stairs along the west wall, opposite the east entrance.
- A wider kitchen extending to the existing service-room partition, with a rear
  counter, east return, separate appliances, island and four counter seats.
- A round dining table with the image's printed 1.30 m diameter and four chairs.
  Both SVG and Three.js use the same round tabletop geometry; duplication retains it.
- The old central south stair enclosure is inactive in this variant. Original
  wall records and their saved edits remain available in the original layout.
- North geometry, the south exterior envelope, guest WC, living room, upper-floor
  rooms and basement walls are unchanged. Variant-specific furniture never leaks
  into another layout; its edits remain in saved projects when inactive.

## Limits

The local PDF is a different drawing, with central U stairs and a narrower south
kitchen. Its source registration and reference image are intentionally unchanged.
The new kitchen bay (6.12 x 3.10 m), furniture placements and 0.92 x 4.00 m stair
footprint are schematic interpretations in the existing coordinate system, not
new survey measurements. Only the 1.30 m dining diameter is transcribed directly.

The stair retains the model's storey heights and 18 rises. As in the existing
editor, one position applies to both connections and the destination slab holes.
This does not certify alignment with the unchanged upper floor or basement,
headroom, clearance, structural feasibility, or building-code compliance.

The optional [stair path editor](STAIR-EDITOR.md) can replace either connection
with a landing and a turn toward the interior, reverse ascent, and add handrails
and transparent protection around the floor openings. This does not change the
attached-plan preset automatically or move existing upper-floor walls/furniture.

## Verification

```powershell
npm test -- src/model/southGroundPlan.test.ts src/scene/southWestLayout.test.ts
npm run build
npm run test:e2e -- e2e/south-west.spec.ts
```

Tests cover layout isolation, round mesh/symbol geometry, room and furniture edits,
stair placement, slab openings, duplication, export/import, invalid input,
undo/redo, reload, responsive controls and a nonblank interactive 3D view.