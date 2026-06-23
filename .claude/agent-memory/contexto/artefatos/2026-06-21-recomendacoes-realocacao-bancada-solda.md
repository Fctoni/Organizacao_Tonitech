---
titulo: Recomendações de realocação após carga de 28 itens (bancada de solda S34, Unifi, displays)
data início: 2026-06-21
data fim: null
status: em-andamento
tags: [inventario, realocacao, recomendacoes, garage-inventory, solda, unifi, displays]
resumo: Análise de posicionamento dos 28 itens cadastrados a partir de 2026-05-21.csv. Aponta 5 recomendações de realocação/consolidação (solda dividida S21↔S34, duplicata de suporte de estanho, displays espalhados, Unifi dividido, placa comemorativa entre eletrônicos) e 3 categorias inferidas a revisar. Nenhuma realocação foi executada — aguarda decisão do usuário.
---

# Recomendações de realocação — carga de 28 itens (2026-06-21)

## 1. Objetivo / contexto

O usuário preencheu `2026-05-21.csv` (na raiz do vault) com 28 itens físicos
adicionados à garagem e pediu: (a) cadastrar todos via `garage-inventory`;
(b) analisar se cada um foi colocado no lugar certo ou errado; (c) ao final,
sugerir mudanças de posição. Os 28 itens foram cadastrados com sucesso. Este
artefato carrega a **análise e as recomendações** — nada foi realocado ainda.

## 2. O que foi feito

- 28 itens criados via `inventory.sh new` (todos OK). Ver `historico.md` (2026-06-21).
- CSV **sem coluna de categoria** → categoria inferida pelo vocabulário canônico
  do `CONTEXT.md` em cada item.
- 2 nomes com `/` renomeados (o `/` quebra o caminho do arquivo da nota):
  - `Estação de solda / retrabalho` → `Estação de solda - retrabalho`
  - `Radxa Penta Sata Hat p/ Raspberry Pi` → `Radxa Penta Sata Hat para Raspberry Pi`
- 2 notas livres gravadas no corpo (script não tem campo de notas):
  `Escova para limpeza de fluxo` ("Escova de dentes") e
  `Placa FKS organizador` ("Edição 2022 - placa de agradecimento").
- CSV de origem: `2026-05-21.csv` (raiz do vault). Notação do CSV: `Shelf` = `S<n>`,
  `Place` = `B<n>`/`W<n>`; mapeado para `--shelf <n>` + `--box/--wall <n>`.

## 3. Recomendações de realocação (não executadas)

### 🔴 R1 — Solda dividida entre S21 e S34
Bancada de solda nova montada em **S34/B01** (estação, sugador, wick, suportes,
tweezers, escova). Mas a **S21** já guarda consumíveis de solda: `Pasta de Solda`,
`Fluxo de Solda ZJ-18`, `Limpador Ponteira de Solda`, `Suporte para Estanho (Solda)`.
→ Consolidar numa prateleira só. Como a S34 é a bancada dedicada, mover esses 4
itens da S21 para a S34 (`relocate --shelf 34 --box 1`).

### 🔴 R2 — Duplicata funcional de suporte de estanho
`Suporte rolo de estanho` (novo, S34/B01) ≈ `Suporte para Estanho (Solda)` (S21/B04).
→ Confirmar se são dois objetos reais; se for o mesmo, unificar num item só.

### 🟡 R3 — Displays espalhados
Displays novos em **S34/B03 e B05**; displays/molduras antigos em **S23**
(`Moldura para Display 7" ESP32`, cases) e **S24** (B11/B99). O `Display 7" Viewe`
(S34) ficou longe da sua moldura (S23). → Aproximar o Viewe da moldura, ou mover a
moldura para a S34.

### 🟡 R4 — Unifi dividido
`Caixa Unifi Dream Router` sozinha em **S53/B01**; `Suporte roteador Unifi` +
`Cabo de rede original unifi` em **S35/W02**. → Juntar os três itens Unifi.

### 🟢 R5 — Placa FKS (placa de agradecimento) entre eletrônicos
S1 é caixa de eletrônica; placa comemorativa em S1/B99 é corpo estranho (B99 parece
ser o código "sem caixa definida"). → Mover para prateleira de itens domésticos/diversos
(ex. S44/S54) se quiser organização temática.

**Coerentes, sem mudança:** chaves Allen / sargento / esquadro na S21 (bancada de
ferramentas junto aos instrumentos); Raspberry Pi + Radxa + CYD juntos no B05;
bornes e conectores no B03/B04; lint roller (Household) na S45; cabos diversos no B02 da S34.

## 4. Categorias inferidas a revisar (⚠️)

- `Kit identificadores de cabos anilha` → **Cables** (anilhas não são condutores;
  poderia ser Hardware/Uncategorized).
- `Raspberry Pi 5 8GB` → **Computers** (debatível vs Electronics; serve de NAS com a Radxa).
- `Caixa Unifi Dream Router` → **Electronics** (debatível vs Computers).

## 5. Gotchas / lições

- CSV de entrada sem coluna de categoria → o agente **infere** e lista as escolhas
  para revisão; não deixar tudo Uncategorized silenciosamente.
- `/` em nome de item quebra o caminho da nota → trocar por `-` ou "para" (regra já
  na memória do projeto).
- `--box`/`--wall` recebem o **inteiro** (ex. `--box 3` → `B03`); a notação `S<n>`/`B<n>`
  do CSV é só de apresentação.

## 6. Pendências

- Decidir e (se aprovado) executar R1–R5 via `relocate`; revisar as 3 categorias ⚠️.
  Rastreado em `pendencias.md`.

## 7. Referências

- CSV de origem: `2026-05-21.csv` (raiz do vault).
- `historico.md` (2026-06-21). `briefing.md` (próximos passos).
- Skill `garage-inventory`; glossário `.claude/CONTEXT.md`.
