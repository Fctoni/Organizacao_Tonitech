# Inventário ToniTech

App de acesso restrito para consultar Itens e registrar Take, Add, cadastro, Relocate e Recategorize. O banco é o responsável pelas invariantes e pelo histórico. O frontend nunca recebe credenciais administrativas.

## Desenvolvimento e testes

Requer Node 22.18+ (testes usam TypeScript nativo), npm, Docker e Supabase CLI. Execute na pasta `app`:

```bash
npm ci
node scripts/restart-local.mjs
npm run import
npm run dev:local
```

O servidor local usa `127.0.0.1:5173` e inclui o endpoint de troca de senha. Os scripts capturam as credenciais locais da CLI em memória; não imprimem nem gravam senhas. Nenhum usuário real é criado automaticamente. `npm run dev` é o Vite básico e requer configuração pública de ambiente; para troca de senha local, use `dev:local`.

```bash
npm test
npm run test:integration
node scripts/build-local.mjs
node scripts/http-check.mjs
node scripts/check-bundle.mjs
npm run db:verify
```

`node scripts/fresh-check.mjs` verifica a cadeia a partir de banco vazio e reimporta o vault. **Esse comando apaga os dados da instância local dedicada**, inclusive alterações feitas pelo app local. Não o use para preservar uma sessão operacional. Não opera projetos remotos.

As integrações usam Auth, PostgREST e Postgres reais. Credenciais e Itens de teste são efêmeros. Os checks HTTP não substituem validação visual em navegador.

## Importação e recuperação

`npm run import` lê exclusivamente `inventory.sh export`. A importação compara hashes, insere origens novas e rejeita uma origem conhecida com conteúdo diferente. Reexecutar não sobrescreve alterações do app. As fontes CSV/Base/dashboard são arquivadas sem gerar Itens duplicados.

`node scripts/backup.mjs /caminho/privado/backup.json` grava um arquivo novo com permissão 0600. O export contém Itens atuais, histórico e originais em um único snapshot do banco. `originals[].original_base64` recupera os bytes exatos de cada arquivo; valide SHA-256 contra `originals[].sha256` antes de restaurar. Nunca restaure sobre o vault real sem autorização. O backup não inclui Auth ou credenciais.

O destino padrão dos scripts é local. Para importação remota, use `scripts/import-remote.mjs` com `INVENTORY_PROJECT_REF` confirmado. `scripts/remote.mjs` exige o nome `Tonitech-Inventario` na organização TecnoHard (`msxuixhofofwiecxcvkr`) e captura as chaves sem imprimir. `backup.mjs` usa o mesmo destino remoto somente quando essa variável está definida. `npm run test:integration` também aceita esse destino explicitamente confirmado e cria somente fixtures/usuários efêmeros, removidos ao final.

## Produção e deploy

Produção: https://tonitech-inventario.vercel.app. Projeto Supabase dedicado `pfhfhrypxncgzmnmlztm`, TecnoHard Pro, `sa-east-1`, criado com compute Micro. Incremento estimado de US$ 10/mês autorizado; nenhuma mudança de plano/billing ou de outros projetos.

`scripts/create-project.mjs` recusa executar se já existe o projeto dedicado. Não deve ser reexecutado para atualizar produção. Para manutenção, execute dentro de `app`:

1. Confirmar `INVENTORY_PROJECT_REF=pfhfhrypxncgzmnmlztm` e executar `node scripts/apply-remote.mjs` para migrations/configuração previamente validadas. O script confere identidade e vínculo antes de escrever, capturando saída administrativa.
2. `auth.site_url` aponta à produção. `auth.enable_signup=false` bloqueia cadastro público. `auth.email.enable_signup=true` mantém o provedor de login por e-mail habilitado; o bloqueio global foi comprovado remotamente.
3. Usar `node scripts/import-remote.mjs` para importação e `node scripts/verify-remote.mjs` para conferência pré-cutover. A comparação de projeções com o vault é intencionalmente pré-cutover; após alterações operacionais legítimas no app, somente os originais devem coincidir.
4. Definir `VERCEL_CLI_PATH` para a instalação autenticada e executar `node scripts/deploy.mjs`. O script envia variáveis por stdin, mantém a service role como Secret do servidor e publica somente `app` no projeto `tonitech-inventario`, escopo `felipes-projects-93cc7c39`. Não enviar a raiz do vault.
5. Executar `node scripts/check-production.mjs`: verifica HTTPS público, cabeçalhos, endpoint e igualdade dos assets publicados com o build local. O helper não imprime credenciais.
6. Para navegador, `scripts/browser-check.mjs` aceita `PLAYWRIGHT_MODULE` e `PLAYWRIGHT_CHROMIUM_PATH` da instalação disponível. Usa contexto isolado, conta efêmera, captura sem campos de senha e limpeza das fixtures. O transporte Node/CLI foi autorizado em substituição ao requisito MCP.
7. O usuário real já foi provisionado por `server/provision-owner.mjs`, com troca obrigatória pendente. Não reexecutar para recriar ou substituir sua credencial. A senha temporária é entregue exclusivamente no chat final; o retorno de ferramenta foi autorizado como transporte necessário. Nunca registrar a senha em arquivos, auditoria, GitHub, screenshots ou ambiente persistido.

O endpoint exige a senha atual, rejeita reutilizá-la, revoga sessões e só libera dados após mudança confirmada pela Admin API. Falha intermediária mantém o acesso bloqueado. Um novo login é necessário; tokens anteriores à troca não autorizam acesso.

## Fonte operacional

O cutover está concluído: o banco remoto do app é a fonte operacional. As notas do vault permanecem como originais preservados e não devem receber movimentações operacionais paralelas. Não há sincronização bidirecional nem multi-local nesta entrega.
