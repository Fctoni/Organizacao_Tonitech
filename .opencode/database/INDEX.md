# Banco do inventário

## Domínios

| Domínio | Arquivo | Tabelas |
| --- | --- | --- |
| Inventário | `inventory.md` | 6 |
| Assistente | `assistant.md` | 2 |
| Autenticação MCP | `mcp-auth.md` | 1 |

## Migrations

Fluxo gerenciado pela CLI Supabase; arquivos canônicos em `app/supabase/migrations/`. Validação local precede aplicação no projeto dedicado.

| # | Arquivo | Domínio | Descrição |
| --- | --- | --- | --- |
| 20261020000100 | `app/supabase/migrations/20261020000100_inventory.sql` | Inventário | Itens, histórico, originais, autorização e RPCs |
| 20261020000200 | `app/supabase/migrations/20261020000200_normalize_place.sql` | Inventário | Normalização de Place no banco |
| 20261020000300 | `app/supabase/migrations/20261020000300_aliases.sql` | Inventário | Aliases sem elementos nulos |
| 20261020000400 | `app/supabase/migrations/20261020000400_export.sql` | Inventário | Export administrativo consistente |
| 20261021000100 | `app/supabase/migrations/20261021000100_chat_operations.sql` | Inventário | Idempotência e vínculo ao histórico; aplicada localmente e no projeto remoto dedicado |
| 20261021000200 | `app/supabase/migrations/20261021000200_assistant_prompt.sql` | Assistente | Responsável, revisões imutáveis e versão ativa; aplicada localmente e no projeto remoto dedicado |
| 20261021000300 | `app/supabase/migrations/20261021000300_assistant_prompt_validation.sql` | Assistente | Trim ECMAScript e limite UTF-16 consistentes com servidor/editor; aplicada localmente e no projeto remoto dedicado |
| 20261021000400 | `app/supabase/migrations/20261021000400_mcp_auth.sql` | Autenticação MCP | Binding privado, hook OAuth e login da ponte; aplicada no projeto remoto dedicado e validada em banco local descartável |
