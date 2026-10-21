import { randomBytes } from 'node:crypto';

// Deliberately not a CLI: the caller must deliver the returned password only in final chat.
// Do not invoke before independent review and approval of the dedicated remote project.
export async function provisionOwner(admin, { approvedProjectRef, actualProjectUrl }) {
  if (!/^[a-z]{20}$/.test(approvedProjectRef) || actualProjectUrl !== `https://${approvedProjectRef}.supabase.co` || admin.supabaseUrl !== actualProjectUrl) {
    throw new Error('Projeto dedicado não confirmado.');
  }
  const password = randomBytes(24).toString('base64url');
  const { data: { user }, error } = await admin.auth.admin.createUser({
    email: 'felipetonietto@gmail.com', password, email_confirm: true,
  });
  if (error) throw new Error('Não foi possível criar o usuário; nenhuma senha deve ser divulgada.');
  const { error: membershipError } = await admin.from('access_members').insert({ user_id: user.id });
  if (membershipError) {
    await admin.auth.admin.deleteUser(user.id);
    throw new Error('Associação falhou; conferir remoção do usuário antes de repetir.');
  }
  return { userId: user.id, password };
}
