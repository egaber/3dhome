import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Compass, Download, Grid2X2, Move3D, RotateCcw, Save, Sparkles, Sun, Upload, X } from 'lucide-react';
import Inspector from './components/Inspector';
import { FloorEditor2D } from './components/FloorEditor2D';
import { ModelChat, type ChatMessage } from './components/ModelChat';
import { QuickObjectEditor, type PickedObject } from './components/QuickObjectEditor';
import { RenderPanel } from './components/RenderPanel';
import { Button } from './components/ui/button';
import { calculateSolar, getSunPath } from './lib/solar';
import { loadProject, parseProject, saveProject, serializeProject } from './lib/project';
import { FOOTPRINTS, PLAN_IMAGES, ROOMS, SITE, WALLS, defaultState, floorElevation, planPoint, resolvedOpenings, siteWarnings, trueWorldPoint } from './model/plans';
import type { DailyExposure, OpeningKind, OpeningSpec, RoomExposure, SimulationState, UnitId } from './model/types';
import { buildArchitecture, directExposure, disposeArchitecture, readPalette, roomSamplePoints } from './scene/architecture';

type Runtime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  content: THREE.Group;
  architecture: ReturnType<typeof buildArchitecture> | null;
  sun: THREE.DirectionalLight;
  ambient: THREE.HemisphereLight;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
};

type CameraBookmark = { position: [number, number, number]; target: [number, number, number]; up: [number, number, number] };
type SessionData = { camera: CameraBookmark | null; selectedUnit: UnitId; selectedOpening: string | null; selectedRoom: string; chat: ChatMessage[] };
const SESSION_KEY = 'dori-solar-studio-session-v1';

function loadSession(): SessionData {
  const fallback: SessionData = { camera: null, selectedUnit: 'north', selectedOpening: null, selectedRoom: ROOMS[0].id, chat: [] };
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Partial<SessionData> | null;
    if (!value) return fallback;
    const vector = (item: unknown): item is [number, number, number] => Array.isArray(item) && item.length === 3 && item.every(Number.isFinite);
    const camera = value.camera && vector(value.camera.position) && vector(value.camera.target) && vector(value.camera.up) ? value.camera : null;
    return {
      camera,
      selectedUnit: value.selectedUnit === 'south' ? 'south' : 'north',
      selectedOpening: typeof value.selectedOpening === 'string' ? value.selectedOpening : null,
      selectedRoom: ROOMS.some(room => room.id === value.selectedRoom) ? value.selectedRoom! : fallback.selectedRoom,
      chat: Array.isArray(value.chat) ? value.chat.filter(message => message && (message.role === 'user' || message.role === 'assistant') && typeof message.text === 'string').slice(-40) : [],
    };
  } catch { return fallback; }
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function convexHull(points: [number, number][]): [number, number][] {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: [number, number][] = [];
  for (const point of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function flatShape(points: [number, number][]): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  points.forEach(([x, z], index) => index === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z));
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function commandNumber(text: string): number | null {
  const match = text.replace(/יחידה\s*[12]/g, '').match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const value = Number(match[0].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function applyModelCommand(command: string, state: SimulationState, currentUnit: UnitId, selectedOpening: string | null) {
  const text = command.trim();
  const value = commandNumber(text);
  const unit: UnitId = /יחידה\s*(?:ב|ב׳|2)|קדמית|דרומית/.test(text) ? 'south'
    : /יחידה\s*(?:א|א׳|1)|עורפית|צפונית/.test(text) ? 'north' : currentUnit;
  const clamp = (number: number, min: number, max: number) => Math.min(max, Math.max(min, number));
  const patchBuilding = (patch: Partial<SimulationState['buildings'][UnitId]>, label: string) => ({
    state: { ...state, buildings: { ...state.buildings, [unit]: { ...state.buildings[unit], ...patch } } },
    message: `${label} עודכן ביחידה ${unit === 'north' ? 'א׳' : 'ב׳'}. השינוי נשמר אוטומטית.`, selectedOpening,
  });

  if (/שעה/.test(text)) {
    const time = text.match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)/);
    if (time) return { state: { ...state, minutes: Number(time[1]) * 60 + Number(time[2]) }, message: `שעת השמש עודכנה ל־${time[1].padStart(2, '0')}:${time[2]}.`, selectedOpening };
  }
  const date = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (/תאריך/.test(text) && date) return { state: { ...state, date: date[0] }, message: `תאריך הסימולציה עודכן ל־${date[0]}.`, selectedOpening };

  if (value !== null && /גובה\s*(?:קומת\s*)?קרקע/.test(text)) return patchBuilding({ groundHeight: clamp(value, 2.3, 6) }, `גובה קומת הקרקע ל־${clamp(value, 2.3, 6)} מ׳`);
  if (value !== null && /גובה\s*(?:קומה\s*)?(?:ראשונה|עליונה)/.test(text)) return patchBuilding({ upperHeight: clamp(value, 2.3, 6) }, `גובה הקומה הראשונה ל־${clamp(value, 2.3, 6)} מ׳`);
  if (value !== null && /עומק\s*מרתף/.test(text)) return patchBuilding({ basementDepth: clamp(value, 1, 6) }, `עומק המרתף ל־${clamp(value, 1, 6)} מ׳`);
  if (value !== null && /גובה\s*מעקה/.test(text)) return patchBuilding({ parapet: clamp(value, 0, 3) }, `גובה המעקה ל־${clamp(value, 0, 3)} מ׳`);
  if (value !== null && /רוחב\s*(?:ה)?מבנה|רוחב\s*(?:ה)?בית/.test(text)) return patchBuilding({ width: clamp(value, 5, 18) }, `רוחב המבנה ל־${clamp(value, 5, 18)} מ׳`);
  if (value !== null && /עומק\s*(?:ה)?מבנה|עומק\s*(?:ה)?בית/.test(text)) return patchBuilding({ depth: clamp(value, 3, 20) }, `עומק המבנה ל־${clamp(value, 3, 20)} מ׳`);
  if (value !== null && /גובה\s*שכן/.test(text)) {
    const id = /מזרח/.test(text) ? 'east' : /מערב/.test(text) ? 'west' : null;
    if (!id) return { state, message: 'צריך לציין ״שכן מזרח״ או ״שכן מערב״.', selectedOpening };
    const height = clamp(value, 1, 30);
    return { state: { ...state, neighbors: state.neighbors.map(neighbor => neighbor.id === id ? { ...neighbor, height, roofRise: Math.min(neighbor.roofRise, height - .1) } : neighbor) }, message: `גובה השכן ${id === 'east' ? 'המזרחי' : 'המערבי'} עודכן ל־${height} מ׳.`, selectedOpening };
  }

  const all = resolvedOpenings(state);
  const target = all.find(opening => opening.id === selectedOpening);
  if (/הוסף|תוסיף/.test(text) && /חלון|ויטרינה|דלת|פתח/.test(text)) {
    const wall = target ? WALLS.find(item => item.id === target.wallId) : WALLS.find(item => item.unit === unit && item.floor === 'ground' && item.exterior && item.low === undefined);
    if (!wall) return { state, message: 'לא נמצא קיר מתאים. בחר פתח או קיר ביחידה הרצויה ונסה שוב.', selectedOpening };
    const kind: OpeningKind = /ויטרינה/.test(text) ? 'glazing' : /דלת/.test(text) ? 'door' : /פתח\s*חופשי/.test(text) ? 'void' : 'window';
    const opening: OpeningSpec = {
      id: `added-${crypto.randomUUID()}`, wallId: wall.id, unit: wall.unit, floor: wall.floor, source: 'added',
      label: `${kind === 'glazing' ? 'ויטרינה' : kind === 'door' ? 'דלת' : kind === 'void' ? 'פתח חופשי' : 'חלון'} נוסף בצ׳אט`,
      kind, position: .5, width: value === null ? (kind === 'glazing' ? 2.8 : 1.2) : clamp(value, .2, 12),
      height: kind === 'glazing' || kind === 'door' ? 2.4 : 1.35, sill: kind === 'window' ? .95 : 0,
      open: kind === 'void', shutter: false, overhang: 0,
    };
    return { state: { ...state, addedOpenings: [...state.addedOpenings, opening] }, message: `${opening.label} נוסף במרכז הקיר. הוא נבחר כעת וניתן להמשיך לערוך אותו בצ׳אט.`, selectedOpening: opening.id };
  }
  const needsOpening = /פתח|חלון|ויטרינה|דלת|תריס|אדן|הצללה|גגון/.test(text);
  if (needsOpening && !target) return { state, message: 'לא נבחר פתח. בחר פתח בלשונית ״פתחים״ או בקליק כפול במודל ואז נסה שוב.', selectedOpening };
  if (target) {
    let patch: Partial<OpeningSpec> | null = null;
    let description = '';
    if (/מחק|הסר/.test(text)) { patch = { width: 0, height: 0 }; description = 'הפתח הוסר'; }
    else if (/ויטרינה/.test(text) && /שנה|הפוך|עדכן/.test(text)) { patch = { kind: 'glazing', sill: 0, height: Math.max(2.2, target.height) }; description = 'הפתח שונה לויטרינה'; }
    else if (/חלון/.test(text) && /שנה|הפוך|עדכן/.test(text)) { patch = { kind: 'window' }; description = 'הפתח שונה לחלון'; }
    else if (/דלת/.test(text) && /שנה|הפוך|עדכן/.test(text)) { patch = { kind: 'door', sill: 0 }; description = 'הפתח שונה לדלת'; }
    else if (value !== null && /רוחב/.test(text)) { patch = { width: clamp(value, 0, 45) }; description = `רוחב הפתח עודכן ל־${clamp(value, 0, 45)} מ׳`; }
    else if (value !== null && /גובה\s*(?:ה)?פתח|גובה\s*(?:ה)?חלון|גובה\s*(?:ה)?ויטרינה|גובה\s*(?:ה)?דלת/.test(text)) { patch = { height: clamp(value, 0, 6) }; description = `גובה הפתח עודכן ל־${clamp(value, 0, 6)} מ׳`; }
    else if (value !== null && /אדן/.test(text)) { patch = { sill: clamp(value, 0, 6) }; description = `גובה האדן עודכן ל־${clamp(value, 0, 6)} מ׳`; }
    else if (value !== null && /הצללה|גגון/.test(text)) { patch = { overhang: clamp(value, 0, 3) }; description = `בליטת ההצללה עודכנה ל־${clamp(value, 0, 3)} מ׳`; }
    else if (/פתח\s*(?:את\s*)?הדלת|דלת\s*פתוחה/.test(text)) { patch = { open: true }; description = 'הדלת נפתחה'; }
    else if (/סגור\s*(?:את\s*)?הדלת|דלת\s*סגורה/.test(text)) { patch = { open: false }; description = 'הדלת נסגרה'; }
    else if (/סגור\s*(?:את\s*)?התריס|תריס\s*סגור/.test(text)) { patch = { shutter: true }; description = 'התריס נסגר'; }
    else if (/פתח\s*(?:את\s*)?התריס|תריס\s*פתוח/.test(text)) { patch = { shutter: false }; description = 'התריס נפתח'; }
    if (patch) return { state: { ...state, openings: { ...state.openings, [target.id]: { ...state.openings[target.id], ...patch } } }, message: `${description}. השינוי מופיע ונשמר מיד.`, selectedOpening: target.id };
  }
  return { state, message: 'לא זיהיתי שינוי. אפשר לבקש גובה קומה/שכן, רוחב או עומק מבנה, הוספת חלון, או לבחור פתח ולשנות סוג, רוחב, גובה, אדן, תריס וגגון.', selectedOpening };
}

function Viewer({ state, selectedRoom, onSelectOpening, onPickObject, restoredCamera, onCameraChange, canvasRef, walkVector }: {
  state: SimulationState;
  selectedRoom: string;
  onSelectOpening: (id: string) => void;
  onPickObject: (object: PickedObject) => void;
  restoredCamera: CameraBookmark | null;
  onCameraChange: (camera: CameraBookmark) => void;
  canvasRef: { current: HTMLCanvasElement | null };
  walkVector: { forward: number; strafe: number };
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const skipInitialViewReset = useRef(!!restoredCamera);
  const [runtimeReady, setRuntimeReady] = useState(0);
  const walkVectorRef = useRef(walkVector);
  const walkModeRef = useRef(state.view.mode === 'walk');
  const walkKeys = useRef(new Set<string>());
  useEffect(() => { walkVectorRef.current = walkVector; }, [walkVector]);
  useEffect(() => { walkModeRef.current = state.view.mode === 'walk'; }, [state.view.mode]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || state.view.mode !== 'walk' || (!walkVector.forward && !walkVector.strafe)) return;
    const forward = runtime.controls.target.clone().sub(runtime.camera.position); forward.y = 0; forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const motion = forward.multiplyScalar(walkVector.forward).add(right.multiplyScalar(walkVector.strafe)).normalize().multiplyScalar(.42);
    const ray = new THREE.Raycaster(runtime.camera.position, motion.clone().normalize(), .08, motion.length() + .28);
    const blocked = runtime.architecture ? ray.intersectObjects(runtime.architecture.blockers, false).some(hit => {
      const role = hit.object.userData.role as string | undefined;
      return role === 'wall' || role === 'boundary-wall' || role === 'neighbor' || role === 'roof-room';
    }) : false;
    if (!blocked) {
      runtime.camera.position.add(motion); runtime.controls.target.add(motion); runtime.controls.update();
      onCameraChange({ position: runtime.camera.position.toArray(), target: runtime.controls.target.toArray(), up: runtime.camera.up.toArray() });
    }
  }, [onCameraChange, state.view.mode, walkVector]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 500);
    camera.position.set(29, 25, 32);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    canvasRef.current = renderer.domElement;
    host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(6, 3, 6);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 2;
    controls.maxDistance = 120;
    if (restoredCamera) {
      camera.position.fromArray(restoredCamera.position);
      camera.up.fromArray(restoredCamera.up);
      controls.target.fromArray(restoredCamera.target);
    }
    let cameraSaveTimer = 0;
    const rememberCamera = () => {
      window.clearTimeout(cameraSaveTimer);
      cameraSaveTimer = window.setTimeout(() => onCameraChange({
        position: camera.position.toArray(), target: controls.target.toArray(), up: camera.up.toArray(),
      }), 180);
    };
    controls.addEventListener('change', rememberCamera);
    const content = new THREE.Group();
    scene.add(content);
    const sun = new THREE.DirectionalLight(0xffffff, 3.2);
    sun.castShadow = true;
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 180;
    sun.shadow.bias = -0.0003;
    scene.add(sun, sun.target);
    const ambient = new THREE.HemisphereLight(0xffffff, 0xffffff, 1.25);
    scene.add(ambient);
    const runtime: Runtime = {
      scene, camera, renderer, controls, content, architecture: null, sun, ambient,
      raycaster: new THREE.Raycaster(), pointer: new THREE.Vector2(),
    };
    runtimeRef.current = runtime;
    setRuntimeReady(value => value + 1);
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    let frame = 0;
    let previous = performance.now();
    const keyDown = (event: KeyboardEvent) => { if ('wasd'.includes(event.key.toLowerCase())) walkKeys.current.add(event.key.toLowerCase()); };
    const keyUp = (event: KeyboardEvent) => walkKeys.current.delete(event.key.toLowerCase());
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
    const render = () => {
      frame = requestAnimationFrame(render);
      const now = performance.now();
      const delta = Math.min(.05, (now - previous) / 1000); previous = now;
      if (walkModeRef.current) {
        const input = walkVectorRef.current;
        const forwardInput = input.forward + (walkKeys.current.has('w') ? 1 : 0) - (walkKeys.current.has('s') ? 1 : 0);
        const strafeInput = input.strafe + (walkKeys.current.has('d') ? 1 : 0) - (walkKeys.current.has('a') ? 1 : 0);
        if (forwardInput || strafeInput) {
          const forward = runtime.controls.target.clone().sub(runtime.camera.position); forward.y = 0; forward.normalize();
          const right = new THREE.Vector3(-forward.z, 0, forward.x);
          const motion = forward.multiplyScalar(forwardInput).add(right.multiplyScalar(strafeInput)).normalize().multiplyScalar(2.3 * delta);
          const collisionRay = new THREE.Raycaster(runtime.camera.position, motion.clone().normalize(), .08, motion.length() + .32);
          const blocked = runtime.architecture
            ? collisionRay.intersectObjects(runtime.architecture.blockers, false).length > 0
            : false;
          const nextX = runtime.camera.position.x + motion.x;
          const nextZ = runtime.camera.position.z + motion.z;
          if (!blocked && nextX > -8 && nextX < 24 && nextZ > -18 && nextZ < 28) {
            runtime.camera.position.add(motion); runtime.controls.target.add(motion);
            rememberCamera();
          }
        }
      }
      controls.update();
      // Keep a neighboring mass from blocking the relevant model when the
      // camera passes through or behind it. Restore all neighbors first.
      if (runtime.architecture) {
        for (const object of runtime.architecture.pickables) {
          if (object.userData.neighborId && object.parent) object.parent.visible = true;
        }
        const sight = controls.target.clone().sub(camera.position);
        const distance = sight.length();
        if (distance > .1) {
          runtime.raycaster.set(camera.position, sight.normalize());
          runtime.raycaster.far = distance;
          const obstruction = runtime.raycaster.intersectObjects(runtime.architecture.pickables, false)
            .find(hit => hit.object.userData.neighborId);
          if (obstruction) {
            const mass = obstruction.object.parent;
            if (mass) mass.visible = false;
          }
        }
      }
      renderer.render(scene, camera);
    };
    render();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp);
      observer.disconnect();
      window.clearTimeout(cameraSaveTimer);
      controls.removeEventListener('change', rememberCamera);
      controls.dispose();
      if (runtime.architecture) disposeArchitecture(runtime.architecture);
      renderer.dispose();
      renderer.domElement.remove();
      canvasRef.current = null;
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
      const runtime = runtimeRef.current;
      if (!runtime) return undefined;
      if (runtime.architecture) disposeArchitecture(runtime.architecture);
      runtime.content.traverse(object => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshBasicMaterial && material.map) material.map.dispose();
          material.dispose();
        }
      });
      runtime.content.clear();
      const palette = readPalette();
      runtime.scene.background = new THREE.Color(palette.background);
      runtime.renderer.toneMapping = state.view.renderMode === 'realistic' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
      runtime.renderer.toneMappingExposure = state.view.renderMode === 'realistic' ? 1.12 : 1;
      const architecture = buildArchitecture(state, palette);
      runtime.architecture = architecture;
      runtime.content.add(architecture.group);
      const isolation = state.view.isolateFloor;
      if (isolation !== 'none') {
        architecture.group.traverse(object => {
          let owner: THREE.Object3D | null = object;
          let displayFloor: string | undefined;
          while (owner && owner !== architecture.group) {
            if (owner.userData.displayFloor) {
              displayFloor = owner.userData.displayFloor as string;
              break;
            }
            owner = owner.parent;
          }
          const floor = displayFloor ?? object.userData.floor as string | undefined;
          const isStair = object.userData.role === 'stair';
          if (floor && floor !== isolation && !isStair) object.visible = false;
          if (isolation === 'roof' && object.userData.role === 'roof-peak') object.visible = false;
        });
      }

      // A translucent yellow receiver makes the illuminated parts of the lot
      // legible while opaque geometry produces crisp, dark shadow silhouettes.
      const sunlightMaterial = new THREE.MeshStandardMaterial({
        color: palette.warning,
        transparent: true,
        opacity: .24,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
      });
      architecture.materials.push(sunlightMaterial);
      const sunlightPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(SITE.right - SITE.left, SITE.front - SITE.back),
        sunlightMaterial,
      );
      sunlightPlane.rotation.x = -Math.PI / 2;
      sunlightPlane.position.set((SITE.left + SITE.right) / 2, .055, (SITE.back + SITE.front) / 2);
      sunlightPlane.receiveShadow = true;
      sunlightPlane.renderOrder = 3;
      architecture.group.add(sunlightPlane);

      if (state.view.grid) {
        const grid = new THREE.GridHelper(100, 100, palette.border, palette.border);
        grid.position.y = 0.025;
        grid.material.transparent = true;
        grid.material.opacity = 0.35;
        runtime.content.add(grid);
      }

      if (state.view.planVisible) {
        const source = PLAN_IMAGES[state.view.planFloor];
        const width = (source.crop[2] - source.crop[0]) / 28.38329864901747;
        const depth = (source.crop[3] - source.crop[1]) / 28.38329864901747;
        const center: [number, number] = [
          ((source.crop[2] + source.crop[0]) / 2 - source.origin[0]) / 28.38329864901747,
          ((source.crop[3] + source.crop[1]) / 2 - source.origin[1]) / 28.38329864901747,
        ];
        const texture = new THREE.TextureLoader().load(source.url);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: state.view.planOpacity, depthWrite: false });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
        const world = trueWorldPoint(center, state);
        plane.rotation.x = -Math.PI / 2;
        plane.rotation.z = -THREE.MathUtils.degToRad(state.northBearing);
        plane.position.set(world[0], 0.035, world[1]);
        plane.renderOrder = 2;
        runtime.content.add(plane);
      }

      if (state.view.path) {
        const path = getSunPath(state.date, state.location, 15);
        const points = path.map(item => new THREE.Vector3(item.direction.x, item.direction.y, item.direction.z).multiplyScalar(34).add(new THREE.Vector3(6, 0, 6)));
        if (points.length > 1) {
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: palette.accent }));
          runtime.content.add(line);
        }
      }

      try {
        const solar = calculateSolar(state.date, state.minutes, state.location);
        const direction = new THREE.Vector3(solar.direction.x, solar.direction.y, solar.direction.z);
        runtime.sun.position.copy(direction.clone().multiplyScalar(80));
        runtime.sun.target.position.set(6, 0, 6);
        runtime.sun.visible = solar.aboveHorizon;
        runtime.sun.color.set(palette.warning);
        runtime.sun.intensity = state.view.directOnly ? 5.2 : 4.4;
        runtime.ambient.intensity = state.view.directOnly ? 0.08 : .58;
        sunlightPlane.visible = solar.aboveHorizon;

        if (solar.aboveHorizon) {
          // Draw deterministic projected silhouettes over the plan. The PDF is
          // an unlit texture, so relying on its material to receive shadows is
          // not sufficient for a clearly readable planning overlay.
          const projectedShadowMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(palette.background).offsetHSL(0, 0, -.42),
            transparent: true,
            opacity: .38,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const addProjectedShadow = (footprint: [number, number][], height: number) => {
            if (height <= 0 || direction.y <= .001 || footprint.length < 3) return;
            const factor = Math.min(160, height / direction.y);
            const dx = -direction.x * factor;
            const dz = -direction.z * factor;
            const shifted = footprint.map(([x, z]) => [x + dx, z + dz] as [number, number]);
            const shadow = new THREE.Mesh(flatShape(convexHull([...footprint, ...shifted])), projectedShadowMaterial);
            shadow.position.y = .095;
            shadow.renderOrder = 5;
            runtime.content.add(shadow);
          };
          for (const unit of ['north', 'south'] as UnitId[]) {
            const building = state.buildings[unit];
            if (!building.enabled) continue;
            const floor = building.storeys === 2 ? 'first' : 'ground';
            const footprint = FOOTPRINTS[floor][unit]
              .map(point => trueWorldPoint(planPoint(point, unit, state), state));
            addProjectedShadow(footprint, building.roofEnabled && building.storeys === 2
              ? building.roofPeakHeight
              : building.groundHeight + (building.storeys === 2 ? building.upperHeight : 0) + building.parapet);
          }
          for (const neighbor of state.neighbors) {
            if (!neighbor.enabled) continue;
            const rotation = -THREE.MathUtils.degToRad(neighbor.rotation);
            const corners: [number, number][] = [
              [-neighbor.width / 2, -neighbor.depth / 2], [neighbor.width / 2, -neighbor.depth / 2],
              [neighbor.width / 2, neighbor.depth / 2], [-neighbor.width / 2, neighbor.depth / 2],
            ];
            const footprint = corners.map(([x, z]) => trueWorldPoint([
              x * Math.cos(rotation) + z * Math.sin(rotation) + neighbor.x,
              -x * Math.sin(rotation) + z * Math.cos(rotation) + neighbor.z,
            ], state));
            addProjectedShadow(footprint, neighbor.height);
          }
          for (const x of [SITE.left, SITE.right]) {
            const footprint = [
              [x - .1, SITE.back], [x + .1, SITE.back],
              [x + .1, SITE.front], [x - .1, SITE.front],
            ].map(point => trueWorldPoint(point as [number, number], state));
            addProjectedShadow(footprint, 3);
          }
          addProjectedShadow([
            [SITE.left, SITE.back - .1], [SITE.right, SITE.back - .1],
            [SITE.right, SITE.back + .1], [SITE.left, SITE.back + .1],
          ].map(point => trueWorldPoint(point as [number, number], state)), 3);

          const siteCenter = new THREE.Vector3(6, 3.5, 6);
          const sunPosition = siteCenter.clone().add(direction.clone().multiplyScalar(42));
          const sunGroup = new THREE.Group();
          sunGroup.name = 'Visible sun in sky';
          const disc = new THREE.Mesh(
            new THREE.SphereGeometry(1.55, 32, 20),
            new THREE.MeshBasicMaterial({ color: palette.warning, transparent: true, opacity: .58, depthWrite: false }),
          );
          const halo = new THREE.Mesh(
            new THREE.SphereGeometry(2.35, 24, 16),
            new THREE.MeshBasicMaterial({ color: palette.warning, transparent: true, opacity: .14, depthWrite: false, side: THREE.BackSide }),
          );
          sunGroup.add(disc, halo);
          sunGroup.position.copy(sunPosition);
          runtime.content.add(sunGroup);
          const ray = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([sunPosition, siteCenter]),
            new THREE.LineDashedMaterial({ color: palette.warning, transparent: true, opacity: .52, dashSize: .8, gapSize: .45 }),
          );
          ray.computeLineDistances();
          runtime.content.add(ray);
        }
      } catch {
        runtime.sun.visible = false;
        sunlightPlane.visible = false;
      }
      runtime.renderer.shadowMap.enabled = true;
      runtime.sun.shadow.mapSize.set(state.view.quality === 'high' ? 4096 : 2048, state.view.quality === 'high' ? 4096 : 2048);
      return undefined;
  }, [runtimeReady, state]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const host = hostRef.current;
    if (!runtime || !host) return;
    const pick = (event: MouseEvent) => {
      const rect = host.getBoundingClientRect();
      runtime.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      runtime.raycaster.setFromCamera(runtime.pointer, runtime.camera);
      const hit = runtime.raycaster.intersectObjects(runtime.architecture?.pickables ?? [], true)[0];
      if (!hit) return;
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.openingId && !object.userData.neighborId && !object.userData.unit) object = object.parent;
      if (!object) return;
      if (object.userData.openingId) {
        const id = object.userData.openingId as string;
        onSelectOpening(id);
        onPickObject({ type: 'opening', id, unit: object.userData.unit });
      } else if (object.userData.neighborId) onPickObject({ type: 'neighbor', id: object.userData.neighborId });
      else if (object.userData.unit) onPickObject({ type: 'building', id: object.userData.unit, unit: object.userData.unit });
    };
    host.addEventListener('dblclick', pick);
    return () => host.removeEventListener('dblclick', pick);
  }, [onPickObject, onSelectOpening]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (skipInitialViewReset.current) {
      skipInitialViewReset.current = false;
      return;
    }
    runtime.camera.up.set(0, 1, 0);
    runtime.controls.enableRotate = state.view.mode !== 'plan';
    if (state.view.mode === 'plan') {
      runtime.camera.up.set(0, 0, -1);
      runtime.camera.position.set(6, 48, 6);
      runtime.controls.target.set(6, 0, 6);
      runtime.controls.update();
      return;
    }
    if (state.view.mode === 'orbit') {
      runtime.camera.position.set(29, 25, 32);
      runtime.controls.target.set(6, 3, 6);
      runtime.controls.update();
      return;
    }
    const room = ROOMS.find(item => item.id === selectedRoom);
    if (!room) return;
    const p = planPoint(room.center, room.unit, state);
    const world = trueWorldPoint(p, state);
    const elevation = floorElevation(room.floor, state.buildings[room.unit]);
    runtime.camera.position.set(world[0], elevation + state.view.eyeHeight, world[1]);
    runtime.controls.target.set(world[0] + 2, elevation + Math.max(.4, state.view.eyeHeight - .17), world[1]);
    runtime.controls.update();
    // Camera placement is intentionally tied only to an explicit view-mode or
    // room selection. Sun/time and model edits must preserve the user's orbit.
  }, [selectedRoom, state.view.mode, state.view.eyeHeight]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !restoredCamera) return;
    runtime.camera.position.fromArray(restoredCamera.position);
    runtime.camera.up.fromArray(restoredCamera.up);
    runtime.controls.target.fromArray(restoredCamera.target);
    runtime.controls.update();
  }, [restoredCamera]);

  return <div ref={hostRef} className="viewer" aria-label="תצוגת תלת־ממד אינטראקטיבית" />;
}

export default function App() {
  const initialSession = useMemo(loadSession, []);
  const [state, setState] = useState<SimulationState>(() => {
    const loaded = loadProject() ?? defaultState();
    const southRoofMigration = 'dori-south-attic-v1';
    try {
      if (localStorage.getItem(southRoofMigration) !== 'done') {
        loaded.buildings.south.roofEnabled = true;
        loaded.buildings.south.roofFloorHeight = 2.5;
        loaded.buildings.south.roofPeakHeight = 10.5;
        localStorage.setItem(southRoofMigration, 'done');
      }
    } catch { loaded.buildings.south.roofEnabled = true; }
    const eastId = 'ground-wall-12-south-opening-0';
    if (!loaded.openings[eastId]) loaded.openings[eastId] = {
      kind: 'window', width: 1.4, height: 1.35, sill: .95,
      label: 'חלון מזרחי · החדר הסמוך לבית הצפוני',
    };
    const southWindowId = 'added-south-room-south-window';
    if (!loaded.addedOpenings.some(opening => opening.id === southWindowId)) {
      loaded.addedOpenings.push({
        id: southWindowId, wallId: 'ground-wall-13-south',
        label: 'חלון דרומי גדול · החדר המזרחי', unit: 'south', floor: 'ground', kind: 'window',
        position: .5, width: 1.8, height: 1.5, sill: .8, open: false, shutter: false, overhang: 0, source: 'added',
      });
    }
    const southRoomMigration = 'dori-south-east-room-windows-v1';
    try {
      if (localStorage.getItem(southRoomMigration) !== 'done') {
        loaded.openings[eastId] = {
          ...loaded.openings[eastId], kind: 'window', width: 1.4, height: 1.35, sill: .95,
          label: 'חלון מזרחי · החדר הסמוך לבית הצפוני',
        };
        localStorage.setItem(southRoomMigration, 'done');
      }
    } catch { /* Existing model remains editable if storage is unavailable. */ }
    const northEastId = 'added-north-east-glazing';
    if (!loaded.addedOpenings.some(opening => opening.id === northEastId)) {
      loaded.addedOpenings.push({
        id: northEastId,
        wallId: 'ground-wall-2-north',
        label: 'ויטרינה מזרחית · הבית הצפוני',
        unit: 'north',
        floor: 'ground',
        kind: 'glazing',
        position: .5,
        width: 4.0,
        height: 2.5,
        sill: 0,
        open: false,
        shutter: false,
        overhang: 0,
        source: 'added',
      });
    }
    if (!loaded.openings[northEastId]) loaded.openings[northEastId] = { width: 4.0, position: .5, height: 2.65, sill: 0 };
    for (const [index, width] of [[0, 3.45], [1, 3.45], [2, 3.55]] as const) {
      const id = `ground-wall-0-north-opening-${index}`;
      if (!loaded.openings[id]) loaded.openings[id] = { kind: 'glazing', width, height: 2.65, sill: 0 };
    }
    const northCornerMigration = 'dori-north-corner-glazing-v1';
    try {
      if (localStorage.getItem(northCornerMigration) !== 'done') {
        loaded.openings[northEastId] = { ...loaded.openings[northEastId], width: 4.0, position: .5, height: 2.65, sill: 0 };
        for (const [index, width] of [[0, 3.45], [1, 3.45], [2, 3.55]] as const) {
          const id = `ground-wall-0-north-opening-${index}`;
          loaded.openings[id] = { ...loaded.openings[id], kind: 'glazing', width, height: 2.65, sill: 0 };
        }
        localStorage.setItem(northCornerMigration, 'done');
      }
    } catch { /* Existing values remain available without local storage. */ }
    return loaded;
  });
  const [selectedUnit, setSelectedUnit] = useState<UnitId>(initialSession.selectedUnit);
  const [selectedOpening, setSelectedOpening] = useState<string | null>(initialSession.selectedOpening);
  const [selectedRoom, setSelectedRoom] = useState(initialSession.selectedRoom);
  const [camera, setCamera] = useState<CameraBookmark | null>(initialSession.camera);
  const [cameraRestore, setCameraRestore] = useState<CameraBookmark | null>(initialSession.camera);
  const [chat, setChat] = useState<ChatMessage[]>(initialSession.chat);
  const [picked, setPicked] = useState<PickedObject | null>(null);
  const [exposure, setExposure] = useState<RoomExposure | null>(null);
  const [daily, setDaily] = useState<DailyExposure | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [sources, setSources] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [renderOpen, setRenderOpen] = useState(false);
  const [walkVector, setWalkVector] = useState({ forward: 0, strafe: 0 });
  const [notice, setNotice] = useState('גרסת משחק ראשונית · כל המידות ניתנות לשינוי');
  const importRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => { saveProject(state); }, [state]);
  useEffect(() => {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ camera, selectedUnit, selectedOpening, selectedRoom, chat } satisfies SessionData)); } catch { /* Private mode/quota: project UI remains usable. */ }
  }, [camera, selectedUnit, selectedOpening, selectedRoom, chat]);
  useEffect(() => {
    let architecture: ReturnType<typeof buildArchitecture> | null = null;
    try {
      const room = ROOMS.find(item => item.id === selectedRoom);
      if (!room) return;
      const solar = calculateSolar(state.date, state.minutes, state.location);
      architecture = buildArchitecture(state, readPalette());
      const result = directExposure(roomSamplePoints(room, state), new THREE.Vector3(solar.direction.x, solar.direction.y, solar.direction.z), architecture.blockers, solar.aboveHorizon);
      setExposure({ roomId: room.id, ...result, percent: result.total ? result.lit / result.total * 100 : 0 });
    } catch { setExposure(null); }
    return () => { if (architecture) disposeArchitecture(architecture); };
  }, [state, selectedRoom]);

  const enterRoom = useCallback((id: string) => {
    setSelectedRoom(id);
    setState(current => ({ ...current, view: { ...current.view, mode: 'walk', cutaway: ROOMS.find(room => room.id === id)?.floor ?? 'ground' } }));
  }, []);

  const analyze = useCallback(() => {
    const room = ROOMS.find(item => item.id === selectedRoom);
    if (!room) return;
    setAnalyzing(true);
    setTimeout(() => {
      let architecture: ReturnType<typeof buildArchitecture> | null = null;
      try {
        architecture = buildArchitecture(state, readPalette());
        const points = roomSamplePoints(room, state);
        const path = new Map(getSunPath(state.date, state.location, 10).map(item => [item.minutes, item]));
        const samples = Array.from({ length: 144 }, (_, index) => {
          const minutes = index * 10;
          const sun = path.get(minutes);
          if (!sun) return { minutes, fraction: 0 };
          const result = directExposure(points, new THREE.Vector3(sun.direction.x, sun.direction.y, sun.direction.z), architecture!.blockers, true);
          return { minutes, fraction: result.total ? result.lit / result.total : 0 };
        });
        setDaily({ roomId: room.id, samples, stepMinutes: 10, sunHours: samples.reduce((sum, item) => sum + item.fraction / 6, 0), anySunHours: samples.filter(item => item.fraction > 0).length / 6 });
      } finally {
        if (architecture) disposeArchitecture(architecture);
        setAnalyzing(false);
      }
    }, 30);
  }, [selectedRoom, state]);

  const warnings = useMemo(() => siteWarnings(state), [state]);
  const currentSolar = useMemo(() => {
    try { return calculateSolar(state.date, state.minutes, state.location); } catch { return null; }
  }, [state.date, state.minutes, state.location]);
  const exportWorkspace = () => download('dori-50-solar-model.json', JSON.stringify({
    format: 'dori-solar-workspace', version: 1,
    project: JSON.parse(serializeProject(state)),
    session: { camera, selectedUnit, selectedOpening, selectedRoom, chat },
  }, null, 2));
  const runChatCommand = (command: string) => {
    try {
      const result = applyModelCommand(command, state, selectedUnit, selectedOpening);
      setState(result.state);
      setSelectedOpening(result.selectedOpening);
      if (result.selectedOpening) {
        const opening = resolvedOpenings(result.state).find(item => item.id === result.selectedOpening);
        if (opening) setSelectedUnit(opening.unit);
      }
      setNotice(result.message);
      return result.message;
    } catch {
      return 'לא ניתן לבצע את הפקודה. בדוק את המספר או נסח את השינוי בצורה מפורשת יותר.';
    }
  };

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-icon"><Sun size={20} /></span><div><strong>דורי 50</strong><small>סטודיו שמש וצל · רעננה</small></div></div>
      <div className="solar-pill"><Compass size={16} /><bdi>{currentSolar ? `${currentSolar.localTimeLabel} · ${currentSolar.altitude.toFixed(1)}°` : 'זמן לא תקין'}</bdi></div>
      <div className="toolbar">
        <Button size="sm" variant="ghost" onClick={() => setEditorOpen(true)}><Grid2X2 size={15} /> עורך 2D</Button>
        <Button size="sm" variant="ghost" onClick={() => setRenderOpen(true)}><Sparkles size={15} /> הדמיה AI</Button>
        <Button size="sm" variant="ghost" onClick={() => { if (saveProject(state)) setNotice('הפרויקט נשמר בדפדפן'); }}><Save size={15} /> שמירה</Button>
        <Button size="sm" variant="ghost" onClick={exportWorkspace}><Download size={15} /> שמירת קובץ</Button>
        <Button size="sm" variant="ghost" onClick={() => importRef.current?.click()}><Upload size={15} /> ייבוא</Button>
        <Button size="sm" variant="ghost" onClick={() => { setState(defaultState()); setNotice('המודל אופס לברירת המחדל'); }}><RotateCcw size={15} /> איפוס</Button>
        <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={async event => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          try {
            const text = await file.text();
            const raw = JSON.parse(text) as { format?: string; project?: unknown; session?: Partial<SessionData> };
            if (raw?.format === 'dori-solar-workspace' && raw.project) {
              setState(parseProject(JSON.stringify(raw.project)));
              const imported = raw.session;
              if (imported?.camera) { setCamera(imported.camera); setCameraRestore(imported.camera); }
              if (imported?.selectedUnit === 'north' || imported?.selectedUnit === 'south') setSelectedUnit(imported.selectedUnit);
              if (typeof imported?.selectedOpening === 'string' || imported?.selectedOpening === null) setSelectedOpening(imported.selectedOpening);
              if (ROOMS.some(room => room.id === imported?.selectedRoom)) setSelectedRoom(imported!.selectedRoom!);
              if (Array.isArray(imported?.chat)) setChat(imported.chat.slice(-40));
            } else setState(parseProject(text));
            setNotice('המודל, המבט והבחירות יובאו ונשמרו בהצלחה');
          }
          catch (error) { setNotice(error instanceof Error ? error.message : 'ייבוא הפרויקט נכשל'); }
          event.currentTarget.value = '';
        }} />
      </div>
    </header>
    <section className="workspace">
      <div className="stage">
        <Viewer state={state} selectedRoom={selectedRoom} onSelectOpening={id => setSelectedOpening(id)}
          onPickObject={object => { setPicked(object); if (object.unit) setSelectedUnit(object.unit); }}
          restoredCamera={cameraRestore} onCameraChange={setCamera} canvasRef={canvasRef} walkVector={walkVector} />
        <div className="view-modes" role="group" aria-label="מצב תצוגה">
          {([['orbit', 'סיבוב'], ['plan', 'מבט על'], ['walk', 'סיור בחדר']] as const).map(([mode, label]) => <Button key={mode} size="sm" variant={state.view.mode === mode ? 'primary' : 'secondary'} onClick={() => {
            if (mode === 'orbit') setCameraRestore({ position: [29, 25, 32], target: [6, 3, 6], up: [0, 1, 0] });
            else if (mode === 'plan') setCameraRestore({ position: [6, 48, 6], target: [6, 0, 6], up: [0, 0, -1] });
            else {
              const room = ROOMS.find(item => item.id === selectedRoom);
              if (room) {
                const point = trueWorldPoint(planPoint(room.center, room.unit, state), state);
                const elevation = floorElevation(room.floor, state.buildings[room.unit]);
                setCameraRestore({
                  position: [point[0], elevation + state.view.eyeHeight, point[1]],
                  target: [point[0] + 2, elevation + Math.max(.4, state.view.eyeHeight - .17), point[1]],
                  up: [0, 1, 0],
                });
              }
            }
            setState(current => ({ ...current, view: { ...current.view, mode } }));
          }}>{label}</Button>)}
        </div>
        <div className="render-modes" role="group" aria-label="סגנון תצוגה">
          <Button size="sm" variant={state.view.renderMode === 'model' ? 'primary' : 'secondary'} onClick={() => setState(current => ({ ...current, view: { ...current.view, renderMode: 'model' } }))}>מודל</Button>
          <Button size="sm" variant={state.view.renderMode === 'realistic' ? 'primary' : 'secondary'} onClick={() => setState(current => ({ ...current, view: { ...current.view, renderMode: 'realistic', quality: 'high' } }))}>ריאליסטי</Button>
        </div>
        {state.view.mode === 'walk' && <div className="walk-controls" aria-label="בקרי הליכה">
          <Button aria-label="קדימה" onPointerDown={() => setWalkVector({ forward: 1, strafe: 0 })} onPointerUp={() => setWalkVector({ forward: 0, strafe: 0 })} onPointerCancel={() => setWalkVector({ forward: 0, strafe: 0 })}>▲</Button>
          <Button aria-label="שמאלה" onPointerDown={() => setWalkVector({ forward: 0, strafe: -1 })} onPointerUp={() => setWalkVector({ forward: 0, strafe: 0 })} onPointerCancel={() => setWalkVector({ forward: 0, strafe: 0 })}>◀</Button>
          <Button aria-label="אחורה" onPointerDown={() => setWalkVector({ forward: -1, strafe: 0 })} onPointerUp={() => setWalkVector({ forward: 0, strafe: 0 })} onPointerCancel={() => setWalkVector({ forward: 0, strafe: 0 })}>▼</Button>
          <Button aria-label="ימינה" onPointerDown={() => setWalkVector({ forward: 0, strafe: 1 })} onPointerUp={() => setWalkVector({ forward: 0, strafe: 0 })} onPointerCancel={() => setWalkVector({ forward: 0, strafe: 0 })}>▶</Button>
          <span><Move3D size={14} /> גררו במסך למבט · WASD במחשב</span>
        </div>}
        <div className="hint">גרירה לסיבוב · גלגלת לזום · קליק כפול על פתח לבחירה</div>
        <div className="notice">{notice}</div>
        {warnings.length > 0 && <div className="site-warning">{warnings[0]}</div>}
        {picked && <QuickObjectEditor picked={picked} state={state} onChange={setState} onClose={() => setPicked(null)} />}
        <ModelChat messages={chat} onMessagesChange={setChat} onCommand={runChatCommand} />
      </div>
      <Inspector state={state} onChange={setState} selectedUnit={selectedUnit} onSelectUnit={setSelectedUnit}
        selectedOpening={selectedOpening} onSelectOpening={setSelectedOpening} selectedRoom={selectedRoom}
        onSelectRoom={setSelectedRoom} onEnterRoom={enterRoom} onAnalyze={analyze} analyzing={analyzing}
        daily={daily} exposure={exposure} onShowSources={() => setSources(true)}
        onReferenceUpload={file => {
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 4_400_000) { setNotice('יש לבחור PNG, JPEG או WebP עד כ־4.4MB'); return; }
          const reader = new FileReader();
          reader.onload = () => setState(current => ({ ...current, reference: { ...current.reference, image: String(reader.result), visible: true } }));
          reader.readAsDataURL(file);
        }} />
    </section>
    {editorOpen && <FloorEditor2D state={state} onChange={setState} onClose={() => setEditorOpen(false)} />}
    {renderOpen && <RenderPanel canvas={canvasRef.current} onClose={() => setRenderOpen(false)} />}
    {sources && <div className="modal-backdrop" role="presentation" onMouseDown={() => setSources(false)}><section className="modal" role="dialog" aria-modal="true" aria-label="מקורות והנחות" onMouseDown={event => event.stopPropagation()}>
      <Button className="modal-close" size="icon" variant="ghost" onClick={() => setSources(false)} aria-label="סגירה"><X size={18} /></Button>
      <h2>מקורות, הנחות ודיוק</h2>
      <ul><li>קירות, חלוקה פנימית ופתחים נעקבו מתוכנית ה־PDF בקנה מידה 1:100.</li><li>כיוון מעלה התוכנית: 14.7° ממזרח לצפון אמיתי, ניתן לתיקון.</li><li>מפלסי ברירת מחדל: מרתף ‎−2.95 מ׳, קומה ראשונה ‎+3.40 מ׳.</li><li>גובה שני הבתים הסמוכים: 9 מ׳ לפי נתון המשתמש; התכסית והגגות משוערים.</li><li>מיקום רעננה והגובה הטופוגרפי הם קירוב וניתנים לעריכה.</li><li>השמש מחושבת אסטרונומית לפי התאריך, השעה, הקואורדינטות ושעון ישראל.</li></ul>
      <p className="warning-note">הכלי מיועד להשוואת חלופות. הוא אינו תחליף למדידה, מודד מוסמך, יועץ תאורה או בדיקת זכויות בנייה.</p>
    </section></div>}
  </main>;
}