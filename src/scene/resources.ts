import * as THREE from 'three';

/** Viewer-owned cached assets outlive any individual architecture rebuild. */
const pooled = new WeakSet<object>();
export function retainResource(resource: object): void { pooled.add(resource); }

export function disposeResources(geometries: Iterable<THREE.BufferGeometry>, materials: Iterable<THREE.Material>, includePooled = false): void {
  const textures = new Set<THREE.Texture>(), images = new Set<ImageBitmap>();
  for (const geometry of new Set(geometries)) if (includePooled || !pooled.has(geometry)) geometry.dispose();
  for (const material of new Set(materials)) {
    if (!includePooled && pooled.has(material)) continue;
    // Includes physical glTF sheen/clearcoat/metalness/emissive maps, not just map.
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) {
    if (!includePooled && pooled.has(texture)) continue;
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) images.add(texture.image);
    texture.dispose();
  }
  images.forEach(image => image.close());
}