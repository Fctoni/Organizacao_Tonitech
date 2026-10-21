import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null } });
after(() => server.close());
const { ChatMessageParts } = await server.ssrLoadModule('/src/chat.tsx');
export const item = { id: '11111111-1111-4111-8111-111111111111', name: 'Dog Food fixture', qty: 1, minimum_safe_stock: 2, shelf: 26, place: 'B04', category: 'Uncategorized', status: 'in_stock', low_stock: true, body: 'Unidade: pacotes.', aliases: [] };
const tool = (name, output, id = name) => ({ type: `tool-${name}`, toolCallId: id, state: 'output-available', input: {}, output });
const text = text => ({ type: 'text', text });
const render = (parts, busy = false, responseComplete = true) => renderToStaticMarkup(createElement(ChatMessageParts, { message: { id: 'answer', role: 'assistant', parts, metadata: { responseComplete } }, busy, db: {}, onOpen() {}, async onChanged() {} }));

test('buscas por nome/alias, getItem e zero consolidam um cartão na resposta real', () => {
  const html = render([tool('searchItems', { items: [item], total: 1 }, 'name'), tool('searchItems', { items: [item], total: 1 }, 'alias'), tool('getItem', { item }), tool('searchItems', { items: [], total: 0 }, 'zero'), text('Está abaixo do mínimo.')]);
  assert.equal((html.match(/Abrir Item/g) ?? []).length, 1);
  assert.doesNotMatch(html, /\d resultados\./);
  assert.match(html, /Está abaixo do mínimo/);
});

test('preserva ordem de múltiplos UUIDs, saldo mais recente e respostas independentes', () => {
  const other = { ...item, id: '22222222-2222-4222-8222-222222222222', name: 'Outro Item' };
  const html = render([tool('searchItems', { items: [item, other], total: 2 }), tool('getItem', { item: { ...item, qty: 7, low_stock: false } })]);
  assert.equal((html.match(/Abrir Item/g) ?? []).length, 2);
  assert.ok(html.indexOf(item.name) < html.indexOf(other.name));
  assert.match(html, /Quantidade: 7/);
  assert.doesNotMatch(html.slice(0, html.indexOf(other.name)), /Quantidade: 1/);
  assert.equal((`${render([tool('getItem', { item })])}${html}`.match(/Dog Food fixture/g) ?? []).length, 2);
  assert.match(html, /<details><summary>Detalhes técnicos<\/summary><small>UUID:/);
});

test('zero fica explícito somente ao terminar; falhas e resultados parciais continuam úteis', () => {
  const zero = tool('searchItems', { items: [], total: 0 });
  const error = { type: 'tool-getItem', toolCallId: 'error', state: 'output-error', errorText: 'private SQL' };
  assert.match(render([zero]), /Nenhum Item encontrado/);
  assert.doesNotMatch(render([zero], true, false), /Nenhum Item|0 resultados/);
  assert.doesNotMatch(render([zero], false, false), /Nenhum Item/);
  assert.match(render([zero], false, false), /Resposta não concluída/);
  const pending = { type: 'tool-searchItems', toolCallId: 'pending', state: 'input-available', input: {} };
  assert.doesNotMatch(render([zero, pending]), /Nenhum Item/);
  assert.match(render([zero, error]), /A consulta não foi concluída/);
  assert.doesNotMatch(render([zero, error]), /Nenhum Item|private SQL/);
  const partial = render([tool('getItem', { item }), error, text('Tente refinar a busca.')]);
  assert.match(partial, /Dog Food fixture/);
  assert.match(partial, /A consulta não foi concluída/);
  assert.match(partial, /Tente refinar/);
  assert.match(render([text('Resposta interrompida; informe o nome.')]), /Resposta interrompida/);
});

test('resposta incompleta orienta repetir a pergunta sem exigir UUID; resposta vazia é explícita', () => {
  const partial = render([], false, false);
  assert.match(partial, /Tente a pergunta novamente/);
  assert.doesNotMatch(partial, /Informe nome ou UUID/);
  const empty = renderToStaticMarkup(createElement(ChatMessageParts, { message: { id: 'empty', role: 'assistant', parts: [], metadata: { responseIssue: 'empty' } }, db: {}, onOpen() {}, async onChanged() {} }));
  assert.match(empty, /O assistente não retornou conteúdo/);
});

test('paginação, categorias, histórico e proposta permanecem na ordem com ação explícita', () => {
  const proposal = { id: 'proposal-fixture', expiresAt: 2000000000000, requestText: 'Retire um pacote', operation: { action: 'take', item_id: item.id, input: { n: 1 } }, item };
  const html = render([tool('searchItems', { items: [item], total: 21, nextOffset: 20 }), text('Revise antes de confirmar.'), tool('proposeChange', { proposal, ticket: 'fixture-ticket' }), tool('categories', { categories: ['Tools'] }), tool('history', { movements: [], nextBefore: 12 })]);
  assert.match(html, /offset 20/);
  assert.match(html, /Categorias: Tools/);
  assert.match(html, /anteriores ao ID 12/);
  assert.match(html, /Quantidade a retirar: 1/);
  assert.match(html, /Confirmar alteração/);
  assert.match(html, /Descartar/);
  assert.ok(html.indexOf('Revise antes') < html.indexOf('Pedido:'));
  assert.doesNotMatch(html, /fixture-ticket|Alteração registrada/);
});
