# Memória: Git Operations

## Último commit
- Data: 2026-05-26
- Versão: — (sem versionamento adotado)
- Branch: main
- Alterações: backstop de categoria no `inventory.sh` (`new`/`set-category` rejeitam categoria fora do vocabulário, com mensagem auto-diretiva) + 3 testes, docs (CONTEXT/SKILL), 3 notas Sonoff, sync da memória de contexto

## Histórico de versões
| Data | Versão | Branch | Alterações | Status |
|------|--------|--------|------------|--------|
| 2026-05-24 | — | main | Commit inicial: estrutura `.claude/` (skill, scripts, CONTEXT, ADRs, memória contexto), notas de itens, Base e dashboard | Concluído |
| 2026-05-26 | — | main | Inventário populado (13 itens novos), ~17 categorias ad-hoc → 8 canônicas, `set-category` + 5 testes (22 verdes), `CONTEXT.md`/`SKILL.md` atualizados, memória de contexto sincronizada | Concluído |
| 2026-05-26 | — | main | Backstop de categoria: `new`/`set-category` rejeitam valor fora do vocabulário com mensagem auto-diretiva (+3 testes, 25 verdes); 3 notas Sonoff (S33); docs e memória sincronizadas | Concluído |

## Padrões observados
- **Versionamento:** confirmado SEM versionamento (`vX.Y.Z`) — segundo commit também sem prefixo. Manter commits sem versão salvo orientação contrária do usuário.
- **Idioma:** português, sem emojis.
- **Categorias usadas:** DADOS (itens/notas), CONFIGURAÇÕES (CONTEXT/SKILL), SERVICES (scripts), DOCUMENTAÇÃO (memória contexto).
- **Branch:** tudo em `main` (vault single-user); usuário confirma o commit em main explicitamente a cada ciclo.
- **Ignorados (.gitignore):** `.obsidian/plugins/` (código de terceiro) e `.obsidian/workspace.json` (estado de UI volátil).
- **Staging:** arquivos nomeados individualmente; notas de Item têm espaços/parênteses no nome (sempre entre aspas).
