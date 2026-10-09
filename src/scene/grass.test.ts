import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultState } from '../model/plans';
import { buildArchitecture, disposeArchitecture, type Palette } from './architecture';
import type { RealisticAssets } from './realisticAssets';

const palette: Palette = {
  background: '#f7f4ef', surface: '#ffffff', soft: '#f5f5f5', border: '#dedede',
  text: '#242424', muted: '#5c5c5c', accent: '#b11f4b', success: '#16a34a',
  warning: '#f59e0b', link: '#0078d4', wall: '#f4f1e8',
};

function assets(): RealisticAssets {
  return {
    surfaces: new Map([['grass004', {
      color: new THREE.Texture(),
      roughness: new THREE.Texture(),
      height: new THREE.Texture(),
    }]]),
    models: new Map(),
    images: new Map(),
    load: async () => [],
    sync: async () => [],
    dispose() {},
  };
}

describe('realistic outdoor grass', () => {
  it('uses the supplied PBR maps and instanced blades only in realistic mode', () => {
    const state = defaultState();
    const diagram = buildArchitecture(state, palette);
    state.view.renderMode = 'realistic';
    const realistic = buildArchitecture(state, palette, assets());
    try {
      const objectsWithRole = (root: THREE.Object3D, role: string) => {
        const matches: THREE.Object3D[] = [];
        root.traverse(object => { if (object.userData.role === role) matches.push(object); });
        return matches;
      };
      expect(objectsWithRole(diagram.group, 'grass-blades')).toEqual([]);
      const lawns = realistic.measurementTargets.filter(mesh => mesh.userData.role === 'grass');
      expect(lawns).toHaveLength(2);
      for (const lawn of lawns) {
        const material = lawn.material as THREE.MeshStandardMaterial;
        expect(material.userData.surface).toBe('grass004');
        expect(material.map).toBeTruthy();
        expect(material.roughnessMap).toBeTruthy();
        expect(material.bumpMap).toBeTruthy();
        expect(material.bumpScale).toBe(.045);
      }
      const blades = objectsWithRole(realistic.group, 'grass-blades');
      expect(blades).toHaveLength(2);
      expect(blades.every(object => object instanceof THREE.InstancedMesh && object.count > 500)).toBe(true);
    } finally {
      disposeArchitecture(diagram);
      disposeArchitecture(realistic);
    }
  });
});
