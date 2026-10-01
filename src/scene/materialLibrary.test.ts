import { describe, expect, it, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FURNITURE_KINDS } from '../model/types';
import { defaultState, resolvedFurniture } from '../model/plans';
import { buildArchitecture, disposeArchitecture, type Palette } from './architecture';
import { createFinish, furnitureFinish, MODEL_ASSETS, projectSurfaceUV, SURFACE_ASSETS, surfaceUrl } from './materialLibrary';
import { createRealisticAssets, normalizeModel } from './realisticAssets';
import { disposeResources, retainResource } from './resources';

const palette: Palette = { background: '#f7f4ef', surface: '#ffffff', soft: '#f5f5f5', border: '#dedede', text: '#242424',
  muted: '#5c5c5c', accent: '#b11f4b', success: '#16a34a', warning: '#f59e0b', link: '#0078d4', wall: '#f4f1e8' };
afterEach(() => vi.restoreAllMocks());
const template = () => {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 3), new THREE.MeshPhysicalMaterial()));
  return g;
};

describe('real PBR materials', () => {
  it.each(FURNITURE_KINDS)('has a physically valid finish for every %s part', kind => {
    for (const tone of ['body', 'detail', 'surface', 'glass'] as const) {
      const m = createFinish(furnitureFinish(kind, tone));
      expect(m).toBeInstanceOf(THREE.MeshPhysicalMaterial);
      expect(m.roughness).toBeGreaterThanOrEqual(0); expect(m.roughness).toBeLessThanOrEqual(1);
      expect(m.clipShadows).toBe(false); m.dispose();
    }
  });
  it('does not treat wood, fabric or ceramics as metallic, or tint scanned albedo', () => {
    for (const finish of ['wood', 'fabric', 'stone', 'plaster', 'ceramic'] as const) {
      const m = createFinish(finish); expect(m.metalness).toBe(0); expect(m.color.getHex()).toBe(0xffffff); m.dispose();
    }
    const metal = createFinish('metal'); expect(metal.metalness).toBe(1); metal.dispose();
  });
  it('projects UVs in metres, preserves geometry and uses horizontal surfaces correctly', () => {
    const g = new THREE.BoxGeometry(4, 2, 6), positions = [...g.attributes.position.array];
    projectSurfaceUV(g, 2);
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) if (Math.abs(n.getY(i)) === 1) {
      expect(uv.getX(i)).toBeCloseTo(p.getX(i) / 2);
      expect(uv.getY(i)).toBeCloseTo(-p.getZ(i) / 2);
    }
    expect([...p.array]).toEqual(positions); expect([...uv.array].every(Number.isFinite)).toBe(true);
    const before = [...uv.array]; projectSurfaceUV(g, 0); expect([...g.attributes.uv.array]).toEqual(before); g.dispose();
  });
  it('ships licensed local files with matching checksums and no GLB external references', () => {
    const credits = JSON.parse(readFileSync('public/assets/realism/credits.json', 'utf8')) as { files: Record<string, string> };
    for (const [file, hash] of Object.entries(credits.files)) {
      expect(createHash('sha256').update(readFileSync(`public/assets/realism/${file}`)).digest('hex')).toBe(hash);
    }
    for (const asset of SURFACE_ASSETS) for (const map of ['color', 'normal', 'roughness'] as const) {
      expect(surfaceUrl(asset.id, map)).not.toMatch(/^https?:/);
      expect(credits.files).toHaveProperty(`${asset.id}-${map}.jpg`);
    }
    for (const asset of MODEL_ASSETS) {
      const b = readFileSync(`public/assets/realism/${asset.id}.glb`);
      expect(b.readUInt32LE(0)).toBe(0x46546c67); expect(b.readUInt32LE(4)).toBe(2); expect(b.readUInt32LE(8)).toBe(b.length);
      const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()) as { images: { uri?: string }[]; buffers: { uri?: string }[] };
      expect([...json.images, ...json.buffers].every(entry => !entry.uri)).toBe(true);
    }
  });
});

describe('asset lifetimes and fitting', () => {
  it('centres and grounds off-origin models into unit editable bounds', () => {
    const g = template(); g.position.set(4, -2, 9); g.rotation.y = .6;
    const model = normalizeModel(g), b = new THREE.Box3().setFromObject(model), s = b.getSize(new THREE.Vector3());
    expect(s.x).toBeCloseTo(1); expect(s.y).toBeCloseTo(1); expect(s.z).toBeCloseTo(1);
    expect(b.min.y).toBeCloseTo(0); expect(b.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
    expect(() => normalizeModel(new THREE.Group())).toThrow('Empty model');
  });
  it('deduplicates every physical material texture slot and respects cache ownership', () => {
    const texture = new THREE.Texture(), shared = new THREE.Texture(), g = new THREE.BoxGeometry();
    const m = new THREE.MeshPhysicalMaterial({ map: texture, sheenColorMap: texture, clearcoatNormalMap: texture, metalnessMap: shared });
    retainResource(shared);
    const t = vi.spyOn(texture, 'dispose'), sh = vi.spyOn(shared, 'dispose'), mat = vi.spyOn(m, 'dispose'), geo = vi.spyOn(g, 'dispose');
    disposeResources([g, g], [m, m]);
    expect(t).toHaveBeenCalledTimes(1); expect(sh).not.toHaveBeenCalled(); expect(mat).toHaveBeenCalledTimes(1); expect(geo).toHaveBeenCalledTimes(1);
    shared.dispose();
  });
  it('loads each asset once, keeps map colour spaces correct, and releases once', async () => {
    const textures: THREE.Texture[] = [];
    const tl = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => { const t = new THREE.Texture(); textures.push(t); return t; });
    const gl = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => ({ scene: template() }) as Awaited<ReturnType<GLTFLoader['loadAsync']>>);
    const pool = createRealisticAssets(16);
    expect(tl).not.toHaveBeenCalled(); expect(gl).not.toHaveBeenCalled();
    const promise = pool.load(); expect(pool.load()).toBe(promise); expect(await promise).toEqual([]);
    expect(tl).toHaveBeenCalledTimes(15); expect(gl).toHaveBeenCalledTimes(2);
    const source = pool.models.get('SheenChair')!.children[0].children[0];
    expect(source.rotation.y).toBeCloseTo(Math.PI);
    const maps = pool.surfaces.get('wood_floor')!;
    expect(maps.color.colorSpace).toBe(THREE.SRGBColorSpace); expect(maps.normal.colorSpace).toBe(THREE.NoColorSpace);
    expect(maps.roughness.colorSpace).toBe(THREE.NoColorSpace); expect(maps.color.anisotropy).toBe(8); expect(maps.color.wrapS).toBe(THREE.RepeatWrapping);
    const spies = textures.map(t => vi.spyOn(t, 'dispose'));
    pool.dispose(); pool.dispose(); spies.forEach(s => expect(s).toHaveBeenCalledTimes(1));
    expect(pool.models.size).toBe(0); expect(pool.surfaces.size).toBe(0); expect(await pool.load()).toEqual(['disposed']);
  });
  it('contains failed downloads and disposes late images after viewer unmount', async () => {
    let complete: (t: THREE.Texture) => void = () => {};
    const late = new THREE.Texture(), disposed = vi.spyOn(late, 'dispose');
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockRejectedValue(new Error('offline'))
      .mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockRejectedValue(new Error('offline'));
    const pool = createRealisticAssets(1), pending = pool.load();
    await Promise.resolve(); // The persistent cache URL resolves before the image loader starts.
    pool.dispose(); complete(late);
    expect(await pending).toHaveLength(7); expect(disposed).toHaveBeenCalledTimes(1);
    expect(pool.models.size).toBe(0); expect(pool.surfaces.size).toBe(0);
  });
  it('disposes late GLB geometry, physical textures and materials', async () => {
    let complete: (result: Awaited<ReturnType<GLTFLoader['loadAsync']>>) => void = () => {};
    const model = template(), mesh = model.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
    mesh.material.sheenColorMap = new THREE.Texture();
    const spies = [vi.spyOn(mesh.geometry, 'dispose'), vi.spyOn(mesh.material, 'dispose'), vi.spyOn(mesh.material.sheenColorMap, 'dispose')];
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockRejectedValue(new Error('offline'));
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockRejectedValue(new Error('offline'))
      .mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pool = createRealisticAssets(1), pending = pool.load();
    await Promise.resolve();
    pool.dispose();
    complete({ scene: model } as Awaited<ReturnType<GLTFLoader['loadAsync']>>); await pending;
    spies.forEach(s => expect(s).toHaveBeenCalledTimes(1));
  });
});

describe('architecture realism preserves the editable/physical model', () => {
  it('replaces furniture without altering blockers and fits existing editable dimensions', () => {
    const state = defaultState(); state.view.renderMode = 'realistic';
    state.northBearing = 31; state.buildings.north.rotation = 24;
    const pool = createRealisticAssets(1), source = normalizeModel(template());
    source.traverse(o => { if (o instanceof THREE.Mesh) { retainResource(o.geometry); retainResource(o.material); } });
    pool.models.set('SheenWoodLeatherSofa', source);
    const plain = buildArchitecture(state, palette), a = buildArchitecture(state, palette, pool);
    try {
      expect(a.blockers.map(m => m.userData)).toEqual(plain.blockers.map(m => m.userData));
      const sofa = resolvedFurniture(state).find(i => i.kind === 'sofa')!;
      const mesh = a.pickables.find(m => m.userData.furnitureId === sofa.id)!;
      expect(mesh.userData.assetId).toBe('SheenWoodLeatherSofa'); expect(a.blockers).not.toContain(mesh); expect(a.measurementTargets).toContain(mesh);
      expect(mesh.castShadow).toBe(true);
      const wrapper = mesh.parent!.parent!.parent!;
      expect(wrapper.scale.toArray()).toEqual([sofa.width, sofa.height, sofa.depth]);
      expect(a.materials.some(m => m.userData.finish === 'plaster')).toBe(true);
      const spy = vi.spyOn(mesh.geometry, 'dispose'); disposeArchitecture(a); expect(spy).not.toHaveBeenCalled();
    } finally { disposeArchitecture(plain); pool.dispose(); }
  });
  it('uses scanned maps when available and keeps model mode untextured', () => {
    const state = defaultState(), pool = createRealisticAssets(1);
    const maps = { color: new THREE.Texture(), normal: new THREE.Texture(), roughness: new THREE.Texture() };
    pool.surfaces.set('plastered_wall', maps);
    const diagram = buildArchitecture(state, palette, pool);
    expect(diagram.materials.some(m => m.userData.finish)).toBe(false); disposeArchitecture(diagram);
    state.view.renderMode = 'realistic'; const realistic = buildArchitecture(state, palette, pool);
    const plaster = realistic.materials.find(m => m.userData.finish === 'plaster') as THREE.MeshPhysicalMaterial;
    expect(plaster.map).toBe(maps.color); expect(plaster.normalMap).toBe(maps.normal); expect(plaster.roughnessMap).toBe(maps.roughness);
    expect(plaster.normalScale.x).toBe(.2); disposeArchitecture(realistic); pool.dispose();
  });
});