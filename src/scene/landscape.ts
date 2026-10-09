import * as THREE from 'three';
import { BASE_DEPTH, BASE_WIDTH, PARTY_Z, floorElevation } from '../model/plans';
import { LANDSCAPE_NAMES, resolvedLandscape } from '../model/landscape';
import type { SimulationState } from '../model/types';
import { createFinish, projectSurfaceUV, type Finish } from './materialLibrary';
import type { RealisticAssets } from './realisticAssets';

export function buildLandscape(state: SimulationState, assets?: RealisticAssets) {
  const group = new THREE.Group(); group.name = 'Editable landscape';
  const materials: THREE.Material[] = [], pickables: THREE.Mesh[] = [];
  const finish = (name: Finish, color?: number) => {
    const material = createFinish(name), maps = assets?.surfaces.get(material.userData.surface);
    if (maps) { material.map = maps.color; material.normalMap = maps.normal ?? null; material.roughnessMap = maps.roughness; material.normalScale.setScalar(.25); }
    if (color !== undefined) material.color.setHex(color);
    materials.push(material); return material;
  };
  const bark = finish('wood', 0x807059), leaves = finish('paint', 0x657956), darkLeaves = finish('paint', 0x3d5437);
  bark.map = null; bark.roughness = .95; bark.clearcoat = 0;
  for (const material of [leaves, darkLeaves]) { material.roughness = .85; material.clearcoat = 0; }
  const ceramic = finish('ceramic', 0xc7ae90), soil = finish('dark', 0x352a21);
  const trunkGeometry = new THREE.CylinderGeometry(.045, .075, 1, 10);
  const leafGeometry = new THREE.SphereGeometry(1, 6, 4);
  const mesh = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const result = new THREE.Mesh(geometry, material); parent.add(result); return result;
  };
  for (const item of resolvedLandscape(state)) {
    const settings = state.buildings[item.unit], wrapper = new THREE.Group();
    wrapper.position.set(settings.x, 0, PARTY_Z + settings.z);
    wrapper.rotation.y = -settings.rotation * Math.PI / 180;
    wrapper.scale.set(settings.width / BASE_WIDTH, 1, settings.depth / BASE_DEPTH[item.unit]); group.add(wrapper);
    const root = new THREE.Group(); wrapper.add(root);
    root.name = `${LANDSCAPE_NAMES[item.kind]} · ${item.id}`;
    root.position.set(item.center[0], item.level === 'garden' ? 0 : floorElevation(item.level, settings), item.center[1] - PARTY_Z);
    root.rotation.y = -item.rotation * Math.PI / 180;
    root.scale.set(item.spread, item.height, item.spread);
    const template = assets?.models.get(item.kind === 'potted-plant' ? 'showroom-potted_plant_02' : item.kind === 'fern' ? 'showroom-fern_02' : '');
    if (template) root.add(template.clone(true));
    else if (item.kind === 'potted-plant' || item.kind === 'fern') {
      const pot = mesh(root, new THREE.CylinderGeometry(.23, .17, .3, 20), ceramic); pot.position.y = .15;
      const top = mesh(root, new THREE.CylinderGeometry(.22, .22, .012, 20), soil); top.position.y = .302;
      for (let index = 0; index < 16; index++) {
        const angle = index * 2.4, leaf = mesh(root, leafGeometry, leaves);
        leaf.position.set(Math.sin(angle) * .22, .4 + index * .031, Math.cos(angle) * .22);
        leaf.scale.set(.11, .014, .22); leaf.rotation.set(.3, angle, .15);
      }
    } else {
      const trunk = mesh(root, trunkGeometry, bark); trunk.scale.y = .67; trunk.position.y = .335;
      projectSurfaceUV(trunkGeometry, .7);
      if (item.kind === 'olive-tree') {
        for (let branch = 0; branch < 7; branch++) {
          const angle = branch * 2.4, end = new THREE.Vector3(Math.cos(angle) * .27, .70 + branch % 3 * .07, Math.sin(angle) * .27);
          const start = new THREE.Vector3(0, .38 + branch * .025, 0), direction = end.clone().sub(start);
          const twig = mesh(root, trunkGeometry, bark);
          twig.position.copy(start).add(end).multiplyScalar(.5);
          twig.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()); twig.scale.set(.38, direction.length(), .38);
        }
      }
      const count = item.kind === 'olive-tree' ? 2200 : 1500;
      const canopy = new THREE.InstancedMesh(leafGeometry, item.kind === 'olive-tree' ? leaves : darkLeaves, count);
      const placement = new THREE.Object3D(), shade = new THREE.Color();
      const noise = (seed: number) => { const value = Math.sin(seed * 91.345 + 4.234) * 43758.5453; return value - Math.floor(value); };
      for (let index = 0; index < count; index++) {
        const angle = noise(index * 3 + 1) * Math.PI * 2, n = noise(index * 5 + 7);
        const y = item.kind === 'olive-tree' ? .48 + n * .47 : .22 + n * .72;
        const radius = (item.kind === 'olive-tree' ? .45 * Math.sqrt(Math.max(0, 1 - ((y - .72) / .25) ** 2)) : .43 * (1 - (y - .22) / .75)) * Math.sqrt(noise(index * 11 + 13));
        placement.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        placement.rotation.set(noise(index * 17 + 3) * Math.PI, noise(index * 19 + 5) * Math.PI * 2, noise(index * 23 + 9) * Math.PI * 2);
        placement.scale.set(item.kind === 'olive-tree' ? .004 : .018, .002, item.kind === 'olive-tree' ? .018 : .04);
        placement.updateMatrix(); canopy.setMatrixAt(index, placement.matrix);
        shade.setRGB(.8 + n * .2, .83 + n * .17, .75 + n * .2); canopy.setColorAt(index, shade);
      }
      canopy.instanceMatrix.needsUpdate = true;
      if (canopy.instanceColor) canopy.instanceColor.needsUpdate = true;
      root.add(canopy);
    }
    const meta = { role: 'landscape', landscapeId: item.id, unit: item.unit, ...(item.level === 'garden' ? {} : { floor: item.level }), outside: item.level === 'garden' };
    root.userData = meta;
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.userData = meta; object.castShadow = object.receiveShadow = true; pickables.push(object);
      materials.push(...(Array.isArray(object.material) ? object.material : [object.material]));
    });
  }
  // Empty landscapes own no geometry; unused templates must not linger.
  if (!pickables.some(object => object.geometry === trunkGeometry)) trunkGeometry.dispose();
  if (!pickables.some(object => object.geometry === leafGeometry)) leafGeometry.dispose();
  return { group, materials, pickables };
}
