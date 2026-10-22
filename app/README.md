# Inventário ToniTech

App de acesso restrito para consultar Itens e registrar Take, Add, cadastro, Relocate e Recategorize. O banco é o responsável pelas invariantes e pelo histórico. O frontend nunca recebe credenciais administrativas.

## Desenvolvimento e testes

Requer Node 22.18+ (testes usam TypeScript nativo), npm, Docker e Supabase CLI. Execute na pasta `app`:

```bash
npm ci
node scripts/restart-local.mjs
npm run import
npm run dev:local
```

O servidor local usa `127.0.0.1:5173` e inclui os endpoints de troca de senha, chat e MCP. Os scripts capturam as credenciais locais da CLI em memória; não imprimem nem gravam senhas. Nenhum usuário real é criado automaticamente. `npm run dev` é o Vite básico e requer configuração pública de ambiente; para endpoints locais, use `dev:local`.

```bash
npm test
npm run test:integration
node scripts/build-local.mjs
node scripts/http-check.mjs
node scripts/check-bundle.mjs
npm run db:verify
```

`node scripts/fresh-check.mjs` verifica a cadeia a partir de banco vazio e reimporta o vault. **Esse comando apaga os dados da instância local dedicada**, inclusive alterações feitas pelo app local. Não o use para preservar uma sessão operacional. Não opera projetos remotos.

As integrações usam Auth, PostgREST e Postgres reais. Credenciais e Itens de teste são efêmeros. Os checks HTTP não substituem validação visual em navegador.

## Chat com Gemini

Dependências fixadas: `ai@7.0.148`, `@ai-sdk/google@4.0.102` e `@ai-sdk/react@4.0.152`. O app usa React 19 e Vite 7. A integração usa `createGoogle`, `streamText`, `isStepCount`, `DefaultChatTransport` e `useChat` das versões instaladas. APIs conferidas na documentação distribuída com o SDK 7, incluindo `instructions`, `onEnd`, `telemetry` e os limites de ferramentas. O SDK 7 oferece `toolApproval`; aqui a confirmação é um endpoint explícito com proposta assinada, não aprovação confiada ao transcript ou ao prompt.

Configure no **servidor**, sem prefixo `VITE_`:

| Variável | Uso |
| --- | --- |
| `GEMINI_MODEL` | ID escolhido no AI Studio; obrigatório, sem fallback |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Chave oficial do adaptador Google direto |
| `CHAT_SIGNING_SECRET` | Segredo aleatório independente com pelo menos 32 caracteres, comum às instâncias |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | URL e chave pública do projeto; JWT recebido por Bearer |

O chat não usa `SUPABASE_SERVICE_ROLE_KEY`. Essa variável pertence exclusivamente ao endpoint de troca de senha existente. Trocar o segredo de assinatura invalida cartões anteriores. Não envie segredos pelo chat nem os coloque em arquivos versionados.

Para desenvolvimento, `dev:local` lê as variáveis do processo e define automaticamente a conexão Supabase local. Se usar um arquivo privado ignorado pelo Git, execute `node --env-file=.env.chat.local scripts/dev-local.mjs`. O Vite básico não serve os endpoints. Não é necessário configurar Google para executar os testes com modelo simulado.

A migration `20261021000100_chat_operations.sql` instala o ledger e a RPC idempotente. Está aplicada localmente e no projeto remoto dedicado. O chat está publicado em https://tonitech-inventario.vercel.app. Em uma instância local já existente, `supabase migration up --local` aplica migrations pendentes sem reset. Não use `fresh-check` para validar chat sobre dados operacionais.

### Comportamento e limites

- Consultas: nome/aliases sem acento ou distinção de caixa, filtros do app, UUID, categorias e histórico. Resultados em cartões com localização completa, quantidade e acesso ao Item.
- Lançamentos: cadastro completo, Take/Add, Relocate e Recategorize. Clique no cartão assinado para confirmar. Take acima do disponível retorna aviso e piso zero. Se o Item mudou depois da proposta, solicite outra.
- Reenvio de confirmação recupera o mesmo resultado sem repetir a gravação. A janela de 15 minutos bloqueia operações inéditas expiradas; resultados já confirmados continuam recuperáveis com o mesmo ticket. Falha ao atualizar a lista não vira falha de gravação.
- Nome duplicado, overflow e outras violações conhecidas de domínio encerram o cartão com orientação para corrigir o pedido. Só falhas transitórias ou incertas mantêm a opção de confirmar novamente o mesmo ticket.
- Conversa somente na aba, até 12 falas do usuário de 2.000 caracteres. Respostas concluídas devolvem contexto assinado vinculado ao usuário, válido por duas horas e limitado a 64.000 bytes antes da codificação. O contexto preserva perguntas e referências aos cartões para interpretar respostas como “3” ou “o segundo”, mas nunca autoriza gravação nem comprova saldos. O servidor reconstrói consultas e rejeita ferramentas/aprovações avulsas do navegador. Resposta interrompida ou sem conteúdo não gera novo contexto concluído; o botão de nova tentativa repete a pergunta, sem confirmar propostas. Para referências a cartões de uma resposta interrompida, informe o nome do Item. Contexto expirado ou cheio exige nova conversa. Nova conversa descarta os cartões visuais; o histórico de movimentos permanece no banco.
- Entrada HTTP até 128 KiB, incluindo envelope de contexto; até 4 etapas, com a última reservada para resumo sem ferramentas, 12 chamadas de ferramentas e 1.600 tokens de saída por etapa; sem retry automático do modelo. Tempo total de geração de 55 segundos, ferramentas e requests Supabase de até 10 segundos; função Vercel limitada a 60 segundos. Parar resposta cancela geração, não desfaz confirmações já enviadas.
- Busca até 10.000 Itens, páginas de 20 resultados; histórico em páginas de 20; saída por ferramenta até 24.000 bytes. Observações de leitura limitadas a 4.000 caracteres. Propostas recusam observações truncadas para não esconder a unidade durante a confirmação.
- HTML bruto, imagens e links do modelo são inertes. A telemetria do SDK está desativada; logs contêm apenas tipo de evento, contagem de tokens/etapas, motivo normalizado de término, presença de texto final e metadados de falha (categoria permitida, status HTTP e possibilidade de retry). Não há rate limit distribuído ou garantia de teto mensal de custo.

### Configurações do assistente e consumo

No painel do chat, abra **Configurações · Assistente**. A revisão ativa pode ser consultada por membros liberados. Apenas o responsável edita, acessa o histórico e restaura uma revisão como nova. Salvar aceita de 1 a 12.000 caracteres e exige a versão ativa esperada. Em conflito, o rascunho permanece na tela; recarregue a versão ativa, compare os textos e salve uma nova revisão.

As migrations `20261021000200_assistant_prompt.sql` e `20261021000300_assistant_prompt_validation.sql` estão aplicadas localmente e no projeto remoto dedicado. Elas adicionam o papel protegido no membership, revisões imutáveis, ponteiro ativo e validação consistente com trim ECMAScript/12.000 unidades UTF-16. A identidade inicial do responsável é resolvida uma única vez no banco pela conta indicada pelo proprietário; novos membros não recebem esse papel. Ausência de configuração bloqueia a geração, sem fallback silencioso. A versão é capturada por pergunta; mudanças passam a valer na próxima pergunta, sem substituir regras técnicas do servidor.

O cabeçalho exibe tokens da conversa; cada resposta tem detalhes expansíveis de entrada, saída, total, raciocínio/cache quando informados, modelo e revisão usada. O acumulador inclui retries manuais mesmo quando substituem a resposta anterior. Nova conversa zera explicitamente a contagem. Contadores ausentes não são zero: falhas, stop e desconexão preservam o último consumo conhecido como parcial/indisponível. O total indica incompletude. Esses números vêm do SDK/provedor, não são estimativa por caracteres nem equivalência de fatura ou preço.

O servidor usa as partes `finish-step.usage` do AI SDK 7 e valida todas as etapas antes de marcar completude; `totalUsage` ignora ausências na soma. Cache e reasoning são subconjuntos, não parcelas adicionais. A função Vercel inclui `src/{inventory,chat-usage}.ts` para manter os módulos compartilhados no runtime Node 22.18+.

```bash
npm run test:assistant:db
```

O teste de banco cria um banco temporário no container local fixo `supabase_db_tonitech-inventory`, copia apenas o schema Auth, aplica toda a cadeia de migrations e remove o banco ao terminar. Não reseta nem copia dados operacionais. Exercita RLS/grants, papéis, revisão imutável, restauração e duas conexões concorrentes.

Os resultados e limites das validações pontuais de navegador e produção estão no [resumo auditável da entrega](../docs/validation/chat-assistente.md).

### Demais testes do chat

```bash
npm test
npm run test:chat:integration
```

A integração de chat usa exclusivamente `localClients`, sem aceitar destino remoto. Cria e remove usuários/Itens sintéticos. Verifica Auth/JWT/RPC reais, confirmação concorrente, replay idempotente, assinatura, isolamento e erros definitivos, incluindo o cliente real do endpoint com JWTs de dois usuários, sem compartilhar sessão entre requisições. O teste unitário do adaptador Google substitui apenas o transporte HTTP e confere o modelo explícito, as ferramentas e a conversão da stream. Não há chamada ao Google nem teste de deploy Vercel nesses checks.

## MCP para Claude

O MCP publicado reutiliza as consultas, propostas e RPC transacional do chat, com cliente OAuth público pré-registrado, DCR desabilitado e ponte PostgreSQL sem passagem de Bearer à Data API. `executeChange(ticket)` permite consultar e alterar estoque sem confirmação no app; o consentimento é conversacional no Claude e não é atestado pelo backend. O chat embutido conserva seu cartão de confirmação. URL, Client ID público, configuração, testes permanentes e playbook humano estão em [MCP.md](MCP.md). A migration de autenticação está aplicada no projeto remoto dedicado e validada em bancos locais descartáveis; a execução direta não exigiu nova migration ou mudança de credenciais. Evidências das cinco operações diretas, replay hospedado e aceite humano básico com conta real do Claude estão em [validação MCP](../docs/validation/mcp.md). O TOML usa Site URL local; aplique a migration local antes de reiniciar Auth para ativar o hook.

## Importação e recuperação

`npm run import` lê exclusivamente `inventory.sh export`. A importação compara hashes, insere origens novas e rejeita uma origem conhecida com conteúdo diferente. Reexecutar não sobrescreve alterações do app. As fontes CSV/Base/dashboard são arquivadas sem gerar Itens duplicados.

`node scripts/backup.mjs /caminho/privado/backup.json` grava um arquivo novo com permissão 0600. O export contém Itens atuais, histórico e originais em um único snapshot do banco. `originals[].original_base64` recupera os bytes exatos de cada arquivo; valide SHA-256 contra `originals[].sha256` antes de restaurar. Nunca restaure sobre o vault real sem autorização. O backup não inclui Auth ou credenciais.

O destino padrão dos scripts é local. Para importação remota, use `scripts/import-remote.mjs` com `INVENTORY_PROJECT_REF` confirmado. `scripts/remote.mjs` exige o nome `Tonitech-Inventario` na organização TecnoHard (`msxuixhofofwiecxcvkr`) e captura as chaves sem imprimir. `backup.mjs` usa o mesmo destino remoto somente quando essa variável está definida. `npm run test:integration` também aceita esse destino explicitamente confirmado e cria somente fixtures/usuários efêmeros, removidos ao final.

## Produção e deploy

Produção: https://tonitech-inventario.vercel.app. Projeto Supabase dedicado `pfhfhrypxncgzmnmlztm`, TecnoHard Pro, `sa-east-1`, criado com compute Micro. Incremento estimado de US$ 10/mês autorizado; nenhuma mudança de plano/billing ou de outros projetos.

`scripts/create-project.mjs` recusa executar se já existe o projeto dedicado. Não deve ser reexecutado para atualizar produção. Para manutenção, execute dentro de `app`:

1. Confirmar `INVENTORY_PROJECT_REF=pfhfhrypxncgzmnmlztm` e executar `node scripts/apply-remote.mjs` para migrations previamente validadas. O script confere identidade e vínculo antes de escrever, capturando saída administrativa. Não executa `config push`; o patch OAuth/hook é específico e segue [MCP.md](MCP.md), preservando outros campos Auth.
2. A Site URL remota aponta à produção; o TOML aponta ao desenvolvimento local. Cadastro público permanece bloqueado no remoto, com login por e-mail habilitado. Não aplicar o TOML local sobre a configuração Auth de produção.
3. Usar `node scripts/import-remote.mjs` para importação e `node scripts/verify-remote.mjs` para conferência pré-cutover. A comparação de projeções com o vault é intencionalmente pré-cutover; após alterações operacionais legítimas no app, somente os originais devem coincidir.
4. Definir `VERCEL_CLI_PATH` para a instalação autenticada e executar `node scripts/deploy.mjs`. O script envia variáveis por stdin, mantém a service role como Secret do servidor e publica somente `app` no projeto `tonitech-inventario`, escopo `felipes-projects-93cc7c39`. Não enviar a raiz do vault.
5. Executar `node scripts/check-production.mjs`: verifica HTTPS público, cabeçalhos, endpoint e igualdade dos assets publicados com o build local. O helper não imprime credenciais.
6. O usuário real já foi provisionado por `server/provision-owner.mjs`, com troca obrigatória pendente. Não reexecutar para recriar ou substituir sua credencial. A senha temporária é entregue exclusivamente no chat final; o retorno de ferramenta foi autorizado como transporte necessário. Nunca registrar a senha em arquivos, auditoria, GitHub, screenshots ou ambiente persistido.

O endpoint exige a senha atual, rejeita reutilizá-la, revoga sessões e só libera dados após mudança confirmada pela Admin API. Falha intermediária mantém o acesso bloqueado. Um novo login é necessário; tokens anteriores à troca não autorizam acesso.

## Fonte operacional

O cutover está concluído: o banco remoto do app é a fonte operacional. As notas do vault permanecem como originais preservados e não devem receber movimentações operacionais paralelas. Não há sincronização bidirecional nem multi-local nesta entrega.
