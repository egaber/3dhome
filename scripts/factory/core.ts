import { createHash } from 'node:crypto';
import { z } from 'zod';

export const roles = ['pm', 'architect', 'ux-ui', 'skeptic', 'team-lead', 'engineer', 'qa', 'visual-qa'] as const;
export const roleSchema = z.enum(roles);
const approvalSchema = z.enum(['ux-design', 'skeptic', 'plan', 'qa', 'visual', 'ux-validation']);
export type Role = z.infer<typeof roleSchema>;

export const configSchema = z.object({
  pollIntervalMs: z.number().int().min(1000).default(10_000),
  stageTimeoutMs: z.number().int().min(1000).default(600_000),
  maxStepsPerTask: z.number().int().min(8).max(100).default(32),
  maxRetries: z.number().int().min(0).max(10).default(3),
  maxFollowUpsPerRoot: z.number().int().min(0).max(20).default(5),
  maxBacklogSize: z.number().int().min(1).max(500).default(200),
  maxAgentRunsPerDay: z.number().int().min(1).max(500).default(40),
  maxAiCreditsPerStage: z.number().min(30).default(30),
  cliCommand: z.string().min(1).default('copilot'),
  model: z.string().min(1).default('auto'),
}).strict();
export type FactoryConfig = z.infer<typeof configSchema>;

const verificationSchema = z.object({
  source_hash: z.string().min(1),
  qa_passed: z.boolean(),
  browser_passed: z.boolean(),
  logs: z.array(z.string()).default([]),
  screenshots: z.array(z.string()).default([]),
});
export type Verification = z.infer<typeof verificationSchema>;

const criteriaSchema = z.array(z.string().trim().min(1).max(2000)).max(30);
export const taskSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(8000).default(''),
  kind: z.enum(['feature', 'bug', 'issue']).default('feature'),
  status: z.enum(['Todo', 'In_Progress', 'Done', 'Blocked']),
  assigned_to: roleSchema,
  enabled: z.boolean().default(true),
  retry_count: z.number().int().nonnegative().default(0),
  max_retries: z.number().int().min(0).max(10).default(3),
  step_count: z.number().int().nonnegative().default(0),
  phase: z.enum(['plan', 'delivery']).default('plan'),
  acceptance_criteria: criteriaSchema.default([]),
  depends_on: z.array(z.string()).default([]),
  parent_id: z.string().optional(),
  root_id: z.string().optional(),
  source_key: z.string().optional(),
  contract: z.string().max(16_000).default(''),
  approvals: z.array(approvalSchema).default([]),
  verification: verificationSchema.optional(),
  last_error: z.string().optional(),
  history: z.array(z.object({
    at: z.string(), agent: roleSchema, outcome: z.string(), summary: z.string(),
  })).default([]),
}).strict();
export type FactoryTask = z.infer<typeof taskSchema>;

export const boardSchema = z.array(taskSchema).max(500).superRefine((tasks, ctx) => {
  const ids = new Set(tasks.map(task => task.id));
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (ids.size !== tasks.length) issue('Task IDs must be unique.');
  if (tasks.filter(task => task.status === 'In_Progress').length > 1) issue('Only one task may be In_Progress.');
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) { issue(`Dependency cycle at ${id}.`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    const task = tasks.find(item => item.id === id);
    for (const dependency of task?.depends_on ?? []) {
      if (!ids.has(dependency)) issue(`Unknown dependency ${dependency} on ${id}.`);
      else visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) {
    visit(task.id);
    if (task.parent_id && !ids.has(task.parent_id)) issue(`Unknown parent on ${task.id}.`);
    if (task.root_id && !ids.has(task.root_id)) issue(`Unknown root on ${task.id}.`);
    if (task.status === 'Todo' && task.assigned_to !== 'pm') issue(`Todo task ${task.id} must be assigned to pm.`);
  }
});

export const resultSchema = z.object({
  task_id: taskSchema.shape.id,
  outcome: z.enum(['handoff', 'revise', 'done', 'blocked']),
  next_agent: roleSchema.optional(),
  summary: z.string().trim().min(1).max(4000),
  contract: z.string().trim().min(1).max(16_000).optional(),
  acceptance_criteria: criteriaSchema.min(1).optional(),
  notes: z.string().max(8000).optional(),
  followups: z.array(z.object({
    title: taskSchema.shape.title,
    description: z.string().min(1).max(8000),
    kind: z.enum(['feature', 'bug', 'issue']),
    acceptance_criteria: criteriaSchema.min(1),
  }).strict()).max(2).default([]),
}).strict();
export type AgentResult = z.infer<typeof resultSchema>;

export function selectTask(tasks: FactoryTask[]): FactoryTask | undefined {
  const active = tasks.find(task => task.status === 'In_Progress');
  if (active) return active.enabled ? active : undefined;
  return tasks.find(task => task.enabled && task.status === 'Todo'
    && task.depends_on.every(id => tasks.some(item => item.id === id && item.status === 'Done')));
}

export function nextId(tasks: FactoryTask[]): string {
  const largest = Math.max(0, ...tasks.map(task => Number(/^TASK-(\d+)$/.exec(task.id)?.[1] ?? 0)));
  return `TASK-${String(largest + 1).padStart(3, '0')}`;
}

export function titleKey(title: string): string {
  return createHash('sha256').update(title.trim().toLocaleLowerCase()).digest('hex');
}

export function newTask(tasks: FactoryTask[], title: string, maxRetries: number): FactoryTask {
  return taskSchema.parse({ id: nextId(tasks), title, status: 'Todo', assigned_to: 'pm', max_retries: maxRetries });
}

export function blockTask(task: FactoryTask, reason: string): FactoryTask {
  return { ...task, status: 'Blocked', last_error: reason };
}

export function beginStep(task: FactoryTask, config: FactoryConfig): FactoryTask {
  if (task.step_count >= config.maxStepsPerTask) return blockTask(task, 'Maximum stage count reached; operator review required.');
  return { ...task, status: 'In_Progress', step_count: task.step_count + 1 };
}

const reworkTargets: Record<Role, Role[]> = {
  pm: ['architect'], architect: ['ux-ui'], 'ux-ui': ['architect', 'skeptic', 'engineer'],
  skeptic: ['architect', 'ux-ui'], 'team-lead': ['architect', 'ux-ui', 'skeptic', 'engineer'],
  engineer: ['architect', 'ux-ui', 'skeptic'], qa: ['engineer', 'architect', 'skeptic'],
  'visual-qa': ['engineer', 'ux-ui', 'architect'],
};
const planApprovals = ['ux-design', 'skeptic', 'plan'] as const;
const deliveryApprovals = ['qa', 'visual', 'ux-validation'] as const;

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function transition(task: FactoryTask, result: AgentResult, config: FactoryConfig, evidence?: Verification): FactoryTask {
  requireCondition(task.status === 'In_Progress', 'Only an active task can transition.');
  requireCondition(result.task_id === task.id, 'Agent returned the wrong task ID.');
  const role = task.assigned_to;
  const next = structuredClone(task);
  next.last_error = undefined;
  const approve = (approval: z.infer<typeof approvalSchema>) => {
    if (!next.approvals.includes(approval)) next.approvals.push(approval);
  };
  if (result.outcome === 'blocked') return blockTask(next, result.summary);
  if (result.outcome === 'revise') {
    requireCondition(result.next_agent && reworkTargets[role].includes(result.next_agent), `Invalid rework route from ${role}.`);
    if (task.retry_count >= Math.min(task.max_retries, config.maxRetries)) return blockTask(next, `Retry limit reached: ${result.summary}`);
    next.retry_count++;
    next.last_error = result.summary;
    next.verification = undefined;
    next.assigned_to = result.next_agent;
    next.approvals = next.approvals.filter(approval => planApprovals.some(item => item === approval));
    if (result.next_agent === 'architect') { next.phase = 'plan'; next.contract = ''; next.approvals = []; }
    if (result.next_agent === 'ux-ui') { next.phase = 'plan'; next.approvals = []; }
    if (result.next_agent === 'skeptic') { next.phase = 'plan'; next.approvals = next.approvals.filter(item => item === 'ux-design'); }
    if (result.next_agent === 'engineer') requireCondition(planApprovals.every(item => next.approvals.includes(item)), 'Rework cannot bypass design approval.');
    return next;
  }
  if (result.outcome === 'done') {
    requireCondition(role === 'team-lead' && task.phase === 'delivery', 'Only final team-lead review can finish a task.');
    requireCondition([...planApprovals, ...deliveryApprovals].every(item => task.approvals.includes(item)), 'Missing required approvals.');
    requireCondition(evidence?.qa_passed && evidence.browser_passed && evidence.screenshots.length >= 2, 'Missing executable QA or screenshot evidence.');
    requireCondition(task.verification?.source_hash === evidence.source_hash, 'Verification is stale.');
    next.status = 'Done';
    return next;
  }
  const routes: Record<Role, Role> = {
    pm: 'architect', architect: 'ux-ui', 'ux-ui': task.phase === 'plan' ? 'skeptic' : 'team-lead',
    skeptic: 'team-lead', 'team-lead': 'engineer', engineer: 'qa', qa: 'visual-qa', 'visual-qa': 'ux-ui',
  };
  requireCondition(result.next_agent === routes[role], `Expected ${role} to hand off to ${routes[role]}.`);
  switch (role) {
    case 'pm':
      requireCondition(result.acceptance_criteria?.length, 'PM must define testable acceptance criteria.');
      next.acceptance_criteria = result.acceptance_criteria;
      break;
    case 'architect':
      requireCondition(result.contract, 'Architect must provide a contract.');
      next.contract = result.contract;
      next.approvals = [];
      next.verification = undefined;
      next.phase = 'plan';
      break;
    case 'ux-ui':
      requireCondition(task.contract, 'UX requires an architectural contract.');
      if (task.phase === 'plan') approve('ux-design');
      else {
        requireCondition(task.approvals.includes('visual') && task.approvals.includes('qa'), 'UX validation requires QA and visual approval.');
        approve('ux-validation');
      }
      break;
    case 'skeptic':
      requireCondition(task.contract && task.approvals.includes('ux-design'), 'Skeptic requires the contract and UX design.');
      approve('skeptic');
      break;
    case 'team-lead':
      requireCondition(task.phase === 'plan', 'Final team lead must finish, revise, or block; never restart implementation silently.');
      requireCondition(task.approvals.includes('skeptic'), 'Skeptic approval is required.');
      approve('plan');
      break;
    case 'engineer':
      requireCondition(task.contract && planApprovals.every(item => task.approvals.includes(item)), 'Implementation requires an approved contract.');
      next.phase = 'delivery';
      next.approvals = next.approvals.filter(item => planApprovals.some(approval => approval === item));
      next.verification = undefined;
      break;
    case 'qa':
      requireCondition(task.phase === 'delivery' && evidence?.qa_passed, 'QA cannot approve failed or missing checks.');
      next.verification = evidence;
      approve('qa');
      break;
    case 'visual-qa':
      requireCondition(task.approvals.includes('qa') && evidence?.browser_passed && evidence.screenshots.length >= 2, 'Visual QA requires fresh desktop and mobile screenshots.');
      requireCondition(task.verification?.source_hash === evidence.source_hash, 'Browser results are for different source code.');
      next.verification = evidence;
      approve('visual');
      break;
  }
  next.assigned_to = routes[role];
  return next;
}

export function applyResult(tasks: FactoryTask[], id: string, result: AgentResult, config: FactoryConfig, evidence?: Verification): FactoryTask[] {
  const task = tasks.find(item => item.id === id);
  requireCondition(task, `Unknown task ${id}.`);
  const next = transition(task, result, config, evidence);
  next.history.push({ at: new Date().toISOString(), agent: task.assigned_to, outcome: result.outcome, summary: result.summary });
  const board = tasks.map(item => item.id === id ? next : item);
  const root = task.root_id ?? task.id;
  for (const followup of result.followups) {
    if (board.some(item => titleKey(item.title) === titleKey(followup.title))) continue;
    requireCondition(board.filter(item => item.root_id === root).length < config.maxFollowUpsPerRoot, 'Follow-up budget exhausted for this task family.');
    requireCondition(board.length < config.maxBacklogSize, 'Backlog size limit reached.');
    board.push(taskSchema.parse({ ...newTask(board, followup.title, config.maxRetries), ...followup, parent_id: task.id, root_id: root }));
  }
  return boardSchema.parse(board);
}

/** Only the final assistant message is a decision; tool output is never authority. */
export function parseAgentOutput(stdout: string): AgentResult {
  let finalMessage = '';
  let exitCode: number | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: { type?: string; data?: { content?: string }; exitCode?: number };
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'assistant.message' && typeof event.data?.content === 'string') finalMessage = event.data.content;
    if (event.type === 'result') exitCode = event.exitCode;
  }
  requireCondition(exitCode === 0, 'Copilot did not report successful completion.');
  const json = finalMessage.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1');
  return resultSchema.parse(JSON.parse(json));
}