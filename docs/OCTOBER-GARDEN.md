# 8 October ground plan, garden access and editable planting

## Open the new alternative

In V2, open **חלופות → פתיחת חלופת 8 באוקטובר**. The direct URL is:

```text
/?plan=october-2026&clawpilotTheme=light#v2
```

This creates **קומת קרקע · 08.10.2026** as an independent design. Existing options
are preserved. Opening the same link again selects that design without resetting
its edits. A full library or storage failure is reported instead of overwriting
another option. Download library backups before clearing browser storage.

## Source and measurement

The source is the locally supplied **קומת קרקע 8 october .pdf**, one page:

- SHA-256: `a7de5e4a1a9ee2a5f11a602a7a90e83148c0191a3bbf2106de16355b21b734cf`.
- Calibration: the printed **1145 cm** clear northern facade dimension.
- Scale: **28.406699901064414 PDF points/metre**.
- Origin: PDF **(595.0247802734375, 476.5243225097656)**.
- 28 colored wall paths were extracted locally. Their centerlines, thicknesses
  and actual aperture gaps are retained in
  [the source vector data](../src/assets/october-ground-vectors.json).
- The northern clear width is 11.45 m; the safe room is 2.95 × 3.23 m. The southern
  living wing is 5.75 × 3.62 m. Both entrances are 1.20 m in the source drawing.

The model contains both dwellings, separate logical rooms, furnishings following
the plan arrangement, independent openings and the revised southern footprint.
The 2D editor can show a calibrated crop of the supplied PDF below the vectors.
The alternatives dialog also exposes the source image.

**Scope/accuracy:** this PDF is a ground-floor plan. Upper floors, basement
geometry, elevations, detailed stair construction and roof remain based on the
existing model. Opening heights, materials, furniture dimensions and planting
are visualization assumptions, not surveyed or certified construction data.
The source file itself is never modified or uploaded.

## Open doors and walk outside

- Use **סיור בגינה** (tree icon) for an eye-level outdoor starting point, or choose
  **כניסה לסיור בגינה** in the room menu.
- Walk with arrows/WASD or press-and-hold movement buttons. Drag to look around;
  Q/E turn. The minimap expands to the site when outside and returns to the
  relevant floor inside.
- Approach a door or full-height glazed opening. A labeled action appears within
  2.6 m and with an unobstructed line of sight. Click it, press **F**, or tap the
  visible door leaf. A look-drag does not activate the door.
- Doors have a visible hinged-open leaf. Sliding glazing stacks its panels on
  the left: walk through the **clear right-hand half**, not through the stacked
  glass. Ordinary elevated windows are not converted into walk-through doors.
- The safe-room leaf opens into the safe room rather than blocking the small
  adjoining hall. **כיוון פתיחת הדלת** in opening properties selects the side of
  the host wall; the 2D swing, 3D leaf, collision and saved opening share it.
- Opening also releases a closed shutter. Closing/opening is rejected when the
  resulting leaf would intersect the visitor's capsule. State changes use the
  existing history and persist with the current design.
- Walls, leaves, furniture and planting trunks/pots remain collision obstacles.
  The existing light-well locations receive visible modeled grates at ground
  level, and the southern covered entrance receives a real supporting porch.
  Navigation follows those surfaces rather than skipping unsupported gaps.
  This is a visual/navigation model, not certification of grate load capacity.

Containment checks cancel coincident **opposite-facing internal wall-panel
seams**, while retaining real outer-face crossings. This prevents a visitor
outside a rotated window wall from being incorrectly classified as inside the
wall. It does not disable wall collisions.

## Trees and potted plants

Open **צמחייה** in the V2 header. The old repeated exterior pot rows are replaced
by six garden items of mixed kinds: two potted plants, two olive trees, one
cypress and one fern. Ground-floor living rooms have independent indoor pots.

- Choose a dwelling, garden/floor and species, then add an item.
- Select in the list or 2D site diagram. Drag to move, or enter exact local-plan
  X/Z coordinates, height, spread and rotation.
- Double-click a plant/tree in the 3D scene for its quick properties and delete
  action.
- Trees are garden-only; indoor floors allow pots and ferns. Invalid dimensions,
  inactive floors, duplicate IDs and more than 80 items are rejected.
- **ניקוי כל צמחיית הגינה** removes exterior planting after confirmation and
  retains indoor plants. An explicit empty collection stays empty after reload.
- Edits and deletion are ordinary undoable project actions, scoped to the current
  named design and included in exported backups.

Pots and ferns reuse the existing locally bundled CC0 assets. Olive/cypress
geometry is procedural, not a photographed tree scan. Camera collision uses
the trunk/pot footprint rather than treating the whole leaf canopy as a wall.

## Rendering and compatibility

Grating slats and leaf clusters use instancing. Static details and compatible
material groups are batched without removing triangles or changing texture
resolution. Original selection/collision meshes remain on a separate pick layer;
their IDs, measurements and geometry are not replaced by a coarse picking box.
Owned batched and instanced resources are disposed on scene replacement/unmount.

The original studio and saved model formats remain supported. Factory controls,
dependency manifests, CI and verification configuration are not changed.

On this Windows workstation the software-rendered headless browser can exceed
the unchanged 60-second timeout for a long high-quality walk. The same acceptance
cases can run in the visible Chromium browser with `npm run test:e2e -- --headed`;
this keeps the viewport matrix, assertions, timeouts and rendering quality intact.
