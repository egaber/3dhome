# Northern First-Floor Bedroom Plan

In **מבנה**, select the northern dwelling and choose **חלופת קומה א׳ בבית הצפוני
→ תוכנית מצורפת · 3 חדרים ו־3 רחצות**. The separate **מדרגות מול הכניסה**
button configures the northern stairs. Open **תוכנית משולבת**, select the northern
dwelling and first floor, then **תלת־ממד לקומה** to inspect the furnished plan.

## Scope and Source

The variant interprets the attached first-floor image supplied on 2026-10-06:
three bedrooms, three bathrooms, a laundry room, a northwest balcony, the central
stair zone and the passage to the southeast bedroom. Beds, desks, wardrobes,
bathroom fixtures and laundry equipment are independently editable.

The user explicitly approved assigning the southeast wing to the northern dwelling
in this variant only. The northern footprint extends to local Z=9.24 m east of
X=6.34 m. The remaining southern first-floor footprint is complementary, not an
overlapping room; the old eastern southern bedroom is inactive. Unaffected southern
walls and openings keep their IDs and saved edits. Trimmed boundary walls have
separate proposal IDs. Their original edits remain stored and return in the original
variant; they are not geometrically transferred to the new clipped boundary.

Other first-floor variants, both ground floors, both basements, southern stair
settings and unrelated saved edits remain available. The stair button intentionally
replaces only the northern stair placement, paths and protection settings. Choosing
the bedroom variant does not automatically replace manually edited stairs.

All positions, wall runs and dimensions are approximate alignment to the current
model, not a surveyed tracing. The 6.25 x 3.80 m master zone, 3.64 x 3.50 m western
bedroom and 1.10 m stair-side passage are model dimensions requiring confirmation.
The locally bundled first-floor PDF image is a different source and is unchanged.
It remains only a reference overlay, not the new drawing.

## Northern Stair Preset

**מדרגות מול הכניסה** uses a shared local pivot of (4.83, 4.655) m, rotation -90
degrees and scale 1. The ground-to-first path starts opposite the entrance and
turns right twice: landings after rises 7 and 11, 0.92 m flight/landing width and
0.24 m treads. The passage to the bedrooms stays outside its opening and guards.

The basement path is straight, including its inline landing: 0.92 m width,
0.25 m treads, landing after rise 9, relative rotation 90 degrees and relative
offset (0.3, 0.39) m. Its approximately 4.53 square metre ground opening is about
41% smaller than the original northern U opening. Only the incoming basement path
cuts the ground slab; the upper path does not create a second ground-floor hole.
Both paths retain 18 rises and the model's storey heights. Handrails and transparent
opening guards are enabled. See [stair controls](STAIR-EDITOR.md).

These are visualization settings, not approval of tread/riser proportions,
headroom, structural support, waterproofing, ventilation, accessibility or code
compliance. User changes to heights, transforms, walls or furniture may obstruct
previously clear routes; navigation does not remove obstacles automatically.

## Editing and Persistence

Variant objects have stable IDs in the editable catalogs. Original catalogs remain
unchanged. Added and duplicated northern first-floor furniture belongs to the
active variant, hides when another variant is selected and returns with its edits.
The existing version-1 browser/file format and shared undo/redo stack are used;
there is no backend, dependency or automatic migration.

**עורך 2D → הוספת ריהוט ומכשירים → שולחן אוכל עגול** adds a table with one
diameter input. It uses equal requested world dimensions even under unequal dwelling
scales; chairs are added separately. Invalid dimensions leave the model unchanged.

**יחידה לסיור** sits beside **סיור בחדר**. In orbit it selects a destination without
moving the camera. Starting the tour enters an available room in that dwelling;
switching dwellings while walking enters the new destination immediately. Entering
a room clears stale floor isolation. Disabled dwellings cannot be selected.

## Verification

```powershell
npm test -- src/model/northBedroomLayout.test.ts src/model/stairConnections.test.ts src/scene/northEntranceStairs.test.ts src/lib/roomTour.test.ts
npm run typecheck
npm run build
npm run test:e2e -- e2e/north-bedrooms.spec.ts
```

Tests cover variant isolation, complementary footprints, strict persistence,
unaffected southern edits, furniture duplication, relative transforms and invalid
inputs. Actual-scene tests walk from the entrance through both stairs in both
directions and from the upper hall to every bedroom, bathroom and laundry, with
walls, furniture, rails and glass intact. Every room-tour entry is checked for
floor support and collision clearance. These checks do not certify arbitrary edits.

Desktop/mobile browser tests cover activation, undo/redo, edited-object restoration,
reload, round tables under nonuniform scale, tour selection and floor isolation.
They capture real first-floor renders, verify nonblank canvas pixels and exercise
camera motion; screenshots must also be visually inspected.