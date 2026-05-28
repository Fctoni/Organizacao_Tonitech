# Handoff — Extrair o `inventory.sh` (Python preso em heredoc) para um módulo Python real

> Workspace: `/home/felipe/obsidian/vaults/Organizacao_Tonitech` (vault Obsidian de inventário de garagem). **Modo de trabalho: INTERATIVO** — apresente o plano e confirme com o usuário antes de mexer; pergunte diante de qualquer dúvida.

## Contexto

Vault de inventário de garagem (uma nota = um item, frontmatter YAML). Arquitetura:
- **skill `garage-inventory`** — SSOT dos workflows (`.claude/skills/garage-inventory/SKILL.md`).
- **`.claude/scripts/inventory.sh`** — interface CRUD única (ADR-0002: todo read/write passa por ele; o agente nunca faz grep/edição manual).
- **`.claude/scripts/test-inventory.sh`** — 25 testes caixa-preta (vault temporário; roda `bash "$INV" <cmd>` e parseia a saída TSV/JSON).

**Achado que motiva esta tarefa:** o `inventory.sh` (434 linhas) é, na prática, **~18 linhas de bash + ~415 de Python preso num heredoc** (`python3 - "$@" <<'PY' … PY`, linhas 19–434). Usa só `stdlib` (sem PyYAML). O bash é **vestigial** — resolve `SCRIPT_DIR`/`VAULT_DIR` e delega. A lógica (parse de frontmatter, regex, validação, TSV/JSON) é data-processing puro = território de Python, e **já é Python** — só está numa string heredoc, o que impede testes de unidade, linter, type-checker e edição com language server.

## Missão

**Extrair** o corpo Python do heredoc para um módulo `.py` real, mantendo `inventory.sh` como **shim fino**. O objetivo é destravar testabilidade/tooling **sem churn** nas referências nem no ADR-0002.

## Plano cirúrgico (apresente ao usuário antes de executar)

1. Criar `.claude/scripts/inventory.py` com o corpo Python atual (linhas 20–433 do `.sh`). `VAULT_DIR` continua vindo do env; o shim o define. `sys.argv` já funciona igual.
2. Reduzir `.claude/scripts/inventory.sh` a um shim (~5 linhas): resolve `SCRIPT_DIR`, exporta `VAULT_DIR` default (dois níveis acima), e `exec python3 "$SCRIPT_DIR/inventory.py" "$@"`. Repassar exit code e stderr.
3. Rodar `bash .claude/scripts/test-inventory.sh` → **confirmar os 25 verdes** (o contrato da CLI não muda). Este é o gate.
4. (Recomendado) Adicionar testes de unidade `pytest` nas funções puras, agora importáveis: `fold`, `parse`, `split_frontmatter`, `place_from_flags`, `validate_category`, `status_for`. Mantêm-se TAMBÉM os testes caixa-preta (testam o contrato da CLI).

## Invariantes do contrato — NÃO quebrar

- Reads (`find`/`list`/`low-stock`) → **TSV** (header + 1 linha por item). Writes (`take`/`add`/`new`/`relocate`/`set-category`/`migrate`) → **JSON** objeto. Erros → `{"error":"…"}` em stderr, exit ≠ 0.
- `status` derivado de `qty` (`qty>0`→`in_stock`, `==0`→`out`); `take` faz floor em 0.
- `place` = `B<n>`/`W<n>` zero-pad ≥2 dígitos; `migrate` é idempotente.
- `VAULT_DIR` default = dois níveis acima do script; `DASHBOARD = "Inventory Dashboard.md"` é excluído dos itens.
- Subcomandos e flags exatamente como em `inventory.sh --help`.

## Churn — quase zero, com 2 exceções honestas

Manter o nome `inventory.sh` (shim) preserva: ADR-0002 ("acesso via `inventory.sh`"), `SKILL.md` (`SCRIPT=…/inventory.sh`), agent-memory, `test-inventory.sh` (`bash "$INV"`). **Não tocar nesses.**

**As 2 únicas referências que precisam mudar** (porque citam *onde a tupla `CANONICAL_CATEGORIES` mora*, e ela passa pro `.py`):
1. `.claude/CONTEXT.md` (~linha 46): "…`CANONICAL_CATEGORIES` tuple in `.claude/scripts/inventory.sh`" → trocar para `inventory.py`.
2. A mensagem de erro dentro do próprio script (`validate_category`, ~linhas 244–245): "add it to BOTH CONTEXT.md and the `CANONICAL_CATEGORIES` tuple in inventory.sh" → trocar para `inventory.py`.

## Suggested skills

- **`garage-inventory`** — leia o SKILL.md + rode `inventory.sh --help` para entender o contrato antes de mexer.
- Use `bash .claude/scripts/test-inventory.sh` como gate de regressão a cada passo.

## Referências (não duplicar — consultar)

- `.claude/scripts/inventory.sh` (estado atual: bash+heredoc-Python), `.claude/scripts/test-inventory.sh`.
- ADRs: `.claude/docs/adr/0002-script-mediated-mutation.md`, `0003-coded-place-for-surface-location.md`.
- `.claude/CONTEXT.md` (glossário + vocabulário de categorias), `.claude/skills/garage-inventory/SKILL.md`.

## Modo de trabalho: INTERATIVO

- Apresente o plano acima ao usuário e confirme antes de criar/alterar arquivos.
- Mostre o diff do shim e do `inventory.py` antes de gravar, se o usuário quiser revisar.
- Rode os testes e relate o resultado (25 verdes) antes de considerar a tarefa concluída.
- Diante de qualquer ambiguidade no contrato, pergunte em vez de decidir sozinho.
