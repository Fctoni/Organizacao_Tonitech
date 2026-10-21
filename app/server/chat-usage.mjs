import { tokenCount, tokenFields } from '../src/chat-usage.ts';

// Per-request stream state. Do not trust totalUsage: SDK7 adds missing counters as zero.
export function usageMetadata(runId, model, promptVersion) {
  const totals = {}; const overflow = new Set();
  let sequence = 1; let started = 0; let ended = 0; let missing = false; let interrupted = false;
  return part => {
    if (!['start', 'start-step', 'finish-step', 'finish', 'abort', 'error'].includes(part.type)) return;
    if (part.type === 'start-step') started++;
    if (part.type === 'error' || part.type === 'abort') interrupted = true;
    if (part.type === 'finish-step') {
      ended++;
      const usage = part.usage ?? {};
      const counts = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens, cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens,
        cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens };
      if (['inputTokens', 'outputTokens', 'totalTokens'].some(key => !tokenCount(counts[key]))) missing = true;
      for (const key of tokenFields) {
        if (!tokenCount(counts[key]) || overflow.has(key)) continue;
        const sum = (totals[key] ?? 0) + counts[key];
        if (tokenCount(sum)) totals[key] = sum;
        else { delete totals[key]; overflow.add(key); missing = true; }
      }
    }
    const complete = part.type === 'finish' && !['error', 'unknown', undefined].includes(part.finishReason) &&
      !interrupted && !missing && ended > 0 && started === ended;
    return { runId, model, promptVersion, sequence: sequence++, steps: ended, ...totals,
      status: complete ? 'complete' : Object.keys(totals).length ? 'partial' : 'unavailable' };
  };
}
