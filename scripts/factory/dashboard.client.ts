import type { FactorySnapshot } from './status';

type TaskView = FactorySnapshot['tasks'][number];
const element = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing dashboard element: ${id}`);
  return found as T;
};
const input = (id: string) => element<HTMLInputElement>(id);
const value = (id: string) => element<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id).value;
const text = (id: string, content: string) => { element(id).textContent = content; };
const lines = (raw: string) => raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const create = <K extends keyof HTMLElementTagNameMap>(tag: K, content?: string, className?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
};
const time = (at?: string) => at ? new Date(at).toLocaleTimeString() : '';
const statusLabel = (status: string) => status.replaceAll('_', ' ');
let snapshot: FactorySnapshot | undefined;
let selectedId = '';
let formVersion = '';
let dirty = false;
let connected = false;
let sessionReady = false;
let freshSnapshot = false;
let busy = false;
let token = '';
let queueKey = '';
let detailKey = '';
let notesKey = '';
let activityKey = '';

const selected = () => snapshot?.tasks.find(task => task.id === selectedId);
function feedback(message: string, error = false): void {
  const target = error ? 'error' : 'message';
  text(target, message);
  element(target).hidden = !message;
  element(error ? 'message' : 'error').hidden = true;
}

async function request<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(path, body === undefined ? { cache: 'no-store' } : {
    method, headers: { 'Content-Type': 'application/json', 'X-Factory-Token': token }, body: JSON.stringify(body),
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
  return result;
}

async function refresh(): Promise<void> { applySnapshot(await request<FactorySnapshot>('/api/status')); }
async function action(operation: () => Promise<void>): Promise<void> {
  if (!connected || busy) return;
  busy = true;
  controls();
  try { await operation(); await refresh(); }
  catch (error) { feedback(error instanceof Error ? error.message : String(error), true); }
  finally { busy = false; controls(); }
}

function controls(): void {
  const locked = busy || !connected;
  const task = selected();
  const worker = snapshot?.worker;
  const editable = !!task && ['Todo', 'Blocked'].includes(task.status);
  for (const id of ['new-task', 'create-submit']) element<HTMLButtonElement>(id).disabled = locked;
  element<HTMLButtonElement>('start-worker').disabled = locked || !!worker?.running;
  element<HTMLButtonElement>('pause-worker').disabled = locked || !worker?.running || ['paused', 'pausing', 'stopping'].includes(worker.state);
  element<HTMLButtonElement>('resume-worker').disabled = locked || !worker?.pause_reason;
  element<HTMLButtonElement>('stop-worker').disabled = locked || !worker?.running || worker.state === 'stopping';
  element<HTMLFieldSetElement>('edit-fields').disabled = locked || !editable;
  element<HTMLButtonElement>('save-task').disabled = locked || !editable || !dirty || task.version !== formVersion;
  element<HTMLButtonElement>('reload-task').disabled = !task || locked;
  for (const id of ['move-up', 'move-down']) element<HTMLButtonElement>(id).disabled = locked || task?.status !== 'Todo';
  element<HTMLButtonElement>('replan').disabled = locked || task?.status !== 'In_Progress' || !!worker?.running;
  element<HTMLButtonElement>('retry').disabled = locked || task?.status !== 'Blocked' || !!worker?.running;
  element<HTMLButtonElement>('send-note').disabled = locked || (value('note-target') === 'task' && !task);
  element('draft-warning').hidden = !dirty || !task || task.version === formVersion;
  text('draft-state', dirty ? 'Unsaved draft' : 'No unsaved changes');
}

function hydrate(task: TaskView): void {
  input('edit-title').value = task.title;
  element<HTMLTextAreaElement>('edit-description').value = task.description;
  element<HTMLSelectElement>('edit-kind').value = task.kind;
  input('edit-retries').value = String(task.max_retries);
  input('edit-retries').max = String(snapshot?.limits.maxRetries ?? 3);
  element<HTMLTextAreaElement>('edit-criteria').value = task.acceptance_criteria.join('\n');
  input('edit-dependencies').value = task.depends_on.join(', ');
  input('edit-enabled').checked = task.enabled;
  formVersion = task.version;
  dirty = false;
}

function selectTask(id: string): void {
  if (id === selectedId) return;
  if ((dirty || value('note-text').trim()) && !confirm('Switch task and discard unsaved task edits and note text?')) return;
  selectedId = id;
  dirty = false;
  formVersion = '';
  element<HTMLTextAreaElement>('note-text').value = '';
  queueKey = detailKey = notesKey = '';
  if (snapshot) render(snapshot);
}

function renderQueue(data: FactorySnapshot): void {
  const query = value('search').toLocaleLowerCase();
  const filter = value('filter');
  const key = `${data.board_version}|${selectedId}|${query}|${filter}`;
  if (queueKey === key) return;
  queueKey = key;
  const items = data.tasks.filter(task => `${task.id} ${task.title} ${task.assigned_to}`.toLocaleLowerCase().includes(query)
    && (filter === 'all' || (filter === 'enabled' ? task.enabled : task.status === filter)));
  const nodes = items.map(task => {
    const button = create('button', undefined, 'task-card');
    button.type = 'button';
    button.dataset.taskId = task.id;
    button.setAttribute('aria-pressed', String(task.id === selectedId));
    const meta = create('span', undefined, 'task-meta');
    meta.append(create('span', task.id), create('span', statusLabel(task.status), `badge ${task.status === 'In_Progress' ? 'active' : task.status === 'Blocked' ? 'error' : task.status === 'Done' ? 'success' : ''}`));
    const title = create('span', task.title, 'task-title');
    title.dir = 'auto';
    button.append(meta, title, create('span', `${task.assigned_to} · ${task.enabled ? 'Enabled' : 'Disabled draft'}`, 'hint'));
    button.addEventListener('click', () => selectTask(task.id));
    return button;
  });
  element('task-list').replaceChildren(...(nodes.length ? nodes : [create('p', 'No matching tasks.', 'empty')]));
}

function renderDetail(): void {
  const task = selected();
  if (!task) return;
  if (!dirty && formVersion !== task.version) hydrate(task);
  if (detailKey === `${task.id}:${task.version}`) return;
  detailKey = `${task.id}:${task.version}`;
  text('selected-meta', `${task.id} / ${task.kind} / ${task.assigned_to}`);
  text('selected-status', statusLabel(task.status));
  text('selected-title', task.title);
  text('description', task.description);
  text('contract', task.contract || 'No architectural contract yet.');
  element('criteria').replaceChildren(...(task.acceptance_criteria.length ? task.acceptance_criteria.map(item => create('li', item)) : [create('li', 'The PM has not defined acceptance criteria yet.', 'muted')]));
  const history = task.history.slice(-12).map(entry => {
    const item = create('li');
    item.append(create('small', `${new Date(entry.at).toLocaleString()} · ${entry.agent} · ${entry.outcome}`), create('p', entry.summary));
    return item;
  });
  if (task.last_error) { const issue = create('li'); issue.append(create('strong', 'Latest issue', 'error'), create('p', task.last_error)); history.push(issue); }
  element('history').replaceChildren(...(history.length ? history : [create('li', 'No completed stage yet.', 'muted')]));
  const evidence = element('evidence');
  evidence.replaceChildren();
  if (!task.verification) { evidence.append(create('p', 'No executable evidence recorded yet.', 'empty')); return; }
  evidence.append(create('p', `Unit / type / build: ${task.verification.qa_passed ? 'Passed' : 'Not passed'} · Browser: ${task.verification.browser_passed ? 'Passed' : 'Not passed'}`));
  evidence.append(create('p', `Source: ${task.verification.source_hash.slice(0, 12)}`, 'hint'));
  const links = create('div', undefined, 'actions detail-block');
  for (const file of task.verification.logs) {
    const link = create('a', file.split('/').at(-1));
    link.href = `/api/artifact?path=${encodeURIComponent(file)}`;
    link.target = '_blank'; link.rel = 'noopener'; links.append(link);
  }
  const images = create('div', undefined, 'artifact-grid');
  for (const file of task.verification.screenshots) {
    const link = create('a'); link.href = `/api/artifact?path=${encodeURIComponent(file)}`; link.target = '_blank'; link.rel = 'noopener';
    const image = create('img'); image.src = link.href; image.alt = `Verification screenshot: ${file.split('/').at(-1)}`; image.loading = 'lazy'; link.append(image); images.append(link);
  }
  evidence.append(links, images);
}

const stages = [
  ['pm', 'plan', 'PM'], ['architect', 'plan', 'Architect'], ['ux-ui', 'plan', 'UX design'], ['skeptic', 'plan', 'Skeptic'],
  ['team-lead', 'plan', 'Plan approval'], ['engineer', 'plan', 'Engineer'], ['qa', 'delivery', 'QA'],
  ['visual-qa', 'delivery', 'Visual QA'], ['ux-ui', 'delivery', 'UX validation'], ['team-lead', 'delivery', 'Finish review'],
];
function render(data: FactorySnapshot): void {
  const active = data.tasks.find(task => task.status === 'In_Progress');
  text('project', `${data.project} · Native Copilot agents · Live local control`);
  text('worker-state', statusLabel(data.worker.state));
  text('heartbeat', data.worker.heartbeat ? `Heartbeat ${time(data.worker.heartbeat)}` : 'Worker has not started');
  text('active-role', active?.assigned_to ?? 'Idle');
  text('active-progress', active ? `${active.id} · Stage ${active.step_count}/${data.limits.maxStepsPerTask} · ${active.phase}` : 'Waiting for enabled tasks');
  text('repairs', active ? `${active.retry_count} / ${Math.min(active.max_retries, data.limits.maxRetries)}` : `0 / ${data.limits.maxRetries}`);
  text('daily-calls', `${data.calls_today} / ${data.limits.maxAgentRunsPerDay}`);
  text('credit-limit', `${data.limits.maxAiCreditsPerStage} credits / stage · soft limit`);
  const seconds = data.worker.active_process?.started_at ? Math.max(0, Math.floor((Date.now() - Date.parse(data.worker.active_process.started_at)) / 1000)) : 0;
  text('process', data.worker.active_process ? `${data.worker.active_process.label} · ${seconds}s elapsed` : 'No agent/check subprocess is running');
  text('pause-reason', data.worker.pause_reason);
  element('pause-reason').hidden = !data.worker.pause_reason;
  element('pipeline').replaceChildren(...stages.map(([role, phase, label], index) => {
    const current = active?.assigned_to === role && (active.phase === phase || role === 'engineer');
    const item = create('li', `${index + 1}. ${label}`, current ? 'current' : '');
    if (current) item.setAttribute('aria-current', 'step');
    return item;
  }));
  renderQueue(data);
  renderDetail();
  const notes = data.notes.filter(note => note.task_id === null || note.task_id === selectedId);
  const currentNotesKey = JSON.stringify(notes);
  if (notesKey !== currentNotesKey) {
    notesKey = currentNotesKey;
    element('notes').replaceChildren(...(notes.length ? notes.slice(-30).reverse().map(note => {
      const item = create('li');
      const body = create('p', note.text); body.dir = 'auto';
      item.append(create('small', `${new Date(note.at).toLocaleString()} · ${note.task_id ?? 'All tasks'} · Operator`), body);
      return item;
    }) : [create('li', 'No notes yet. Add context for the next stage.', 'empty')]));
  }
  const currentActivityKey = JSON.stringify(data.activity);
  if (activityKey !== currentActivityKey) {
    activityKey = currentActivityKey;
    element('activity').replaceChildren(...(data.activity.length ? data.activity.slice(-12).reverse().map(event => {
      const item = create('li'); item.append(create('small', time(event.at)), create('p', event.text, event.level === 'error' ? 'error' : '')); return item;
    }) : [create('li', 'Activity appears when a stage starts.', 'empty')]));
  }
  text('latest-run', data.latest_run ? `Run: ${data.latest_run}` : 'No active run artifacts');
  controls();
}

function applySnapshot(data: FactorySnapshot): void {
  snapshot = data;
  freshSnapshot = true;
  connected = sessionReady;
  text('connection', connected ? `● Live · ${time(data.generated_at)}` : 'Reconnecting session…');
  element('connection').className = connected ? 'badge success' : 'badge';
  if (!selectedId) selectedId = data.tasks.find(task => task.status === 'In_Progress')?.id ?? data.tasks[0]?.id ?? '';
  render(data);
}

element('theme').addEventListener('click', () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; });
for (const id of ['search', 'filter']) element(id).addEventListener('input', () => { if (snapshot) renderQueue(snapshot); });
element('edit-form').addEventListener('input', () => { dirty = true; controls(); });
element('reload-task').addEventListener('click', () => { const task = selected(); if (task && (!dirty || confirm('Discard your unsaved draft and reload the task?'))) { hydrate(task); controls(); } });
element('edit-form').addEventListener('submit', event => {
  event.preventDefault();
  void action(async () => {
    if (!selected()) return;
    await request(`/api/tasks/${selectedId}`, { expected_version: formVersion, changes: {
      title: value('edit-title'), description: value('edit-description'), kind: value('edit-kind'),
      max_retries: Number(value('edit-retries')), enabled: input('edit-enabled').checked,
      acceptance_criteria: lines(value('edit-criteria')), depends_on: value('edit-dependencies').split(',').map(id => id.trim()).filter(Boolean),
    } }, 'PATCH');
    dirty = false; feedback('Task changes saved.');
  });
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-control]')) button.addEventListener('click', () => {
  const command = button.dataset.control;
  if ((command === 'stop' || command === 'start' || command === 'resume') && !confirm(command === 'stop' ? 'Stop the current worker? Partial code changes will be preserved.' : 'Allow the worker to process enabled tasks using Copilot quota?')) return;
  void action(async () => { const response = await request<{ message: string }>('/api/control', { action: command }); feedback(response.message); });
});
for (const direction of ['up', 'down'] as const) element(`move-${direction}`).addEventListener('click', () => void action(async () => {
  await request(`/api/tasks/${selectedId}/move`, { expected_board_version: snapshot?.board_version, direction }); feedback(`Task moved ${direction}.`);
}));
for (const command of ['replan', 'retry']) element(command).addEventListener('click', () => {
  if (!confirm(command === 'retry' ? 'Confirm the blocked task has been reviewed. Clear old approvals and reset its repair/stage budgets?' : 'Return this task to PM planning and clear old approvals/evidence? This consumes one repair.')) return;
  void action(async () => { await request(`/api/tasks/${selectedId}/${command}`, { expected_version: selected()?.version }); feedback('Task returned to the planning queue.'); });
});

element('note-target').addEventListener('change', controls);
element('note-form').addEventListener('submit', event => {
  event.preventDefault();
  const draft = value('note-text');
  const target = value('note-target') === 'all' ? null : selectedId;
  void action(async () => {
    await request('/api/notes', { id: crypto.randomUUID(), task_id: target, text: draft });
    if (value('note-text') === draft) element<HTMLTextAreaElement>('note-text').value = '';
    feedback('Note saved for upcoming stages. It does not interrupt the active agent.');
  });
});
element('new-task').addEventListener('click', () => element<HTMLDialogElement>('create-dialog').showModal());
element('close-create').addEventListener('click', () => element<HTMLDialogElement>('create-dialog').close());
element('create-form').addEventListener('submit', event => {
  event.preventDefault();
  if ((dirty || value('note-text').trim()) && !confirm('Creating a task will select it. Discard your unsaved task edits and note text?')) return;
  void action(async () => {
    try {
      const response = await request<{ task: TaskView }>('/api/tasks', {
        title: value('create-title'), description: value('create-description'), kind: value('create-kind'),
        enabled: input('create-enabled').checked, acceptance_criteria: lines(value('create-criteria')),
      });
      dirty = false; formVersion = ''; selectedId = response.task.id;
      element<HTMLTextAreaElement>('note-text').value = '';
      element<HTMLDialogElement>('create-dialog').close(); element<HTMLFormElement>('create-form').reset();
      element('create-error').hidden = true; feedback(`Created ${response.task.id}${response.task.enabled ? ' and enabled automation' : ' as a disabled draft'}.`);
    } catch (error) { text('create-error', error instanceof Error ? error.message : String(error)); element('create-error').hidden = false; throw error; }
  });
});
window.addEventListener('beforeunload', event => { if (dirty || value('note-text').trim()) { event.preventDefault(); event.returnValue = ''; } });

async function connect(): Promise<void> {
  token = (await request<{ csrf_token: string }>('/api/session')).csrf_token;
  sessionReady = true;
  await refresh();
  const events = new EventSource('/api/events');
  const unavailable = () => {
    connected = false; sessionReady = false; freshSnapshot = false;
    text('connection', 'Disconnected · reconnecting…'); element('connection').className = 'badge error'; controls();
  };
  events.addEventListener('open', () => {
    connected = false; sessionReady = false; controls();
    void request<{ csrf_token: string }>('/api/session').then(session => {
      token = session.csrf_token; sessionReady = true;
      if (freshSnapshot && snapshot) applySnapshot(snapshot);
    }).catch(unavailable);
  });
  events.addEventListener('snapshot', event => applySnapshot(JSON.parse((event as MessageEvent<string>).data) as FactorySnapshot));
  events.addEventListener('unavailable', () => {
    connected = false; freshSnapshot = false;
    text('connection', 'State unavailable · retrying…'); element('connection').className = 'badge error'; controls();
  });
  events.onerror = unavailable;
}
controls();
void connect().catch(error => { feedback(error instanceof Error ? error.message : String(error), true); text('connection', 'Connection failed · reload to retry'); });