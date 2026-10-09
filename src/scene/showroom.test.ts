import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultState, resolvedFurniture, resolvedOpenings } from '../model/plans';
import { modelWorldPoint } from '../model/cad';
import { showroomProject } from '../lib/showroom';
import { buildArchitecture, disposeArchitecture, type Palette } from './architecture';
import { buildWalkWorld } from './walkWorld';
import { resolveWalkPose } from '../lib/supportedWalk';

const palette: Palette = { background: '#f7f4ef', surface: '#ffffff', soft: '#f5f5f5', border: '#dedede', text: '#242424',
  muted: '#5c5c5c', accent: '#b11f4b', success: '#16a34a', warning: '#f59e0b', link: '#0078d4', wall: '#f4f1e8' };

describe('walkable showroom staging and resource ownership', () => {
  it('adds decor and warm local lighting without removing structural blockers', () => {
    const state = showroomProject(defaultState()), plain = buildArchitecture(state, palette), staged = buildArchitecture(state, palette, undefined, true);
    try {
      const structure = (meshes: THREE.Mesh[]) => meshes.filter(mesh => !['opening', 'opening-leaf', 'entry-porch'].includes(mesh.userData.role)).map(mesh => mesh.userData);
      expect(structure(staged.blockers)).toEqual(structure(plain.blockers));
      expect(staged.blockers.some(mesh => mesh.userData.role === 'entry-porch')).toBe(true);
      expect(staged.blockers.some(mesh => mesh.userData.role === 'opening-leaf')).toBe(true);
      expect(staged.group.getObjectByName('Showroom interior staging')).toBeDefined();
      let lights = 0; staged.group.traverse(object => { if (object instanceof THREE.PointLight) lights++; });
      expect(lights).toBeGreaterThan(0);
      const decorMaterials = staged.materials.filter(material => !plain.materials.includes(material));
      const disposed = new Set<THREE.Material>();
      for (const material of decorMaterials) material.addEventListener('dispose', () => disposed.add(material));
      disposeArchitecture(staged);
      expect(disposed.size).toBe(new Set(decorMaterials).size);
    } finally { disposeArchitecture(plain); }
  });
  it('uses solid glazing and furniture only in the furnished walkthrough, not in sunlight calculations', () => {
    const state = showroomProject(defaultState()), architecture = buildArchitecture(state, palette);
    try {
      const classic = buildWalkWorld(state, architecture)!, furnished = buildWalkWorld(state, architecture, true)!;
      expect(classic.colliders.some(collider => collider.id.startsWith('furniture:'))).toBe(false);
      expect(furnished.colliders.some(collider => collider.id.startsWith('furniture:'))).toBe(true);
      const sofa = resolvedFurniture(state).find(item => item.id === 'a-living-sofa')!;
      expect(resolveWalkPose(furnished, new THREE.Vector3(...modelWorldPoint(sofa.center, state.view.eyeHeight, sofa.unit, state)), state.view.eyeHeight)).toBeNull();
      const glass = new Set(resolvedOpenings(state).filter(opening => !opening.open && ['window', 'glazing'].includes(opening.kind)).map(opening => opening.id));
      const added = furnished.colliders.length - classic.colliders.length;
      expect(glass.size).toBeGreaterThan(0);
      expect(added).toBeGreaterThan(resolvedFurniture(state).filter(item => !['pendant', 'sink', 'cooktop'].includes(item.kind)).length);
    } finally { disposeArchitecture(architecture); }
  });
});
