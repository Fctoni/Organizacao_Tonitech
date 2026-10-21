---
titulo: Limitação — Item com local único (sem multi-local)
data início: 2026-05-24
data fim: null
status: em-andamento
tags: [inventario, limitacao, modelagem]
resumo: |
  Hoje cada Item ocupa exatamente um (shelf, box). Documenta o que o código faz,
  por que isso é restritivo, e a direção futura para suportar armazenamento
  multi-local. Pendência ativa em pendencias.md.
---

# Limitação: Item com local único

## O que o código faz hoje
- Cada Item é **uma nota** com **um único** par `(shelf, box)` no frontmatter.
- `inventory.sh new` cria uma nota única com um local; `take`/`add` alteram a `qty`
  desse local; `find` retorna esse único local.
- Não há forma de representar "5 ESP32 na caixa 3 **e** 3 ESP32 na caixa 7" sem criar
  duas notas com nomes distintos (ex.: `ESP32 (Box 3)` / `ESP32 (Box 7)`).

## Por que é restritivo (por que é "ruim")
- Itens reais se espalham por vários locais; o usuário quer poder dividir.
- O contorno por nomes artificiais quebra o `find` por nome, duplica `aliases`,
  fragmenta o agrupamento por categoria e desincroniza a contagem total do Item.

## Direção futura (multi-local)
Opções a avaliar quando o inventário crescer:
- **(a) Campo `locations`**: lista de `{shelf, box, qty}` dentro da nota do Item.
  Uma nota por Item; `qty` total = soma das parcelas.
- **(b) Notas-lote**: notas por local vinculadas a um Item canônico.

Implicações em qualquer caminho:
- **Schema**: `shelf`/`box`/`qty` deixam de ser escalares no topo do frontmatter.
- **`inventory.sh`**: `take`/`add` precisam de `--shelf`/`--box` (ou resolver o local);
  `find`/`list` precisam somar/listar parcelas; `low-stock` compara a soma vs mínimo.
- **Saída**: TSV/JSON precisam expressar múltiplos locais por Item.
- **Visualização**: Base e Dataview precisam agregar `qty` por Item.
- **Glossário**: revisar a definição de **Location** em `CONTEXT.md` (hoje: "um Item
  tem exatamente um local").

## Decisão atual
Aceitar o local único como **limitação temporária conhecida**; revisitar via a
pendência de multi-local. Registrado também em `decisoes.md` (modelagem de Item).
