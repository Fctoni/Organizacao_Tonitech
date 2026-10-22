import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient, OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { Confirmation, type Proposal } from './chat';
import { claudeRedirect, type McpIntent } from './mcp-intent';

export function McpRequest({ intent, db, onChanged, onOpen, onClose }: { intent: McpIntent; db: SupabaseClient; onChanged: () => Promise<void>; onOpen: (id: string) => void; onClose: () => void }) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [consent, setConsent] = useState<OAuthAuthorizationDetails | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Auth binds an authorization to the user on first read. Share that read across
  // StrictMode's effect restart instead of racing two binding transactions.
  const authorization = useRef<{ id: string; result: ReturnType<SupabaseClient['auth']['oauth']['getAuthorizationDetails']> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (intent.kind === 'proposal') {
        const session = (await db.auth.getSession()).data.session;
        const response = await fetch('/api/chat', { method: 'POST', headers: { authorization: `Bearer ${session?.access_token ?? ''}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'review', ticket: intent.value }) });
        const body = await response.json();
        if (!response.ok) throw new Error('Proposta inválida ou de outra conta.');
        if (!cancelled) setProposal(body.proposal);
      } else {
        if (authorization.current?.id !== intent.value) authorization.current = { id: intent.value, result: db.auth.oauth.getAuthorizationDetails(intent.value) };
        const { data, error } = await authorization.current.result;
        if (error || !data) throw new Error('Solicitação OAuth inválida ou expirada.');
        if (cancelled) return;
        if ('redirect_url' in data) { window.location.assign(claudeRedirect(data.redirect_url)); return; }
        if (data.redirect_uri !== 'https://claude.ai/api/mcp/auth_callback') throw new Error('Cliente OAuth não permitido.');
        setConsent(data);
      }
    }
    void load().catch(() => { if (!cancelled) setError('Não foi possível abrir a solicitação. Confira a conta ou solicite um novo link.'); });
    return () => { cancelled = true; };
  }, [intent, db]);
  async function decide(approve: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { data, error } = await db.auth.oauth[approve ? 'approveAuthorization' : 'denyAuthorization'](intent.value, { skipBrowserRedirect: true });
      if (error || !data) throw new Error();
      window.location.assign(claudeRedirect(data.redirect_url));
    } catch { setError('Não foi possível concluir o consentimento. Tente novamente.'); setBusy(false); }
  }
  return <section aria-label="Solicitação do Claude"><h2>{intent.kind === 'proposal' ? 'Revisar proposta do Claude' : 'Conectar Claude'}</h2>
    <p role="alert">{error}</p>
    {!proposal && !consent && !error && <p role="status">Carregando solicitação…</p>}
    {proposal && <Confirmation proposal={proposal} ticket={intent.value} db={db} onChanged={onChanged} onOpen={onOpen} />}
    {consent && <><p>Aplicativo: {consent.client.name}</p><p>Permissões de identidade: {consent.scope || 'Nenhuma adicional'}</p><p>O Claude poderá consultar e alterar estoque. A confirmação acontece na conversa com o Claude, sem abrir o app para cada alteração. O servidor não comprova essa confirmação humana.</p><button disabled={busy} onClick={() => void decide(true)}>Autorizar Claude</button><button disabled={busy} onClick={() => void decide(false)}>Negar acesso</button></>}
    <button disabled={busy} onClick={onClose}>Fechar solicitação</button>
  </section>;
}
