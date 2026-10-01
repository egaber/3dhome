import { cursorTo, clearScreenDown } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { displayText, getSnapshot } from './status';
import type { FactorySnapshot } from './status';

export function formatLive(snapshot: FactorySnapshot, columns = 100, rows = 34): string {
  const clip = (text: string) => { const clean = displayText(text).replace(/\r?\n/g, ' '); return Array.from(clean).slice(0, Math.max(25, columns - 2)).join(''); };
  const active = snapshot.tasks.find(task => task.status === 'In_Progress');
  const state = snapshot.worker;
  const elapsed = state.active_process?.started_at ? Math.max(0, Math.floor((Date.now() - Date.parse(state.active_process.started_at)) / 1000)) : 0;
  const lines = [
    `LOCAL SOFTWARE FACTORY / ${snapshot.project}                         ${new Date(snapshot.generated_at).toLocaleTimeString()}`,
    `Worker: ${state.state.toUpperCase()}${state.pid ? ` | PID ${state.pid}` : ''} | AI calls today: ${snapshot.calls_today}/${snapshot.limits.maxAgentRunsPerDay}`,
    'Refresh: 1s | Ctrl+C closes this monitor only | Web: http://127.0.0.1:4318',
    state.pause_reason ? `Pause reason: ${state.pause_reason}` : '',
    active ? `ACTIVE ${active.id} / ${active.assigned_to} / ${active.phase} | Stage ${active.step_count}/${snapshot.limits.maxStepsPerTask} | Repairs ${active.retry_count}/${Math.min(active.max_retries, snapshot.limits.maxRetries)}` : 'No active task. Waiting for enabled backlog work.',
    active?.title ?? '',
    state.active_process ? `Now: ${state.active_process.label} (${elapsed}s)` : 'No agent/check subprocess is running.',
    '', 'TASK BOARD',
    ...snapshot.tasks.slice(0, Math.max(3, Math.min(10, rows - 22))).map(task => `${task.id.padEnd(10)} ${task.status.padEnd(12)} ${task.assigned_to.padEnd(10)} ${task.enabled ? 'on ' : 'off'}  ${task.title}`),
    ...(snapshot.tasks.length > 10 ? [`... ${snapshot.tasks.length - 10} more tasks in the web dashboard`] : []),
    '', 'LIVE ACTIVITY (public tool progress, not private reasoning)',
    ...snapshot.activity.slice(-5).map(event => `${event.at ? new Date(event.at).toLocaleTimeString() : '        '} ${event.level === 'error' ? '! ' : '  '}${event.text}`),
    '', 'LATEST REVIEW', active?.history.at(-1)?.summary ?? 'No completed review for the active task.',
    '', `OPERATOR NOTES: ${snapshot.notes.length} | Add notes and edit queued tasks in the web dashboard.`,
  ];
  return lines.slice(0, Math.max(10, rows - 1)).map(clip).join('\n');
}

export async function liveStatus(root: string): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const tty = !!process.stdout.isTTY;
  if (tty) process.stdout.write('\x1b[?1049h\x1b[?25l');
  let previous = '';
  try {
    while (!controller.signal.aborted) {
      let text: string;
      try { text = formatLive(await getSnapshot(root), process.stdout.columns, process.stdout.rows); }
      catch (error) { text = `Unable to read factory status: ${displayText(error instanceof Error ? error.message : String(error))}\nRetrying; Ctrl+C closes only the monitor.`; }
      if (tty) { cursorTo(process.stdout, 0, 0); clearScreenDown(process.stdout); process.stdout.write(text); }
      else {
        const comparable = text.split('\n').slice(1).join('\n');
        if (comparable !== previous) { console.log(text); previous = comparable; }
      }
      try { await delay(1000, undefined, { signal: controller.signal }); } catch { break; }
    }
  } finally {
    if (tty) process.stdout.write('\x1b[?25h\x1b[?1049l');
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}