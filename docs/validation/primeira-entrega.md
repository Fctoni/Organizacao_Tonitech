# Evidências da primeira entrega

Registro histórico das verificações anteriores à publicação; o resultado posterior está em `publicacao.md` nesta pasta.

Execução local em 2026-10-20. Implementação disponível no workspace para revisão; nenhum deploy realizado. Não há aceite independente nem validação visual concluída.

## Escopo validado

| Check | Resultado |
| --- | --- |
| `TMPDIR=/tmp/opencode bash .claude/scripts/test-inventory.sh` | 58 checks aprovados |
| `TMPDIR=/tmp/opencode python3 .claude/scripts/test-inventory-boundaries.py` | 126 checks aprovados |
| `TMPDIR=/tmp/opencode python3 .claude/scripts/test-inventory-export.py` | Export determinístico, bytes CRLF preservados, extras/corpo/aliases/referências preservados, fontes separadas e nenhuma mutação |
| `node scripts/fresh-check.mjs` dentro de `app` | Banco local vazio → quatro migrations → integrações reais → importação → backup → verificação do schema |
| `npm test` dentro de `app` | Busca sem caixa/acento por nome/aliases, filtros combinados e ordenação numérica de Place |
| `node scripts/build-local.mjs` | TypeScript e build Vite aprovados com configuração pública local |
| `node scripts/http-check.mjs` | App servido por HTTP; endpoint rejeita método indevido e chamada sem autenticação; resposta no-store |
| `node scripts/check-bundle.mjs` | Credencial administrativa e bytes originais ausentes do bundle; sem source maps |
| `git diff --check` | Sem erros de whitespace |

As integrações usam Supabase Auth, PostgREST e Postgres reais. Foram comprovados: cadastro, Take com piso zero/aviso, Add concorrente, Take concorrente, encadeamento do histórico, localização completa, normalização de Place, recategorização, rejeição de quantidades inválidas e aliases nulos.

RLS foi exercitada como anônimo, outro usuário autenticado, membro com troca pendente e membro liberado. Também foram rejeitados cadastro público, escrita direta, acesso aos snapshots, export administrativo e tentativa de liberação por user_metadata. Os cinco recursos de tabela têm RLS habilitada.

A troca de senha usa Admin API real. Testes rejeitam senha atual incorreta, reutilização da senha, token inválido e usuário fora da associação. Após sucesso, senha anterior, access token anterior e refresh token anterior não liberam dados; novo login funciona. Nenhum usuário efêmero permanece após os testes.

## Preservação e reconciliação

A importação local reconciliou 143 Itens, 11 categorias, 21 prateleiras e 61 Locations. Resultado: 141 in_stock, 2 out e 2 low_stock. Foram preservados 146 originais: 143 notas e 3 fontes auxiliares. O export não encontrou referências a anexos nos corpos.

Reimportação dos originais resultou em zero inserções. O teste dedicado alterou um Item de fixture no app e provou que reimportar não sobrescreve essa alteração. Origem conhecida com hash diferente e hash inválido são recusados. O backup privado foi verificado contra os hashes de todos os originais, com permissão 0600 e proteção contra sobrescrita.

O export antes/depois das integrações permaneceu igual. O estado Git não mostra alteração de notas reais. Alterações preexistentes no ADR-0003 e nos testes de reparo foram preservadas.

## Infraestrutura e bloqueios

O projeto remoto solicitado, `Tonitech-Inventario`, não foi criado. A API Supabase recusou a criação em Toniezzer, `sa-east-1`, porque Fctoni atingiu o limite global de dois projetos gratuitos ativos em organizações onde é administrador/proprietário. Mudar de organização não resolve esse limite. Nenhum projeto alheio foi alterado.

A instância local dedicada tem identificador `tonitech-inventory`, API na porta 55431 e Postgres na porta 55432. Os containers são encerrados ao final da verificação; o volume local preserva o banco validado. Não há senha real nem usuário real provisionado.

A primeira chamada direta de `supabase start` exibiu as credenciais padrão locais da CLI. As execuções posteriores usam captura de saída. Nenhuma credencial remota foi obtida ou exposta; credenciais locais não são usadas para deploy.

A skill `sessao-remota` exige Playwright MCP e ferramentas de navegador disponíveis. Elas não estão presentes nesta sessão. Portanto responsividade, navegação por teclado, foco do dialog e fluxo completo pela interface ainda precisam de avaliação no navegador. Não foi usada uma via alternativa para contornar esse requisito.

## Pendências para o chamador

1. Revisar a implementação e realizar a validação visual.
2. Resolver a quota de criação sem reutilizar ou alterar outro app.
3. Provisionar o projeto dedicado, aplicar configuração/migrations, importar e repetir os controles críticos no ambiente remoto.
4. Configurar Vercel e publicar somente `app`, após aprovação.
5. Provisionar o usuário real somente na etapa autorizada, entregar sua senha temporária exclusivamente no chat final e concluir o cutover.

Não foram criadas issues nesta execução. Decisões de planejamento ficam em `docs/agents/`; desenho do app em `.claude/docs/adr/0004-web-inventory.md`; schema atual em `.opencode/database/`. Nenhum commit ou push foi realizado.

## Rodada corretiva 1 — revisão e implementação atribuídas

Autor desta seção e das correções: agente `openai/gpt-6-astra`, inicialmente revisor-folha e depois promovido explicitamente a implementador pelo chamador. Data: 2026-10-20. Baseline da entrega: `a20c9e39f4896a2947c43b06a0fbbd27a4214f91`, incluindo arquivos ainda não rastreados. As evidências anteriores foram mantidas; não foram reexecutadas nesta rodada.

O chamador informou que os dois revisores independentes confirmaram R1 e R2 e adjudicou ambos como medium. Também autorizou corrigir R3, low. Esta seção registra a implementação pelo próprio autor de uma das revisões, não um novo aceite independente.

| Achado | Origem e cenário | Correção |
| --- | --- | --- |
| R1 — medium: renovação de sessão descarta formulário | Callback de autenticação do app novo limpava a seleção e voltava a verificar o acesso em qualquer evento, inclusive renovação e reconfirmação da mesma identidade. | O observador mantém formulário e acesso durante a revalidação da mesma identidade, atualiza a sessão/token e limpa os dados na saída, troca de identidade ou resposta sem autorização. Consultas ficam fora do callback síncrono do Auth; respostas superadas ou posteriores à desmontagem são ignoradas. |
| R2 — medium: consulta posterior confunde gravação confirmada com falha | Cadastro e movimentações aguardavam o recarregamento dentro do mesmo tratamento de erro da gravação. Uma consulta indisponível após confirmação podia induzir a repetir Take/Add. | Cadastro, Take, Add, Relocate e Recategorize usam o mesmo fluxo de confirmação. Erros da gravação continuam sendo erros; falha apenas na consulta preserva o sucesso, informa que a alteração já foi salva e orienta usar Atualizar sem repetir a operação. O aviso de retirada excedente também é preservado. |
| R3 — low: histórico omite categorias | A interface mostrava “Categoria alterada”, quantidade e localização, sem apresentar os valores preservados nos snapshots. | A descrição da recategorização mostra categoria anterior → posterior de cada movimento, sem consultar a categoria atual do Item. |

As alterações de código estão em `app/src/main.tsx` e `app/src/inventory-ui.ts`. Os testes estão em `app/tests/inventory-ui.test.mjs`. Não houve mudança em dependências, migrations, infraestrutura, provisionamento ou notas do inventário.

### Provas executadas nesta rodada

Foi extraída a lógica de apresentação para uma interface testável, utilizada pelo app. Os testes usam a mesma implementação e substituem apenas a comunicação com Auth/RPC e os callbacks da apresentação. Não montam o DOM e não comprovam aparência, foco ou interação real no navegador.

| Etapa | Resultado observado pelo autor desta rodada |
| --- | --- |
| R1 — RED, antes da correção da condição de reset | O teste recebeu `loading` quando esperava `ready` ao renovar a mesma sessão; a lógica ainda descartava o formulário. |
| R1 — GREEN | Preservação do formulário em TOKEN_REFRESHED, SIGNED_IN e USER_UPDATED da mesma identidade; atualização do token; limpeza na saída/troca de identidade/perda de autorização; resposta tardia ignorada após saída ou desmontagem. |
| R2 — RED, antes de separar falha de consulta | `Consulta indisponível` escapou depois da gravação confirmada. |
| R2 — GREEN | Os cinco caminhos de gravação preservam confirmação e não repetem a escrita quando a consulta falha. Erros reais de gravação não confirmam nem recarregam. Aviso de retirada excedente preservado com e sem falha posterior. |
| R3 — RED, antes de exibir os snapshots | A descrição retornou `Categoria alterada · Quantidade: 3 · 2/W05`, sem `Tools → Hardware`. |
| R3 — GREEN | Duas recategorizações consecutivas exibem os respectivos pares de categorias; cadastro com snapshot anterior nulo continua válido. |
| `npm test`, dentro de `app` | 7 testes aprovados: 6 testes novos de regressão e o teste existente de busca/filtros/ordenação. |
| `npm run build`, dentro de `app` | TypeScript e build Vite aprovados. Verificação de compilação; não comprova conexão com Supabase nem deploy. |
| `git diff --check` e `git diff --no-index --check /dev/null ARQUIVO` para cada um dos quatro arquivos desta rodada | Sem erros de whitespace, incluindo os arquivos ainda não rastreados. |

Não foram executados testes de banco, Auth real ou reconciliação nesta rodada, pois as correções ficaram no fluxo da interface. Não houve commit, push, delegação, provisionamento ou publicação. Playwright MCP continua indisponível; a validação visual e o fluxo completo no navegador continuam pendentes, sem uso de ferramenta alternativa. A quota remota continua sendo um bloqueio de entrega, não um bug de código.
