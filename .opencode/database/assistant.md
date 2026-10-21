# Assistente

Migrations canônicas: `app/supabase/migrations/20261021000200_assistant_prompt.sql` e `20261021000300_assistant_prompt_validation.sql`. Aplicadas no Supabase local `tonitech-inventory` e no projeto remoto dedicado `pfhfhrypxncgzmnmlztm`. O CHECK de normalização foi validado no catálogo remoto. Testes também aplicam a cadeia completa em banco temporário, sem copiar dados operacionais. Resumo auditável em `docs/validation/chat-assistente.md`.

## Tabelas

| Tabela | Colunas e constraints |
| --- | --- |
| `assistant_prompt_revisions` | `version integer GENERATED ALWAYS AS IDENTITY PK`; `body text NOT NULL`, CHECK via `normalize_assistant_prompt`: conteúdo não vazio após trim ECMAScript, até 12.000 unidades UTF-16; `author uuid nullable`; `created_at timestamptz NOT NULL DEFAULT now()`; `restored_from integer nullable FK → assistant_prompt_revisions.version`, exclusão restrita pelo FK |
| `assistant_settings` | `singleton boolean PK DEFAULT true CHECK(singleton)`; `active_version integer NOT NULL FK → assistant_prompt_revisions.version`, exclusão restrita pelo FK |

`author` é um identificador de auditoria imutável, sem FK para Auth: excluir uma conta não altera a autoria. NULL identifica a revisão inicial inserida pela migration. Não há transcript nem consumo de tokens persistido.

## RLS, grants e invariantes

As duas tabelas têm RLS e nenhum grant direto para public/anon/authenticated. Não existem policies que liberem escrita direta. As RPCs são SECURITY DEFINER, com search_path vazio, e verificam autorização explicitamente. Revisões têm trigger que rejeita UPDATE/DELETE, inclusive por conta privilegiada. O ponteiro só muda na mesma transação que cria a revisão.

- `assistant_prompt()`: exige `has_inventory_access()`; retorna revisão ativa e `canEdit`. Ausência do ponteiro/revisão falha com `PT503`.
- `assistant_prompt_history()`: somente `is_inventory_owner()`; histórico decrescente, com corpo, autor e data.
- `save_assistant_prompt(expected_version bigint, new_body text, restore_version bigint)`: somente responsável com acesso liberado. Lock FOR UPDATE no singleton; versão divergente falha com `PT409`. Normaliza e valida via `normalize_assistant_prompt(text)` antes de inserir; conteúdo inválido falha com `23514`. Restauração cria uma revisão nova pela mesma validação, preservando histórico e registrando origem. Não permite misturar corpo e origem de restauração.
- `normalize_assistant_prompt(text)`: função interna imutável, sem EXECUTE para clientes. Remove nas extremidades o conjunto explícito de whitespace do ECMAScript e conta caracteres fora do BMP como duas unidades. Usada pela RPC e pelo CHECK; não altera revisões existentes.
- `is_inventory_owner()`: exige acesso liberado e `access_members.is_owner`. Gravação do papel não é concedida ao cliente. A migration marca apenas o membership já vinculado à conta explicitamente indicada pelo proprietário via `auth.users`; não cria conta nem promove outros membros. Em instalação sem essa conta, nenhum responsável é presumido.

Funções de leitura/salvamento/identificação concedem EXECUTE somente a authenticated. Clientes anônimos não recebem acesso. A revisão inicial em português é específica do inventário: distingue escolha de localização de cadastro, amplia buscas por categoria sem query nominal restritiva e exige evidências para sugestões, sem presumir capacidade física.
