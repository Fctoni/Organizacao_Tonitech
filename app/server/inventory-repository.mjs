export const itemFields = 'id,name,shelf,place,qty,minimum_safe_stock,category,aliases,status,low_stock,updated_at';
const check = result => { if (result.error) throw new Error('Consulta indisponível. Tente novamente.'); return result.data; };

// Five fixed reads; search, pagination and proposal validation belong to inventoryTools.
export function supabaseInventory(db) {
  return {
    page: async (start, signal) => check(await db.from('items').select(itemFields).order('id').range(start, start + 499).abortSignal(signal)),
    item: async (id, signal) => check(await db.from('items').select(`${itemFields},body`).eq('id', id).abortSignal(signal).single()),
    categories: async signal => check(await db.from('categories').select('name').order('name').limit(50).abortSignal(signal)),
    category: async (name, signal) => check(await db.from('categories').select('name').eq('name', name).abortSignal(signal).single()),
    history: async (id, before, signal) => {
      let query = db.from('movements').select('id,item_id,action,requested,created_at,before_value,after_value').eq('item_id', id).order('id', { ascending: false }).limit(21);
      if (before) query = query.lt('id', before);
      return check(await query.abortSignal(signal));
    },
  };
}
