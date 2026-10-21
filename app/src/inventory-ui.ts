import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { Item } from './inventory';

type MovementValue = Pick<Item, 'qty' | 'shelf' | 'place' | 'category'>;
export type Movement = { id: number; action: string; requested: number | null; created_at: string; before_value: MovementValue | null; after_value: MovementValue };
const actionNames: Record<string, string> = { take: 'Retirada', add: 'Entrada', create: 'Cadastro', relocate: 'Mudança de localização', recategorize: 'Categoria alterada', import: 'Importação' };

export function movementDescription(movement: Movement): string {
  const category = movement.action === 'recategorize' ? ` · ${movement.before_value?.category ?? 'Não registrada'} → ${movement.after_value.category}` : '';
  return `${actionNames[movement.action] ?? movement.action}${movement.requested !== null ? ` (${movement.requested})` : ''} · Quantidade: ${movement.after_value.qty} · ${movement.after_value.shelf}/${movement.after_value.place}${category}`;
}

// Keep Auth callbacks synchronous; query access only after Auth releases its lock.
export function observeInventoryAccess(db: Pick<SupabaseClient, 'auth' | 'rpc'>, view: {
  session: (session: Session | null) => void;
  access: (access: string) => void;
  reset: () => void;
}) {
  let version = 0;
  let userId: string | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const { data } = db.auth.onAuthStateChange((_event, next) => {
    const current = ++version;
    clearTimeout(timer);
    view.session(next);
    if (!next || next.user.id !== userId) {
      view.reset();
      view.access(next ? 'loading' : 'login');
    }
    userId = next?.user.id;
    if (!next) return;
    timer = setTimeout(async () => {
      let access = 'error';
      try {
        const result = await db.rpc('access_state');
        if (!result.error && ['ready', 'password_required', 'denied'].includes(result.data)) access = result.data;
      } catch { /* Failed access checks close the inventory rather than retaining authorization. */ }
      if (current !== version) return;
      if (access !== 'ready') view.reset();
      view.access(access);
    }, 0);
  });
  return () => { ++version; clearTimeout(timer); data.subscription.unsubscribe(); };
}

export async function saveInventoryChange<T>(
  save: () => PromiseLike<{ data: T; error: unknown }>,
  confirmed: (data: T) => string,
  reload: () => Promise<void>,
): Promise<string> {
  const result = await save();
  if (result.error) throw result.error;
  const message = confirmed(result.data);
  try { await reload(); } catch {
    return `${message} A alteração já foi salva, mas não foi possível atualizar a lista. Feche os detalhes e use Atualizar para consultar novamente; não repita a operação.`;
  }
  return message;
}
