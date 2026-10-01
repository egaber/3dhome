import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Compass, Download, Grid2X2, Move3D, RotateCcw, Save, Sparkles, Sun, Upload, X } from 'lucide-react';
import Inspector from './components/Inspector';
import { FloorEditor2D } from './components/FloorEditor2D';
import { ModelChat, type ChatMessage } from './components/ModelChat';
import { QuickObjectEditor, type PickedObject } from './components/QuickObjectEditor';
import { RenderPanel } from './components/RenderPanel';
import { MaterialLibrary } from './components/MaterialLibrary';
import { exportResources, importResources, neededResources, type ResourceBundle } from './lib/assetCache';
import { useFileBackup } from './lib/useFileBackup';
import { createRealisticAssets, type RealisticAssets } from './scene/realisticAssets';
import { ZoomControls } from './components/ZoomControls';
import { ActionHistory, HistoryControls } from './components/ActionHistory';
import { Button } from './components/ui/button';
import { calculateSolar, getSunPath } from './lib/solar';
import { loadProject, parseProject, saveProject, serializeProject } from './lib/project';
import { historyShortcut } from './lib/actionHistory';
import { useActionHistory } from './lib/useActionHistory';
import { initializeProject, MIGRATION_KEYS, type MigrationKey } from './lib/initializeProject';
import { addCadOpening } from './lib/cadOpening';
import { applyCadCommand } from './model/cad';
import { measurementContext, raycastVisible, sceneSelection, selectionBounds } from './lib/viewerMeasurement';
import { useViewerMeasurement } from './lib/useViewerMeasurement';
import { ViewerMeasurementPanel } from './components/ViewerMeasurementPanel';
import { aggregateInput, isEditableTarget, MOVEMENT_KEYS, navigationKey, type WalkInput } from './lib/walkNavigation';
import { lookWalk } from './lib/firstPersonNavigation';
import { evaluateFreeWalk, evaluateSupportedWalk, resolveWalkPose, type WalkPose, type WalkWorld } from './lib/supportedWalk';
import { buildWalkWorld } from './scene/walkWorld';
import { applyViewZoom, MAX_VIEW_DISTANCE, MIN_VIEW_DISTANCE, panKeyDirection, panView, readViewZoom, restoredZoom, ZOOM_STEP, zoomKeyDirection } from './lib/viewNavigation';
import { FOOTPRINTS, PLAN_IMAGES, ROOMS, SITE, defaultState, floorElevation, planPoint, resolvedFurniture, resolvedOpenings, resolvedRooms, resolvedWalls, siteWarnings, trueWorldPoint } from './model/plans';
import type { DailyExposure, FloorId, OpeningKind, OpeningSpec, RoomExposure, SimulationState, UnitId } from './model/types';
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
  walkWorld: WalkWorld | null;
  walkPose: WalkPose | null;
  walkInvalid: boolean;
  rememberCamera: () => void;
  assets: RealisticAssets;
  environment: THREE.WebGLRenderTarget | null;
  invalidate: () => void;
};

type CameraBookmark = { position: [number, number, number]; target: [number, number, number]; up: [number, number, number]; zoom?: number };
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
    const walls = resolvedWalls(state);
    const wall = target ? walls.find(item => item.id === target.wallId) : walls.find(item => item.unit === unit && item.floor === 'ground' && item.exterior && item.low === undefined);
    if (!wall) return { state, message: 'לא נמצא קיר מתאים. בחר פתח או קיר ביחידה הרצויה ונסה שוב.', selectedOpening };
    const kind: OpeningKind = /ויטרינה/.test(text) ? 'glazing' : /דלת/.test(text) ? 'door' : /פתח\s*חופשי/.test(text) ? 'void' : 'window';
    const opening: OpeningSpec = {
      id: `added-${crypto.randomUUID()}`, wallId: wall.id, unit: wall.unit, floor: wall.floor, source: 'added',
      label: `${kind === 'glazing' ? 'ויטרינה' : kind === 'door' ? 'דלת' : kind === 'void' ? 'פתח חופשי' : 'חלון'} נוסף בצ׳אט`,
      kind, position: .5, width: value === null ? (kind === 'glazing' ? 2.8 : 1.2) : clamp(value, .2, 12),
      height: kind === 'glazing' || kind === 'door' ? 2.4 : 1.35, sill: kind === 'window' ? .95 : 0,
      open: kind === 'void', shutter: false, overhang: 0,
    };
    return { state: addCadOpening(state, opening.id, wall.id, { label: opening.label, kind, width: opening.width, height: opening.height, sill: opening.sill, open: opening.open }), message: `${opening.label} נוסף במרכז הקיר. הוא נבחר כעת וניתן להמשיך לערוך אותו בצ׳אט.`, selectedOpening: opening.id };
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
    if (patch) return { state: applyCadCommand(state, { type: 'opening', id: target.id, patch }), message: `${description}. השינוי מופיע ונשמר מיד.`, selectedOpening: target.id };
  }
  return { state, message: 'לא זיהיתי שינוי. אפשר לבקש גובה קומה/שכן, רוחב או עומק מבנה, הוספת חלון, או לבחור פתח ולשנות סוג, רוחב, גובה, אדן, תריס וגגון.', selectedOpening };
}

function Viewer({ state, selectedRoom, onSelectOpening, onPickObject, restoredCamera, onCameraChange, canvasRef, walkVector, keyboardEnabled, measuring, onMeasuring, selectedUnit, onUnit, measurementRevision, picked, onWalkStatus, roomEntryRevision }: {
  state: SimulationState;
  selectedRoom: string;
  onSelectOpening: (id: string) => void;
  onPickObject: (object: PickedObject) => void;
  restoredCamera: CameraBookmark | null;
  onCameraChange: (camera: CameraBookmark) => void;
  canvasRef: { current: HTMLCanvasElement | null };
  walkVector: { forward: number; strafe: number };
  keyboardEnabled: boolean;
  measuring: boolean;
  onMeasuring: (value: boolean) => void;
  selectedUnit: UnitId;
  onUnit: (unit: UnitId) => void;
  measurementRevision: number;
  picked: PickedObject | null;
  onWalkStatus: (message: string) => void;
  roomEntryRevision: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const skipInitialViewReset = useRef(!!restoredCamera);
  const [runtimeReady, setRuntimeReady] = useState(0);
  const [assetRevision, setAssetRevision] = useState(0);
  const [assetStatus, setAssetStatus] = useState('');
  const [zoom, setZoom] = useState({ level: 0, percent: 100 });
  const [measurementFloor, setMeasurementFloor] = useState<FloorId>('ground');
  const measuringRef = useRef(measuring);
  measuringRef.current = measuring;
  const viewModeRef = useRef(state.view.mode);
  const keyboardEnabledRef = useRef(keyboardEnabled);
  const walkVectorRef = useRef(walkVector);
  const walkModeRef = useRef(state.view.mode === 'walk');
  const walkKeys = useRef(new Set<string>());
  const eyeHeightRef = useRef(state.view.eyeHeight);
  eyeHeightRef.current = state.view.eyeHeight;
  const lastWalkStatus = useRef('');
  const reportWalk = useCallback((message: string) => {
    if (lastWalkStatus.current === message) return;
    lastWalkStatus.current = message; onWalkStatus(message);
  }, [onWalkStatus]);
  const reconcileWalk = useCallback((runtime: Runtime, fresh = false) => {
    if (fresh) runtime.walkInvalid = false;
    runtime.walkPose = !runtime.walkInvalid && runtime.walkWorld ? resolveWalkPose(runtime.walkWorld, runtime.camera.position, eyeHeightRef.current, fresh ? undefined : runtime.walkPose ?? undefined) : null;
    if (walkModeRef.current && !runtime.walkPose) runtime.walkInvalid = true;
    if (walkModeRef.current) reportWalk(runtime.walkPose
      ? `סיור · ${runtime.walkPose.unit === 'north' ? 'יחידה א׳' : 'יחידה ב׳'} · ${runtime.walkPose.stairId ? 'מדרגות' : runtime.walkPose.floor === 'first' ? 'קומה ראשונה' : runtime.walkPose.floor === 'basement' ? 'מרתף' : 'קומת קרקע'}`
      : 'המיקום אינו תקף להליכה. בחרו חדר ולחצו על כניסה לחדר.');
  }, [reportWalk]);
  useEffect(() => { walkVectorRef.current = walkVector; }, [walkVector]);
  useEffect(() => {
    viewModeRef.current = state.view.mode;
    walkModeRef.current = state.view.mode === 'walk';
    walkKeys.current.clear();
    walkVectorRef.current = { forward: 0, strafe: 0 };
    const runtime = runtimeRef.current;
    if (runtime) {
      runtime.controls.enableRotate = state.view.mode !== 'plan';
      runtime.controls.enableZoom = state.view.mode !== 'walk';
      runtime.controls.enabled = state.view.mode !== 'walk';
      if (state.view.mode === 'walk') runtime.renderer.domElement.focus({ preventScroll: true });
      if (state.view.mode !== 'walk') runtime.camera.zoom = 1;
      runtime.camera.updateProjectionMatrix();
    }
  }, [state.view.mode]);
  useEffect(() => {
    keyboardEnabledRef.current = keyboardEnabled && !measuring;
    walkKeys.current.clear();
    walkVectorRef.current = { forward: 0, strafe: 0 };
  }, [keyboardEnabled, measuring]);

  const changeZoom = useCallback((level: number) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    applyViewZoom(runtime.camera, runtime.controls.target, viewModeRef.current, level);
    if (!walkModeRef.current) runtime.controls.update();
    runtime.rememberCamera();
    setZoom(readViewZoom(runtime.camera, runtime.controls.target, viewModeRef.current));
  }, []);

  const moveWalk = useCallback((input: WalkInput, delta: number) => {
    const runtime = runtimeRef.current;
    if (!runtime?.walkWorld || !runtime.walkPose) return;
    const forward = runtime.controls.target.clone().sub(runtime.camera.position);
    forward.y = 0;
    if (forward.lengthSq() < .0001) return;
    forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const motion = forward.multiplyScalar(input.forward).add(right.multiplyScalar(input.strafe));
    motion.y = input.vertical;
    if (motion.lengthSq() < .0001) return;
    motion.normalize().multiplyScalar(delta);
    const result = input.vertical || runtime.walkPose.mode === 'free'
      ? evaluateFreeWalk(runtime.walkWorld, runtime.walkPose, motion, eyeHeightRef.current)
      : evaluateSupportedWalk(runtime.walkWorld, runtime.walkPose, motion, eyeHeightRef.current);
    if (!result.accepted) {
      reportWalk(result.reason === 'invalid' ? 'המיקום אינו תקף להליכה. בחרו חדר ולחצו על כניסה לחדר.'
        : 'המעבר חסום או שאין משטח תומך. נסו כיוון אחר או מיקום מדרגות אחר בעורך.');
      return;
    }
    runtime.camera.position.copy(result.pose.eye);
    runtime.controls.target.add(result.delta);
    runtime.walkPose = result.pose;
    runtime.camera.lookAt(runtime.controls.target);
    reportWalk(`סיור · ${result.pose.unit === 'north' ? 'יחידה א׳' : 'יחידה ב׳'} · ${result.pose.stairId ? 'מדרגות' : result.pose.floor === 'first' ? 'קומה ראשונה' : result.pose.floor === 'basement' ? 'מרתף' : 'קומת קרקע'}`);
    runtime.rememberCamera();
  }, [reportWalk]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 500);
    camera.position.set(29, 25, 32);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    let renderDirty = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    // The sun/model change in the architecture effect, not when the user walks.
    // Avoid rerendering a 4096px shadow map on every first-person frame.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    canvasRef.current = renderer.domElement;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('aria-label', 'ניווט במודל: חצים לתנועה, פלוס ומינוס לזום');
    host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(6, 3, 6);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = MIN_VIEW_DISTANCE;
    controls.maxDistance = MAX_VIEW_DISTANCE;
    controls.enableRotate = viewModeRef.current !== 'plan';
    controls.enableZoom = viewModeRef.current !== 'walk';
    controls.enabled = viewModeRef.current !== 'walk';
    if (restoredCamera) {
      camera.position.fromArray(restoredCamera.position);
      camera.up.fromArray(restoredCamera.up);
      camera.zoom = viewModeRef.current === 'walk' ? restoredZoom(restoredCamera.zoom) : 1;
      camera.updateProjectionMatrix();
      controls.target.fromArray(restoredCamera.target);
    }
    let cameraSaveTimer = 0;
    const saveCamera = () => {
      window.clearTimeout(cameraSaveTimer);
      cameraSaveTimer = 0;
      onCameraChange({ position: camera.position.toArray(), target: controls.target.toArray(), up: camera.up.toArray(), zoom: camera.zoom });
    };
    const rememberCamera = () => {
      renderDirty = true;
      const next = readViewZoom(camera, controls.target, viewModeRef.current);
      setZoom(previous => Math.abs(previous.level - next.level) < .001 && previous.percent === next.percent ? previous : next);
      // Throttle rather than continually postponing persistence while a key is held.
      if (!cameraSaveTimer) cameraSaveTimer = window.setTimeout(saveCamera, 180);
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
      walkWorld: null, walkPose: null, walkInvalid: false, rememberCamera, assets: createRealisticAssets(renderer.capabilities.getMaxAnisotropy()), environment: null,
      invalidate: () => { renderDirty = true; },
    };
    runtimeRef.current = runtime;
    setRuntimeReady(value => value + 1);
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderDirty = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    rememberCamera();
    let frame = 0;
    let previous = performance.now();
    const normalizedKey = (event: KeyboardEvent) => navigationKey(event.key, event.code);
    const clearWalkKeys = () => { walkKeys.current.clear(); walkVectorRef.current = { forward: 0, strafe: 0 }; };
    const keyDown = (event: KeyboardEvent) => {
      const key = normalizedKey(event);
      if (!keyboardEnabledRef.current || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || isEditableTarget(event.target)) {
        clearWalkKeys();
        return;
      }
      const zoomDirection = zoomKeyDirection(event.key, event.code);
      if (zoomDirection) {
        event.preventDefault();
        changeZoom(readViewZoom(camera, controls.target, viewModeRef.current).level + zoomDirection * ZOOM_STEP);
        return;
      }
      if (!walkModeRef.current) {
        const pan = panKeyDirection(key);
        if (!pan) return;
        event.preventDefault();
        panView(camera, controls.target, pan.x, pan.y, host.clientHeight);
        controls.update();
        rememberCamera();
        return;
      }
      if (!MOVEMENT_KEYS.has(key) && key !== 'q' && key !== 'e') return;
      // Even a brief tap between animation frames must take a visible step.
      if (!event.repeat && !walkKeys.current.has(key)) {
        if (key === 'q' || key === 'e') {
          lookWalk(camera, controls.target, key === 'q' ? .06 : -.06);
          rememberCamera();
        } else moveWalk(aggregateInput([...walkKeys.current, key], { ...walkVectorRef.current, vertical: 0 }), .08);
      }
      walkKeys.current.add(key);
      event.preventDefault();
    };
    const keyUp = (event: KeyboardEvent) => {
      if (walkKeys.current.delete(normalizedKey(event))) saveCamera();
    };
    const visibilityChange = () => { if (document.visibilityState !== 'visible') clearWalkKeys(); };
    const wheel = (event: WheelEvent) => {
      if (!walkModeRef.current || !keyboardEnabledRef.current || event.ctrlKey || event.metaKey || !event.deltaY) return;
      event.preventDefault();
      changeZoom(readViewZoom(camera, controls.target, 'walk').level - Math.sign(event.deltaY) * ZOOM_STEP);
    };
    let lookPointer: { id: number; x: number; y: number } | null = null;
    const focusViewer = (event: PointerEvent) => {
      renderer.domElement.focus({ preventScroll: true });
      if (!walkModeRef.current || !keyboardEnabledRef.current || event.button !== 0) return;
      lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const pointerLook = (event: PointerEvent) => {
      if (!lookPointer || lookPointer.id !== event.pointerId || !walkModeRef.current || !keyboardEnabledRef.current) return;
      lookWalk(camera, controls.target, -(event.clientX - lookPointer.x) * .004, -(event.clientY - lookPointer.y) * .004);
      lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      rememberCamera();
    };
    const stopLook = () => { lookPointer = null; };
    renderer.domElement.addEventListener('pointerdown', focusViewer);
    renderer.domElement.addEventListener('pointermove', pointerLook);
    renderer.domElement.addEventListener('pointerup', stopLook);
    renderer.domElement.addEventListener('pointercancel', stopLook);
    renderer.domElement.addEventListener('lostpointercapture', stopLook);
    renderer.domElement.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clearWalkKeys);
    document.addEventListener('focusin', clearWalkKeys);
    document.addEventListener('visibilitychange', visibilityChange);
    const render = () => {
      frame = requestAnimationFrame(render);
      const now = performance.now();
      const delta = Math.min(.05, (now - previous) / 1000); previous = now;
      if (walkModeRef.current && keyboardEnabledRef.current) {
        const input = aggregateInput(walkKeys.current, { ...walkVectorRef.current, vertical: 0 });
        if (input.forward || input.strafe || input.vertical) {
          moveWalk(input, 2.3 * delta);
        }
        const turn = Number(walkKeys.current.has('q')) - Number(walkKeys.current.has('e'));
        if (turn) {
          lookWalk(camera, controls.target, turn * 1.6 * delta);
          rememberCamera();
        }
      }
      if (!walkModeRef.current) controls.update();
      // PBR scenes are expensive. Damping/walking/camera changes invalidate;
      // unchanged frames need neither GPU work nor full-scene CPU ray tests.
      if (!renderDirty) return;
      renderDirty = false;
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
          const obstruction = runtime.raycaster.intersectObjects(runtime.architecture.pickables.filter(object => object.userData.neighborId), false)[0];
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
      window.removeEventListener('blur', clearWalkKeys);
      document.removeEventListener('focusin', clearWalkKeys);
      document.removeEventListener('visibilitychange', visibilityChange);
      renderer.domElement.removeEventListener('pointerdown', focusViewer);
      renderer.domElement.removeEventListener('pointermove', pointerLook);
      renderer.domElement.removeEventListener('pointerup', stopLook);
      renderer.domElement.removeEventListener('pointercancel', stopLook);
      renderer.domElement.removeEventListener('lostpointercapture', stopLook);
      renderer.domElement.removeEventListener('wheel', wheel);
      clearWalkKeys();
      observer.disconnect();
      window.clearTimeout(cameraSaveTimer);
      controls.removeEventListener('change', rememberCamera);
      controls.dispose();
      runtime.walkWorld = null; runtime.walkPose = null;
      if (runtime.architecture) disposeArchitecture(runtime.architecture);
      runtime.assets.dispose();
      runtime.scene.environment = null;
      runtime.environment?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      canvasRef.current = null;
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || state.view.renderMode !== 'realistic') return;
    let cancelled = false;
    setAssetStatus('טוען חומרי PBR וריהוט מקומי…');
    void Promise.all([runtime.assets.load(), runtime.assets.sync(state.appearance)]).then(results => {
      const failures = results.flat();
      if (cancelled || runtimeRef.current !== runtime) return;
      setAssetStatus(failures.length ? 'חלק מהנכסים לא נטענו — מוצג גיבוי בסיסי; ניתן לרענן ולנסות שוב.' : 'חומרי PBR וריהוט מוכנים · Poly Haven / Khronos');
      setAssetRevision(value => value + 1);
    });
    return () => { cancelled = true; };
  }, [runtimeReady, state.view.renderMode, state.appearance?.images, state.appearance?.models]);

  useEffect(() => {
      const runtime = runtimeRef.current;
      if (!runtime) return undefined;
      runtime.walkWorld = null;
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
      if (state.view.renderMode === 'realistic' && !runtime.environment) {
        const generator = new THREE.PMREMGenerator(runtime.renderer), room = new RoomEnvironment();
        runtime.environment = generator.fromScene(room, .04);
        room.dispose(); generator.dispose();
      }
      runtime.scene.environment = state.view.renderMode === 'realistic' && !state.view.directOnly ? runtime.environment!.texture : null;
      runtime.scene.environmentIntensity = .35;
      const architecture = buildArchitecture(state, palette, runtime.assets);
      runtime.architecture = architecture;
      runtime.content.add(architecture.group);
      runtime.walkWorld = buildWalkWorld(state, architecture);
      reconcileWalk(runtime);
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
      // Keep the diagram's yellow analysis overlay out of material previews.
      sunlightMaterial.opacity = state.view.renderMode === 'realistic' ? 0 : .24;
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
        const texture = new THREE.TextureLoader().load(source.url, loaded => {
          if (runtimeRef.current === runtime && runtime.architecture === architecture) runtime.invalidate();
          else loaded.dispose();
        });
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
      runtime.renderer.shadowMap.needsUpdate = true;
      runtime.invalidate();
      return undefined;
  }, [runtimeReady, state, assetRevision]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const host = hostRef.current;
    if (!runtime || !host) return;
    const pickRay = new THREE.Raycaster();
    const pick = (event: MouseEvent) => {
      if (measuringRef.current || !keyboardEnabledRef.current) return;
      const rect = host.getBoundingClientRect();
      runtime.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const hit = raycastVisible(pickRay, runtime.pointer, runtime.camera, runtime.architecture?.pickables ?? [], runtime.renderer);
      const selection = hit && sceneSelection(hit.object, hit.face?.normal);
      if (!selection) return;
      if (selection.type === 'opening') onSelectOpening(selection.id);
      onPickObject(selection);
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
    runtime.camera.zoom = 1;
    runtime.camera.updateProjectionMatrix();
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
    runtime.camera.lookAt(runtime.controls.target);
    reconcileWalk(runtime, true);
    runtime.rememberCamera();
    // Camera placement is intentionally tied only to an explicit view-mode or
    // room selection. Sun/time and model edits must preserve the user's orbit.
  }, [selectedRoom, state.view.mode, state.view.eyeHeight, roomEntryRevision]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !restoredCamera) return;
    runtime.camera.position.fromArray(restoredCamera.position);
    runtime.camera.up.fromArray(restoredCamera.up);
    runtime.camera.zoom = viewModeRef.current === 'walk' ? restoredZoom(restoredCamera.zoom) : 1;
    runtime.camera.updateProjectionMatrix();
    runtime.controls.target.fromArray(restoredCamera.target);
    if (walkModeRef.current) runtime.camera.lookAt(runtime.controls.target);
    else runtime.controls.update();
    reconcileWalk(runtime, true);
    runtime.rememberCamera();
  }, [restoredCamera]);

  const measureContext = measurementContext(state, selectedUnit, measurementFloor, measurementRevision);
  const measurement = useViewerMeasurement(runtimeRef, runtimeReady, measureContext, measuring && keyboardEnabled, state.view.mode, readPalette().accent);
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.architecture || !picked || measuring) return;
    const bounds = selectionBounds(runtime.architecture.pickables, picked);
    if (bounds.isEmpty()) return;
    const helper = new THREE.Box3Helper(bounds, new THREE.Color(readPalette().accent));
    const materials = Array.isArray(helper.material) ? helper.material : [helper.material];
    for (const material of materials) material.depthTest = false;
    helper.name = 'Selected CAD object'; helper.renderOrder = 999;
    runtime.scene.add(helper); runtime.invalidate();
    return () => { helper.removeFromParent(); helper.geometry.dispose(); for (const material of materials) material.dispose(); runtime.invalidate(); };
  }, [picked, measuring, state, runtimeReady, assetRevision]);

  return <>
    <div ref={hostRef} className="viewer" aria-label="תצוגת תלת־ממד אינטראקטיבית" />
    {state.view.renderMode === 'realistic' && <div className="asset-status" role="status" aria-live="polite">{assetStatus}</div>}
    <ZoomControls level={zoom.level} percent={zoom.percent} onChange={changeZoom} />
    <Button className="viewer-measure-toggle" variant="secondary" aria-pressed={measuring} aria-expanded={measuring} aria-controls="viewer-measurement-panel"
      onClick={() => { measurement.clear(); onMeasuring(!measuring); }}>מדידה בתלת־ממד</Button>
    {measuring && <ViewerMeasurementPanel state={state} unit={selectedUnit} floor={measurementFloor} onUnit={onUnit} onFloor={setMeasurementFloor}
      context={measureContext} {...measurement} onClear={measurement.clear} onNumeric={measurement.numeric} />}
  </>;
}

export default function App() {
  const initialSession = useMemo(loadSession, []);
  const history = useActionHistory(() => {
    const loaded = loadProject() ?? defaultState();
    let completed: MigrationKey[] = [];
    try {
      completed = MIGRATION_KEYS.filter(key => localStorage.getItem(key) === 'done');
    } catch { /* Storage is optional; pure migration still preserves tombstones. */ }
    const initialized = initializeProject(loaded, completed);
    // Only mark migrations completed after their model is durably saved.
    if (saveProject(initialized)) {
      try { for (const key of MIGRATION_KEYS) localStorage.setItem(key, 'done'); } catch { /* Retry safely next startup. */ }
    }
    return initialized;
  });
  const { state, change: setState, begin: beginHistory, end: endHistory, undo, redo, jump } = history;
  const currentProject = useRef(state); currentProject.current = state;
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
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measurementRevision, setMeasurementRevision] = useState(0);
  const [saveError, setSaveError] = useState('');
  const [walkVector, setWalkVector] = useState({ forward: 0, strafe: 0 });
  const [walkStatus, setWalkStatus] = useState('');
  const [roomEntryRevision, setRoomEntryRevision] = useState(0);
  const stopTouchWalk = useCallback(() => setWalkVector(previous => previous.forward || previous.strafe ? { forward: 0, strafe: 0 } : previous), []);
  useEffect(() => { stopTouchWalk(); }, [state.view.mode, editorOpen, renderOpen, sources, historyOpen, materialsOpen, measuring, stopTouchWalk]);
  useEffect(() => {
    const visibility = () => { if (document.visibilityState !== 'visible') stopTouchWalk(); };
    window.addEventListener('blur', stopTouchWalk);
    document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('blur', stopTouchWalk); document.removeEventListener('visibilitychange', visibility); };
  }, [stopTouchWalk]);
  const [notice, setNotice] = useState('גרסת משחק ראשונית · כל המידות ניתנות לשינוי');
  const importRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const undoAction = useCallback(() => { undo(); setPicked(null); setMeasurementRevision(n => n + 1); setNotice('הפעולה בוטלה'); }, [undo]);
  const redoAction = useCallback(() => { redo(); setPicked(null); setMeasurementRevision(n => n + 1); setNotice('הפעולה בוצעה מחדש'); }, [redo]);
  const showHistory = () => { endHistory(); setHistoryOpen(true); };
  const historyControls = { canUndo: history.canUndo, canRedo: history.canRedo, onUndo: undoAction, onRedo: redoAction, onShowHistory: showHistory };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((renderOpen || sources || materialsOpen) && !historyOpen) return;
      const action = historyShortcut(event, isEditableTarget(event.target));
      if (!action) return;
      event.preventDefault();
      if (action === 'undo' && history.canUndo) undoAction();
      if (action === 'redo' && history.canRedo) redoAction();
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [history.canUndo, history.canRedo, undoAction, redoAction, renderOpen, sources, materialsOpen, historyOpen]);

  const persist = useCallback((next: SimulationState) => {
    const saved = saveProject(next);
    setSaveError(saved ? '' : 'השמירה בדפדפן נכשלה. המודל נשאר זמין במושב זה; שמרו קובץ לפני סגירת הדף.');
    return saved;
  }, []);
  useEffect(() => { persist(state); }, [state, persist]);
  useEffect(() => {
    setDaily(null);
    if (selectedOpening && !resolvedOpenings(state).some(opening => opening.id === selectedOpening)) setSelectedOpening(null);
    if (picked?.type === 'opening' && !resolvedOpenings(state).some(o => o.id === picked.id && o.width > 0 && o.height > 0)
      || picked?.type === 'wall' && !resolvedWalls(state).some(w => w.id === picked.id)
      || picked?.type === 'furniture' && !resolvedFurniture(state).some(f => f.id === picked.id)) setPicked(null);
  }, [state, selectedOpening, picked]);
  useEffect(() => {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ camera, selectedUnit, selectedOpening, selectedRoom, chat } satisfies SessionData)); } catch { /* Private mode/quota: project UI remains usable. */ }
  }, [camera, selectedUnit, selectedOpening, selectedRoom, chat]);
  useEffect(() => {
    let architecture: ReturnType<typeof buildArchitecture> | null = null;
    try {
      const room = resolvedRooms(state).find(item => item.id === selectedRoom);
      if (!room) return;
      const solar = calculateSolar(state.date, state.minutes, state.location);
      architecture = buildArchitecture({ ...state, view: { ...state.view, renderMode: 'model' } }, readPalette());
      const result = directExposure(roomSamplePoints(room, state), new THREE.Vector3(solar.direction.x, solar.direction.y, solar.direction.z), architecture.blockers, solar.aboveHorizon);
      setExposure({ roomId: room.id, ...result, percent: result.total ? result.lit / result.total * 100 : 0 });
    } catch { setExposure(null); }
    return () => { if (architecture) disposeArchitecture(architecture); };
  }, [state, selectedRoom]);

  const enterRoom = useCallback((id: string) => {
    setSelectedRoom(id);
    setRoomEntryRevision(value => value + 1);
    setState(current => ({ ...current, view: { ...current.view, mode: 'walk', cutaway: resolvedRooms(current).find(room => room.id === id)?.floor ?? 'ground' } }));
  }, []);

  const analyze = useCallback(() => {
    const room = resolvedRooms(state).find(item => item.id === selectedRoom);
    if (!room) return;
    setAnalyzing(true);
    setTimeout(() => {
      let architecture: ReturnType<typeof buildArchitecture> | null = null;
      try {
        architecture = buildArchitecture({ ...state, view: { ...state.view, renderMode: 'model' } }, readPalette());
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
  const resourceExport = useRef<{ key: string; promise: Promise<ResourceBundle> } | null>(null);
  const workspaceContent = async () => {
    const key = JSON.stringify(state.appearance?.models ?? {});
    if (!resourceExport.current || resourceExport.current.key !== key) {
      const promise = exportResources(state); resourceExport.current = { key, promise };
      void promise.catch(() => { if (resourceExport.current?.promise === promise) resourceExport.current = null; });
    }
    const resources = await resourceExport.current.promise;
    return JSON.stringify({ format: 'dori-solar-workspace', version: 2, project: JSON.parse(serializeProject(state)),
      resources, credits: { polyHaven: 'https://polyhaven.com/license', kenney: 'https://kenney.nl/assets/furniture-kit',
        sofa: 'Eric Chadwick / Darmstadt Graphics Group GmbH, CC BY 4.0; original Fran Calvente CC0', chair: 'Eric Chadwick / Wayfair CC0' },
      session: { camera, selectedUnit, selectedOpening, selectedRoom, chat } });
  };
  const backup = useFileBackup(workspaceContent, state);
  const exportWorkspace = async () => {
    setNotice('מכין קובץ גיבוי עם החומרים והמודלים…');
    try { download('dori-50-solar-model.json', await workspaceContent()); setNotice('קובץ גיבוי עם נכסים הורד. שמרו אותו במקום בטוח.'); }
    catch (error) { setNotice(`הגיבוי לא נוצר: ${error instanceof Error ? error.message : 'טעינת נכסים נכשלה'}`); }
  };
  const runChatCommand = (command: string) => {
    try {
      const result = applyModelCommand(command, state, selectedUnit, selectedOpening);
      // Validate all chat commands, including legacy building commands, before
      // history/state publication. Report saving only after a successful write.
      serializeProject(result.state);
      const saved = persist(result.state);
      setState(result.state, `צ׳אט: ${command.slice(0, 100)}`);
      setSelectedOpening(result.selectedOpening);
      if (result.selectedOpening) {
        const opening = resolvedOpenings(result.state).find(item => item.id === result.selectedOpening);
        if (opening) setSelectedUnit(opening.unit);
      }
      const message = saved ? result.message : result.message.replace(' השינוי נשמר אוטומטית.', '').replace(' השינוי מופיע ונשמר מיד.', ' השינוי מופיע במודל.') + ' השמירה בדפדפן נכשלה; יש לשמור קובץ.';
      setNotice(message);
      return message;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'לא ניתן לבצע את הפקודה. בדוק את המספר או נסח את השינוי בצורה מפורשת יותר.';
      setNotice(message); return message;
    }
  };

  // Group one focused model field (typing, spinner, keyboard range edits) into
  // one action. Chat drafts, native selectors, and camera zoom are not edits.
  const historyInput = (target: EventTarget | null): target is HTMLInputElement => target instanceof HTMLInputElement
    && !!target.closest('.inspector') && ['number', 'range', 'text', 'date', 'time'].includes(target.type);
  const fieldLabel = (input: HTMLInputElement) => input.getAttribute('aria-label')?.replace(/ — (מחוון|ערך מספרי)$/, '');
  return <main className="app-shell"
    onFocusCapture={event => { if (historyInput(event.target)) beginHistory(fieldLabel(event.target)); }}
    onBlur={event => { if (historyInput(event.target)) endHistory(); }}
    onPointerDownCapture={event => { if (historyInput(event.target) && event.target.type === 'range') beginHistory(fieldLabel(event.target)); }}
    onPointerUp={event => { if (historyInput(event.target) && event.target.type === 'range') endHistory(); }}
    onPointerCancel={event => { if (historyInput(event.target) && event.target.type === 'range') endHistory(); }}>
    <header className="topbar">
      <div className="brand"><span className="brand-icon"><Sun size={20} /></span><div><strong>דורי 50</strong><small>סטודיו שמש וצל · רעננה</small></div></div>
      <div className="solar-pill"><Compass size={16} /><bdi>{currentSolar ? `${currentSolar.localTimeLabel} · ${currentSolar.altitude.toFixed(1)}°` : 'זמן לא תקין'}</bdi></div>
      <div className="toolbar">
        <HistoryControls {...historyControls} />
        <Button size="sm" variant="ghost" onClick={() => setEditorOpen(true)}><Grid2X2 size={15} /> עורך 2D</Button>
        <Button size="sm" variant="ghost" onClick={() => setRenderOpen(true)}><Sparkles size={15} /> הדמיה AI</Button>
        <Button size="sm" variant="ghost" onClick={() => { if (persist(state)) setNotice('הפרויקט נשמר בדפדפן'); }}><Save size={15} /> שמירה</Button>
        <Button size="sm" variant="ghost" onClick={exportWorkspace}><Download size={15} /> שמירת קובץ</Button>
        <Button size="sm" variant="ghost" onClick={() => importRef.current?.click()}><Upload size={15} /> ייבוא</Button>
        <Button size="sm" variant="ghost" onClick={() => { setState(defaultState(), 'איפוס המודל'); setMeasurementRevision(n => n + 1); setNotice('המודל אופס לברירת המחדל'); }}><RotateCcw size={15} /> איפוס</Button>
        <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={async event => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          if (!file) return;
          try {
            if (file.size > 100_000_000) throw new Error('קובץ הגיבוי גדול מדי (עד 100 MB).');
            const text = await file.text();
            const raw = JSON.parse(text) as { format?: string; version?: number; project?: unknown; resources?: unknown; session?: Partial<SessionData> };
            const workspace = raw?.format === 'dori-solar-workspace' && !!raw.project;
            const importedState = parseProject(workspace ? JSON.stringify(raw.project) : text);
            if (workspace && raw.version === 2 && !raw.resources) throw new Error('Portable backup is missing required assets');
            if (workspace && raw.resources) { await importResources(raw.resources, raw.version === 2 ? neededResources(importedState) : []); resourceExport.current = null; }
            if (currentProject.current !== state) throw new Error('הפרויקט השתנה בזמן הייבוא. הייבוא לא הוחל; בחרו שוב את הקובץ.');
            // A failed write leaves both current model and session usable/unchanged.
            if (!persist(importedState)) throw new Error('ייבוא לא הוחל: השמירה בדפדפן נכשלה. המודל הקודם נשאר זמין.');
            setState(importedState, 'ייבוא פרויקט'); setMeasurementRevision(n => n + 1); setPicked(null);
            if (raw?.format === 'dori-solar-workspace' && raw.project) {
              const imported = raw.session;
              const vector = (value: unknown): value is [number, number, number] => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10000);
              if (imported?.camera && vector(imported.camera.position) && vector(imported.camera.target) && vector(imported.camera.up)) { setCamera(imported.camera); setCameraRestore(imported.camera); }
              if (imported?.selectedUnit === 'north' || imported?.selectedUnit === 'south') setSelectedUnit(imported.selectedUnit);
              if (typeof imported?.selectedOpening === 'string' || imported?.selectedOpening === null) setSelectedOpening(imported.selectedOpening);
              if (resolvedRooms(importedState).some(room => room.id === imported?.selectedRoom)) setSelectedRoom(imported!.selectedRoom!);
              if (Array.isArray(imported?.chat)) setChat(imported.chat.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string').slice(-40));
            }
            setNotice('המודל, המבט והבחירות יובאו ונשמרו בהצלחה');
          }
          catch (error) { setNotice(error instanceof Error ? error.message : 'ייבוא הפרויקט נכשל'); }
          input.value = '';
        }} />
      </div>
    </header>
    <section className="workspace">
      <div className={`stage${measuring ? ' measurement-active' : ''}`}>
        {state.view.mode === 'walk' && !measuring && <div className="walk-controls" role="group" aria-label="בקרי הליכה">
          {([{ label: 'קדימה', glyph: '▲', forward: 1, strafe: 0 }, { label: 'שמאלה', glyph: '◀', forward: 0, strafe: -1 },
            { label: 'אחורה', glyph: '▼', forward: -1, strafe: 0 }, { label: 'ימינה', glyph: '▶', forward: 0, strafe: 1 }]).map(button =>
            <Button key={button.label} aria-label={button.label}
              onPointerDown={event => { if (event.button !== 0 || editorOpen || renderOpen || sources || historyOpen || materialsOpen) return;
                event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setWalkVector({ forward: button.forward, strafe: button.strafe }); }}
              onPointerUp={stopTouchWalk} onPointerCancel={stopTouchWalk} onLostPointerCapture={stopTouchWalk}>{button.glyph}</Button>)}
        </div>}
        <div className="stage-surface">
        <Viewer state={state} selectedRoom={selectedRoom} onSelectOpening={id => setSelectedOpening(id)}
          onPickObject={object => { setPicked(object); if (object.unit) setSelectedUnit(object.unit); }}
          restoredCamera={cameraRestore} onCameraChange={setCamera} canvasRef={canvasRef} walkVector={walkVector}
          measuring={measuring} onMeasuring={value => { setMeasuring(value); setPicked(null); setWalkVector({ forward: 0, strafe: 0 }); }}
          selectedUnit={selectedUnit} onUnit={setSelectedUnit} measurementRevision={measurementRevision} picked={picked}
          onWalkStatus={setWalkStatus} roomEntryRevision={roomEntryRevision}
          keyboardEnabled={!editorOpen && !renderOpen && !sources && !historyOpen && !materialsOpen} />
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
          <Button size="sm" variant="secondary" aria-haspopup="dialog" onClick={() => setMaterialsOpen(true)}>חומרים וריהוט</Button>
        </div>
        {picked && !measuring && <QuickObjectEditor picked={picked} state={state} onChange={setState} onClose={() => setPicked(null)} onSelect={setPicked} />}
        </div>
        <div className="stage-status" dir="rtl">
          {warnings.length > 0 && <details className="site-warning"><summary>אזהרות ({warnings.length})</summary><div>{warnings.map(warning => <p key={warning}>{warning}</p>)}</div></details>}
          <div className="notice" role={saveError ? 'alert' : 'status'}>{saveError || (backup.connected ? backup.status : state.view.mode === 'walk' && walkStatus ? walkStatus : notice)}</div>
          <div className="stage-chat" hidden={measuring || !!picked}><ModelChat messages={chat} onMessagesChange={setChat} onCommand={runChatCommand} /></div>
          <div className="hint">{state.view.mode === 'walk'
            ? <><Move3D size={14} /> חצים / WASD / בקרי הליכה — מדרגות אוטומטית · Q/E או גרירה לסיבוב · Page Up/Down לגובה חופשי</>
            : <>חצים לתנועה · <bdi>+ / −</bdi> או המחוון לזום · גרירה לסיבוב</>}</div>
        </div>
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
    {editorOpen && <FloorEditor2D state={state} onChange={setState} onClose={() => { endHistory(); setEditorOpen(false); }}
      historyControls={historyControls} onBeginEdit={beginHistory} onEndEdit={endHistory} />}
    {historyOpen && <ActionHistory {...historyControls} entries={history.entries} index={history.index}
      onJump={id => { jump(id); setPicked(null); setMeasurementRevision(n => n + 1); setNotice('המודל שוחזר לשלב שנבחר'); }} onClose={() => setHistoryOpen(false)} />}
    {renderOpen && <RenderPanel canvas={canvasRef.current} onClose={() => setRenderOpen(false)} />}
    {materialsOpen && <MaterialLibrary state={state} selectedUnit={selectedUnit} onChange={setState} onPick={setPicked}
      backup={backup} onBackup={exportWorkspace} onClose={() => setMaterialsOpen(false)} onEnable={() => {
      setState(current => ({ ...current, view: { ...current.view, renderMode: 'realistic', quality: 'high' } }), 'הפעלת חומרים וריהוט ריאליסטיים');
      setMaterialsOpen(false);
    }} />}
    {sources && <div className="modal-backdrop" role="presentation" onMouseDown={() => setSources(false)}><section className="modal" role="dialog" aria-modal="true" aria-label="מקורות והנחות" onMouseDown={event => event.stopPropagation()}>
      <Button className="modal-close" size="icon" variant="ghost" onClick={() => setSources(false)} aria-label="סגירה"><X size={18} /></Button>
      <h2>מקורות, הנחות ודיוק</h2>
      <ul><li>קירות, חלוקה פנימית ופתחים נעקבו מתוכנית ה־PDF בקנה מידה 1:100.</li><li>כיוון מעלה התוכנית: 14.7° ממזרח לצפון אמיתי, ניתן לתיקון.</li><li>מפלסי ברירת מחדל: מרתף ‎−2.95 מ׳, קומה ראשונה ‎+3.40 מ׳.</li><li>גובה שני הבתים הסמוכים: 9 מ׳ לפי נתון המשתמש; התכסית והגגות משוערים.</li><li>מיקום רעננה והגובה הטופוגרפי הם קירוב וניתנים לעריכה.</li><li>השמש מחושבת אסטרונומית לפי התאריך, השעה, הקואורדינטות ושעון ישראל.</li></ul>
      <p className="warning-note">הכלי מיועד להשוואת חלופות. הוא אינו תחליף למדידה, מודד מוסמך, יועץ תאורה או בדיקת זכויות בנייה.</p>
    </section></div>}
  </main>;
}