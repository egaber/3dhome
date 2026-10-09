# Combined Duplex Plans

Open the combined plan sheet from the main toolbar, or use `?plans=combined` on
the application URL. Ground and first-floor sheets use the same saved project,
wall apertures, furniture symbols, stair geometry, and unit transforms as the
existing editor and Three.js viewer. No second architectural model is created.

## Source Decision

For the four reference images supplied on 2026-10-05, the user allowed either
ground-floor variant and approved keeping the existing project as the basis for
the connection between dwellings and the missing upper-floor information. The
third image's guest-WC-near-entry arrangement is the chosen reference. Existing
ground geometry is retained rather than replacing vector-derived dimensions
with measurements from cropped raster screenshots.

This is a coordinated presentation of the existing model, not a new verified
tracing of all four images. In particular, the existing ownership of the safe
room and bathroom, stepped party boundary, and first-floor room layouts remain
unchanged and require architectural confirmation. See BLUEPRINT-REVISION.md for
ground source calibration and prior revisions.

## Drawing and Export

- Both floors have a common drawing extent and graphic metre scale.
- Numbered room markers map to separate Hebrew schedules for each dwelling.
- Overall dimensions measure the model envelope, not the site or drawing margin.
- Room dimensions follow saved local rotations and nonuniform building scaling.
- Envelope areas include model walls and open areas; they are not net, statutory,
  or permit areas. Room rectangles are model annotations, not measured partitions.
- Disabled units, unavailable upper floors, and deleted objects are omitted.
- SVG export embeds resolved styles and the selected sheets' room schedules.
  It has no external image, font, script, or server dependency.
- Browser printing uses an A3 landscape layout and can be saved as PDF.
- Sheet controls do not edit project geometry or trigger background navigation.

## 3D Presentation

Full-building, ground-floor, and first-floor presets use the existing realistic
renderer. Presets change view settings only and fit the camera to the enabled
dwellings, including saved translations, rotations, north bearing, and viewport
aspect ratio. The full-building view includes the existing conceptual roofs and
site surroundings; isolated floors hide other floors through the existing viewer.
PNG export captures the current rendered canvas. No generation service is used.

Heights, roofs, furnishings, stairs, north bearing, landscaping, and vertical
coordination are model assumptions, not evidence of structural safety or code
compliance. The sheet states these limitations. It is not a construction drawing.

## Verification

```powershell
npm test -- src/lib/combinedPlan.test.ts src/lib/duplexPresentation.test.ts
npm run typecheck
npm run build
npm run test:e2e -- e2e/combined-plans.spec.ts
```

The browser tests exercise both desktop and mobile: floor/layer/zoom controls,
read-only behavior, modal return focus, unclipped controls, standalone SVG export,
PDF generation on desktop, each 3D preset, canvas color diversity, camera movement,
PNG downloads, and preservation of model geometry. Screenshots are captured for
visual review rather than automatically approved as baselines.