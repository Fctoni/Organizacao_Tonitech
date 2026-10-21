export interface Item {
  id: string; name: string; shelf: number; place: string; qty: number;
  minimum_safe_stock: number; category: string; aliases: string[]; body: string;
  status: 'in_stock' | 'out'; low_stock: boolean;
}
export interface Filters {
  query?: string; category?: string; shelf?: string; surface?: string;
  place?: string; status?: string; lowStock?: boolean;
}
const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
export function selectItems(items: Item[], filters: Filters): Item[] {
  return items.filter(item =>
    (!filters.query || [item.name, ...item.aliases].some(text => fold(text).includes(fold(filters.query!)))) &&
    (!filters.category || item.category === filters.category) &&
    (!filters.shelf || item.shelf === Number(filters.shelf)) &&
    (!filters.surface || item.place.startsWith(filters.surface)) &&
    (!filters.place || item.place === filters.place) &&
    (!filters.status || item.status === filters.status) &&
    (!filters.lowStock || item.low_stock)
  ).sort((a, b) => a.shelf - b.shelf || a.place[0].localeCompare(b.place[0]) ||
    Number(a.place.slice(1)) - Number(b.place.slice(1)) || a.name.localeCompare(b.name, 'pt-BR'));
}
