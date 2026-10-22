# Chat integrado ao inventário

## Decisão

O app React/Vite usa AI SDK 7 com adaptador Google direto e um endpoint Node autenticado na Vercel. `GEMINI_MODEL` é obrigatória, sem modelo padrão. Chave Google e segredo de assinatura ficam exclusivamente no servidor. A ausência de configuração bloqueia somente o chat.

O endpoint valida o JWT com Supabase Auth e exige `access_state = ready` antes de criar o modelo. As ferramentas usam chave pública e JWT do usuário, com as mesmas RPCs e regras de acesso do app. O chat não invoca Gateway, MCP, subprocessos, SQL livre ou ferramenta administrativa. O endpoint MCP independente reutiliza essas ferramentas conforme o ADR-0007.

A função Vercel inclui explicitamente `src/inventory.ts`, pois o runtime importa a lógica compartilhada de busca por esse caminho. Logs de falha registram somente categoria de erro permitida, status HTTP e indicação de retry quando disponíveis; nunca corpo, mensagem do provedor ou credenciais.

## Confirmação e idempotência

O modelo pode consultar ou propor alterações. Uma proposta contém UUID de operação, usuário, pedido textual mais recente, operação exata, estado do Item e validade de 15 minutos. O servidor assina esse conteúdo com HMAC-SHA256. O navegador exibe o cartão e envia o ticket somente após confirmação explícita; o modelo não possui ferramenta para confirmar.

O endpoint verifica a assinatura e o usuário. A RPC verifica a validade e a versão do Item, serializa solicitações concorrentes e registra resultado e movimento atomicamente. Um reenvio retorna o resultado original, inclusive depois da expiração. Reutilizar ID com outro conteúdo falha. Expiração bloqueia apenas operações ainda não executadas. A operação possui vínculo auditável com o movimento, além do ator já registrado.

Erros conhecidos e definitivos da operação, como nome duplicado, overflow, dados inválidos, conflito de versão e expiração, encerram o cartão com orientação específica. Falhas transitórias ou de resultado incerto preservam o reenvio do mesmo ticket. O endpoint não expõe mensagens SQL.

## Contexto e limites

O histórico visual existe apenas na memória da aba. Cada resposta concluída devolve um envelope HMAC de contexto vinculado ao usuário, limitado a 64.000 bytes antes da codificação e válido por duas horas. Ele preserva falas, perguntas de esclarecimento e a identidade/ordem dos cartões de consulta, sem armazenar tickets, observações ou saldos das ferramentas. O navegador devolve esse envelope junto às novas falas do usuário. O servidor rejeita contexto adulterado, de outro usuário ou expirado, assim como roles de sistema/assistente, resultados de ferramentas e aprovações avulsos enviados pelo cliente. Não existe armazenamento permanente de conversas.

Contexto e propostas usam finalidades distintas na assinatura: um não serve como o outro. Contexto não autoriza gravação nem comprova estado atual; resultados necessários são consultados novamente. Falas anteriores permitem interpretar respostas curtas a esclarecimentos, mas não repetem operações. Respostas interrompidas ou sem conteúdo não produzem contexto concluído; a interface oferece nova tentativa manual da pergunta, sem confirmar propostas. Referências a cartões de respostas interrompidas exigem identificar novamente o Item. A última etapa da geração é reservada para resumo sem ferramentas, evitando encerrar buscas sucessivas sem resposta final. Ao exceder o limite de contexto, é necessário iniciar outra conversa.

Observações e resultados são dados não confiáveis. Markdown não executa HTML, imagens ou links. A busca reutiliza os filtros e a normalização do app, com paginação explícita e teto de 10.000 Itens; acima desse teto, uma RPC compartilhada de busca será necessária. Limites operacionais e comandos de teste ficam no README do app.

## Estado

Chat publicado na Vercel e migration aplicada no projeto remoto dedicado. O fluxo de API com Gemini real comprovou consulta, esclarecimento com resposta curta, proposta, confirmação e replay. O recorte de navegador remoto desktop/celular passou em rodada separada; o fluxo completo não foi repetido no deployment final. O modelo configurado pelo usuário foi preservado e seu valor não foi recuperado do Secret Vercel. Não há persistência de conversas nem limitação distribuída de requisições entre instâncias. Resultados e limites em `docs/validation/chat-assistente.md`.
