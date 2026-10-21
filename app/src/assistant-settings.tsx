import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type Revision = { version: number; body: string; author: string | null; created_at: string; restored_from: number | null; canEdit?: boolean };

export function AssistantSettings({ db }: { db: SupabaseClient }) {
  const [active, setActive] = useState<Revision>();
  const [history, setHistory] = useState<Revision[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  async function request(input: object) {
    const { data } = await db.auth.getSession();
    const response = await fetch('/api/chat', { method: 'POST', headers: { authorization: `Bearer ${data.session?.access_token ?? ''}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
    const result = await response.json();
    if (!response.ok) { if (response.status === 409) setConflict(true); throw new Error(result.message ?? 'Configurações indisponíveis.'); }
    return result;
  }
  async function load(preserveDraft = false) {
    setBusy(true); setMessage('');
    try {
      const result = await request({ action: 'settings' });
      setActive(result.active); setHistory(result.history); setConflict(false);
      if (!preserveDraft || !result.active.canEdit) setBody(result.active.body);
      if (preserveDraft && result.active.canEdit) setMessage('Versão ativa recarregada. Seu rascunho foi preservado; compare antes de salvar.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha de conexão.'); }
    finally { setBusy(false); }
  }
  async function save(restoreVersion?: number) {
    if (!active || busy || conflict) return;
    setBusy(true); setMessage('');
    try {
      const result = await request(restoreVersion === undefined
        ? { action: 'save-settings', expectedVersion: active.version, body }
        : { action: 'restore-settings', expectedVersion: active.version, restoreVersion });
      setActive(result.active); setBody(result.active.body);
      setHistory(previous => [result.active, ...previous]);
      setMessage(`Revisão ${result.active.version} ativa. Será usada a partir da próxima pergunta.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha de conexão.'); }
    finally { setBusy(false); }
  }
  return <details className="assistant-settings" onToggle={event => { if (event.currentTarget.open && !active && !busy) void load(); }}>
    <summary>Configurações · Assistente</summary>
    <p>Comportamento do assistente do inventário. As regras técnicas de acesso, ferramentas e confirmação permanecem obrigatórias.</p>
    {active && <>
      <p>Versão ativa: {active.version} · {new Date(active.created_at).toLocaleString('pt-BR')}</p>
      <p>Autor: {active.author ?? 'Configuração inicial'}</p>
      {!active.canEdit && <p>Somente leitura. Apenas o responsável pode editar e consultar o histórico.</p>}
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label>Comportamento<textarea rows={10} maxLength={12000} value={body} readOnly={!active.canEdit} disabled={busy} onChange={event => setBody(event.target.value)} /></label>
        {active.canEdit && <><small>{body.length}/12.000 unidades UTF-16 (alguns símbolos, como emojis, contam duas). Espaços nas extremidades são removidos ao salvar.</small><button disabled={busy || conflict || !body.trim() || body.trim().length > 12000 || body === active.body}>Salvar nova revisão</button></>}
      </form>
      {active.canEdit && <><details><summary>Texto da versão ativa</summary><p className="prompt-text">{active.body}</p></details>
        <h4>Histórico de revisões</h4><ol>{history.map(revision => <li key={revision.version}>
          <details><summary>Revisão {revision.version} · {new Date(revision.created_at).toLocaleString('pt-BR')}</summary>
            <p>Autor: {revision.author ?? 'Configuração inicial'}{revision.restored_from != null && ` · Restaurada da revisão ${revision.restored_from}`}</p>
            <p className="prompt-text">{revision.body}</p>
            <button disabled={busy || conflict || revision.version === active.version} onClick={() => void save(revision.version)}>Restaurar revisão {revision.version} como nova</button>
          </details></li>)}</ol></>}
    </>}
    <button disabled={busy} onClick={() => void load(!!active?.canEdit)}>Recarregar versão ativa</button>
    <p role="status">{busy ? 'Carregando…' : message}</p>
  </details>;
}
