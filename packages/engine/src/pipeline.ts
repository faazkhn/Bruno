/** The one deep entry point: history in, proven chores out (PRD §11–12). */
import { actionOf, actionId, findCandidates, type Action } from './candidates';
import type { Expr } from './jql';
import { buildExamples, learnRule } from './learner';
import type { IssueRecord } from './model';
import { replay, type Proof } from './replay';
import type { Range, Settings } from './settings';
import { tokenize, vocabulary } from './text';
import { chooseTrigger, type Trigger, type TriggerChoice } from './triggers';

const DAY = 86_400_000;

export type Verdict = 'proven' | 'too-few' | 'low-coverage' | 'weak';

export interface Chore {
  id: string;
  version: number;
  /** set on versions whose exclusion was chosen after seeing holdout differences */
  note?: string;
  action: Action;
  /** whole window, bulk edits excluded */
  count: number;
  items: number;
  people: number;
  bulkCollapsed: number;
  trigger: Trigger;
  triggerStats: Omit<TriggerChoice, 'trigger'>;
  clauses: Expr[];
  learn: { f1: number; precision: number; recall: number; examples: number };
  proof: Proof;
  verdict: Verdict;
  /** holdout matches per 30 days: the ranking key (expected automated actions × precision) */
  perMonth: number;
}

export interface Analysis {
  window: { start: number; cut: number; end: number };
  chores: Chore[];
  /** candidates with no usable trigger (shown as "not automatable yet") */
  unexplained: { id: string; action: Action; count: number; reason: 'no-trigger' | 'no-pattern' }[];
}

export const verdictOf = (p: Proof, s: Settings): Verdict =>
  p.tp + p.fn < s.minHoldoutPositives ? 'too-few' : p.coverage < s.minCoverage ? 'low-coverage' : p.precision < s.minPrecision ? 'weak' : 'proven';

export const splitOf = (w: Analysis['window']) => ({ learn: { from: w.start, to: w.cut }, holdout: { from: w.cut, to: w.end } });

export function analyse(issues: IssueRecord[], s: Settings, now: number): Analysis {
  const lastTs = Math.max(0, ...issues.map((i) => i.events.at(-1)?.ts ?? i.createdAt));
  const end = s.anchor === 'lastActivity' && issues.length ? lastTs + 1 : now;
  const earliest = issues.length ? Math.min(...issues.map((i) => i.createdAt)) : end;
  const start = Math.max(end - s.windowDays * DAY, earliest);
  const cut = start + Math.round(((end - start) * 2) / 3);
  const window = { start, cut, end };
  if (!issues.length || end <= start) return { window, chores: [], unexplained: [] };

  const learn: Range = { from: start, to: cut };
  const holdout: Range = { from: cut, to: end };
  const W = s.windowHours * 3_600_000;
  const vocab = vocabulary(issues.filter((i) => i.createdAt >= start && i.createdAt < cut).map((i) => new Set(tokenize(`${i.text.summary} ${i.text.description}`))));

  // whole-window display counts
  const whole = new Map<string, number>();
  for (const c of findCandidates(issues, { from: start, to: end }, { ...s, minCount: 1, minPeople: 1 })) whole.set(c.id, c.occurrences.length);

  const chores: Chore[] = [];
  const unexplained: Analysis['unexplained'] = [];
  for (const cand of findCandidates(issues, learn, s)) {
    const choice = chooseTrigger(cand, issues, learn, s);
    if (!choice) {
      unexplained.push({ id: cand.id, action: cand.action, count: whole.get(cand.id) ?? cand.occurrences.length, reason: 'no-trigger' });
      continue;
    }
    const examples = buildExamples(issues, choice.trigger, cand.action, learn, W);
    const rule = learnRule(examples, vocab, s);
    if (rule.precision < s.minLearnPrecision) {
      unexplained.push({ id: cand.id, action: cand.action, count: whole.get(cand.id) ?? cand.occurrences.length, reason: 'no-pattern' });
      continue;
    }
    const proof = replay(rule.clauses, choice.trigger, cand.action, issues, holdout, W);
    const verdict = verdictOf(proof, s);
    const { trigger, ...triggerStats } = choice;
    chores.push({
      id: cand.id,
      version: 1,
      action: cand.action,
      count: whole.get(cand.id) ?? cand.occurrences.length,
      items: cand.items,
      people: cand.people,
      bulkCollapsed: cand.bulkCollapsed,
      trigger,
      triggerStats,
      clauses: rule.clauses,
      learn: { f1: rule.f1, precision: rule.precision, recall: rule.recall, examples: examples.length },
      proof,
      verdict,
      perMonth: (proof.tp / Math.max(1, (end - cut) / DAY)) * 30,
    });
  }
  chores.sort((a, b) => b.perMonth - a.perMonth || a.id.localeCompare(b.id));
  return { window, chores: chores.slice(0, s.top), unexplained };
}

export { actionId, actionOf };
