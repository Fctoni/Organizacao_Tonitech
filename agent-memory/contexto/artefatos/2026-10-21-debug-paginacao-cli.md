---
titulo: Correção da paginação da CLI operacional
data início: 2026-10-21
data fim: 2026-10-21
status: concluído
tags: [inventario, cli, debug, paginacao]
resumo: Consulta autenticada falhava na segunda página por UUID entre aspas; corrigida a serialização e fortalecida a fixture de regressão.
---

## Diagnóstico e correção

- A consulta de caixas térmicas retornava HTTP 400 mesmo com `auth status` indicando `ready`; o primeiro acesso obrigatório deixou de ser uma pendência.
- A instrumentação temporária de fetch mostrou 143 itens na primeira página e erro PostgreSQL `22P02` na segunda, cujo filtro era `id=gt."UUID"`.
- Removido `JSON.stringify` do cursor nos filtros escalares compartilhados por itens, categorias e histórico; `URLSearchParams` faz a codificação da URL.
- A fixture removia aspas dos filtros e escondia o defeito; agora preserva o valor escalar e rejeita UUID inválido como a API real.

## Verificação

- O teste de paginação falhou com HTTP 400 antes da correção; a suíte completa passou depois: `node --test .claude/skills/web-inventory/scripts/cli.test.mjs`, 11 testes aprovados.
- A consulta original `find 'térmica'` funcionou em produção e retornou dois Itens, sem páginas restantes; nenhuma movimentação foi realizada.
- A instrumentação foi executada em memória, sem persistir credenciais nem logs de depuração no código.

## Arquivos-chave

- `.claude/skills/web-inventory/scripts/inventory.mjs`: CLI com correção no cursor da função `rows`.
- `.claude/skills/web-inventory/scripts/cli.test.mjs`: regressão na fixture de leituras paginadas.
- `.claude/skills/web-inventory/SKILL.md`: procedimento operacional da CLI, já existente no workspace e ainda não versionado no início da sessão.

## Lição

- Uma fixture que normaliza entradas inválidas pode aprovar requisições rejeitadas pelo servidor real; filtros escalares devem preservar o valor enviado pelo cliente.
