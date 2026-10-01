import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { z } from 'zod';
import { addNote } from './notes';
import { controlWorker, createTask, editTask, moveTask, OperatorError, replanTask } from './operator';
import { getSnapshot, resolveRunFile } from './status';
import { readBoard } from './runtime';

interface ServerOptions { root: string; port?: number; intervalMs?: number }

async function bodyJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new OperatorError('Use application/json.', 415);
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 128 * 1024) throw new OperatorError('Request body is too large.', 413);
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new OperatorError('Invalid JSON body.', 400); }
}

export async function startDashboard({ root, port = 4318, intervalMs = 1000 }: ServerOptions) {
  const csrfToken = randomBytes(32).toString('hex');
  const nonce = randomBytes(24).toString('base64');
  const html = (await readFile(new URL('./dashboard.html', import.meta.url), 'utf8')).replaceAll('__CSP_NONCE__', nonce);
  const client = transpileModule(await readFile(new URL('./dashboard.client.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  const streams = new Set<ServerResponse>();
  let origin = '';
  let host = '';
  let closed = false;
  let refreshing = false;
  const json = (response: ServerResponse, value: unknown, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  };
  const send = (response: ServerResponse, event: string, value: unknown) => {
    if (response.writableLength > 1024 * 1024 || response.destroyed) { streams.delete(response); response.destroy(); return; }
    response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
  };

  const server = createServer({ requestTimeout: 10_000, headersTimeout: 10_000, maxHeaderSize: 16 * 1024 }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    try {
      // Exact Host validation blocks DNS rebinding. No CORS or LAN listener is enabled.
      if (request.headers.host !== host || (request.headers.origin && request.headers.origin !== origin)
        || request.headers['sec-fetch-site'] === 'cross-site') throw new OperatorError('Only this dashboard origin is allowed.', 403);
      const url = new URL(request.url ?? '/', origin);
      const method = request.method ?? 'GET';
      if (method === 'GET') {
        if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return; }
        if (url.pathname === '/client.js') { response.setHeader('Content-Type', 'text/javascript; charset=utf-8'); response.end(client); return; }
        if (url.pathname === '/api/session') { json(response, { csrf_token: csrfToken }); return; }
        if (url.pathname === '/api/status') { json(response, await getSnapshot(root)); return; }
        if (url.pathname === '/api/events') {
          if (streams.size >= 20) throw new OperatorError('Too many live dashboard connections.', 429);
          const snapshot = await getSnapshot(root);
          response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
          streams.add(response);
          response.on('close', () => streams.delete(response));
          send(response, 'snapshot', snapshot);
          return;
        }
        if (url.pathname === '/api/artifact') {
          const path = url.searchParams.get('path') ?? '';
          const allowed = (await readBoard(root)).flatMap(task => [...task.verification?.logs ?? [], ...task.verification?.screenshots ?? []]);
          if (!allowed.includes(path) || !['.log', '.png'].includes(extname(path))) throw new OperatorError('Only recorded log and screenshot evidence can be opened.', 403);
          let file: string;
          try { file = await resolveRunFile(root, path); } catch { throw new OperatorError('Artifact is unavailable or outside the evidence directory.', 403); }
          if ((await stat(file)).size > 16 * 1024 * 1024) throw new OperatorError('Artifact is too large for the dashboard.', 413);
          response.setHeader('Content-Type', path.endsWith('.png') ? 'image/png' : 'text/plain; charset=utf-8');
          response.end(await readFile(file));
          return;
        }
        throw new OperatorError('Not found.', 404);
      }
      if (!['POST', 'PATCH'].includes(method)) throw new OperatorError('Method not allowed.', 405);
      if (request.headers.origin !== origin || request.headers['x-factory-token'] !== csrfToken) throw new OperatorError('Missing or invalid local dashboard session. Reload the page.', 403);
      const input = await bodyJson(request);
      if (method === 'POST' && url.pathname === '/api/control') { json(response, { message: await controlWorker(root, input) }); return; }
      if (method === 'POST' && url.pathname === '/api/tasks') { json(response, { task: await createTask(root, input) }, 201); return; }
      if (method === 'POST' && url.pathname === '/api/notes') { json(response, { note: await addNote(root, input) }, 201); return; }
      const match = /^\/api\/tasks\/([A-Z][A-Z0-9]*-\d+)(?:\/(move|replan|retry))?$/.exec(url.pathname);
      if (match) {
        const [, id, action] = match;
        if (method === 'PATCH' && !action) await editTask(root, id, input);
        else if (method === 'POST' && action === 'move') await moveTask(root, id, input);
        else if (method === 'POST' && (action === 'replan' || action === 'retry')) await replanTask(root, id, input, action === 'retry');
        else throw new OperatorError('Method not allowed.', 405);
        json(response, { message: 'Saved.' });
        return;
      }
      throw new OperatorError('Not found.', 404);
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      const status = error instanceof OperatorError ? error.status : error instanceof z.ZodError ? 400 : 500;
      const message = error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.') || 'data'}: ${issue.message}`).join('; ')
        : error instanceof OperatorError ? error.message : 'The operation could not be completed. Check the local state/logs; no success is assumed.';
      json(response, { error: message }, status);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { reject(new Error('Unable to determine dashboard port.')); return; }
      host = `127.0.0.1:${address.port}`;
      origin = `http://${host}`;
      resolve();
    });
  });
  const timer = setInterval(() => {
    if (refreshing || !streams.size || closed) return;
    refreshing = true;
    void getSnapshot(root).then(snapshot => { for (const stream of streams) send(stream, 'snapshot', snapshot); })
      .catch(() => { for (const stream of streams) send(stream, 'unavailable', { message: 'Factory state is temporarily unavailable. Writes are disabled until it recovers.' }); })
      .finally(() => { refreshing = false; });
  }, intervalMs);
  return {
    server, origin,
    close: async () => {
      closed = true;
      clearInterval(timer);
      for (const stream of streams) stream.end();
      streams.clear();
      await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    },
  };
}

export async function serveDashboard(root: string, port = 4318): Promise<void> {
  const dashboard = await startDashboard({ root, port });
  console.log(`Factory dashboard ready: ${dashboard.origin}\nLive updates every second. Closing this server does not stop the factory worker.`);
  await new Promise<void>(resolve => {
    const stop = () => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); resolve(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await dashboard.close();
}