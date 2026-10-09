# Editable Stair Paths and Opening Protection

## Controls

Open **עורך 2D**, choose a dwelling, then **מדרגות ופודסט**. On mobile, expand
**מאפיינים, שכבות ומדרגות**. The same controls are available in the building
Inspector and the staircase quick editor in 3D.

- **חיבור לעריכת מסלול** selects basement to ground, ground to first, or the optional
  first-to-roof connection. The CAD
  drawing and the controls share this selection. Changing a path affects only
  that connection, not its neighbor or the other dwelling.
- **מסלול עם פודסט** enables a square intermediate landing and two flights.
  Disabling it restores the selected connection's existing straight/U layout.
- The three arrow buttons select left, straight or right at the landing, relative
  to the direction of ascent. The reverse button exchanges entry and exit without
  moving the footprint; it also exchanges left/right and mirrors the landing counts.
- **פודסט ופנייה נוספים** adds a second landing and third flight on the selected
  connection only. Its arrow buttons and **רומים עד הפודסט השני** / **עומק הפודסט השני**
  are independent of the first landing. Removing it retains the first landing.
  Reversal also exchanges the two landing depths and their ascent order.
- **רומים עד הפודסט** accepts an integer from 3 to 15 out of 18 equal rises.
  The landing counts as one rise; the destination slab supplies the final rise.
  With a second landing, the first must be no later than rise 12 and the second
  at least three rises later, no later than rise 15. This leaves at least two
  treads in each flight. Both landings together still use 18 total rises.
- Flight width is 0.80-1.50 m, tread depth is 0.22-0.40 m, and the square landing's
  side is at least the flight width and at most 2.40 m. These are editor limits,
  not building-code approval. Dimensions are local before dwelling/stair scaling.
- Numeric values are drafts until **החלת מידות מדרגות**. Invalid values leave
  the project unchanged. Each accepted command is one undoable action.
- Main position, rotation and scale remain shared between all connections. Optional
  **סיבוב יחסי של החיבור** and **הזזת החיבור לרוחב / לאורך** adjust only the
  selected path before that shared transform. Relative rotation is -180 to 180
  degrees; offsets are local-plan metres, not world/camera axes. Absent or zero
  values preserve the previous geometry, and reversing a path retains them.
  Existing
  straight/U preset buttons explicitly replace all custom paths while preserving
  position, rotation and protection settings.

The default custom path on **תוכנית מצורפת** starts along the west wall and turns
right into the first-floor interior. Its landing is after rise 10, at about 1.89 m
for the default 3.40 m storey. The landing is 1.10 m square, flight width is 0.92 m,
and tread depth is 0.27 m. Before dwelling transforms, the upper exit is approximately
X=3.21, Z=9.46 m. This is a design option, not a measurement transcribed from a plan.

For a second bend **southward on ground to first only**, use right turns at both
landings, the first after rise **11** at **1.10 m** depth, and the second after rise
**15** at **0.92 m** depth. Keep width **0.92 m** and tread depth **0.27 m**. This
extends the west flight by one tread to clear the existing first-floor partition;
the final flight faces positive plan Z, with exit approximately **X=2.59, Z=10.19 m**
before transforms. At the default storey height, the landings are about 2.08 m and
2.83 m above ground. The basement connection, shared placement and existing walls
are unchanged. This configuration is checked against the model's real obstacles,
not automatically applied to old projects or certified for construction.

For an existing shared stair position of **X=0.75, Z=10.75 m**, the verified variant
uses the first landing after rise **12**, retaining the second after rise **15**
and all the dimensions above. Its exit is approximately **X=2.39, Z=10.23 m**.
This compensates for the saved placement without moving the basement stairs.

The northern **מדרגות מול הכניסה** button supplies independently aligned paths:
an entrance-facing ascent with two later turns and a straight basement path. Its
incoming basement opening is narrower than the original U opening, leaving more
ground-floor slab intact. The preset is checked together with the attached northern
bedroom plan; [dimensions, ownership and limits](NORTH-BEDROOM-PLAN.md).

The newer **מדרגות לפי תוכנית הקרקע** button instead applies the attached northern
ground plan and its central U stair: right-hand ascent, southern landing and
left-hand return. It replaces all custom northern paths, retains the roof flag
and bedroom variant, and supports undo. [Ground-plan scope and dimensions](NORTH-GROUND-PLAN.md).

## Roof Continuation

**המשך מדרגות לגג** adds an optional first-floor to roof-floor flight when the
dwelling, stairs, two storeys and roof are available. It does not alter the basement
or ground-floor paths, the other dwelling, room edits or appearance. On first
activation it copies the current ground-to-first custom path, if present, into an
independent `stairPaths.first` setting. Later path edits do not affect its neighbor.
The shared straight/U template is used when no custom path exists. Turning the
connection off retains its settings for reactivation; old projects stay unchanged.

Choose **קומה ראשונה אל הגג** to edit this flight. With the default northern
heights it climbs from 3.40 m to the roof floor at 6.50 m, not to the pitched roof's
peak. The roof slab, its finish layers and intersecting modeled roof-room wall
segments have matching physical shaft openings. The existing roof remains intact
outside those openings. Opening protection leaves the actual stair passages clear.
Roof surfaces become walking supports only while a roof connection is available.

The attached northern plan and entrance-facing stair preset are checked through
the roof exit and back, including rotation and nonuniform dwelling scaling. This
is not a guarantee that every independently edited path has adequate headroom or
connects to every roof room. Roof structure, enclosure, waterproofing, safety and
code compliance still require professional verification.

## Protection and Persistence

**מעקה ומאחז יד** and **זכוכית סביב פתחי מדרגות** are independent, dwelling-wide
toggles. Handrails follow the flights and landing at a nominal 1.05 m above them.
Transparent 1.10 m panels surround the destination-floor openings, including the
ground-floor opening to the basement. Entry/exit passages remain open.

Glass is part of the real walking-collision snapshot even though it is excluded
from opaque sunlight blockers. Metal frames and handrails remain ordinary physical
meshes. Existing resource ownership disposes their geometry and materials with
the architecture. Plan symbols and 3D openings use the same resolved stair path.

Optional `stairPaths`, `stairToRoof`, `stairRailing` and `stairOpeningGlass` fields round-trip
through the existing version-1 browser/file format. Imports reject unknown fields,
unknown connections, malformed values and out-of-range dimensions. Projects without
these fields retain their original stairs and existing family-layout guards.
Each custom path can optionally include `secondLanding: { turn, landingAfter,
landingDepth }` and `rotation` / `offset`; omitting them preserves the original
single-landing geometry and shared-only placement. No
backend, hosted service, new dependency or automatic project migration is involved.

## Limits and Verification

Stair editing leaves saved wall/room edits, furniture and source drawings unchanged;
the roof continuation creates the modeled shaft openings described above. The
separately selected northern bedroom variant replaces its first-floor layout.
Custom paths can intersect existing rooms, slabs, other stairs or furniture. The
editor does not automatically move obstacles or certify the entire configuration.
Walking rejects actual collisions, unsupported edges and insufficient headroom;
the glass depiction is not a specification for structural glass, fixings or code
compliance. A professional must check the final layout before construction.

```powershell
npm test -- src/model/stairPath.test.ts src/model/stairEditing.test.ts src/scene/stairSafety.test.ts
npm run typecheck
npm run build
npm run test:e2e -- e2e/stair-editing.spec.ts
npm test -- src/model/roofStairs.test.ts src/scene/northEntranceStairs.test.ts
npm run test:e2e -- e2e/roof-stairs.spec.ts
```

Focused tests cover single/double turn combinations, continuous footprints and
uniform rises, reversal, shared transforms, independent connections, strict import,
and legacy presets. Actual Three.js tests verify slab holes, finite rails, transparent
panels, capsule-blocking glass and clear exit portals for both layouts. The default
west-wall L route and the two-turn southbound configuration above are walked to
the first floor and back with real walls, furniture and protection intact.
The saved-placement variant above is also checked. These successful routes do not
certify every possible user-edited route.

Desktop/mobile browser tests use the real controls for invalid drafts, per-connection
edits, reversal, undo/redo, presets and reload. They check nonblank interactive WebGL
views and capture both floors plus the editor for visual inspection.