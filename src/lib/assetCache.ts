import { EXTRA_MODELS } from '../model/modelCatalog';
import type { SimulationState } from '../model/types';
import { MODEL_ASSETS, SURFACE_ASSETS, assetUrl } from '../scene/materialLibrary';
import baseCredits from '../../public/assets/realism/credits.json';
import catalogCredits from '../../public/assets/realism/catalog/credits.json';

const modernFiles = ['modern_arm_chair_01_1k.gltf', 'modern_arm_chair_01.bin',
  ...['pillow', 'legs'].flatMap(part => ['diff', 'nor_gl', 'arm'].map(map => `textures/modern_arm_chair_01_${part}_${map}_1k.jpg`))]
  .map(file => `catalog/modern_arm_chair_01/${file}`);
export const BASE_RESOURCE_PATHS = [
  ...SURFACE_ASSETS.flatMap(a => ['color', 'normal', 'roughness'].map(map => `${a.id}-${map}.jpg`)),
  ...MODEL_ASSETS.map(a => `${a.id}.glb`),
];
export const RESOURCE_PATHS = [...BASE_RESOURCE_PATHS, ...EXTRA_MODELS.filter(m => m.file.endsWith('.glb')).map(m => m.file), ...modernFiles];
const allowed = new Set(RESOURCE_PATHS);
const MAX_RESOURCE = 16_000_000;
export const RESOURCE_HASHES: Record<string, string> = { ...baseCredits.files, ...catalogCredits.files };
export async function verifyResource(path: string, bytes: ArrayBuffer): Promise<void> {
  const expected = RESOURCE_HASHES[path]; if (!expected) throw new Error('Unknown asset checksum');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  if ([...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') !== expected) throw new Error(`Asset checksum mismatch: ${path}`);
}
export function neededResources(state: SimulationState): string[] {
  const paths = new Set(BASE_RESOURCE_PATHS);
  for (const id of Object.values(state.appearance?.models ?? {})) {
    const model = EXTRA_MODELS.find(m => m.id === id);
    if (model) (id === 'modern_arm_chair_01' ? modernFiles : [model.file]).forEach(p => paths.add(p));
  }
  return [...paths];
}
export function modelResourcesPaths(file: string) { return file.endsWith('.gltf') ? modernFiles : [file]; }
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('dori-realism-assets-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function read(path: string): Promise<Blob | undefined> {
  const database = await db();
  try { return await new Promise((resolve, reject) => {
    const request = database.transaction('files').objectStore('files').get(path);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : undefined); request.onerror = () => reject(request.error);
  }); } finally { database.close(); }
}
export async function storeAssets(files: Map<string, Blob>): Promise<void> {
  const database = await db();
  try { await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('files', 'readwrite');
    for (const [path, blob] of files) { if (!allowed.has(path)) { tx.abort(); reject(new Error('Unknown asset path')); return; } tx.objectStore('files').put(blob, path); }
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('Asset storage aborted'));
  }); } finally { database.close(); }
}
const pending = new Map<string, Promise<Blob>>();
export async function cachedAsset(path: string): Promise<Blob> {
  if (!allowed.has(path)) throw new Error('Unknown asset path');
  const found = pending.get(path); if (found) return found;
  const job = (async () => {
    try { const cached = await read(path); if (cached) return cached; } catch { /* Cache unavailable: fetch still works. */ }
    const response = await fetch(assetUrl(path)); if (!response.ok) throw new Error(`Asset HTTP ${response.status}`);
    if (Number(response.headers.get('Content-Length')) > MAX_RESOURCE) throw new Error('Asset too large');
    const blob = await response.blob(); if (blob.size > MAX_RESOURCE) throw new Error('Asset too large');
    await verifyResource(path, await blob.arrayBuffer());
    try { await storeAssets(new Map([[path, blob]])); } catch { /* File export remains a durable fallback. */ }
    return blob;
  })();
  pending.set(path, job);
  try { return await job; } finally { pending.delete(path); }
}
export async function cachedURL(path: string): Promise<{ url: string; release: () => void }> {
  // Unit/SSR callers have no browser database. Browser loads use a durable cache.
  if (typeof indexedDB === 'undefined') return { url: assetUrl(path), release() {} };
  const url = URL.createObjectURL(await cachedAsset(path)); return { url, release: () => URL.revokeObjectURL(url) };
}
export async function encodeBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
}
export interface ResourceBundle { version: 1; files: Record<string, string> }
export async function exportResources(state: SimulationState): Promise<ResourceBundle> {
  const files: Record<string, string> = {};
  for (const path of neededResources(state)) files[path] = await encodeBlob(await cachedAsset(path));
  return { version: 1, files };
}
export async function importResources(value: unknown, required: readonly string[] = []): Promise<void> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid asset bundle');
  const input = value as Partial<ResourceBundle>;
  if (input.version !== 1 || !input.files || typeof input.files !== 'object' || Array.isArray(input.files)) throw new Error('Invalid asset bundle');
  const entries = Object.entries(input.files); if (entries.length > RESOURCE_PATHS.length) throw new Error('Too many assets');
  if (required.some(path => !Object.hasOwn(input.files!, path))) throw new Error('Portable backup is missing required assets');
  const files = new Map<string, Blob>(); let total = 0;
  for (const [path, data] of entries) {
    if (!allowed.has(path) || typeof data !== 'string' || data.length > 22_000_000 || !/^data:[a-zA-Z0-9.+/-]*;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Invalid bundled asset');
    total += data.length; if (total > 90_000_000) throw new Error('Asset bundle too large');
    const encoded = data.slice(data.indexOf(',') + 1); if (encoded.length % 4) throw new Error('Invalid base64');
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    await verifyResource(path, bytes.buffer);
    if (path.endsWith('.glb')) {
      if (bytes.length < 20 || new DataView(bytes.buffer).getUint32(0, true) !== 0x46546c67) throw new Error('Invalid GLB');
    } else if (path.endsWith('.jpg') && !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)) throw new Error('Invalid JPEG');
    // The only .gltf is reviewed bundled content. Reject arbitrary network URIs.
    if (path.endsWith('.gltf')) {
      const json = JSON.parse(new TextDecoder().decode(bytes)) as { buffers?: {uri?: string}[]; images?: {uri?: string}[] };
      for (const item of [...json.buffers ?? [], ...json.images ?? []]) if (item.uri && !modernFiles.includes(`catalog/modern_arm_chair_01/${item.uri}`)) throw new Error('External model reference rejected');
    }
    files.set(path, new Blob([bytes], { type: path.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream' }));
  }
  await storeAssets(files);
}