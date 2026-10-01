import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { runtimePath } from './runtime';

/** Launch only the known local supervisor, never a browser-provided command. */
export async function startWorker(root: string): Promise<number> {
  const output = openSync(runtimePath(root, 'runner.log'), 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', join(root, 'factory_runner.ts'), 'watch'], {
    cwd: root, detached: true, windowsHide: true, stdio: ['ignore', output, output, 'ipc'],
  });
  closeSync(output);
  return new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Factory startup timed out; inspect the local runner log.')); }, 40_000);
    child.on('message', message => {
      if (typeof message !== 'object' || message === null || (message as { ready?: unknown }).ready !== true || !child.pid) return;
      clearTimeout(timeout);
      child.unref();
      resolve(child.pid);
    });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Factory exited before startup (${code}); inspect the local runner log.`)); });
  });
}