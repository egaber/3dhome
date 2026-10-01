import { boolean, choice, identifier, invalid, list, number, record, text } from './cadValidation';
import type { SimulationState, UnitId } from './types';

export const FINISHES = ['wood', 'fabric', 'stone', 'plaster', 'tile', 'ceramic', 'metal', 'paint', 'glass', 'dark'] as const;
export type FinishId = typeof FINISHES[number];
export const FINISH_NAMES: Record<FinishId, string> = { wood: 'עץ', fabric: 'בד', stone: 'שיש', plaster: 'טיח', tile: 'אריחים', ceramic: 'קרמיקה', metal: 'מתכת', paint: 'צבע לבן', glass: 'זכוכית', dark: 'כהה' };
export interface ImageMaterial { id: string; name: string; image: string }
export interface MaterialAssignment { material: string; metres: number; roughness: number }
export interface Appearance {
  images: ImageMaterial[];
  assignments: Record<string, MaterialAssignment>;
  models: Record<string, string>;
}
export const emptyAppearance = (): Appearance => ({ images: [], assignments: {}, models: {} });
export type SurfaceFloor = 'basement' | 'ground' | 'first' | 'roof';
export function surfaceTarget(kind: 'floor' | 'ceiling', unit: UnitId, floor: SurfaceFloor) { return `${kind}-${unit}-${floor}`; }
export function objectTarget(kind: string, id: string) { return `${kind}-${id}`; }

export function validateMaterialImage(value: unknown, path = 'image'): string {
  if (typeof value !== 'string' || value.length > 240_000) invalid(path, 'תמונת חומר חייבת להיות PNG/JPEG/WebP מקומית עד 240,000 תווים.');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4) invalid(path, 'נדרש קובץ תמונה מקומי תקין; SVG וכתובות רשת אינם נתמכים.');
  const prefix = atob(match[2].slice(0, 16));
  if (!(match[1] === 'png' ? prefix.startsWith('\x89PNG\r\n\x1a\n') : match[1] === 'jpeg' ? prefix.startsWith('\xff\xd8\xff') : prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP')) invalid(path, 'חתימת התמונה אינה תואמת לסוג הקובץ.');
  return value;
}

export function parseAppearance(value: unknown, targets: Set<string>, furniture: Set<string>, modelIds: readonly string[]): Appearance {
  if (value === undefined) return emptyAppearance();
  const input = record(value, 'appearance', ['images', 'assignments', 'models']), ids = new Set<string>(FINISHES);
  const images = list(input.images, 'appearance.images', 12).map((v, i) => {
    const p = `appearance.images[${i}]`, item = record(v, p, ['id', 'name', 'image']), id = identifier(item.id, `${p}.id`);
    if (!id.startsWith('image-') || ids.has(id)) invalid(p, 'נדרש מזהה תמונה ייחודי שמתחיל ב־image-.');
    ids.add(id);
    return { id, name: text(item.name, `${p}.name`), image: validateMaterialImage(item.image, `${p}.image`) };
  });
  const assignments: Appearance['assignments'] = {}, source = record(input.assignments, 'appearance.assignments');
  if (Object.keys(source).length > 1000) invalid('appearance.assignments', 'מותרות עד 1000 הקצאות.');
  for (const [key, v] of Object.entries(source)) {
    if (!targets.has(key)) invalid(`appearance.assignments.${key}`, 'האובייקט אינו קיים.');
    const a = record(v, key, ['material', 'metres', 'roughness']);
    assignments[key] = { material: choice(a.material, `${key}.material`, [...ids]), metres: number(a.metres, `${key}.metres`, .05, 20), roughness: number(a.roughness, `${key}.roughness`, 0, 1) };
  }
  const models: Appearance['models'] = {}, m = record(input.models, 'appearance.models');
  if (Object.keys(m).length > 500) invalid('appearance.models', 'מותרות עד 500 בחירות מודל.');
  for (const [id, v] of Object.entries(m)) {
    if (!furniture.has(id)) invalid(id, 'פריט הריהוט אינו קיים.');
    models[id] = choice(v, id, ['parametric', ...modelIds]);
  }
  return { images, assignments, models };
}

export function assignMaterial(state: SimulationState, target: string, assignment: MaterialAssignment | null): SimulationState {
  const appearance = state.appearance ?? emptyAppearance(), assignments = { ...appearance.assignments };
  if (assignment) assignments[target] = assignment; else delete assignments[target];
  return { ...state, appearance: { ...appearance, assignments } };
}

/** Shared optional stair controls are strict on command and project boundaries. */
export function stairOptions(value: unknown) {
  const v = record(value, 'stair-options', ['scale', 'enabled']);
  return { scale: number(v.scale, 'stairScale', .5, 2), enabled: boolean(v.enabled, 'stairEnabled') };
}