import { boolean, choice, identifier, list, number, point, record } from './cadValidation';
import { isFloorAvailable, resolvedRooms } from './plans';
import type { LandscapeKind, LandscapeSpec, SimulationState } from './types';

export const LANDSCAPE_KINDS = ['potted-plant', 'fern', 'olive-tree', 'cypress'] as const;
export const LANDSCAPE_NAMES: Record<LandscapeKind, string> = { 'potted-plant': 'עציץ עלים', fern: 'שרך', 'olive-tree': 'עץ זית', cypress: 'ברוש' };
export const MAX_LANDSCAPE = 80;

export function parseLandscapeItem(value: unknown, path = 'landscape'): LandscapeSpec {
  const input = record(value, path, ['id', 'kind', 'unit', 'level', 'center', 'height', 'spread', 'rotation']);
  const kind = choice(input.kind, `${path}.kind`, LANDSCAPE_KINDS);
  const level = choice(input.level, `${path}.level`, ['garden', 'basement', 'ground', 'first']);
  if ((kind === 'olive-tree' || kind === 'cypress') && level !== 'garden') throw new Error('עצים מיועדים לגינה. בתוך הבית בחרו עציץ או שרך.');
  return { id: identifier(input.id, `${path}.id`), kind, level, unit: choice(input.unit, `${path}.unit`, ['north', 'south']),
    center: point(input.center, `${path}.center`), height: number(input.height, `${path}.height`, .2, kind === 'olive-tree' || kind === 'cypress' ? 8 : 3),
    spread: number(input.spread, `${path}.spread`, .2, 5), rotation: number(input.rotation, `${path}.rotation`, -180, 180) };
}

export function parseLandscape(value: unknown): LandscapeSpec[] {
  const ids = new Set<string>();
  return list(value, 'design.landscape', MAX_LANDSCAPE).map((value, index) => {
    const item = parseLandscapeItem(value, `design.landscape[${index}]`);
    if (ids.has(item.id)) throw new Error('מזהה צמחייה כפול. כל פריט חייב להיות עצמאי.');
    ids.add(item.id); return item;
  });
}

export function defaultLandscape(state: SimulationState): LandscapeSpec[] {
  if (state.design.importedPlan) return [];
  const garden: LandscapeSpec[] = [
    { id: 'garden-north-olive', kind: 'olive-tree', unit: 'north', level: 'garden', center: [3, -7.8], height: 3.6, spread: 2.7, rotation: 23 },
    { id: 'garden-north-cypress', kind: 'cypress', unit: 'north', level: 'garden', center: [14.1, -6.2], height: 4.4, spread: 1.1, rotation: 0 },
    { id: 'garden-north-pot', kind: 'potted-plant', unit: 'north', level: 'garden', center: [9.3, -3.6], height: 1.1, spread: .75, rotation: 44 },
    { id: 'garden-south-pot', kind: 'potted-plant', unit: 'south', level: 'garden', center: [7.7, 17.5], height: 1.3, spread: .85, rotation: -34 },
    { id: 'garden-south-olive', kind: 'olive-tree', unit: 'south', level: 'garden', center: [1.1, 18.4], height: 3.2, spread: 2.3, rotation: -45 },
    { id: 'garden-south-fern', kind: 'fern', unit: 'south', level: 'garden', center: [8.3, 19.7], height: .55, spread: 1.1, rotation: 15 },
  ];
  const interior = resolvedRooms(state).filter(room => room.floor === 'ground' && room.kind === 'living').map((room): LandscapeSpec => ({
    id: `plant-${room.id}`, kind: 'potted-plant', unit: room.unit, level: room.floor,
    center: [room.center[0] - room.width * .2, room.center[1] - room.depth * .36], height: 1.12, spread: .72, rotation: -15,
  }));
  return [...garden, ...interior];
}

export function resolvedLandscape(state: SimulationState): LandscapeSpec[] {
  return (state.design.landscape ?? defaultLandscape(state)).filter(item => state.buildings[item.unit].enabled
    && (item.level === 'garden' || isFloorAvailable(item.level, state.buildings[item.unit])));
}

export type LandscapeCommand = { type: 'add' | 'update'; item: LandscapeSpec } | { type: 'delete'; id: string } | { type: 'clear'; gardenOnly: boolean };

export function applyLandscapeCommand(state: SimulationState, command: LandscapeCommand): SimulationState {
  const input = record(command, 'landscapeCommand');
  const type = choice(input.type, 'landscapeCommand.type', ['add', 'update', 'delete', 'clear']);
  record(input, 'landscapeCommand', type === 'clear' ? ['type', 'gardenOnly'] : type === 'delete' ? ['type', 'id'] : ['type', 'item']);
  const items = parseLandscape(state.design.landscape ?? defaultLandscape(state));
  let next: LandscapeSpec[];
  if (type === 'clear') next = boolean(input.gardenOnly, 'gardenOnly') ? items.filter(item => item.level !== 'garden') : [];
  else if (type === 'delete') {
    const id = identifier(input.id, 'landscape.id');
    if (!items.some(item => item.id === id)) throw new Error('הצמח שנבחר אינו קיים.');
    next = items.filter(item => item.id !== id);
  } else {
    const item = parseLandscapeItem(input.item);
    if (!state.buildings[item.unit].enabled || item.level !== 'garden' && !isFloorAvailable(item.level, state.buildings[item.unit])) throw new Error('היחידה או הקומה אינן פעילות.');
    const exists = items.some(previous => previous.id === item.id);
    if (type === 'add' && (exists || items.length >= MAX_LANDSCAPE)) throw new Error('מזהה כפול או מגבלת 80 פריטי צמחייה.');
    if (type === 'update' && !exists) throw new Error('הצמח שנבחר אינו קיים.');
    next = type === 'add' ? [...items, item] : items.map(previous => previous.id === item.id ? item : previous);
  }
  return { ...state, design: { ...state.design, landscape: next } };
}
