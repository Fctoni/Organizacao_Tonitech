# Decisões

| Data | Contexto | Decisão | Motivo | Alternativas descartadas | Substitui |
|------|----------|---------|--------|--------------------------|-----------|
| 2026-05-24 | Organização das regras do projeto | `CLAUDE.md` enxuto que só aponta; substância vive nas skills | `CLAUDE.md` carrega em toda sessão (custa contexto); skills carregam sob demanda; força o uso da skill e elimina duplicação | `CLAUDE.md` como SSOT com o workflow completo (a skill nunca disparava) | — |
| 2026-05-24 | Acesso ao inventário | Todo read/write passa por `inventory.sh`; nunca grep nem edição manual de notas | Mutação determinística + invariantes (status derivado de qty, qty≥0) num só lugar. Detalhe em ADR-0002 | Agente editar os `.md` diretamente | — |
| 2026-05-24 | Formato de saída dos scripts | Reads em TSV, writes em JSON | Menos tokens em listas (chaves uma vez); objeto único p/ resultado de write. Detalhe em ADR-0001 | JSON em tudo | — |
| 2026-05-24 | Modelagem de Item | Item = tipo/kind, `qty` = contagem, um único local (shelf, box) | Simplicidade; casa com o modelo take/add | Item = unidade física (qty sempre 1); Item = lote por local (multi-local) | — (multi-local virou pendência) |
| 2026-05-24 | Classificação | `category` é vocabulário controlado (Electronics, Hardware, Cables, Tools, Uncategorized); `aliases` são só sinônimos de busca | Evita drift de categorias no agrupamento; separa classificação de retrieval | `category` free-form; usar tags multivaloradas | — |
| 2026-05-24 | Navegação/visualização | Obsidian Bases (nativo) para filtrar/ordenar/buscar; Dataview vira dashboard secundário | Filtragem interativa (clique/busca) escala p/ muitos itens; nativo, sem dependência de terceiros | Só Dataview (editar query na mão); plugin de DB de terceiros | — |
| 2026-05-24 | Local de docs e memória | Tudo em `.claude/` (dotfolder oculto), não na raiz do vault | Vault é inventory-only (toda `.md` da raiz = nota de Item); CONTEXT/ADR/memória não devem virar notas no Obsidian | `CONTEXT.md` e docs na raiz do vault | — |
