---
titulo: Avaliação de multi-local, realocações e categorias pendentes
data início: 2026-10-21
data fim: 2026-10-22
status: concluído
tags: [inventario, avaliacao, categorias, realocacao, multi-local]
resumo: Avaliação das pendências históricas com consultas autenticadas ao inventário operacional; recategorização autorizada das anilhas confirmada, revisão do Raspberry concluída e fatos físicos restantes identificados.
---

# Avaliação das pendências do inventário

## Escopo e fontes

O usuário autorizou avaliar as pendências antigas e, depois da investigação, executar somente a recategorização inequívoca das anilhas. O agente operou pela CLI da skill `web-inventory`, com a sessão já autorizada; a autoria técnica da operação no banco é a do usuário autenticado. A execução pelo agente não constitui confirmação humana de localização física.

As propostas originais permanecem preservadas em [limitação de local único](2026-05-24-limitacao-item-local-unico.md) e [recomendações R1–R5 e categorias](2026-06-21-recomendacoes-realocacao-bancada-solda.md). Elas foram usadas como contexto histórico, nunca como fonte de saldo atual.

## Evidências da investigação

O `--help` foi consultado e `auth status` retornou acesso `ready`. Pela CLI `node .claude/skills/web-inventory/scripts/inventory.mjs`, as buscas `find` por solda, estanho, display, FKS, anilha, Raspberry Pi, Unifi e ESP32 resolveram os candidatos antes de consultas por UUID. `categories` confirmou o vocabulário; `show` e `history` esclareceram os itens relevantes. Buscas e históricos retornaram `has_more: false` com `--limit 1000 --offset 0`.

Antes da escrita autorizada, os 13 cadastros centrais às oito recomendações tinham somente o evento `import`, de `2026-10-21T02:19:39.382084+00:00`, e o mesmo `updated_at`. Não havia realocação ou recategorização posterior registrada nesses itens. Essa é uma observação da consulta, não uma inspeção física nem um inventário permanente.

As consultas inicialmente paralelas disputaram a sessão e retornaram `session_busy`; a execução sequencial concluiu normalmente, sem remover locks ou trocar credenciais. As leituras não formam um snapshot transacional.

## Recategorização executada e verificada

Item: **Kit identificadores de cabos anilha**, UUID `bdf3216f-6a73-45b9-8170-6c917d4baf82`. O nome identifica acessórios físicos de identificação, não condutores; o corpo apenas repete o título. O glossário reserva Cables a condutores, e Hardware está disponível no vocabulário operacional.

Sequência executada na raiz do repositório, após autorização explícita:

```bash
node .claude/skills/web-inventory/scripts/inventory.mjs find 'Kit identificadores de cabos anilha' --limit 1000 --offset 0
node .claude/skills/web-inventory/scripts/inventory.mjs show bdf3216f-6a73-45b9-8170-6c917d4baf82
node .claude/skills/web-inventory/scripts/inventory.mjs recategorize bdf3216f-6a73-45b9-8170-6c917d4baf82 --category Hardware
node .claude/skills/web-inventory/scripts/inventory.mjs show bdf3216f-6a73-45b9-8170-6c917d4baf82
node .claude/skills/web-inventory/scripts/inventory.mjs history bdf3216f-6a73-45b9-8170-6c917d4baf82 --limit 1000 --offset 0
```

A revalidação encontrou um único candidato, ainda em Cables. A escrita retornou sucesso, sem repetição, com `warning: false`. `show` confirmou **Hardware** e `history` confirmou o evento **214**, ação **recategorize**, em **2026-10-22T01:52:59.538142+00:00**, com transição **Cables → Hardware**. Quantidade **1**, Location **S2/B03**, corpo, aliases e Minimum Safe Stock **0** foram preservados; `low_stock: false`. O histórico completo retornou dois eventos: importação e recategorização.

O campo operacional `category` é Hardware; `extra_fields.category` conserva Cables nos dados importados. A verificação usou o campo operacional e a transição do histórico, não os campos extras preservados. A API consultada não forneceu hash.

## Resultado das avaliações

- **Multi-local:** avaliação encerrada; decisão e critério de reabertura registrados no [ADR-0004, Modelo de localização](../../../.claude/docs/adr/0004-web-inventory.md#modelo-de-localização). A busca ESP32 encontrou moldura, display preparado para DS18B20 e CYD, sem comprovar parcelas do mesmo Item. A possível duplicidade dos suportes também não comprova distribuição física. O exemplo de maio não foi confirmado como caso atual.
- **R1/R2:** os quatro itens continuam cadastrados na S21, e o segundo suporte na S34/B01; a consolidação proposta permanece coerente, mas identidade dos suportes e movimento físico não foram comprovados. Os corpos dos suportes só repetem os títulos.
- **R3:** Viewe cadastrado em S34/B03 e moldura em S23/B01; o corpo da moldura informa impressão 3D, sem comprovar compatibilidade com o Viewe. Aproximá-los exige resolver esse fato, não apenas comparar a diagonal de 7 polegadas.
- **R4:** caixa e acessórios permanecem cadastrados nos locais históricos separados; marca comum não comprova que formam um conjunto, e a proposta original não define destino completo.
- **R5:** o corpo atual confirma que a Placa FKS é uma placa de agradecimento. A sugestão temática não estabelece destino completo. B99 não significa universalmente ausência de caixa: há essa observação explícita no corpo de um Display 3.5", mas não no da Placa FKS.
- **Anilhas:** revisão concluída pela operação auditada acima.
- **Raspberry Pi 5 8GB:** revisão concluída, mantendo Computers sem mutação. O cadastro identifica um computador de placa única; não há evidência que exija corrigir sua categoria. O uso como NAS consta do documento histórico, não do corpo atual.
- **Caixa Unifi Dream Router:** revisão ainda depende de identificar equipamento, embalagem ou invólucro; corpo e histórico só repetem o nome, sem fundamento inequívoco para alterar Electronics.

## Continuidade

Os fatos humanos irredutíveis estão enumerados em [pendencias.md](../pendencias.md), que substitui as duas tarefas genéricas anteriores. Nenhuma realocação, unificação, exclusão ou mudança em Raspberry/Unifi foi executada. Os artefatos antigos permanecem intactos como registro histórico.
