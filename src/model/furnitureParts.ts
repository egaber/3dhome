import type { FurnitureSpec, Vec2 } from './types';
import { choice, number, invalid } from './cadValidation';
import { FURNITURE_KINDS } from './types';

/** Item-local offsets, BEFORE local rotation and dwelling scaling. Bottom is floor-relative. */
export interface FurniturePart {
  shape: 'box' | 'cylinder'; center: Vec2; bottom: number; width: number; depth: number; height: number;
  tone: 'body' | 'detail' | 'surface' | 'glass';
}

/** Shared detailed symbols/meshes. All parts of one logical item use its furnitureId. */
export function furnitureParts(item: FurnitureSpec, upholstered = false): FurniturePart[] {
  choice(item.kind, 'kind', FURNITURE_KINDS);
  if (item.shape !== undefined) {
    choice(item.shape, 'shape', ['round']);
    if (item.kind !== 'dining-table') invalid(item.id, 'צורה עגולה מיועדת לשולחן אוכל בלבד.');
  }
  number(item.width, 'width', .2, 10); number(item.depth, 'depth', .2, 10); number(item.height, 'height', .1, 3);
  if (!item.center.every(Number.isFinite) || !Number.isFinite(item.rotation)) invalid(item.id, 'יש לתקן את מיקום הריהוט.');
  const parts: FurniturePart[] = [];
  const add = (w: number, h: number, d: number, x = 0, y = 0, z = 0, tone: FurniturePart['tone'] = 'body', shape: FurniturePart['shape'] = 'box') => {
    parts.push({ shape, center: [x * item.width, z * item.depth], bottom: y * item.height,
      width: w * item.width, height: h * item.height, depth: d * item.depth, tone });
  };
  const legs = (top: number) => { for (const x of [-.4, .4]) for (const z of [-.35, .35]) add(.04, top, .06, x, 0, z, 'detail'); };
  switch (item.kind) {
    case 'bed':
      add(.935, .37, 1, 0, 0, 0, 'detail'); add(.91, .21, .985, 0, .37, -.005, 'surface');
      add(1, 1, .062, 0, 0, -.469, 'detail');
      for (const x of [-.245, .245]) add(.335, .092, .18, x, .58, -.36, 'surface');
      break;
    case 'sofa': case 'armchair':
      if (upholstered) {
        for (const x of [-.4, .4]) for (const z of [-.35, .35]) add(.035, .12, .05, x, 0, z, 'detail');
        add(.97, .24, .96, 0, .10, 0);
        add(.98, .69, .17, 0, .31, .41);
        for (const x of [-.455, .455]) add(.09, .50, .94, x, .24, 0);
        const count = item.kind === 'sofa' ? 2 : 1;
        for (let index = 0; index < count; index++) {
          const x = (index - (count - 1) / 2) * .81 / count;
          add(.78 / count, .23, .74, x, .34, -.07, 'surface');
          add(.78 / count, .40, .23, x, .55, .27, 'surface');
        }
        break;
      }
      add(1, .49, 1, 0, 0, 0, 'detail'); add(1, .51, .22, 0, .49, .39, 'detail');
      for (const x of [-.46, .46]) add(.08, .26, 1, x, .49, 0);
      for (const x of item.kind === 'sofa' ? [-.23, .23] : [0]) add(item.kind === 'sofa' ? .43 : .8, .08, .72, x, .49, -.08, 'surface');
      break;
    case 'dining-table':
      if (item.shape === 'round') {
        add(.5, .05, .5, 0, 0, 0, 'detail', 'cylinder');
        add(.14, .85, .14, 0, .05, 0, 'detail', 'cylinder');
        add(1, .1, 1, 0, .9, 0, 'surface', 'cylinder');
      } else {
        legs(.9); add(1, .1, 1, 0, .9, 0, 'surface');
      }
      break;
    case 'coffee-table': case 'desk':
      legs(.9); add(1, .1, 1, 0, .9, 0, 'surface'); break;
    case 'chair':
      legs(.5); add(1, .06, 1, 0, .5); add(1, .44, .11, 0, .56, -.445, 'detail'); break;
    case 'kitchen-unit': case 'kitchen-island':
      add(.92, .96, .98, 0, 0, 0, 'detail'); add(1, .04, 1, 0, .96, 0, 'surface');
      for (const z of [-.3, 0, .3]) {
        add(.025, .65, .28, .472, .15, z); add(.015, .025, .13, .49, .74, z, 'detail');
      }
      break;
    case 'sink': case 'basin':
      if (item.kind === 'basin') add(.25, .8, .4, 0, 0, 0, 'detail');
      add(.8, .025, .68, 0, .87, 0, 'detail');
      for (const x of [-.45, .45]) add(.1, .08, 1, x, .9, 0, 'surface');
      for (const z of [-.45, .45]) add(.8, .08, .1, 0, .9, z, 'surface');
      add(.07, .1, .06, 0, .9, -.35, 'detail'); add(.07, .02, .22, 0, .98, -.25, 'detail');
      break;
    case 'cooktop':
      add(1, .035, 1, 0, .96, 0, 'detail');
      for (const x of [-.25, .25]) for (const z of [-.25, .25]) add(.32, .005, .32, x, .995, z, 'surface', 'cylinder');
      break;
    case 'fridge':
      add(1, 1, .93, 0, 0, .035, 'detail');
      add(.98, .65, .07, 0, .34, -.465); add(.98, .32, .07, 0, 0, -.465);
      add(.04, .22, .025, -.36, .4, -.4875, 'detail'); break;
    case 'dishwasher':
      add(1, 1, .94, 0, 0, .03, 'detail'); add(.97, .85, .06, 0, .03, -.47);
      add(.97, .1, .06, 0, .89, -.47, 'surface'); add(.5, .025, .025, 0, .9, -.4875, 'detail'); break;
    case 'toilet':
      add(.55, .5, .5, 0, 0, .12); add(1, .18, .75, 0, .5, .125, 'surface', 'cylinder');
      add(.9, 1, .25, 0, 0, -.375); add(.2, .02, .1, 0, .98, -.375, 'detail'); break;
    case 'shower':
      add(1, .04, 1, 0, 0, 0, 'surface');
      add(.02, .96, 1, -.49, .04, 0, 'glass'); add(1, .96, .02, 0, .04, -.49, 'glass'); break;
    case 'bathtub':
      add(1, .18, 1, 0, 0, 0, 'surface');
      for (const x of [-.47, .47]) add(.06, .82, 1, x, .18, 0, 'surface');
      for (const z of [-.46, .46]) add(.88, .82, .08, 0, .18, z, 'surface');
      add(.04, .06, .1, -.42, .94, 0, 'detail'); break;
    case 'wardrobe':
      add(1, 1, .96, 0, 0, .02, 'detail');
      for (const x of [-.25, .25]) add(.49, .97, .04, x, .015, -.48, 'surface');
      for (const x of [-.04, .04]) add(.02, .16, .02, x, .4, -.49, 'detail'); break;
    case 'nightstand':
      add(1, .90, .94, 0, 0, .03, 'detail'); add(1, .06, 1, 0, .94, 0, 'surface');
      for (const level of [.12, .53]) add(.94, .38, .06, 0, level, -.47, 'surface'); break;
    case 'bookcase':
      for (const side of [-.47, .47]) add(.06, 1, 1, side, 0, 0, 'detail');
      add(1, 1, .06, 0, 0, .47, 'detail');
      for (const level of [0, .24, .48, .72, .96]) add(.88, .04, 1, 0, level, 0, 'surface'); break;
    case 'oven-tower':
      add(1, 1, .96, 0, 0, .02, 'detail');
      add(.91, .26, .04, 0, .18, -.48, 'glass'); add(.85, .16, .04, 0, .52, -.48, 'glass');
      for (const level of [.14, .44, .70]) add(.68, .018, .025, 0, level, -.4875, 'surface'); break;
    case 'washer-dryer':
      add(1, 1, .97, 0, 0, .015, 'surface');
      for (const level of [.08, .57]) { add(.67, .30, .03, 0, level, -.485, 'glass'); add(.80, .035, .025, 0, level + .35, -.4875, 'detail'); }
      break;
    case 'tv-console':
      add(1, .27, 1, 0, 0, 0, 'detail'); add(.76, .60, .06, 0, .40, .12, 'glass');
      add(.2, .13, .25, 0, .27, .12, 'detail'); break;
    case 'pendant':
      add(.025, .16, .025, 0, .84, 0, 'detail'); add(1, .05, 1, 0, .79, 0, 'surface', 'cylinder'); break;
    case 'vanity':
      add(1, .84, .92, 0, 0, .04, 'detail'); add(1, .06, 1, 0, .84, 0, 'surface');
      for (const side of [-.46, .46]) add(.08, .10, 1, side, .9, 0, 'surface');
      for (const side of [-.46, .46]) add(.84, .10, .08, 0, .9, side, 'surface');
      add(.06, .10, .06, 0, .90, .32, 'detail'); break;
    case 'bench':
      add(1, .5, 1, 0, 0, 0, 'detail'); add(.97, .06, .96, 0, .5, -.02, 'surface');
      add(1, .44, .14, 0, .56, .43, 'detail'); break;
  }
  return parts;
}