# Ground Blueprint Revision

## Source and Calibration

The local single-page **קומת קרקע.pdf** supplies the revised ground floor. It is
1130.64 by 1188.84 PDF points. The original multi-floor PDF still supplies first-floor
and basement walls and reference images.

Ground calibration uses the printed **1145 cm** internal width between the facade's
inner faces at PDF X 579.9157104492188 and 904.7896118164062. The resulting scale is
**28.373266494950876 PDF points/metre**. Ground origin is PDF
**(573.673583984375, 478.11798095703125)**. Each floor image uses its own scale and
origin, so changing the ground reference does not move the other reference plans.

The extractor selects 28 wall vector groups on the red, blue and green CAD layers,
not pixels from a screenshot. Filled rectangles are solid piers, not openings.
Source selection is specific to this drawing: a changed group count fails extraction
and requires review. It is not a general-purpose architectural PDF parser.

## Updated Geometry

| Item | Revised default |
| --- | --- |
| North kitchen | 3.71 x 6.52 m |
| North safe room | 3.03 x 2.90 m |
| North bathroom | 2.00 x 1.70 m |
| Bathroom entry | 2.00 x 1.00 m |
| South kitchen | 3.68 x 3.10 m |
| South guest WC | 2.00 x 1.00 m |
| South living zone | 5.15 x 3.62 m |
| North facade glazing | Three 3.20 m openings |
| North east glazing | 3.20 m opening |
| Safe-room east window | 1.40 m opening |

The safe room and bathroom are accessed from the north dwelling in this revision.
The former north guest WC is removed. The party boundary steps around the service
rooms instead of following a straight horizontal line across the entire house.
Both floor polygons share that boundary without overlap. Shared wall records remain
independently editable for each dwelling.

Stair footprints follow the revised ground plan. The existing model shares one
footprint between a unit's two stair connections, so destination slab cutouts in the
basement/first-floor connections also change. Their source walls and room catalogs
otherwise remain unchanged; vertical alignment has not been certified from revised
upper-floor or section drawings.

## Saved Projects

Fresh defaults no longer inject the previous concept glazing/window overrides.
Existing custom overrides and added openings are preserved, not silently reset.
The original ground wall/opening catalog and exact retired room/furniture IDs are
accepted only at validation boundaries. Retired records, deletions and material
assignments remain exportable but do not render. IDs still present in the new model
retain their saved overrides; these can intentionally differ from measured defaults.

## Reproduction and Checks

With both local PDFs and PyMuPDF installed in the existing virtual environment:

```powershell
.\.venv\Scripts\python.exe scripts/prepare_plans.py
npm test -- src/model/groundRevision.test.ts src/lib/project.groundRevision.test.ts
npm run test:e2e -- e2e/ground-revision.spec.ts
```

Generated source metadata and registered ground images live in `src/assets`.
Tests cover measured dimensions, room ownership, shared-wall continuity, nonoverlapping
footprints, independent calibration, obsolete default suppression, strict saved-project
compatibility, and desktop/mobile property readouts.

## Accuracy Limits

Coordinates and widths are rounded to centimetres. Heights, window sills, 18 stair
rises, furniture and appliance positions, landscaping, site surfaces, roof concepts,
neighbor geometry and north bearing remain existing assumptions. Open-plan room
rectangles are editable annotations, not additional physical partitions. The PDF
reference includes site detail, but this update does not constitute a surveyed
reconstruction of all exterior/site works. This simulator is not construction-ready
BIM, a dimensional survey, or a structural/building-code assessment.