import { describe, expect, it, vi } from 'vitest';
import { parseProject, serializeProject } from './project';
import { BASE_FURNITURE, EDITABLE_OPENINGS, EDITABLE_WALLS, defaultState, resolvedFurniture } from '../model/plans';
import { FURNITURE_KINDS, type FurnitureSpec, type SimulationState } from '../model/types';

const item = (): FurnitureSpec => ({ id: 'added-cad', unit: 'south', floor: 'basement', kind: 'fridge',
  center: [-2, 13], width: .7, depth: .8, height: 1.9, rotation: -37, source: 'added' });
function state(): SimulationState {
  const s = defaultState(); s.design.addedFurniture = [item()];
  s.design.furnitureEdits[item().id] = { center: [3, 7], rotation: 25, width: 1, depth: 1.1, height: 2, deleted: true };
  return s;
}
function set(s: SimulationState, path: string, value: unknown) {
  let target = s as unknown as Record<string, unknown>; const keys = path.split('.');
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys.at(-1)!] = value; return s;
}
const parse = (value: unknown) => parseProject(JSON.stringify(value));

describe('CAD version-1 strict migration', () => {
  it('defaults missing fields in old complete files but retains explicit edits and independent containers', () => {
    const old = JSON.parse(JSON.stringify(defaultState()));
    delete old.buildings.north.stairLayout; delete old.buildings.south.stairLayout;
    delete old.design.furnitureEdits; delete old.design.addedFurniture;
    const parsed = parse(old); expect(parsed).toEqual(defaultState());
    parsed.design.addedFurniture.push(item());
    expect(parse(old).design.addedFurniture).toEqual([]);
    expect(parse({ version: 1, design: {} })).toEqual(defaultState());
  });
  it('round-trips inactive concept edits, added furniture, sizes, deletions and both stair layouts', () => {
    const s = state(); s.buildings.north.stairLayout = 'straight';
    const wall = EDITABLE_WALLS.find(w => w.provenance === 'concept')!;
    const opening = EDITABLE_OPENINGS.find(o => o.wallId.startsWith('concept'))!;
    s.design.wallEdits[wall.id] = { a: [1, 2], b: [4, 5], deleted: false };
    s.openings[opening.id] = { width: 0, height: 0 };
    s.design.furnitureEdits['concept-first-north-island'] = { center: [2, 3], rotation: 180, height: 1.3, deleted: false };
    const restored = parseProject(serializeProject(s)); expect(restored).toEqual(s);
    expect(restored.design.addedFurniture[0]).not.toBe(s.design.addedFurniture[0]);
    expect(restored.design.furnitureEdits[item().id].center).not.toBe(s.design.furnitureEdits[item().id].center);
    restored.buildings.north.firstFloorVariant = 'open-plan';
    expect(resolvedFurniture(restored).find(i => i.id === 'concept-first-north-island')).toMatchObject({ center: [2, 3], height: 1.3 });
  });
  it.each(FURNITURE_KINDS)('round-trips independent added %s', kind => {
    const s = state(); s.design.addedFurniture[0].kind = kind;
    expect(parseProject(serializeProject(s))).toEqual(s);
  });
  it.each(['north', 'south'])('validates %s stair enum even on disabled units', unit => {
    for (const bad of [null, undefined, 1, 'spiral', '', true, {}]) {
      const s = set(defaultState(), `buildings.${unit}.stairLayout`, bad);
      set(s, `buildings.${unit}.enabled`, false);
      expect(() => serializeProject(s)).toThrow('stairLayout');
    }
  });
  it.each(['furnitureEdits', 'addedFurniture'])('rejects malformed explicit %s instead of defaulting', field => {
    for (const bad of [null, undefined, false, 0, 'value']) expect(() => serializeProject(set(defaultState(), `design.${field}`, bad))).toThrow(field);
  });
  it.each([
    ['center.0', -100, 100], ['center.1', -100, 100], ['rotation', -180, 180],
    ['width', .2, 10], ['depth', .2, 10], ['height', .1, 3],
  ] as const)('shares inclusive furniture %s bounds for additions and hidden edits', (key, min, max) => {
    for (const prefix of ['design.addedFurniture.0', `design.furnitureEdits.${item().id}`]) {
      for (const valid of [min, max]) {
        const s = set(state(), `${prefix}.${key}`, valid); expect(parseProject(serializeProject(s))).toEqual(s);
      }
      for (const invalid of [min - .001, max + .001, NaN, Infinity, -Infinity, undefined, null, '1']) {
        const s = set(state(), `${prefix}.${key}`, invalid);
        expect(() => serializeProject(s)).toThrow(key.split('.')[0]);
      }
    }
  });
  it.each(['id', 'unit', 'floor', 'kind', 'center', 'rotation', 'width', 'depth', 'height', 'source'])('requires added-furniture field %s', field => {
    const s = state(); delete (s.design.addedFurniture[0] as unknown as Record<string, unknown>)[field];
    expect(() => serializeProject(s)).toThrow(field);
  });
  it.each([
    ['id', '__proto__'], ['id', 'constructor'], ['id', '../escape'], ['id', 'x'.repeat(151)], ['id', ''], ['id', 'a\n'],
    ['unit', 'west'], ['floor', 'roof'], ['kind', 'cabinet'], ['source', 'plan'], ['extra', true],
  ])('rejects invalid added furniture %s=%j', (key, value) => {
    expect(() => serializeProject(set(state(), `design.addedFurniture.0.${key}`, value))).toThrow(key);
  });
  it('rejects missing IDs, collisions, mismatched edit shape and all oversized containers', () => {
    expect(() => parse({ version: 1, design: { furnitureEdits: { missing: { center: [0, 0], rotation: 0, deleted: false } } } })).toThrow('missing');
    for (const items of [[item(), item()], [{ ...item(), id: BASE_FURNITURE[0].id }]]) {
      expect(() => parse({ version: 1, design: { addedFurniture: items } })).toThrow('id');
    }
    const s = defaultState(); s.design.addedFurniture = Array.from({ length: 200 }, (_, i) => ({ ...item(), id: `item-${i}` }));
    expect(parseProject(serializeProject(s))).toEqual(s);
    s.design.addedFurniture.push({ ...item(), id: 'item-200' }); expect(() => serializeProject(s)).toThrow('200');
    expect(() => parse({ version: 1, design: { furnitureEdits: Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`item-${i}`, {}])) } })).toThrow('500');
    for (const [key, value] of [['unit', 'north'], ['deleted', 'true'], ['center', [0]], ['width', undefined]] as const) {
      expect(() => serializeProject(set(state(), `design.furnitureEdits.${item().id}.${key}`, value))).toThrow(key);
    }
  });
  it('keeps inactive/deleted added openings and validates their canonical associations', () => {
    const base = EDITABLE_OPENINGS.find(o => o.wallId.startsWith('concept'))!;
    const s = defaultState(); s.addedOpenings = [{ ...base, source: 'added', id: 'new-concept', width: 0, height: 0 }];
    expect(parseProject(serializeProject(s))).toEqual(s);
    s.addedOpenings[0].unit = 'south'; expect(() => serializeProject(s)).toThrow('unit');
  });
  it('rejects getters, non-enumerable unknowns, custom prototypes, sparse arrays and nested executable data without invoking it', () => {
    const getter = vi.fn(() => 1);
    const s = state(); Object.defineProperty(s.design.addedFurniture[0], 'width', { get: getter });
    expect(() => serializeProject(s)).toThrow('width'); expect(getter).not.toHaveBeenCalled();
    const e = state(); Object.defineProperty(e.design.furnitureEdits[item().id], 'rotation', { get: getter });
    expect(() => serializeProject(e)).toThrow('rotation'); expect(getter).not.toHaveBeenCalled();
    const a = state(); Object.defineProperty(a.design.addedFurniture, '0', { get: getter });
    expect(() => serializeProject(a)).toThrow(); expect(getter).not.toHaveBeenCalled();
    const p = state(); Object.setPrototypeOf(p.design.addedFurniture[0], { polluted: true });
    expect(() => serializeProject(p)).toThrow();
    const x = state(); Object.defineProperty(x.design.addedFurniture[0], 'toJSON', { value: getter });
    expect(() => serializeProject(x)).toThrow('toJSON'); expect(getter).not.toHaveBeenCalled();
    expect(() => serializeProject(set(state(), 'design.addedFurniture', Array(1)))).toThrow();
    for (const json of ['{"version":1,"design":{"furnitureEdits":{"__proto__":{}}}}',
      '{"version":1,"design":{"addedFurniture":[{"constructor":{}}]}}']) expect(() => parseProject(json)).toThrow();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
  it('supports safe inherited-looking IDs without using inherited overrides', () => {
    const s = defaultState(); s.design.addedFurniture = [{ ...item(), id: 'toString' }];
    const restored = parseProject(serializeProject(s)); expect(resolvedFurniture(restored).find(i => i.id === 'toString')).toEqual(s.design.addedFurniture[0]);
  });
});