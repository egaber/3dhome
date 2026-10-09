import { describe, expect, it } from 'vitest';
import { calibratedScale, detectImageLines, extractVectorPdf, reconstructPlan, vectorPaths, type PlanSource } from './planReconstruction';
import { parseProject, serializeProject } from './project';
import { resolvedRooms, resolvedWalls } from '../model/plans';
import { deflateSync } from 'node:zlib';

const source: PlanSource = { name: 'Measured drawing', image: null, width: 500, height: 400, warnings: [], segments: [
  { a: [10, 10], b: [410, 10] }, { a: [410, 10], b: [410, 310] }, { a: [410, 310], b: [10, 310] }, { a: [10, 310], b: [10, 10] },
] };
describe('calibrated local plan reconstruction', () => {
  it('extracts PDF line coordinates under nested transforms, closes rectangles, and omits text/curves', () => {
    const lines = vectorPaths('q 2 0 0 2 10 20 cm 1 2 m 5 2 l S Q 0 0 10 20 re S BT (fake text) Tj ET');
    expect(lines[0]).toEqual({ a: [12, 24], b: [20, 24] });
    expect(lines).toHaveLength(5);
    expect(vectorPaths('0 0 m 1 2 3 4 5 6 c S')).toHaveLength(0);
    expect(() => vectorPaths('/Image1 Do')).toThrow();
  });
  it('reads a vector PDF page tree without evaluating PDF scripts or fetching external resources', async () => {
    const content = '10 20 m 100 20 l S';
    const pdf = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 200 300] >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n%%EOF`;
    const page = await extractVectorPdf(new TextEncoder().encode(pdf));
    expect(page.pageCount).toBe(1);
    expect(page.segments).toEqual([{ a: [10, 280], b: [100, 280] }]);
    await expect(extractVectorPdf(new TextEncoder().encode(pdf), 2)).rejects.toThrow();
    await expect(extractVectorPdf(new TextEncoder().encode(pdf + '/Encrypt 5 0 R'))).rejects.toThrow();
  });
  it('decodes Flate streams with indirect lengths and rejects malformed compressed input', async () => {
    const compressed = deflateSync('20 20 m 120 20 l S');
    const header = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 200 300] >>\nendobj\n3 0 obj\n<< /Type /Page /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Filter /FlateDecode /Length 5 0 R >>\nstream\n';
    const ending = `\nendstream\nendobj\n5 0 obj\n${compressed.length}\nendobj\n%%EOF`;
    const data = Buffer.concat([Buffer.from(header), compressed, Buffer.from(ending)]);
    expect((await extractVectorPdf(data)).segments).toEqual([{ a: [20, 280], b: [120, 280] }]);
    const corrupt = Buffer.from(data); corrupt[Buffer.byteLength(header)] = 0;
    await expect(extractVectorPdf(corrupt)).rejects.toThrow();
  });
  it('detects bounded raster lines and excludes short annotation strokes', () => {
    const pixels = new Uint8ClampedArray(100 * 60 * 4).fill(255);
    for (let x = 10; x <= 80; x++) { const i = (20 * 100 + x) * 4; pixels[i] = pixels[i + 1] = pixels[i + 2] = 0; }
    const lines = detectImageLines(pixels, 100, 60, 30);
    expect(lines).toEqual([{ a: [10, 20], b: [80, 20] }]);
    expect(() => detectImageLines(pixels, 101, 60, 30)).toThrow();
  });
  it('recreates exact metric segments in a new independent editable project and round-trips the result', () => {
    const scale = calibratedScale([10, 10], [410, 10], 8);
    expect(scale).toBe(.02);
    const state = reconstructPlan(source, source.segments, scale, .18);
    expect(resolvedWalls(state)).toHaveLength(4);
    expect(resolvedWalls(state)[0]).toMatchObject({ a: [.2, .2], b: [8.2, .2], thickness: .18 });
    expect(resolvedRooms(state).map(room => room.id)).toEqual(['imported-room']);
    expect(parseProject(serializeProject(state))).toEqual(state);
  });
  it('rejects zero-scale, short, oversized and non-finite geometry instead of creating a false success', () => {
    expect(() => calibratedScale([1, 1], [1, 1], 5)).toThrow();
    expect(() => calibratedScale([0, 0], [100, 0], NaN)).toThrow();
    expect(() => reconstructPlan(source, [], .02, .18)).toThrow();
    expect(() => reconstructPlan(source, source.segments, 1, .18)).toThrow();
    expect(() => reconstructPlan(source, [{ a: [0, 0], b: [NaN, 1] }], .02, .18)).toThrow();
  });
});
