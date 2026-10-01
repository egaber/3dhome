- Select an object in 2D/3D to move, rotate, resize, delete, duplicate furniture/doors, choose its model and assign a material. The library also targets floors, ceilings and stairs. **הוספת חומר מתמונה** imports bounded local PNG/JPEG/WebP textures.
- **קטלוג ריהוט ומכשירים** adds 33 more licensed models (32 lightweight Kenney furniture/appliances plus a Poly Haven PBR armchair), with local text/category search and external provider-search links. Arbitrary personal GLB import and structural-object duplication are not included.
# Dori Solar Studio

Interactive 3D sun-and-shadow study for a residential site in Ra'anana.

## Local development

1. `npm ci`
2. `npm run dev`

## Verification

- `npm test`
- `npm run build`
- `npm run verify` (also runs desktop/mobile browser tests; install Chromium first)

The deployed application stores model edits, view state, and chat history locally in the browser. Use **Save file** inside the application to move a model between devices.

## Realistic materials / חומרים וריהוט

- Select **ריאליסטי** for locally bundled PBR wood, woven fabric, marble, plaster and tiles, physical ceramic/metal/glass finishes, and detailed sofa/armchair GLBs. **חומרים וריהוט** shows material swatches, sources and licences.
- Double-click an object in 3D, or select it in 2D, to edit position, rotation and dimensions, delete, duplicate furniture/doors, choose its 3D model and assign a material. The library also targets floors, ceilings and stairs. **הוספת חומר מתמונה** imports local PNG/JPEG/WebP textures.
- **קטלוג ריהוט ומכשירים** adds 33 more licensed models (32 lightweight Kenney furniture/appliances plus a Poly Haven PBR armchair), with local text/category search and external provider-search links. Arbitrary personal GLB import and structural-object duplication are not included.
- Realism assets load lazily (~21.2 MB), are reused across edits, and fall back gracefully if unavailable. No AI server, API key or third-party runtime requests. The rendering mode uses the existing undo stack and browser persistence.
- **Deploy the entire build output**, including the optional asset directory; copying only the generated HTML omits the new textures/models. [Sources, licensing, limits and architecture](docs/REALISTIC-ASSETS.md).
- **שמירת קובץ** now embeds images, core textures/models and additionally selected models. IndexedDB caches assets across reloads; portable import can restore an empty cache. Supported browsers can choose a local file for debounced, serialized automatic backup. Browser cache is not a backup: keep the exported file safe and wait for successful-write status before closing.

## Action history / היסטוריית פעולות

- **ביטול** (Undo), **שוב** (Redo), and **היסטוריה** are available in the main toolbar and the 2D editor. The history dialog lists actions and lets you restore any retained step, including redo steps.
- **Ctrl/Cmd+Z** undoes; **Ctrl/Cmd+Shift+Z** or **Ctrl+Y** redoes. Native inputs keep their own editing shortcuts. Tab/Shift+Tab cycle within the history dialog, skipping disabled controls. Escape closes it and restores its launcher focus, including inside the 2D editor.
- All project changes share one stack: inspector/quick edits, chat commands, 2D moves/resizes/deletions, sun/view settings, reference images, import, and reset. A drag or a continuous focused-field edit is one action; unchanged values and clicks do not add steps.
- A new edit after undo discards the redo branch. Undo/redo automatically save the restored model using the existing browser storage.
- The last **100 actions** are retained **in memory for this page session**. Reloading starts a fresh stack from the saved project; history is not exported. Camera movement/zoom, selections, and chat transcripts are not rolled back (model changes made through chat are).

## Precision 2D plan editor / עריכת תוכנית

- **עורך 2D** opens a viewport-contained modal. Select walls, effective openings, room labels, or independent furniture/appliances on the plan or with **בחירת אובייקט**. Mobile properties expand below a separately usable canvas.
- Draft numeric coordinates are global **plan metres after dwelling scaling/rotation**, not source coordinates or true-north bearings. Metres/millimetres are presentation only; numeric increments are 10 mm. Submit applies one validated command; invalid drafts preserve the model and show a Hebrew error.
- Dragging previews locally until release. Escape, pointer cancellation/lost capture, blur, closing, context changes or undo discard a draft without restoring an old snapshot. A valid release is one action in the existing shared 100-action history.
- Wall polygons use model thickness and hatching; effective apertures remove the wall footprint beneath window/glazing frames and schematic door swings. Furniture details use the same logical parts as the model; kitchen sinks, cooktops, fridges, dishwashers and chairs are independently editable. Added items are bounded schematic concepts.
- **Rotation:** select furniture/appliances, a wall, room, opening or staircase on the plan or in **בחירת אובייקט**. The **סיבוב** panel offers ±15° / ±90° buttons and an exact angle from −180° to 180°. With the canvas focused, **R / Shift+R** rotates the selection ±15°; native inputs and browser shortcuts are untouched. Each committed rotation is one undoable, locally saved action.
- Angles are local-plan degrees, clockwise positive, before dwelling scaling/rotation. Local dimensions remain unchanged; nonuniform dwelling scale can change displayed dimensions when an object turns. Walls rotate around their midpoint with all hosted openings (selecting a door/window rotates its host wall, not a detached symbol). Rooms rotate their schematic footprint and inherited furniture, not surrounding walls or separately edited furniture.
- **PowerPoint-style handles:** select an object to show its outline and circular rotation handle on a stem. Drag the circle for a live angle preview; hold **Shift** to snap to 15°. Release commits one action. Escape, lost capture, pointer cancellation, blur or undo cancels the preview. The handle stays touch-sized when zooming and can also be focused and adjusted with arrow keys (1°, or 15° with Shift; Home resets the angle).
- **Move stairways:** drag the staircase body; a selected stairway remains draggable even when walls overlap it. The existing 25 cm grid snap applies to its center. Exact **מרכז מדרגות X/Z** fields are also available. Move and rotation share the stairwell pivot and apply to both available connections in that unit; treads, directional symbols and destination-floor cutouts use the same transformed geometry in 2D and 3D. Changing the straight/U alternative preserves angle and position. Old projects retain the original position and zero rotation. Placement is conceptual and still requires collision, structural and code review.
- Use cursor wheel zoom, **התאמה**, the pan tool, arrow buttons, or focus the canvas and use arrows, +/− and Home. Grid, wall/opening, furniture, label and dimension layers are local; hidden layers cannot be picked. Short dimension-chain labels are suppressed until zoomed in; exact object values remain in properties.
- Fit reserves screen-pixel gutters for dimension text/ticks, independent of building scale and rotation. Pan buttons occupy a separate strip outside the SVG. The grid stays hairline at close zoom. Room text that crosses its room or covers furniture/stairs is culled (also when selected); full Hebrew names remain in the object list and selected properties. This affects annotations only, never room or fixture geometry.
- **מדידה** accepts two plan clicks or numeric endpoints. Distances are world-metric, temporary, and clear on geometry/unit/floor changes, not zoom. The floor readout distinguishes elevation, storey height and clear height.
- Stair alternatives show **straight single-flight** versus **U** at the same scale, with footprint, rise and 18 rises. Choose the displayed basement–ground or ground–first connection explicitly. The toggle applies per unit to both available connections. The longer straight footprint may cross rooms/walls: fit, interference, headroom, building-code and structural validity are **not** checked.
- Symbols and dimensions are model-derived, not measurements from screenshots. This is a conceptual editor, not DWG/Revit/BIM or construction-document parity. There is no backend.

## 3D CAD integration / מדידה ועריכה בתלת־ממד

- **מדידה בתלת־ממד** is in the model stage, not the main toolbar. Two short surface clicks create world-space markers and a line, with XYZ distance, horizontal distance and absolute vertical difference in metres (two decimals). Background, reference images, outlines, hidden ancestors and visually clipped surfaces cannot create points. A drag is not a point.
- Surface measurement and double-click picking respect the camera's near/far render planes using camera-space depth, including oblique views; invisible geometry outside that depth range cannot be picked.
- The unit/floor controls show nominal storey height, clear height and elevation; they are readout context, not a restriction on which visible surface may be measured. **חלופה נגישה: נקודות XYZ מספריות** accepts finite world coordinates within ±1000 m. Y is vertical; these numeric endpoints need not lie on surfaces.
- Measurements are temporary: geometry, transforms, floor/context changes, import, reset and undo/redo clear them. Camera zoom, time and rendering style do not. They never enter persistence or the shared model history. During measurement, model keyboard/walk/pointer movement and double-click editing pause; explicit zoom controls remain reachable. Close the toggle to resume navigation/chat.
- Double-click an opening, furniture/appliance, stair or wall for the shared numeric CAD properties and a highlighted world bounding box. Wall/window/furniture changes remain independent; openings stay hosted. Building/neighbor quick actions remain available on their other surfaces. The 2D object list is the keyboard-accessible selection alternative.
- Quick properties dock to the right, below navigation, with a fixed close/header and a bounded scrolling form. Measurement distance and floor heights stay above its scrolling form even after numeric submit. Stage notices and expandable warnings occupy their own status row rather than covering view modes or zoom controls.
- Straight/U stair choices are also discoverable in the building Inspector and staircase quick editor, using the same shared geometry and per-unit setting. Placement and stair safety still require professional review.
- Deleted base **and added** openings retain zero-dimension tombstones. Startup facade/default migrations respect either zero width or zero height, including fresh-device import without migration flags. Added records (including deleted ones) count toward the 200-item limit. Seeded furniture overrides allow ±150 local metres to cover all legal room-relative placement; added-item overrides, new items, rooms and walls retain their stricter boundaries.
- Browser quota/unavailable-storage failures show a visible warning instead of a saved-success claim. A failed import save leaves the current model/session unchanged. Save a local file before closing if browser persistence fails.

## Mouse-free view navigation

- Use the vertical **Zoom** slider on the left of the 3D view, or its large **+ / −** buttons. Higher on the slider means closer.
- Press **+** (or **=**) to zoom in and **−** to zoom out; numeric-keypad **+ / −** also work. Hold a key to repeat.
- **Arrow keys** pan the camera in orbit and top views. In walk mode, **Up/Down** move forward/backward and **Left/Right** strafe, preserving the existing collision limits, **WASD**, and **Page Up/Page Down** height controls.
- Select **סיור בחדר** (walk mode) to enter the room; keyboard focus moves to the canvas automatically. Tap for a small step or hold for continuous walking. **Q/E** turn left/right without a mouse; dragging the canvas looks around from a fixed eye position, like a first-person game.
- The four walk buttons occupy a separate, unscaled 44px control row above the viewer. Zoom stays in the left slot and chat in the right slot; walking guidance remains in the bottom status row. Entering measurement or leaving walk mode removes the walk row without changing navigation behavior.
- Tab to the zoom slider and use **Up/Down**, **Home/End**, or **+ / −**. While the slider is focused, arrows adjust zoom rather than move the camera.
- Shortcuts leave text fields and other native inputs alone, preserve **Ctrl/Cmd/Alt** browser shortcuts, and pause while an editor or modal is open. Click or Tab back to the canvas to navigate after editing.
- Mouse-wheel zoom remains available and stays synchronized with the slider. Walk-mode zoom magnifies the view without moving through walls. The camera view and walk zoom are saved locally; older saved views still load.

### Walking between floors / עלייה וירידה במדרגות

- In **סיור בחדר**, normal arrows, **WASD**, and the four press-and-hold walk buttons follow connected stairs automatically, in either direction. **Q/E** or a canvas drag turns the view; turn across the actual U landing yourself. There is no automatic turn or floor teleport. Camera direction, optical zoom and the selected room are preserved; the status row reports the current floor/stair context.
- **Page Up / Page Down** explicitly control free height and take precedence over automatic stepping, including combined keys. Releasing them does not drop the camera to a floor. Full-body clearance remains active, including walls hidden by cutaway/isolation. A missing floor, flight side, central gap, low ceiling, closed door or too-narrow stair stops movement rather than moving through it.
- On a connected stair and within 22 cm of its exit, free height uses the destination floor's permitted headroom, not the last tread's eye level. Away from stairs the legacy floor limits remain unchanged. Elevated exit bookmarks preserve their height; descending to floor contact allows normal supported walking again. The full capsule still blocks ceilings and slabs throughout.
- Tested default route: enter **יחידה ב׳ → סלון** on the ground floor. In source-plan metres, walk from **(2.70, 14.40)** toward **(4.59, 14.40)**, then toward the U entrance at **(4.59, 10.45)**. Follow the lower flight to the landing at approximately **(4.59, 7.40)**, cross to **(5.79, 7.40)**, turn 180°, and follow the returning flight to **(5.79, 10.45)** on the first floor. Reverse the same route to descend. These are plan coordinates before the default 14.7° north rotation, not camera/world XYZ. The default ground-origin U includes a visible 10 cm entry apron inside its existing stairwell footprint.
- Additional complete-scene test fixtures use only the public stair position/rotation controls: north U at its original center rotated **180°**; south straight at center **(7, 10.5)**, **−90°**, for both connections; north straight at **(4, 4)**, **90°**, for ground–first, or **(6, 2)**, **90°**, for basement–ground. Layout changes apply to both connections, so a placement that clears one connection is not a promise that the other clears it.
- The **default north U ground approach is physically obstructed** by the party/east walls (12 cm / 5 cm residual clearances). Walking never disables those walls. Use a genuinely clear placement or another route; the blocked status is not a construction-safety assessment.
- Mid-stair, landing, upper-floor and free-height bookmarks are reconstructed from actual geometry, not the room selector. Harmless time/material rebuilds preserve valid positions. If model edits make a position invalid, movement stops: **המיקום אינו תקף להליכה. בחרו חדר ולחצו על כניסה לחדר.** Re-enter explicitly; there is no search for a distant safe point. Touch release/cancel/lost capture, blur, hidden page, measurement and dialogs clear movement intent.
- Runtime regressions cover exact camera preservation plus subsequent movement after in-session date/time, model and display rebuilds; moved-stair invalidation and explicit room/mode recovery; and importing a mid-stair bookmark reached by real walking. Browser cases run once per configured desktop/mobile project, without nested device profiles.
- Implementation is local and transient: no project schema, history entries, server or dependency changes. Owned triangle snapshots and ordered support corridors rebuild with architecture. A world-radius 22 cm foot-to-head capsule uses continuous triangle-distance sweeps; oversized requests are rejected atomically. This is conservative navigation, not gravity, pathfinding, building-code or structural validation. [Helper regressions](src/lib/supportedWalk.test.ts), [actual-scene regressions](src/scene/walkWorld.test.ts), and [real desktop/mobile browser routes](e2e/stair-walk.spec.ts) are companion tests; existing navigation and CAD tests remain unchanged.

## Local AI software factory

Eight native Copilot agents plan, review, implement, test, and visually validate local
backlog items. The supervisor is TypeScript, uses the existing npm toolchain, and
never automatically commits, pushes, or deploys.

See [the factory guide](docs/FACTORY.md) for setup and commands. Add features to
[BACKLOG.md](BACKLOG.md) or [tasks.json](tasks.json); the sample task is disabled.
Run `npm run factory:doctor`, then `npm run factory:start` for background polling.

Use `npm run factory:live` for an updating terminal view, or `npm run factory:web`
and open http://127.0.0.1:4318 for live status, task editing, queue controls, notes,
and verification evidence. Both are local tools; the deployed house app is unchanged.