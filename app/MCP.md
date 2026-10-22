# MCP do inventário: configuração e playbook

## Estado e endereços

Publicado com seis ferramentas, incluindo `executeChange(ticket)`, para consultar e alterar estoque diretamente pelo MCP com consentimento conversacional no Claude. As cinco operações e o replay idempotente foram validados no ambiente hospedado pelo cliente MCP oficial, sem abrir o app. O aceite básico e seus limites estão registrados em [validação humana relatada](../docs/validation/mcp.md#validação-humana-relatada--estado-atual). Deployment, autoria/revisões e evidências em [validação da publicação](../docs/validation/mcp.md).

| Finalidade | Endereço ou configuração de produção |
| --- | --- |
| MCP | https://tonitech-inventario.vercel.app/api/mcp |
| Recurso protegido | https://tonitech-inventario.vercel.app/.well-known/oauth-protected-resource/api/mcp |
| Consentimento | https://tonitech-inventario.vercel.app/oauth/consent |
| Issuer | https://pfhfhrypxncgzmnmlztm.supabase.co/auth/v1 |
| OAuth discovery | https://pfhfhrypxncgzmnmlztm.supabase.co/.well-known/oauth-authorization-server/auth/v1 |
| OIDC discovery | https://pfhfhrypxncgzmnmlztm.supabase.co/auth/v1/.well-known/openid-configuration |
| JWKS | https://pfhfhrypxncgzmnmlztm.supabase.co/auth/v1/.well-known/jwks.json |
| Callback cadastrado no cliente | https://claude.ai/api/mcp/auth_callback |
| OAuth Client ID público | `17d3787e-4333-49a1-9f29-e68b565c70b2` |
| Client secret | Vazio; cliente público com `token_endpoint_auth_method=none` |

## Contrato do servidor

O endpoint usa POST Streamable HTTP stateless. `sessionIdGenerator` fica undefined e `enableJsonResponse` true. GET/SSE e DELETE retornam 405 autenticado, sem reter conexão. OPTIONS informa CORS; Origin ausente é aceito, Origin presente deve ser a origem configurada ou Claude. JSON inválido, tipo de conteúdo, tamanho e versão de protocolo têm respostas próprias. Sem token, responde 401 com `WWW-Authenticate` apontando ao metadata; sem configuração, 503. Metadata é JSON e não cai na SPA. O SDK instalado governa negociação de versão; não há `createMcpHandler` nessa versão npm.

Ferramentas publicadas: `searchItems`, `getItem`, `categories`, `history`, `proposeChange` e `executeChange`. As consultas e `proposeChange` reutilizam schemas/executores do chat. A proposta retorna preview e ticket estruturados, sem gravar. `executeChange(ticket)` existe somente no MCP e executa a proposta pela RPC transacional existente. Não é necessário abrir o app para confirmar cada operação. Limites de busca e resultados são os do chat; a entrada MCP tem até 32 KiB. Cada instância mantém no máximo quatro conexões PostgreSQL; consultas têm timeout de oito segundos e transações ociosas de dez segundos.

O consentimento acontece na conversa com o Claude. As instruções exigem apresentar Item, ação, quantidade/unidade e endereço completo, esclarecer ambiguidades e pedir confirmação quando necessária antes de executar. O backend não verifica nem atesta confirmação humana. OAuth concede acesso autenticado para consultar e alterar estoque; não há nova autorização OAuth por escrita nem campo `confirmed`. O chat embutido continua exigindo clique no cartão e não recebe ferramenta de execução.

`executeChange` retorna Item compacto, aviso, `operationId` e `status: committed` somente após COMMIT. Rejeições conhecidas retornam `definitive` e `retryable: false`. Falhas com rollback confirmado antes do COMMIT retornam `transient`; resultado não comprovado retorna `uncertain`. Nos dois últimos casos, ou após resposta perdida, repetir **o mesmo ticket**; nunca criar nova proposta automaticamente. Replay recupera o resultado original mesmo após expiração, sem novo movimento. Operação inédita expirada e conflito de versão exigem esclarecer o pedido antes de nova proposta. As annotations são declarativas: apenas execução tem `readOnlyHint: false`, e sua idempotência vale para o mesmo ticket/operação.

## Variáveis

Configure no servidor, sem prefixo `VITE_`:

| Nome | Valor/finalidade |
| --- | --- |
| `MCP_RESOURCE_URL` | URL MCP exata da tabela acima; sem query, fragmento ou barra final |
| `MCP_CLIENT_ID` | ID público do cliente Claude pré-registrado |
| `MCP_DATABASE_URL` | Secret: conexão Supavisor **transaction mode**, porta 6543, usuário `inventory_mcp.pfhfhrypxncgzmnmlztm`, banco `postgres` e senha exclusiva; sem query parameters |
| `MCP_DATABASE_CA` | CA PEM oficial Supabase, necessária na conexão publicada; nunca desabilitar verificação TLS |
| `SUPABASE_URL` | Origem do projeto dedicado |
| `CHAT_SIGNING_SECRET` | Mesmo segredo servidor usado pelo chat para propostas |

O MCP não usa chave Google, chave administrativa Supabase ou Bearer na Data API. A credencial da ponte pode representar usuários no banco: proteja-a como Secret exclusivo das funções do servidor. Não use usuário `postgres`, service_role, URL de conexão administrativa ou opções `sslmode` que substituam a verificação TLS.

O endpoint transacional foi obtido pela Management API do projeto: `aws-1-sa-east-1.pooler.supabase.com:6543`. A CA configurada vem do [download oficial usado pelo Dashboard](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt). A conexão cliente → Supavisor valida cadeia e hostname. A observação `pg_stat_ssl.ssl=false` refere-se ao trecho interno gerenciado Supavisor → Postgres; não foi alterada a configuração global de SSL do banco.

## Provisionamento após revisão

Este procedimento muda produção e deve ser executado somente na fase de publicação autorizada. Não executar `config push`: o TOML agora descreve desenvolvimento local. `apply-remote.mjs` aplica somente migrations e mantém a configuração Auth remota.

1. Confirmar o projeto dedicado e aplicar migrations validadas por `scripts/apply-remote.mjs`. A migration MCP cria o papel sem senha, o schema privado e o hook. Conferir grants conforme o registro de banco. Não importar novamente o vault.
2. Confirmar JWKS assimétrico ES256/RS256. Não trocar chaves de assinatura existentes automaticamente. `scripts/configure-mcp-remote.mjs` sem argumentos faz preflight somente leitura e imprime apenas indicadores públicos/booleanos. Requer `INVENTORY_PROJECT_REF` e `SUPABASE_ACCESS_TOKEN` em ambiente privado.
3. Em Supabase **Authentication → OAuth Server**, habilitar o servidor OAuth com DCR desabilitado e caminho `/oauth/consent`. Manter a nova interface fora de produção até concluir binding/hook. Pré-registrar **Claude ToniTech**, tipo **Public**, `token_endpoint_auth_method=none`, com somente o callback exato da tabela. O cliente não possui secret. A alternativa programática é `auth.admin.oauth.createClient` ou `POST /auth/v1/admin/oauth/clients`, com credencial administrativa apenas em memória, nunca no frontend ou em comandos contendo valores reais.
4. Configurar a linha única de `inventory_auth.mcp_client` pelo canal administrativo. Usar o client ID público recém-criado e a URL MCP exata. A tabela não fica disponível para modelo/navegador. Exemplo sem segredo, substituindo somente o ID público:

   ```sql
   insert into inventory_auth.mcp_client (client_id, resource)
   values ('ID_PUBLICO_PRE_REGISTRADO', 'https://tonitech-inventario.vercel.app/api/mcp');
   ```

5. Provisionar uma senha aleatória exclusiva para `inventory_mcp` pelo canal administrativo protegido e armazenar a conexão como `MCP_DATABASE_URL` no Secret do servidor. A senha é provisionada fora das migrations; não salvar SQL, fixture, arquivo versionado, argumento de terminal ou log contendo a senha. Usar a URI Supavisor transacional fornecida pelo projeto, alterando apenas usuário/senha para o papel dedicado. Conferir TLS e autenticação da ponte antes de publicar. Na publicação atual, a senha foi gerada em RAM, o banco recebeu um verificador SCRAM e a URL foi enviada ao Secret Vercel por stdin.
6. Definir `MCP_CLIENT_ID` no ambiente privado e executar `node scripts/configure-mcp-remote.mjs --apply`. O script confirma identidade do projeto, cliente público/callback, binding, Site URL de produção e JWKS. Recusa substituir outro hook ou fluxo OAuth. Aplica somente os cinco campos OAuth/hook e relê a configuração, sem imprimir secrets. Não altera outros campos Auth nem registra clientes automaticamente.
7. Configurar as variáveis servidor na Vercel e publicar somente `app`, com Node 22.18+. As funções incluem explicitamente `src/inventory.ts`. O deployment não pode exigir autenticação Vercel diante dos endpoints públicos OAuth/MCP. As migrations, binding, hook e credencial devem estar prontos antes das funções.
8. Conferir metadata, 401, JWKS, TLS/Supavisor, consultas e confirmação com fixture dedicada no ambiente publicado. Confirmar que o login normal continua funcionando. Só então registrar a URL como publicada e executar o playbook Claude abaixo.

O hook compara `event.claims.client_id`, inclusive em refresh, e devolve todas as claims. Somente o cliente cadastrado recebe `role=anon`, audience MCP e validade máxima de cinco minutos. A ponte valida esses campos e aplica identidade interna `authenticated` em transação somente leitura para consultas/propostas e de escrita apenas para execução explícita. Membership e marcador de senha continuam sendo verificados no banco antes de qualquer replay. Revogação do grant bloqueia refresh; tokens já emitidos podem durar até cinco minutos. Remoção do membership bloqueia novas requisições sem esperar expiração.

## Desenvolvimento e testes permanentes

Com a instância local dedicada já disponível, na pasta `app`:

```bash
npm test
npm run test:mcp:integration
npm run test:mcp:cleanup
node scripts/build-local.mjs
node scripts/check-bundle.mjs
```

A integração cria banco e containers Auth/PostgREST descartáveis no Docker local. Copia somente schema Auth e versões de migrations, nunca usuários/dados operacionais. Aplica toda a cadeia, gera chaves, usuários e senha de login de banco em memória, executa OAuth nativo, cliente MCP oficial, RLS e execução direta pela RPC existente, e remove as fixtures. Não reseta nem reinicia o stack compartilhado. Não aceita destino remoto.

A limpeza tenta cada etapa mesmo após outra falhar, usa um canal administrativo local independente da conexão de teste e verifica banco, papéis e containers pertencentes à execução. Falhas são reportadas por etapa, sem payloads do provedor. `test:mcp:cleanup` injeta falhas de preparação antes da conexão administrativa e de fechamento do cliente MCP; exige zero recursos restantes nos dois cenários. Indisponibilidade do Docker/PostgreSQL pode impedir a remoção e faz o check falhar, nunca declarar limpeza concluída.

Para incluir o navegador, use uma instalação externa de Playwright Node com Chromium disponível. `PLAYWRIGHT_MODULE` aponta ao módulo `index.mjs` dessa instalação; se Playwright estiver resolvível no projeto, a variável é dispensável:

```bash
PLAYWRIGHT_MODULE=/caminho/privado/node_modules/playwright/index.mjs node scripts/mcp-integration.mjs --browser
```

O check abre a SPA real em Vite com gateway restrito às fixtures locais. Exercita login, senha obrigatória, novo login, retenção da proposta, confirmação, resposta perdida/replay, conta errada e consentimento aprovar/negar. O callback Claude é interceptado na fixture: não prova conexão com a conta Claude. Não grava screenshots, tokens ou logs de rede no repositório.

Para desenvolvimento manual sobre o banco local existente, aplicar `supabase migration up --local` **antes** de reiniciar Auth para ativar o hook. Não usar reset. Configurar cliente/binding local separadamente e `MCP_RESOURCE_URL=http://127.0.0.1:5173/api/mcp`; a origem Supabase também deve ser loopback. A exceção sem TLS só funciona fora de produção e para `127.0.0.1`. O TOML usa Site URL local. O servidor `dev:local` serve MCP, metadata e consentimento.

### Cobertura e limites

- Cliente oficial: initialize/list/call, stateless, negociação, conteúdo, Origin, metadata e desafio 401.
- OAuth real: PKCE incorreto, approve/deny, replay de código, refresh rotacionado, hook no refresh, expiração curta, rejeição de browser JWT e ID token, revogação de grant.
- Banco real: login restrito, associação pendente/removida e `iat` antigo, concorrência de identidades, rollback, timeout e limpeza do pool, precisão de microssegundos, Data API negada para OAuth anon mesmo sem exigir audience padrão.
- Domínio: ferramentas compartilhadas, busca sem acento/aliases, paginação e as cinco operações por proposta → execução MCP. Concorrência gera um movimento; resposta perdida, replay após expiração, colisão de payload, propósito incorreto, assinatura adulterada, usuário incorreto, conflito de timestamp e aviso de piso zero são exercitados. Desconexão durante lock provoca rollback e timeout retorna falha transitória; ambos permitem repetir o mesmo ticket. A fábrica do chat não expõe execução.
- Supavisor/TLS, funções Vercel e OAuth hospedado foram exercitados na publicação conforme a evidência vinculada. Quatro clientes independentes comprovaram chamadas stateless concorrentes, sem comprovar quantas instâncias físicas a Vercel alocou. O aceite humano tem escopo próprio, descrito na validação humana vinculada acima. Não há avaliação visual formal, teste de impressão ou chamada a modelo nesta suíte.

## Playbook humano no Claude

Para um conector já configurado, atualize/reconecte o conector para recarregar a lista de ferramentas e confirme a presença de `executeChange`. URL, Client ID e credenciais permanecem iguais. Não é necessário refazer login por causa desta atualização; autentique novamente somente se o Claude solicitar por sessão expirada ou revogada.

1. Abrir **Customize → Connectors → Add custom connector**. Em Team/Enterprise, um administrador pode precisar cadastrar em **Organization settings → Connectors** antes do vínculo individual.
2. Informar a URL MCP publicada da tabela. Escolher **Sign in now** e **Use your own OAuth client**, ou abrir **Advanced settings**, conforme a interface disponível. Informar `MCP_CLIENT_ID`; deixar **Client secret vazio**. Não escolher registro automático, identidade publicada/CIMD ou chave fixa.
3. Entrar com a própria conta do inventário. Se houver troca obrigatória, concluir e entrar novamente. Conferir nome do cliente e scopes, depois autorizar. Repetir uma conexão negando para comprovar retorno `access_denied` sem acesso.
4. Ativar o conector na conversa. Perguntar “Quais categorias existem?”, “Onde está [Item conhecido]?” e repetir usando um alias. Conferir UUID/localização/quantidade no app. Solicitar próxima página quando houver indicação.
5. Usar dois Itens sintéticos com nomes semelhantes. Pedir uma alteração ambígua e exigir esclarecimento antes de escolher. Não usar Itens reais para lançamentos de teste.
6. Pedir Add/Take no **TESTITEM** dedicado. Conferir que a proposta não altera saldo/histórico. Conferir na conversa Item, unidade, quantidade, Location e operação; dar a confirmação ao Claude. Ele chama `executeChange` com o ticket e informa o resultado, sem abrir o app. Conferir saldo/histórico por nova consulta Claude.
7. Repetir `executeChange` com o mesmo ticket: deve recuperar o resultado anterior, com apenas um movimento. Após resposta perdida, repetir esse ticket, nunca gerar nova proposta automaticamente. Testar conta diferente, proposta inédita expirada e Item modificado depois da proposta; nenhuma dessas tentativas deve gerar movimento novo. Não “corrigir” automaticamente uma proposta em conflito.
8. Desconectar/reconectar. Revogar o grant OAuth e confirmar falha no próximo refresh, respeitando até cinco minutos de validade residual do JWT. Não confundir remover o conector no Claude com revogar o grant no servidor.
9. Limpar somente os TESTITEMs e contas descartáveis pelo canal administrativo autorizado. Registrar versão publicada, cenários executados e limitações. Consultar o aceite humano e seus limites na validação vinculada acima; ele não representa execução integral deste playbook.

O ticket contém dados legíveis e aparece na conversa Claude; não compartilhá-lo. A assinatura comprova integridade e vínculo com o usuário, não confirmação humana. O fluxo de links existente permanece compatível, mas não é necessário para execução MCP. `authorization_id` inicialmente chega na query do consentimento e pode aparecer no log da hospedagem; a remoção no navegador não apaga esse registro prévio.

## Referências oficiais

- [Cliente próprio e secret vazio no Claude](https://claude.com/docs/connectors/custom/add-unlisted#choose-authentication-settings).
- [Supabase OAuth Server e pré-registro](https://supabase.com/docs/guides/auth/oauth-server/getting-started).
- [Claims OAuth, hook e segurança de tokens](https://supabase.com/docs/guides/auth/oauth-server/token-security).
- [Autorização MCP](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
- [Streamable HTTP](https://modelcontextprotocol.io/specification/latest/basic/transports/streamable-http).

Contratos npm conferidos em `@modelcontextprotocol/server@2.3.1`, `@modelcontextprotocol/node@2.1.1`, `@modelcontextprotocol/client@2.3.1` e Supabase JS 2.118.0. Os containers descartáveis usam a versão Auth instalada no stack local; nesta execução, v2.197.0. O código da configuração dessa versão usa `GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH`; o nome TOML da CLI é `authorization_url_path`.
