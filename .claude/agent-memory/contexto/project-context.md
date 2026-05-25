# Contexto do Projeto

## Stack
- Vault Obsidian — notas markdown com frontmatter YAML.
- `bash` + `python3` (stdlib, sem PyYAML) para `inventory.sh`.
- Plugins Obsidian: **Dataview** (community, v0.5.70) e **Bases** (core, nativo).
- Workspace Claude Code via pasta `.claude/`.

## Arquitetura
Vault **inventory-only**: cada nota `.md` na raiz é um Item, com frontmatter
`shelf`, `box`, `qty`, `minimum_safe_stock`, `category`, `aliases`, `status`. Toda
leitura/escrita passa por `.claude/scripts/inventory.sh` (mutação determinística,
`status` derivado de `qty`). A skill `garage-inventory` é a SSOT de schema e
workflows; o `.claude/CLAUDE.md` só aponta para ela.

## Módulos principais
- `.claude/skills/garage-inventory/SKILL.md`: SSOT de schema + workflows.
- `.claude/scripts/inventory.sh`: interface CRUD (find/list/low-stock/take/add/new). Reads → TSV, writes → JSON.
- `.claude/scripts/test-inventory.sh`: testes do script (vault temporário).
- `.claude/CONTEXT.md`: glossário (linguagem ubíqua: Item, Category, Location, Take/Add…).
- `.claude/docs/adr/`: ADR-0001 (TSV/JSON), ADR-0002 (acesso só via script).
- `Garage Inventory.base`: UI interativa de navegação (Obsidian Bases).
- `Inventory Dashboard.md`: dashboard Dataview (secundário).

## Integrações externas
- Nenhuma (tudo local). Depende apenas dos plugins Obsidian Dataview e Bases.

## Convenções
- Notas de Item em **Specific Title Case**, em inglês.
- `status` é **derivado** de `qty` (in_stock>0 / out=0) — nunca setado à mão.
- Escrita só via `inventory.sh`; nunca grep/edição manual.
- `category` de vocabulário controlado (ver `CONTEXT.md`).
- Docs e memória vivem em `.claude/` (oculto no Obsidian), não na raiz do vault.
