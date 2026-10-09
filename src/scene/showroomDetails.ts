import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BASE_DEPTH, BASE_WIDTH, PARTY_Z, floorElevation, resolvedFurniture, resolvedRooms, resolvedWalls } from '../model/plans';
import { getWallApertures } from '../model/cad';
import type { FloorId, SimulationState, UnitId } from '../model/types';
import { createFinish, projectSurfaceUV, SURFACE_ASSETS, type Finish } from './materialLibrary';
import type { RealisticAssets } from './realisticAssets';
import { batchDecorations } from './batchDecorations';

/** Decorative staging follows the editable model. It never replaces walls, apertures or floor supports. */
export function buildShowroomDetails(state: SimulationState, assets?: RealisticAssets) {
  const group = new THREE.Group();
  group.name = 'Showroom interior staging';
  const materials: THREE.Material[] = [];
  const finishes = new Map<string, THREE.MeshPhysicalMaterial>();
  const finish = (name: Finish, tint?: number) => {
    const key = `${name}-${tint ?? ''}`, previous = finishes.get(key);
    if (previous) return previous;
    const material = createFinish(name), maps = assets?.surfaces.get(material.userData.surface);
    if (maps) {
      material.map = maps.color; material.normalMap = maps.normal ?? null; material.roughnessMap = maps.roughness;
      material.normalScale.setScalar(name === 'fabric' ? .18 : .12);
    }
    if (name === 'fabric') material.map = null;
    if (tint !== undefined) material.color.setHex(tint);
    finishes.set(key, material); materials.push(material);
    return material;
  };
  const mesh = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const result = new THREE.Mesh(geometry, material);
    const scale = SURFACE_ASSETS.find(asset => asset.id === material.userData.surface)?.metres;
    if (scale) projectSurfaceUV(geometry, scale);
    result.castShadow = result.receiveShadow = true;
    parent.add(result);
    return result;
  };
  const box = (parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], material: THREE.Material, rounded: boolean | 'soft' = false) => {
    const geometry = rounded ? new RoundedBoxGeometry(...size, rounded === 'soft' ? 4 : 2, Math.min(...size) * (rounded === 'soft' ? .47 : .1)) : new THREE.BoxGeometry(...size);
    const result = mesh(parent, geometry, material); result.position.set(...position); return result;
  };
  const cylinder = (parent: THREE.Object3D, radius: number, bottomRadius: number, height: number, position: [number, number, number], material: THREE.Material) => {
    const result = mesh(parent, new THREE.CylinderGeometry(radius, bottomRadius, height, 20), material);
    result.position.set(...position); return result;
  };
  const stem = (parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material) => {
    const direction = to.clone().sub(from);
    const result = cylinder(parent, radius, radius, direction.length(), [0, 0, 0], material);
    result.position.copy(from).add(to).multiplyScalar(.5);
    result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  };
  const vase = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const ceramic = finish('ceramic', 0xe5dccb);
    cylinder(parent, .09, .13, .23, [x, y + .115, z], ceramic);
    cylinder(parent, .06, .09, .06, [x, y + .26, z], ceramic);
    for (let index = 0; index < 5; index++) {
      const angle = index * 2.4;
      stem(parent, new THREE.Vector3(x, y + .22, z), new THREE.Vector3(x + Math.sin(angle) * .16, y + .65, z + Math.cos(angle) * .1), .005, finish('wood', 0x6e7446));
    }
  };
  const linen = finish('fabric', 0xf0e9d9), black = finish('dark', 0x171a19), wood = finish('wood'), brass = finish('metal', 0xba9864);
  brass.roughness = .42;
  const daylight = state.minutes > 420 && state.minutes < 1080;
  const lightMaterial = new THREE.MeshStandardMaterial({ color: 0xffe8c2, emissive: 0xffd49d, emissiveIntensity: daylight ? 1.4 : 3, roughness: .55 });
  materials.push(lightMaterial);
  const artwork = finish('paint', 0xe2d8c8).clone();
  artwork.roughness = 1; materials.push(artwork);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 192;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#e2d8c8'; context.fillRect(0, 0, 256, 192);
      context.fillStyle = '#7a8975'; context.beginPath(); context.ellipse(128, 152, 118, 80, -.12, 0, Math.PI * 2); context.fill();
      context.fillStyle = '#b0a083'; context.beginPath(); context.ellipse(208, 116, 96, 60, .3, 0, Math.PI * 2); context.fill();
      context.fillStyle = '#414d44'; context.beginPath(); context.ellipse(23, 185, 139, 61, .12, 0, Math.PI * 2); context.fill();
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      artwork.map = texture; artwork.color.setHex(0xffffff);
    }
  }
  for (const unit of ['north', 'south'] as UnitId[]) {
    const building = state.buildings[unit];
    if (!building.enabled) continue;
    const house = new THREE.Group();
    house.position.set(building.x, 0, PARTY_Z + building.z);
    house.rotation.y = -building.rotation * Math.PI / 180;
    house.scale.set(building.width / BASE_WIDTH, 1, building.depth / BASE_DEPTH[unit]);
    group.add(house);
    const floors = (['ground', 'first', 'basement'] as FloorId[]).filter(floor => floor !== 'first' || building.storeys === 2);
    for (const floor of floors) {
      const elevation = floorElevation(floor, building), height = floor === 'ground' ? building.groundHeight : floor === 'first' ? building.upperHeight : building.basementDepth;
      const level = new THREE.Group(); level.userData = { unit, floor }; level.position.y = elevation; house.add(level);
      const rooms = resolvedRooms(state).filter(room => room.unit === unit && room.floor === floor);
      const furniture = resolvedFurniture(state).filter(item => item.unit === unit && item.floor === floor);
      const decorated = new Set<string>();
      for (const wall of resolvedWalls(state).filter(wall => wall.unit === unit && wall.floor === floor && !wall.low)) {
        const dx = wall.b[0] - wall.a[0], dz = wall.b[1] - wall.a[1], length = Math.hypot(dx, dz);
        const wallDetails = new THREE.Group(); level.add(wallDetails);
        wallDetails.position.set(wall.a[0], 0, wall.a[1] - PARTY_Z); wallDetails.rotation.y = -Math.atan2(dz, dx);
        const openings = getWallApertures(wall, state);
        const edges = [0, ...openings.filter(opening => opening.sill < .1).flatMap(opening => [opening.center - opening.width / 2, opening.center + opening.width / 2]), length];
        for (let index = 0; index + 1 < edges.length; index += 2) {
          if (edges[index + 1] - edges[index] < .03) continue;
          for (const sign of [-1, 1]) box(wallDetails, [edges[index + 1] - edges[index], .085, .025],
            [(edges[index + 1] + edges[index]) / 2, .043, sign * (wall.thickness / 2 + .008)], finish('paint'));
        }
        const nearbyRoom = rooms.find(room => ['living', 'bedroom'].includes(room.kind) && !decorated.has(room.id)
          && Math.abs(room.center[0] - (wall.a[0] + wall.b[0]) / 2) < room.width / 2 + .3
          && Math.abs(room.center[1] - (wall.a[1] + wall.b[1]) / 2) < room.depth / 2 + .3);
        const solid = [0, ...openings.flatMap(opening => [opening.center - opening.width / 2, opening.center + opening.width / 2]), length];
        const section = solid.findIndex((from, index) => index % 2 === 0 && solid[index + 1] - from > 1.5);
        if (nearbyRoom && section >= 0) {
          const center = (solid[section] + solid[section + 1]) / 2;
          const side = (nearbyRoom.center[0] - wall.a[0]) * -dz + (nearbyRoom.center[1] - wall.a[1]) * dx < 0 ? -1 : 1;
          box(wallDetails, [1.17, .83, .035], [center, 1.68, side * (wall.thickness / 2 + .025)], wood, true);
          const picture = mesh(wallDetails, new THREE.PlaneGeometry(1.06, .72), artwork);
          picture.position.set(center, 1.68, side * (wall.thickness / 2 + .045));
          if (side < 0) picture.rotation.y = Math.PI;
          decorated.add(nearbyRoom.id);
        }
        if (!wall.exterior) continue;
        for (const opening of openings.filter(item => item.width > 1.5 && item.height > 1.6)) {
          const localCenter = [(wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2];
          const nearest = [...rooms].sort((a, b) => Math.hypot(a.center[0] - localCenter[0], a.center[1] - localCenter[1])
            - Math.hypot(b.center[0] - localCenter[0], b.center[1] - localCenter[1]))[0];
          const side = nearest && (nearest.center[0] - localCenter[0]) * -dz + (nearest.center[1] - localCenter[1]) * dx < 0 ? -1 : 1;
          const z = side * (wall.thickness / 2 + .11), top = Math.min(height - .28, opening.sill + opening.height + .12);
          const rod = cylinder(wallDetails, .015, .015, opening.width + .45, [opening.center, top, z], black);
          rod.rotation.z = Math.PI / 2;
          for (const sign of [-1, 1]) {
            const width = Math.min(.48, opening.width * .18), curtainHeight = top - .04;
            const geometry = new THREE.PlaneGeometry(width, curtainHeight, 30, 1);
            const positions = geometry.getAttribute('position');
            for (let index = 0; index < positions.count; index++) positions.setZ(index, Math.sin(positions.getX(index) / width * Math.PI * 14) * .027);
            geometry.computeVertexNormals();
            const curtain = mesh(wallDetails, geometry, linen);
            curtain.position.set(opening.center + sign * (opening.width / 2 - width * .16), curtainHeight / 2, z);
            curtain.castShadow = false;
          }
        }
      }
      for (const item of furniture) {
        const details = new THREE.Group(); level.add(details);
        details.position.set(item.center[0], 0, item.center[1] - PARTY_Z);
        details.rotation.y = -item.rotation * Math.PI / 180;
        const { width: w, depth: d, height: h } = item;
        if (item.kind === 'kitchen-unit' || item.kind === 'kitchen-island') {
          const length = Math.max(w, d), depth = Math.min(w, d), count = Math.max(1, Math.round(length / .6));
          if (d > w) details.rotation.y -= Math.PI / 2;
          const front = depth / 2 + .013;
          for (let index = 0; index < count; index++) {
            const x = -length / 2 + (index + .5) * length / count;
            box(details, [length / count - .025, h - .13, .022], [x, (h - .07) / 2, front], item.kind === 'kitchen-island' ? black : wood, true);
            box(details, [Math.min(.2, length / count * .48), .015, .027], [x, h * .78, front + .025], brass, true);
          }
          box(details, [length, .07, .025], [0, .035, front - .02], black);
          if (length > 1.4) {
            const board = box(details, [.35, .018, .25], [-length * .3, h + .015, 0], wood, true); board.rotation.y = .22;
            vase(details, length * .3, h, 0);
          }
        }
        if (item.kind === 'coffee-table' || item.kind === 'dining-table') {
          vase(details, w * .18, h, 0);
          if (item.kind === 'coffee-table') for (let index = 0; index < 3; index++) {
            const book = box(details, [.26, .025, .19], [-w * .2, h + .017 + .026 * index, d * .1],
              finish('paint', [0xc3b092, 0xe5dfd1, 0x333c36][index]));
            book.rotation.y = index * .08;
          } else {
            for (const sign of [-1, 1]) cylinder(details, .115, .105, .016, [sign * w * .29, h + .014, d * .22], finish('ceramic'));
          }
        }
        if (item.kind === 'sofa') {
          box(details, [w + .65, .014, d + 1.6], [0, .012, -.55], finish('fabric', 0xc8bdab), true);
          for (const sign of [-1, 1]) {
            const pillow = box(details, [.32, .33, .16], [sign * w * .28, h * .77, d * .11], finish('fabric', sign > 0 ? 0x68756c : 0xd9c3a2), 'soft');
            pillow.rotation.set(-.14, sign * .2, sign * .12);
          }
        }
        if (item.kind === 'bed') {
          box(details, [w + .65, .015, d + .45], [0, .012, .18], finish('fabric', 0xd2c5ad), true);
          box(details, [w + .08, .85, .08], [0, .5, -d / 2 + .04], finish('fabric', 0xb4a68f), true);
          box(details, [w * .96, .08, d * .25], [0, h * .7, d * .25], finish('fabric', 0xb3b5a4), true);
          for (const sign of [-1, 1]) {
            box(details, [.36, .38, .33], [sign * (w / 2 + .23), .21, -d * .3], wood, true);
            cylinder(details, .04, .07, .15, [sign * (w / 2 + .23), .49, -d * .3], brass);
            const lamp = mesh(details, new THREE.SphereGeometry(.10, 16, 10), lightMaterial);
            lamp.position.set(sign * (w / 2 + .23), .6, -d * .3);
          }
        }
      }
      let lamps = 0;
      for (const room of rooms) {
        if (room.kind === 'living' || room.kind === 'dining' || room.kind === 'kitchen') {
          const x = room.center[0], z = room.center[1] - PARTY_Z, y = Math.max(2.1, height - .6);
          const shade = cylinder(level, .10, .23, .20, [x, y, z], black);
          shade.name = 'Pendant shade';
          cylinder(level, .006, .006, height - .24 - y, [x, (height - .24 + y) / 2, z], black);
          cylinder(level, .195, .195, .012, [x, y - .105, z], lightMaterial);
          if (lamps++ < 3) {
            const light = new THREE.PointLight(0xffdfb0, daylight ? 9 : 24, 8, 2);
            light.position.set(x, y - .14, z); level.add(light);
          }
        }
      }
    }
  }
  batchDecorations(group);
  return { group, materials };
}
