import { useState } from 'react';
import { applyCadCommand, inversePlanPoint, getWallApertures, resolveStairGeometry, type CadCommand } from '../model/cad';
import { stairSelection } from '../lib/cadRotation';
import { BASE_WIDTH, BASE_DEPTH, planPoint, resolvedFurniture, resolvedOpenings, resolvedRooms, resolvedWalls } from '../model/plans';
import { FURNITURE_KINDS, type FloorId, type FurnitureKind, type OpeningKind, type SimulationState, type UnitId, type Vec2 } from '../model/types';
import { FURNITURE_NAMES, furnitureScales, lengthText, type CadSelection, type DisplayUnit } from '../lib/cadEditor';
import { NumericDraftForm } from './CadFields';
import { Button } from './ui/button';
import { CadRotationControls } from './CadRotationControls';
import { ObjectActions } from './ObjectActions';

export const OPENING_NAMES: Record<OpeningKind, string> = { window: 'חלון', glazing: 'ויטרינה', door: 'דלת', void: 'מעבר' };
const numericPoint = (values: Record<string, number>, x: string, z: string): Vec2 => [values[x], values[z]];
export function deleteSelection(state: SimulationState, selection: CadSelection): CadCommand | null {
  if (selection.type === 'stair') return null;
  if (selection.type === 'opening') return { type: 'delete-opening', id: selection.id };
  if (selection.type === 'wall') {
    const w = resolvedWalls(state).find(w => w.id === selection.id);
    return w ? { type: 'wall', id: w.id, edit: { a: w.a, b: w.b, deleted: true } } : null;
  }
  if (selection.type === 'room') {
    const r = resolvedRooms(state).find(r => r.id === selection.id);
    return r ? { type: 'room', id: r.id, edit: { center: r.center, width: r.width, depth: r.depth,
      ...(r.rotation !== undefined ? { rotation: r.rotation } : {}), deleted: true } } : null;
  }
  const item = resolvedFurniture(state).find(i => i.id === selection.id);
  return item ? { type: 'furniture', id: item.id, edit: { center: item.center, width: item.width, depth: item.depth, height: item.height, rotation: item.rotation, deleted: true } } : null;
}
export function CadProperties({ state, selection, units, onCommand, onSelect, onChange }: {
  state: SimulationState; selection: CadSelection | null; units: DisplayUnit;
  onCommand: (command: CadCommand, label: string) => void; onSelect: (selection: CadSelection | null) => void;
  onChange?: (state: SimulationState, label?: string) => void;
}) {
  const [kind, setKind] = useState<OpeningKind>(() => resolvedOpenings(state).find(o => o.id === selection?.id)?.kind ?? 'window');
  if (!selection) return <p className="small-note">בחרו אובייקט בתוכנית או ברשימה. כל פריט ריהוט ופתח ניתנים לעריכה בנפרד.</p>;
  const wall = selection.type === 'wall' ? resolvedWalls(state).find(w => w.id === selection.id) : undefined;
  const opening = selection.type === 'opening' ? resolvedOpenings(state).find(o => o.id === selection.id) : undefined;
  const item = selection.type === 'furniture' ? resolvedFurniture(state).find(i => i.id === selection.id) : undefined;
  const room = selection.type === 'room' ? resolvedRooms(state).find(i => i.id === selection.id) : undefined;
  const selectedStair = stairSelection(selection);
  const stair = selectedStair && resolveStairGeometry(state, selectedStair.unit, selectedStair.fromFloor);
  const remove = deleteSelection(state, selection);
  return <section className="cad-properties" aria-label="מאפייני אובייקט">
    <h3>{wall ? 'קיר נבחר' : opening ? OPENING_NAMES[opening.kind] : item ? FURNITURE_NAMES[item.kind] : selection.type === 'stair' ? 'מדרגות' : room?.name}</h3>
    <small className="cad-object-id" dir="ltr">{selection.id}</small>
    <CadRotationControls state={state} selection={selection} onCommand={onCommand} />
    {stair && (() => {
      const p = planPoint(stair.pivot, stair.unit, state);
      return <NumericDraftForm skipUnchanged units={units} submitLabel="הזזת מדרגות"
        fields={[{ name: 'x', label: 'מרכז מדרגות X', value: p[0] }, { name: 'z', label: 'מרכז מדרגות Z', value: p[1] }]}
        onApply={v => onCommand({ type: 'stair-position', unit: stair.unit, position: inversePlanPoint([v.x, v.z], stair.unit, state) }, 'הזזת מדרגות')} />;
    })()}
    {wall && (() => {
      const a = planPoint(wall.a, wall.unit, state), b = planPoint(wall.b, wall.unit, state);
      return <>
        <p>אורך {lengthText(Math.hypot(b[0] - a[0], b[1] - a[1]), units)}</p>
        <NumericDraftForm skipUnchanged units={units} fields={[{ name: 'ax', label: 'קצה A · X', value: a[0] }, { name: 'az', label: 'קצה A · Z', value: a[1] }, { name: 'bx', label: 'קצה B · X', value: b[0] }, { name: 'bz', label: 'קצה B · Z', value: b[1] }]}
          onApply={v => onCommand({ type: 'wall', id: wall.id, edit: { a: inversePlanPoint(numericPoint(v, 'ax', 'az'), wall.unit, state), b: inversePlanPoint(numericPoint(v, 'bx', 'bz'), wall.unit, state), deleted: false } }, 'עריכת קצות קיר')} />
        <NumericDraftForm skipUnchanged units={units} submitLabel="הזזת קיר" fields={[{ name: 'dx', label: 'הזזה X', value: 0 }, { name: 'dz', label: 'הזזה Z', value: 0 }]}
          onApply={v => onCommand({ type: 'wall', id: wall.id, edit: { a: inversePlanPoint([a[0] + v.dx, a[1] + v.dz], wall.unit, state), b: inversePlanPoint([b[0] + v.dx, b[1] + v.dz], wall.unit, state), deleted: false } }, 'הזזת קיר')} />
        <NumericDraftForm units={units} submitLabel="הוספת חלון לקיר" fields={[{ name: 'at', label: 'מרחק החלון מקצה A', value: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 }]}
          onApply={v => { const id = `cad-window-${crypto.randomUUID()}`; onCommand({ type: 'add-window', id, wallId: wall.id, position: v.at / Math.hypot(b[0] - a[0], b[1] - a[1]) }, 'הוספת חלון'); onSelect({ type: 'opening', id }); }} />
      </>;
    })()}
    {opening && (() => {
      const host = resolvedWalls(state).find(w => w.id === opening.wallId)!;
      const a = planPoint(host.a, host.unit, state), b = planPoint(host.b, host.unit, state), length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const aperture = getWallApertures(host, state).find(a => a.id === opening.id);
      const scale = length / Math.hypot(host.b[0] - host.a[0], host.b[1] - host.a[1]);
      return <>
        <p className="small-note">מידות מבוקשות; הגאומטריה האפקטיבית מוגבלת לקיר. {aperture ? `רוחב גלוי ${lengthText(aperture.width * scale, units)}` : 'הפתח אינו גלוי במידות הנוכחיות.'}</p>
        <NumericDraftForm skipUnchanged={kind === opening.kind} units={units} fields={[{ name: 'at', label: 'מרחק מקצה A', value: opening.position * length }, { name: 'width', label: 'רוחב פתח', value: opening.width }, { name: 'height', label: 'גובה פתח', value: opening.height }, { name: 'sill', label: 'גובה אדן', value: opening.sill }]}
          onApply={v => onCommand({ type: 'opening', id: opening.id, patch: { position: v.at / length, width: v.width, height: v.height, sill: v.sill, kind } }, 'עריכת פתח')}>
          <label>סוג פתח<select value={kind} onChange={e => setKind(e.target.value as OpeningKind)}>{Object.entries(OPENING_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        </NumericDraftForm>
      </>;
    })()}
    {item && (() => {
      const p = planPoint(item.center, item.unit, state), scales = furnitureScales(item, state);
      return <NumericDraftForm skipUnchanged units={units} fields={[{ name: 'x', label: 'מרכז X', value: p[0] }, { name: 'z', label: 'מרכז Z', value: p[1] },
        { name: 'rotation', label: 'סיבוב מקומי °', value: item.rotation, dimension: false }, { name: 'width', label: 'רוחב פריט', value: item.width * scales[0] }, { name: 'depth', label: 'עומק פריט', value: item.depth * scales[1] }, { name: 'height', label: 'גובה פריט', value: item.height }]}
        onApply={v => {
          const nextScales = furnitureScales({ ...item, rotation: v.rotation }, state);
          onCommand({ type: 'furniture', id: item.id, edit: { center: inversePlanPoint([v.x, v.z], item.unit, state), rotation: v.rotation, width: v.width / nextScales[0], depth: v.depth / nextScales[1], height: v.height, deleted: false } }, 'עריכת ריהוט עצמאי');
        }} />;
    })()}
    {room && (() => {
      const p = planPoint(room.center, room.unit, state), b = state.buildings[room.unit];
      return <NumericDraftForm skipUnchanged units={units} fields={[{ name: 'x', label: 'מרכז X', value: p[0] }, { name: 'z', label: 'מרכז Z', value: p[1] }, { name: 'width', label: 'רוחב חדר', value: room.width * b.width / BASE_WIDTH }, { name: 'depth', label: 'עומק חדר', value: room.depth * b.depth / BASE_DEPTH[room.unit] }]}
        onApply={v => onCommand({ type: 'room', id: room.id, edit: { center: inversePlanPoint([v.x, v.z], room.unit, state), width: v.width * BASE_WIDTH / b.width, depth: v.depth * BASE_DEPTH[room.unit] / b.depth,
          ...(room.rotation !== undefined ? { rotation: room.rotation } : {}), deleted: false } }, 'עריכת חדר')} />;
    })()}
    {remove && <Button size="sm" variant="secondary" onClick={() => { onCommand(remove, 'מחיקת אובייקט בתוכנית 2D'); onSelect(null); }}>מחיקת אובייקט</Button>}
    {onChange && <ObjectActions state={state} selection={selection} onChange={onChange} onSelect={onSelect} />}
  </section>;
}

export function FurniturePalette({ state, unit, floor, units, center, onCommand, onSelect }: {
  state: SimulationState; unit: UnitId; floor: FloorId; units: DisplayUnit; center: Vec2;
  onCommand: (command: CadCommand, label: string) => void; onSelect: (selection: CadSelection) => void;
}) {
  const [kind, setKind] = useState<FurnitureKind>('armchair');
  return <section aria-label="הוספת ריהוט">
    <p className="small-note">ריהוט ומכשירים סכמטיים · עד 200 תוספות · מידות מקומיות 0.2–10 מ׳, גובה 0.1–3 מ׳</p>
    <label>פריט להוספה<select value={kind} onChange={e => setKind(e.target.value as FurnitureKind)}>{FURNITURE_KINDS.map(k => <option key={k} value={k}>{FURNITURE_NAMES[k]}</option>)}</select></label>
    <NumericDraftForm units={units} submitLabel="הוספת פריט" fields={[{ name: 'x', label: 'מיקום חדש X', value: center[0] }, { name: 'z', label: 'מיקום חדש Z', value: center[1] }, { name: 'width', label: 'רוחב חדש', value: .6 }, { name: 'depth', label: 'עומק חדש', value: .6 }, { name: 'height', label: 'גובה חדש', value: .9 }]}
      onApply={v => {
        const id = `cad-item-${crypto.randomUUID()}`;
        const item = { id, kind, unit, floor, center: inversePlanPoint([v.x, v.z], unit, state), width: v.width, depth: v.depth, height: v.height, rotation: 0, source: 'added' as const };
        const scales = furnitureScales(item, state); item.width /= scales[0]; item.depth /= scales[1];
        const command: CadCommand = { type: 'add-furniture', item };
        // Ensure the selection is changed only after the atomic validator accepts the item.
        applyCadCommand(state, command); onCommand(command, 'הוספת ריהוט עצמאי'); onSelect({ type: 'furniture', id });
      }} />
  </section>;
}