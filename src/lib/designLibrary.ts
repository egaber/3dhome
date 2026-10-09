import type { SimulationState } from '../model/types';
import { identifier, list, number, record, text } from '../model/cadValidation';
import { parseProject, serializeProject } from './project';

export const DESIGN_LIBRARY_KEY = 'dori-home-v2-design-library';
export const MAX_DESIGNS = 20;
const MAX_LIBRARY_BYTES = 32_000_000;

export interface DesignOption {
  id: string;
  name: string;
  created: string;
  updated: string;
  project: SimulationState;
}

export interface DesignLibrary {
  format: 'dori-home-designs';
  version: 1;
  revision: number;
  activeId: string;
  options: DesignOption[];
}

export interface DesignStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function designName(value: string): string {
  const name = text(value, 'design.name').trim();
  if (!name || name.length > 80) throw new Error('שם החלופה חייב להכיל 1–80 תווים.');
  return name;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('תאריך החלופה אינו תקין.');
  }
  return value;
}

const copyProject = (project: SimulationState): SimulationState => parseProject(serializeProject(project));

export function createDesignLibrary(project: SimulationState, id: string, now: string): DesignLibrary {
  return { format: 'dori-home-designs', version: 1, revision: 0, activeId: identifier(id, 'design.id'),
    options: [{ id, name: 'הבית שלי · מקור', created: timestamp(now), updated: now, project: copyProject(project) }] };
}

export function parseDesignLibrary(json: string): DesignLibrary {
  if (json.length > MAX_LIBRARY_BYTES) throw new Error('קובץ החלופות גדול מדי (עד 32 MB).');
  const input = record(JSON.parse(json), 'library', ['format', 'version', 'revision', 'activeId', 'options']);
  if (input.format !== 'dori-home-designs' || input.version !== 1) throw new Error('קובץ חלופות לא נתמך.');
  const ids = new Set<string>();
  const options = list(input.options, 'library.options', MAX_DESIGNS).map((value, index): DesignOption => {
    const entry = record(value, `library.options[${index}]`, ['id', 'name', 'created', 'updated', 'project']);
    const id = identifier(entry.id, 'design.id');
    if (ids.has(id)) throw new Error('מזהה חלופה כפול בקובץ.');
    ids.add(id);
    return { id, name: designName(text(entry.name, 'design.name')), created: timestamp(entry.created),
      updated: timestamp(entry.updated), project: parseProject(JSON.stringify(entry.project)) };
  });
  const activeId = identifier(input.activeId, 'library.activeId');
  if (!ids.has(activeId)) throw new Error('החלופה הפעילה חסרה בקובץ.');
  return { format: 'dori-home-designs', version: 1, revision: number(input.revision, 'library.revision', 0, Number.MAX_SAFE_INTEGER, true), activeId, options };
}

export function updateDesign(library: DesignLibrary, project: SimulationState, now: string): DesignLibrary {
  return { ...library, options: library.options.map(option => option.id === library.activeId
    ? { ...option, project: copyProject(project), updated: timestamp(now) } : option) };
}

export function duplicateDesign(library: DesignLibrary, project: SimulationState, name: string, id: string, now: string): DesignLibrary {
  identifier(id, 'design.id');
  if (library.options.length >= MAX_DESIGNS) throw new Error(`ניתן לשמור עד ${MAX_DESIGNS} חלופות. יצאו גיבוי לפני מחיקת חלופות.`);
  if (library.options.some(option => option.id === id)) throw new Error('מזהה החלופה כבר קיים.');
  return { ...library, activeId: id, options: [...library.options,
    { id, name: designName(name), created: timestamp(now), updated: now, project: copyProject(project) }] };
}

export function activateDesign(library: DesignLibrary, id: string): DesignLibrary {
  if (!library.options.some(option => option.id === id)) throw new Error('החלופה שנבחרה אינה קיימת.');
  return { ...library, activeId: id };
}

export function removeDesign(library: DesignLibrary, id: string): DesignLibrary {
  if (library.options.length === 1) throw new Error('לא ניתן למחוק את החלופה היחידה.');
  if (id === library.activeId) throw new Error('עברו לחלופה אחרת לפני המחיקה.');
  if (!library.options.some(option => option.id === id)) throw new Error('החלופה אינה קיימת.');
  return { ...library, options: library.options.filter(option => option.id !== id) };
}

export function mergeDesignLibrary(current: DesignLibrary, incoming: DesignLibrary, ids: string[], now: string): DesignLibrary {
  if (ids.length !== incoming.options.length) throw new Error('חסרים מזהים לחלופות המיובאות.');
  let result = current;
  for (const [index, option] of incoming.options.entries()) result = duplicateDesign(result, option.project, option.name, ids[index], now);
  return activateDesign(result, ids[incoming.options.findIndex(option => option.id === incoming.activeId)]);
}

/** Whole-value writes reject corrupt data and revisions already changed by another tab. */
export function storeDesignLibrary(storage: DesignStorage, next: DesignLibrary, expectedRevision: number | null): DesignLibrary {
  const existing = storage.getItem(DESIGN_LIBRARY_KEY);
  const current = existing === null ? null : parseDesignLibrary(existing);
  if ((current?.revision ?? null) !== expectedRevision) throw new Error('החלופות השתנו בלשונית אחרת. יצאו את השינויים וטענו מחדש לפני שמירה.');
  const saved = parseDesignLibrary(JSON.stringify({ ...next, revision: (current?.revision ?? -1) + 1 }));
  storage.setItem(DESIGN_LIBRARY_KEY, JSON.stringify(saved));
  return saved;
}
