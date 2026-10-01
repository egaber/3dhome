import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assignMaterial, emptyAppearance, surfaceTarget, validateMaterialImage } from './appearance';
import { defaultState, resolvedFurniture, resolvedOpenings } from './plans';
import { parseProject, serializeProject } from '../lib/project';
import { applyObjectCommand, resolveStairGeometry } from './cad';
import { createHistory, historyReducer } from '../lib/actionHistory';
import { buildArchitecture, disposeArchitecture, type Palette } from '../scene/architecture';
import { createRealisticAssets, normalizeModel } from '../scene/realisticAssets';
import { retainResource } from '../scene/resources';
import { EXTRA_MODELS } from './modelCatalog';
import { neededResources, RESOURCE_HASHES, importResources, verifyResource } from '../lib/assetCache';
import { sceneSelection } from '../lib/viewerMeasurement';

const palette: Palette = { background: '#f7f4ef', surface: '#ffffff', soft: '#f5f5f5', border: '#dedede', text: '#242424', muted: '#5c5c5c', accent: '#b11f4b', success: '#16a34a', warning: '#f59e0b', link: '#0078d4', wall: '#f4f1e8' };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const base = () => ({ ...defaultState(), appearance: emptyAppearance() });
const assignment = { material: 'wood', metres: 1.2, roughness: .5 };

describe('appearance persistence and untrusted boundaries', () => {
  it('preserves legacy projects without manufacturing appearance and roundtrips embedded images', () => {
    expect(parseProject(serializeProject(defaultState()))).not.toHaveProperty('appearance');
    const s = base(); s.appearance.images.push({ id: 'image-test', name: 'דוגמה', image: png });
    const next = assignMaterial(s, 'floor-north-ground', { ...assignment, material: 'image-test' });
    expect(parseProject(serializeProject(next))).toEqual(next);
  });
  it.each(['floor-north-ground', 'ceiling-south-first', 'ceiling-north-roof', 'stair-stair-north-ground', 'building-north', 'neighbor-east'])('supports independent target %s', target => {
    const s = assignMaterial(base(), target, assignment); expect(parseProject(serializeProject(s))).toEqual(s);
  });
  it.each(['https://example.com/image.jpg', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,PHN2Zy8+', 'data:image/png;base64,AAAAA', 'data:image/png;base64,' + 'A'.repeat(240000)])('rejects unsafe raster data %s', value => {
    expect(() => validateMaterialImage(value)).toThrow();
  });
  it('rejects unknown references, bounds, duplicate images and prototype keys', () => {
    expect(() => serializeProject(assignMaterial(base(), 'floor-invalid', assignment))).toThrow();
    for (const invalid of [{ ...assignment, material: 'missing' }, { ...assignment, metres: 0 }, { ...assignment, metres: NaN }, { ...assignment, roughness: 2 }]) {
      expect(() => serializeProject(assignMaterial(base(), 'floor-north-ground', invalid))).toThrow();
    }
    const s = base(); s.appearance.images = [{ id: 'image-x', name: 'a', image: png }, { id: 'image-x', name: 'b', image: png }];
    expect(() => serializeProject(s)).toThrow();
    expect(() => parseProject(JSON.stringify(base()).replace('"assignments":{}', '"assignments":{"__proto__":{}}'))).toThrow();
    const t = base(); t.appearance.models['missing'] = EXTRA_MODELS[0].id; expect(() => serializeProject(t)).toThrow();
  });
  it('restores materials/images through history without affecting unrelated items', () => {
    const s = base(), a = assignMaterial(s, 'floor-north-ground', assignment);
    let h = historyReducer(createHistory(s), { type: 'change', update: a });
    h = historyReducer(h, { type: 'undo' }); expect(h.present).toEqual(s);
    h = historyReducer(h, { type: 'redo' }); expect(h.present).toEqual(a);
    expect(s.appearance.assignments).toEqual({});
  });
});

describe('object lifecycle commands', () => {
  it('duplicates effective furniture and appearance independently in one history action', () => {
    const s = base(), item = resolvedFurniture(s)[0];
    s.appearance.models[item.id] = 'kenney-bedDouble'; s.appearance.assignments[`furniture-${item.id}`] = assignment;
    const n = applyObjectCommand(s, { type: 'duplicate-furniture', id: item.id, newId: 'copy-bed' });
    const copy = resolvedFurniture(n).find(i => i.id === 'copy-bed')!;
    expect(copy.width).toBe(item.width); expect(copy.rotation).toBe(item.rotation);
    expect(copy.center).toEqual([item.center[0] + .3, item.center[1] + .3]);
    expect(n.appearance?.models[copy.id]).toBe('kenney-bedDouble'); expect(n.appearance?.assignments[`furniture-${copy.id}`]).toEqual(assignment);
    expect(parseProject(serializeProject(n))).toEqual(n); expect(s.design.addedFurniture).toEqual([]);
    const deleted = applyObjectCommand(n, { type: 'furniture', id: copy.id, edit: { center: copy.center, rotation: copy.rotation, deleted: true, width: copy.width, height: copy.height, depth: copy.depth } });
    expect(resolvedFurniture(deleted).some(i => i.id === copy.id)).toBe(false);
    expect(resolvedFurniture(deleted).find(i => i.id === item.id)).toEqual(item);
  });
  it('rejects unknown/duplicate IDs and does not overwrite an existing item', () => {
    const s = base(), item = resolvedFurniture(s)[0];
    expect(() => applyObjectCommand(s, { type: 'duplicate-furniture', id: item.id, newId: item.id })).toThrow();
    expect(() => applyObjectCommand(s, { type: 'duplicate-furniture', id: 'missing', newId: 'copy' })).toThrow();
  });
  it('duplicates a small opening on its existing host, or rejects overlap atomically', () => {
    const s = base(), opening = resolvedOpenings(s).find(o => o.kind === 'door')!;
    s.openings[opening.id] = { width: .3, position: .2 };
    try {
      const n = applyObjectCommand(s, { type: 'duplicate-opening', id: opening.id, newId: 'copy-door' });
      expect(n.addedOpenings[0].wallId).toBe(opening.wallId); expect(n.addedOpenings[0].kind).toBe('door');
      expect(parseProject(serializeProject(n))).toEqual(n);
    } catch (error) { expect(String(error)).toContain('מקום'); }
    expect(s.addedOpenings).toEqual([]);
  });
  it('resizes stair footprint/parts consistently and removes both connections and holes', () => {
    const s = base(), before = resolveStairGeometry(s, 'north', 'ground')!;
    const n = applyObjectCommand(s, { type: 'stair-options', unit: 'north', scale: 1.2, enabled: true });
    const stair = resolveStairGeometry(n, 'north', 'ground')!;
    expect(stair.parts[0].width).toBeCloseTo(before.parts[0].width * 1.2); expect(stair.rise).toBe(before.rise);
    expect(stair.footprint).not.toEqual(before.footprint); expect(parseProject(serializeProject(n))).toEqual(n);
    const removed = applyObjectCommand(n, { type: 'stair-options', unit: 'north', scale: 1.2, enabled: false });
    expect(resolveStairGeometry(removed, 'north', 'ground')).toBeNull(); expect(resolveStairGeometry(removed, 'north', 'basement')).toBeNull();
    expect(() => applyObjectCommand(n, { type: 'stair-options', unit: 'north', scale: 20, enabled: true })).toThrow();
  });
});

describe('scene material isolation', () => {
  it('separates floor and ceiling faces without changing blockers, geometry or shared instances', () => {
    const s = base(); s.view.renderMode = 'realistic';
    const a = buildArchitecture(s, palette);
    const n = assignMaterial(assignMaterial(s, surfaceTarget('floor', 'north', 'first'), assignment), surfaceTarget('ceiling', 'north', 'ground'), { ...assignment, material: 'dark', metres: .5 });
    const b = buildArchitecture(n, palette);
    try {
      expect(b.blockers.length).toBe(a.blockers.length);
      const slab = b.pickables.find(m => m.userData.floorTarget === 'floor-north-first')!;
      const mats = slab.material as THREE.MeshPhysicalMaterial[];
      expect(mats[0].userData.target).toBe('floor-north-first'); expect(mats[1].userData.target).toBe('ceiling-north-ground');
      expect(sceneSelection(slab, new THREE.Vector3(0, -1, 0))).toMatchObject({ type: 'ceiling', id: 'ceiling-north-ground' });
      expect(sceneSelection(slab, new THREE.Vector3(0, 1, 0))).toMatchObject({ type: 'floor', id: 'floor-north-first' });
      expect(slab.geometry.groups.length).toBeLessThan(100);
    } finally { disposeArchitecture(a); disposeArchitecture(b); }
  });
  it('overrides one GLB without mutating or disposing a pooled template', () => {
    const s = base(); s.view.renderMode = 'realistic'; const sofa = resolvedFurniture(s).find(i => i.kind === 'sofa')!;
    const pool = createRealisticAssets(1), g = new THREE.Group(), material = new THREE.MeshPhysicalMaterial();
    const geometry = new THREE.BoxGeometry(); g.add(new THREE.Mesh(geometry, material)); retainResource(geometry); retainResource(material);
    pool.models.set('SheenWoodLeatherSofa', normalizeModel(g));
    const n = assignMaterial(s, `furniture-${sofa.id}`, assignment), a = buildArchitecture(n, palette, pool);
    try {
      const assigned = a.pickables.find(m => m.userData.furnitureId === sofa.id)!;
      expect(assigned.material).not.toBe(material); expect(assigned.geometry).not.toBe(geometry);
      expect(material.userData).toEqual({});
      const other = a.pickables.find(m => m.userData.assetId && m.userData.furnitureId !== sofa.id)!;
      expect(other.material).toBe(material);
    } finally { disposeArchitecture(a); pool.dispose(); }
  });
});

describe('catalogue and portable bundle integrity', () => {
  it('ships all 33 additional models and validates trusted hashes', () => {
    expect(EXTRA_MODELS).toHaveLength(33);
    for (const [path, hash] of Object.entries(RESOURCE_HASHES)) expect(createHash('sha256').update(readFileSync(`public/assets/realism/${path}`)).digest('hex')).toBe(hash);
    for (const model of EXTRA_MODELS.filter(m => m.file.endsWith('.glb'))) {
      const bytes = readFileSync(`public/assets/realism/${model.file}`), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
      expect([...(json.images ?? []), ...(json.buffers ?? [])].every((v: {uri?: string}) => !v.uri)).toBe(true);
    }
  });
  it('exports base assets and only selected additional models with all glTF dependencies', () => {
    const s = base(); expect(neededResources(s)).toHaveLength(17);
    s.appearance.models.example = 'modern_arm_chair_01'; expect(neededResources(s)).toHaveLength(25);
  });
  it('rejects arbitrary paths and poisoned bundled model bytes before storage', async () => {
    await expect(importResources({ version: 1, files: { '../outside': 'data:application/octet-stream;base64,AAAA' } })).rejects.toThrow();
    await expect(verifyResource('catalog/kitchenFridge.glb', new Uint8Array([1, 2, 3]).buffer)).rejects.toThrow('checksum');
    await expect(importResources({ version: 1, files: { 'catalog/kitchenFridge.glb': 'data:application/octet-stream;base64,AAAA' } })).rejects.toThrow('checksum');
  });
});