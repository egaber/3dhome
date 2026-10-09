# V2 walkthrough showroom

## Open it

Run the existing `npm run dev` command and open
`http://127.0.0.1:5173/#v2`. Production builds use the same `#v2` route, including
when hosted in a GitHub Pages subdirectory. No backend, API key or remote inference
service is required.

The original studio is still available at `/#classic` and `/`. Its project and
session keys are unchanged. V2 initially copies the current valid classic project,
or the default house when none is saved; later V2 changes never overwrite the
classic project. Source and runnable-build archives were made before V2 development.

The [8 October ground-floor alternative](OCTOBER-GARDEN.md) adds measured PDF
geometry, direct door/glazing interaction, supported house-to-garden routes,
and independently editable trees and potted plants.

## Walking and presentation

- WASD/arrows move; Q/E turn. Drag with a mouse or a finger to look around.
  Press-and-hold arrow buttons work with touch and keyboard.
- A short movement-key tap advances 8 cm. Held walking continues at 2.3 m/s;
  animation frames do not count the tap's already-covered time a second time.
- The room menu selects a dwelling and an available room. Explicit room entry
  finds a supported camera position; edits that invalidate an existing position
  still require deliberate re-entry.
- The top-right minimap derives its position and heading from the actual camera,
  inverts true-north rotation, and follows floor/stair context. It can be collapsed.
- Furniture and closed glazing block the V2 walking capsule. These additional
  navigation colliders do not turn transparent glazing into a sunlight blocker.
  Furniture collision uses its transformed editable bounding volume, not a
  physical simulation of every cushion or chair leg.
- Day, golden-hour and evening presets set the simulation to 21 September 2026
  at 11:00, 17:15 and 19:30. Existing camera position is retained. Local fixtures
  illuminate the interior; there is no baked photograph behind the model.
- Natural wood/textile and light-stone style buttons update floor assignments and
  select the upholstered parametric sofa. These are ordinary undoable design edits.
- High quality adds screen-space ambient/contact occlusion to PBR, an environment
  map, sunlight shadows, tone mapping and antialiasing. Performance mode removes
  contact occlusion. Actual frame rate depends on the GPU, viewport and model size.
- The photo references informed materials and details; they are not bundled as
  textures or redistributed. Existing licensed assets retain their credits.
  The result is a real-time architectural visualization, **not photogrammetry,
  path-traced light transport, or a claim of GTA6-level fidelity**.
- V2 also bundles the original 1K CC0 **potted_plant_02** (Rico Cilliers) and
  **fern_02** (Rob Tuytel and Rico Cilliers) from Poly Haven, approximately 3.8 MB
  total. SHA-256 checksums and credits are in
  [the local asset manifest](../public/assets/showroom/credits.json). They load
  only for the showroom, with relative local URLs and no live provider requests.
  The in-memory GPU pool and browser HTTP cache reuse them; V2 library JSON does
  not embed these built-in assets.
- Screenshot export captures the rendered canvas, not the controls.

## Alternatives and storage

V2 stores up to 20 named designs in `dori-home-v2-design-library`. Each contains a
validated complete project, including custom images, drawn walls and imported
plan data. Save-as-copy creates a distinct identity. Switching designs resets
the in-session undo stack rather than allowing undo to cross into another design.
GPU assets and the renderer stay alive across switches.

Writes replace one local-storage key and check the last observed revision.
A newer write from another tab, corrupt stored data, quota exhaustion or denied
storage produces a visible error, never a saved-success claim. The edited scene
stays usable in memory. Download a backup before leaving in that case.
The revision check is best-effort, not a cross-tab transaction: edit a library in
one tab at a time and keep exported backups.

The library backup can be imported without replacing current alternatives:
every imported design receives a fresh ID, and the archived active design is
selected. JSON input is bounded to 32 MB; project validation remains in force.
This backup includes custom images and model choices, **not the built-in asset
files or the application executable**. Keep the complete production build and
its asset directory. Clearing browser data may erase all local alternatives.

The material-image uploader uses the host application's persistence boundary:
in V2 it saves only to the V2 library; in the classic studio it retains the
original project persistence behavior.

## Plan reconstruction

1. Open **ייבוא תוכנית** and choose a file up to 12 MB.
2. For a multipage vector PDF, select the page.
3. Click both endpoints of a known dimension and enter its real length in metres.
   The source image is uniformly calibrated; an oblique photograph is not
   automatically rectified or surveyed.
4. Review all detected lines. Select and remove annotation lines, redraw missing
   segments with the two-click wall tool, or clear detections and trace manually.
   Re-detection replaces the current draft lines.
5. Set the wall thickness, acknowledge the review and create a **new alternative**.
   Nothing is merged into or substituted for the currently saved house.

Simple PDF page/content streams support straight painted paths, rectangles,
transforms and uncompressed/Flate content. Text and curves are omitted. Encrypted
PDFs, object-stream PDFs, rotated pages, nested forms and image/scanned PDF pages
are rejected with actionable messages; export those pages as upright JPEG/PNG
for the assisted image workflow. These limits are explicit rather than presenting
partial extraction as a complete accurate plan.

Image detection finds long dark horizontal/vertical runs. It does not distinguish
all dimensions, furniture, wall faces or text from structural walls. Diagonal or
curved geometry requires manual treatment. Images are locally re-encoded,
metadata-stripped and downsampled to at most 1600 pixels on the longest side.
Calibration therefore refers to that displayed image.

The first reconstruction has 1–200 straight walls, a rectangular floor enclosing
them, a single ground floor, and default ceiling height. It is **not** automatic
room recognition, aperture recognition, structural engineering or a complete
AutoCAD/SketchUp replacement. Add doors/windows, furniture, materials and precise
edits in the shared 2D editor. Image underlays remain aligned and persist with the
alternative. Check the result against the source dimensions before professional use.

## 2D editing

The existing editor retains layers, fitting/zoom/pan, selection, numeric
coordinates, opening sizes, rotation handles, deletion, measurement and history.
**שרטוט קיר** adds an 18 cm wall between two clicks; Shift aligns its end to an
axis. The new wall can be moved, rotated, resized, deleted or fitted with openings.

**העתקה / הדבקה** or Ctrl/Cmd+C/V on the drawing copy furniture or a wall with its
hosted openings to fresh editable IDs. Native form inputs keep their own clipboard
shortcuts. Paste offsets the copied geometry by 50 cm in local plan coordinates
(before dwelling scaling/rotation) and is one undoable action.
Existing per-object duplicate actions remain available for doors/windows.

## Verification

Use the repository's existing commands:

```text
npm run typecheck
npm test
npm run build
npm run test:e2e
```

V2 feature tests cover calibrated geometry, bounded PDF/raster parsing, invalid
input, persistent alternatives, stale writes/quota errors, clipboard isolation,
minimap coordinates, solid navigation geometry and resource disposal. Browser
tests exercise actual desktop/mobile rendering, movement, markers, storage,
editing, reload, calibration, reconstruction and corrupt-storage handling.
Screenshots are visual evidence, not an automatically approved aesthetic baseline.
