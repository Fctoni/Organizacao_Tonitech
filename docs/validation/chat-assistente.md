# Validação da entrega de chat e assistente

Resumo consolidado em 21/10/2026 dos registros de execução da entrega. O usuário autorizou remover capturas, logs de avaliação e relatórios intermediários não versionados. Os resultados abaixo foram transcritos desses registros; esta consolidação não executou novamente testes remotos, migrations ou deployment. As decisões permanecem nos ADRs 0005 e 0006.

## Proveniência da revisão

O chamador informou revisão do chat pelas sessões `ses_ea11dea19ffefmKf0c9PZQMADb` e `ses_ea11dea03ffe31TLljTLJdy2Fd`, dos cartões por `ses_ea0df5c95ffeWmYdnwI1WokURK` e da resposta incompleta por `ses_ea0c0546bffeyy7n9NpWOvqAZY`. Para configurações e consumo, informou revisão completa por `ses_ea0a4a7d7ffekXpgA0kehltVN6` e `ses_ea0a4a7c1ffey35XE969kUxzmV`, com correção de trim/Unicode e validação cruzada, sem bloqueios abertos. Essas atribuições vêm do relato do chamador, não de acesso às sessões. A correção do falso positivo do smoke de navegador foi feita por um revisor promovido a implementador e não constitui parecer independente adicional.

## Comandos e resultados registrados

Execuções anteriores do app em `app`, com fixtures e destino explícito quando aplicável. Os scripts pontuais de navegador, smoke remoto e avaliação foram removidos após a entrega; suas verificações abaixo são registros históricos, não comandos disponíveis. Testes unitários e integrações de regressão permanecem executáveis.

| Verificação | Resultado e alcance |
| --- | --- |
| `npm test` | 42 testes aprovados na rodada final de validação do assistente |
| `npm run build` | TypeScript/Vite aprovados; avisos conhecidos de dependências e tamanho do bundle |
| `npm run test:assistant:db` | Banco local descartável, cadeia completa, RLS/grants, responsável/membro, imutabilidade, restauração e concorrência com duas conexões |
| Validação SQL → JavaScript | Whitespace e excesso de unidades UTF-16 rejeitados sem nova revisão; 6.000 emojis normalizados aceitos, lidos e restaurados |
| `npm run test:chat:integration` | Auth/JWT/RPC reais locais, confirmação concorrente, replay idempotente, assinatura, isolamento de usuário e erros definitivos |
| Navegador do chat | Interface/SDK e banco local reais, modelo simulado; contexto entre falas, confirmação, replay e erros terminais |
| Navegador do assistente | HTTP/SDK reais com banco/modelo sintéticos; teclado, conflito, Unicode, restauração, readonly, retry, interrupção e desconexão |
| Renderização incremental | SSE incremental local, cartões deduplicados, saldo atualizado, resposta vazia/incompleta, retry sem confirmação automática, desktop/mobile |
| Smoke remoto do chat | Fluxo remoto de API com Gemini real aprovado: consulta, esclarecimento, proposta, confirmação concorrente e replay; navegador concluído separadamente |
| Autoverificação do smoke | Ignorou alertas vazios ou externos ao chat e detectou erro real no chat |
| Smoke remoto do assistente | PASS remoto no deployment registrado: autorização, leitura da revisão, UI desktop/mobile, uma saudação real e consumo |

Playwright Node/CLI foi autorizado como exceção ao MCP indisponível. Os checks aprovados não registraram erro JavaScript nem overflow horizontal nos cenários desktop 1366×900/mobile 390×844. Edição/restauração e retry na interface publicada do assistente usaram respostas simuladas; gravação e concorrência reais de revisões foram provadas somente no banco local descartável. O aviso preexistente de `src` vazio no teste de Markdown não causou falha.

## Publicação e banco

App: https://tonitech-inventario.vercel.app. Deployment `dpl_65oQLLR6M65mYCuiG3jQH7UUXrSh`, Production/Ready, criado em 21/10/2026 às 13:56:32 (-03:00), publicado por `vercel deploy --prod --project tonitech-inventario --yes --json --scope felipes-projects-93cc7c39`. URL imutável: https://tonitech-inventario-p2op83oaf-felipes-projects-93cc7c39.vercel.app. HTTPS 200 e endpoint anônimo 401 comprovados. O envio ficou restrito ao app, sem scripts, testes, Supabase ou arquivos de ambiente.

As migrations `20261021000100` (operações do chat), `20261021000200` (revisões/papel de responsável) e `20261021000300` (validação normalizada) estão aplicadas localmente e no Supabase dedicado `pfhfhrypxncgzmnmlztm`. Aplicação remota por `supabase db push --linked --yes`; dry-run final sem pendências, sete migrations no catálogo e CHECK validado. Não há pendência de publicação ou migration desta entrega.

| Artefato conferido | SHA-256 |
| --- | --- |
| Migration `20261021000200_assistant_prompt.sql` | `da77d7776f1b2fdaec1fa640169d2a3f138051577d05501748115b16c4ab871a` |
| Migration `20261021000300_assistant_prompt_validation.sql` | `f5597ca38e92ba1fde7690cba448fb436545938c538a6942d387aab25c263123` |
| JS publicado `index-BEcwYuEk.js`, idêntico ao build local | `beba11aff8064c94f5ef40645ad19a41d9369a24dc01d2f5879e133898a163ad` |
| CSS publicado `index-B1p0f8uh.css`, idêntico ao build local | `c8bcc89cc75bf9c070cf2c4d0191a3e2f08bf10e6d62d0b9dcbfa600825767ae` |

## Preservação e consumo real

O export completo antes/depois da publicação do assistente permaneceu idêntico: 143 Itens, 147 movimentos e 146 originais; SHA-256 `fc664480b56ae369e1d7ac39afb06eaa2da97129f6598094e346e3ffbf088901`. A rodada anterior do chat usou baseline distinta, com 145 movimentos, também preservada: `351798dac592d2f8195eeb23346087adb28c06029077c3192b5ce94b574e9276`. Esses hashes não representam a mesma fotografia temporal.

Fixtures foram removidas. No smoke do assistente não houve movimentação de Item nem gravação de revisão: permaneceram a revisão inicial e `active_version = 1`. O responsável permanente indicado continuou único; campos anteriores de membership, revisões, ponteiro e ledger permaneceram iguais nas comparações registradas. Membro comum lê a revisão ativa sem editar nem acessar histórico; conta pendente/não associada é negada. O responsável sintético acessou editor/histórico; salvar e restaurar no navegador foram simulados.

A única chamada Google real do smoke final foi uma saudação pelo endpoint publicado, sem ferramentas nem retry. Metadata: `gemini-3.5-flash-lite`, revisão 1, uma etapa, 2.555 tokens de entrada + 13 de saída = 2.568, consumo `complete`. O teste posterior de retry usou duas streams simuladas de 15 tokens: acumulador de 30 tokens incompletos, duas execuções e uma mensagem. Isso valida o acumulador, não uma falha real do provedor. Tokens não equivalem a fatura; desconexões podem perder uso não recebido.

## Limites e avaliação de modelos

O fluxo remoto completo do chat foi comprovado em etapas anteriores; não foi repetido integralmente no deployment final. HTTP 503 reais do provedor foram observados antes de uma rodada de navegador aprovada. O falso positivo do smoke foi corrigido, mas não explica esses 503. A causa exata do incidente original de resposta incompleta não foi demonstrada remotamente; a reprodução local comprovou término em ferramentas sem síntese e resposta vazia, ambos cobertos por regressões. A saudação final comprova consumo e revisão capturada, não eficácia linguística das instruções.

A avaliação exploratória de Gemma não aprovou sua integração operacional: no controle alternado de quatro gerações sem ferramentas, as instruções integrais tiveram 0/2 conclusões e as curtas 1/2, com HTTP 500 e erro 503 dentro da stream. O único sucesso foi de transporte, não busca de inventário. Sucessos sintéticos anteriores usaram projeção indevidamente ampliada no fake e não provam equivalência ao banco real. A investigação registrou 26 tentativas de geração, duas consultas de metadados e 7.286 tokens conhecidos; uso de falhas não informado e custo monetário desconhecido. Não há causa determinística demonstrada no prompt nem reprovação de capacidade linguística. Não houve troca produtiva de modelo, provedor ou fallback por essa avaliação.

O contexto de retomada fornecido pelo usuário também registra limitações HTTP 429/503 do provedor. Esta limpeza não consultou o provedor nem reproduziu essas falhas.

## CLI operacional e originais

Na validação separada da CLI, `node --test .claude/skills/web-inventory/scripts/cli.test.mjs` aprovou 11 testes com HTTP simulado, 15 comandos e 51 entradas inválidas rejeitadas antes de request. Incluiu normalização de Place, paginação, autenticação sintética e escrita com tentativa única em falhas incertas. Não comprova login real nem Windows. Na raiz, com `TMPDIR=/tmp/opencode`, `bash .claude/scripts/test-inventory.sh` aprovou 58 verificações, `python3 .claude/scripts/test-inventory-boundaries.py` aprovou 126 e `python3 .claude/scripts/test-inventory-export.py` comprovou exportação determinística, completa e somente leitura. Esses resultados são registros da entrega, não reexecuções desta limpeza.

## Conferência da limpeza

Na retomada de 21/10/2026, foram reexecutados `npm test` (42 aprovados) e `npm run build` (TypeScript/Vite aprovados), após remover os comandos npm das provas pontuais. Houve avisos não bloqueantes de `src` vazio no teste de Markdown e de diretivas/anotações em dependências no build. O build desta conferência não foi comparado aos assets de produção. `git diff --check` passou. As integrações SQL/Auth e as provas remotas acima não foram reexecutadas nesta limpeza.
