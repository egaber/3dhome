# South Dwelling: Family Option

The option requested on 2026-10-05 retains the rear/north dwelling and replaces
only the ground/first-floor presentation of the front/south dwelling. Open the
combined sheets and activate "חלופה דרומית". Both floors can be viewed
together, exported as SVG/PDF, or opened individually in the existing 3D viewer.

## Proposed First Floor

The source marked a **5.90 x 3.65 m** south suite zone. The livability revision
reassigns part of that rectangle to the stair arrival, so the suite is now stepped,
not a 5.90 x 3.65 m clear room. Exterior floor polygons and balcony positions are
unchanged. Current annotation dimensions at base scale are:

| Space | Proposed clear annotation size |
| --- | --- |
| Parents' sleeping area | 3.66 x 2.99 m |
| Dressing area | 2.12 x 1.50 m |
| Private bathroom | 2.12 x 2.03 m |
| Child room 1 | 2.43 x 4.00 m |
| Child room 2 | 2.99 x 3.58 m |
| Shared WC/bathroom | 2.62 x 1.69 m |

The shared bathroom has a 1.70 x 0.75 m bath, WC and basin; the ensuite has a
shower, WC and basin. Each child's room, the shared bathroom and the parents'
suite have separate hall doors. Dressing and ensuite access are inside the suite.
Desk and door positions avoid the initially identified fixture conflicts.

The stepped northeast recess and southeast terrace follow the image approximately.
All partition sizes, window sizes and sill heights, balcony sizes, bath layout,
door swings, hall widths and absolute registration are proposals, not measurements
certified from a CAD file. Stair widths and passage/headroom compliance require
professional review. The annotation rectangles are not statutory net areas.

## Ground and Stairs

The ground option retains the existing stepped ground envelope and guest WC near
the entrance, removes the old central stair partitions, and places the kitchen
counter on the upper boundary, the island to its south, dining in the middle, and
living space toward the front garden.

The western stair is revised to a 2.20 x 3.53 m U footprint, with 1.00 m flights,
a 1.10 m landing and 0.27 m goings. There are 20 vertical rises: nine treads, the
landing, nine return treads and the upper floor. At the default 3.40 m storey height
each rise is 0.17 m. A 1.10 m arrival and protective low wall are modeled. These are
design targets, not certification; handrail detailing, clear width after finishes,
headroom, guarding, construction and all applicable local requirements need review.
The connection to the basement moves too and has not been architecturally coordinated.
The source-image safe room and adjoining bathroom keep their previous north-unit
ownership; no new ownership or door connection was inferred from the crop.

## Daily Use

The kitchen includes fridge, oven/microwave tower, sink, hob, adjacent dishwasher,
and a 1.74 x 0.85 m preparation island with two seats. Its rear work aisle is
approximately 1.21 m. Three dining chairs and a 1.90 m storage bench provide six
places without needing pull-out space behind the south dining seats.

Living furniture includes a sofa, armchair, compact coffee table, TV console and
book storage. The south garden opening is repositioned/resized to leave a solid
TV wall and a 0.90 m circulation band. Entry storage, bench and a stacked washer/
dryer sit beside the service area. Guest WC depth increases to 1.40 m internally.
The bedrooms have full-size beds, nightstands, desks/chairs for both children,
wardrobes/bookshelves, bathroom vanities and modeled light fittings. Linen storage
is in the dressing area, not the hall. The hall is 1.10 m near the stair with a
0.90 m transition by the shared bathroom. These are not wheelchair-accessibility
claims. Preserved user object edits or subsequent building scaling can change them.

## Editing and Persistence

The optional `buildings.south.southLayout = 'family'` selects the proposal.
New stable wall/room/furniture IDs prevent old edits from distorting the new layout.
Prior objects and added furniture stay in the project, but render only in their
own layout. New furniture added while this option is active gets
`layout = 'south-family'`; validation rejects this tag on other units/floors.

Activating the option explicitly resets the south stair to the proposed U position,
rotation and scale and enables its first floor. Other saved object edits, north
settings, site parameters and source catalogs are not deleted. Undo restores the
previous project, including its previous stair parameters. Reapplying the option
reapplies the proposed stair. Further changes to proposal objects are editable.

## Checks

Tests cover separate bedrooms and bathrooms, the suite size, room containment and
nonoverlap, host-door bounds, unchanged north geometry, original/proposal furniture
isolation, negative schema cases, and saved-project round trips. Three.js tests
raycast the actual slab, stair hole and room entrances. Browser coverage captures
desktop/mobile sheets, SVG/PDF exports, both 3D floors, canvas pixels, camera input,
chat draft preservation and reload persistence.

Livability tests also check furniture against walls, stair voids, other furniture
and door swing sectors; model-space circulation bands; required daily-use items;
and a real supported-walk round trip on the 20-riser stair. Embedded kitchen
appliances share their counter footprint intentionally; overhead lights are not
counted as floor obstacles. Tests do not validate drainage, services, construction
loads, approvals, universal accessibility or every furniture operation simultaneously.

This is a design option for discussion, not a construction drawing, structural
design, code-compliance assessment or approval of the existing party-wall arrangement.