---
name: garage-inventory
description: Preserva, audita e exporta as notas originais do inventário no Obsidian por inventory.sh. Use quando recuperar conteúdo original, conferir a origem importada ou exportar o vault preservado. Para saldo, localização e movimentações atuais do app, use web-inventory.
---

# Notas originais do inventário

Esta skill opera os originais preservados do vault. O app é a fonte operacional; consultas e movimentações atuais pertencem à skill `web-inventory`. Não registre Take/Add, cadastros, Relocate ou Recategorize nas notas em paralelo com o app.

Requer Bash, Python 3 (biblioteca padrão) e Git para descoberta do repositório. Execute de qualquer diretório dentro do checkout. Todos os caminhos abaixo são relativos à raiz.

```bash
ROOT="$(git rev-parse --show-toplevel)" &&
SCRIPT="$ROOT/.claude/scripts/inventory.sh" &&
test -x "$SCRIPT" &&
export VAULT_DIR="$ROOT" &&
"$SCRIPT" --help
```

Leia o help no início da tarefa. Ele é a fonte dos comandos e formatos. Mantenha as variáveis no mesmo shell ou repita a preparação em ferramentas com shells separados. Não faça grep nem edite notas manualmente: use `inventory.sh` para acessar os originais. A linguagem do domínio fica em `.claude/CONTEXT.md`; as decisões ficam em `.claude/docs/adr/`.

## Preservação e auditoria

Use as consultas do script para conferir conteúdo original e deixe explícito que quantidades e localizações são as preservadas, não o estado operacional. Havendo vários resultados, peça a escolha ao usuário. Não interprete ausência no vault como ausência no app.

```bash
"$SCRIPT" export
```

O export JSON contém projeções, corpo, campos extras, referências, bytes originais e SHA-256 recuperáveis. Leituras comuns retornam TSV; erros retornam JSON em stderr. Reporte avisos de origem malformada. Não sobrescreva originais durante recuperação ou exportação. Manutenção explicitamente solicitada nas notas exige escopo próprio e conferência do help antes de qualquer escrita.

## Verificação do script

```bash
TMPDIR=/tmp/opencode bash "$ROOT/.claude/scripts/test-inventory.sh"
TMPDIR=/tmp/opencode python3 "$ROOT/.claude/scripts/test-inventory-boundaries.py"
TMPDIR=/tmp/opencode python3 "$ROOT/.claude/scripts/test-inventory-export.py"
```

Os testes usam fixtures isoladas; nunca direcione testes de mutação ao vault real. O diretório temporário precisa existir. Após alterar exportação, execute também o teste de exportação.
