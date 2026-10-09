import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultState, floorElevation } from '../model/plans';
import { modelWorldPoint, resolveStairGeometry } from '../model/cad';
import { southWestProposal } from '../model/southWestLayout';
import { buildArchitecture, disposeArchitecture, type Palette } from './architecture';
import type { Vec2 } from '../model/types';

const palette: Palette = { background: '#f7f4ef', surface: '#ffffff', soft: '#f5f5f5', border: '#dedede', text: '#242424',
  muted: '#5c5c5c', accent: '#b11f4b', success: '#16a34a', warning: '#f59e0b', link: '#0078d4', wall: '#f4f1e8' };

describe('attached south plan in the actual scene', () => {
  it('renders a round tabletop and a west stair opening without retaining the central stair enclosure', () => {
    const state = southWestProposal(defaultState()), architecture = buildArchitecture(state, palette);
    try {
      const table = architecture.pickables.filter(mesh => mesh.userData.furnitureId === 'south-west-dining-table');
      expect(table).toHaveLength(3);
      expect(table.every(mesh => mesh.geometry.type === 'CylinderGeometry')).toBe(true);
      expect(architecture.pickables.some(mesh => mesh.userData.furnitureId === 'south-west-kitchen-island')).toBe(true);
      expect(architecture.pickables.some(mesh => ['ground-wall-24-south', 'ground-wall-25-south'].includes(mesh.userData.wallId))).toBe(false);
      const slabs = architecture.measurementTargets.filter(mesh => mesh.userData.role === 'slab' && mesh.userData.unit === 'south' && mesh.userData.floor === 'first');
      expect(slabs).toHaveLength(1);
      const elevation = floorElevation('first', state.buildings.south);
      const hasFloor = (point: Vec2) => new THREE.Raycaster(new THREE.Vector3(...modelWorldPoint(point, elevation + .1, 'south', state)),
        new THREE.Vector3(0, -1, 0), 0, .5).intersectObjects(slabs, false).length > 0;
      expect(hasFloor(resolveStairGeometry(state, 'south', 'ground')!.pivot)).toBe(false);
      expect(hasFloor([5.17, 8.39])).toBe(true);
    } finally { disposeArchitecture(architecture); }
  });
});