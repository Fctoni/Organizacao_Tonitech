import { signChatEnvelope, verifyChatEnvelope } from './chat-tools.mjs';
import { z } from 'zod';

const savedConversation = z.strictObject({
  version: z.literal(2), userId: z.string(), expiresAt: z.number().finite(),
  messages: z.array(z.strictObject({ role: z.enum(['user', 'assistant']), content: z.string() })).max(24),
  references: z.array(z.strictObject({ turn: z.number().int().min(1).max(12), items: z.array(z.strictObject({
    id: z.string().min(1).max(200), name: z.string().max(200), shelf: z.number().int().positive(), place: z.string().max(20),
  })).max(240) })).max(12),
});

// Stateless conversational memory, never a tool result or an authorization capability.
export function resumeConversation(context, messages, userId, secret) {
  let previous = { messages: [], references: [] };
  if (context) {
    // Legacy envelopes mixed server annotations with prose. Reset rather than guess what to strip.
    const saved = savedConversation.parse(verifyChatEnvelope(context, 'conversation', secret));
    if (Buffer.byteLength(JSON.stringify(saved)) > 64000) throw new Error('Contexto excede o limite.');
    if (saved.userId !== userId || saved.expiresAt < Date.now()) throw new Error('Contexto inválido ou expirado.');
    previous = saved;
  }
  const conversation = [...previous.messages, ...messages.map(message => ({ role: 'user', content: message.parts[0].text }))];
  if (conversation.filter(message => message.role === 'user').length > 12) throw new Error('Limite da conversa atingido.');
  return { messages: conversation, references: previous.references };
}

// Provider-only contextual data, never assistant speech or a fabricated tool execution.
// User role keeps inventory names below system instructions; JSON escaping seals the wrapper.
export function conversationMessages({ messages, references }) {
  let turn = 0;
  return messages.flatMap(message => {
    if (message.role !== 'user') return [message];
    turn++;
    const reference = references.find(reference => reference.turn === turn);
    if (!reference) return [message];
    const data = JSON.stringify(reference).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
    return [message, { role: 'user', content: `<inventory-card-context>${data}</inventory-card-context>` }];
  });
}

export function conversationMetadata({ messages, references }, userId, secret) {
  let text = '';
  const displayedItems = new Map();
  let exhausted = false;
  let interrupted = false;
  let hasContent = false;
  return ({ part }) => {
    if (part.type === 'error' || part.type === 'abort') interrupted = true;
    if (part.type === 'tool-result' || (part.type === 'text-delta' && part.text.trim())) hasContent = true;
    if (part.type === 'text-delta') text += part.text;
    // Keep displayed order/identity, not quantities, observations, tickets or mutation outcomes.
    if (part.type === 'tool-result' && ['searchItems', 'getItem'].includes(part.toolName)) {
      const items = part.output.items ?? (part.output.item ? [part.output.item] : []);
      for (const { id, name, shelf, place } of items) displayedItems.set(id, { id, name, shelf, place });
    }
    if (Buffer.byteLength(text) > 64000) { exhausted = true; text = ''; }
    if (part.type !== 'finish' || interrupted || part.finishReason === 'error') return;
    // Neither partial output nor an empty provider STOP establishes a completed answer.
    if (part.finishReason !== 'stop') return { responseIssue: 'interrupted' };
    if (!hasContent) return { responseIssue: 'empty' };
    const completion = { responseComplete: true };
    const value = { version: 2, userId, expiresAt: Date.now() + 2 * 60 * 60 * 1000,
      messages: [...messages, ...(text ? [{ role: 'assistant', content: text }] : [])],
      references: [...references, ...(displayedItems.size ? [{ turn: messages.filter(message => message.role === 'user').length, items: [...displayedItems.values()] }] : [])],
    };
    if (exhausted || Buffer.byteLength(JSON.stringify(value)) > 64000) return { ...completion, contextExhausted: true };
    return { ...completion, context: signChatEnvelope(value, 'conversation', secret) };
  };
}
