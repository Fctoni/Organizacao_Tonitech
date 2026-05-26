# Memória: Git Operations

## Último commit
- Data: 2026-05-26
- Versão: — (sem versionamento adotado)
- Branch: main
- Alterações: população do inventário (13 itens novos), consolidação da taxonomia (8 categorias canônicas), subcomando `set-category` no `inventory.sh` + testes, e sync da memória de contexto

## Histórico de versões
| Data | Versão | Branch | Alterações | Status |
|------|--------|--------|------------|--------|
| 2026-05-24 | — | main | Commit inicial: estrutura `.claude/` (skill, scripts, CONTEXT, ADRs, memória contexto), notas de itens, Base e dashboard | Concluído |
| 2026-05-26 | — | main | Inventário populado (13 itens novos), ~17 categorias ad-hoc → 8 canônicas, `set-category` + 5 testes (22 verdes), `CONTEXT.md`/`SKILL.md` atualizados, memória de contexto sincronizada | Concluído |

## Padrões observados
- **Versionamento:** confirmado SEM versionamento (`vX.Y.Z`) — segundo commit também sem prefixo. Manter commits sem versão salvo orientação contrária do usuário.
- **Idioma:** português, sem emojis.
- **Categorias usadas:** DADOS (itens/notas), CONFIGURAÇÕES (CONTEXT/SKILL), SERVICES (scripts), DOCUMENTAÇÃO (memória contexto).
- **Branch:** tudo em `main` (vault single-user); usuário confirma o commit em main explicitamente a cada ciclo.
- **Ignorados (.gitignore):** `.obsidian/plugins/` (código de terceiro) e `.obsidian/workspace.json` (estado de UI volátil).
- **Staging:** arquivos nomeados individualmente; notas de Item têm espaços/parênteses no nome (sempre entre aspas).
