import { UNIT_NAMES, type SimulationState } from '../model/types';

export const HISTORY_LIMIT = 100;
export type StateUpdate = SimulationState | ((current: SimulationState) => SimulationState);
export interface HistoryEntry { id: number; label: string; state: SimulationState }
export interface ActionHistoryState {
  entries: HistoryEntry[];
  index: number;
  present: SimulationState;
  nextId: number;
  group: { label?: string } | null;
}
export type HistoryAction =
  | { type: 'change'; update: StateUpdate; label?: string }
  | { type: 'begin'; label?: string }
  | { type: 'end' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'jump'; id: number };

/** Compare plain project data without serializing large reference images on every edit. */
export function sameState(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && sameState(left[key], right[key]));
}

export function describeChange(before: SimulationState, after: SimulationState): string {
  if (!sameState(before.appearance, after.appearance)) return 'שינוי חומרים או מודל ריהוט';
  if (!sameState(before.design, after.design)) return 'עריכת תוכנית 2D';
  if (before.addedOpenings.length !== after.addedOpenings.length) return after.addedOpenings.length > before.addedOpenings.length ? 'הוספת פתח' : 'מחיקת פתח';
  if (!sameState(before.openings, after.openings) || !sameState(before.addedOpenings, after.addedOpenings)) return 'עריכת פתחים';
  for (const unit of ['north', 'south'] as const) {
    if (!sameState(before.buildings[unit], after.buildings[unit])) return `עריכת מבנה · ${UNIT_NAMES[unit]}`;
  }
  if (!sameState(before.neighbors, after.neighbors)) return 'עריכת מבנה שכן';
  if (before.date !== after.date || before.minutes !== after.minutes) return 'שינוי תאריך ושעת שמש';
  if (!sameState(before.view, after.view)) return 'שינוי הגדרות תצוגה';
  if (!sameState(before.reference, after.reference)) return 'עריכת תמונת ייחוס';
  if (!sameState(before.vehicles, after.vehicles)) return 'הזזת רכבים';
  return 'שינוי הגדרות מגרש';
}

export function createHistory(state: SimulationState): ActionHistoryState {
  return { entries: [{ id: 0, label: 'מצב התחלתי', state }], index: 0, present: state, nextId: 1, group: null };
}

/** Snapshots share unchanged branches. Callers must use immutable React state updates. */
function commit(history: ActionHistoryState, next: SimulationState, label?: string): ActionHistoryState {
  const previous = history.entries[history.index].state;
  if (sameState(previous, next)) return { ...history, present: previous, group: null };
  const entries = [...history.entries.slice(0, history.index + 1), {
    id: history.nextId, label: label || describeChange(previous, next), state: next,
  }].slice(-(HISTORY_LIMIT + 1));
  return { entries, index: entries.length - 1, present: next, nextId: history.nextId + 1, group: null };
}

export function finishHistory(history: ActionHistoryState): ActionHistoryState {
  return history.group ? commit(history, history.present, history.group.label) : history;
}

export function historyReducer(history: ActionHistoryState, action: HistoryAction): ActionHistoryState {
  if (action.type === 'change') {
    const next = typeof action.update === 'function' ? action.update(history.present) : action.update;
    if (sameState(history.present, next)) return history;
    return history.group
      ? { ...history, present: next, group: { label: history.group.label || action.label || describeChange(history.present, next) } }
      : commit(history, next, action.label);
  }
  if (action.type === 'begin') return { ...finishHistory(history), group: { label: action.label } };
  if (action.type === 'end') return finishHistory(history);
  // Invalid/stale destinations must not commit or discard an in-progress edit.
  if (action.type === 'jump' && !history.entries.some(entry => entry.id === action.id)) return history;
  const current = finishHistory(history);
  const index = action.type === 'undo' ? Math.max(0, current.index - 1)
    : action.type === 'redo' ? Math.min(current.entries.length - 1, current.index + 1)
      : current.entries.findIndex(entry => entry.id === action.id);
  if (index < 0 || index === current.index) return current;
  return { ...current, index, present: current.entries[index].state };
}

export function historyShortcut(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'isComposing' | 'defaultPrevented'>, editable: boolean): 'undo' | 'redo' | null {
  if (editable || event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return null;
  // Physical codes also work with the Hebrew keyboard layout.
  if (event.code === 'KeyZ' || event.key.toLowerCase() === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (!event.shiftKey && (event.code === 'KeyY' || event.key.toLowerCase() === 'y')) return 'redo';
  return null;
}