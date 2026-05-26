# Memória: Git Operations

## Último commit
- Data: 2026-05-26
- Versão: — (sem versionamento adotado)
- Branch: main
- Alterações: migração executada (32 notas `box`→`place`) + correções pós-review — validação de `place` (regex `PLACE_RE`, leitura emite warning não-fatal, write anexa `place_warning`); `relocate` exige shelf+place sempre (sem move shelf-only); `migrate` limpa `box` órfão (lista `cleaned`); "position" fora do `_Avoid_`. 58 testes verdes. Review (2 agentes Opus): APROVADO.

## Histórico de versões
| Data | Versão | Branch | Alterações | Status |
|------|--------|--------|------------|--------|
| 2026-05-24 | — | main | Commit inicial: estrutura `.claude/` (skill, scripts, CONTEXT, ADRs, memória contexto), notas de itens, Base e dashboard | Concluído |
| 2026-05-26 | — | main | Inventário populado (13 itens novos), ~17 categorias ad-hoc → 8 canônicas, `set-category` + 5 testes (22 verdes), `CONTEXT.md`/`SKILL.md` atualizados, memória de contexto sincronizada | Concluído |
| 2026-05-26 | — | main | Backstop de categoria: `new`/`set-category` rejeitam valor fora do vocabulário com mensagem auto-diretiva (+3 testes, 25 verdes); 3 notas Sonoff (S33); docs e memória sincronizadas | Concluído |
| 2026-05-26 | — | main | Localização com parede: `box`→`place` codificado (B<n>/W<n>, N≥1, shelf≥1); `relocate`/`migrate`; CONTEXT/SKILL/ADR-0003/Dashboard; 48 testes verdes; notas FNIRSI/Livolo/Dog Food + Sonoff qty. Migrate pendente | Concluído |
| 2026-05-26 | — | main | Migração executada (32 notas `box`→`place`) + pós-review: validação de `place` (regex, warning não-fatal na leitura, `place_warning` na escrita), `relocate` exige shelf+place sempre, `migrate` limpa `box` órfão, "position" fora do `_Avoid_`; 58 testes verdes; review APROVADO | Concluído |

## Padrões observados
- **Schema `place` (parede):** localização agora é `(shelf, place)`; `place` é código `B<n>`/`W<n>` zero-pad ≥2 dígitos. `migrate` converte notas legadas `box: N` e é idempotente. SKILL.md aponta para `inventory.sh --help` como SSOT da superfície de comandos (anti-drift).
- **Versionamento:** confirmado SEM versionamento (`vX.Y.Z`) — segundo commit também sem prefixo. Manter commits sem versão salvo orientação contrária do usuário.
- **Idioma:** português, sem emojis.
- **Categorias usadas:** DADOS (itens/notas), CONFIGURAÇÕES (CONTEXT/SKILL), SERVICES (scripts), DOCUMENTAÇÃO (memória contexto).
- **Branch:** tudo em `main` (vault single-user); usuário confirma o commit em main explicitamente a cada ciclo.
- **Ignorados (.gitignore):** `.obsidian/plugins/` (código de terceiro) e `.obsidian/workspace.json` (estado de UI volátil).
- **Staging:** arquivos nomeados individualmente; notas de Item têm espaços/parênteses no nome (sempre entre aspas).
