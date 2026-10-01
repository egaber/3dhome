import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { lock } from 'proper-lockfile';
import { z } from 'zod';
import { taskSchema } from './core';
import { atomicWrite, hash, readBoard, runtimePath } from './runtime';

const noteSchema = z.object({
  id: z.string().uuid(), task_id: taskSchema.shape.id.nullable(),
  at: z.string().datetime(), text: z.string().trim().min(1).max(4000),
}).strict();
const notesSchema = z.array(noteSchema).max(500);
export type OperatorNote = z.infer<typeof noteSchema>;
export const noteInputSchema = z.object({
  id: z.string().uuid().optional(), task_id: taskSchema.shape.id.nullable(),
  text: noteSchema.shape.text,
}).strict();

export async function readNotes(root: string): Promise<OperatorNote[]> {
  try { return notesSchema.parse(JSON.parse(await readFile(runtimePath(root, 'operator-notes.json'), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

export const notesForTask = (notes: OperatorNote[], taskId: string) => notes.filter(note => note.task_id === null || note.task_id === taskId);
export const notesVersion = (notes: OperatorNote[]) => hash(JSON.stringify(notes));

export async function withNotesLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(runtimePath(root), { recursive: true });
  const release = await lock(root, { lockfilePath: runtimePath(root, 'notes.lock'), retries: { retries: 5, minTimeout: 30, maxTimeout: 200 } });
  try { return await operation(); } finally { await release(); }
}

/** Notes are separate from the active task: adding one cannot invalidate its CAS write. */
export async function addNote(root: string, input: unknown): Promise<OperatorNote> {
  const parsed = noteInputSchema.parse(input);
  if (parsed.task_id && !(await readBoard(root)).some(task => task.id === parsed.task_id)) throw new Error('Unknown task for note.');
  return withNotesLock(root, async () => {
    const notes = await readNotes(root);
    const existing = notes.find(note => note.id === parsed.id);
    if (existing) {
      if (existing.text !== parsed.text || existing.task_id !== parsed.task_id) throw new Error('Note ID already used for different content.');
      return existing;
    }
    const note = noteSchema.parse({ ...parsed, id: parsed.id ?? randomUUID(), at: new Date().toISOString() });
    notesSchema.parse([...notes, note]);
    await atomicWrite(runtimePath(root, 'operator-notes.json'), JSON.stringify([...notes, note], null, 2));
    return note;
  });
}