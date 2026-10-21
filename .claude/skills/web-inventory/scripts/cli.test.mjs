import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat, rm, mkdir, cp, chmod, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = fileURLToPath(new URL('./inventory.mjs', import.meta.url));
function run(args, { env = {}, input = '', script = cli, cwd, executable = process.execPath } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [script, ...args], { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('help vivo funciona sem configuração ou rede', async () => {
  const result = await run(['--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /auth login/);
  assert.match(result.stdout, /history/);
  assert.equal(result.stderr, '');
});

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'web inventory '));
  const requests = [];
  const state = { access: 'ready', expired: false, authError: false };
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const url = new URL(req.url, 'http://localhost');
    requests.push({ path: url.pathname, query: url.searchParams, body, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/auth/v1/token') {
      if (state.authError) { res.writeHead(400); res.end(JSON.stringify({ message: 'password-secret refresh-secret' })); return; }
      res.end(JSON.stringify({ access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: state.expired ? 0 : 3600 }));
    } else if (url.pathname === '/rest/v1/rpc/access_state') res.end(JSON.stringify(state.access));
    else if (url.pathname === '/auth/v1/logout') { res.writeHead(204); res.end(); }
    else if (state.handle) state.handle(req, res, url, body);
    else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(home, { recursive: true, force: true }); });
  const env = { XDG_CONFIG_HOME: home };
  const command = (args, input) => run(args, { env, input: input ? JSON.stringify(input) : '' });
  const configure = () => command(['auth', 'configure', '--stdin'], { url: `http://127.0.0.1:${server.address().port}`, publicKey: 'sb_publishable_fixture' });
  const login = () => command(['auth', 'login', '--stdin'], { email: 'fixture@example.test', password: 'password-secret' });
  return { home, command, configure, login, requests, state, url: `http://127.0.0.1:${server.address().port}` };
}

test('auth privada: login, refresh, status, rejeição pendente e logout local', async t => {
  const f = await fixture(t);
  assert.equal((await f.configure()).code, 0);
  f.state.expired = true;
  const login = await f.login();
  assert.equal(login.code, 0, login.stderr);
  const path = join(f.home, 'tonitech-inventory/session.json');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(f.home, 'tonitech-inventory'))).mode & 0o777, 0o700);
  assert.doesNotMatch(await readFile(path, 'utf8'), /password-secret/);
  f.state.expired = false;
  assert.equal((await f.command(['auth', 'status'])).code, 0);
  assert.ok(f.requests.some(r => r.query.get('grant_type') === 'refresh_token'));
  f.state.access = 'password_required';
  const pending = await f.command(['list']);
  assert.equal(pending.code, 1);
  assert.match(pending.stderr, /password_required/);
  assert.equal(f.requests.filter(r => r.path === '/rest/v1/items').length, 0);
  const logout = await f.command(['auth', 'logout']);
  assert.equal(logout.code, 0, logout.stderr);
  assert.equal(f.requests.at(-1).query.get('scope'), 'local');
  assert.doesNotMatch(await readFile(path, 'utf8'), /access-secret|refresh-secret/);
  const rejected = await f.login();
  assert.equal(rejected.code, 1);
  assert.doesNotMatch(await readFile(path, 'utf8'), /access-secret|refresh-secret/);
  f.state.authError = true;
  const bad = await f.login();
  assert.equal(bad.code, 1);
  for (const output of [login, pending, logout, rejected, bad]) assert.doesNotMatch(output.stdout + output.stderr, /password-secret|refresh-secret|access-secret/);
});

const id = '12345678-1234-1234-1234-123456789012';
const item = { id, name: 'Módulo', aliases: ['AÇÚCAR'], shelf: 2, place: 'B03', qty: 2, minimum_safe_stock: 3, category: 'Electronics', status: 'in_stock', low_stock: true, body: 'Unidade: peças.' };
test('leituras paginam além do limite do servidor e reutilizam busca por aliases e filtros', async t => {
  const f = await fixture(t);
  const items = [
    { ...item, id: '02345678-1234-1234-1234-123456789012', name: 'Outro', aliases: [], shelf: 1 },
    item,
    { ...item, id: '22345678-1234-1234-1234-123456789012', name: 'Açúcar extra', aliases: [], place: 'W04', qty: 0, status: 'out' },
  ];
  f.state.handle = (req, res, url) => {
    const table = url.pathname.split('/').at(-1);
    let rows = table === 'items' ? items : table === 'categories' ? [{ name: 'Electronics' }, { name: 'Tools' }] : [{ id: 3, item_id: id }, { id: 2, item_id: id }, { id: 1, item_id: id }];
    for (const field of ['id', 'name', 'item_id']) {
      const filter = url.searchParams.get(field);
      if (filter) {
        const [op, ...rest] = filter.split('.');
        // PostgREST scalar filters retain quotes; quoted UUIDs fail PostgreSQL's cast.
        const value = rest.join('.');
        if (table === 'items' && field === 'id' && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) {
          res.writeHead(400); res.end(JSON.stringify({ code: '22P02' })); return;
        }
        rows = rows.filter(row => op === 'eq' ? String(row[field]) === value : op === 'gt' ? row[field] > value : row[field] < value);
      }
    }
    res.end(JSON.stringify(rows.slice(0, 1))); // Server cap smaller than requested page size.
  };
  await f.configure(); await f.login();
  const find = await f.command(['find', 'ACUCAR', '--limit', '1', '--offset', '1']);
  assert.equal(find.code, 0, find.stderr);
  const found = JSON.parse(find.stdout).data;
  assert.equal(found.total, 2); assert.equal(found.items[0].place, 'W04'); assert.equal(found.has_more, false);
  for (const filters of [
    ['--category', 'Electronics', '--shelf', '2', '--surface', 'B', '--place', 'B03', '--status', 'in_stock', '--low-stock'],
    ['--status', 'out'],
  ]) {
    const result = await f.command(['list', ...filters]);
    assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).data.total, 1);
  }
  const show = await f.command(['show', id]);
  assert.deepEqual(JSON.parse(show.stdout).data, item);
  const categories = await f.command(['categories']);
  assert.deepEqual(JSON.parse(categories.stdout).data, [{ name: 'Electronics' }, { name: 'Tools' }]);
  const history = await f.command(['history', id, '--limit', '1', '--offset', '1']);
  assert.equal(history.code, 0, history.stderr);
  assert.deepEqual(JSON.parse(history.stdout).data.movements, [{ id: 2, item_id: id }]);
  assert.equal(JSON.parse(history.stdout).data.has_more, true);
});

test('Place normaliza zeros em list/find/create/relocate e preserva limites de entrada', async t => {
  const f = await fixture(t);
  let canonical;
  f.state.handle = (req, res, url, body) => {
    if (url.pathname.endsWith('/items')) {
      res.end(JSON.stringify(url.searchParams.has('id') ? [] : [{ ...item, place: canonical }]));
    } else {
      const written = { ...item, ...body.input };
      res.end(JSON.stringify(url.pathname.endsWith('create_item') ? written : { item: written, warning: false }));
    }
  };
  await f.configure(); await f.login();
  const commands = place => [
    ['list', '--place', place], ['find', 'ACUCAR', '--place', place],
    ['create', '--name', 'Módulo', '--shelf', '2', '--place', place, '--qty', '2', '--category', 'Electronics'],
    ['relocate', id, '--shelf', '2', '--place', place],
  ];
  for (const [input, expected] of [
    ['B003', 'B03'], ['W003', 'W03'], ['W000000003', 'W03'],
    ['B000000123', 'B123'], ['B999999999', 'B999999999'], ['W999999999', 'W999999999'],
  ]) {
    canonical = expected;
    for (const args of commands(input)) {
      const result = await f.command(args);
      assert.equal(result.code, 0, result.stderr);
      const data = JSON.parse(result.stdout).data;
      if (['list', 'find'].includes(args[0])) {
        assert.equal(data.total, 1, `${args[0]} --place ${input} deve encontrar ${expected}`);
        assert.equal(data.items[0].place, expected);
      } else {
        assert.equal(f.requests.at(-1).body.input.place, expected);
        assert.equal(data.item.place, expected);
      }
    }
  }
  const before = f.requests.length;
  for (const place of ['B3', 'W3', 'B000', 'W000', 'B0000000003', 'W0000000003', 'B1000000000', 'W1000000000']) {
    for (const args of commands(place)) {
      const result = await f.command(args);
      assert.equal(result.code, 1, args.join(' '));
      assert.match(result.stderr, /invalid_args/);
    }
  }
  assert.equal(f.requests.length, before);
});

test('escritas usam RPCs e UUID; preservam avisos e não repetem resposta perdida/5xx/inválida', async t => {
  const f = await fixture(t);
  let mode = 'ok';
  f.state.handle = (req, res, url, body) => {
    if (mode === 'disconnect') { req.socket.destroy(); return; }
    if (mode === 'server') { res.writeHead(503); res.end('{}'); return; }
    if (mode === 'invalid') { res.end('{'); return; }
    if (mode === 'shape') { res.end('{}'); return; }
    if (mode === 'rejected') { res.writeHead(400); res.end(JSON.stringify({ code: '23503', message: 'access-secret' })); return; }
    res.end(JSON.stringify(url.pathname.endsWith('create_item') ? { ...item, ...body.input } : { item: { ...item, qty: body.action === 'take' ? 0 : 5 }, warning: body.action === 'take' }));
  };
  await f.configure(); await f.login();
  const commands = [
    ['create', '--name', 'Módulo', '--shelf', '2', '--place', 'B03', '--qty', '2', '--category', 'Electronics', '--aliases', '["AÇÚCAR"]', '--minimum-safe-stock', '3', '--body', 'Unidade: peças.'],
    ['take', id, '--n', '9'], ['add', id, '--n', '3'], ['relocate', id, '--shelf', '3', '--place', 'W12'], ['recategorize', id, '--category', 'Tools'],
  ];
  for (const args of commands) {
    const before = f.requests.length;
    const result = await f.command(args);
    assert.equal(result.code, 0, result.stderr);
    const sent = f.requests.slice(before).filter(r => /create_item|mutate_item/.test(r.path));
    assert.equal(sent.length, 1);
    assert.ok(!sent[0].path.endsWith('/items'));
    if (args[0] === 'create') assert.deepEqual(sent[0].body.input, { name: item.name, shelf: 2, place: 'B03', qty: 2, category: 'Electronics', aliases: item.aliases, minimum_safe_stock: 3, body: item.body });
    else { assert.equal(sent[0].body.item_id, id); assert.equal(sent[0].body.action, args[0]); }
    if (args[0] === 'take') { assert.equal(JSON.parse(result.stdout).data.warning, true); assert.equal(JSON.parse(result.stdout).data.item.qty, 0); }
  }
  for (mode of ['disconnect', 'server', 'invalid', 'shape', 'rejected']) {
    const before = f.requests.filter(r => r.path.endsWith('mutate_item')).length;
    const result = await f.command(['add', id, '--n', '1']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, mode === 'rejected' ? /23503/ : /uncertain_result/);
    assert.doesNotMatch(result.stderr, /access-secret/);
    assert.equal(f.requests.filter(r => r.path.endsWith('mutate_item')).length - before, 1);
  }
});

test('argumentos inválidos falham antes de qualquer request', async t => {
  const f = await fixture(t);
  await f.configure(); await f.login();
  const before = f.requests.length;
  for (const args of [
    ['take', 'Módulo', '--n', '1'], ['add', id, '--n', '1.5'], ['take', id, '--n', '-1'],
    ['add', id, '--n', '2147483648'], ['relocate', id, '--shelf', '2'],
    ['relocate', id, '--shelf', '0', '--place', 'B03'], ['relocate', id, '--shelf', '1', '--place', 'W00'],
    ['list', '--limit', '0'], ['list', '--limit', '1001'], ['list', '--offset', '-1'],
    ['list', '--surface', 'X'], ['list', '--status', 'unknown'], ['list', '--password', 'password-secret'],
    ['auth', 'login', '--password', 'password-secret'], ['show', id, 'extra'], ['find', ''],
    ['create', '--name', 'X', '--shelf', '1', '--place', 'B03', '--qty', '0', '--category', 'Tools', '--aliases', '[null]'],
    ['list', '--shelf', '1', '--shelf', '2'], ['no-such-command'],
  ]) {
    const result = await f.command(args);
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.stderr, /invalid_args/);
    assert.doesNotMatch(result.stderr, /password-secret/);
  }
  assert.equal(f.requests.length, before);
});

test('credenciais inseguras, redirects, refresh rejeitado e arquivo permissivo são bloqueados', async t => {
  const f = await fixture(t);
  const serviceKey = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"role":"service_role"}').toString('base64url')}.signature`;
  for (const config of [
    { url: 'https://example.test', publicKey: serviceKey },
    { url: 'http://example.test', publicKey: 'sb_publishable_fixture' },
    { url: 'https://user:password-secret@example.test', publicKey: 'sb_publishable_fixture' },
    { url: 'https://example.test?key=password-secret', publicKey: 'sb_publishable_fixture' },
  ]) {
    const result = await f.command(['auth', 'configure', '--stdin'], config);
    assert.equal(result.code, 1); assert.doesNotMatch(result.stderr, /password-secret|signature/);
  }
  assert.equal(f.requests.length, 0);
  await f.configure();
  f.state.expired = true; await f.login();
  f.state.authError = true;
  const rejected = await f.command(['list']);
  assert.equal(rejected.code, 1); assert.doesNotMatch(rejected.stderr, /secret/);
  assert.equal(f.requests.filter(r => r.path.endsWith('/items')).length, 0);
  const path = join(f.home, 'tonitech-inventory/session.json');
  await chmod(path, 0o644);
  const before = f.requests.length;
  assert.equal((await f.command(['auth', 'status'])).code, 1);
  assert.equal(f.requests.length, before);
  await chmod(path, 0o600);
  f.state.authError = false; f.state.expired = false;
  await f.login();
  f.state.handle = (req, res) => { res.writeHead(307, { Location: '/redirect-with-secret' }); res.end('{}'); };
  const redirect = await f.command(['add', id, '--n', '1']);
  assert.match(redirect.stderr, /uncertain_result/);
  assert.equal(f.requests.filter(r => r.path.includes('redirect')).length, 0);
});

test('sessão serializada, acesso negado e link de credenciais não causam escrita ou vazamento', async t => {
  const f = await fixture(t);
  await f.configure(); await f.login();
  const lock = join(f.home, 'tonitech-inventory/session.lock');
  await writeFile(lock, '', { mode: 0o600 });
  const before = f.requests.length;
  const busy = await f.command(['add', id, '--n', '1']);
  assert.equal(busy.code, 1); assert.match(busy.stderr, /session_busy/);
  assert.equal(f.requests.length, before);
  await rm(lock);
  f.state.access = 'denied';
  const denied = await f.command(['add', id, '--n', '1']);
  assert.equal(denied.code, 1); assert.match(denied.stderr, /access_denied/);
  assert.equal(f.requests.filter(r => r.path.endsWith('mutate_item')).length, 0);
  const path = join(f.home, 'tonitech-inventory/session.json');
  const target = join(f.home, 'outside.json');
  await cp(path, target); await rm(path); await symlink(target, path);
  const linked = await f.command(['auth', 'status']);
  assert.equal(linked.code, 1); assert.doesNotMatch(linked.stderr, /secret/);
});

test('ausência e respostas HTTP de leitura têm erro JSON não zero sem corpo remoto', async t => {
  const f = await fixture(t);
  await f.configure(); await f.login();
  f.state.handle = (req, res) => res.end('[]');
  const absent = await f.command(['show', id]);
  assert.equal(absent.code, 1); assert.match(absent.stderr, /not_found/);
  const empty = await f.command(['find', 'inexistente']);
  assert.equal(empty.code, 0); assert.equal(JSON.parse(empty.stdout).data.total, 0);
  f.state.handle = (req, res) => { res.writeHead(401); res.end('{"message":"access-secret"}'); };
  const expired = await f.command(['categories']);
  assert.equal(expired.code, 1); assert.equal(JSON.parse(expired.stderr).error.status, 401);
  assert.doesNotMatch(expired.stderr, /access-secret/);
});

test('timeout de escrita faz exatamente uma tentativa e orienta conferir histórico', async t => {
  const f = await fixture(t);
  f.state.handle = () => {}; // Deliberately lose the response after receiving the request.
  await f.configure(); await f.login();
  const result = await f.command(['take', id, '--n', '1']);
  assert.equal(result.code, 1); assert.match(result.stderr, /uncertain_result/);
  assert.equal(f.requests.filter(r => r.path.endsWith('mutate_item')).length, 1);
});

// Real PTY: password is supplied through a private pipe, never argv or environment.
const terminalDriver = String.raw`
import os, pty, select, sys, json, time
data = json.load(sys.stdin)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(data['cwd'])
    os.execv(data['node'], [data['node'], data['script']] + data['args'])
output = b''
stage = 0
deadline = time.monotonic() + 15
while time.monotonic() < deadline:
    if not select.select([fd], [], [], .1)[0]:
        continue
    try:
        chunk = os.read(fd, 65536)
    except OSError:
        break
    if not chunk:
        break
    output += chunk
    if stage < len(data['answers']) and data['prompts'][stage].encode() in output:
        os.write(fd, (data['answers'][stage] + '\n').encode())
        stage += 1
else:
    os.kill(pid, 9)
_, status = os.waitpid(pid, 0)
os.close(fd)
sys.stdout.buffer.write(output)
sys.exit(os.waitstatus_to_exitcode(status))
`;

test('todos os exemplos da skill em checkout mínimo movido com espaços; prompt de senha oculto', async t => {
  const f = await fixture(t);
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const moved = join(f.home, 'checkout movido com espaços');
  const skillDir = join(moved, '.claude/skills/web-inventory');
  await mkdir(join(moved, 'app/src'), { recursive: true });
  await mkdir(join(moved, '.claude/skills'), { recursive: true });
  await cp(join(root, '.claude/skills/web-inventory'), skillDir, { recursive: true });
  await cp(join(root, 'app/src/inventory.ts'), join(moved, 'app/src/inventory.ts'));
  const skill = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
  const lines = [...skill.matchAll(/```bash\n([\s\S]*?)```/g)].flatMap(match => match[1].trim().split('\n'));
  const privateConfig = join(f.home, 'private config');
  const env = { XDG_CONFIG_HOME: privateConfig };
  let current = { ...item };
  f.state.handle = (req, res, url, body) => {
    if (url.pathname.endsWith('create_item')) { current = { ...current, ...body.input }; res.end(JSON.stringify(current)); }
    else if (url.pathname.endsWith('mutate_item')) {
      current = { ...current, ...(body.action === 'take' ? { qty: Math.max(0, current.qty - body.input.n) } : body.action === 'add' ? { qty: current.qty + body.input.n } : body.input) };
      res.end(JSON.stringify({ item: current, warning: false }));
    } else {
      const isCategory = url.pathname.endsWith('categories');
      const cursor = url.searchParams.get(isCategory ? 'name' : 'id');
      res.end(JSON.stringify(cursor?.startsWith('gt.') || cursor?.startsWith('lt.') ? [] : isCategory ? [{ name: 'Electronics' }, { name: 'Tools' }] : url.pathname.endsWith('movements') ? [{ id: 1, item_id: id }] : [current]));
    }
  };
  let executed = 0;
  for (const line of lines) {
    if (line.startsWith('node --test ')) { assert.equal(line, 'node --test .claude/skills/web-inventory/scripts/cli.test.mjs'); continue; } // This test is already running that command.
    let result;
    const interactive = /auth (configure|login)$/.exec(line)?.[1];
    if (interactive) {
      result = await run([terminalDriver], {
        executable: 'python3', script: '-c', cwd: moved, env,
        input: JSON.stringify({ cwd: moved, node: process.execPath, script: line.split(' ')[1], args: ['auth', interactive],
          prompts: interactive === 'login' ? ['E-mail: ', 'Senha (oculta): '] : ['URL Supabase [', 'Chave pública anon/publishable (oculta): '],
          answers: interactive === 'login' ? ['fixture@example.test', 'password-secret'] : [f.url, 'sb_publishable_fixture'],
        }),
      });
    } else result = await run([line], { executable: 'bash', script: '-c', cwd: moved, env });
    assert.equal(result.code, 0, `${line}\n${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(result.stdout + result.stderr, /password-secret|access-secret|refresh-secret/);
    executed++;
  }
  assert.equal(executed, 15);
  assert.equal(current.qty, 4); assert.equal(current.place, 'W12'); assert.equal(current.category, 'Tools');
  // Reject storage in the moved checkout, including a symlinked config base.
  await mkdir(join(moved, 'private'), { recursive: true });
  await symlink(join(moved, 'private'), join(f.home, 'config-link'));
  const unsafe = await run(['auth', 'configure', '--stdin'], { script: join(skillDir, 'scripts/inventory.mjs'), env: { XDG_CONFIG_HOME: join(f.home, 'config-link') }, input: '{}' });
  assert.equal(unsafe.code, 1); assert.match(unsafe.stderr, /fora do repositório/);
});
