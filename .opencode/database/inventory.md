# Inventário

Schema do inventário aplicado no Supabase local dedicado `tonitech-inventory` e no projeto remoto dedicado `pfhfhrypxncgzmnmlztm`, organização TecnoHard Pro, região `sa-east-1`. Migrations de inventário e assistente estão aplicadas nos dois ambientes; a autenticação MCP tem estado próprio em `mcp-auth.md`. O banco remoto é a fonte operacional; o vault permanece preservado. O estado de acesso de cada usuário é consultado por `access_state`, sem manter uma cópia operacional neste documento.

A migration `20261021000100_chat_operations.sql` está aplicada localmente e no projeto remoto dedicado. O smoke remoto comprovou confirmação e replay concorrente com Item sintético, sem duplicar o movimento. Resumo auditável em `docs/validation/chat-assistente.md`.

## Tabelas e relações

- `access_members`: `user_id uuid PK → auth.users ON DELETE CASCADE`; `password_changed_at timestamptz nullable`; `is_owner boolean NOT NULL DEFAULT false` (migration do assistente). Somente service_role pode ler/escrever diretamente. NULL exige troca; JWT anterior à troca também é bloqueado. O papel de responsável não dispensa essas verificações.
- `categories`: `name text PK`. Vocabulário do glossário sem categoria livre.
- `items`: `id uuid PK default gen_random_uuid()`, `name text UNIQUE NOT NULL`, `shelf integer >=1`, `place text B/W+posição positiva`, `qty integer >=0`, `minimum_safe_stock integer >=0 default 0`, `category text FK categories`, `aliases text[] default {}`, `body text default vazio`, `extra_fields jsonb default {}`, `status text` e `low_stock boolean` gerados, `updated_at timestamptz default now()`. Todos NOT NULL.
- `movements`: `id bigint identity PK`, `item_id uuid NOT NULL FK items ON DELETE CASCADE`, `actor uuid nullable FK auth.users ON DELETE SET NULL`, `action text NOT NULL`, `requested integer nullable`, `before_value jsonb nullable`, `after_value jsonb NOT NULL`, `created_at timestamptz NOT NULL default now()`.
- `source_snapshots`: `filename text PK`, `sha256 text NOT NULL hexadecimal`, `original_base64 text NOT NULL`, `item_id uuid nullable FK items RESTRICT`, `projection jsonb nullable`, `imported_at timestamptz NOT NULL default now()`.
- `inventory_operations`: PK composta `(actor uuid, operation_id uuid)`; `actor → auth.users ON DELETE CASCADE`; `payload jsonb NOT NULL`, `result jsonb NOT NULL`, `movement_id bigint nullable → movements ON DELETE SET NULL`, `created_at timestamptz NOT NULL default now()`. Ledger de idempotência com vínculo ao movimento auditado, sem transcript de chat.

## RLS e funções

Todas as tabelas têm RLS. Authenticated recebe somente SELECT de items/categories/movements condicionado a `has_inventory_access()`. Não há escrita direta ou leitura dos originais para clientes. Anon não tem acesso. Service_role mantém acesso administrativo.

`create_item` e `mutate_item` são SECURITY DEFINER, search_path vazio, acesso explicitamente validado. `mutate_item` usa FOR UPDATE para serializar Take/Add/Relocate/Recategorize. Histórico participa da mesma transação. `access_state` informa denied/password_required/ready sem expor associação alheia. Importação é exclusiva de service_role, valida hashes, usa advisory lock e recusa origens modificadas.

`execute_inventory_operation(operation_id uuid, payload jsonb, expires_at timestamptz)` é SECURITY DEFINER com search_path vazio e acesso explícito. Serializa por usuário/ID via advisory lock; conteúdo diferente com o mesmo ID falha. Retorna o resultado anterior antes de verificar expiração, permitindo recuperar resposta perdida sem nova gravação. Operação inédita expirada falha com `PT410`. Mutação exige `expected_updated_at` atual sob lock do Item; divergência falha com `PT409`, sem retry automático do PostgREST. Reutiliza `create_item`/`mutate_item` e grava ledger/histórico/resultado na mesma transação. Os callers existentes permanecem compatíveis. `inventory_operations` tem RLS e nenhum grant para anon/authenticated; acesso apenas pela RPC ou administrativo. A assinatura de proposta é validada no endpoint, não pelo banco; usuários já autorizados continuam podendo chamar as RPCs do app diretamente.

## Seeds e migrations

O vocabulário é inserido na migration `20261020000100_inventory.sql`. `20261020000200_normalize_place.sql` instala trigger de normalização de Place (B003 → B03) antes de INSERT/UPDATE. Não há seed de usuários nem senha inicial. A importação dos originais usa `inventory.sh export` via `app/scripts/import.mjs`.

`20261020000300_aliases.sql` impede elementos nulos em Aliases, mantendo a busca segura após importação ou chamadas diretas às RPCs.

`20261020000400_export.sql` instala `export_inventory`: SECURITY INVOKER, somente service_role, snapshot único de Itens, movimentos e originais. Não exporta Auth nem credenciais.
