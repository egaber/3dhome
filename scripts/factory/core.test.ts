import { describe, expect, it } from 'vitest';
import { applyResult, beginStep, boardSchema, configSchema, newTask, parseAgentOutput, selectTask, taskSchema } from './core';
import type { AgentResult, FactoryTask, Role, Verification } from './core';

const config = configSchema.parse({});
const fresh = () => newTask([], 'A real, bounded feature', 3);
const decision = (task: FactoryTask, next: Role, extra: Partial<AgentResult> = {}): AgentResult => ({
  task_id: task.id, outcome: 'handoff', next_agent: next, summary: 'Evidence-based review.', followups: [], ...extra,
});
const proof: Verification = { source_hash: 'verified-source', qa_passed: true, browser_passed: true, logs: ['unit.log'], screenshots: ['desktop.png', 'mobile.png'] };

function prepared(): FactoryTask {
  return taskSchema.parse({ ...fresh(), status: 'In_Progress', assigned_to: 'engineer', contract: 'Approved TypeScript interface.', approvals: ['ux-design', 'skeptic', 'plan'] });
}

describe('factory board validation and scheduling', () => {
  it('rejects malformed boards, duplicate IDs, unknown dependencies, and cycles', () => {
    expect(() => boardSchema.parse({ tasks: [] })).toThrow();
    expect(() => boardSchema.parse([fresh(), fresh()])).toThrow('unique');
    expect(() => boardSchema.parse([{ ...fresh(), retry_count: -1 }])).toThrow();
    expect(() => boardSchema.parse([{ ...fresh(), depends_on: ['TASK-404'] }])).toThrow('Unknown dependency');
    expect(() => boardSchema.parse([{ ...fresh(), depends_on: ['TASK-001'] }])).toThrow('cycle');
    expect(() => boardSchema.parse([{ ...fresh(), assigned_to: 'qa' }])).toThrow('assigned to pm');
    expect(() => boardSchema.parse([prepared(), { ...prepared(), id: 'TASK-002' }])).toThrow('Only one');
  });

  it('selects the first enabled dependency-ready Todo, preferring resumable work', () => {
    const disabled = { ...fresh(), enabled: false };
    const ready = { ...fresh(), id: 'TASK-002' };
    expect(selectTask([disabled, ready])?.id).toBe('TASK-002');
    expect(selectTask([disabled])).toBeUndefined();
    expect(selectTask([{ ...ready, depends_on: [disabled.id] }, disabled])).toBeUndefined();
    expect(selectTask([{ ...ready, depends_on: [disabled.id] }, { ...disabled, status: 'Done' }])?.id).toBe(ready.id);
    expect(selectTask([ready, prepared()])?.assigned_to).toBe('engineer');
    expect(selectTask([ready, { ...prepared(), enabled: false }])).toBeUndefined();
  });

  it('validates budgets and assigns collision-free task IDs', () => {
    expect(() => configSchema.parse({ pollIntervalMs: 0 })).toThrow();
    expect(() => configSchema.parse({ maxAiCreditsPerStage: 1 })).toThrow();
    expect(newTask([{ ...fresh(), id: 'TASK-009' }], 'Next', 3).id).toBe('TASK-010');
    expect(beginStep({ ...fresh(), step_count: 32 }, config).status).toBe('Blocked');
  });
});

describe('supervised review graph', () => {
  it('runs all eight roles and both UX/team-lead phases before Done', () => {
    let task = beginStep(fresh(), config);
    const move = (next: Role, extra: Partial<AgentResult> = {}, evidence?: Verification) => {
      task = applyResult([task], task.id, decision(task, next, extra), config, evidence)[0];
    };
    move('architect', { acceptance_criteria: ['Valid input works; invalid input is rejected.'] });
    move('ux-ui', { contract: 'TypeScript folder layout, validation contracts, and tests.' });
    move('skeptic');
    move('team-lead');
    move('engineer');
    move('qa');
    expect(task.phase).toBe('delivery');
    move('visual-qa', {}, { ...proof, browser_passed: false, screenshots: [] });
    move('ux-ui', {}, proof);
    move('team-lead');
    task = applyResult([task], task.id, decision(task, 'team-lead', { outcome: 'done' }), config, proof)[0];
    expect(task.status).toBe('Done');
    expect(task.history.map(item => item.agent)).toEqual(['pm', 'architect', 'ux-ui', 'skeptic', 'team-lead', 'engineer', 'qa', 'visual-qa', 'ux-ui', 'team-lead']);
  });

  it('rejects skipped approvals, fabricated QA, stale final evidence, and incorrect task IDs', () => {
    const task = beginStep(fresh(), config);
    expect(() => applyResult([task], task.id, decision(task, 'engineer'), config)).toThrow('Expected pm');
    expect(() => applyResult([task], task.id, decision(task, 'architect', { task_id: 'TASK-404' }), config)).toThrow('wrong task');
    expect(() => applyResult([task], task.id, decision(task, 'architect'), config)).toThrow('acceptance');
    const unapproved = { ...task, assigned_to: 'engineer' as const };
    expect(() => applyResult([unapproved], task.id, decision(task, 'qa'), config)).toThrow('approved contract');
    const qa = { ...prepared(), assigned_to: 'qa' as const, phase: 'delivery' as const };
    expect(() => applyResult([qa], qa.id, decision(qa, 'visual-qa'), config)).toThrow('failed or missing');
    const final = taskSchema.parse({ ...qa, assigned_to: 'team-lead', verification: proof, approvals: ['ux-design', 'skeptic', 'plan', 'qa', 'visual', 'ux-validation'] });
    expect(() => applyResult([final], final.id, decision(final, 'team-lead', { outcome: 'done' }), config, { ...proof, source_hash: 'different' })).toThrow('stale');
    expect(() => applyResult([final], final.id, decision(final, 'team-lead', { outcome: 'done' }), config, { ...proof, screenshots: [] })).toThrow('screenshot');
  });

  it('allows exactly three repairs, then blocks without resetting the counter', () => {
    let task = { ...prepared(), assigned_to: 'qa' as const } as FactoryTask;
    for (let retry = 1; retry <= 3; retry++) {
      task = applyResult([task], task.id, decision(task, 'engineer', { outcome: 'revise' }), config)[0];
      expect(task.retry_count).toBe(retry);
      expect(task.status).toBe('In_Progress');
      task.assigned_to = 'qa';
    }
    task = applyResult([task], task.id, decision(task, 'engineer', { outcome: 'revise' }), config)[0];
    expect(task.status).toBe('Blocked');
    expect(task.retry_count).toBe(3);
  });

  it('invalidates design and delivery approvals on backward routes', () => {
    const task = { ...prepared(), assigned_to: 'visual-qa' as const, phase: 'delivery' as const, verification: proof };
    const reroute = applyResult([task], task.id, decision(task, 'ux-ui', { outcome: 'revise' }), config)[0];
    expect(reroute.phase).toBe('plan');
    expect(reroute.approvals).toEqual([]);
    expect(reroute.verification).toBeUndefined();
    expect(() => applyResult([task], task.id, decision(task, 'pm', { outcome: 'revise' }), config)).toThrow('Invalid rework route');
  });

  it('caps descendants across generations and deduplicates followups', () => {
    const task = prepared();
    const followup = { title: 'Independent issue', description: 'Nonblocking finding.', kind: 'issue' as const, acceptance_criteria: ['Reproduce and fix.'] };
    let board = applyResult([task], task.id, decision(task, 'qa', { followups: [followup, followup] }), config);
    expect(board).toHaveLength(2);
    expect(board[1].root_id).toBe(task.id);
    board = [{ ...board[0], status: 'Done' }, { ...board[1], status: 'In_Progress', assigned_to: 'pm' }];
    expect(() => applyResult(board, board[1].id, decision(board[1], 'architect', {
      acceptance_criteria: ['Testable'], followups: [{ ...followup, title: 'Grandchild' }],
    }), { ...config, maxFollowUpsPerRoot: 1 })).toThrow('Follow-up budget');
  });
});

describe('native CLI decision parsing', () => {
  const response: AgentResult = { task_id: 'TASK-001', outcome: 'blocked', summary: 'No supported backend.', followups: [] };
  const message = (content: string) => JSON.stringify({ type: 'assistant.message', data: { content } });
  const result = JSON.stringify({ type: 'result', exitCode: 0 });
  it('reads the final assistant JSON rather than tool output or earlier messages', () => {
    expect(parseAgentOutput([message('Earlier commentary'), 'not JSON', message(JSON.stringify(response)), result].join('\n'))).toEqual(response);
    expect(parseAgentOutput(`${message(`\`\`\`json\n${JSON.stringify(response)}\n\`\`\``)}\n${result}`)).toEqual(response);
    expect(() => parseAgentOutput(`${message(JSON.stringify(response))}\n${message('Not a decision')}\n${result}`)).toThrow();
  });
  it('fails closed on malformed data or CLI failure', () => {
    expect(() => parseAgentOutput(message(JSON.stringify(response)))).toThrow('successful completion');
    expect(() => parseAgentOutput(`${message(JSON.stringify(response))}\n{"type":"result","exitCode":1}`)).toThrow();
    expect(() => parseAgentOutput(`${message('{"task_id":"TASK-001","outcome":"Done"}')}\n${result}`)).toThrow();
  });
});