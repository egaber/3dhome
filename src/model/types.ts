import type { SolarLocation } from '../lib/solar';

export type UnitId = 'north' | 'south';
export type FloorId = 'basement' | 'ground' | 'first';
export type Vec2 = [number, number];
export type OpeningKind = 'window' | 'glazing' | 'door' | 'void';

export interface BuildingSettings {
  enabled: boolean;
  width: number;
  depth: number;
  x: number;
  z: number;
  rotation: number;
  groundHeight: number;
  upperHeight: number;
  basementDepth: number;
  parapet: number;
  roofEnabled: boolean;
  roofFloorHeight: number;
  /** Absolute peak elevation above ground. */
  roofPeakHeight: number;
  firstFloorVariant: 'original' | 'open-plan';
  storeys: 1 | 2;
}

export interface NeighborSettings {
  id: 'west' | 'east';
  name: string;
  enabled: boolean;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  roofRise: number;
  rotation: number;
}

export interface OpeningSpec {
  id: string;
  wallId: string;
  label: string;
  unit: UnitId;
  floor: FloorId;
  kind: OpeningKind;
  /** Relative position along the unscaled wall, [0,1]. */
  position: number;
  /** Absolute world metres after the unit's horizontal scaling. */
  width: number;
  height: number;
  sill: number;
  open: boolean;
  shutter: boolean;
  overhang: number;
  source: 'plan' | 'added';
}

export interface PlanWall {
  id: string;
  sourceId: string;
  unit: UnitId;
  floor: FloorId;
  a: Vec2;
  b: Vec2;
  thickness: number;
  exterior: boolean;
  retaining: boolean;
  /** A balcony parapet has a fixed height, not the storey's full height. */
  low?: number;
  openings: OpeningSpec[];
}

export interface Room {
  id: string;
  name: string;
  unit: UnitId;
  floor: FloorId;
  center: Vec2;
  width: number;
  depth: number;
  kind: 'living' | 'kitchen' | 'dining' | 'bedroom' | 'bath' | 'hall' | 'basement';
}

export interface WallEdit {
  a: Vec2;
  b: Vec2;
  deleted: boolean;
}

export interface RoomEdit {
  center: Vec2;
  width: number;
  depth: number;
  deleted: boolean;
}

export interface SimulationState {
  version: 1;
  date: string;
  minutes: number;
  location: SolarLocation;
  /** Bearing of the plan's UP direction, clockwise from true north. */
  northBearing: number;
  buildings: Record<UnitId, BuildingSettings>;
  neighbors: NeighborSettings[];
  vehicles: {
    /** Position along the driveway in plan Z metres. */
    southZ: number;
    northZ: number;
  };
  openings: Record<string, Partial<OpeningSpec>>;
  addedOpenings: OpeningSpec[];
  design: {
    wallEdits: Record<string, WallEdit>;
    roomEdits: Record<string, RoomEdit>;
  };
  view: {
    mode: 'orbit' | 'plan' | 'walk';
    cutaway: 'none' | FloorId;
    planVisible: boolean;
    planOpacity: number;
    planFloor: FloorId;
    grid: boolean;
    labels: boolean;
    path: boolean;
    dimensions: boolean;
    directOnly: boolean;
    quality: 'standard' | 'high';
    eyeHeight: number;
    isolateFloor: 'none' | FloorId | 'roof';
    renderMode: 'model' | 'realistic';
  };
  reference: {
    image: string | null;
    width: number;
    depth: number;
    x: number;
    z: number;
    rotation: number;
    opacity: number;
    visible: boolean;
  };
}

export interface RoomExposure {
  roomId: string;
  lit: number;
  total: number;
  percent: number;
  cause: string;
}

export interface DailyExposure {
  roomId: string;
  samples: { minutes: number; fraction: number }[];
  /** Area-averaged direct-sun hours for nine floor samples, midpoint integration. */
  sunHours: number;
  anySunHours: number;
  stepMinutes: number;
}

export const UNIT_NAMES: Record<UnitId, string> = { north: 'יחידה א׳ · עורפית', south: 'יחידה ב׳ · קדמית' };
export const FLOOR_NAMES: Record<FloorId, string> = { basement: 'מרתף', ground: 'קומת קרקע', first: 'קומה ראשונה' };