import * as THREE from 'three';
import type { FurnitureKind } from '../model/types';
import type { FurniturePart } from '../model/furnitureParts';

/** CC0 source maps, vendored at 1K. No live third-party requests in the viewer. */
export const SURFACE_ASSETS = [
  { id: 'wood_floor', name: 'עץ טבעי', author: 'Dimitrios Savva', metres: 2, strength: .35 },
  { id: 'fabric_pattern_07', name: 'בד ארוג', author: 'Rob Tuytel', metres: .3, strength: .25 },
  { id: 'marble_01', name: 'שיש', author: 'Rob Tuytel', metres: 1.5, strength: .15 },
  { id: 'plastered_wall', name: 'טיח', author: 'Amal Kumar', metres: 2, strength: .2 },
  { id: 'floor_tiles_06', name: 'אריחי רצפה', author: 'Rob Tuytel', metres: 2, strength: .3 },
] as const;
export type SurfaceId = typeof SURFACE_ASSETS[number]['id'];
export type Finish = 'wood' | 'fabric' | 'stone' | 'plaster' | 'tile' | 'ceramic' | 'metal' | 'paint' | 'glass' | 'dark';
export const MODEL_ASSETS = [
  { id: 'SheenWoodLeatherSofa', kind: 'sofa', name: 'ספת בד, עור ועץ', license: 'CC BY 4.0', author: 'Eric Chadwick / DGG; original: Fran Calvente',
    source: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenWoodLeatherSofa' },
  { id: 'SheenChair', kind: 'armchair', name: 'כורסה מרופדת', license: 'CC0', author: 'Eric Chadwick / Wayfair',
    source: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenChair' },
] as const;

export function assetUrl(file: string): string { return `${import.meta.env.BASE_URL}assets/realism/${file}`; }
export function surfaceUrl(id: SurfaceId, map: 'color' | 'normal' | 'roughness'): string { return assetUrl(`${id}-${map}.jpg`); }

const surfaces: Partial<Record<Finish, SurfaceId>> = {
  wood: 'wood_floor', fabric: 'fabric_pattern_07', stone: 'marble_01', plaster: 'plastered_wall', tile: 'floor_tiles_06',
};

/** Physical surface colours are independent of the UI theme. Maps are not tinted. */
export function createFinish(finish: Finish): THREE.MeshPhysicalMaterial {
  const options: Record<Finish, THREE.MeshPhysicalMaterialParameters> = {
    wood: { roughness: .75, clearcoat: .15, clearcoatRoughness: .45 },
    fabric: { roughness: 1, sheen: .7, sheenRoughness: .85, sheenColor: 0xffffff },
    stone: { roughness: .6, clearcoat: .25, clearcoatRoughness: .25 },
    plaster: { roughness: 1 }, tile: { roughness: .7, clearcoat: .15 },
    ceramic: { roughness: .18, clearcoat: .8, clearcoatRoughness: .12 },
    metal: { color: 0xb8bdc1, metalness: 1, roughness: .3 },
    paint: { color: 0xe9e5dc, roughness: .45, clearcoat: .2 },
    glass: { color: 0xe3f0ef, roughness: .08, transparent: true, opacity: .2, depthWrite: false },
    dark: { color: 0x202327, roughness: .28 },
  };
  const material = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, side: THREE.DoubleSide, ...options[finish] });
  material.name = `finish:${finish}`;
  material.clipShadows = false;
  material.userData = { finish, surface: surfaces[finish] };
  return material;
}

export function furnitureFinish(kind: FurnitureKind, tone: FurniturePart['tone']): Finish {
  if (tone === 'glass') return 'glass';
  switch (kind) {
    case 'sofa': case 'armchair': return 'fabric';
    case 'bed': return tone === 'detail' ? 'wood' : 'fabric';
    case 'chair': return tone === 'body' ? 'fabric' : 'wood';
    case 'coffee-table': case 'dining-table': return 'wood';
    case 'kitchen-unit': case 'kitchen-island': return tone === 'surface' ? 'stone' : tone === 'detail' ? 'wood' : 'paint';
    case 'sink': return 'metal';
    case 'basin': case 'toilet': return tone === 'detail' ? 'metal' : 'ceramic';
    case 'shower': return 'ceramic';
    case 'fridge': case 'dishwasher': return tone === 'surface' ? 'dark' : 'metal';
    case 'cooktop': return tone === 'surface' ? 'metal' : 'dark';
  }
}

/** Metre-based local box projection: no stretched 0..1 texture on a 12 m wall.
 * Geometry only is edited; collision dimensions and transforms remain unchanged.
 * UV seams use dominant normals (the input box/wall/slab already splits faces).
 */
export function projectSurfaceUV(geometry: THREE.BufferGeometry, metres: number): void {
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  if (!position || !normal || !Number.isFinite(metres) || metres <= 0) return;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
    const [u, v] = ny >= nx && ny >= nz ? [x, -z] : nx > nz ? [-z, y] : [x, y];
    uv[i * 2] = u / metres; uv[i * 2 + 1] = v / metres;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}