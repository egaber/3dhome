import { describe, expect, it } from 'vitest';
import { applyCadCommand } from './cad';
import { defaultState, resolvedFurniture, ROOMS } from './plans';
import { parseProject, serializeProject } from '../lib/project';
import { furnitureEdit, furnitureSpec, roomEdit, wallEdit } from './cadValidation';

describe('legal room-relative furniture at coordinate boundaries', () => {
  it('accepts the QA sofa at [100,100.9], no-op is identity, delete and overrides round-trip', () => {
    const room = ROOMS.find(r => r.kind === 'living' && r.floor === 'ground')!;
    const s = applyCadCommand(defaultState(), { type: 'room', id: room.id, edit: { center: [100, 100], width: room.width, depth: room.depth, deleted: false } });
    const sofa = resolvedFurniture(s).find(f => f.id === `${room.id}-sofa`)!;
    expect(sofa.center).toEqual([100, 100.9]);
    const edit = { center: sofa.center, rotation: sofa.rotation, width: sofa.width, depth: sofa.depth, height: sofa.height, deleted: false };
    expect(applyCadCommand(s, { type: 'furniture', id: sofa.id, edit })).toBe(s);
    const deleted = applyCadCommand(s, { type: 'furniture', id: sofa.id, edit: { ...edit, deleted: true } });
    expect(resolvedFurniture(deleted).some(f => f.id === sofa.id)).toBe(false);
    expect(parseProject(serializeProject(deleted))).toEqual(deleted);
    expect(resolvedFurniture(parseProject(serializeProject(deleted))).some(f => f.id === sofa.id)).toBe(false);
  });
  it('covers every room seed with max-size rooms, both corners and local rotations', () => {
    for (const coordinate of [-100, 100]) for (const rotation of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
      const s = defaultState();
      for (const room of ROOMS) s.design.roomEdits[room.id] = { center: [coordinate, coordinate], width: 30, depth: 30, rotation, deleted: false };
      for (const f of resolvedFurniture(s)) {
        const edit = { center: f.center, rotation: f.rotation, width: f.width, depth: f.depth, height: f.height, deleted: false };
        expect(() => furnitureEdit(edit, f.id)).not.toThrow();
        expect(applyCadCommand(s, { type: 'furniture', id: f.id, edit })).toBe(s);
      }
    }
  });
  it('bounds overrides finitely without relaxing room, wall or new furniture constraints', () => {
    const edit = { center: [150, -150], rotation: 0, deleted: false };
    expect(furnitureEdit(edit, 'edit').center).toEqual([150, -150]);
    for (const x of [150.01, -150.01, Infinity, NaN]) expect(() => furnitureEdit({ ...edit, center: [x, 0] }, 'edit')).toThrow();
    expect(() => roomEdit({ ...edit, center: [100.1, 0], width: 1, depth: 1 }, 'room')).toThrow();
    expect(() => wallEdit({ a: [100.1, 0], b: [0, 0], deleted: false }, 'wall')).toThrow();
    expect(() => furnitureSpec({ ...resolvedFurniture(defaultState())[0], id: 'new', source: 'added', center: [100.1, 0] }, 'new')).toThrow();
  });
  it('uses matching runtime/parser bounds for seeded and independently added overrides', () => {
    const s = defaultState(), seed = resolvedFurniture(s)[0];
    const edit = { center: [150, -150] as [number, number], rotation: 0, deleted: false };
    const next = applyCadCommand(s, { type: 'furniture', id: seed.id, edit });
    expect(parseProject(serializeProject(next))).toEqual(next);
    const invalid = { ...edit, center: [150.001, 0] as [number, number] };
    expect(() => applyCadCommand(s, { type: 'furniture', id: seed.id, edit: invalid })).toThrow();
    expect(() => serializeProject({ ...s, design: { ...s.design, furnitureEdits: { [seed.id]: invalid } } })).toThrow();
    const added = applyCadCommand(s, { type: 'add-furniture', item: { ...seed, id: 'bounded-added', source: 'added' } });
    const outside = { ...edit, center: [100.001, 0] as [number, number] };
    expect(() => applyCadCommand(added, { type: 'furniture', id: 'bounded-added', edit: outside })).toThrow();
    expect(() => serializeProject({ ...added, design: { ...added.design, furnitureEdits: { 'bounded-added': outside } } })).toThrow();
  });
});