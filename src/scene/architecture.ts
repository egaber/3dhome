import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import polygonClipping from 'polygon-clipping';
import type { MultiPolygon } from 'polygon-clipping';
import { createFinish, furnitureFinish, MODEL_ASSETS, projectSurfaceUV, SURFACE_ASSETS, type Finish } from './materialLibrary';
import type { RealisticAssets } from './realisticAssets';
import { disposeResources } from './resources';
import { FINISHES, surfaceTarget, type FinishId, type SurfaceFloor } from '../model/appearance';
import { buildWallGeometry } from '../lib/wallGeometry';
import { getWallApertures, resolveStairGeometry, type StairPart } from '../model/cad';
import { rotatePlanPoint } from '../model/rotation';
import { furnitureParts } from '../model/furnitureParts';
import { stairOpeningEdges, stairPortals, stairRailEdges, STAIR_GLASS_HEIGHT, STAIR_RAIL_HEIGHT } from '../model/stairSafety';
import { buildShowroomDetails } from './showroomDetails';
import { buildLandscape } from './landscape';
import { openingLeaves } from '../lib/doorInteraction';
import { batchDecorations } from './batchDecorations';
import {
  BASE_DEPTH, BASE_WIDTH, FOOTPRINTS, LIGHT_WELLS, PARTY_Z, SITE, SLAB,
  floorElevation, planPoint, resolvedFurniture, resolvedOpenings, resolvedRooms, resolvedWalls, resolvedFootprint, resolvedBalconies, wallHeight,
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
  /** Actual model surfaces only; caller filters ancestor visibility and visual clipping. */
  measurementTargets: THREE.Mesh[];
  materials: THREE.Material[];
}
export type MeshMeta = { unit?: UnitId; floor?: FloorId; role?: string; blockerName?: string; openingId?: string; neighborId?: string;
  wallId?: string; furnitureId?: string; landscapeId?: string; stairId?: string; fromFloor?: FloorId; toFloor?: FloorId | 'roof'; provenance?: 'concept' | 'proposal';
  partIndex?: number; partKind?: StairPart['kind'] };

export function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const value = (name: string) => style.getPropertyValue(`--cp-${name}`).trim();
  return { background: value('bg'), surface: value('surface'), soft: value('surface-soft'), border: value('border'), text: value('text'), muted: value('text-muted'), accent: value('accent'), success: value('success'), warning: value('warning'), link: value('link'), wall: value('building-wall') };
}

/** Diagram colours follow UI tokens; realistic physical finishes keep natural albedo. */
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

export function buildArchitecture(state: SimulationState, palette: Palette, assets?: RealisticAssets, showroom = false): Architecture {
  const group = new THREE.Group();
  group.name = 'Plan-registered architecture';
  group.rotation.y = -THREE.MathUtils.degToRad(state.northBearing);
  const blockers: THREE.Mesh[] = [];
  const pickables: THREE.Mesh[] = [];
  const measurementTargets: THREE.Mesh[] = [];
  const materials: THREE.Material[] = [];
  const allOpenings = resolvedOpenings(state);
  const allWalls = resolvedWalls(state);
  const allFurniture = resolvedFurniture(state);
  const realistic = state.view.renderMode === 'realistic';
  const grassTexture = (() => {
    if (!realistic || typeof document === 'undefined') return null;
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
  const finishes = new Map<Finish, THREE.MeshPhysicalMaterial>();
  const finish = (name: Finish) => {
    const cached = finishes.get(name);
    if (cached) return cached;
    const mat = createFinish(name);
    const surface = SURFACE_ASSETS.find(asset => asset.id === mat.userData.surface);
    const maps = surface && assets?.surfaces.get(surface.id);
    if (maps) {
      mat.map = maps.color; mat.roughnessMap = maps.roughness;
      if (maps.normal) { mat.normalMap = maps.normal; mat.normalScale.setScalar(surface.strength); }
      if (maps.height) { mat.bumpMap = maps.height; mat.bumpScale = surface.strength; }
    }
    if (showroom && (name === 'fabric' || name === 'plaster')) {
      mat.map = null; mat.color.set(name === 'fabric' ? 0xd5c4ad : 0xf3f0e9); mat.normalScale.setScalar(name === 'fabric' ? .15 : .05);
    }
    if (showroom && name === 'glass') { mat.opacity = .09; mat.roughness = .06; mat.envMapIntensity = .6; }
    finishes.set(name, mat); materials.push(mat);
    return mat;
  };
  const assigned = new Map<string, THREE.MeshPhysicalMaterial>();
  const assignedMaterial = (target: string, fallback: THREE.Material): THREE.Material => {
    const assignment = realistic && state.appearance?.assignments[target];
    if (!assignment) return fallback;
    const cached = assigned.get(target); if (cached) return cached;
    const builtin = FINISHES.includes(assignment.material as FinishId);
    const mat = builtin ? finish(assignment.material as FinishId).clone() : createFinish('paint');
    if (!builtin) { mat.color.set(0xffffff); mat.map = assets?.images.get(assignment.material) ?? null; }
    mat.roughness = assignment.roughness; mat.userData = { ...mat.userData, target, metres: assignment.metres };
    // A decorative glass finish never opens a physical wall/door to sunlight.
    assigned.set(target, mat); materials.push(mat); return mat;
  };
  const materialTarget = (meta: MeshMeta): string | null => meta.furnitureId ? `furniture-${meta.furnitureId}`
    : meta.openingId ? `opening-${meta.openingId}` : meta.stairId ? `stair-${meta.stairId}` : meta.wallId ? `wall-${meta.wallId}`
      : meta.neighborId ? `neighbor-${meta.neighborId}` : meta.unit ? `building-${meta.unit}` : null;
  const mesh = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material, meta: MeshMeta, opaque = true, edges = false) => {
    const target = materialTarget(meta);
    if (target) mat = assignedMaterial(target, meta.unit ? assignedMaterial(`building-${meta.unit}`, mat) : mat);
    const surface = SURFACE_ASSETS.find(asset => asset.id === mat.userData.surface);
    if (surface || mat.userData.metres) projectSurfaceUV(geometry, mat.userData.metres ?? surface!.metres);
    const object = new THREE.Mesh(geometry, mat);
    object.userData = { ...meta, opaque };
    object.castShadow = opaque || (realistic && meta.role === 'furniture' && mat.userData.finish !== 'glass');
    object.receiveShadow = true;
    parent.add(object);
    if (opaque) blockers.push(object);
    if (meta.unit || meta.openingId || meta.neighborId) pickables.push(object);
    if (meta.unit || meta.neighborId || ['terrain', 'boundary-wall', 'front-wall', 'bin-pillar', 'landscape', 'grass'].includes(meta.role ?? '')) measurementTargets.push(object);
    if (edges && !realistic) {
      const lineMat = new THREE.LineBasicMaterial({ color: palette.muted, transparent: true, opacity: .17 });
      materials.push(lineMat);
      const line = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), lineMat);
      line.userData = { ...meta, role: 'outline' };
      object.add(line);
    }
    return object;
  };
  const slabSurfaces = (object: THREE.Mesh, unit: UnitId, top: SurfaceFloor, bottom: SurfaceFloor | null) => {
    const original = Array.isArray(object.material) ? object.material[0] : object.material;
    const topId = surfaceTarget('floor', unit, top), bottomId = bottom && surfaceTarget('ceiling', unit, bottom);
    object.userData.floorTarget = topId; object.userData.ceilingTarget = bottomId;
    if (!realistic) return;
    const upper = assignedMaterial(topId, original), lower = bottomId ? assignedMaterial(bottomId, finish('plaster')) : original;
    // Distinct UV repeats for top and underside use geometry UV in metres and
    // material-local cloned texture transforms (never mutate the pooled maps).
    const faceMaterial = (source: THREE.Material) => {
      if (!(source instanceof THREE.MeshStandardMaterial)) return source;
      const m = source.clone();
      const scale = source.userData.metres ?? SURFACE_ASSETS.find(a => a.id === source.userData.surface)?.metres ?? 1;
      for (const slot of ['map', 'normalMap', 'roughnessMap'] as const) if (m[slot]) { m[slot] = m[slot]!.clone(); m[slot]!.repeat.setScalar(1 / scale); }
      materials.push(m); return m;
    };
    object.material = [faceMaterial(upper), faceMaterial(lower), original];
    const geometry = object.geometry; projectSurfaceUV(geometry, 1); geometry.clearGroups();
    const normals = geometry.getAttribute('normal'), count = geometry.index?.count ?? normals.count;
    let start = 0, materialIndex = -1;
    for (let i = 0; i < count; i += 3) {
      const n = normals.getY(geometry.index ? geometry.index.getX(i) : i);
      const next = n > .5 ? 0 : n < -.5 ? 1 : 2;
      if (next !== materialIndex) {
        if (materialIndex >= 0) geometry.addGroup(start, i - start, materialIndex);
        start = i; materialIndex = next;
      }
    }
    if (count) geometry.addGroup(start, count - start, materialIndex);
  };
  const box = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, meta: MeshMeta, opaque = true) => {
    if (w <= 0 || h <= 0 || d <= 0) return null;
    const geometry = realistic && meta.role === 'furniture'
    ? new RoundedBoxGeometry(w, h, d, showroom ? 4 : 2, Math.min(w, h, d) * (mat.userData.finish === 'fabric' ? (showroom ? .42 : .22) : .07))
      : new THREE.BoxGeometry(w, h, d);
    const object = mesh(parent, geometry, mat, meta, opaque);
    object.position.set(x, y + h / 2, z);
    return object;
  };

  // Ground is an actual opaque slab with holes for basements/light wells. Simply
  // drawing an infinite plane would incorrectly black out all basement windows.
  let ground: MultiPolygon = polygon([[-55, -50], [65, -50], [65, 60], [-55, 60]]);
  for (const unit of ['north', 'south'] as UnitId[]) {
    if (!state.buildings[unit].enabled) continue;
    if (state.design.importedPlan?.unit === unit) continue;
    // Union touching excavations BEFORE the affine transform. Repeated subtraction
    // of independently rounded shared edges can leave an unclosable output ring.
    const holes = polygonClipping.union(polygon(FOOTPRINTS.basement[unit]), ...LIGHT_WELLS[unit].map(polygon));
    const transformed = holes.map(rings => rings.map(ring => ring.map(p => planPoint(p, unit, state))));
    ground = polygonClipping.difference(ground, transformed);
  }
  const earth = mesh(group, slabGeometry(ground, .18), material(mix(palette.background, palette.border, .12)), { role: 'terrain', blockerName: 'קרקע אטומה מחוץ לחצר האנגלית' });
  earth.position.y = -.18;

  const surface = (ring: Vec2[], color: THREE.ColorRepresentation, y = .008, opacity = 1, grass = false) => {
    const grassMaps = grass && realistic ? assets?.surfaces.get('grass004') : undefined;
    const surfMaterial = material(grassMaps ? 0xffffff : color, {
      transparent: opacity < 1, opacity, depthWrite: opacity === 1,
      ...(grassMaps ? {
        map: grassMaps.color,
        roughnessMap: grassMaps.roughness,
        bumpMap: grassMaps.height,
        bumpScale: .045,
        roughness: .96,
      } : grass && grassTexture ? { map: grassTexture, roughness: .98 } : {}),
    });
    if (grassMaps) surfMaterial.userData = { surface: 'grass004', metres: 1.4 };
    const surf = mesh(group, slabGeometry(polygon(ring), .008), surfMaterial, { role: grass ? 'grass' : 'landscape' }, false);
    surf.position.y = y;
    if (grass && realistic) {
      const minX = Math.min(...ring.map(point => point[0])), maxX = Math.max(...ring.map(point => point[0]));
      const minZ = Math.min(...ring.map(point => point[1])), maxZ = Math.max(...ring.map(point => point[1]));
      const inside = (x: number, z: number) => {
        let hit = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i], b = ring[j];
          if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
        }
        return hit;
      };
      const step = .14, transforms: THREE.Matrix4[] = [];
      const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
      const bladeRotation = new THREE.Euler(), matrix = new THREE.Matrix4();
      let index = 0;
      for (let z = minZ + step / 2; z < maxZ; z += step) for (let x = minX + step / 2; x < maxX; x += step) {
        const seed = Math.sin(++index * 91.345) * 43758.5453, variation = seed - Math.floor(seed);
        const px = x + (variation - .5) * step * .72;
        const pz = z + ((variation * 17.17) % 1 - .5) * step * .72;
        if (!inside(px, pz)) continue;
        position.set(px, y + .01, pz);
        bladeRotation.set(0, variation * Math.PI * 2, (variation - .5) * .16);
        rotation.setFromEuler(bladeRotation);
        scale.set(.72 + variation * .55, .72 + ((variation * 7.31) % 1) * .6, 1);
        transforms.push(matrix.compose(position, rotation, scale).clone());
      }
      const bladeGeometry = new THREE.BufferGeometry();
      bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-.012, 0, 0, .012, 0, 0, 0, .12, 0], 3));
      bladeGeometry.computeVertexNormals();
      const bladeMaterial = new THREE.MeshStandardMaterial({
        color: 0x4f7f2c,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      bladeMaterial.clipShadows = false;
      materials.push(bladeMaterial);
      const blades = new THREE.InstancedMesh(bladeGeometry, bladeMaterial, transforms.length);
      transforms.forEach((transform, blade) => blades.setMatrixAt(blade, transform));
      blades.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      blades.castShadow = true;
      blades.receiveShadow = true;
      blades.userData = { role: 'grass-blades' };
      group.add(blades);
    }
    return surf;
  };
  if (!state.design.importedPlan) {
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
  const boundaryMat = realistic ? finish('plaster') : material(mix(palette.surface, palette.border, .34));
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
  const frontWallMat = realistic ? finish('plaster') : material(mix(palette.surface, palette.border, .30));
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
  }

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
    const floors: FloorId[] = state.design.importedPlan?.unit === unit ? ['ground'] : settings.storeys === 2 ? ['basement', 'ground', 'first'] : ['basement', 'ground'];
    for (const floor of floors) {
      const elevation = floorElevation(floor, settings);
      const openPlanFirst = unit === 'north' && floor === 'first' && settings.firstFloorVariant === 'open-plan';
      const meta: MeshMeta = { unit, floor, blockerName: `מעטפת ${floor === 'ground' ? 'קומת הקרקע' : floor === 'first' ? 'הקומה הראשונה' : 'המרתף'}` };
      const plaster = realistic ? finish('plaster') : material(palette.wall);
      const ceiling = material(mix(palette.surface, palette.border, .08));
      const floorMat = realistic ? finish(floor === 'first' ? 'wood' : 'tile') : material(mix(palette.background, palette.border, .17));
      const frameMat = realistic ? finish(showroom ? 'dark' : 'metal') : material(mix(palette.text, palette.muted, .3), { roughness: .5, metalness: .3 });
      const glassMat = realistic ? finish('glass') : material(mix(palette.surface, palette.link, .17), { transparent: true, opacity: .16, depthWrite: false, roughness: .15, metalness: .06 });
      let floorShape: MultiPolygon = polygon(localRing(resolvedFootprint(floor, unit, state)));
      if (floor === 'first' && !openPlanFirst) floorShape = polygonClipping.union(floorShape, ...resolvedBalconies(unit, state).map(r => polygon(localRing(r))));
      const incomingStair = floor === 'basement' ? null : resolveStairGeometry(state, unit, floor === 'ground' ? 'basement' : 'ground');
      if (incomingStair) floorShape = polygonClipping.difference(floorShape, polygon(localRing(incomingStair.footprint)));
      const slab = mesh(house, slabGeometry(floorShape, SLAB), floorMat, { ...meta, role: 'slab', blockerName: 'תקרת/רצפת בטון' });
      slab.position.y = elevation - SLAB;
      slabSurfaces(slab, unit, floor, floor === 'first' ? 'ground' : floor === 'ground' ? 'basement' : null);
      if (showroom && floor === 'ground' && unit === 'south' && !state.design.importedPlan) {
        const porch = mesh(house, slabGeometry(polygon(localRing([[9.49, 9.3], [11.85, 9.3], [11.85, 12.5], [9.49, 12.5]])), SLAB),
          realistic ? finish('tile') : floorMat, { unit, floor, role: 'entry-porch', blockerName: 'רצפת המבואה המקורה' }, true);
        porch.position.y = -SLAB;
      }

      if (floor === 'first' && !openPlanFirst) {
        const balconyGlass = material(mix(palette.surface, palette.link, .14), {
          transparent: true, opacity: .28, depthWrite: false, roughness: .12, metalness: .06,
        });
        const railHeight = 1.05;
        for (const balcony of resolvedBalconies(unit, state)) {
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
          if (showroom) {
            const grateMat = material(0x818787, { roughness: .58, metalness: .7, transparent: true, opacity: .42 });
            const grate = mesh(house, slabGeometry(polygon(localRing(well)), .035), grateMat,
              { unit, floor: 'ground', role: 'well-grate', blockerName: 'שבכת חצר אנגלית נושאת' }, false);
            grate.position.y = -.035;
            const xs = well.map(p => p[0]), zs = well.map(p => p[1]);
            const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
            const bars = material(0x666f6d, { roughness: .5, metalness: .7 });
            const count = Math.ceil((x1 - x0) / .08);
            const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(.012, .012, z1 - z0), bars, count);
            const matrix = new THREE.Matrix4();
            for (let index = 0; index < count; index++) rails.setMatrixAt(index, matrix.makeTranslation(x0 + index * .08, -.006, (z0 + z1) / 2 - PARTY_Z));
            rails.userData = { unit, floor: 'ground', role: 'grate-detail' };
            rails.receiveShadow = true; house.add(rails);
          }
        }
      }

      const addOpening = (wallGroup: THREE.Group, opening: OpeningSpec, center: number, width: number, sill: number, height: number, thick: number) => {
        if (width <= 0 || height <= 0) return;
        const data = { ...meta, wallId: opening.wallId, openingId: opening.id, role: 'opening', blockerName: opening.shutter ? 'תריס סגור' : opening.kind === 'door' && !opening.open ? 'דלת סגורה' : 'מסגרת פתח' };
        const frame = Math.min(.052, width / 6, height / 6);
        // The dark reveal is geometry on the edges, not a dark rectangle painted
        // over a solid wall. Glass transmits direct rays; shutters/doors do not.
        box(wallGroup, frame, height, thick + .03, center - width / 2 + frame / 2, sill, 0, frameMat, data);
        box(wallGroup, frame, height, thick + .03, center + width / 2 - frame / 2, sill, 0, frameMat, data);
        box(wallGroup, width, frame, thick + .03, center, sill + height - frame, 0, frameMat, data);
        if (opening.kind !== 'door' && opening.kind !== 'void') box(wallGroup, width, frame, thick + .03, center, showroom && sill < .15 ? -frame : sill, 0, frameMat, data);
        const isOpaque = opening.shutter || (opening.kind === 'door' && !opening.open);
        if (showroom && (opening.kind === 'door' || opening.kind === 'glazing')) {
          for (const leaf of openingLeaves(opening, { id: opening.id, center, width, sill, height })) {
            const mat = leaf.glass ? glassMat : finish(opening.shutter ? 'dark' : 'wood');
            const panel = box(wallGroup, leaf.width, leaf.height, leaf.depth, leaf.x, leaf.bottom, leaf.z, mat,
              { ...data, role: 'opening-leaf', blockerName: leaf.glass ? 'זיגוג סגור' : 'כנף דלת' }, !leaf.glass);
            if (panel) panel.rotation.y = leaf.rotation;
            if (opening.kind === 'door') {
              const leafGroup = new THREE.Group(); leafGroup.position.set(leaf.x, leaf.bottom, leaf.z); leafGroup.rotation.y = leaf.rotation; wallGroup.add(leafGroup);
              for (const z of [-.04, .04]) box(leafGroup, .14, .026, .045, leaf.width * .34, Math.min(1.02, leaf.height * .5), z, finish('metal'), { ...data, role: 'door-handle' }, false);
            }
          }
        } else if (isOpaque) {
          const opaqueMat = realistic ? finish(opening.shutter ? 'metal' : 'wood') : material(mix(palette.muted, palette.background, .24));
          box(wallGroup, width - frame * 2, height - frame, .06, center, sill, 0, opaqueMat, data, true);
          if (realistic && opening.kind === 'door' && !opening.shutter) {
            // Handle geometry is decorative: never changes the aperture/ray blocker.
            for (const z of [-.055, .055]) box(wallGroup, Math.min(.14, width * .18), .025, .04,
              center + width * .32, sill + Math.min(1.05, height * .5), z, finish('metal'), data, false);
          }
        } else if (opening.kind !== 'void' && opening.kind !== 'door') {
          box(wallGroup, width - 2 * frame, height - 2 * frame, .012, center, sill + frame, 0, glassMat, data, false);
          if (opening.kind === 'glazing' && width > 1.7) box(wallGroup, frame * .6, height - frame * 2, .06, center, sill + frame, 0, frameMat, data);
        }
        if (opening.overhang > .01) {
          const canopy = box(wallGroup, width + .25, .10, opening.overhang * 2 + thick, center, sill + height + .08, 0, ceiling, { ...data, role: 'canopy', blockerName: 'גגון הפתח' });
          if (canopy) canopy.userData.twoSidedCanopy = true;
        }
      };

      for (const wall of allWalls.filter(w => w.unit === unit && w.floor === floor)) {
        const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
        const height = wallHeight(wall, settings);
        const openings = allOpenings.filter(o => o.wallId === wall.id);
        const apertures = getWallApertures(wall, state);
        const wallGroup = new THREE.Group();
        wallGroup.position.set(wall.a[0], elevation, wall.a[1] - PARTY_Z);
        wallGroup.rotation.y = -Math.atan2(wall.b[1] - wall.a[1], wall.b[0] - wall.a[0]);
        house.add(wallGroup);
        mesh(wallGroup, buildWallGeometry(length, height, wall.thickness, apertures), plaster, { ...meta, role: 'wall', wallId: wall.id, provenance: wall.provenance, blockerName: wall.retaining ? 'קיר חצר אנגלית' : wall.exterior ? 'קיר חיצוני' : 'מחיצה פנימית' }, true, true);
        for (const aperture of apertures) {
          const opening = openings.find(o => o.id === aperture.id)!;
          addOpening(wallGroup, opening, aperture.center, aperture.width, aperture.sill, aperture.height, wall.thickness);
        }
      }

      if (openPlanFirst) {
        const altGlass = material(mix(palette.surface, palette.link, .14), {
          transparent: true, opacity: .23, depthWrite: false, roughness: .1, metalness: .06,
        });
        const deck = mesh(house, slabGeometry(polygon([[11.9, -PARTY_Z], [14.9, -PARTY_Z], [14.9, 0], [11.9, 0]]), .10),
          material(mix(palette.warning, palette.surface, .68)), { ...meta, role: 'balcony' }, false);
        deck.position.y = elevation - .08;
        const balconyRail = box(house, PARTY_Z, 1.05, .035, 14.9, elevation, -PARTY_Z / 2,
          altGlass, { ...meta, role: 'glass-railing' }, false);
        if (balconyRail) { balconyRail.rotation.y = Math.PI / 2; balconyRail.castShadow = true; }
      }

      const stair = resolveStairGeometry(state, unit, floor);
      if (stair) {
        const stepMat = realistic ? finish('stone') : material(mix(palette.border, palette.background, .35));
        for (const [partIndex, part] of stair.parts.entries()) {
          const tread = box(house, part.width, part.height, part.depth, part.center[0], part.bottom, part.center[1] - PARTY_Z, stepMat,
            { ...meta, role: 'stair', stairId: `stair-${unit}-${stair.fromFloor}`, fromFloor: stair.fromFloor, toFloor: stair.toFloor, partIndex, partKind: part.kind, blockerName: part.kind === 'landing' ? 'פודסט מדרגות' : 'מדרגות' });
          if (tread) tread.rotation.y = -THREE.MathUtils.degToRad(part.rotation ?? 0);
        }
        if (settings.stairRailing ?? settings.southLayout === 'family') {
          const railMat = realistic ? finish('dark') : frameMat;
          for (const edge of stairRailEdges(stair)) {
            const start = new THREE.Vector3(edge.a[0], edge.elevationA + STAIR_RAIL_HEIGHT, edge.a[1] - PARTY_Z);
            const end = new THREE.Vector3(edge.b[0], edge.elevationB + STAIR_RAIL_HEIGHT, edge.b[1] - PARTY_Z);
            const direction = end.clone().sub(start);
            const rail = mesh(house, new THREE.CylinderGeometry(.018, .018, direction.length(), 8), railMat,
              { ...meta, role: 'stair-guard', stairId: `stair-${unit}-${floor}` }, true);
            rail.position.copy(start).add(end).multiplyScalar(.5);
            rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
            box(house, .025, STAIR_RAIL_HEIGHT, .025, edge.a[0], edge.elevationA, edge.a[1] - PARTY_Z, railMat,
              { ...meta, role: 'stair-guard', stairId: `stair-${unit}-${floor}` }, true);
          }
        }
      }
      if (incomingStair && settings.stairOpeningGlass) {
        for (const edge of stairOpeningEdges(incomingStair, stair)) {
          const dx = edge.b[0] - edge.a[0], dz = edge.b[1] - edge.a[1];
          const glass = box(house, Math.hypot(dx, dz), STAIR_GLASS_HEIGHT, .016, (edge.a[0] + edge.b[0]) / 2,
            elevation, (edge.a[1] + edge.b[1]) / 2 - PARTY_Z, glassMat, { ...meta, role: 'stair-opening-glass' }, false);
          if (glass) glass.rotation.y = -Math.atan2(dz, dx);
        }
      }

      for (const item of allFurniture.filter(item => item.unit === unit && item.floor === floor)) {
        const furniture = new THREE.Group();
        furniture.position.set(item.center[0], elevation, item.center[1] - PARTY_Z);
        furniture.rotation.y = -THREE.MathUtils.degToRad(item.rotation);
        house.add(furniture);
        const furnitureMeta: MeshMeta = { ...meta, role: 'furniture', furnitureId: item.id };
        furniture.userData = furnitureMeta;
        const modelAsset = realistic && MODEL_ASSETS.find(asset => asset.kind === item.kind);
        const modelId = state.appearance?.models[item.id] ?? (modelAsset ? modelAsset.id : undefined);
        const template = realistic && modelId && assets?.models.get(modelId);
        if (template) {
          const model = template.clone(true);
          model.scale.set(item.width, item.height, item.depth);
          model.userData = { ...furnitureMeta, assetId: modelId };
          model.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return;
            object.userData = { ...furnitureMeta, assetId: modelId, opaque: false };
            const target = `furniture-${item.id}`;
            if (state.appearance?.assignments[target]) {
              const original = Array.isArray(object.material) ? object.material[0] : object.material;
              object.material = assignedMaterial(target, original);
              object.geometry = object.geometry.clone();
              projectSurfaceUV(object.geometry, state.appearance.assignments[target].metres);
            }
            object.castShadow = true; object.receiveShadow = true;
            pickables.push(object); measurementTargets.push(object);
            materials.push(...(Array.isArray(object.material) ? object.material : [object.material]));
          });
          furniture.add(model);
          continue;
        }
        const pickStart = pickables.length, measureStart = measurementTargets.length;
        const tones = realistic ? {
          body: finish(furnitureFinish(item.kind, 'body')), detail: finish(furnitureFinish(item.kind, 'detail')),
          surface: finish(furnitureFinish(item.kind, 'surface')), glass: finish('glass'),
        } : { body: material(mix(palette.surface, palette.border, .27)), detail: material(mix(palette.background, palette.muted, .20)),
          surface: material(palette.surface), glass: glassMat };
        for (const part of furnitureParts(item, showroom)) {
          if (part.shape === 'box') {
            box(furniture, part.width, part.height, part.depth, part.center[0], part.bottom, part.center[1], tones[part.tone], furnitureMeta, false);
          } else {
            const cylinder = mesh(furniture, new THREE.CylinderGeometry(1, 1, part.height, 24), tones[part.tone], furnitureMeta, false);
            cylinder.scale.set(part.width / 2, 1, part.depth / 2);
            cylinder.position.set(part.center[0], part.bottom + part.height / 2, part.center[1]);
          }
        }
        if (showroom) {
          const batched = batchDecorations(furniture, { ...furnitureMeta, opaque: false });
          pickables.splice(pickStart, pickables.length - pickStart, ...batched);
          measurementTargets.splice(measureStart, measurementTargets.length - measureStart, ...batched);
        }
      }
    }

    const roofFloor = settings.storeys === 2 ? 'first' : 'ground';
    let roofShape = polygon(localRing(resolvedFootprint(roofFloor, unit, state)));
    if (settings.storeys === 2) roofShape = polygonClipping.difference(roofShape, ...resolvedBalconies(unit, state).map(ring => polygon(localRing(ring))));
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
      const terraceMat = realistic ? finish('tile') : material(mix(palette.warning, palette.surface, .72));
      const enclosed: Vec2[] = unit === 'north'
        ? [[1.5, 2.2], [9.1, 2.2], [9.1, 5.3], [1.5, 5.3]]
        : [[1.2, 8.0], [8.5, 8.0], [8.5, 13.0], [1.2, 13.0]];
      const terraceNorth: Vec2[] = unit === 'north' ? [[0, 0], [11.8, 0], [11.8, 2.15], [0, 2.15]] : [[0, PARTY_Z], [11.8, PARTY_Z], [11.8, 7.9], [0, 7.9]];
      const terraceEast: Vec2[] = [[unit === 'north' ? 9.15 : 8.55, enclosed[0][1]], [11.8, enclosed[0][1]], [11.8, enclosed[2][1]], [unit === 'north' ? 9.15 : 8.55, enclosed[2][1]]];
      const terraceSouth: Vec2[] | null = unit === 'south'
        ? [[0, 13.05], [11.8, 13.05], [11.8, 16.12], [0, 16.12]]
        : null;
      const roofStair = resolveStairGeometry(state, unit, 'first');
      let roofFloorShape = polygon(localRing(resolvedFootprint('first', unit, state)));
      if (roofStair) roofFloorShape = polygonClipping.difference(roofFloorShape, polygon(localRing(roofStair.footprint)));
      const roofSlab = mesh(roofGroup, slabGeometry(roofFloorShape, SLAB), roofMat,
        { unit, floor: 'first', role: 'roof-floor-slab', blockerName: 'רצפת קומת גג' }, true, true);
      roofSlab.position.y = roofBase - SLAB;
      slabSurfaces(roofSlab, unit, 'roof', roofFloor);
      for (const terrace of [terraceNorth, terraceEast, ...(terraceSouth ? [terraceSouth] : [])]) {
        const terraceShape = roofStair ? polygonClipping.difference(polygon(localRing(terrace)), polygon(localRing(roofStair.footprint))) : polygon(localRing(terrace));
        const deck = mesh(roofGroup, slabGeometry(terraceShape, .035), terraceMat,
          { unit, floor: 'first', role: 'roof-terrace' }, false);
        deck.position.y = roofBase + .01;
        slabSurfaces(deck, unit, 'roof', null);
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
      const suiteMat = realistic ? finish('plaster') : material(palette.wall);
      const officeMat = realistic ? finish('plaster') : material(mix(palette.wall, palette.link, .04));
      const [x0, z0] = enclosedLocal[0], [x1, z1] = enclosedLocal[2];
      const width = x1 - x0, depth = z1 - z0;
      const roomHeight = settings.roofFloorHeight - SLAB;
      const roofRoomMeta = { unit, floor: 'first' as FloorId, role: 'roof-room', blockerName: 'קירות קומת הגג' };
      const wallThickness = .18;
      const clearance = roofStair && polygon(localRing(roofStair.footprint));
      const roofWall = (w: number, d: number, x: number, z: number, mat: THREE.Material) => {
        let footprint = polygon([[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2]]);
        if (clearance) footprint = polygonClipping.difference(footprint, clearance);
        if (!footprint.length) return;
        const wall = mesh(roofGroup, slabGeometry(footprint, roomHeight), mat, roofRoomMeta, true);
        wall.position.y = roofBase;
      };
      const northGap = Math.min(2.25, width * .29);
      const eastGap = Math.min(2.4, depth * .42);
      // Perimeter walls with genuine north/east glazing gaps, rather than solid
      // room boxes, so the suite and office remain navigable in 3D.
      roofWall(wallThickness, depth, x0, z0 + depth / 2, suiteMat);
      roofWall(width, wallThickness, x0 + width / 2, z1, suiteMat);
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
      if (roofStair) {
        const exit = stairPortals(roofStair).exit.center[1];
        const center = Math.max(z0 + .8, Math.min(z1 - .8, exit - PARTY_Z));
        if (center - .8 > z0) roofWall(wallThickness, center - .8 - z0, dividerX, (z0 + center - .8) / 2, officeMat);
        if (center + .8 < z1) roofWall(wallThickness, z1 - center - .8, dividerX, (z1 + center + .8) / 2, officeMat);
      } else box(roofGroup, wallThickness, roomHeight, depth - 1.05, dividerX, roofBase, z0 + (depth - 1.05) / 2,
        officeMat, { ...roofRoomMeta, blockerName: 'מחיצה בין סוויטת ההורים למשרד' }, true);
      const roofFinish = (ring: Vec2[]) => clearance ? polygonClipping.difference(polygon(ring), clearance) : polygon(ring);
      const suiteFloor = mesh(roofGroup, slabGeometry(roofFinish([[x0, z0], [dividerX, z0], [dividerX, z1], [x0, z1]]), .025), suiteMat,
        { unit, floor: 'first', role: 'roof-suite' }, false);
      suiteFloor.position.y = roofBase + .015;
      slabSurfaces(suiteFloor, unit, 'roof', null);
      const officeFloor = mesh(roofGroup, slabGeometry(roofFinish([[dividerX, z0], [x1, z0], [x1, z1], [dividerX, z1]]), .025), officeMat,
        { unit, floor: 'first', role: 'roof-office' }, false);
      officeFloor.position.y = roofBase + .015;
      slabSurfaces(officeFloor, unit, 'roof', null);
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
      slabSurfaces(pitched, unit, 'roof', 'roof');
    } else {
      const roof = mesh(house, slabGeometry(roofShape, SLAB), roofMat, { unit, floor: roofFloor, role: 'roof', blockerName: 'גג אטום (גם במצב חתך)' }, true, true);
      roof.position.y = roofBase - SLAB;
      slabSurfaces(roof, unit, 'roof', roofFloor);
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

  if (showroom && realistic) {
    const details = buildShowroomDetails(state, assets);
    group.add(details.group); materials.push(...details.materials);
    group.traverse(object => {
      if (['outline', 'site-border', 'person'].includes(object.userData.role)) object.visible = false;
    });
  }
  if (showroom || state.design.landscape) {
    const landscape = buildLandscape(state, assets);
    group.add(landscape.group); materials.push(...landscape.materials);
    pickables.push(...landscape.pickables); measurementTargets.push(...landscape.pickables);
  }
  if (showroom) batchDecorations(group, undefined, true);
  group.updateMatrixWorld(true);
  return { group, blockers, pickables, measurementTargets, materials };
}

export function roomSamplePoints(room: Room, state: SimulationState): THREE.Vector3[] {
  room = resolvedRooms(state).find(item => item.id === room.id) ?? room;
  const points: THREE.Vector3[] = [];
  const settings = state.buildings[room.unit];
  for (const x of [-.28, 0, .28]) for (const z of [-.28, 0, .28]) {
    const p = planPoint(rotatePlanPoint([room.center[0] + x * room.width, room.center[1] + z * room.depth], room.center, room.rotation ?? 0), room.unit, state);
    const r = -THREE.MathUtils.degToRad(state.northBearing);
    points.push(new THREE.Vector3(p[0] * Math.cos(r) + p[1] * Math.sin(r), floorElevation(room.floor, settings) + .08, -p[0] * Math.sin(r) + p[1] * Math.cos(r)));
  }
  return points;
}

/** CPU ray tests deliberately ignore display sectioning and material opacity. */
export function directExposure(points: THREE.Vector3[], direction: THREE.Vector3, blockers: THREE.Mesh[], aboveHorizon: boolean) {
  if (!aboveHorizon) return { lit: 0, total: points.length, cause: 'השמש מתחת לאופק', statuses: points.map(() => false) };
  const ray = new THREE.Raycaster(undefined, undefined, .006, 500);
  ray.layers.enable(1);
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
    if (object instanceof THREE.InstancedMesh) object.dispose();
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) geometries.add(object.geometry);
  });
  disposeResources(geometries, architecture.materials);
  architecture.group.removeFromParent();
}