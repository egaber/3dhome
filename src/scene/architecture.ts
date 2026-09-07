import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import type { MultiPolygon } from 'polygon-clipping';
import { buildWallGeometry, normalizeApertures } from '../lib/wallGeometry';
import {
  BALCONIES, BASE_DEPTH, BASE_WIDTH, FOOTPRINTS, LIGHT_WELLS, PARTY_Z, SITE, SLAB,
  STAIR_HOLES, floorElevation, planPoint, resolvedOpenings, resolvedRooms, resolvedWalls, wallHeight, wallScale,
} from '../model/plans';
import type { FloorId, OpeningSpec, Room, SimulationState, UnitId, Vec2 } from '../model/types';

export interface Palette {
  background: string; surface: string; soft: string; border: string; text: string;
  muted: string; accent: string; success: string; warning: string; link: string; wall: string;
}
export interface Architecture {
  group: THREE.Group;
  blockers: THREE.Mesh[];
  pickables: THREE.Mesh[];
  materials: THREE.Material[];
}
type MeshMeta = { unit?: UnitId; floor?: FloorId; role?: string; blockerName?: string; openingId?: string; neighborId?: string };

export function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const value = (name: string) => style.getPropertyValue(`--cp-${name}`).trim();
  return { background: value('bg'), surface: value('surface'), soft: value('surface-soft'), border: value('border'), text: value('text'), muted: value('text-muted'), accent: value('accent'), success: value('success'), warning: value('warning'), link: value('link'), wall: value('building-wall') };
}

/** Every render colour derives from the artifact's CSS theme tokens. */
function mix(a: string, b: string, amount: number) { return new THREE.Color(a).lerp(new THREE.Color(b), amount); }
export const polygon = (ring: Vec2[]): MultiPolygon => [[ring]];

export function slabGeometry(polygons: MultiPolygon, depth: number): THREE.ExtrudeGeometry {
  const shapes = polygons.map(rings => {
    const toPath = (ring: Vec2[], path: THREE.Shape | THREE.Path) => {
      ring.forEach(([x, z], i) => { if (i === 0) path.moveTo(x, -z); else path.lineTo(x, -z); });
      path.closePath();
      return path;
    };
    const shape = toPath(rings[0], new THREE.Shape()) as THREE.Shape;
    shape.holes = rings.slice(1).map(ring => toPath(ring, new THREE.Path()));
    return shape;
  });
  const geometry = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function roofGeometry(width: number, depth: number, rise: number) {
  const x = width / 2, z = depth / 2;
  const positions = new Float32Array([-x, 0, -z, x, 0, -z, x, 0, z, -x, 0, z, 0, rise, -z, 0, rise, z]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex([0, 3, 5, 0, 5, 4, 4, 5, 2, 4, 2, 1, 0, 4, 1, 3, 2, 5, 0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  return geo;
}

export function buildArchitecture(state: SimulationState, palette: Palette): Architecture {
  const group = new THREE.Group();
  group.name = 'Plan-registered architecture';
  group.rotation.y = -THREE.MathUtils.degToRad(state.northBearing);
  const blockers: THREE.Mesh[] = [];
  const pickables: THREE.Mesh[] = [];
  const materials: THREE.Material[] = [];
  const allOpenings = resolvedOpenings(state);
  const allWalls = resolvedWalls(state);
  const allRooms = resolvedRooms(state);
  const realistic = state.view.renderMode === 'realistic';
  const grassTexture = (() => {
    if (!realistic) return null;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
    const context = canvas.getContext('2d')!;
    context.fillStyle = mix(palette.success, palette.background, .42).getStyle(); context.fillRect(0, 0, 96, 96);
    for (let index = 0; index < 850; index++) {
      context.fillStyle = mix(palette.success, palette.background, .18 + (index % 7) * .07).getStyle();
      context.fillRect((index * 47) % 96, (index * 31) % 96, 1, 2 + index % 3);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(5, 5);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  })();

  const material = (color: THREE.ColorRepresentation, options: THREE.MeshStandardMaterialParameters = {}) => {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: realistic ? .68 : .84,
      metalness: realistic ? .03 : 0,
      side: THREE.DoubleSide,
      ...options,
    });
    mat.clipShadows = false; // Visual section planes MUST NOT open the building to sunlight.
    materials.push(mat);
    return mat;
  };
  const mesh = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material, meta: MeshMeta, opaque = true, edges = false) => {
    const object = new THREE.Mesh(geometry, mat);
    object.userData = { ...meta, opaque };
    object.castShadow = opaque;
    object.receiveShadow = true;
    parent.add(object);
    if (opaque) blockers.push(object);
    if (meta.unit || meta.openingId || meta.neighborId) pickables.push(object);
    if (edges) {
      const lineMat = new THREE.LineBasicMaterial({ color: palette.muted, transparent: true, opacity: .17 });
      materials.push(lineMat);
      const line = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), lineMat);
      line.userData = { ...meta, role: 'outline' };
      object.add(line);
    }
    return object;
  };
  const box = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, meta: MeshMeta, opaque = true) => {
    if (w <= 0 || h <= 0 || d <= 0) return null;
    const object = mesh(parent, new THREE.BoxGeometry(w, h, d), mat, meta, opaque);
    object.position.set(x, y + h / 2, z);
    return object;
  };

  // Ground is an actual opaque slab with holes for basements/light wells. Simply
  // drawing an infinite plane would incorrectly black out all basement windows.
  let ground: MultiPolygon = polygon([[-55, -50], [65, -50], [65, 60], [-55, 60]]);
  for (const unit of ['north', 'south'] as UnitId[]) {
    if (!state.buildings[unit].enabled) continue;
    const holes = [FOOTPRINTS.basement[unit], ...LIGHT_WELLS[unit]];
    for (const hole of holes) ground = polygonClipping.difference(ground, polygon(hole.map(p => planPoint(p, unit, state))));
  }
  const earth = mesh(group, slabGeometry(ground, .18), material(mix(palette.background, palette.border, .12)), { role: 'terrain', blockerName: 'קרקע אטומה מחוץ לחצר האנגלית' });
  earth.position.y = -.18;

  const surface = (ring: Vec2[], color: THREE.ColorRepresentation, y = .008, opacity = 1, grass = false) => {
    const surf = mesh(group, slabGeometry(polygon(ring), .008), material(color, {
      transparent: opacity < 1, opacity, depthWrite: opacity === 1,
      ...(grass && grassTexture ? { map: grassTexture, roughness: .98 } : {}),
    }), { role: grass ? 'grass' : 'landscape' }, false);
    surf.position.y = y;
    return surf;
  };
  surface([[0, -12], [9.8, -12], [9.8, -5.2], [0, -5.2]], realistic ? palette.success : mix(palette.success, palette.background, .78), .008, 1, true);
  surface([[0, 16.2], [9.3, 16.2], [9.3, 19.3], [8.4, 19.3], [8.4, 21.6], [7.5, 21.6], [7.5, 18.15], [0, 18.15]], realistic ? palette.success : mix(palette.success, palette.background, .78), .008, 1, true);
  surface([[0, -5.2], [9.8, -5.2], [9.8, -1.5], [0, -1.5]], mix(palette.border, palette.background, .65));
  surface([[9.7, 10.35], [11.8, 10.35], [11.8, 22], [9.7, 22]], mix(palette.border, palette.background, .7));
  surface([[.3, 19.35], [7.3, 19.35], [7.3, 21.55], [.3, 21.55]], mix(palette.link, palette.surface, .7), .016);
  // Shared street on the south side, matching the plan rather than a random map tile.
  surface([[-48, 22.4], [55, 22.4], [55, 30], [-48, 30]], mix(palette.muted, palette.background, .63), -.012);
  surface([[-45, 22.15], [55, 22.15], [55, 23.5], [-45, 23.5]], mix(palette.border, palette.background, .6), -.003);
  for (let x = -38; x < 50; x += 6) surface([[x, 26.2], [x + 2.3, 26.2], [x + 2.3, 26.29], [x, 26.29]], palette.background, .003);

  const borderMat = new THREE.LineDashedMaterial({ color: palette.accent, dashSize: .45, gapSize: .28, transparent: true, opacity: .8 });
  materials.push(borderMat);
  const siteBorder = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(SITE.left, .06, SITE.back), new THREE.Vector3(SITE.right, .06, SITE.back),
    new THREE.Vector3(SITE.right, .06, SITE.front), new THREE.Vector3(SITE.left, .06, SITE.front), new THREE.Vector3(SITE.left, .06, SITE.back),
  ]), borderMat);
  siteBorder.computeLineDistances();
  siteBorder.userData = { role: 'site-border' };
  group.add(siteBorder);

  // Two opaque 3 m boundary walls along the long sides of the lot. They are
  // physical blockers, so both the rendered shadows and room ray tests include them.
  const boundaryMat = material(mix(palette.surface, palette.border, .34));
  const boundaryDepth = SITE.front - SITE.back;
  const boundaryCenterZ = (SITE.front + SITE.back) / 2;
  for (const [x, name] of [[SITE.left, 'חומת מגרש מערבית'], [SITE.right, 'חומת מגרש מזרחית']] as const) {
    box(group, .20, 3, boundaryDepth, x, 0, boundaryCenterZ, boundaryMat,
      { role: 'boundary-wall', blockerName: `${name} · 3.0 מ׳` }, true);
  }
  box(group, SITE.right - SITE.left, 3, .20, (SITE.left + SITE.right) / 2, 0, SITE.back, boundaryMat,
    { role: 'boundary-wall', blockerName: 'חומת מגרש צפונית · 3.0 מ׳' }, true);

  // Front boundary of the street-facing dwelling: low wall, gate opening and
  // a full-height bin pillar/niche, based on the submitted street context.
  const frontWallMat = material(mix(palette.surface, palette.border, .30));
  const binMat = material(mix(palette.text, palette.muted, .22));
  box(group, 8.45, 1.25, .24, 4.225, 0, 21.78, frontWallMat,
    { role: 'front-wall', blockerName: 'חומת הבית הקדמי · 1.25 מ׳' }, true);
  box(group, 1.15, 1.85, 1.05, 8.95, 0, 21.35, frontWallMat,
    { role: 'bin-pillar', blockerName: 'פילר פחי אשפה · 1.85 מ׳' }, true);
  box(group, .46, .82, .62, 8.72, .08, 21.02, binMat, { role: 'bin' }, false);
  box(group, .46, .82, .62, 9.18, .08, 21.02, binMat, { role: 'bin' }, false);
  box(group, SITE.right - 12.15, 1.25, .24, (SITE.right + 12.15) / 2, 0, 21.78, frontWallMat,
    { role: 'front-wall', blockerName: 'חומת חזית לצד שער החניה' }, true);

  // Full-size Tesla Model Y reference: 4.75 × 1.92 × 1.62 m. It is placed
  // longitudinally on the paved driveway shown at the east side of the plan.
  const car = new THREE.Group();
  car.name = 'Tesla Model Y · full scale 4.75 x 1.92 x 1.62 m';
  car.position.set(10.75, 0, state.vehicles.southZ);
  group.add(car);
  const carPaint = material(mix(palette.text, palette.surface, .26), { roughness: .32, metalness: .38 });
  const carGlass = material(mix(palette.text, palette.link, .14), { transparent: true, opacity: .72, roughness: .12, metalness: .22 });
  const tire = material(mix(palette.text, palette.background, .08), { roughness: .94 });
  box(car, 1.92, .58, 4.75, 0, .34, 0, carPaint, { role: 'vehicle', blockerName: 'Tesla Model Y' }, true);
  const cabin = box(car, 1.68, .72, 2.62, 0, .92, -.12, carGlass, { role: 'vehicle-cabin', blockerName: 'Tesla Model Y' }, true);
  if (cabin) cabin.scale.set(.92, 1, .94);
  for (const x of [-.96, .96]) for (const z of [-1.52, 1.52]) {
    const wheel = mesh(car, new THREE.CylinderGeometry(.37, .37, .22, 24), tire, { role: 'vehicle-wheel' }, false);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, .37, z);
    wheel.castShadow = true;
  }
  const northCar = car.clone(true);
  northCar.name = 'Tesla Model Y · north entrance · full scale';
  northCar.position.set(13.65, 0, state.vehicles.northZ);
  group.add(northCar);

  // Human scale references. Heights include the head and are deliberately
  // different so the model can be judged against typical adults.
  const addPerson = (x: number, z: number, height: number) => {
    const person = new THREE.Group();
    person.name = `אדם · ${height.toFixed(2)} מ׳`;
    person.position.set(x, 0, z);
    group.add(person);
    const personMat = material(mix(palette.accent, palette.surface, .22));
    const skinMat = material(mix(palette.warning, palette.surface, .54));
    const headRadius = height * .075;
    const legHeight = height * .43;
    const torsoHeight = height - legHeight - headRadius * 2;
    for (const offset of [-height * .065, height * .065]) {
      const leg = mesh(person, new THREE.CylinderGeometry(height * .045, height * .055, legHeight, 12), personMat, { role: 'person' }, false);
      leg.position.set(offset, legHeight / 2, 0);
      leg.castShadow = true;
    }
    const torso = mesh(person, new THREE.CylinderGeometry(height * .12, height * .16, torsoHeight, 16), personMat, { role: 'person' }, false);
    torso.position.y = legHeight + torsoHeight / 2;
    torso.castShadow = true;
    const head = mesh(person, new THREE.SphereGeometry(headRadius, 18, 12), skinMat, { role: 'person' }, false);
    head.position.y = height - headRadius;
    head.castShadow = true;
  };
  addPerson(8.15, 18.1, 1.75);
  addPerson(8.0, -2.7, 1.65);

  for (const unit of ['north', 'south'] as UnitId[]) {
    const settings = state.buildings[unit];
    if (!settings.enabled) continue;
    const house = new THREE.Group();
    house.name = unit;
    house.position.set(settings.x, 0, PARTY_Z + settings.z);
    house.rotation.y = -THREE.MathUtils.degToRad(settings.rotation);
    house.scale.set(settings.width / BASE_WIDTH, 1, settings.depth / BASE_DEPTH[unit]);
    group.add(house);
    const localRing = (ring: Vec2[]): Vec2[] => ring.map(([x, z]) => [x, z - PARTY_Z]);
    const floors: FloorId[] = settings.storeys === 2 ? ['basement', 'ground', 'first'] : ['basement', 'ground'];
    for (const floor of floors) {
      const elevation = floorElevation(floor, settings);
      const openPlanFirst = unit === 'north' && floor === 'first' && settings.firstFloorVariant === 'open-plan';
      const meta: MeshMeta = { unit, floor, blockerName: `מעטפת ${floor === 'ground' ? 'קומת הקרקע' : floor === 'first' ? 'הקומה הראשונה' : 'המרתף'}` };
      const plaster = material(palette.wall);
      const ceiling = material(mix(palette.surface, palette.border, .08));
      const floorMat = material(mix(palette.background, palette.border, .17));
      const frameMat = material(mix(palette.text, palette.muted, .3), { roughness: .5, metalness: .3 });
      const glassMat = material(mix(palette.surface, palette.link, .17), { transparent: true, opacity: .16, depthWrite: false, roughness: .15, metalness: .06 });
      let floorShape: MultiPolygon = polygon(localRing(FOOTPRINTS[floor][unit]));
      if (floor === 'first' && !openPlanFirst) floorShape = polygonClipping.union(floorShape, ...BALCONIES[unit].map(r => polygon(localRing(r))));
      if (floor !== 'basement') floorShape = polygonClipping.difference(floorShape, polygon(localRing(STAIR_HOLES[unit])));
      const slab = mesh(house, slabGeometry(floorShape, SLAB), floorMat, { ...meta, role: 'slab', blockerName: 'תקרת/רצפת בטון' });
      slab.position.y = elevation - SLAB;

      if (floor === 'first' && !openPlanFirst) {
        const balconyGlass = material(mix(palette.surface, palette.link, .14), {
          transparent: true, opacity: .28, depthWrite: false, roughness: .12, metalness: .06,
        });
        const railHeight = 1.05;
        for (const balcony of BALCONIES[unit]) {
          const ring = localRing(balcony);
          for (let index = 0; index < ring.length; index++) {
            const a = ring[index], b = ring[(index + 1) % ring.length];
            const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (length < .05) continue;
            const rail = box(house, length, railHeight, .035, (a[0] + b[0]) / 2, elevation, (a[1] + b[1]) / 2,
              balconyGlass, { ...meta, role: 'glass-railing' }, false);
            if (rail) {
              rail.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
              rail.castShadow = true;
            }
          }
        }
      }

      if (floor === 'basement') {
        for (const well of LIGHT_WELLS[unit]) {
          const floorMesh = mesh(house, slabGeometry(polygon(localRing(well)), .12), floorMat, { ...meta, role: 'well', blockerName: 'רצפת חצר אנגלית' });
          floorMesh.position.y = elevation - .12;
        }
      }

      const addOpening = (wallGroup: THREE.Group, opening: OpeningSpec, center: number, width: number, sill: number, height: number, thick: number) => {
        if (width <= 0 || height <= 0) return;
        const data = { ...meta, openingId: opening.id, role: 'opening', blockerName: opening.shutter ? 'תריס סגור' : opening.kind === 'door' && !opening.open ? 'דלת סגורה' : 'מסגרת פתח' };
        const frame = Math.min(.052, width / 6, height / 6);
        // The dark reveal is geometry on the edges, not a dark rectangle painted
        // over a solid wall. Glass transmits direct rays; shutters/doors do not.
        box(wallGroup, frame, height, thick + .03, center - width / 2 + frame / 2, sill, 0, frameMat, data);
        box(wallGroup, frame, height, thick + .03, center + width / 2 - frame / 2, sill, 0, frameMat, data);
        box(wallGroup, width, frame, thick + .03, center, sill + height - frame, 0, frameMat, data);
        if (opening.kind !== 'door' && opening.kind !== 'void') box(wallGroup, width, frame, thick + .03, center, sill, 0, frameMat, data);
        const isOpaque = opening.shutter || (opening.kind === 'door' && !opening.open);
        if (isOpaque) {
          const opaqueMat = material(mix(palette.muted, palette.background, .24));
          box(wallGroup, width - frame * 2, height - frame, .06, center, sill, 0, opaqueMat, data, true);
        } else if (opening.kind !== 'void' && opening.kind !== 'door') {
          box(wallGroup, width - 2 * frame, height - 2 * frame, .012, center, sill + frame, 0, glassMat, data, false);
          if (opening.kind === 'glazing' && width > 1.7) box(wallGroup, frame * .6, height - frame * 2, .06, center, sill + frame, 0, frameMat, data);
        }
        if (opening.overhang > .01) {
          const canopy = box(wallGroup, width + .25, .10, opening.overhang * 2 + thick, center, sill + height + .08, 0, ceiling, { ...data, role: 'canopy', blockerName: 'גגון הפתח' });
          if (canopy) canopy.userData.twoSidedCanopy = true;
        }
      };

      for (const wall of openPlanFirst ? [] : allWalls.filter(w => w.unit === unit && w.floor === floor)) {
        const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
        const height = wallHeight(wall, settings);
        const openings = allOpenings.filter(o => o.wallId === wall.id);
        const apertures = normalizeApertures(length, height, openings.map(o => ({ id: o.id, center: o.position * length, width: o.width / wallScale(wall, state), height: o.height, sill: o.sill })));
        const wallGroup = new THREE.Group();
        wallGroup.position.set(wall.a[0], elevation, wall.a[1] - PARTY_Z);
        wallGroup.rotation.y = -Math.atan2(wall.b[1] - wall.a[1], wall.b[0] - wall.a[0]);
        house.add(wallGroup);
        const object = mesh(wallGroup, buildWallGeometry(length, height, wall.thickness, apertures), plaster, { ...meta, role: 'wall', blockerName: wall.retaining ? 'קיר חצר אנגלית' : wall.exterior ? 'קיר חיצוני' : 'מחיצה פנימית' }, true, true);
        object.userData.wallId = wall.id;
        for (const aperture of apertures) {
          const opening = openings.find(o => o.id === aperture.id)!;
          addOpening(wallGroup, opening, aperture.center, aperture.width, aperture.sill, aperture.height, wall.thickness);
        }
      }

      if (openPlanFirst) {
        const height = settings.upperHeight - SLAB;
        const altMeta = { ...meta, role: 'wall', blockerName: 'קיר חלופת קומה א׳ הפתוחה' };
        const altWall = (a: Vec2, b: Vec2, mat = plaster) => {
          const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const wall = box(house, length, height, .18, (a[0] + b[0]) / 2, elevation,
            (a[1] + b[1]) / 2 - PARTY_Z, mat, altMeta, true);
          if (wall) wall.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
        };
        const altGlass = material(mix(palette.surface, palette.link, .14), {
          transparent: true, opacity: .23, depthWrite: false, roughness: .1, metalness: .06,
        });
        const altGlazing = (a: Vec2, b: Vec2) => {
          const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const glass = box(house, length, 2.55, .025, (a[0] + b[0]) / 2, elevation,
            (a[1] + b[1]) / 2 - PARTY_Z, altGlass, { ...meta, role: 'glazing' }, false);
          if (glass) glass.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
        };
        // 12 × 7.2 m concept fitted to the measured 12.39 × 6.84 m shell.
        altWall([0, 0], [0, PARTY_Z]);
        altWall([0, PARTY_Z], [11.9, PARTY_Z]);
        altWall([0, 0], [.45, 0]);
        altGlazing([.45, 0], [4.0, 0]);
        altWall([4.0, 0], [4.3, 0]);
        altGlazing([4.3, 0], [8.1, 0]);
        altWall([8.1, 0], [8.4, 0]);
        altGlazing([8.4, 0], [11.9, 0]);
        altWall([11.9, 0], [11.9, .45]);
        altGlazing([11.9, .45], [11.9, 5.8]);
        altWall([11.9, 5.8], [11.9, PARTY_Z]);
        // Service room and compact WC shown along the south edge of the sketch.
        altWall([0, 4.55], [2.8, 4.55]);
        altWall([2.8, 4.55], [2.8, PARTY_Z]);
        altWall([9.25, 5.05], [11.9, 5.05]);
        altWall([9.25, 5.05], [9.25, PARTY_Z]);
        const deck = mesh(house, slabGeometry(polygon([[11.9, -PARTY_Z], [14.9, -PARTY_Z], [14.9, 0], [11.9, 0]]), .10),
          material(mix(palette.warning, palette.surface, .68)), { ...meta, role: 'balcony' }, false);
        deck.position.y = elevation - .08;
        const balconyRail = box(house, PARTY_Z, 1.05, .035, 14.9, elevation, -PARTY_Z / 2,
          altGlass, { ...meta, role: 'glass-railing' }, false);
        if (balconyRail) { balconyRail.rotation.y = Math.PI / 2; balconyRail.castShadow = true; }

        const furnitureMat = material(mix(palette.surface, palette.border, .22));
        const sofaMat = material(mix(palette.surface, palette.text, .15));
        // 4 × 1.2 m island, dining table and two sofas from the submitted plan.
        box(house, 1.2, .92, 4.0, 1.75, elevation, 2.25 - PARTY_Z, furnitureMat, { ...meta, role: 'furniture' }, false);
        box(house, 1.15, .08, 2.35, 5.0, elevation + .73, 2.25 - PARTY_Z, furnitureMat, { ...meta, role: 'furniture' }, false);
        box(house, 2.1, .72, .85, 8.0, elevation, 2.0 - PARTY_Z, sofaMat, { ...meta, role: 'furniture' }, false);
        box(house, 2.1, .72, .85, 10.25, elevation, 2.0 - PARTY_Z, sofaMat, { ...meta, role: 'furniture' }, false);
      }

      if (floor !== (settings.storeys === 2 ? 'first' : 'ground')) {
        const hole = STAIR_HOLES[unit];
        const xmin = hole[0][0], xmax = hole[1][0], zmin = hole[0][1], zmax = hole[2][1];
        const rise = floor === 'basement' ? settings.basementDepth : settings.groundHeight;
        const tread = (zmax - zmin - .72) / 9;
        const stepMat = material(mix(palette.border, palette.background, .35));
        const flightWidth = (xmax - xmin - .13) / 2;
        for (let i = 0; i < 9; i++) {
          box(house, flightWidth, .10, tread + .012, xmin + flightWidth / 2, elevation + rise / 18 * (i + 1) - .1, zmax - .1 - tread * (i + .5) - PARTY_Z, stepMat, { ...meta, role: 'stair', blockerName: 'מדרגות' });
          box(house, flightWidth, .10, tread + .012, xmax - flightWidth / 2, elevation + rise / 18 * (i + 10) - .1, zmin + .72 + tread * (i + .5) - PARTY_Z, stepMat, { ...meta, role: 'stair', blockerName: 'מדרגות' });
        }
        box(house, xmax - xmin, .12, .72, (xmin + xmax) / 2, elevation + rise / 2 - .12, zmin + .36 - PARTY_Z, stepMat, { ...meta, role: 'stair', blockerName: 'פודסט מדרגות' });
      }

      if (floor !== 'basement' && !openPlanFirst) {
        for (const room of allRooms.filter(r => r.unit === unit && r.floor === floor)) {
          const furniture = new THREE.Group();
          furniture.position.set(room.center[0], elevation + .03, room.center[1] - PARTY_Z);
          house.add(furniture);
          const mat = material(mix(palette.surface, palette.border, .27));
          const detail = material(mix(palette.background, palette.muted, .20));
          const furnitureMeta = { ...meta, role: 'furniture' };
          const add = (w: number, h: number, d: number, x: number, y: number, z: number, m = mat) => box(furniture, w, h, d, x, y, z, m, furnitureMeta, false);
          if (room.kind === 'bedroom') {
            add(1.45, .32, 1.95, 0, 0, .14, detail); add(1.41, .18, 1.92, 0, .32, .13);
            add(.52, .08, .35, -.38, .5, -.56); add(.52, .08, .35, .38, .5, -.56);
            add(1.55, .87, .12, 0, 0, -.84, detail);
          } else if (room.kind === 'living') {
            add(2.15, .38, .82, 0, 0, .9, detail); add(2.15, .39, .18, 0, .38, 1.2, detail);
            add(.17, .2, .82, -1, .38, .9); add(.17, .2, .82, 1, .38, .9);
            add(1.0, .34, .52, 0, 0, -.15, detail);
          } else if (room.kind === 'dining') {
            add(1.6, .08, .85, 0, .74, 0);
            for (const x of [-.64, .64]) for (const z of [-.3, .3]) add(.06, .74, .06, x, 0, z, detail);
            for (const x of [-.55, .55]) for (const z of [-.68, .68]) { add(.42, .44, .4, x, 0, z, detail); add(.42, .35, .045, x, .44, z + (z < 0 ? -.18 : .18)); }
          } else if (room.kind === 'kitchen') {
            add(.62, .90, Math.min(2.7, room.depth - .3), -room.width / 2 + .38, 0, 0, detail);
            add(.68, .035, Math.min(2.7, room.depth - .3) + .04, -room.width / 2 + .38, .9, 0);
          }
        }
      }
    }

    const roofFloor = settings.storeys === 2 ? 'first' : 'ground';
    let roofShape = polygon(localRing(FOOTPRINTS[roofFloor][unit]));
    if (settings.storeys === 2) roofShape = polygonClipping.difference(roofShape, ...BALCONIES[unit].map(ring => polygon(localRing(ring))));
    const roofBase = settings.groundHeight + (settings.storeys === 2 ? settings.upperHeight : 0);
    const roofColor = mix(palette.surface, palette.border, .20);
    const roofMat = material(roofColor, {
      emissive: roofColor,
      emissiveIntensity: .62,
    });
    if (settings.roofEnabled && settings.storeys === 2) {
      const roofGroup = new THREE.Group();
      roofGroup.userData = { unit, displayFloor: 'roof', role: 'roof-floor' };
      house.add(roofGroup);
      const terraceMat = material(mix(palette.warning, palette.surface, .72));
      const enclosed: Vec2[] = unit === 'north'
        ? [[1.5, 2.2], [9.1, 2.2], [9.1, 5.3], [1.5, 5.3]]
        : [[1.2, 8.0], [8.5, 8.0], [8.5, 13.0], [1.2, 13.0]];
      const terraceNorth: Vec2[] = unit === 'north' ? [[0, 0], [11.8, 0], [11.8, 2.15], [0, 2.15]] : [[0, PARTY_Z], [11.8, PARTY_Z], [11.8, 7.9], [0, 7.9]];
      const terraceEast: Vec2[] = [[unit === 'north' ? 9.15 : 8.55, enclosed[0][1]], [11.8, enclosed[0][1]], [11.8, enclosed[2][1]], [unit === 'north' ? 9.15 : 8.55, enclosed[2][1]]];
      const terraceSouth: Vec2[] | null = unit === 'south'
        ? [[0, 13.05], [11.8, 13.05], [11.8, 16.12], [0, 16.12]]
        : null;
      const roofSlab = mesh(roofGroup, slabGeometry(polygon(localRing(FOOTPRINTS.first[unit])), SLAB), roofMat,
        { unit, floor: 'first', role: 'roof-floor-slab', blockerName: 'רצפת קומת גג' }, true, true);
      roofSlab.position.y = roofBase - SLAB;
      for (const terrace of [terraceNorth, terraceEast, ...(terraceSouth ? [terraceSouth] : [])]) {
        const deck = mesh(roofGroup, slabGeometry(polygon(localRing(terrace)), .035), terraceMat,
          { unit, floor: 'first', role: 'roof-terrace' }, false);
        deck.position.y = roofBase + .01;
      }
      const terraceGlass = material(mix(palette.surface, palette.link, .18), {
        transparent: true, opacity: .30, depthWrite: false, roughness: .10, metalness: .08,
      });
      const addTerraceRail = (a: Vec2, b: Vec2) => {
        const localA: Vec2 = [a[0], a[1] - PARTY_Z];
        const localB: Vec2 = [b[0], b[1] - PARTY_Z];
        const length = Math.hypot(localB[0] - localA[0], localB[1] - localA[1]);
        const rail = box(roofGroup, length, 1.05, .04, (localA[0] + localB[0]) / 2, roofBase,
          (localA[1] + localB[1]) / 2, terraceGlass, { unit, floor: 'first', role: 'glass-railing' }, false);
        if (rail) {
          rail.rotation.y = -Math.atan2(localB[1] - localA[1], localB[0] - localA[0]);
          rail.castShadow = true;
        }
      };
      // Glass only on exposed terrace edges: north, east, and the enlarged
      // south edge of the street-facing dwelling.
      addTerraceRail(terraceNorth[0], terraceNorth[1]);
      addTerraceRail(terraceEast[1], terraceEast[2]);
      if (terraceSouth) addTerraceRail(terraceSouth[2], terraceSouth[3]);
      const enclosedLocal = localRing(enclosed);
      const suiteMat = material(palette.wall);
      const officeMat = material(mix(palette.wall, palette.link, .04));
      const [x0, z0] = enclosedLocal[0], [x1, z1] = enclosedLocal[2];
      const width = x1 - x0, depth = z1 - z0;
      const roomHeight = settings.roofFloorHeight - SLAB;
      const roofRoomMeta = { unit, floor: 'first' as FloorId, role: 'roof-room', blockerName: 'קירות קומת הגג' };
      const wallThickness = .18;
      const northGap = Math.min(2.25, width * .29);
      const eastGap = Math.min(2.4, depth * .42);
      // Perimeter walls with genuine north/east glazing gaps, rather than solid
      // room boxes, so the suite and office remain navigable in 3D.
      box(roofGroup, wallThickness, roomHeight, depth, x0, roofBase, z0 + depth / 2, suiteMat, roofRoomMeta, true);
      box(roofGroup, width, roomHeight, wallThickness, x0 + width / 2, roofBase, z1, suiteMat, roofRoomMeta, true);
      const northPier = (width - 2 * northGap) / 3;
      for (let index = 0; index < 3; index++) {
        box(roofGroup, northPier, roomHeight, wallThickness,
          x0 + northPier / 2 + index * (northPier + northGap), roofBase, z0,
          index === 2 ? officeMat : suiteMat, roofRoomMeta, true);
      }
      box(roofGroup, wallThickness, roomHeight, (depth - eastGap) / 2,
        x1, roofBase, z0 + (depth - eastGap) / 4, officeMat, roofRoomMeta, true);
      box(roofGroup, wallThickness, roomHeight, (depth - eastGap) / 2,
        x1, roofBase, z1 - (depth - eastGap) / 4, officeMat, roofRoomMeta, true);
      const dividerX = x0 + width * .62;
      box(roofGroup, wallThickness, roomHeight, depth - 1.05, dividerX, roofBase, z0 + (depth - 1.05) / 2,
        officeMat, { ...roofRoomMeta, blockerName: 'מחיצה בין סוויטת ההורים למשרד' }, true);
      const suiteFloor = mesh(roofGroup, slabGeometry(polygon([[x0, z0], [dividerX, z0], [dividerX, z1], [x0, z1]]), .025), suiteMat,
        { unit, floor: 'first', role: 'roof-suite' }, false);
      suiteFloor.position.y = roofBase + .015;
      const officeFloor = mesh(roofGroup, slabGeometry(polygon([[dividerX, z0], [x1, z0], [x1, z1], [dividerX, z1]]), .025), officeMat,
        { unit, floor: 'first', role: 'roof-office' }, false);
      officeFloor.position.y = roofBase + .015;
      const glass = material(mix(palette.surface, palette.link, .18), { transparent: true, opacity: .18, depthWrite: false });
      for (let index = 0; index < 2; index++) {
        box(roofGroup, northGap, roomHeight - .25, .025,
          x0 + northPier + northGap / 2 + index * (northPier + northGap), roofBase + .12, z0, glass,
          { unit, floor: 'first', role: 'roof-glazing' }, false);
      }
      box(roofGroup, .025, roomHeight - .25, eastGap, x1, roofBase + .12, z0 + depth / 2, glass,
        { unit, floor: 'first', role: 'roof-glazing' }, false);
      const rise = Math.max(.1, settings.roofPeakHeight - (roofBase + settings.roofFloorHeight));
      const pitched = mesh(roofGroup, roofGeometry(width + .35, depth + .35, rise), roofMat,
        { unit, floor: 'first', role: 'roof-peak', blockerName: `גג משופע · שפיץ ${settings.roofPeakHeight.toFixed(2)} מ׳` }, true, true);
      pitched.position.set((x0 + x1) / 2, roofBase + settings.roofFloorHeight, (z0 + z1) / 2);
    } else {
      const roof = mesh(house, slabGeometry(roofShape, SLAB), roofMat, { unit, floor: roofFloor, role: 'roof', blockerName: 'גג אטום (גם במצב חתך)' }, true, true);
      roof.position.y = roofBase - SLAB;
    }
    if (settings.parapet > .01 && !(settings.roofEnabled && settings.storeys === 2)) {
      const parapetMat = material(mix(palette.surface, palette.border, .11));
      for (const rings of roofShape) for (const ring of rings) {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = ring[i], b = ring[i + 1];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < .03) continue;
          const parapet = mesh(house, new THREE.BoxGeometry(len, settings.parapet, .15), parapetMat, { unit, floor: roofFloor, role: 'roof', blockerName: 'מעקה גג' });
          parapet.position.set((a[0] + b[0]) / 2, roofBase + settings.parapet / 2, (a[1] + b[1]) / 2);
          parapet.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
        }
      }
    }
  }

  for (const neighbor of state.neighbors) {
    if (!neighbor.enabled) continue;
    const mass = new THREE.Group();
    mass.position.set(neighbor.x, 0, neighbor.z);
    mass.rotation.y = -THREE.MathUtils.degToRad(neighbor.rotation);
    group.add(mass);
    const rise = Math.max(0, Math.min(neighbor.roofRise, neighbor.height - .5));
    const eave = neighbor.height - rise;
    const neighborMat = material(mix(palette.border, palette.surface, .28));
    const roofMat = material(mix(palette.muted, palette.warning, .12));
    const meta = { role: 'neighbor', neighborId: neighbor.id, blockerName: `${neighbor.name} · ${neighbor.height.toFixed(1)} מ׳` };
    box(mass, neighbor.width, eave, neighbor.depth, 0, 0, 0, neighborMat, meta);
    const roof = mesh(mass, roofGeometry(neighbor.width + .28, neighbor.depth + .28, rise), roofMat, meta, true, true);
    roof.position.y = eave;
    // Facade cues only. Neighbor volumes stay opaque, conservative obstructions.
    const windowMat = material(mix(palette.muted, palette.surface, .2));
    for (const side of [-1, 1]) for (const y of [1.35, 4.55]) for (const z of [-.3, .15, .38]) {
      if (y + 1.3 >= eave) continue;
      box(mass, .016, 1.25, 1.45, side * (neighbor.width / 2 + .012), y, neighbor.depth * z, windowMat, { role: 'neighbor-detail' }, false);
    }
  }

  group.updateMatrixWorld(true);
  return { group, blockers, pickables, materials };
}

export function roomSamplePoints(room: Room, state: SimulationState): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const settings = state.buildings[room.unit];
  for (const x of [-.28, 0, .28]) for (const z of [-.28, 0, .28]) {
    const p = planPoint([room.center[0] + x * room.width, room.center[1] + z * room.depth], room.unit, state);
    const r = -THREE.MathUtils.degToRad(state.northBearing);
    points.push(new THREE.Vector3(p[0] * Math.cos(r) + p[1] * Math.sin(r), floorElevation(room.floor, settings) + .08, -p[0] * Math.sin(r) + p[1] * Math.cos(r)));
  }
  return points;
}

/** CPU ray tests deliberately ignore display sectioning and material opacity. */
export function directExposure(points: THREE.Vector3[], direction: THREE.Vector3, blockers: THREE.Mesh[], aboveHorizon: boolean) {
  if (!aboveHorizon) return { lit: 0, total: points.length, cause: 'השמש מתחת לאופק', statuses: points.map(() => false) };
  const ray = new THREE.Raycaster(undefined, undefined, .006, 500);
  const causes = new Map<string, number>();
  const statuses = points.map(point => {
    ray.set(point, direction);
    const first = ray.intersectObjects(blockers, false)[0];
    if (!first) return true;
    const reason: string = first.object.userData.blockerName || 'מעטפת המבנה';
    causes.set(reason, (causes.get(reason) || 0) + 1);
    return false;
  });
  const lit = statuses.filter(Boolean).length;
  const cause = lit === points.length ? 'שמש ישירה בכל נקודות הדגימה' : [...causes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'חסימה גאומטרית';
  return { lit, total: points.length, cause, statuses };
}

export function disposeArchitecture(architecture: Architecture) {
  const geometries = new Set<THREE.BufferGeometry>();
  architecture.group.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) geometries.add(object.geometry);
  });
  geometries.forEach(geometry => geometry.dispose());
  new Set(architecture.materials).forEach(mat => {
    if (mat instanceof THREE.MeshStandardMaterial) {
      mat.map?.dispose(); mat.normalMap?.dispose(); mat.roughnessMap?.dispose(); mat.aoMap?.dispose();
    }
    mat.dispose();
  });
  architecture.group.removeFromParent();
}