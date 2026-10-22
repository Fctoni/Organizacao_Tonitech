export type McpIntent = { kind: 'proposal' | 'consent'; value: string };

// Memory only: survives login/password change in this SPA, not closing/reloading the tab.
export function captureMcpIntent(location: Pick<Location, 'href'>, history: Pick<History, 'replaceState'>): McpIntent | null {
  const url = new URL(location.href);
  const ticket = new URLSearchParams(url.hash.slice(1)).get('proposal');
  const authorization = url.pathname === '/oauth/consent' ? url.searchParams.get('authorization_id') : null;
  if (ticket !== null || authorization !== null) {
    url.hash = ''; url.searchParams.delete('authorization_id');
    history.replaceState(null, '', url.pathname + url.search);
  }
  if (ticket && ticket.length <= 24000) return { kind: 'proposal', value: ticket };
  if (authorization && /^[\w-]{1,200}$/.test(authorization)) return { kind: 'consent', value: authorization };
  return null;
}

export function claudeRedirect(value: string): string {
  const url = new URL(value);
  if (url.origin !== 'https://claude.ai' || url.pathname !== '/api/mcp/auth_callback' || url.username || url.password || url.hash) throw new Error('Retorno OAuth inválido.');
  return url.href;
}
