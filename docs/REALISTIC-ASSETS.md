# Realistic materials, object editing and portable assets

Open **חומרים וריהוט** beside **ריאליסטי**. Rendering is local Three.js PBR,
not AI, path tracing, measured indirect illumination or a building-code check.

## Materials

- Select a wall, door, furniture/appliance or stair in the 2D/3D editor and use
  **חומר וגימור**. The library also lists targets by dwelling/storey, including
  floors, ceilings and roof surfaces. A slab's upper/lower faces have independent
  material slots. The ceiling belongs to the storey *below* the slab.
- Select a builtin material or uploaded image, repeat metres and roughness,
  then **החלת חומר**. Default restores authored materials. A furniture override
  replaces all its submaterials, but never changes other instances of that model.
- **הוספת חומר מתמונה** browses local PNG/JPEG/WebP (up to 10 MB input), decodes
  and re-encodes locally, removes image metadata, and downsamples to at most
  1024 pixels. Maximum 12 images, each 240,000 encoded characters. Images provide
  albedo only, not automatically generated depth/normal/roughness maps. SVG and
  network URLs are rejected. Use imagery you own or may redistribute.
- Images remain in the library after deleting an object. Explicit image removal
  clears its assignments; Undo restores them. An upload is rejected if browser
  project storage fails. The existing project JSON size limit still applies.
- Material changes preserve geometry, sunlight blockers and aperture semantics.
  Local texture repeats scale with dwelling transforms and are visual defaults,
  not surveyed dimensions. A glass finish does not make a solid wall sun-transparent.

## Object operations

- Furniture/appliances: independent move, rotate, resize, duplicate and delete.
  Duplicates copy effective dimensions, model and material to a fresh ID. All
  published operations use the shared Undo/Redo stack and browser persistence.
- Doors/windows: position/size/delete on the host wall; duplication is accepted
  only if a full-width copy fits on that wall. Rotation rotates the host wall.
- Walls: move/rotate/resize/delete using existing endpoints. Floors/ceilings stay
  driven by the building geometry rather than being arbitrary furniture.
- Stairs: horizontal footprint scale 0.5–2 and removal apply to both connections
  and destination slab cutouts. Vertical rise follows floor elevations. Undo
  restores removed stairs. Structural correctness/headroom is not certified.
- Wall/room/building/stair duplication and arbitrary personal GLB import are not
  implemented. Structural floors/ceilings cannot be independently moved/deleted.

## Expanded catalogue

**קטלוג ריהוט ומכשירים** has 33 additional models (35 total including the original
two), searchable by text/category. Add into the selected active dwelling/storey,
then reposition/resize. Placement does not check room fit or overlap. Selected
furniture's **מודל תלת־ממד** changes its visual model without changing its dimensions.
Some appliances use a generic 2D symbol rather than a product-specific outline.

The extra catalogue includes modern sofas/chairs, beds, desks, cabinets, fridges,
ovens, microwave, coffee machine, washing machines/dryers and sanitary fixtures.
32 are lightweight Kenney models, not photorealistic scans; one is a wood/leather
PBR armchair. Provider search links open Poly Haven/ambientCG in a new tab. They
are external discovery, not live in-app crawling or automatic web import. Typing
in the local catalogue sends no request to an outside service.

## Cache and durable file backups

- Project storage embeds custom image data and assignments. Downloaded original
  texture/model bytes are additionally cached in IndexedDB across reloads.
  Quota/private mode can prevent caching, and browser data can be evicted.
- **שמירת קובץ / הורדת גיבוי עם נכסים** downloads a version-2 workspace JSON with
  the validated version-1 project, all custom images, core realism assets, all
  additionally selected models/dependencies and source credits. Unused catalogue
  models/previews are not embedded. Typical size: 29–35 MB (base64); import cap:
  100 MB. Export fails visibly if any required asset cannot be obtained.
- Import validates source-asset SHA-256 hashes and required resources, then writes
  assets in one IndexedDB transaction before publishing the project. Unknown
  paths, poisoned/incomplete resources and external model references are rejected.
  Failed imports leave the model unchanged. An asynchronous import does not
  overwrite project edits made while it was loading. Cache failures also block
  portable import rather than silently lose the restored assets.
- **בחירת קובץ לגיבוי מתעדכן** uses user-granted File System Access on supported
  secure-context browsers. Writes are serialized and debounced 1.2 seconds;
  pending/success/error status remains visible. Reconnect each session. Pending
  writes trigger a before-unload warning, not a guarantee that close flushes data.
  Unsupported browsers use the portable-download button. No keys/backend needed.
- Browser storage does not guarantee data can never be lost. Keep exported files
  outside browser storage and wait for successful-write status. Portable files
  include assets, not a standalone offline copy of the application itself.

## Research and attribution (checked 2026-09-11)

- [Poly Haven licence](https://polyhaven.com/license): CC0 assets, redistribution
  and commercial use permitted. Core 1K colour/OpenGL normal/roughness sets:
  wood_floor (Dimitrios Savva); fabric_pattern_07, marble_01, floor_tiles_06
  (Rob Tuytel); plastered_wall (Amal Kumar). Fabric uses col_1. Downloads checked
  against official API MD5. API calls used a identifying User-Agent and comply
  with [separate API terms](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md).
- [Modern Arm Chair 01](https://polyhaven.com/a/modern_arm_chair_01): Vibrant Nordic,
  CC0; original 1K glTF/bin/JPEG dependencies.
- [Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit): Kenney, CC0;
  32 selected original GLBs and NE previews. No file-byte modification.
- [Sheen Wood Leather Sofa](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenWoodLeatherSofa):
  © 2024 Darmstadt Graphics Group GmbH, improvements by Eric Chadwick,
  **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**, NOT CC0.
  Original: Fran Calvente, 2021, CC0 [sofa_03](https://polyhaven.com/a/sofa_03).
- [Sheen Chair](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenChair):
  © 2020 Wayfair, LLC, Eric Chadwick, CC0. Default authored variant retained.
- [ambientCG](https://docs.ambientcg.com/license/): researched alternative CC0
  library and external discovery link; not a bundled asset source here.

Original model bytes are unchanged. Runtime transforms correct orientation,
centre/ground and fit models to editable dimensions, followed by item/dwelling
placement. Explicit user material overrides are optional. No author endorsement
is implied. Source credits and pinned hashes: [core](../public/assets/realism/credits.json)
and [expanded catalogue](../public/assets/realism/catalog/credits.json).

## Hosting and performance

- Deploy the **entire build output**, not only generated HTML. Vite copies local
  assets with relative-base support for GitHub Pages. No external runtime asset
  calls; explicit external source/search links are the exception.
- Core assets ~21.2 MB; extra catalogue/previews ~3.53 MB. Sofa: 46,492 triangles,
  10,107,912 bytes; original chair: 39,936 triangles, 4,125,648 bytes. Only selected
  extra models load. Catalogue previews load when browsing. File export may load
  assets even in diagram mode so the backup is complete.
- Separate viewer-owned GPU cache survives architecture rebuilds. Unmount releases
  geometry, materials, all texture slots and ImageBitmaps. Deleted custom images
  release GPU textures; late loads are ignored/disposed. Refresh retries failures.
- Meter-based UVs and grouped floor/ceiling materials avoid stretched tiles and
  excessive draw calls. Idle frames skip GPU work; camera/geometry/texture and
  measurement changes invalidate rendering. Neighbor-only rays skip detailed GLBs.
- Procedural RoomEnvironment/PMREM supplies approximate reflections, disabled in
  direct-only mode. Missing assets keep usable parametric/PBR fallbacks with a
  status message. Many detailed objects/high-resolution shadows remain expensive.

## Verification

Unit tests cover strict migrations, image/target validation, independent assignments,
GLB instance isolation, UV/floor/ceiling handling, object lifecycle and stair
cutouts, history, source hashes, resource ownership and invalid bundles.
Desktop/mobile browser tests cover real catalogue loads, image upload, independent
edit/duplicate/delete/Undo, persistent reload, empty-cache restore with network
assets blocked, tampered bundles, authorized serialized file writes, write denial,
dark RTL layout and original material regressions. Automated file-picker tests
use a mocked authorized handle; actual browser permission remains user-controlled.