// Default is read-only. --apply patches only OAuth/hook fields after migrations,
// registration and the private binding have been provisioned by the administrator.
import { remoteClients } from './remote.mjs';

const ref = 'pfhfhrypxncgzmnmlztm';
const resource = 'https://tonitech-inventario.vercel.app/api/mcp';
const hook = 'pg-functions://postgres/inventory_auth/custom_access_token';
const apply = process.argv.includes('--apply');
async function main() {
  if (process.env.INVENTORY_PROJECT_REF !== ref || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Confirme o projeto dedicado e forneça o token de Management pelo ambiente privado.');
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, { method, headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Management HTTP ${response.status}; detalhes suprimidos.`);
    return response.json();
  };
  const project = await call('');
  if (project.name !== 'Tonitech-Inventario' || project.organization_id !== 'msxuixhofofwiecxcvkr') throw new Error('Projeto inesperado.');
  const config = await call('/config/auth');
  const jwks = await (await fetch(`https://${ref}.supabase.co/auth/v1/.well-known/jwks.json`)).json();
  const asymmetric = jwks.keys?.some(key => ['ES256', 'RS256'].includes(key.alg));
  console.log(JSON.stringify({ asymmetricJwks: !!asymmetric, oauthEnabled: config.oauth_server_enabled, dynamicRegistration: config.oauth_server_allow_dynamic_registration, hookMatches: config.hook_custom_access_token_uri === hook, consentPathMatches: config.oauth_server_authorization_path === '/oauth/consent' }));
  if (!apply) return;
  if (!asymmetric || config.site_url !== new URL(resource).origin) throw new Error('JWKS/Site URL ainda não preparados.');
  if (config.hook_custom_access_token_uri && config.hook_custom_access_token_uri !== hook) throw new Error('Existe outro hook; reconciliação administrativa necessária.');
  if (config.oauth_server_enabled && config.oauth_server_authorization_path && config.oauth_server_authorization_path !== '/oauth/consent') throw new Error('Existe outro fluxo OAuth; reconciliação administrativa necessária.');
  const clientId = process.env.MCP_CLIENT_ID;
  if (!clientId) throw new Error('Pré-registre o cliente público e defina MCP_CLIENT_ID.');
  const { admin } = remoteClients();
  const { data, error } = await admin.auth.admin.oauth.getClient(clientId);
  if (error || data?.client_type !== 'public' || data?.token_endpoint_auth_method !== 'none' || data?.redirect_uris?.length !== 1 || data.redirect_uris[0] !== 'https://claude.ai/api/mcp/auth_callback') throw new Error('Cliente pré-registrado incompatível.');
  const binding = await call('/database/query', 'POST', { query: 'select client_id,resource from inventory_auth.mcp_client where singleton' });
  if (binding.length !== 1 || binding[0].client_id !== clientId || binding[0].resource !== resource) throw new Error('Binding privado não coincide; aplique a migration e configure o cliente antes do hook.');
  const patch = { oauth_server_enabled: true, oauth_server_allow_dynamic_registration: false, oauth_server_authorization_path: '/oauth/consent', hook_custom_access_token_enabled: true, hook_custom_access_token_uri: hook };
  await call('/config/auth', 'PATCH', patch);
  const updated = await call('/config/auth');
  if (Object.entries(patch).some(([key, value]) => updated[key] !== value)) throw new Error('Configuração não confirmada.');
  console.log('OAuth/hook conferidos. Demais campos Auth preservados.');
}
await main().catch(error => { console.error(error.message); process.exitCode = 1; });
