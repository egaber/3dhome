# Attached Northern Ground Floor

In **מבנה**, choose the north dwelling and **חלופת קרקע בבית הצפוני**. The attached
option interprets the supplied ground-floor image: a west kitchen with tall south
cabinets, a long island, round dining toward the north, east L seating with two
armchairs, an east entrance, and the southeast safe-room/bathroom wing.

The island's **1.10 x 2.65 m**, dining-table diameter **1.30 m**, west counter depth
**0.60 m**, counter-to-island gap **1.15 m**, island-to-stair gap **0.95 m**, three
northern **3.30 m** glazing spans, and stair-side cabinet length **1.55 m** follow
dimensions visible in the image. Other positions, partitions, openings, furniture
and heights are approximate, aligned to the existing model envelope. The old PDF
overlay is not the new drawing. No southern floor area is assigned to the north.
Room dimensions describe conceptual model zones, not certified net room areas.

## Stairs

**מדרגות לפי תוכנית הקרקע** applies the attached plan and its explicit northern
U-stair preset. In plan coordinates it starts on the east/right flight, travels
south/down the drawing to the landing, and returns north/up the left flight.
The shared center is **(5.17, 5.19) m**, rotation **180 degrees**, scale **1**.
The unscaled opening is **X=4.00-6.34, Z=3.74-6.64 m**. Each connection has 18
equal rises: eight lower treads, the landing, eight upper treads, and the
destination slab. Nominal flight width is 1.05 m, going 0.25 m, and landing depth
0.90 m. These are model choices, not a code-compliant stair specification.

The preset replaces all custom northern paths, including basement and any roof
path, and enables stairs, rails and opening glass. It retains the first-floor
variant, roof-continuation flag, all other building settings, southern configuration,
design edits and appearance. It is one undoable action. Selecting only the floor
variant does not reset saved stair settings; its U template uses this variant's
stairwell dimensions. Arbitrary retained placements or custom paths can collide.

**המשך מדרגות לגג** independently enables first-to-roof continuation. The roof
floor is 6.50 m at default heights; the pitched roof peak is not a walking level.
Physical slab/finish/roof-wall shaft openings and guards follow the resolved
stairs. [Stair controls and roof behavior](STAIR-EDITOR.md).

## Persistence and Verification

The optional `buildings.north.northGroundLayout: 'attached'` field leaves old
projects unchanged. New wall, opening, room and furniture IDs belong to an
optional catalog; switching to the previous plan hides rather than deletes their
edits. Added/copied furniture has `layout: 'north-ground'`. Import rejects unknown
variants, wrong dwelling/floor ownership and malformed values. Browser and file
saves use the existing format, without a backend, dependency or automatic migration.

Focused model tests cover ownership, dimensions, footprint separation, stair
direction, uniform rises, inactive edit restoration, round trips and invalid input.
Actual furnished Three.js tests walk from basement to ground, ground to first and
first to roof and back with walls, rails and opening glass intact. They also check
ground entrance access, the first-floor transfer between flights, room tour entry
clearance, and rotated/nonuniformly scaled configurations.

```powershell
npm test -- src/model/northGroundLayout.test.ts src/scene/northEntranceStairs.test.ts
npm run typecheck
npm run build
npm run test:e2e -- e2e/north-ground.spec.ts
```

The simulation does not certify structure, stair/headroom compliance, accessibility,
safe-room details, service routing or construction dimensions. Professional survey
and architectural/engineering review remain necessary before building.