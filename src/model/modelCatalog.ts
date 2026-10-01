import type { FurnitureKind } from './types';

export interface CatalogModel {
  id: string; name: string; kind: FurnitureKind; dimensions: [number, number, number];
  file: string; author: string; license: 'CC0' | 'CC BY 4.0'; source: string;
  style: 'PBR' | 'lightweight'; rotation: number;
}
const entries: [string, string, FurnitureKind, number, number, number][] = [
  ['loungeDesignSofa', 'ספה מודרנית', 'sofa', 2.3, .9, .8],
  ['loungeSofaLong', 'ספה ארוכה', 'sofa', 2.8, .9, .8],
  ['loungeSofaCorner', 'ספה פינתית', 'sofa', 2.6, 1.8, .8],
  ['loungeDesignChair', 'כורסה מודרנית', 'armchair', .85, .85, .85],
  ['loungeChairRelax', 'כורסה נינוחה', 'armchair', .9, 1, .95],
  ['chairModernCushion', 'כיסא מרופד מודרני', 'chair', .5, .5, .85],
  ['chairModernFrameCushion', 'כיסא מסגרת מודרני', 'chair', .55, .55, .85],
  ['chairDesk', 'כיסא עבודה', 'chair', .65, .65, 1.1],
  ['bedDouble', 'מיטה זוגית', 'bed', 1.8, 2.1, 1],
  ['bedSingle', 'מיטת יחיד', 'bed', 1, 2.1, .9],
  ['bedBunk', 'מיטת קומתיים', 'bed', 1.05, 2.1, 1.8],
  ['tableCoffeeGlass', 'שולחן סלון זכוכית', 'coffee-table', 1.1, .6, .42],
  ['tableRound', 'שולחן אוכל עגול', 'dining-table', 1.3, 1.3, .76],
  ['desk', 'שולחן עבודה', 'dining-table', 1.4, .7, .75],
  ['kitchenCabinet', 'ארון מטבח מודרני', 'kitchen-unit', .6, .6, .9],
  ['kitchenCabinetDrawer', 'מגירות מטבח', 'kitchen-unit', .6, .6, .9],
  ['kitchenBar', 'אי מטבח', 'kitchen-island', 1.8, .8, .95],
  ['kitchenFridge', 'מקרר', 'fridge', .7, .7, 1.9],
  ['kitchenFridgeLarge', 'מקרר רחב', 'fridge', .95, .75, 1.9],
  ['kitchenFridgeBuiltIn', 'מקרר אינטגרלי', 'fridge', .65, .65, 1.9],
  ['kitchenStoveElectric', 'תנור וכיריים חשמליות', 'cooktop', .6, .6, .9],
  ['kitchenStove', 'תנור וכיריים גז', 'cooktop', .6, .6, .9],
  ['kitchenMicrowave', 'מיקרוגל', 'dishwasher', .55, .4, .35],
  ['kitchenCoffeeMachine', 'מכונת קפה', 'dishwasher', .3, .35, .4],
  ['washer', 'מכונת כביסה', 'dishwasher', .6, .6, .85],
  ['dryer', 'מייבש כביסה', 'dishwasher', .6, .6, .85],
  ['washerDryerStacked', 'מכונת כביסה ומייבש', 'dishwasher', .6, .65, 1.75],
  ['kitchenSink', 'כיור וארון מטבח', 'sink', .8, .6, .9],
  ['bathroomSinkSquare', 'כיור רחצה מרובע', 'basin', .65, .5, .85],
  ['toiletSquare', 'אסלה מודרנית', 'toilet', .42, .68, .8],
  ['showerRound', 'מקלחון מעוגל', 'shower', .9, .9, 2.1],
  ['bookcaseClosedWide', 'ארון ספרים רחב', 'kitchen-unit', 1.4, .4, 1.8],
];
export const EXTRA_MODELS: CatalogModel[] = entries.map(([id, name, kind, width, depth, height]) => ({
  id: `kenney-${id}`, name, kind, dimensions: [width, depth, height], file: `catalog/${id}.glb`,
  author: 'Kenney', license: 'CC0', source: 'https://kenney.nl/assets/furniture-kit', style: 'lightweight', rotation: Math.PI,
}));
EXTRA_MODELS.push({ id: 'modern_arm_chair_01', name: 'כורסה מודרנית · עץ ועור PBR', kind: 'armchair', dimensions: [.85, .9, 1],
  file: 'catalog/modern_arm_chair_01/modern_arm_chair_01_1k.gltf', author: 'Vibrant Nordic', license: 'CC0',
  source: 'https://polyhaven.com/a/modern_arm_chair_01', style: 'PBR', rotation: Math.PI });
export const CATALOG_IDS = ['SheenWoodLeatherSofa', 'SheenChair', ...EXTRA_MODELS.map(m => m.id)];
export function catalogModel(id: string) { return EXTRA_MODELS.find(m => m.id === id); }