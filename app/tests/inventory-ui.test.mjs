import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { observeInventoryAccess, saveInventoryChange, movementDescription } from '../src/inventory-ui.ts';

function accessFixture() {
  let listener;
  let accessResult = async () => ({ data: 'ready', error: null });
  const view = { session: null, access: 'loading', draft: null, resets: 0 };
  const stop = observeInventoryAccess({
    auth: { onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() { listener = null; } } } }; } },
    rpc(name) { assert.equal(name, 'access_state'); return accessResult(); },
  }, {
    session(value) { view.session = value; },
    access(value) { view.access = value; },
    reset() { view.draft = null; view.resets++; },
  });
  return { view, stop, emit: (event, session) => listener(event, session), result: callback => { accessResult = callback; } };
}

test('R1: renovação e reconfirmação da mesma identidade preservam o formulário e atualizam o token', async t => {
  const app = accessFixture();
  t.after(app.stop);
  app.emit('SIGNED_IN', { user: { id: 'owner' }, access_token: 'initial' });
  await wait(0);
  const resets = app.view.resets;
  for (const event of ['TOKEN_REFRESHED', 'SIGNED_IN', 'USER_UPDATED']) {
    app.view.draft = { item: 'Item em edição', n: '3', place: 'W05' };
    const draft = app.view.draft;
    app.emit(event, { user: { id: 'owner' }, access_token: event });
    assert.equal(app.view.access, 'ready');
    assert.equal(app.view.draft, draft);
    await wait(0);
    assert.equal(app.view.session.access_token, event);
    assert.equal(app.view.draft, draft);
    assert.equal(app.view.resets, resets);
  }
});

test('R1: sair, trocar identidade ou perder autorização descarta o formulário', async t => {
  const app = accessFixture();
  t.after(app.stop);
  const owner = { user: { id: 'owner' } };
  app.emit('INITIAL_SESSION', owner);
  await wait(0);
  app.view.draft = { creating: true };
  app.emit('SIGNED_OUT', null);
  assert.equal(app.view.access, 'login');
  assert.equal(app.view.draft, null);
  app.emit('SIGNED_IN', owner);
  await wait(0);
  app.view.draft = { selected: 'Item' };
  app.emit('SIGNED_IN', { user: { id: 'other' } });
  assert.equal(app.view.access, 'loading');
  assert.equal(app.view.draft, null);
  await wait(0);
  for (const access of ['denied', 'password_required', 'error']) {
    app.view.draft = { selected: 'Item' };
    app.result(async () => {
      if (access === 'error') throw new Error('Sem conexão');
      return { data: access, error: null };
    });
    app.emit('TOKEN_REFRESHED', { user: { id: 'other' } });
    await wait(0);
    assert.equal(app.view.access, access);
    assert.equal(app.view.draft, null);
  }
});

test('R1: verificação pendente não restaura acesso após saída ou desmontagem', async () => {
  for (const finish of ['signOut', 'unmount']) {
    const app = accessFixture();
    let resolve;
    app.result(() => new Promise(done => { resolve = done; }));
    app.emit('SIGNED_IN', { user: { id: 'owner' } });
    await wait(0);
    if (finish === 'signOut') app.emit('SIGNED_OUT', null);
    else app.stop();
    const before = { ...app.view };
    resolve({ data: 'ready', error: null });
    await wait(0);
    assert.deepEqual(app.view, before);
    app.stop();
  }
});

test('R2: falha da consulta posterior não transforma cadastro ou movimentação confirmados em falha', async () => {
  for (const action of ['create', 'take', 'add', 'relocate', 'recategorize']) {
    let writes = 0;
    let confirmed;
    const item = { id: 'item', qty: 7 };
    const success = action === 'create' ? 'Item cadastrado.' : 'Alteração registrada.';
    const notice = await saveInventoryChange(
      async () => { writes++; return { data: item, error: null }; },
      value => { confirmed = value; return success; },
      async () => { throw new Error('Consulta indisponível'); },
    );
    assert.equal(writes, 1, action);
    assert.equal(confirmed, item, action);
    assert.ok(notice.startsWith(success), action);
    assert.match(notice, /já foi salva/);
    assert.match(notice, /Atualizar/);
    assert.doesNotMatch(notice, /Não foi possível concluir/);
  }
});

test('R2: falha de gravação não confirma nem consulta; sucesso mantém aviso de retirada excedente', async () => {
  const failure = { code: '42501' };
  for (const save of [async () => ({ data: null, error: failure }), async () => { throw failure; }]) {
    await assert.rejects(saveInventoryChange(save,
      () => assert.fail('Não deve confirmar gravação recusada'),
      async () => assert.fail('Não deve consultar após gravação recusada'),
    ), error => error === failure);
  }
  const warning = 'Retirada maior que a quantidade disponível. Quantidade ajustada para zero.';
  const events = [];
  assert.equal(await saveInventoryChange(
    async () => { events.push('save'); return { data: { qty: 0 }, error: null }; },
    item => { events.push('confirmed'); assert.equal(item.qty, 0); return warning; },
    async () => { events.push('reload'); },
  ), warning);
  assert.deepEqual(events, ['save', 'confirmed', 'reload']);
  assert.ok((await saveInventoryChange(
    async () => ({ data: { qty: 0 }, error: null }), () => warning,
    async () => { throw new Error('offline'); },
  )).startsWith(warning));
});

test('R3: histórico usa categorias anterior e posterior dos snapshots de cada recategorização', () => {
  const snapshot = { qty: 3, shelf: 2, place: 'W05' };
  const movement = { action: 'recategorize', requested: null,
    before_value: { ...snapshot, category: 'Tools' }, after_value: { ...snapshot, category: 'Hardware' } };
  assert.match(movementDescription(movement), /Categoria alterada.*Tools → Hardware/);
  assert.match(movementDescription({ ...movement,
    before_value: movement.after_value, after_value: { ...snapshot, category: 'Electronics' },
  }), /Hardware → Electronics/);
  assert.match(movementDescription({ ...movement, action: 'create', before_value: null }), /Cadastro.*Quantidade: 3.*2\/W05/);
});
