import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { changePassword } from '../server/change-password.mjs';
import { testClients as localClients, check } from './local.mjs';

const { admin, client } = localClients();
const password = randomBytes(24).toString('base64url');
const newPassword = randomBytes(24).toString('base64url');
const email = `password-${randomBytes(8).toString('hex')}@example.com`;
const { user } = check(await admin.auth.admin.createUser({ email, password, email_confirm: true }));
try {
  check(await admin.from('access_members').insert({ user_id: user.id }));
  const member = client();
  const { session } = check(await member.auth.signInWithPassword({ email, password }));
  const request = (body, token = session.access_token) => new Request('http://localhost/api/change-password', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await changePassword(request({ currentPassword: password, newPassword: password }), admin, client)).status, 400);
  assert.equal((await changePassword(request({ currentPassword: password, newPassword }, 'invalid-token'), admin, client)).status, 401);
  assert.equal((await changePassword(request({ currentPassword: 'incorrect', newPassword }), admin, client)).status, 403);
  const response = await changePassword(request({ currentPassword: password, newPassword }), admin, client);
  assert.equal(response.status, 200, (await response.json()).message);
  assert.equal(check(await member.rpc('access_state')), 'password_required', 'Old access token must not unlock data');
  assert.ok((await client().auth.refreshSession({ refresh_token: session.refresh_token })).error, 'Old refresh token revoked');
  assert.ok((await client().auth.signInWithPassword({ email, password })).error);
  const fresh = client();
  check(await fresh.auth.signInWithPassword({ email, password: newPassword }));
  assert.equal(check(await fresh.rpc('access_state')), 'ready');
  check(await admin.from('access_members').delete().eq('user_id', user.id));
  const freshSession = check(await fresh.auth.getSession()).session;
  assert.equal((await changePassword(request({ currentPassword: newPassword, newPassword: password }, freshSession.access_token), admin, client)).status, 403);
  console.log('PASS server password change, same-password rejection, wrong current password, old access/refresh blocked, fresh login ready');
} finally {
  check(await admin.auth.admin.deleteUser(user.id));
}
