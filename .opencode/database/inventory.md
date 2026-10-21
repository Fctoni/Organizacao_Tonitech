# Inventário

Schema aplicado no Supabase local dedicado `tonitech-inventory` e no projeto remoto dedicado `pfhfhrypxncgzmnmlztm`, organização TecnoHard Pro, região `sa-east-1`. As quatro migrations locais/remotas foram reconciliadas. Usuário real provisionado, com `password_changed_at` nulo e sem primeiro login; dados bloqueados até troca obrigatória. O banco remoto é a fonte operacional; o vault permanece preservado.

## Tabelas e relações

- `access_members`: `user_id uuid PK → auth.users ON DELETE CASCADE`; `password_changed_at timestamptz nullable`. Somente service_role pode ler/escrever. NULL exige troca; JWT anterior à troca também é bloqueado.
- `categories`: `name text PK`. Vocabulário do glossário sem categoria livre.
- `items`: `id uuid PK default gen_random_uuid()`, `name text UNIQUE NOT NULL`, `shelf integer >=1`, `place text B/W+posição positiva`, `qty integer >=0`, `minimum_safe_stock integer >=0 default 0`, `category text FK categories`, `aliases text[] default {}`, `body text default vazio`, `extra_fields jsonb default {}`, `status text` e `low_stock boolean` gerados, `updated_at timestamptz default now()`. Todos NOT NULL.
- `movements`: `id bigint identity PK`, `item_id uuid NOT NULL FK items ON DELETE CASCADE`, `actor uuid nullable FK auth.users ON DELETE SET NULL`, `action text NOT NULL`, `requested integer nullable`, `before_value jsonb nullable`, `after_value jsonb NOT NULL`, `created_at timestamptz NOT NULL default now()`.
- `source_snapshots`: `filename text PK`, `sha256 text NOT NULL hexadecimal`, `original_base64 text NOT NULL`, `item_id uuid nullable FK items RESTRICT`, `projection jsonb nullable`, `imported_at timestamptz NOT NULL default now()`.

## RLS e funções

Todas as tabelas têm RLS. Authenticated recebe somente SELECT de items/categories/movements condicionado a `has_inventory_access()`. Não há escrita direta ou leitura dos originais para clientes. Anon não tem acesso. Service_role mantém acesso administrativo.

`create_item` e `mutate_item` são SECURITY DEFINER, search_path vazio, acesso explicitamente validado. `mutate_item` usa FOR UPDATE para serializar Take/Add/Relocate/Recategorize. Histórico participa da mesma transação. `access_state` informa denied/password_required/ready sem expor associação alheia. Importação é exclusiva de service_role, valida hashes, usa advisory lock e recusa origens modificadas.

## Seeds e migrations

O vocabulário é inserido na migration `20261020000100_inventory.sql`. `20261020000200_normalize_place.sql` instala trigger de normalização de Place (B003 → B03) antes de INSERT/UPDATE. Não há seed de usuários nem senha inicial. A importação dos originais usa `inventory.sh export` via `app/scripts/import.mjs`.

`20261020000300_aliases.sql` impede elementos nulos em Aliases, mantendo a busca segura após importação ou chamadas diretas às RPCs.

`20261020000400_export.sql` instala `export_inventory`: SECURITY INVOKER, somente service_role, snapshot único de Itens, movimentos e originais. Não exporta Auth nem credenciais.
