import { floorElevation, trueWorldPoint } from '../model/plans';
import type { SimulationState, UnitId } from '../model/types';
import { combinedFloorPlan } from './combinedPlan';

export type DuplexPreset = 'exterior' | 'ground' | 'first';

export function duplexView(view: SimulationState['view'], preset: DuplexPreset): SimulationState['view'] {
  return { ...view, mode: 'orbit', cutaway: preset === 'exterior' ? 'none' : preset,
    isolateFloor: preset === 'exterior' ? 'none' : preset, planFloor: preset === 'first' ? 'first' : 'ground',
    renderMode: 'realistic', quality: 'high', planVisible: false, grid: false, path: false, dimensions: false, labels: false, directOnly: false };
}

export function duplexCamera(state: SimulationState, preset: DuplexPreset, aspect: number, unitScope: 'both' | UnitId = 'both'): {
  position: [number, number, number]; target: [number, number, number]; up: [number, number, number];
} | null {
  const floors = preset === 'exterior' ? ['ground', 'first'] as const : [preset];
  const plans = floors.map(floor => combinedFloorPlan(state, floor, unitScope));
  const points = plans.flatMap(plan => plan.units.flatMap(unit => unit.footprint.map(point => trueWorldPoint(point, state))));
  if (!points.length) return null;
  const left = Math.min(...points.map(point => point[0])), right = Math.max(...points.map(point => point[0]));
  const back = Math.min(...points.map(point => point[1])), front = Math.max(...points.map(point => point[1]));
  const levels = plans.flatMap(plan => plan.units.map(unit => {
    const building = state.buildings[unit.id], base = floorElevation(plan.floor, building);
    const ceiling = base + (plan.floor === 'ground' ? building.groundHeight : building.upperHeight);
    return { base, top: preset === 'exterior' && building.roofEnabled && building.storeys === 2 ? Math.max(ceiling, building.roofPeakHeight) : ceiling };
  }));
  const bottom = Math.min(...levels.map(level => level.base)), top = Math.max(...levels.map(level => level.top));
  const target: [number, number, number] = [(left + right) / 2, (bottom + top) / 2, (back + front) / 2];
  const radius = Math.hypot(right - left, front - back, top - bottom) / 2;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const halfFov = Math.min(24 * Math.PI / 180, Math.atan(Math.tan(24 * Math.PI / 180) * safeAspect));
  const distance = Math.max(8, radius / Math.sin(halfFov) * 1.08);
  const direction = preset === 'exterior' ? [.85, .85, 1] : [.35, 1.65, 1];
  const length = Math.hypot(...direction);
  return { target, up: [0, 1, 0], position: [target[0] + direction[0] / length * distance,
    target[1] + direction[1] / length * distance, target[2] + direction[2] / length * distance] };
}