export const tokenFields = ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const;
type TokenField = typeof tokenFields[number];
export type TokenCounts = Partial<Record<TokenField, number>>;
export type RunUsage = TokenCounts & { runId: string; sequence: number; model: string; promptVersion: number; status: 'complete' | 'partial' | 'unavailable'; steps: number };
export type UsageLedger = Record<string, RunUsage>;
export const tokenCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1e12;

// Allowlist metadata, never carry provider raw payloads or prompt text into UI/context.
export function readUsage(value: unknown): RunUsage | undefined {
  if (!value || typeof value !== 'object') return;
  const input = value as Record<string, unknown>;
  if (typeof input.runId !== 'string' || !/^[\w-]{1,100}$/.test(input.runId) ||
      typeof input.model !== 'string' || !/^[\w./:-]{1,150}$/.test(input.model) ||
      !tokenCount(input.sequence) || !tokenCount(input.steps) || !tokenCount(input.promptVersion) ||
      !['complete', 'partial', 'unavailable'].includes(String(input.status))) return;
  const counts: TokenCounts = {};
  for (const key of tokenFields) if (tokenCount(input[key])) counts[key] = input[key];
  const required = ['inputTokens', 'outputTokens', 'totalTokens'] as const;
  const hasCounts = tokenFields.some(key => counts[key] !== undefined);
  const complete = input.status === 'complete' && required.every(key => counts[key] !== undefined);
  return { ...counts, runId: input.runId, model: input.model, sequence: input.sequence, steps: input.steps,
    promptVersion: input.promptVersion, status: complete ? 'complete' : hasCounts ? 'partial' : 'unavailable' };
}

export function recordUsage(ledger: UsageLedger, payload: unknown): UsageLedger {
  const usage = readUsage(payload);
  if (!usage || (ledger[usage.runId]?.sequence ?? -1) >= usage.sequence) return ledger;
  return { ...ledger, [usage.runId]: usage };
}

export function conversationUsage(ledger: UsageLedger): TokenCounts & { incomplete: boolean; runs: number } {
  const runs = Object.values(ledger);
  const totals: TokenCounts = {};
  for (const key of tokenFields) {
    const known = runs.flatMap(run => run[key] === undefined ? [] : [run[key]!]);
    const sum = known.reduce((a, b) => a + b, 0);
    if ((!runs.length || known.length) && tokenCount(sum)) totals[key] = sum;
  }
  return { ...totals, runs: runs.length, incomplete: runs.some(run => run.status !== 'complete') || (runs.length > 0 && totals.totalTokens === undefined) };
}
