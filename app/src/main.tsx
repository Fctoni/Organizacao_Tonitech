import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, type Session } from '@supabase/supabase-js';
import { selectItems, type Item, type Filters } from './inventory';
import { observeInventoryAccess, saveInventoryChange, movementDescription, type Movement } from './inventory-ui';
import './style.css';
import { ItemNote } from './item-note';
import { unitSuffix } from './item-unit';
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
  const [view, setView] = useState<'inventory' | 'chat'>('inventory');
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>({});
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<Movement[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const loadRevision = useRef(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport || view !== 'chat' || access !== 'ready') return;
    // Some mobile browsers resize only the visual viewport when the keyboard opens.
    const resize = () => { if (viewport.scale === 1) shell.current?.style.setProperty('--visible-height', `${viewport.height}px`); };
    resize(); viewport.addEventListener('resize', resize);
    return () => { viewport.removeEventListener('resize', resize); shell.current?.style.removeProperty('--visible-height'); };
  }, [view, access]);

  useEffect(() => {
    if (!db) return;
    return observeInventoryAccess(db, {
      session: setSession,
      access: next => { setAccess(next); if (next === 'error') setError('Não foi possível verificar o acesso. Entre novamente.'); },
      reset: () => { ++loadRevision.current; setLoading(false); setItems([]); setLoaded(false); setLoadFailed(false); setCategories([]); setSelected(null); setCreating(false); setHistory([]); },
    });
  }, []);

  async function load() {
    // Only the latest read in the current access scope may update the view.
    const revision = ++loadRevision.current;
    setLoading(true); setLoadFailed(false);
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
      if (revision === loadRevision.current) {
        setItems(all); setCategories(result.data.map(row => row.name)); setLoaded(true);
      }
    } catch (caught) { if (revision === loadRevision.current) setLoadFailed(true); throw caught; }
    finally { if (revision === loadRevision.current) setLoading(false); }
  }
  // load reports query failures separately and still rejects for mutation callers.
  function refresh() { void load().catch(() => {}); }
  useEffect(() => { if (access === 'ready') refresh(); }, [access]);

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
  function openItem(item: Item) { setSelected(item); setError(''); setNotice(''); }
  const feedback = <><div role="alert">{error}</div><div role="status">{notice}</div></>;
  if (!db) return <main><h1>Inventário ToniTech</h1><p role="alert">Configure a conexão Supabase para usar o app.</p></main>;
  const visible = selectItems(items, filters);
  const extraFilterCount = [filters.category, filters.shelf, filters.surface, filters.place, filters.status].filter(Boolean).length;
  const hasFilters = Boolean(extraFilterCount || filters.query || filters.lowStock);
  return <div ref={shell} className={access === 'ready' && view === 'chat' ? 'app-shell chat-mode' : 'app-shell'}><header className="app-header"><div><span className="brand">TONITECH</span><h1>Inventário da garagem</h1></div>{access === 'ready' && <nav aria-label="Áreas do inventário"><button aria-pressed={view === 'inventory'} onClick={() => setView('inventory')}>Inventário</button><button aria-pressed={view === 'chat'} onClick={() => setView('chat')}>Assistente</button></nav>}{session && <button onClick={() => void run(async () => { const result = await db.auth.signOut(); if (result.error) throw result.error; })} disabled={busy}>Sair</button>}</header>
    <main className="app-main">
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
        <div className="chat-pane" hidden={view !== 'chat'}><InventoryChat key={session?.user.id} active={view === 'chat'} db={db} onChanged={load} onOpen={id => { const item = items.find(item => item.id === id); if (item) setSelected(item); else setNotice('Atualize a lista para abrir este Item.'); }} /></div>
        <div hidden={view !== 'inventory'}>
        <section className="toolbar"><div><h2>Seus Itens</h2>{loaded && <p>{items.length} Itens · {items.filter(item => item.low_stock).length} abaixo do estoque mínimo</p>}</div><div className="buttons"><button disabled={busy || loading} onClick={refresh}>Atualizar</button><button disabled={busy || loading} onClick={() => { setCreating(true); setError(''); setNotice(''); }}>Cadastrar Item</button></div></section>
        {loadFailed && <div role="alert"><p>{loaded ? 'Não foi possível atualizar o inventário. Exibindo os dados da última consulta.' : 'Não foi possível carregar o inventário.'}</p><button disabled={busy || loading} onClick={refresh}>Tentar novamente</button></div>}
        <section className="filters" aria-label="Filtros"><label className="search">Buscar por nome ou alias<input type="search" value={filters.query ?? ''} onChange={event => setFilters({ ...filters, query: event.target.value })} /></label>
          <div className="filter-actions"><label className="check"><input type="checkbox" checked={filters.lowStock ?? false} onChange={event => setFilters({ ...filters, lowStock: event.target.checked })} />Abaixo do mínimo</label><button className="filter-toggle" aria-expanded={filtersExpanded} aria-controls="extra-filters" onClick={() => setFiltersExpanded(!filtersExpanded)}>Filtros ({extraFilterCount})</button>{hasFilters && <button onClick={() => setFilters({})}>Limpar filtros</button>}</div>
          <div id="extra-filters" className={`extra-filters${filtersExpanded ? ' expanded' : ''}`}>
          <label>Categoria<select value={filters.category ?? ''} onChange={event => setFilters({ ...filters, category: event.target.value })}><option value="">Todas</option>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
          <label>Prateleira<select value={filters.shelf ?? ''} onChange={event => setFilters({ ...filters, shelf: event.target.value })}><option value="">Todas</option>{[...new Set(items.map(item => item.shelf))].sort((a,b) => a-b).map(shelf => <option key={shelf}>{shelf}</option>)}</select></label>
          <label>Superfície<select value={filters.surface ?? ''} onChange={event => setFilters({ ...filters, surface: event.target.value })}><option value="">Todas</option><option value="B">Caixa</option><option value="W">Parede</option></select></label>
          <label>Place<select value={filters.place ?? ''} onChange={event => setFilters({ ...filters, place: event.target.value })}><option value="">Todos</option>{[...new Set(selectItems(items, {}).map(item => item.place))].map(place => <option key={place}>{place}</option>)}</select></label>
          <label>Status<select value={filters.status ?? ''} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option><option value="in_stock">Disponível</option><option value="out">Esgotado</option></select></label>
          </div>
        </section>
        {loading ? <p role="status">Carregando Itens…</p> : loaded && <p role="status">{visible.length} Itens encontrados</p>}
        {!loading && loaded && visible.length === 0 && <p>{items.length === 0 ? 'Nenhum Item cadastrado.' : 'Nenhum resultado para estes filtros.'}</p>}
        <ul className="inventory-list" aria-label="Itens do inventário">{visible.map(item => <li key={item.id}>
          <button type="button" className="item" onClick={() => openItem(item)}>
            <strong className="item-name">{item.name}</strong>
            <span className="item-quantity"><span className="sr-only">Quantidade: </span><strong className="quantity">{item.qty}{unitSuffix(item)}</strong></span>
            <span className="location">Prateleira {item.shelf} · {item.place}</span>
            {(item.low_stock || item.status === 'out') && <span className="item-alert"><span className={`stock-badge ${item.status === 'out' ? 'out' : 'low'}`}>{item.status === 'out' ? 'Esgotado' : 'Abaixo do mínimo'}{item.low_stock && <> · Mínimo: {item.minimum_safe_stock}{unitSuffix(item)}</>}</span></span>}
          </button>
        </li>)}</ul>
        {visible.length > 0 && <table className="inventory-table">
          <caption className="sr-only">Itens do inventário</caption>
          <thead><tr><th scope="col">Item</th><th scope="col">Localização</th><th scope="col">Categoria</th><th scope="col" className="numeric">Quantidade</th><th scope="col" className="numeric">Mínimo</th></tr></thead>
          <tbody>{visible.map(item => <tr key={item.id}>
            <td><button type="button" className="inventory-open" onClick={() => openItem(item)}>{item.name}</button></td>
            <td className="location">Prateleira {item.shelf} · {item.place}</td>
            <td>{item.category}</td>
            <td className="numeric"><strong className="quantity">{item.qty}{unitSuffix(item)}</strong>{(item.low_stock || item.status === 'out') && <span className="item-alert"><span className={`stock-badge ${item.status === 'out' ? 'out' : 'low'}`}>{item.status === 'out' ? 'Esgotado' : 'Abaixo do mínimo'}</span></span>}</td>
            <td className="numeric">{item.minimum_safe_stock}{unitSuffix(item)}</td>
          </tr>)}</tbody>
        </table>}
        </div>
      </>}
    </main>
    <dialog className="item-dialog" ref={dialog} aria-labelledby="detail-title" onCancel={event => { if (busy) event.preventDefault(); else { setSelected(null); setCreating(false); } }} onClose={() => { setSelected(null); setCreating(false); }}>
      <div className="detail-header"><h2 id="detail-title">{creating ? 'Cadastrar Item' : selected?.name}</h2><button disabled={busy} onClick={() => { setSelected(null); setCreating(false); }}>Fechar</button></div>
      <div className="detail-body" key={creating ? 'create' : selected?.id}>
      {feedback}
      {creating && <form onSubmit={event => form(event, async data => {
        const input = { ...Object.fromEntries(data), shelf: Number(data.get('shelf')), qty: Number(data.get('qty')), minimum_safe_stock: Number(data.get('minimum_safe_stock')), aliases: String(data.get('aliases')).split(',').map(text => text.trim()).filter(Boolean) };
        setNotice(await saveInventoryChange(
          () => db.rpc('create_item', { input }),
          item => { setCreating(false); setSelected(item); return 'Item cadastrado.'; }, load,
        ));
      })}><Field label="Nome" name="name" /><div className="grid"><Field label="Prateleira" name="shelf" type="number" min={1} /><label>Place (ex.: B03 ou W12)<input name="place" required pattern="[BW][0-9]{2,9}" /></label><Field label="Quantidade inicial" name="qty" type="number" /><Field label="Estoque mínimo" name="minimum_safe_stock" type="number" value={0} />{categorySelect()}<Field label="Aliases separados por vírgula" name="aliases" required={false} /></div><label>Observações e unidade de medida<textarea name="body" /></label><button disabled={busy}>Salvar Item</button></form>}
      {selected && !creating && <><p className="location">Prateleira {selected.shelf} · {selected.place} · {selected.category}</p><p><strong>Quantidade: {selected.qty}{unitSuffix(selected)}</strong> · Mínimo: {selected.minimum_safe_stock}{unitSuffix(selected)}</p><div className="stock-status">{selected.status === 'out' && <span className="stock-badge out">Esgotado</span>}{selected.low_stock && <span className="stock-badge low">Abaixo do mínimo</span>}</div>
        <fieldset disabled={busy}><legend>Movimentar quantidade</legend><form onSubmit={event => { const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement; form(event, data => mutate(submitter.value, data)); }}><Field label={`Quantidade a movimentar${unitSuffix(selected)}`} name="n" type="number" /><div className="buttons"><button value="take">Retirar</button><button value="add">Adicionar</button></div></form></fieldset>
        <details className="item-organization"><summary>Localização e categoria</summary>
        <fieldset disabled={busy}><legend>Mudar localização completa</legend><form key={`${selected.shelf}-${selected.place}`} onSubmit={event => form(event, data => mutate('relocate', data))}><div className="grid"><Field label="Prateleira" name="shelf" type="number" min={1} value={selected.shelf} /><label>Place (ex.: B03 ou W12)<input name="place" required pattern="[BW][0-9]{2,9}" defaultValue={selected.place} /></label></div><button>Mover Item</button></form></fieldset>
        <fieldset disabled={busy}><legend>Recategorizar</legend><form key={selected.category} onSubmit={event => form(event, data => mutate('recategorize', data))}>{categorySelect(selected.category)}<button>Salvar categoria</button></form></fieldset>
        </details>
        <h3>Observações e unidade de medida</h3><p>Aliases: {selected.aliases.join(', ') || 'Nenhum'}</p><ItemNote name={selected.name} body={selected.body} />
        <h3>Histórico recente</h3><p>Últimos 50 registros, do mais recente ao mais antigo.</p>{historyLoading ? <p role="status">Carregando histórico…</p> : <ol className="history">{history.map(movement => <li key={movement.id}>{new Date(movement.created_at).toLocaleString('pt-BR')} — {movementDescription(movement)}</li>)}</ol>}
      </>}
      </div>
    </dialog>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
