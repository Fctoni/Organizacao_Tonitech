# MCP do inventário com OAuth e ponte de identidade

## Decisão

O MCP usa o mesmo app React/Vite/Vercel, com `McpServer` do SDK oficial 2.3.1 e `NodeStreamableHTTPServerTransport` 2.1.1. Cada requisição cria servidor, transporte e ferramentas próprios. O transporte é Streamable HTTP stateless com resposta JSON; GET/SSE e DELETE não mantêm sessões. Não há modelo, subprocesso ou acesso administrativo na execução MCP.

O Supabase OAuth Server fornece Authorization Code/PKCE. Claude usa um cliente público pré-registrado, callback exato e secret vazio. DCR fica desabilitado. O recurso protegido é a URL completa `/api/mcp`; discovery e desafio 401 usam configuração explícita, nunca Host recebido. Scopes são os anunciados pelo servidor de identidade, não permissões novas de estoque.

O hook de autenticação consulta um binding privado configurado pelo administrador. Somente `event.claims.client_id` correspondente recebe audience do recurso, papel externo `anon` e expiração máxima de cinco minutos, também no refresh. O hook retorna todas as claims. Tokens normais do navegador e outros clientes permanecem intactos. Este hook e sua tabela tratam autenticação; não são RPCs de estoque.

O MCP verifica assinatura ES256/RS256 por JWKS, issuer, audience escalar exata, client ID, papel, usuário, sessão e timestamps. Tokens do navegador e ID tokens não autorizam ferramentas. O Bearer nunca é encaminhado ao Auth nem à Data API.

## Ponte de identidade

Uma credencial PostgreSQL exclusiva do servidor conecta ao Supavisor transacional com TLS verificado. `inventory_mcp` é LOGIN/NOINHERIT, sem propriedade de objetos, superuser, BYPASSRLS, criação de banco/papéis ou replicação. Sua única associação permite assumir `authenticated`. A senha não existe na migration nem no frontend.

Na mesma conexão: `SET LOCAL ROLE authenticated`, claims permitidas e verificadas via `set_config` parametrizado, `access_state`, SQL fixo e COMMIT/ROLLBACK. Consultas e propostas usam transação somente leitura. Apenas `executeChange` abre transação de escrita, chama a RPC existente e aguarda COMMIT antes de retornar sucesso ao transporte. Cancelamento antes do COMMIT causa rollback; perda de resposta durante/depois do COMMIT exige replay do mesmo ticket. Identidade e papel terminam com a transação. Erro descarta a conexão. Pool limitado, timeout de consulta e timeout de transação ociosa evitam conexões retidas. O GET opcional do cliente MCP retorna 405 antes de adquirir conexão.

O mapeamento do papel externo `anon` para o papel interno `authenticated` é deliberado. Ele reaproveita RLS e associação/troca de senha existentes sem dar ao token OAuth acesso direto ao banco. A credencial da ponte pode representar usuários; deve permanecer exclusivamente no servidor. O papel assumido tem os privilégios já utilizados pelo app. A ponte expõe leituras fixas e uma chamada parametrizada a `execute_inventory_operation`, sem SQL, função, tabela ou papel escolhidos pelo modelo.

## Reuso e confirmação

`inventoryTools` continua sendo a única implementação de busca, limites, paginação, validação de proposta e assinatura. Um repositório pequeno fornece cinco leituras com implementações Supabase e PostgreSQL. Timestamps PostgreSQL chegam como texto para preservar microssegundos; IDs bigint do histórico precisam caber em inteiro seguro. Histórico não expõe originais, campos extras nem ator desnecessário.

No MCP, `proposeChange` retorna preview e ticket estruturados, sem gravar e sem link obrigatório. `executeChange(ticket)` valida assinatura com propósito `proposal` e usuário, depois reutiliza `execute_inventory_operation` com UUID, payload, `expected_updated_at` e expiração originais. A RPC mantém atomicidade, controle de versão e ledger. Replay devolve o resultado anterior, inclusive após expiração, mas sempre exige acesso atual antes de consultar o ledger. Nenhuma RPC de estoque, migration ou ledger adicional é necessário.

O cliente Claude recebe permissão para consultar e alterar estoque. O consentimento humano ocorre na conversa: as instruções orientam mostrar Item, ação, quantidade/unidade e endereço e pedir confirmação quando necessária antes de executar. O backend não verifica nem atesta confirmação humana. Assinatura comprova integridade e vínculo da proposta, não aprovação. Não há campo `confirmed`, OAuth adicional por escrita ou confirmação obrigatória no app. Annotations MCP são declarativas, não controles de segurança; execução é destrutiva e idempotente somente para o mesmo ticket/operação.

O retorno de execução contém `status`, `operationId`, Item compacto e aviso. `committed` só sai após COMMIT; `definitive` indica rejeição conhecida; `transient` indica falha com rollback confirmado antes do COMMIT; `uncertain` não comprova o resultado. Falhas transitórias/incertas e respostas perdidas exigem repetir o mesmo ticket, nunca criar automaticamente outra proposta. O ticket é assinado, não criptografado: contém dados legíveis do Item e não deve ser compartilhado.

O chat embutido conserva o cartão e o clique humano. Sua fábrica de ferramentas não inclui `executeChange`; texto de aprovação continua sem autorizar execução pelo modelo. O fluxo de revisão por link existente permanece compatível, mas não é necessário no MCP.

O consentimento remove `authorization_id` da URL e o mantém em memória. O identificador já pode ter passado pelo log HTTP da hospedagem antes dessa remoção; o app não registra URLs ou identificadores. Aprovar/negar usa Supabase JS, desabilita redirecionamento automático do SDK e aceita apenas o callback Claude retornado pelo servidor. Grants existentes podem retornar diretamente um redirect. A leitura que vincula autorização ao usuário é compartilhada entre reinícios de efeito do React StrictMode.

## Limites

Revogar grant impede refresh, mas um JWT emitido continua utilizável até expirar, por no máximo cinco minutos. Remoção do membership ou marcador de senha posterior ao `iat` bloqueia novas requisições imediatamente no banco, inclusive replay. Não há introspecção com passagem de Bearer. A proposta assinada já entregue continua sujeita ao acesso atual; no MCP, a confirmação humana é responsabilidade conversacional do cliente.

Não há rate limit distribuído; o pool é limitado por instância. O teste local usa Auth/PostgREST reais descartáveis, cliente MCP oficial e conexão PostgreSQL direta. O estado da publicação e as evidências de execução direta estão no [relatório de validação](../../../docs/validation/mcp.md), incluindo o [aceite humano e seus limites](../../../docs/validation/mcp.md#validação-humana-relatada--estado-atual). O procedimento de conexão fica no [playbook do app](../../../app/MCP.md#playbook-humano-no-claude).
