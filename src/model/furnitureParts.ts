import type { FurnitureSpec, Vec2 } from './types';
import { choice, number, invalid } from './cadValidation';
import { FURNITURE_KINDS } from './types';

/** Item-local offsets, BEFORE local rotation and dwelling scaling. Bottom is floor-relative. */
export interface FurniturePart {
  shape: 'box' | 'cylinder'; center: Vec2; bottom: number; width: number; depth: number; height: number;
  tone: 'body' | 'detail' | 'surface' | 'glass';
}

/** Shared detailed symbols/meshes. All parts of one logical item use its furnitureId. */
export function furnitureParts(item: FurnitureSpec): FurniturePart[] {
  choice(item.kind, 'kind', FURNITURE_KINDS);
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
      add(1, .49, 1, 0, 0, 0, 'detail'); add(1, .51, .22, 0, .49, .39, 'detail');
      for (const x of [-.46, .46]) add(.08, .26, 1, x, .49, 0);
      for (const x of item.kind === 'sofa' ? [-.23, .23] : [0]) add(item.kind === 'sofa' ? .43 : .8, .08, .72, x, .49, -.08, 'surface');
      break;
    case 'coffee-table': case 'dining-table':
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
  }
  return parts;
}