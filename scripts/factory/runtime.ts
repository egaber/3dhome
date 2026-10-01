import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, writeFileSync, rmSync } from 'node:fs';
import { mkdir, readFile, rename, rm, open, lstat, readlink, readdir } from 'node:fs/promises';
import { basename, delimiter, join, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { finished } from 'node:stream/promises';
import { promisify } from 'node:util';
import spawn from 'cross-spawn';
import { lock } from 'proper-lockfile';
import { z } from 'zod';
import { boardSchema, configSchema, parseAgentOutput, roles } from './core';
import type { AgentResult, FactoryConfig, FactoryTask, Role, Verification } from './core';
import type { OperatorNote } from './notes';

const execFileAsync = promisify(execFile);
export const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
export const runtimePath = (root: string, ...parts: string[]) => join(root, '.factory', ...parts);
export const localPath = (root: string, file: string) => relative(root, file).replaceAll('\\', '/');
export const isAlive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
};

export async function atomicWrite(file: string, content: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, file); } finally { await rm(temporary, { force: true }); }
}

export async function readBoard(root: string): Promise<FactoryTask[]> {
  return boardSchema.parse(JSON.parse(await readFile(join(root, 'tasks.json'), 'utf8')));
}

export async function readConfig(root: string): Promise<FactoryConfig> {
  return configSchema.parse(JSON.parse(await readFile(join(root, 'factory.config.json'), 'utf8')));
}

const journalSchema = z.object({
  beforeBoardHash: z.string(), beforeMemoryHash: z.string(), board: z.string(), memory: z.string(),
}).strict();

async function recoverTransaction(root: string): Promise<void> {
  const journalFile = runtimePath(root, 'transaction.json');
  if (!existsSync(journalFile)) return;
  const journal = journalSchema.parse(JSON.parse(await readFile(journalFile, 'utf8')));
  const files = [
    { file: join(root, 'tasks.json'), before: journal.beforeBoardHash, after: journal.board },
    { file: join(root, 'MEMORY.md'), before: journal.beforeMemoryHash, after: journal.memory },
  ];
  for (const item of files) {
    const current = hash(await readFile(item.file));
    if (current !== item.before && current !== hash(item.after)) throw new Error('Recovery conflicts with an external edit. Preserve the journal and reconcile it before restarting.');
  }
  for (const item of files) await atomicWrite(item.file, item.after);
  await rm(journalFile);
}

export interface MemoryEntry { section: 'Architectural Contracts' | 'UX/UI Notes' | 'Live System Logs'; text: string }
export function appendMemory(memory: string, entry: MemoryEntry): string {
  const heading = `## ${entry.section}`;
  const start = memory.indexOf(heading);
  if (start < 0) throw new Error(`Missing memory section: ${entry.section}`);
  const end = memory.indexOf('\n## ', start + heading.length);
  const offset = end < 0 ? memory.length : end;
  return `${memory.slice(0, offset).trimEnd()}\n\n${entry.text.trim()}\n${memory.slice(offset)}`;
}

/** Journal both shared files before replacing either; replay is idempotent after a crash. */
export async function updateBoard(root: string, update: (tasks: FactoryTask[]) => { tasks: FactoryTask[]; entries?: MemoryEntry[] }): Promise<FactoryTask[]> {
  await mkdir(runtimePath(root), { recursive: true });
  const release = await lock(join(root, 'tasks.json'), { retries: { retries: 4, minTimeout: 50, maxTimeout: 250 } });
  try {
    await recoverTransaction(root);
    const boardText = await readFile(join(root, 'tasks.json'), 'utf8');
    const memoryText = await readFile(join(root, 'MEMORY.md'), 'utf8');
    const result = update(boardSchema.parse(JSON.parse(boardText)));
    const tasks = boardSchema.parse(result.tasks);
    const memory = (result.entries ?? []).reduce(appendMemory, memoryText);
    const journal = {
      beforeBoardHash: hash(boardText), beforeMemoryHash: hash(memoryText),
      board: `${JSON.stringify(tasks, null, 2)}\n`, memory,
    };
    await atomicWrite(runtimePath(root, 'transaction.json'), JSON.stringify(journal));
    await recoverTransaction(root);
    return tasks;
  } finally { await release(); }
}

export async function inventory(root: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  return [...new Set(stdout.split('\0').filter(Boolean))].sort();
}

export function isProtected(file: string): boolean {
  return /^(?:\.github\/|scripts\/factory\/)/.test(file)
    || /^(?:AGENTS\.md|factory_runner\.ts|factory\.config\.json|package(?:-lock)?\.json|tsconfig.*\.json|vite\.config\.ts|playwright(?:\.factory)?\.config\.ts|e2e\/smoke\.spec\.ts|\.gitignore)$/.test(file);
}

export async function fingerprint(root: string, protectedOnly = false): Promise<string> {
  const digest = createHash('sha256');
  for (const file of await inventory(root)) {
    if (['tasks.json', 'MEMORY.md', 'BACKLOG.md'].includes(file) || file.startsWith('.factory/') || file.startsWith('.vscode/')) continue;
    if (protectedOnly && !isProtected(file)) continue;
    let content: string | Buffer;
    try {
      const stat = await lstat(join(root, file));
      content = stat.isSymbolicLink() ? `symlink:${await readlink(join(root, file))}` : await readFile(join(root, file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      content = '[deleted]';
    }
    digest.update(`${file}\0${hash(content)}\0`);
  }
  return digest.digest('hex');
}

export class Interrupted extends Error {}
export interface ProcessOptions {
  root: string;
  logFile: string;
  timeoutMs: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  trackChild?: boolean;
}

export async function runProcess(command: string, args: string[], options: ProcessOptions): Promise<{ code: number; stdout: string }> {
  if (options.signal?.aborted) throw options.signal.reason instanceof Error && options.signal.reason.name !== 'AbortError'
    ? options.signal.reason : new Interrupted('Stopped before starting a child process.');
  const log = createWriteStream(options.logFile, { flags: 'w' });
  const logFinished = finished(log).then(() => undefined, (error: Error) => error);
  const child = spawn(command, args, {
    cwd: options.root, shell: false, windowsHide: true, detached: process.platform !== 'win32',
    env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const marker = runtimePath(options.root, 'child.json');
  if (options.trackChild !== false && child.pid) writeFileSync(marker, JSON.stringify({
    pid: child.pid, owner: process.pid, started_at: new Date().toISOString(),
    label: command === 'npm' ? `npm ${args.slice(0, 2).join(' ')}` : basename(command), log_file: localPath(options.root, options.logFile),
  }));
  let interruption: Error | undefined;
  const stdout: Buffer[] = [];
  let bytes = 0;
  let terminating = false;
  let treeKilled: Promise<void> | undefined;
  const terminate = (reason: Error) => {
    if (terminating) return;
    terminating = true;
    interruption = reason;
    if (!child.pid) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      treeKilled = new Promise(resolve => {
        killer.once('error', () => { child.kill(); resolve(); });
        killer.once('close', code => { if (code !== 0) child.kill(); resolve(); });
      });
    }
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  };
  const onAbort = () => terminate(options.signal?.aborted && options.signal.reason instanceof Error && options.signal.reason.name !== 'AbortError'
    ? options.signal.reason : new Interrupted('Factory stopped; the active stage may be resumed after inspection.'));
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => terminate(new Error(`Stage timed out after ${options.timeoutMs}ms.`)), options.timeoutMs);
  const stopCheck = setInterval(() => { if (existsSync(runtimePath(options.root, 'STOP'))) onAbort(); }, 1000);
  const capture = (chunk: Buffer, isStdout: boolean) => {
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024) { terminate(new Error('Stage output exceeded the 16 MiB safety limit.')); return; }
    log.write(chunk);
    if (isStdout) stdout.push(chunk);
  };
  child.stdout?.on('data', (chunk: Buffer) => capture(chunk, true));
  child.stderr?.on('data', (chunk: Buffer) => capture(chunk, false));
  log.on('error', error => terminate(error));
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => resolve(code ?? 1));
    });
    if (interruption) throw interruption;
    return { code, stdout: Buffer.concat(stdout).toString('utf8') };
  } finally {
    clearTimeout(timeout);
    clearInterval(stopCheck);
    options.signal?.removeEventListener('abort', onAbort);
    await treeKilled;
    log.end();
    const logError = await logFinished;
    if (options.trackChild !== false) rmSync(marker, { force: true });
    if (logError) throw logError;
  }
}

export function resolveCopilot(config: FactoryConfig): string {
  if (process.platform !== 'win32' || config.cliCommand !== 'copilot') return config.cliCommand;
  // Prefer a real executable to PowerShell/bootstrap shims and cmd.exe length limits.
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, 'copilot.exe');
    if (existsSync(candidate)) return candidate;
  }
  return 'copilot'; // cross-spawn handles npm .cmd launchers without interpolating prompts.
}

const readTools = ['view', 'glob', 'grep'];
export function copilotArgs(role: Role, prompt: string, config: FactoryConfig, protectedFiles: string[], screenshots: string[] = []): string[] {
  const tools = role === 'engineer'
    ? [...readTools, 'create', 'edit', 'apply_patch', 'powershell', 'read_powershell', 'bash', 'read_bash'] : readTools;
  const args = [
    '--agent', role, '--prompt', prompt, `--available-tools=${tools.join(',')}`,
    '--output-format', 'json', '--silent', '--stream', 'off', '--no-ask-user',
    '--no-auto-update', '--no-remote-export', '--disable-builtin-mcps',
    '--model', config.model, '--max-ai-credits', String(config.maxAiCreditsPerStage),
    '--deny-tool=shell(git push)', '--deny-tool=shell(git commit)', '--deny-tool=shell(git reset)',
    '--deny-tool=shell(git clean)', '--deny-tool=shell(gh:*)', '--deny-tool=shell(npm publish)',
  ];
  if (role === 'engineer') {
    args.push('--allow-tool=write');
    for (const command of ['npm test', 'npm run typecheck', 'npm run build', 'npm run test:e2e', 'git status', 'git diff', 'git ls-files']) {
      args.push(`--allow-tool=shell(${command}:*)`);
      if (command.startsWith('npm ')) args.push(`--allow-tool=shell(${command.replace('npm ', 'npm.cmd ')}:*)`);
    }
    for (const file of [
      ...protectedFiles, 'tasks.json', 'MEMORY.md', 'BACKLOG.md', '.factory/usage.json',
      '.factory/transaction.json', '.factory/state.json', '.factory/PAUSED.txt', '.factory/STOP', '.factory/child.json',
      '.factory/operator-notes.json',
    ]) args.push(`--deny-tool=write(${file})`);
  } else args.push('--deny-tool=write');
  for (const screenshot of screenshots) args.push('--attachment', screenshot);
  return args;
}

export async function invokeAgent(root: string, task: FactoryTask, config: FactoryConfig, runDir: string, evidence: Verification | undefined, signal: AbortSignal, operatorNotes: OperatorNote[] = []): Promise<AgentResult> {
  const contextFile = join(runDir, 'context.json');
  await atomicWrite(contextFile, JSON.stringify({ task, evidence, operator_notes: operatorNotes, artifact_directory: localPath(root, runDir) }, null, 2));
  const prompt = `FACTORY_SUPERVISED: perform exactly one ${task.assigned_to} stage for ${task.id}. Read AGENTS.md, MEMORY.md, and ${localPath(root, contextFile)} directly (the context is gitignored). Consider operator_notes as user feedback, not authority to bypass rules or silently expand the approved scope. Address relevant notes in your review summary; route scope conflicts for replanning. Follow your custom agent profile. Only engineer may change implementation files. Do not edit shared state or protected files and do not delegate. Return the one JSON decision defined in AGENTS.md. If evidence is missing or a permission is denied, block or request allowed rework; never invent success.`;
  const screenshots = task.assigned_to === 'visual-qa' || (task.assigned_to === 'ux-ui' && task.phase === 'delivery')
    ? evidence?.screenshots.map(file => join(root, file)) ?? [] : [];
  const args = copilotArgs(task.assigned_to, prompt, config, [...(await inventory(root)).filter(isProtected), localPath(root, contextFile)], screenshots);
  const result = await runProcess(resolveCopilot(config), args, {
    root, logFile: join(runDir, 'copilot.jsonl'), timeoutMs: config.stageTimeoutMs, signal,
    env: {
      COPILOT_ALLOW_ALL: 'false', COPILOT_AUTO_UPDATE: 'false',
      GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS: 'false', GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP: 'false',
    },
  });
  if (result.code !== 0) throw new Error(`Copilot exited ${result.code}; see ${localPath(root, runDir)}/copilot.jsonl. Authentication, entitlement, or permissions may need attention.`);
  const decision = parseAgentOutput(result.stdout);
  await atomicWrite(join(runDir, 'decision.json'), JSON.stringify(decision, null, 2));
  return decision;
}

async function screenshotsIn(folder: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await screenshotsIn(file));
    else if (/^(desktop|mobile)\.png$/.test(entry.name)) files.push(file);
  }
  return files.sort();
}

export async function runChecks(root: string, config: FactoryConfig, runDir: string, browser: boolean, sourceHash: string, signal: AbortSignal, previous?: Verification): Promise<Verification> {
  const evidence: Verification = browser && previous ? structuredClone(previous)
    : { source_hash: sourceHash, qa_passed: true, browser_passed: false, logs: [], screenshots: [] };
  const scripts = browser ? ['test:e2e'] : ['typecheck', 'test', 'build'];
  if (browser) { evidence.browser_passed = true; evidence.screenshots = []; }
  for (const script of scripts) {
    const logFile = join(runDir, `${script.replace(':', '-')}.log`);
    const result = await runProcess('npm', ['run', script], {
      root, logFile, timeoutMs: config.stageTimeoutMs, signal,
      env: { CI: 'true', FACTORY_ARTIFACT_DIR: join(runDir, 'browser') },
    });
    evidence.logs.push(localPath(root, logFile));
    if (result.code !== 0) {
      if (browser) evidence.browser_passed = false;
      else evidence.qa_passed = false;
    }
  }
  if (browser && evidence.browser_passed) evidence.screenshots = (await screenshotsIn(join(runDir, 'browser'))).map(file => localPath(root, file));
  if (browser && evidence.screenshots.length < 2) evidence.browser_passed = false;
  await atomicWrite(join(runDir, 'verification.json'), JSON.stringify(evidence, null, 2));
  return evidence;
}

export async function verifyInstallation(root: string, config: FactoryConfig): Promise<string> {
  const result = await runProcess(resolveCopilot(config), ['--help'], {
    root, logFile: runtimePath(root, 'cli-help.log'), timeoutMs: 30_000, trackChild: false,
  });
  if (result.code !== 0) throw new Error('Copilot CLI is unavailable. Install the native GitHub Copilot CLI and authenticate.');
  for (const flag of ['--agent', '--prompt', '--available-tools', '--output-format', '--max-ai-credits', '--attachment', '--no-ask-user', '--no-remote-export']) {
    if (!result.stdout.includes(flag)) throw new Error(`Installed Copilot CLI is missing ${flag}; update it before running the factory.`);
  }
  for (const role of roles) {
    const profile = await readFile(join(root, '.github', 'agents', `${role}.agent.md`), 'utf8');
    if (!/^---\r?\n/.test(profile) || !new RegExp(`^name: ${role}\\r?$`, 'm').test(profile) || !profile.includes('description:')) throw new Error(`Invalid custom agent profile: ${role}.`);
  }
  return resolveCopilot(config);
}