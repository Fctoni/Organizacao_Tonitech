// Disposable database on the fixed local Supabase container. No operational data copied.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { activePrompt, assistantSettings } from '../server/assistant-settings.mjs';

const container = 'supabase_db_tonitech-inventory';
const database = `assistant_test_${randomUUID().replaceAll('-', '')}`;
function command(args, input) {
  const result = spawnSync('docker', ['exec', '-i', container, ...args], { input, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const sql = input => command(['psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At'], input);
function concurrentSql(input) {
  return new Promise(resolve => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At']);
    let output = ''; let errors = '';
    child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => errors += chunk);
    child.on('close', status => resolve({ status, output, errors })); child.stdin.end(input);
  });
}
try {
  command(['createdb', '-U', 'postgres', database]);
  // Real installed Supabase Auth schema/functions, no user rows, passwords or credentials.
  const authSchema = command(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--schema=auth', '--no-owner', '--no-privileges']);
  sql(authSchema);
  sql('grant usage on schema auth to authenticated;');
  for (const name of readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort()) {
    if (name === '20261021000200_assistant_prompt.sql') sql(`
      insert into auth.users(id,email) values
        ('00000000-0000-4000-8000-000000000011','felipetonietto@gmail.com'),
        ('00000000-0000-4000-8000-000000000012','fixture-other@example.com');
      insert into public.access_members values
        ('00000000-0000-4000-8000-000000000011','2020-01-01'),
        ('00000000-0000-4000-8000-000000000012','2020-01-01');`);
    sql(readFileSync(`supabase/migrations/${name}`, 'utf8'));
  }
  assert.equal(sql('select user_id from public.access_members where is_owner;').trim(), '00000000-0000-4000-8000-000000000011');
  sql("delete from auth.users where id in ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012');");
  console.log('PASS ownership migration selects only the designated synthetic account, not other ready members');
  sql(readFileSync('tests/assistant-settings.sql', 'utf8'));
  console.log('PASS fresh migrations + real Auth functions, owner/member/pending, append-only, restore, validation, stale version');
  sql(`insert into auth.users(id) values ('00000000-0000-4000-8000-000000000010');
    insert into public.access_members values ('00000000-0000-4000-8000-000000000010','2020-01-01',true);`);
  const asOwner = `set role authenticated; select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000010","iat":2000000000}',false);`;
  // Two real connections race from the same expected version. Exactly one revision commits.
  const results = await Promise.all(Array.from({ length: 2 }, (_, i) => concurrentSql(`${asOwner}
    select public.save_assistant_prompt(1, 'Concurrent fixture ${i}', null)->>'version';`)));
  assert.equal(results.filter(result => result.status === 0).length, 1);
  assert.match(results.find(result => result.status !== 0).errors, /Versão mudou/);
  assert.equal(sql('select count(*) from public.assistant_prompt_revisions;').trim(), '2');
  console.log('PASS concurrent connections: one commit, one conflict, no lost update or extra revision');
  const immutable = await concurrentSql("update public.assistant_prompt_revisions set body = 'tamper';");
  assert.notEqual(immutable.status, 0); assert.match(immutable.errors, /imutáveis/);
  console.log('PASS append-only trigger also rejects privileged UPDATE');
  // Real RPC results consumed by the same JS reader and settings endpoint as the app.
  const literal = value => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
  const db = { rpc: async (name, args) => {
    assert.ok(['assistant_prompt', 'assistant_prompt_history', 'save_assistant_prompt'].includes(name));
    const params = args ? [args.expected_version, args.new_body, args.restore_version].map(literal).join(',') : '';
    return { data: JSON.parse(sql(`${asOwner} select public.${name}(${params});`).trim().split('\n').at(-1)) };
  } };
  const previous = await activePrompt(db);
  const unicode = '😀'.repeat(6000);
  const saved = await db.rpc('save_assistant_prompt', { expected_version: previous.version, new_body: `\t\n${unicode}\uFEFF`, restore_version: null });
  assert.equal((await activePrompt(db)).body, unicode);
  const editor = await (await assistantSettings(db, { action: 'settings' })).json();
  assert.equal(editor.active.body, unicode); assert.equal(editor.active.body.length, 12000);
  const restored = await assistantSettings(db, { action: 'restore-settings', expectedVersion: saved.data.version, restoreVersion: saved.data.version });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).active.restored_from, saved.data.version);
  assert.equal((await activePrompt(db)).body, unicode);
  for (const body of ['\t\n', '😀'.repeat(6001)]) {
    assert.equal((await assistantSettings(db, { action: 'save-settings', expectedVersion: (await activePrompt(db)).version, body })).status, 400);
  }
  console.log('PASS RPC Unicode boundary -> JS active reader/editor -> restore, whitespace rejection is atomic');
} finally {
  command(['dropdb', '-U', 'postgres', '--if-exists', database]);
}
