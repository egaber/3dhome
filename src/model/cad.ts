/** Pure CAD model operations. No history, persistence, DOM, meshes or gesture state. */
import { normalizeApertures, type Aperture } from '../lib/wallGeometry';
import { BASE_DEPTH, BASE_WIDTH, EDITABLE_OPENINGS, EDITABLE_FURNITURE, EDITABLE_WALLS, PARTY_Z, SLAB, STAIR_HOLES,
  floorElevation, isFloorAvailable, planPoint, resolvedFurniture, resolvedOpenings, resolvedRooms, resolvedWalls, trueWorldPoint, wallHeight, wallScale } from './plans';
import type { BuildingSettings, FloorId, LevelId, FurnitureEdit, FurnitureSpec, PlanWall, RoomEdit, SimulationState, StairLayout, StairPathSettings, UnitId, Vec2, WallEdit } from './types';
import { boolean, choice, customWall, furnitureEdit, furnitureSpec, hasOwn, identifier, invalid, number, openingPatch, point, record, roomEdit, wallEdit, type OpeningPatch } from './cadValidation';
export type { OpeningPatch } from './cadValidation';
import { normalizeRotation, rotatePlanPoint } from './rotation';
import { emptyAppearance, stairOptions } from './appearance';
import { createStairPath, parseStairPath, type StairPortal } from './stairPath';
import { SOUTH_WEST_STAIR_HOLE } from './southWestLayout';
import { SOUTH_FAMILY_STAIR_HOLE } from './southFamilyLayout';
import { NORTH_GROUND_STAIR_HOLE } from './northGroundLayout';

export type Vec3 = [number, number, number];
export interface FloorLevels { elevation: number; storeyHeight: number; clearHeight: number; ceilingElevation: number }
export interface DistanceMeasurement { distance: number; horizontal: number; vertical: number }
export interface StairPart { kind: 'tread' | 'landing' | 'entry-apron'; center: Vec2; width: number; depth: number; bottom: number; height: number; rotation?: number }
export interface StairGeometry {
  unit: UnitId; fromFloor: FloorId; toFloor: 'ground' | 'first' | 'roof'; layout: StairLayout;
  footprint: Vec2[]; rise: number; parts: StairPart[];
  pivot: Vec2; rotation: number;
  riserCount: number; topStepRise: number; customPath?: boolean;
  entry?: StairPortal; exit?: StairPortal;
}
export type CadCommand =
  | { type: 'wall'; id: string; edit: WallEdit }
  | { type: 'add-wall'; item: PlanWall }
  | { type: 'room'; id: string; edit: RoomEdit }
  | { type: 'opening'; id: string; patch: OpeningPatch }
  | { type: 'add-window'; id: string; wallId: string; position: number }
  | { type: 'delete-opening'; id: string }
  | { type: 'furniture'; id: string; edit: FurnitureEdit }
  | { type: 'add-furniture'; item: FurnitureSpec }
  | { type: 'stair'; unit: UnitId; layout: StairLayout }
  | { type: 'stair-rotation'; unit: UnitId; rotation: number }
  | { type: 'stair-position'; unit: UnitId; position: Vec2 }
  | { type: 'stair-path'; unit: UnitId; fromFloor: FloorId; path: StairPathSettings | null }
  | { type: 'stair-roof'; unit: UnitId; enabled: boolean }
  | { type: 'stair-protection'; unit: UnitId; railing: boolean; openingGlass: boolean };
export type ObjectCommand = CadCommand | { type: 'duplicate-furniture'; id: string; newId: string }
  | { type: 'duplicate-opening'; id: string; newId: string }
  | { type: 'stair-options'; unit: UnitId; scale: number; enabled: boolean };

export function getFloorLevels(floor: LevelId, building: BuildingSettings): FloorLevels | null {
  if (!building || !isFloorAvailable(floor, building)) return null;
  const storeyHeight = floor === 'roof' ? building.roofFloorHeight : floor === 'basement' ? building.basementDepth : floor === 'ground' ? building.groundHeight : building.upperHeight;
  const elevation = floorElevation(floor, building);
  if (![storeyHeight, elevation, building.groundHeight, building.basementDepth].every(Number.isFinite)
    || storeyHeight < (floor === 'basement' ? 1 : 2.3) || storeyHeight > 6
    || building.groundHeight < 2.3 || building.groundHeight > 6 || building.basementDepth < 1 || building.basementDepth > 6) return null;
  return { elevation, storeyHeight, clearHeight: storeyHeight - SLAB, ceilingElevation: elevation + storeyHeight - SLAB };
}

function transformSettings(unit: UnitId, state: SimulationState): BuildingSettings {
  choice(unit, 'unit', ['north', 'south']);
  const b = state.buildings[unit];
  if (!b || ![b.x, b.z, b.rotation, b.width, b.depth].every(Number.isFinite) || b.width <= 0 || b.depth <= 0) {
    invalid('transform', 'יש להשלים מידות ומיקום תקינים של היחידה לפני עריכה.');
  }
  return b;
}
/** Inverts planPoint only, not true north. Snap in displayed metres BEFORE inversion. */
export function inversePlanPoint(p: Vec2, unit: UnitId, state: SimulationState): Vec2 {
  const b = transformSettings(unit, state);
  if (p.length !== 2 || !p.every(Number.isFinite)) invalid('point', 'יש לספק שתי קואורדינטות סופיות.');
  const r = -b.rotation * Math.PI / 180, x = p[0] - b.x, z = p[1] - PARTY_Z - b.z;
  return [(x * Math.cos(r) - z * Math.sin(r)) * BASE_WIDTH / b.width,
    (x * Math.sin(r) + z * Math.cos(r)) * BASE_DEPTH[unit] / b.depth + PARTY_Z];
}
export function modelWorldPoint(p: Vec2, elevation: number, unit: UnitId, state: SimulationState): Vec3 {
  transformSettings(unit, state);
  if (p.length !== 2 || ![...p, elevation, state.northBearing].every(Number.isFinite)) invalid('point', 'יש לספק קואורדינטות וגובה סופיים.');
  const world = trueWorldPoint(planPoint(p, unit, state), state);
  return [world[0], elevation, world[1]];
}
export function measureBetween(a: Vec3, b: Vec3): DistanceMeasurement | null {
  if (a.length !== 3 || b.length !== 3 || ![...a, ...b].every(Number.isFinite)) return null;
  const horizontal = Math.hypot(b[0] - a[0], b[2] - a[2]), vertical = Math.abs(b[1] - a[1]);
  const distance = Math.hypot(horizontal, vertical);
  return Number.isFinite(distance) ? { distance, horizontal, vertical } : null;
}

/** 18 conceptual rises, never clear-room height. The returned footprint cuts ONLY the destination slab. */
export function resolveStairGeometry(state: SimulationState, unit: UnitId, fromFloor: 'basement' | 'ground'): (StairGeometry & { fromFloor: 'basement' | 'ground'; toFloor: 'ground' | 'first' }) | null;
export function resolveStairGeometry(state: SimulationState, unit: UnitId, fromFloor: FloorId): StairGeometry | null;
export function resolveStairGeometry(state: SimulationState, unit: UnitId, fromFloor: FloorId): StairGeometry | null {
  if (!['north', 'south'].includes(unit) || !['basement', 'ground', 'first'].includes(fromFloor)) return null;
  const b = state.buildings[unit];
  if (!b || b.stairEnabled === false || !['straight', 'u-shaped'].includes(b.stairLayout)) return null;
  if (fromFloor === 'first' && (!b.stairToRoof || !b.roofEnabled || b.storeys !== 2)) return null;
  const from = getFloorLevels(fromFloor, b), toFloor = fromFloor === 'basement' ? 'ground' : fromFloor === 'ground' ? 'first' : 'roof';
  const to = getFloorLevels(toFloor, b);
  if (!from || !to) return null;
  const west = unit === 'south' && b.southLayout === 'west-stair';
  const family = unit === 'south' && b.southLayout === 'family';
  const attached = unit === 'north' && b.northGroundLayout === 'attached';
  const hole = west ? SOUTH_WEST_STAIR_HOLE : family ? SOUTH_FAMILY_STAIR_HOLE : attached ? NORTH_GROUND_STAIR_HOLE : STAIR_HOLES[unit];
  const [[xmin, zmin], [xmax], [, zmax]] = hole;
  const risers = family ? 20 : 18;
  const modernU = !west && (family || attached) && b.stairLayout === 'u-shaped';
  const flight = west ? xmax - xmin : family ? 1 : attached ? 1.05 : (xmax - xmin - .13) / 2;
  const landing = family ? 1.1 : attached ? .9 : .72, perFlight = modernU ? risers / 2 - 1 : 9;
  const tread = west ? (zmax - zmin) / 18 : (zmax - zmin - landing) / perFlight;
  const entrance = west || modernU ? zmax : zmax - .10;
  const rise = to.elevation - from.elevation;
  if (!Number.isFinite(rise) || rise <= 0) return null;
  const parts: StairPart[] = [];
  for (let i = 0; i < (modernU ? perFlight * 2 : 18); i++) {
    const returning = b.stairLayout === 'u-shaped' && i >= perFlight;
    parts.push({ kind: 'tread', width: flight, depth: tread, height: .10,
      center: [returning ? xmax - flight / 2 : xmin + flight / 2,
        returning ? zmin + landing + tread * (i - perFlight + .5) : entrance - tread * (i + .5)],
      bottom: from.elevation + rise * (i + 1 + (modernU && returning ? 1 : 0)) / risers - .10 });
  }
  if (b.stairLayout === 'u-shaped') parts.push({ kind: 'landing', center: [(xmin + xmax) / 2, zmin + landing / 2],
    width: xmax - xmin, depth: landing, height: .12, bottom: from.elevation + rise / 2 - .12 });
  // The incoming basement cutout removes the ground floor in this real .10m
  // seam. Render a distinct source-level apron; never bridge it in navigation.
  if (b.stairLayout === 'u-shaped' && !modernU && fromFloor === 'ground') parts.push({ kind: 'entry-apron',
    center: [xmin + flight / 2, zmax - .05], width: flight, depth: .10, height: .10, bottom: from.elevation - .10 });
  let footprint: Vec2[] = b.stairLayout === 'u-shaped' ? hole.map(p => [...p])
    : [[xmin, entrance - 18 * tread], [xmin + flight, entrance - 18 * tread], [xmin + flight, entrance], [xmin, entrance]];
  const originalPivot: Vec2 = [(xmin + xmax) / 2, (zmin + zmax) / 2];
  const pivot: Vec2 = b.stairPosition ? [...b.stairPosition] : originalPivot;
  if (pivot.length !== 2 || !pivot.every(value => Number.isFinite(value) && Math.abs(value) <= 100)) return null;
  let path: StairPathSettings | undefined;
  if (b.stairPaths?.[fromFloor]) {
    try { path = parseStairPath(b.stairPaths[fromFloor]); }
    catch { return null; }
  }
  let entry: StairPortal | undefined, exit: StairPortal | undefined;
  if (path) {
    const custom = createStairPath(path, [xmin + path.width / 2, entrance], from.elevation, rise);
    parts.splice(0, parts.length, ...custom.parts);
    footprint = custom.footprint; entry = custom.entry; exit = custom.exit;
  }
  const rotation = b.stairRotation ?? 0;
  const scale = b.stairScale ?? 1;
  if (!Number.isFinite(scale) || scale < .5 || scale > 2) return null;
  if (!Number.isFinite(rotation) || rotation < -180 || rotation > 180) return null;
  const transform = (p: Vec2): Vec2 => {
    const relative = rotatePlanPoint(p, originalPivot, path?.rotation ?? 0);
    const moved: Vec2 = [relative[0] + (path?.offset?.[0] ?? 0), relative[1] + (path?.offset?.[1] ?? 0)];
    const rotated = rotatePlanPoint([originalPivot[0] + (moved[0] - originalPivot[0]) * scale, originalPivot[1] + (moved[1] - originalPivot[1]) * scale], originalPivot, rotation);
    return [rotated[0] + pivot[0] - originalPivot[0], rotated[1] + pivot[1] - originalPivot[1]];
  };
  const changed = rotation !== 0 || scale !== 1 || pivot.some((value, i) => value !== originalPivot[i])
    || !!path?.rotation || !!path?.offset?.some(value => value !== 0);
  const portal = (value: StairPortal): StairPortal => ({ center: transform(value.center), a: transform(value.a), b: transform(value.b) });
  return { unit, fromFloor, toFloor, layout: b.stairLayout, pivot, rotation, rise, riserCount: path ? 18 : risers, topStepRise: path ? rise / 18 : modernU ? rise / risers : 0,
    ...(path ? { customPath: true, entry: portal(entry!), exit: portal(exit!) } : {}),
    footprint: changed ? footprint.map(transform) : footprint,
    parts: changed ? parts.map(part => {
      const angle = normalizeRotation((part.rotation ?? 0) + (path?.rotation ?? 0) + rotation);
      const transformed = { ...part, width: part.width * scale, depth: part.depth * scale, center: transform(part.center) };
      delete transformed.rotation;
      if (angle) transformed.rotation = angle;
      return transformed;
    }) : parts };
}

export function stairPartOrder(geometry: StairGeometry): number[] {
  return geometry.parts.map((_, index) => index).sort((left, right) => {
    const a = geometry.parts[left], b = geometry.parts[right];
    return (a.bottom + a.height) - (b.bottom + b.height) || left - right;
  });
}

/** Shared normalized local apertures. Resolve the host by ID so stale caller endpoints cannot win. */
export function getWallApertures(wall: PlanWall, state: SimulationState): Aperture[] {
  const current = resolvedWalls(state).find(item => item.id === wall.id);
  if (!current) return [];
  wall = current;
  wallEdit({ a: wall.a, b: wall.b, deleted: false }, wall.id);
  const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const height = wallHeight(wall, state.buildings[wall.unit]), scale = wallScale(wall, state);
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(scale) || scale <= 0) invalid(wall.id, 'יש לתקן את מידות הקיר לפני עריכת פתחים.');
  return normalizeApertures(length, height, resolvedOpenings(state).filter(o => o.wallId === wall.id).map(o => ({
    id: o.id, center: o.position * length, width: o.width / scale, height: o.height, sill: o.sill,
  })));
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => hasOwn(right, key) && equal(left[key], right[key]));
}
function setEdit<T>(edits: Record<string, T>, id: string, edit: T): Record<string, T> {
  if (!hasOwn(edits, id) && Object.keys(edits).length >= 500) invalid('edits', 'מותרות עד 500 עריכות תכנון.');
  return { ...edits, [id]: edit };
}
function available(floor: FloorId, unit: UnitId, state: SimulationState) {
  if (!getFloorLevels(floor, state.buildings[unit])) invalid('floor', 'יש לבחור יחידה וקומה פעילות לפני עריכה.');
}
function activeWall(id: string, state: SimulationState, restore = false): PlanWall {
  const edits = { ...state.design.wallEdits };
  if (restore) delete edits[id];
  const wall = resolvedWalls({ ...state, design: { ...state.design, wallEdits: edits } }).find(w => w.id === id);
  if (!wall) invalid(id, 'יש לבחור קיר קיים ופעיל בחלופה ובקומה הנוכחיות.');
  return wall;
}

/** Validates/copies the entire command before one immutable update. Caller owns shared history. */
export function applyCadCommand(state: SimulationState, command: CadCommand): SimulationState {
  const input = record(command, 'command');
  const type = choice(input.type, 'command.type', ['wall', 'add-wall', 'room', 'opening', 'add-window', 'delete-opening', 'furniture', 'add-furniture', 'stair', 'stair-rotation', 'stair-position', 'stair-path', 'stair-roof', 'stair-protection']);
  const keys = type === 'stair-path' ? ['type', 'unit', 'fromFloor', 'path'] : type === 'stair-roof' ? ['type', 'unit', 'enabled']
    : type === 'stair-protection' ? ['type', 'unit', 'railing', 'openingGlass']
    : type === 'stair-position' ? ['type', 'unit', 'position'] : type === 'stair-rotation' ? ['type', 'unit', 'rotation'] : type === 'stair' ? ['type', 'unit', 'layout'] : type === 'add-furniture' || type === 'add-wall' ? ['type', 'item']
    : type === 'add-window' ? ['type', 'id', 'wallId', 'position'] : type === 'delete-opening' ? ['type', 'id']
      : ['type', 'id', type === 'opening' ? 'patch' : 'edit'];
  record(input, 'command', keys);
  if (type === 'add-wall') {
    const item = customWall(input.item, 'item');
    available(item.floor, item.unit, state);
    const walls = state.design.addedWalls ?? [];
    if (walls.length >= 200 || [...EDITABLE_WALLS, ...walls].some(wall => wall.id === item.id)) invalid('wall.id', 'מזהה כפול או מגבלת 200 קירות נוספים.');
    return { ...state, design: { ...state.design, addedWalls: [...walls, item] } };
  }
  if (type === 'stair-path' || type === 'stair-roof' || type === 'stair-protection') {
    const unit = choice(input.unit, 'unit', ['north', 'south']);
    available('ground', unit, state);
    const building = state.buildings[unit], next = { ...building };
    if (type === 'stair-path') {
      const floor = choice(input.fromFloor, 'fromFloor', ['basement', 'ground', 'first']);
      if (!resolveStairGeometry(state, unit, floor)) invalid('stair', 'יש לבחור חיבור מדרגות פעיל.');
      const path = input.path === null ? null : parseStairPath(input.path);
      const paths = { ...building.stairPaths };
      if (path) paths[floor] = path; else delete paths[floor];
      if (Object.keys(paths).length) next.stairPaths = paths; else delete next.stairPaths;
    } else if (type === 'stair-roof') {
      next.stairToRoof = boolean(input.enabled, 'enabled');
      if (next.stairToRoof) {
        if (!getFloorLevels('roof', building)) invalid('roof', 'יש להפעיל קומה ראשונה וגג לפני הוספת מדרגות.');
        if (!building.stairPaths?.first && building.stairPaths?.ground) {
          next.stairPaths = { ...building.stairPaths, first: parseStairPath(building.stairPaths.ground) };
        }
      }
    } else {
      next.stairRailing = boolean(input.railing, 'railing');
      next.stairOpeningGlass = boolean(input.openingGlass, 'openingGlass');
    }
    return equal(building, next) ? state : { ...state, buildings: { ...state.buildings, [unit]: next } };
  }
  if (type === 'stair-position') {
    const unit = choice(input.unit, 'unit', ['north', 'south']);
    const position = point(input.position, 'position');
    const stair = resolveStairGeometry(state, unit, 'basement');
    if (!stair) invalid('stair', 'יש לבחור יחידה וחיבור מדרגות פעילים.');
    if (position.every((value, i) => Math.abs(value - stair.pivot[i]) < 1e-9)) return state;
    return { ...state, buildings: { ...state.buildings, [unit]: { ...state.buildings[unit], stairPosition: position } } };
  }
  if (type === 'stair-rotation') {
    const unit = choice(input.unit, 'unit', ['north', 'south']);
    const rotation = normalizeRotation(number(input.rotation, 'rotation', -180, 180));
    available('ground', unit, state);
    if (Math.abs(normalizeRotation((state.buildings[unit].stairRotation ?? 0) - rotation)) < 1e-9) return state;
    return { ...state, buildings: { ...state.buildings, [unit]: { ...state.buildings[unit], stairRotation: rotation } } };
  }
  if (type === 'stair') {
    const unit = choice(input.unit, 'unit', ['north', 'south']), layout = choice(input.layout, 'layout', ['straight', 'u-shaped']);
    available('ground', unit, state);
    if (state.buildings[unit].stairLayout === layout && !state.buildings[unit].stairPaths) return state;
    const building = { ...state.buildings[unit], stairLayout: layout };
    delete building.stairPaths;
    return { ...state, buildings: { ...state.buildings, [unit]: building } };
  }
  if (type === 'add-furniture') {
    const item = furnitureSpec(input.item, 'item');
    available(item.floor, item.unit, state);
    const building = state.buildings[item.unit];
    const layout: FurnitureSpec['layout'] = item.floor === 'ground' && state.design.groundPlan === 'october-2026' ? 'october-ground'
      : item.unit === 'north' && item.floor === 'ground' && building.northGroundLayout === 'attached' ? 'north-ground'
      : item.unit === 'north' && item.floor === 'first' && building.firstFloorVariant === 'bedrooms' ? 'north-bedrooms'
        : item.unit === 'south' && item.floor !== 'basement' && building.southLayout === 'family' ? 'south-family'
          : item.unit === 'south' && item.floor === 'ground' && building.southLayout === 'west-stair' ? 'south-west' : undefined;
    if (item.layout && item.layout !== layout) invalid('item.layout', 'החלופה אינה תואמת ליחידה ולקומה הפעילות.');
    if (layout) item.layout = layout;
    if (state.design.addedFurniture.length >= 200) invalid('addedFurniture', 'מותרות עד 200 תוספות ריהוט.');
    if ([...EDITABLE_FURNITURE, ...state.design.addedFurniture].some(i => i.id === item.id)) invalid(item.id, 'יש לבחור מזהה ריהוט ייחודי.');
    return { ...state, design: { ...state.design, addedFurniture: [...state.design.addedFurniture, item] } };
  }
  const id = identifier(input.id, 'id');
  if (type === 'wall') {
    const edit = wallEdit(input.edit, id), base = activeWall(id, state, true);
    const current = hasOwn(state.design.wallEdits, id) ? state.design.wallEdits[id] : { a: base.a, b: base.b, deleted: false };
    if (equal(current, edit)) return state;
    return { ...state, design: { ...state.design, wallEdits: setEdit(state.design.wallEdits, id, edit) } };
  }
  if (type === 'room') {
    const edit = roomEdit(input.edit, id), without = { ...state.design.roomEdits }; delete without[id];
    const base = resolvedRooms({ ...state, design: { ...state.design, roomEdits: without } }).find(r => r.id === id);
    if (!base) invalid(id, 'יש לבחור חדר קיים.');
    available(base.floor, base.unit, state);
    const edits = { ...state.design.roomEdits }; delete edits[id];
    if (!resolvedRooms({ ...state, design: { ...state.design, roomEdits: edits } }).some(r => r.id === id)) invalid(id, 'יש לבחור חדר בחלופה הפעילה.');
    const current = hasOwn(state.design.roomEdits, id) ? state.design.roomEdits[id] : { center: base.center, width: base.width, depth: base.depth, deleted: false };
    if (equal({ ...current, rotation: current.rotation ?? 0 }, { ...edit, rotation: edit.rotation ?? 0 })) return state;
    return { ...state, design: { ...state.design, roomEdits: setEdit(state.design.roomEdits, id, edit) } };
  }
  if (type === 'furniture') {
    const edits = { ...state.design.furnitureEdits }; delete edits[id];
    const base = resolvedFurniture({ ...state, design: { ...state.design, furnitureEdits: edits } }).find(i => i.id === id);
    if (!base) invalid(id, 'יש לבחור ריהוט קיים בחדר ובחלופה פעילים.');
    const edit = furnitureEdit(input.edit, id, base.source === 'added' ? 100 : 150);
    const previous = hasOwn(state.design.furnitureEdits, id) ? state.design.furnitureEdits[id] : { center: base.center, rotation: base.rotation, deleted: false };
    const effective = (e: FurnitureEdit) => ({ center: e.center, rotation: e.rotation, deleted: e.deleted,
      width: e.width ?? base.width, depth: e.depth ?? base.depth, height: e.height ?? base.height });
    if (equal(effective(previous), effective(edit))) return state;
    return { ...state, design: { ...state.design, furnitureEdits: setEdit(state.design.furnitureEdits, id, edit) } };
  }
  if (type === 'add-window') {
    const wall = activeWall(identifier(input.wallId, 'wallId'), state);
    const position = number(input.position, 'position', 0, 1);
    if (state.addedOpenings.length >= 200) invalid('addedOpenings', 'מותרות עד 200 תוספות פתחים.');
    if ([...EDITABLE_OPENINGS, ...state.addedOpenings].some(o => o.id === id)) invalid(id, 'יש לבחור מזהה פתח ייחודי.');
    const opening = { id, wallId: wall.id, unit: wall.unit, floor: wall.floor, position, label: 'חלון נוסף',
      kind: 'window' as const, width: 1.2, height: 1.35, sill: .95, open: false, shutter: false, overhang: 0, source: 'added' as const };
    const next = { ...state, addedOpenings: [...state.addedOpenings, opening] };
    if (!getWallApertures(wall, next).some(a => a.id === id)) invalid(id, 'יש לבחור קיר עם מקום לפתח גלוי מעל אדן החלון.');
    return next;
  }
  const base = [...EDITABLE_OPENINGS, ...state.addedOpenings].find(o => o.id === id);
  if (!base) invalid(id, 'יש לבחור פתח קיים.');
  activeWall(base.wallId, state);
  const patch = type === 'delete-opening' ? { width: 0, height: 0 } : openingPatch(input.patch, id);
  const current = resolvedOpenings(state).find(o => o.id === id)!;
  if (Object.entries(patch).every(([key, value]) => current[key as keyof typeof current] === value)) return state;
  return { ...state, openings: { ...state.openings, [id]: { ...(hasOwn(state.openings, id) ? state.openings[id] : {}), ...patch } } };
}

/** Duplicates retain effective dimensions, model choice and material without sharing IDs. */
export function applyObjectCommand(state: SimulationState, command: ObjectCommand): SimulationState {
  if (command.type === 'stair-options') {
    record(command, 'command', ['type', 'unit', 'scale', 'enabled']);
    const unit = choice(command.unit, 'unit', ['north', 'south']);
    const options = stairOptions({ scale: command.scale, enabled: command.enabled });
    return { ...state, buildings: { ...state.buildings, [unit]: { ...state.buildings[unit], stairScale: options.scale, stairEnabled: options.enabled } } };
  }
  if (command.type !== 'duplicate-furniture' && command.type !== 'duplicate-opening') return applyCadCommand(state, command);
  record(command, 'command', ['type', 'id', 'newId']);
  const id = identifier(command.id, 'id'), newId = identifier(command.newId, 'newId');
  const appearance = state.appearance ?? emptyAppearance();
  let next: SimulationState, target: string;
  if (command.type === 'duplicate-furniture') {
    const source = resolvedFurniture(state).find(item => item.id === id);
    if (!source) invalid(id, 'יש לבחור ריהוט פעיל.');
    const item = { ...source, id: newId, center: [source.center[0] + .3, source.center[1] + .3] as Vec2, source: 'added' as const };
    next = applyCadCommand(state, { type: 'add-furniture', item }); target = 'furniture';
  } else {
    const source = resolvedOpenings(state).find(o => o.id === id && o.width > 0 && o.height > 0);
    if (!source) invalid(id, 'יש לבחור פתח פעיל.');
    if (state.addedOpenings.length >= 200 || [...EDITABLE_OPENINGS, ...state.addedOpenings].some(o => o.id === newId)) invalid(newId, 'מזהה כפול או מגבלת פתחים.');
    const wall = activeWall(source.wallId, state), length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) * wallScale(wall, state);
    const offset = (source.width + .15) / length;
    const position = source.position + offset + source.width / (2 * length) <= 1 ? source.position + offset : source.position - offset;
    if (position - source.width / (2 * length) < 0) invalid(id, 'אין מקום בקיר לשכפול הפתח.');
    next = { ...state, addedOpenings: [...state.addedOpenings, { ...source, id: newId, position, source: 'added', label: `${source.label.slice(0, 180)} · עותק` }] };
    const aperture = getWallApertures(wall, next).find(a => a.id === newId);
    if (!aperture || Math.abs(aperture.width * wallScale(wall, state) - source.width) > .01) invalid(id, 'אין מקום פנוי בקיר לשכפול מלא.');
    target = 'opening';
  }
  const material = appearance.assignments[`${target}-${id}`], model = appearance.models[id];
  if (material || model) next = { ...next, appearance: { ...appearance,
    assignments: material ? { ...appearance.assignments, [`${target}-${newId}`]: { ...material } } : appearance.assignments,
    models: model ? { ...appearance.models, [newId]: model } : appearance.models } };
  return next;
}