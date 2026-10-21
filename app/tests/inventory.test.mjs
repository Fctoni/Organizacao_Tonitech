import test from 'node:test';
import assert from 'node:assert/strict';
import { selectItems } from '../src/inventory.ts';

test('Busca por aliases sem acento e filtros combinados; Place ordena numericamente', () => {
  const items = [
    { name: 'B', aliases: ['MÓDULO'], shelf: 2, place: 'B100', category: 'Tools', qty: 0, minimum_safe_stock: 1, status: 'out', low_stock: true },
    { name: 'A', aliases: ['módulo'], shelf: 2, place: 'B99', category: 'Tools', qty: 3, minimum_safe_stock: 1, status: 'in_stock', low_stock: false },
    { name: 'C', aliases: [], shelf: 1, place: 'W01', category: 'Electronics', qty: 1, minimum_safe_stock: 0, status: 'in_stock', low_stock: false },
  ];
  assert.deepEqual(selectItems(items, { query: 'modulo' }).map(x => x.name), ['A','B']);
  assert.deepEqual(selectItems(items, { category: 'Tools', shelf: '2', surface: 'B', place: 'B100', status: 'out', lowStock: true }).map(x => x.name), ['B']);
  assert.equal(selectItems(items, { shelf: '1', surface: 'B' }).length, 0);
});
