import { useEffect, useMemo, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import Markdown from 'react-markdown';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Item } from './inventory';
import { movementDescription, type Movement } from './inventory-ui';
import { AssistantSettings } from './assistant-settings';
import { conversationUsage, readUsage, recordUsage, type RunUsage, type UsageLedger } from './chat-usage';

type Operation = { action: 'create' | 'take' | 'add' | 'relocate' | 'recategorize'; item_id?: string; input: Partial<Item> & { n?: number } };
type Proposal = { id: string; expiresAt: number; requestText: string; operation: Operation; item: Item | null };
type ToolOutput = { item?: Item; items?: Item[]; total?: number; nextOffset?: number | null; categories?: string[];
  movements?: Movement[]; nextBefore?: number | null; proposal?: Proposal; ticket?: string };
type Props = { db: SupabaseClient; onChanged: () => Promise<void>; onOpen: (id: string) => void };
type ChatMessage = UIMessage<{ context?: string; contextExhausted?: boolean; responseComplete?: boolean; responseIssue?: 'empty' | 'interrupted'; usage?: RunUsage }, { usage: RunUsage }>;

export function UsageDetails({ value }: { value: unknown }) {
  const usage = readUsage(value);
  return <details className="chat-usage"><summary>Tokens da resposta: {usage?.totalTokens?.toLocaleString('pt-BR') ?? 'indisponível'}{usage?.status === 'partial' ? ' · parcial' : usage?.status === 'unavailable' ? ' · indisponível' : ''}</summary>
    {usage && <><p>Entrada: {usage.inputTokens ?? 'indisponível'} · Saída: {usage.outputTokens ?? 'indisponível'} · Total: {usage.totalTokens ?? 'indisponível'}</p>
      <p>Raciocínio: {usage.reasoningTokens ?? 'não informado'} · Cache lido: {usage.cacheReadTokens ?? 'não informado'} · Cache escrito: {usage.cacheWriteTokens ?? 'não informado'}. São subconjuntos; não são somados novamente. Detalhes refletem somente etapas que os informaram.</p>
      <p>Modelo: {usage.model} · Comportamento: {usage.promptVersion ? `revisão ${usage.promptVersion}` : 'indisponível'} · Etapas informadas: {usage.steps}</p></>}
    <p>Consumo informado pelo provedor/SDK. Pode estar incompleto após falha ou interrupção. Não representa a fatura nem um custo monetário.</p>
  </details>;
}

// No raw HTML, images, embedded resources or navigable model-generated links.
export function ChatMarkdown({ text }: { text: string }) {
  return <Markdown skipHtml disallowedElements={['img']} components={{ a: ({ children }) => <span>{children}</span> }}>{text}</Markdown>;
}

function ItemCard({ item, onOpen }: { item: Item; onOpen: Props['onOpen'] }) {
  return <div className="chat-card"><strong>{item.name}</strong><p>Prateleira {item.shelf} · {item.place} · {item.category}</p>
    <p>Quantidade: {item.qty} · Mínimo: {item.minimum_safe_stock}{item.status === 'out' && ' · Esgotado'}{item.low_stock && ' · Abaixo do mínimo'}</p>
    <details><summary>Detalhes técnicos</summary><small>UUID: {item.id}</small></details><button type="button" onClick={() => onOpen(item.id)}>Abrir Item</button></div>;
}

function Confirmation({ proposal, ticket, db, onChanged, onOpen }: Props & { proposal: Proposal; ticket: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'cancelled' | 'rejected'>('idle');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<Item | null>(null);
  const { action, input } = proposal.operation;
  const labels = { create: 'Cadastrar Item', take: 'Retirar', add: 'Adicionar', relocate: 'Mover Item', recategorize: 'Recategorizar' };
  async function confirm() {
    if (state !== 'idle') return;
    setState('saving'); setMessage('');
    try {
      const { data } = await db.auth.getSession();
      const response = await fetch('/api/chat', { method: 'POST', headers: { authorization: `Bearer ${data.session?.access_token ?? ''}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'confirm', ticket }) });
      const body = await response.json();
      if (!response.ok) {
        if (body.retryable === false) { setState('rejected'); setMessage(body.message ?? 'Solicite outra proposta.'); return; }
        throw new Error(body.message ?? 'Não foi possível confirmar.');
      }
      setResult(body.item); setState('saved');
      const notice = body.warning ? 'Retirada acima do disponível. Quantidade ajustada para zero.' : 'Alteração registrada.';
      setMessage(notice);
      try { await onChanged(); } catch { setMessage(`${notice} A lista não atualizou. Use Atualizar; não repita a movimentação.`); }
    } catch (error) {
      setState('idle'); setMessage(error instanceof Error ? error.message : 'Conexão interrompida. Tente novamente este cartão para recuperar o resultado sem duplicar.');
    }
  }
  return <section className="chat-card" aria-label="Confirmar alteração">
    <h4>{labels[action]}</h4><p>Pedido: {proposal.requestText}</p>
    {proposal.item && <><ItemCard item={proposal.item} onOpen={onOpen} /><p>Unidade e observações do Item:</p><ChatMarkdown text={proposal.item.body} /></>}
    {action === 'create' && <><strong>{input.name}</strong><p>Quantidade inicial: {input.qty} · Mínimo: {input.minimum_safe_stock}</p><p>Aliases: {input.aliases?.join(', ') || 'Nenhum'}</p><ChatMarkdown text={input.body ?? ''} /></>}
    {input.n !== undefined && <p><strong>Quantidade a {action === 'take' ? 'retirar' : 'adicionar'}: {input.n}</strong> (na unidade descrita acima)</p>}
    {input.shelf !== undefined && <p>Localização proposta: Prateleira {input.shelf} · {input.place}</p>}
    {input.category && <p>Categoria proposta: {input.category}</p>}
    <small>Confirmação válida até {new Date(proposal.expiresAt).toLocaleTimeString('pt-BR')}. Se o Item mudar, peça outra proposta.</small>
    {state === 'idle' || state === 'saving' ? <div className="buttons"><button type="button" disabled={state === 'saving'} onClick={() => void confirm()}>{state === 'saving' ? 'Confirmando…' : 'Confirmar alteração'}</button><button type="button" disabled={state === 'saving'} onClick={() => setState('cancelled')}>Descartar</button></div> : <p>{state === 'saved' ? 'Confirmada' : state === 'rejected' ? 'Não confirmada. Solicite outra proposta.' : 'Descartada'}</p>}
    <p role="status">{message}</p>{result && <ItemCard item={result} onOpen={onOpen} />}
  </section>;
}

export function ChatMessageParts({ message, busy = false, ...props }: Props & { message: ChatMessage; busy?: boolean }) {
  // Scope to this answer; Map retains first-seen order while later reads replace stale balances.
  const items = new Map<string, Item>();
  let firstItems = -1;
  let emptySearch = false;
  let failed = false;
  message.parts.forEach((part, index) => {
    if ('toolCallId' in part && part.state !== 'output-available') failed = true;
    if (!('state' in part) || part.state !== 'output-available' || !('output' in part)) return;
    const output = part.output as ToolOutput;
    if (output.items || output.item) {
      if (firstItems === -1) firstItems = index;
      for (const item of [...(output.items ?? []), ...(output.item ? [output.item] : [])]) items.set(item.id, item);
      if (output.total === 0) emptySearch = true;
    }
  });
  return <>{message.parts.map((part, index) => {
    if (part.type === 'text') return <ChatMarkdown key={index} text={part.text} />;
    if ('state' in part && part.state === 'output-available' && 'output' in part) {
      const output = part.output as ToolOutput;
      return <div key={index}>{index === firstItems && Array.from(items.values(), item => <ItemCard key={item.id} item={item} onOpen={props.onOpen} />)}
        {output.nextOffset != null && <p>Há mais resultados. Peça a próxima página (offset {output.nextOffset}).</p>}
        {output.categories && <p>Categorias: {output.categories.join(', ')}</p>}
        {output.movements && <><ol>{output.movements.map(movement => <li key={movement.id}>{new Date(movement.created_at).toLocaleString('pt-BR')} — {movementDescription(movement)}</li>)}</ol>{output.nextBefore && <p>Mais movimentos: peça anteriores ao ID {output.nextBefore}.</p>}</>}
        {output.proposal && output.ticket && <Confirmation key={output.proposal.id} {...props} proposal={output.proposal} ticket={output.ticket} />}</div>;
    }
    if ('state' in part && part.state === 'output-error') return <p key={index}>A consulta não foi concluída. Tente novamente.</p>;
    return null;
  })}{message.metadata?.responseComplete && emptySearch && items.size === 0 && !failed && <p>Nenhum Item encontrado nas buscas realizadas.</p>}
    {message.role === 'assistant' && !busy && !message.metadata?.responseComplete && <p>{message.metadata?.responseIssue === 'empty' ? 'O assistente não retornou conteúdo.' : 'Resposta não concluída. Os resultados exibidos podem estar incompletos.'} Tente a pergunta novamente. Nenhuma proposta é executada automaticamente.</p>}</>;
}

export function InventoryChat(props: Props) {
  const [input, setInput] = useState('');
  const [ledger, setLedger] = useState<UsageLedger>({});
  const transport = useMemo(() => new DefaultChatTransport<ChatMessage>({ api: '/api/chat',
    headers: async () => ({ authorization: `Bearer ${(await props.db.auth.getSession()).data.session?.access_token ?? ''}` }),
    prepareSendMessagesRequest: ({ messages, headers }) => {
      const previous = messages.reduce((last, message, index) => message.role === 'assistant' && message.metadata?.context ? index : last, -1);
      return { headers, body: { context: previous >= 0 ? messages[previous].metadata?.context : undefined,
        messages: messages.slice(previous + 1).filter(message => message.role === 'user').map(message => ({ role: 'user', parts: message.parts.filter(part => part.type === 'text').map(part => ({ type: 'text', text: part.text })) })) } };
    },
    fetch: async (url, options) => {
      const pendingId = crypto.randomUUID();
      const pending: RunUsage = { runId: pendingId, sequence: 0, model: 'indisponivel', promptVersion: 0, steps: 0, status: 'unavailable' };
      setLedger(previous => recordUsage(previous, pending));
      const response = await fetch(url, options);
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message ?? 'Chat indisponível. Tente novamente.'); }
      const runId = response.headers.get('X-Chat-Run-Id');
      if (runId && /^[\w-]{1,100}$/.test(runId)) setLedger(previous => {
        const next = { ...previous }; delete next[pendingId];
        return recordUsage(next, { ...pending, runId });
      });
      return response;
    },
  }), [props.db]);
  const { messages, sendMessage, status, stop, error, regenerate, setMessages, clearError } = useChat<ChatMessage>({ transport,
    onData: part => { if (part.type === 'data-usage') setLedger(previous => recordUsage(previous, part.data)); },
  });
  useEffect(() => () => { void stop(); }, [stop]);
  const busy = status === 'submitted' || status === 'streaming';
  const incomplete = messages.at(-1)?.role === 'assistant' && !messages.at(-1)?.metadata?.responseComplete;
  const limit = messages.filter(message => message.role === 'user').length >= 12 || !!messages.at(-1)?.metadata?.contextExhausted;
  const total = conversationUsage(ledger);
  return <details className="inventory-chat"><summary>Assistente do inventário</summary>
    <details className="chat-usage"><summary>Tokens da conversa: {total.totalTokens?.toLocaleString('pt-BR') ?? 'indisponível'}{total.incomplete ? ' · incompleto' : ''}</summary>
      <p>{total.runs} execuções, incluindo tentativas anteriores. Entrada: {total.inputTokens ?? 'indisponível'} · Saída: {total.outputTokens ?? 'indisponível'}. Nova conversa zera este medidor temporário.</p>
      {Object.values(ledger).map((run, index) => <div key={run.runId}><strong>Execução {index + 1}</strong><UsageDetails value={run} /></div>)}
    </details>
    <AssistantSettings db={props.db} />
    <p>Consulte Itens ou peça lançamentos. Revise o cartão antes de confirmar. Conversa temporária, até 12 perguntas. Respostas concluídas preservam o contexto por até duas horas. Se a resposta for interrompida, tente a pergunta novamente; ao se referir a um cartão da resposta interrompida, informe o nome do Item.</p>
    <div className="chat-messages" aria-label="Conversa">{messages.map(message => <article key={message.id} className={`chat-message ${message.role}`}>
      <h3>{message.role === 'user' ? 'Você' : 'Assistente'}</h3>
      <ChatMessageParts {...props} message={message} busy={busy && message.id === messages.at(-1)?.id} />
      {message.role === 'assistant' && <UsageDetails value={message.metadata?.usage} />}
    </article>)}</div>
    <p role="status">{busy ? 'Consultando…' : limit ? 'Limite da conversa atingido. Inicie outra conversa.' : ''}</p>
    {(error || (!busy && incomplete)) && <div role="alert">{error?.message}<button disabled={busy} onClick={() => { clearError(); void regenerate(); }}>Tentar resposta novamente</button></div>}
    <form onSubmit={event => { event.preventDefault(); if (!input.trim() || busy || limit) return; clearError(); void sendMessage({ text: input.trim() }); setInput(''); }}>
      <label>Pergunta ou lançamento<textarea maxLength={2000} value={input} onChange={event => setInput(event.target.value)} required disabled={busy || limit} /></label>
      <div className="buttons"><button disabled={busy || limit || !input.trim()}>Enviar</button>{busy && <button type="button" onClick={() => void stop()}>Parar resposta</button>}
        <button type="button" disabled={busy} onClick={() => { setMessages([]); setLedger({}); clearError(); }}>Nova conversa</button></div>
    </form>
  </details>;
}
