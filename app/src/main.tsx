import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, type Session } from '@supabase/supabase-js';
import { selectItems, type Item, type Filters } from './inventory';
import { observeInventoryAccess, saveInventoryChange, movementDescription, type Movement } from './inventory-ui';
import './style.css';
import { ItemNote } from './item-note';
import { InventoryChat } from './chat';
import { captureMcpIntent } from './mcp-intent';
import { McpRequest } from './mcp-request';

const initialMcpIntent = captureMcpIntent(window.location, window.history);

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const db = url && key ? createClient(url, key) : null;

function Field({ label, name, type = 'text', value, required = true, min = 0 }: { label: string; name: string; type?: string; value?: string | number; required?: boolean; min?: number }) {
  return <label>{label}<input name={name} type={type} defaultValue={value} required={required} min={min} step={type === 'number' ? '1' : undefined} max={type === 'number' ? '2147483647' : undefined} maxLength={type === 'password' ? 128 : 200} autoComplete={type === 'password' ? (name === 'newPassword' ? 'new-password' : 'current-password') : name === 'email' ? 'email' : undefined} /></label>;
}

function App() {
  const [mcpIntent, setMcpIntent] = useState(initialMcpIntent);
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState('loading');
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>({});
  const [selected, setSelected] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<Movement[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!db) return;
    return observeInventoryAccess(db, {
      session: setSession,
      access: next => { setAccess(next); if (next === 'error') setError('Não foi possível verificar o acesso. Entre novamente.'); },
      reset: () => { setItems([]); setCategories([]); setSelected(null); setCreating(false); setHistory([]); },
    });
  }, []);

  async function load() {
    setLoading(true);
    try {
      // Paginate rather than silently truncating at the PostgREST row limit.
      const all: Item[] = [];
      for (let offset = 0; ; offset += 500) {
        const result = await db!.from('items').select('*').order('id').range(offset, offset + 499);
        if (result.error) throw result.error;
        all.push(...result.data);
        if (result.data.length < 500) break;
      }
      const result = await db!.from('categories').select('name').order('name');
      if (result.error) throw result.error;
      setItems(all); setCategories(result.data.map(row => row.name));
    } finally { setLoading(false); }
  }
  useEffect(() => { if (access === 'ready') load().catch(() => setError('Não foi possível carregar o inventário. Tente atualizar.')); }, [access]);

  useEffect(() => {
    if (selected || creating) dialog.current?.showModal();
    else dialog.current?.close();
    if (!selected) return;
    let cancelled = false;
    setHistory([]); setHistoryLoading(true);
    db!.from('movements').select('*').eq('item_id', selected.id).order('id', { ascending: false }).limit(50).then(({ data, error }) => {
      if (cancelled) return;
      setHistoryLoading(false);
      if (error) setError('Não foi possível carregar o histórico.'); else setHistory(data);
    });
    return () => { cancelled = true; };
  }, [selected, creating]);

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (caught) {
      const code = (caught as { code?: string }).code;
      setError(code === '23505' ? 'Já existe um Item com esse nome.' : code === '42501' ? 'Acesso negado. Entre novamente.' : 'Não foi possível concluir. Confira os campos e a conexão antes de tentar novamente.');
    } finally { setBusy(false); }
  }
  function form(event: React.FormEvent<HTMLFormElement>, action: (data: FormData) => Promise<void>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); void run(() => action(data));
  }
  async function mutate(action: string, data: FormData) {
    const input: Record<string, unknown> = Object.fromEntries(data);
    for (const field of ['n', 'shelf']) if (field in input) input[field] = Number(input[field]);
    setNotice(await saveInventoryChange(
      () => db!.rpc('mutate_item', { item_id: selected!.id, action, input }),
      result => {
        setSelected(result.item);
        return result.warning ? 'Retirada maior que a quantidade disponível. Quantidade ajustada para zero.' : 'Alteração registrada.';
      }, load,
    ));
  }
  function categorySelect(value?: string) {
    return <label>Categoria<select name="category" defaultValue={value ?? ''} required><option value="" disabled>Selecione</option>{categories.map(category => <option key={category}>{category}</option>)}</select></label>;
  }
  const feedback = <><div role="alert">{error}</div><div role="status">{notice}</div></>;
  if (!db) return <main><h1>Inventário ToniTech</h1><p role="alert">Configure a conexão Supabase para usar o app.</p></main>;
  const visible = selectItems(items, filters);
  return <><header><div><span className="brand">TONITECH</span><h1>Inventário da garagem</h1></div>{session && <button onClick={() => void run(async () => { const result = await db.auth.signOut(); if (result.error) throw result.error; })} disabled={busy}>Sair</button>}</header>
    <main>
      {!(selected || creating) && feedback}
      {access === 'loading' && <p role="status">Verificando acesso…</p>}
      {access === 'login' && <section className="auth"><h2>Entrar</h2><p>Acesso restrito ao responsável pelo inventário.</p><form onSubmit={event => form(event, async data => {
        const result = await db.auth.signInWithPassword({ email: String(data.get('email')), password: String(data.get('password')) });
        if (result.error) { setError('E-mail ou senha inválidos. Confira os dados e tente novamente.'); return; }
      })}><Field label="E-mail" name="email" type="email" /><Field label="Senha" name="password" type="password" /><button disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button></form></section>}
      {access === 'password_required' && <section className="auth"><h2>Troque sua senha</h2><p>Antes de acessar os Itens, crie uma senha pessoal diferente da temporária, com pelo menos 12 caracteres.</p><form onSubmit={event => form(event, async data => {
        if (data.get('newPassword') !== data.get('confirmation')) { setError('A confirmação deve ser igual à nova senha.'); return; }
        const response = await fetch('/api/change-password', { method: 'POST', headers: { authorization: `Bearer ${session!.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(data)) });
        const body = await response.json();
        if (!response.ok) { setError(body.message); return; }
        await db.auth.signOut({ scope: 'local' }); setNotice(body.message);
      })}><Field label="Senha atual" name="currentPassword" type="password" /><Field label="Nova senha" name="newPassword" type="password" /><Field label="Confirme a nova senha" name="confirmation" type="password" /><button disabled={busy}>Alterar senha</button></form></section>}
      {(access === 'denied' || access === 'error') && <p>Este acesso não está liberado para o inventário. Contate o administrador ou saia para tentar novamente.</p>}
      {access === 'ready' && <>
        {mcpIntent && <McpRequest key={session?.user.id} intent={mcpIntent} db={db} onChanged={load} onOpen={id => setSelected(items.find(item => item.id === id) ?? null)} onClose={() => setMcpIntent(null)} />}
        <InventoryChat key={session?.user.id} db={db} onChanged={load} onOpen={id => { const item = items.find(item => item.id === id); if (item) setSelected(item); else setNotice('Atualize a lista para abrir este Item.'); }} />
        <section className="toolbar"><div><h2>Seus Itens</h2><p>{items.length} Itens · {items.filter(item => item.low_stock).length} abaixo do estoque mínimo</p></div><div className="buttons"><button disabled={busy || loading} onClick={() => void run(load)}>Atualizar</button><button disabled={busy || loading} onClick={() => { setCreating(true); setError(''); setNotice(''); }}>Cadastrar Item</button></div></section>
        <section className="filters" aria-label="Filtros"><label className="search">Buscar por nome ou alias<input type="search" value={filters.query ?? ''} onChange={event => setFilters({ ...filters, query: event.target.value })} /></label>
          <label>Categoria<select value={filters.category ?? ''} onChange={event => setFilters({ ...filters, category: event.target.value })}><option value="">Todas</option>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
          <label>Prateleira<select value={filters.shelf ?? ''} onChange={event => setFilters({ ...filters, shelf: event.target.value })}><option value="">Todas</option>{[...new Set(items.map(item => item.shelf))].sort((a,b) => a-b).map(shelf => <option key={shelf}>{shelf}</option>)}</select></label>
          <label>Superfície<select value={filters.surface ?? ''} onChange={event => setFilters({ ...filters, surface: event.target.value })}><option value="">Todas</option><option value="B">Caixa</option><option value="W">Parede</option></select></label>
          <label>Place<select value={filters.place ?? ''} onChange={event => setFilters({ ...filters, place: event.target.value })}><option value="">Todos</option>{[...new Set(selectItems(items, {}).map(item => item.place))].map(place => <option key={place}>{place}</option>)}</select></label>
          <label>Status<select value={filters.status ?? ''} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option><option value="in_stock">Disponível</option><option value="out">Esgotado</option></select></label>
          <label className="check"><input type="checkbox" checked={filters.lowStock ?? false} onChange={event => setFilters({ ...filters, lowStock: event.target.checked })} />Abaixo do mínimo</label><button onClick={() => setFilters({})}>Limpar filtros</button>
        </section>
        {loading ? <p role="status">Carregando Itens…</p> : <p role="status">{visible.length} Itens encontrados</p>}
        {!loading && visible.length === 0 && <p>Nenhum Item corresponde aos filtros.</p>}
        <ul className="items">{visible.map(item => <li key={item.id}><button className="item" onClick={() => { setSelected(item); setError(''); setNotice(''); }}><span className="location">Prateleira {item.shelf} · {item.place}</span><strong>{item.name}</strong><span>{item.category}</span><span className="stock">Quantidade: {item.qty} {item.status === 'out' ? '· Esgotado' : ''}{item.low_stock ? ' · Abaixo do mínimo' : ''}</span></button></li>)}</ul>
      </>}
    </main>
    <dialog ref={dialog} aria-labelledby="detail-title" onCancel={event => { if (busy) event.preventDefault(); else { setSelected(null); setCreating(false); } }} onClose={() => { setSelected(null); setCreating(false); }}>
      <div className="toolbar"><h2 id="detail-title">{creating ? 'Cadastrar Item' : selected?.name}</h2><button disabled={busy} onClick={() => { setSelected(null); setCreating(false); }}>Fechar</button></div>
      {feedback}
      {creating && <form onSubmit={event => form(event, async data => {
        const input = { ...Object.fromEntries(data), shelf: Number(data.get('shelf')), qty: Number(data.get('qty')), minimum_safe_stock: Number(data.get('minimum_safe_stock')), aliases: String(data.get('aliases')).split(',').map(text => text.trim()).filter(Boolean) };
        setNotice(await saveInventoryChange(
          () => db.rpc('create_item', { input }),
          item => { setCreating(false); setSelected(item); return 'Item cadastrado.'; }, load,
        ));
      })}><Field label="Nome" name="name" /><div className="grid"><Field label="Prateleira" name="shelf" type="number" min={1} /><label>Place (ex.: B03 ou W12)<input name="place" required pattern="[BW][0-9]{2,9}" /></label><Field label="Quantidade inicial" name="qty" type="number" /><Field label="Estoque mínimo" name="minimum_safe_stock" type="number" value={0} />{categorySelect()}<Field label="Aliases separados por vírgula" name="aliases" required={false} /></div><label>Observações e unidade de medida<textarea name="body" /></label><button disabled={busy}>Salvar Item</button></form>}
      {selected && !creating && <><p className="location">Prateleira {selected.shelf} · {selected.place} · {selected.category}</p><p><strong>Quantidade: {selected.qty}</strong> · Mínimo: {selected.minimum_safe_stock}{selected.low_stock && ' · Abaixo do mínimo'}</p><p>Aliases: {selected.aliases.join(', ') || 'Nenhum'}</p><ItemNote name={selected.name} body={selected.body} /><p>Use a unidade descrita no Item. Cabos por comprimento são movimentados em metros.</p>
        <fieldset disabled={busy}><legend>Movimentar quantidade</legend><form onSubmit={event => { const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement; form(event, data => mutate(submitter.value, data)); }}><Field label="Quantidade a movimentar" name="n" type="number" /><div className="buttons"><button value="take">Retirar</button><button value="add">Adicionar</button></div></form></fieldset>
        <fieldset disabled={busy}><legend>Mudar localização completa</legend><form key={`${selected.shelf}-${selected.place}`} onSubmit={event => form(event, data => mutate('relocate', data))}><div className="grid"><Field label="Prateleira" name="shelf" type="number" min={1} value={selected.shelf} /><label>Place (ex.: B03 ou W12)<input name="place" required pattern="[BW][0-9]{2,9}" defaultValue={selected.place} /></label></div><button>Mover Item</button></form></fieldset>
        <fieldset disabled={busy}><legend>Recategorizar</legend><form key={selected.category} onSubmit={event => form(event, data => mutate('recategorize', data))}>{categorySelect(selected.category)}<button>Salvar categoria</button></form></fieldset>
        <h3>Histórico recente</h3><p>Últimos 50 registros, do mais recente ao mais antigo.</p>{historyLoading ? <p role="status">Carregando histórico…</p> : <ol className="history">{history.map(movement => <li key={movement.id}>{new Date(movement.created_at).toLocaleString('pt-BR')} — {movementDescription(movement)}</li>)}</ol>}
      </>}
    </dialog>
  </>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
