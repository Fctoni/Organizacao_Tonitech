// Only server-side callers provide the administrative client. Never log request bodies.
export async function changePassword(request, admin, client) {
  const reply = (status, message) => Response.json({ message }, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return reply(405, 'Método não permitido.');
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return reply(401, 'Entre novamente.');
  try {
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (error || !user?.email) return reply(401, 'Entre novamente.');
    const { data: member, error: membershipError } = await admin.from('access_members').select('user_id').eq('user_id', user.id).maybeSingle();
    if (membershipError || !member) return reply(403, 'Acesso não autorizado.');
    const { currentPassword, newPassword } = await request.json();
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' ||
        newPassword.length < 12 || newPassword.length > 128 || currentPassword.length > 128 || currentPassword === newPassword) {
      return reply(400, 'Use uma senha diferente, entre 12 e 128 caracteres.');
    }
    const proof = client();
    const { error: proofError } = await proof.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (proofError) return reply(403, 'Senha atual incorreta ou limite de tentativas atingido.');
    const { error: lockError } = await admin.from('access_members').update({ password_changed_at: null }).eq('user_id', user.id);
    if (lockError) return reply(503, 'Não foi possível iniciar a troca.');
    const { error: revokeError } = await admin.auth.admin.signOut(token, 'global');
    if (revokeError) return reply(503, 'Acesso permanece bloqueado. Entre novamente para tentar a troca.');
    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password: newPassword });
    if (updateError) return reply(400, 'Não foi possível alterar a senha. Entre novamente e tente outra senha.');
    // Require a JWT minted after this operation, not an old temporary-password session.
    const validAfter = new Date((Math.floor(Date.now() / 1000) + 1) * 1000).toISOString();
    const { error: unlockError } = await admin.from('access_members').update({ password_changed_at: validAfter }).eq('user_id', user.id);
    if (unlockError) return reply(503, 'Senha alterada; acesso permanece bloqueado. Contate o administrador.');
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(validAfter) - Date.now()) + 50));
    return reply(200, 'Senha alterada. Aguarde um instante e entre com a nova senha.');
  } catch {
    return reply(400, 'Não foi possível processar a troca de senha.');
  }
}
