import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODEL_ASSETS, SURFACE_ASSETS, type SurfaceId } from './materialLibrary';
import { disposeResources, retainResource } from './resources';
import { cachedURL, modelResourcesPaths } from '../lib/assetCache';
import { catalogModel } from '../model/modelCatalog';
import type { Appearance } from '../model/appearance';

export interface SurfaceMaps { color: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture }
export interface RealisticAssets {
  surfaces: Map<SurfaceId, SurfaceMaps>;
  models: Map<string, THREE.Group>;
  images: Map<string, THREE.Texture>;
  load: () => Promise<string[]>;
  sync: (appearance?: Appearance) => Promise<string[]>;
  dispose: () => void;
}

/** Centred X/Z, bottom at zero, unit bounds. Caller fits the editable footprint. */
export function normalizeModel(source: THREE.Group): THREE.Group {
  source.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(source), size = bounds.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(n => Number.isFinite(n) && n > 1e-5)) throw new Error('Empty model bounds');
  const centre = bounds.getCenter(new THREE.Vector3());
  const pivot = new THREE.Group(); pivot.add(source);
  source.position.sub(new THREE.Vector3(centre.x, bounds.min.y, centre.z));
  pivot.scale.set(1 / size.x, 1 / size.y, 1 / size.z);
  const normalized = new THREE.Group(); normalized.add(pivot);
  normalized.updateMatrixWorld(true);
  return normalized;
}

export function modelResources(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m));
  });
  return { geometries, materials };
}

/** One pool per viewer, never per scene rebuild or CPU sunlight calculation.
 * Late loads after unmount are disposed, never attached to a dead scene.
 */
export function createRealisticAssets(anisotropy: number): RealisticAssets {
  const surfaces = new Map<SurfaceId, SurfaceMaps>(), models = new Map<string, THREE.Group>();
  const images = new Map<string, THREE.Texture>(), imageSources = new Map<string, string>();
  const requestedImages = new Map<string, string>();
  const extraJobs = new Map<string, Promise<void>>();
  const ownedTextures = new Set<THREE.Texture>();
  let disposed = false, pending: Promise<string[]> | undefined;
  const loader = new THREE.TextureLoader(), gltf = new GLTFLoader();
  const texture = async (id: SurfaceId, channel: keyof SurfaceMaps) => {
    const resource = await cachedURL(`${id}-${channel}.jpg`);
    let t: THREE.Texture;
    try { t = await loader.loadAsync(resource.url); } finally { resource.release(); }
    if (disposed) { t.dispose(); throw new Error('Disposed'); }
    t.colorSpace = channel === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.max(1, Math.min(anisotropy, 8));
    retainResource(t); ownedTextures.add(t);
    return t;
  };
  return {
    surfaces, models, images,
    load() {
      if (disposed) return Promise.resolve(['disposed']);
      if (pending) return pending;
      const jobs = [
        ...SURFACE_ASSETS.map(async asset => {
          if (surfaces.has(asset.id)) return;
          const [color, normal, roughness] = await Promise.all([texture(asset.id, 'color'), texture(asset.id, 'normal'), texture(asset.id, 'roughness')]);
          if (!disposed) surfaces.set(asset.id, { color, normal, roughness });
        }),
        ...MODEL_ASSETS.map(async asset => {
          if (models.has(asset.id)) return;
          const resource = await cachedURL(`${asset.id}.glb`);
          let result: Awaited<ReturnType<GLTFLoader['loadAsync']>>;
          try { result = await gltf.loadAsync(resource.url); } finally { resource.release(); }
          const resources = modelResources(result.scene);
          if (disposed) { disposeResources(resources.geometries, resources.materials, true); return; }
          let model: THREE.Group;
          // These two source assets face +Z; editable plan seats face -Z.
          // Apply the authored-axis correction before item/dwelling rotation.
          result.scene.rotation.y += Math.PI;
          try { model = normalizeModel(result.scene); }
          catch (error) { disposeResources(resources.geometries, resources.materials, true); throw error; }
          resources.geometries.forEach(retainResource);
          resources.materials.forEach(m => {
            retainResource(m); m.clipShadows = false;
            for (const v of Object.values(m)) if (v instanceof THREE.Texture) retainResource(v);
          });
          models.set(asset.id, model);
        }),
      ];
      // Each asset is independent: missing maps/models leave a usable material/mesh.
      pending = Promise.allSettled(jobs).then(results => results.flatMap((r, i) => r.status === 'rejected' ? [i < SURFACE_ASSETS.length ? SURFACE_ASSETS[i].id : MODEL_ASSETS[i - SURFACE_ASSETS.length].id] : []));
      return pending;
    },
    async sync(appearance) {
      if (disposed) return [];
      const present = new Set(appearance?.images.map(image => image.id) ?? []);
      for (const id of requestedImages.keys()) if (!present.has(id)) requestedImages.delete(id);
      for (const [id, t] of images) if (!present.has(id)) {
        t.dispose(); ownedTextures.delete(t); images.delete(id); imageSources.delete(id);
      }
      if (!appearance) return [];
      const jobs: Promise<void>[] = [];
      for (const image of appearance.images) {
        if (imageSources.get(image.id) === image.image) continue;
        requestedImages.set(image.id, image.image);
        jobs.push((async () => {
          const t = await loader.loadAsync(image.image);
          if (disposed || requestedImages.get(image.id) !== image.image) { t.dispose(); return; }
          if (imageSources.get(image.id) === image.image) { t.dispose(); return; }
          t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = Math.min(8, Math.max(1, anisotropy)); retainResource(t); ownedTextures.add(t);
          const previous = images.get(image.id); if (previous) { previous.dispose(); ownedTextures.delete(previous); }
          images.set(image.id, t); imageSources.set(image.id, image.image);
        })());
      }
      for (const id of new Set(Object.values(appearance.models))) {
        const entry = catalogModel(id); if (!entry || models.has(id)) continue;
        const existing = extraJobs.get(id); if (existing) { jobs.push(existing); continue; }
        const job = (async () => {
          const paths = modelResourcesPaths(entry.file), resources: { path: string; url: string; release: () => void }[] = [];
          try { for (const path of paths) resources.push({ path, ...await cachedURL(path) }); }
          catch (error) { resources.forEach(r => r.release()); throw error; }
          if (disposed) { resources.forEach(r => r.release()); return; }
          const manager = new THREE.LoadingManager();
          manager.setURLModifier(url => {
            const found = resources.find(r => url === r.url || url.endsWith(r.path) || (entry.file.endsWith('.gltf') && url.endsWith(r.path.replace('catalog/modern_arm_chair_01/', ''))));
            if (found) return found.url;
            throw new Error('Unknown model dependency');
          });
          let result: Awaited<ReturnType<GLTFLoader['loadAsync']>>;
          try { result = await new GLTFLoader(manager).loadAsync(resources.find(r => r.path === entry.file)!.url); }
          finally { resources.forEach(r => r.release()); }
          const r = modelResources(result.scene);
          if (disposed) { disposeResources(r.geometries, r.materials, true); return; }
          result.scene.rotation.y += entry.rotation;
          let model: THREE.Group;
          try { model = normalizeModel(result.scene); } catch (error) { disposeResources(r.geometries, r.materials, true); throw error; }
          r.geometries.forEach(retainResource);
          r.materials.forEach(m => { retainResource(m); for (const v of Object.values(m)) if (v instanceof THREE.Texture) retainResource(v); });
          models.set(id, model);
        })();
        extraJobs.set(id, job); jobs.push(job);
      }
      const results = await Promise.allSettled(jobs);
      return results.flatMap((r, i) => r.status === 'rejected' ? [`custom-${i}`] : []);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const model of models.values()) {
        const r = modelResources(model); disposeResources(r.geometries, r.materials, true);
      }
      ownedTextures.forEach(t => t.dispose());
      ownedTextures.clear(); surfaces.clear(); models.clear(); images.clear(); imageSources.clear(); requestedImages.clear();
    },
  };
}