import { signChatEnvelope, verifyChatEnvelope } from './chat-tools.mjs';

// Stateless conversational memory, never a tool result or an authorization capability.
export function resumeConversation(context, messages, userId, secret) {
  let previous = [];
  if (context) {
    const saved = verifyChatEnvelope(context, 'conversation', secret);
    if (saved.userId !== userId || saved.expiresAt < Date.now()) throw new Error('Contexto inválido ou expirado.');
    previous = saved.messages;
  }
  const conversation = [...previous, ...messages.map(message => ({ role: 'user', content: message.parts[0].text }))];
  if (conversation.filter(message => message.role === 'user').length > 12) throw new Error('Limite da conversa atingido.');
  return conversation;
}

export function conversationMetadata(messages, userId, secret) {
  let text = '';
  const displayedItems = new Set();
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
      const references = items.filter(({ id }) => {
        if (displayedItems.has(id)) return false;
        displayedItems.add(id);
        return true;
      });
      if (references.length) text += `\nReferências dos cartões exibidos (reconsulte antes de usar): ${JSON.stringify(references.map(({ id, name, shelf, place }) => ({ id, name, shelf, place })))}\n`;
    }
    if (Buffer.byteLength(text) > 64000) { exhausted = true; text = ''; }
    if (part.type !== 'finish' || interrupted || part.finishReason === 'error') return;
    // Neither partial output nor an empty provider STOP establishes a completed answer.
    if (part.finishReason !== 'stop') return { responseIssue: 'interrupted' };
    if (!hasContent) return { responseIssue: 'empty' };
    const completion = { responseComplete: true };
    const value = { userId, expiresAt: Date.now() + 2 * 60 * 60 * 1000, messages: [...messages, ...(text ? [{ role: 'assistant', content: text }] : [])] };
    if (exhausted || Buffer.byteLength(JSON.stringify(value)) > 64000) return { ...completion, contextExhausted: true };
    return { ...completion, context: signChatEnvelope(value, 'conversation', secret) };
  };
}
