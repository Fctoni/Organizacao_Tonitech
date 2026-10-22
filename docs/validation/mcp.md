# Publicação do MCP — execução direta — 21/10/2026

## Entrega

MCP publicado em https://tonitech-inventario.vercel.app/api/mcp. Deployment Vercel atual `dpl_7x1ayBAEQMrrK9hsd6ppj7LjNUAP`, estado Ready, criado em 21/10/2026 às 17:17:15 BRT (UTC−03). Alias de produção conferido nesse deployment. URL imutável: https://tonitech-inventario-4gj1pojmw-felipes-projects-93cc7c39.vercel.app.

Foi enviada somente a pasta `app` ao projeto `tonitech-inventario`, escopo `felipes-projects-93cc7c39`. Funções presentes: troca de senha, chat, MCP e metadata MCP. Runtime Node 24.x. A publicação usou o checkout local revisado, ainda sem commit naquele momento; o deployment identifica a versão publicada. O publicador não alterou runtime nem precisou de correção de deploy. A etapa de publicação não incluiu commit/push ou delegação; o fechamento está registrado em `agent-memory/contexto/artefatos/2026-10-22-fechamento-mcp.md`.

Implementação atribuída à sessão `ses_ea01217fcffed8IQbF0z6iwheu`. Aprovações sem achados das revisões `ses_ea0099cffffeOqUXWBLsxZLMuS` e `ses_ea0099ce4ffesK6C9HGQM54URo`, informadas pelo usuário no handoff de publicação. O delta publicado adiciona `executeChange(ticket)` somente ao MCP, usando a RPC/ledger existentes e resposta após COMMIT. Propostas retornam preview e ticket estruturados; consentimento conversacional não é atestado pelo backend. O cartão do chat embutido permanece separado.

## Configuração preservada

- Supabase confirmado: `Tonitech-Inventario`, projeto `pfhfhrypxncgzmnmlztm`, organização TecnoHard `msxuixhofofwiecxcvkr`, região `sa-east-1`.
- Migration `20261021000400` já aplicada. Esta publicação não executou migrations, alterações de papéis globais, reset ou reimportação.
- Cliente Claude público pré-registrado, método `none`, callback exato, secret vazio. ID público e endereços canônicos em `app/MCP.md`.
- Binding privado e configuração Auth comparados antes/depois do deployment e preservados integralmente. Hook retorna claims completas e personaliza apenas o cliente vinculado, inclusive em refresh. Nenhum campo Auth foi alterado.
- Papel existente `inventory_mcp`: NOINHERIT/NOSUPERUSER/NOBYPASSRLS. Membership único `authenticated`, INHERIT false, SET true e ADMIN false. Papel, senha, verificador SCRAM e URL no Secret Vercel foram preservados nesta publicação.
- Todas as variáveis/Secrets e descritores Vercel foram comparados antes/depois e preservados, incluindo ponte MCP, assinatura, modelo e chave Google. Nenhuma credencial foi regenerada e nenhum segredo foi recuperado dos Secrets Vercel para os testes.
- Supavisor transacional obtido pela Management API, com cadeia/hostname TLS verificados usando a CA oficial Supabase. O `current_user` foi `inventory_mcp`. `pg_stat_ssl.ssl=false` descreve o trecho interno gerenciado pooler → Postgres; não é prova de ausência de TLS na conexão cliente → pooler, cujo socket confirmou autorização TLS. A configuração global de SSL do banco não foi alterada.

## Correção PT409 e descoberta autenticada

Delta desta publicação: `inventory-operation.mjs` orienta “Consulte novamente e solicite uma nova proposta” em PT409, sem referência a outro cartão. Aprovação da revisão `ses_ea0099cffffeOqUXWBLsxZLMuS`, com 47 testes/build aprovados, informada pelo usuário. Publicação pelo CLI Vercel instalado no cache npm; variáveis/Secrets, configuração Auth e binding comparados antes/depois e preservados. Nenhuma migration, mudança de papel ou regeneração de credencial.

No alias de produção do deployment atual, o cliente MCP oficial autenticado por OAuth sintético recebeu seis ferramentas: `searchItems`, `getItem`, `categories`, `history`, `proposeChange`, `executeChange`. As instruções de initialize dizem “Não é necessário abrir o app”. A descrição de proposeChange orienta “use executeChange com este ticket”, sem menção a chat/cartão; executeChange diz “Não exige app” e anuncia `readOnlyHint: false`.

Schema recebido de executeChange: objeto estrito, somente `ticket` obrigatório, string de 1 a 24.000 caracteres. A proposta anuncia as ações `create`, `take`, `add`, `relocate`, `recategorize`; busca anuncia `surface: B/W` e `status: in_stock/out`.

Requests MCP observados: `initialize`, `notifications/initialized`, `tools/list`. Zero `tools/call`: nenhuma consulta de Item, proposta, execução ou movimentação de estoque, real ou sintética, nesta rodada. O teste apenas criou autenticação sintética; grant, sessões, usuário e membership próprios foram removidos, com limpeza verificada. Não foram criados arquivos temporários adicionais, screenshots ou dumps de credenciais. A resposta PT409 não foi provocada remotamente, pois isso exigiria uma operação de estoque fora do escopo.

Essa evidência técnica comprova os descritores do servidor, não o conteúdo armazenado em cache ou a interpretação da conversa na conta Claude do usuário. Naquela rodada, ela não permitia declarar resolvido o relato “só prepara/cartão”; o relato humano posterior está registrado em [Validação humana relatada — estado atual](#validação-humana-relatada--estado-atual).

## Validação hospedada de execução direta

Os resultados de escrita abaixo pertencem ao deployment `dpl_BbMwckCrmtHfDiQtBe6avnTYEdw3`, das 16:38:56 BRT. Foram preservados como evidência da execução direta; não foram repetidos na publicação de mensagem PT409.

O smoke usou uma conta sintética, senha em RAM e um TESTITEM exclusivo. OAuth nativo Authorization Code/PKCE foi obtido pelo cliente público já registrado. O redirect foi capturado sem segui-lo ao callback Claude; nenhuma conta Claude ou credencial humana foi acessada. As escritas foram feitas pelo cliente MCP oficial, sem navegador, clique no app ou chamada a Google/Gemini. Scripts/evidências temporários ficaram somente em `/tmp/opencode`.

| Cenário | Resultado observado |
| --- | --- |
| Endpoint público | MCP sem token: 401 com `WWW-Authenticate` apontando ao metadata correto |
| Metadata | 200 JSON, resource exato e issuer Supabase; sem fallback HTML |
| OAuth/JWKS | PKCE S256 com cliente existente, assinatura e claims verificadas; sem alterar configuração |
| SDK oficial | Initialize e tools/list retornaram seis ferramentas: searchItems, getItem, categories, history, proposeChange e executeChange |
| Annotations | executeChange anunciado como escrita; a execução usa ticket assinado |
| Proposta | Preview/ticket estruturados, sem link obrigatório; Item e ledger não mudaram antes de executeChange |
| Cadastro | TESTITEM criado com quantidade 10, Shelf 999 / B99, Tools; status committed |
| Take | Retirada de 3: quantidade 7; status committed |
| Add | Adição de 2: quantidade 9; status committed |
| Relocate | Destino Shelf 998 / W98, quantidade 9; status committed |
| Recategorize | Categoria Electronics, quantidade 9; status committed |
| Replay concorrente | Duas chamadas executeChange com o mesmo ticket em cada operação: um movimento e uma entrada no ledger por operação |
| Visibilidade pós-COMMIT | Estado lido administrativamente após cada resposta coincidiu com o resultado MCP |
| Histórico | history retornou cinco movimentos; ledger continha cinco operações da conta sintética |
| Membership pendente | Replay de ticket já executado foi bloqueado com HTTP 403 |

As funções publicadas carregaram os módulos compartilhados e o SDK sem erro. A repetição concorrente comprova idempotência hospedada; não determina quantas instâncias físicas a Vercel alocou. A suíte `npm test` foi reexecutada antes do deployment: 47 testes passaram.

Expiração, colisão de payload, conflito de versão, usuários/tokens incorretos, timeout, desconexão e resultado incerto de COMMIT conservam as provas locais aprovadas no handoff; não foram repetidos integralmente em produção. O smoke não simula diálogo humano: comprova a ferramenta de execução, não que o Claude pediu consentimento. A conexão com uma conta real Claude estava pendente nessa rodada e não é inferida do sucesso do SDK.

## Preservação e limpeza

Backup privado novo antes desta publicação: `/tmp/opencode/tonitech-before-mcp-direct-production-20261021.json`, criado com permissão 0600, fora do repositório. A base já tinha 148 movimentos, preservando a movimentação posterior à publicação anterior. Nenhum backup foi restaurado. O export final veio da mesma RPC administrativa consistente. Comparação SHA-256 sobre JSON canonicalizado, com chaves e arrays ordenados para independência da ordem de retorno:

| Conteúdo | Quantidade antes/depois | SHA-256 antes = depois |
| --- | --- | --- |
| Itens | 143 / 143 | `34ebe16711baf4e501273f8f869aa0abf951b81e2ef4aa36c3e8dcc986b74d94` |
| Movimentos | 148 / 148 | `f4173649115e61d36191f45e5ded9ae212f982ad0c1b1999c7817344d9afb12c` |
| Originais | 146 / 146 | `5c316a7cfea8fc5572139f0353e146ce6e1d2dd08422d235b15af81aac19afa0` |

TESTITEM removido por seu ID próprio, com seus cinco movimentos; conta sintética removida com membership e ledger vinculados por cascade. IDs de Item foram resolvidos somente a partir das operações conhecidas e do ator da fixture. Consultas finais confirmaram ausência do Item, movimentos, membership e operações. Limpeza terminou sem falhas, e hashes finais coincidiram com o snapshot novo. As sequências PostgreSQL podem avançar durante testes, sem alterar os dados preservados.

## Validação humana relatada — estado atual

**VALIDAÇÃO HUMANA relatada:** após reconectar o conector para carregar as novas instruções, o usuário informou nesta conversa: “Testei e funcionou. Ele adicionou mais3”. O relato confirma a conexão real no Claude e a execução direta pelo MCP de uma entrada (Add) de +3. A pendência humana de conexão básica está concluída.

Essa confirmação vem do usuário, não de teste executado pelo agente. O relato não fornece Item/UUID, saldo, horário, trace ou comandos. Não comprova os demais cenários do playbook, nem permite atestar como o consentimento foi solicitado. As métricas e verificações técnicas acima pertencem às respectivas rodadas e não são alteradas por esse relato.

## Uso

Seguir `app/MCP.md`. Para conector existente, atualizar/reconectar para recarregar as seis ferramentas; não é necessário novo login pela atualização, salvo solicitação do Claude por sessão expirada/revogada. URL e Client ID continuam iguais. Conferir proposta e dar consentimento na conversa; executeChange executa diretamente, sem abrir o app. O backend não atesta confirmação humana.
