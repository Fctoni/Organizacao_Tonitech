import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';

export function mcpConfig(env = process.env) {
  const resource = new URL(env.MCP_RESOURCE_URL);
  const issuer = new URL(`${env.SUPABASE_URL}/auth/v1`);
  const local = env.NODE_ENV !== 'production' && resource.hostname === '127.0.0.1' && issuer.hostname === '127.0.0.1';
  if ((!local && (resource.protocol !== 'https:' || issuer.protocol !== 'https:')) || resource.pathname !== '/api/mcp' || resource.search || resource.hash || resource.username || resource.password || issuer.username || issuer.password || !env.MCP_CLIENT_ID) throw new Error('Configuração MCP inválida.');
  return { resource: resource.href, issuer: issuer.href, clientId: env.MCP_CLIENT_ID, origin: resource.origin,
    metadata: `${resource.origin}/.well-known/oauth-protected-resource/api/mcp` };
}

export const mcpKeys = config => createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`), { timeoutDuration: 5000, cooldownDuration: 30000 });

export async function verifyMcpToken(token, config, keys) {
  const { payload } = await jwtVerify(token, keys, { algorithms: ['ES256', 'RS256'], issuer: config.issuer, audience: config.resource,
    requiredClaims: ['sub', 'iat', 'exp', 'session_id', 'client_id', 'role'], maxTokenAge: 300, clockTolerance: 0 });
  if (payload.aud !== config.resource || payload.client_id !== config.clientId || payload.role !== 'anon' ||
      !z.uuid().safeParse(payload.sub).success || !z.uuid().safeParse(payload.session_id).success ||
      !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.exp <= payload.iat || payload.exp - payload.iat > 300) throw new Error('Token inválido.');
  // Only verified identity crosses the DB bridge; never the raw bearer or user_metadata.
  return { sub: payload.sub, iat: payload.iat, exp: payload.exp, session_id: payload.session_id, client_id: payload.client_id };
}
