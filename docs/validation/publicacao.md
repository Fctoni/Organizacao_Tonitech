# Publicação e verificações remotas

Registro da execução em 20/10/2026, horário de Brasília, com registros UTC em 21/10/2026. O app está publicado e o usuário real provisionado. A credencial temporária foi entregue no chat segundo o chamador; o primeiro acesso exige troca de senha. A correção posterior de apresentação Markdown e seus hashes estão em `test-evidence/markdown-note-fix.json` na raiz do repositório.

## Revisão e autorização

O chamador informou revisão completa: reviewer1 `ses_ea3cbf6afffe1zt2K4ec5y4prG` corrigiu R1/R2 medium e R3 low; reviewer2 `ses_ea3cbf69effeMANG24Q8eUwPgE` aprovou o delta independentemente. Essas correções foram preservadas. As sessões não foram acessadas pelo implementador; atribuição baseada no relato explícito do chamador. Os sete testes atuais, incluindo R1/R2/R3, passaram antes da publicação.

O usuário autorizou projeto novo na TecnoHard Pro existente, compute Micro e incremento estimado de US$ 10/mês. Nenhum plano, billing ou projeto alheio foi modificado. Autorizou também Playwright via Node/CLI como exceção ao transporte MCP, com dados efêmeros em produção. A consolidação no Git foi autorizada posteriormente.

## Recursos efetivamente criados

- Supabase: `Tonitech-Inventario`, ref `pfhfhrypxncgzmnmlztm`, organização `msxuixhofofwiecxcvkr`, região `sa-east-1`, criado com `--size micro`, estado ACTIVE_HEALTHY na criação.
- Vercel: projeto `tonitech-inventario`, ID `prj_sqIfntXBjKS8f1kYx5hyIAd0r6Ze`, escopo `felipes-projects-93cc7c39`.
- Deploy: `dpl_6p6ryt1N6Ux5UuqHt3Dw7U4jZfnP`, Production/Ready, publicado exclusivamente a partir de `app`.
- URL estável: https://tonitech-inventario.vercel.app.
- URL do deploy: https://tonitech-inventario-qlvhdz10n-felipes-projects-93cc7c39.vercel.app.
- Tracker: https://github.com/Fctoni/Organizacao_Tonitech/issues/1.

O checkout base é `a20c9e39f4896a2947c43b06a0fbbd27a4214f91`, com alterações locais não commitadas. Esse SHA não representa a versão publicada. A correspondência do frontend foi comprovada por igualdade byte a byte dos assets publicados com o build local configurado para o projeto remoto.

## Comandos e resultados

Executados em `app`, com `INVENTORY_PROJECT_REF` confirmado:

| Verificação | Resultado |
| --- | --- |
| `node scripts/apply-remote.mjs` | Migrations e Auth config aplicadas; vínculo conferido |
| `node scripts/import-remote.mjs` | 143 Itens inseridos, 146 originais reconciliados |
| `npm run test:integration` | RLS/Auth, concorrência, domínio, idempotência e mudança de senha aprovados remotamente |
| `node scripts/verify-remote.mjs` | Quatro migrations locais/remotas iguais; hashes, projeções, corpo e extras conferidos; nenhuma fixture/conta efêmera restante |
| `node scripts/deploy.mjs` | Variáveis enviadas via stdin; segredo administrativo restrito ao servidor; deploy Ready |
| `node scripts/check-production.mjs` | HTTPS 200 sem gate Vercel, headers, endpoint anônimo 401, assets iguais e sem service key/originais |
| Prova pontual de navegador (script removido após a entrega) | Fluxos aprovados em Chromium 156.0.8078.4; desktop 1366×900 e mobile 390×844; fixture/usuário removidos |

O roteiro de navegador cobriu login, bloqueio inicial, confirmação de senha divergente, troca pelo endpoint publicado, novo login, cadastro, busca por alias sem caixa/acento, filtros combinados, Take excedente, Add, Relocate, Recategorize, histórico com categorias antes/depois, Tab/Shift+Tab, Escape, retorno de foco, rolagem mobile e logout persistido. A execução aprovada não registrou pageerror nem requestfailed. Não houve impressão/PDF, trace ou vídeo. Capturas foram lidas pelo agente; não há cortes ou sobreposições evidentes nos controles observados. A avaliação é heurística, sem auditoria formal de contraste/leitor de tela ou hardware real.

As oito imagens aprovadas estão em `test-evidence/1/2026-10-21T02-27-38-827Z/` e integram a entrega autorizada. Capturas intermediárias não versionadas foram removidas na limpeza autorizada; dumps e transcrições não integram as evidências.

## Reconciliação final e hashes

143 Itens, 11 categorias, 21 prateleiras, 61 Locations, 141 in_stock, 2 out e 2 low_stock. Todos os 146 originais preservam os hashes; projeções operacionais também coincidem com a origem antes do cutover. Nenhuma nota real foi alterada.

- Manifesto ordenado de nomes/hashes dos originais: `0780cc969a6564b13f5d2e4809ab7c08577bc13d172b66a4b9a3df31bee84a1e`.
- Asset JS publicado `index-Cy3TdP9I.js`: `c8612dd7801e5d74d264827c5d8675d270a4b648a8fa714bf85069d794f4409b`.
- Asset CSS publicado `index-BvT1dlzq.css`: `1e09a42ec84af90fffd3f603fbd13c2560335be591e112a28227fef0f1def6e2`.

## Cadastro real e cutover

O usuário real foi criado no projeto dedicado confirmado por `server/provision-owner.mjs`. A senha foi gerada em memória e transportada pelo retorno de ferramenta, conforme esclarecimento explícito do chamador. Não foi gravada em arquivos, auditoria, GitHub, screenshots ou ambiente persistido. O chamador confirmou sua entrega no chat. Registro da tarefa: https://github.com/Fctoni/Organizacao_Tonitech/issues/2.

Verificações administrativas após cadastro: associação existente, `password_changed_at` nulo, nenhum `last_sign_in_at`, leitura de Itens e RPC de cadastro negadas ao cliente anônimo. Não foi realizado login nem troca da senha real. O bloqueio de membros pendentes, a troca obrigatória e a revogação de tokens já foram comprovados com contas efêmeras; essas evidências não representam primeiro acesso real.

O cutover está concluído por autorização: banco remoto do app como fonte operacional, vault preservado como origem. O primeiro login e a escolha da senha pessoal cabem ao usuário. Permanecem os limites das evidências visuais locais e da avaliação heurística descritos acima.
