# Prompt inicial para o agente novo

Abra uma sessão do Claude Code em `/home/felipe/obsidian/vaults/Organizacao_Tonitech` e cole o texto abaixo:

---

Leia o handoff em `tmp/handoff-inventory-python.md` e continue o trabalho a partir dele.

Missão: extrair o corpo Python que hoje vive preso num heredoc dentro de `.claude/scripts/inventory.sh` para um módulo Python real (`.claude/scripts/inventory.py`), e reduzir o `inventory.sh` a um shim fino que chama `python3 inventory.py "$@"`. O objetivo é destravar testes de unidade/linter/type-checker SEM mudar o contrato da CLI nem renomear o `inventory.sh`.

Trabalhe em modo INTERATIVO: primeiro invoque a skill `garage-inventory` e rode `inventory.sh --help` para conhecer o contrato; depois apresente o plano e confirme comigo antes de criar/alterar arquivos. Use `bash .claude/scripts/test-inventory.sh` como gate — os 25 testes devem continuar verdes. Preserve todos os invariantes do contrato (TSV nos reads, JSON nos writes, status derivado de qty, place B/W zero-pad, vocabulário canônico). Não toque nas referências a `inventory.sh` (ADR-0002, SKILL.md, agent-memory), EXCETO as 2 que citam onde mora a tupla CANONICAL_CATEGORIES (CONTEXT.md ~linha 46 e a mensagem de erro do validate_category), que devem passar a apontar `inventory.py`.
