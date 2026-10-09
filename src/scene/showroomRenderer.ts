import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export function createShowroomRenderer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const render = new RenderPass(scene, camera), occlusion = new GTAOPass(scene, camera, 1, 1), output = new OutputPass();
  occlusion.blendIntensity = .65;
  occlusion.updateGtaoMaterial({ radius: .3, thickness: .25, distanceFallOff: .7, samples: 8 });
  occlusion.updatePdMaterial({ radius: 4, rings: 2, samples: 8 });
  composer.addPass(render); composer.addPass(occlusion); composer.addPass(output);
  return {
    render(high: boolean) { occlusion.enabled = high; composer.render(); },
    resize(width: number, height: number) { composer.setSize(width, height); },
    dispose() { occlusion.dispose(); output.dispose(); render.dispose(); composer.dispose(); },
  };
}
