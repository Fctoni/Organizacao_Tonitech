import test from 'node:test';
import assert from 'node:assert/strict';
import { usageMetadata } from '../server/chat-usage.mjs';
import { recordUsage, conversationUsage, readUsage } from '../src/chat-usage.ts';

test('soma etapas reais sem somar cache/reasoning duas vezes; retry e eventos duplicados', () => {
  const metadata = usageMetadata('run-1', 'fixture-model', 3);
  metadata({ type: 'start' });
  metadata({ type: 'start-step' });
  const first = metadata({ type: 'finish-step', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, inputTokenDetails: { cacheReadTokens: 4 }, outputTokenDetails: { reasoningTokens: 2 } } });
  assert.equal(first.status, 'partial');
  metadata({ type: 'start-step' });
  metadata({ type: 'finish-step', usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 } });
  const final = metadata({ type: 'finish', finishReason: 'stop' });
  assert.equal(final.totalTokens, 43); assert.equal(final.cacheReadTokens, 4); assert.equal(final.reasoningTokens, 2);
  assert.equal(final.status, 'complete'); assert.equal(final.promptVersion, 3);
  let ledger = recordUsage({}, first);
  ledger = recordUsage(recordUsage(ledger, final), final);
  ledger = recordUsage(ledger, first); // late duplicate cannot replace final
  ledger = recordUsage(ledger, { ...final, runId: 'retry-2' });
  assert.equal(conversationUsage(ledger).totalTokens, 86);
  assert.equal(conversationUsage({}).totalTokens, 0);
});

test('zero legítimo, ausência por etapa, erros, abort e números inválidos não viram consumo zero completo', () => {
  for (const [usage, status] of [
    [{ inputTokens: 0, outputTokens: 0, totalTokens: 0 }, 'complete'],
    [{}, 'unavailable'],
    [{ inputTokens: 2, totalTokens: 2 }, 'partial'],
    [{ inputTokens: NaN, outputTokens: -2, totalTokens: Infinity }, 'unavailable'],
  ]) {
    const metadata = usageMetadata('run', 'fixture', 1);
    metadata({ type: 'start-step' }); metadata({ type: 'finish-step', usage });
    assert.equal(metadata({ type: 'finish', finishReason: 'stop' }).status, status);
  }
  for (const type of ['abort', 'error', 'start-step']) {
    const metadata = usageMetadata('run', 'fixture', 1);
    metadata({ type: 'start-step' });
    metadata({ type: 'finish-step', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } });
    metadata({ type });
    const final = metadata({ type: 'finish', finishReason: 'stop' });
    assert.equal(final.status, 'partial'); assert.equal(final.totalTokens, 5);
    assert.equal(conversationUsage(recordUsage({}, final)).incomplete, true);
  }
  const metadata = usageMetadata('run', 'fixture', 1);
  metadata({ type: 'start-step' }); metadata({ type: 'finish-step', usage: {} });
  metadata({ type: 'start-step' }); metadata({ type: 'finish-step', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } });
  assert.equal(metadata({ type: 'finish', finishReason: 'stop' }).status, 'partial');
  for (const invalid of [null, {}, 'x', { runId: '__proto__' }, { sequence: NaN }]) assert.equal(readUsage(invalid), undefined);
  const bad = readUsage({ runId: 'run', sequence: 1, model: 'fixture', promptVersion: 1, status: 'complete', steps: 1, inputTokens: 0, outputTokens: Infinity, totalTokens: 1.5, raw: 'SECRET' });
  assert.equal(bad.status, 'partial'); assert.equal(bad.inputTokens, 0); assert.equal(bad.totalTokens, undefined);
  assert.equal('raw' in bad, false);
});
