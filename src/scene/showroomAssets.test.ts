import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import credits from '../../public/assets/showroom/credits.json';

describe('locally vendored showroom planting', () => {
  it('ships the original CC0 model bytes, all textures, and pinned verified checksums', () => {
    expect(credits.license).toBe('CC0-1.0');
    expect(credits.models).toHaveLength(2);
    let total = 0;
    for (const file of credits.files) {
      const bytes = readFileSync(resolve('public', 'assets', 'showroom', file.path));
      expect(bytes.length).toBe(file.bytes); total += bytes.length;
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
      if (file.path.endsWith('.gltf')) {
        const model = JSON.parse(bytes.toString()) as { buffers: { uri: string }[]; images: { uri: string }[] };
        const directory = file.path.split('/')[0];
        for (const resource of [...model.buffers, ...model.images]) {
          expect(resource.uri).not.toMatch(/^(?:https?:|data:|\/)|\.\./);
          expect(credits.files.some(entry => entry.path === `${directory}/${resource.uri}`)).toBe(true);
        }
      }
    }
    expect(total).toBeLessThan(4_000_000);
  });
});
