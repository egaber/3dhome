import { useEffect, useState, type RefObject } from 'react';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Architecture } from '../scene/architecture';
import type { Vec3 } from '../model/cad';
import { disposeMeasurementGraphics, measurementGraphics, numericWorldPoint, raycastVisible } from './viewerMeasurement';

interface MeasurementRuntime {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer;
  architecture: Architecture | null; controls: OrbitControls;
  invalidate: () => void;
}
const INSTRUCTION = 'בחרו שתי נקודות על משטחי המודל, או הזינו XYZ בעולם. גרירה אינה נקודת מדידה.';
export function useViewerMeasurement(runtimeRef: RefObject<MeasurementRuntime | null>, version: number, context: string,
  enabled: boolean, mode: string, color: string) {
  const [draft, setDraft] = useState<{ context: string; points: Vec3[]; status: string }>({ context, points: [], status: INSTRUCTION });
  const points = draft.context === context ? draft.points : [];
  const status = draft.context === context ? draft.status : 'הגאומטריה או ההקשר השתנו; המדידה נוקתה.';
  useEffect(() => {
    setDraft(previous => previous.context === context ? previous : { context, points: [], status: 'הגאומטריה או ההקשר השתנו; המדידה נוקתה.' });
  }, [context]);
  const clear = () => setDraft({ context, points: [], status: INSTRUCTION });
  const numeric = (a: Vec3, b: Vec3) => {
    const checked = [numericWorldPoint(a), numericWorldPoint(b)];
    setDraft({ context, points: checked, status: 'מדידה מספרית בקואורדינטות עולם.' });
  };
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !enabled) return;
    const canvas = runtime.renderer.domElement, controls = runtime.controls;
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    if (mode !== 'walk') controls.update();
    controls.enabled = false;
    const ray = new THREE.Raycaster();
    let gesture: { id: number; x: number; y: number; dragged: boolean } | null = null;
    const own = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const down = (event: PointerEvent) => {
      own(event);
      if (gesture) { gesture.dragged = true; return; }
      if (event.button !== 0) return;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      own(event);
      if (gesture && gesture.id === event.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) gesture.dragged = true;
    };
    const cancel = () => {
      const old = gesture; gesture = null;
      if (old && canvas.hasPointerCapture(old.id)) canvas.releasePointerCapture(old.id);
    };
    const up = (event: PointerEvent) => {
      own(event);
      if (!gesture || gesture.id !== event.pointerId) return;
      const old = gesture; cancel();
      if (old.dragged || Math.hypot(event.clientX - old.x, event.clientY - old.y) > 5) return;
      const rect = canvas.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom || !rect.width || !rect.height) return;
      const hit = raycastVisible(ray, new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2),
        runtime.camera, runtime.architecture?.measurementTargets ?? [], runtime.renderer);
      setDraft(previous => {
        const current = previous.context === context ? previous.points : [];
        if (!hit) return { context, points: current, status: 'לא נבחר משטח גלוי. הרקע, תמונת הייחוס וקווי העזר אינם נקודות מדידה.' };
        return { context, points: current.length === 1 ? [current[0], hit.point.toArray()] : [hit.point.toArray()],
          status: current.length === 1 ? 'המדידה הושלמה. לחיצה נוספת מתחילה מדידה חדשה.' : 'נקודה A נבחרה; בחרו נקודה B.' };
      });
    };
    canvas.addEventListener('pointerdown', down, true); canvas.addEventListener('pointermove', move, true);
    canvas.addEventListener('pointerup', up, true); canvas.addEventListener('pointercancel', cancel, true);
    canvas.addEventListener('lostpointercapture', cancel); canvas.addEventListener('dblclick', own, true);
    canvas.addEventListener('wheel', own, { capture: true, passive: false });
    window.addEventListener('blur', cancel);
    return () => {
      cancel(); controls.enableDamping = damping; controls.enabled = mode !== 'walk';
      canvas.removeEventListener('pointerdown', down, true); canvas.removeEventListener('pointermove', move, true);
      canvas.removeEventListener('pointerup', up, true); canvas.removeEventListener('pointercancel', cancel, true);
      canvas.removeEventListener('lostpointercapture', cancel); canvas.removeEventListener('dblclick', own, true);
      canvas.removeEventListener('wheel', own, true); window.removeEventListener('blur', cancel);
    };
  }, [runtimeRef, version, context, enabled, mode]);
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !enabled || !points.length) return;
    const graphics = measurementGraphics(points, color);
    // Identity-transform sibling of architecture, never part of blockers/targets.
    runtime.scene.add(graphics);
    runtime.invalidate();
    return () => { disposeMeasurementGraphics(graphics); runtime.invalidate(); };
  }, [runtimeRef, version, enabled, draft, context, color]);
  return { points, status, clear, numeric };
}