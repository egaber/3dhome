import { LoadingManager } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import credits from '../../public/assets/showroom/credits.json';

export const SHOWROOM_MODELS = ['potted_plant_02', 'fern_02'] as const;

export async function loadShowroomModel(id: typeof SHOWROOM_MODELS[number]) {
  const files = credits.files.filter(file => file.path.startsWith(`${id}/`));
  const resources: { path: string; url: string }[] = [];
  try {
    for (const file of files) {
      const response = await fetch(`${import.meta.env.BASE_URL}assets/showroom/${file.path}`);
      if (!response.ok) throw new Error(`Showroom asset HTTP ${response.status}: ${id}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== file.bytes) throw new Error(`Showroom asset size mismatch: ${file.path}`);
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      if (digest !== file.sha256) throw new Error(`Showroom asset checksum mismatch: ${file.path}`);
      if (file.path.endsWith('.gltf')) {
        const model = JSON.parse(new TextDecoder().decode(bytes)) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
        for (const resource of [...model.buffers ?? [], ...model.images ?? []]) {
          if (resource.uri && !files.some(file => file.path === `${id}/${resource.uri}`)) throw new Error('Unknown showroom model dependency');
        }
      }
      resources.push({ path: file.path, url: URL.createObjectURL(new Blob([bytes])) });
    }
    const manager = new LoadingManager();
    manager.setURLModifier(url => {
      const match = resources.find(resource => url === resource.url || url.endsWith(`/${resource.path.slice(id.length + 1)}`));
      if (!match) throw new Error('External showroom model resource rejected');
      return match.url;
    });
    return await new GLTFLoader(manager).loadAsync(resources.find(resource => resource.path.endsWith('.gltf'))!.url);
  } finally { resources.forEach(resource => URL.revokeObjectURL(resource.url)); }
}
