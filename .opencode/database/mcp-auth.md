# Autenticação MCP

Schema definido pela migration `20261021000400_mcp_auth.sql`, aplicada no projeto remoto dedicado `pfhfhrypxncgzmnmlztm` e validada em bancos locais descartáveis. Ainda não aplicada ao banco operacional local. Binding remoto preenchido com o cliente público e recurso documentados em `app/MCP.md`; hook OAuth habilitado e DCR desabilitado. Evidências em `docs/validation/mcp.md`.

## Binding privado

| Coluna | Tipo | Constraints | Default | Nota |
| --- | --- | --- | --- | --- |
| singleton | boolean | PK, CHECK true | true | No máximo uma configuração |
| client_id | text | NOT NULL, 1–200 caracteres | — | Cliente público pré-registrado pelo administrador |
| resource | text | NOT NULL, URL HTTP(S) terminada em `/api/mcp`, sem query/fragmento | — | URL exata do recurso; HTTPS em produção |

Tabela `inventory_auth.mcp_client`, RLS habilitada, sem policies ou grants operacionais. Nenhum FK para schema gerenciado Auth. Sem seed de cliente ou credencial. Somente o administrador/proprietário configura o binding. `anon`, `authenticated` e `service_role` não recebem leitura/escrita. O schema não é exposto pelo PostgREST.

## Hook e papel

`inventory_auth.custom_access_token(jsonb)` é STABLE/SECURITY DEFINER, search_path vazio. Somente `supabase_auth_admin` recebe USAGE no schema e EXECUTE. A função lê o binding com privilégio do proprietário, compara `claims.client_id`, altera `aud`, `role=anon` e limita `exp` a `iat+300`, preservando todas as demais claims. Sem match retorna claims intactas. A comparação vale para refresh e autorização inicial.

`inventory_mcp`: LOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION; sem propriedade de objetos. Único membership: `authenticated`, INHERIT false, SET true, sem ADMIN. Nenhuma senha na migration. A associação permite representar um usuário verificado dentro da transação da ponte, que sempre consulta `access_state` e usa RLS.

A migration revoga de PUBLIC/anon privilégios nas tabelas e funções operacionais existentes, inclusive a RPC idempotente. As regras, tabelas e RPCs de estoque não mudam. A integração testa negação via Data API com JWT OAuth real e argumentos válidos de escrita, inclusive quando a Data API não exige audience padrão.
