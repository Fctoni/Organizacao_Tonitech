import { z } from 'zod';

// Zod 4.6 counts code points in max(); the editor's maxlength counts UTF-16 units.
const promptBody = z.string().trim().min(1).refine(body => body.length <= 12000);
const revision = z.object({ version: z.number().int().positive().max(2147483647), body: promptBody, canEdit: z.boolean() });
const settingsRequest = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('settings') }),
  z.strictObject({ action: z.literal('save-settings'), expectedVersion: z.number().int().positive().max(2147483647), body: promptBody }),
  z.strictObject({ action: z.literal('restore-settings'), expectedVersion: z.number().int().positive().max(2147483647), restoreVersion: z.number().int().positive().max(2147483647) }),
]);

export async function activePrompt(db) {
  const result = await db.rpc('assistant_prompt');
  if (result.error) throw new Error('Comportamento indisponível.');
  return revision.parse(result.data);
}

export async function assistantSettings(db, body) {
  const respond = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
  const parsed = settingsRequest.safeParse(body);
  if (!parsed.success) return respond({ message: 'Configuração inválida. Use de 1 a 12.000 unidades UTF-16; alguns símbolos contam duas.' }, 400);
  const input = parsed.data;
  const active = await db.rpc('assistant_prompt');
  if (active.error || !revision.safeParse(active.data).success) return respond({ message: 'Comportamento indisponível neste ambiente.' }, 503);
  if (input.action === 'settings') {
    const history = active.data.canEdit ? await db.rpc('assistant_prompt_history') : { data: [] };
    if (history.error) return respond({ message: 'Histórico indisponível.' }, 503);
    return respond({ active: active.data, history: history.data });
  }
  if (!active.data.canEdit) return respond({ message: 'Somente o responsável pode editar o comportamento.' }, 403);
  const result = await db.rpc('save_assistant_prompt', { expected_version: input.expectedVersion,
    new_body: input.action === 'save-settings' ? input.body : null,
    restore_version: input.action === 'restore-settings' ? input.restoreVersion : null });
  if (result.error) {
    const errors = { PT409: [409, 'Outra revisão foi salva. Seu texto foi preservado. Recarregue a versão ativa antes de salvar.'],
      '42501': [403, 'Somente o responsável com acesso liberado pode editar.'], '23514': [400, 'Use de 1 a 12.000 unidades UTF-16; alguns símbolos contam duas.'], '22023': [400, 'Revisão inválida.'] };
    const [status, message] = errors[result.error.code] ?? [503, 'Não foi possível salvar. Recarregue para verificar a versão ativa antes de tentar novamente.'];
    return respond({ message }, status);
  }
  return respond({ active: result.data });
}
