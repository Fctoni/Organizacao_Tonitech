# ADR 0006 — Comportamento versionado e consumo por execução

## Pergunta

Como ajustar o comportamento do assistente no app e mostrar o consumo real, preservando autorização, histórico e tokens gastos em tentativas substituídas?

## Decisão

O assistente possui um comportamento ativo global para o inventário. Configurações ficam em um painel expansível acessível dentro do chat. Membros com acesso liberado consultam a revisão ativa; somente o responsável edita, restaura e lê o histórico. Um booleano protegido no membership identifica esse papel. A migração inicial resolve a identidade pela conta indicada pelo proprietário no banco, sem autorização por e-mail no frontend ou por metadata editável de Auth.

Revisões são append-only. O singleton aponta para uma revisão existente. Salvar exige a versão esperada sob lock; restaurar cria outra revisão. Autoria usa UUID de auditoria retido após eventual exclusão da conta. A interface preserva o rascunho em conflito e permite recarregar o texto ativo para comparação. Cada pergunta consulta uma vez a revisão pelo JWT do usuário; a próxima pergunta pode usar uma revisão nova na mesma conversa.

O comportamento deve conter texto após remover os caracteres de espaço das extremidades definidos por `String.trim()` do ECMAScript. O limite é de 12.000 unidades UTF-16, consistente com `String.length` e `maxlength` do editor; caracteres fora do BMP contam duas unidades. Banco e servidor rejeitam conteúdo inválido antes de criar/ativar uma revisão. A migration incremental `20261021000300` preserva a `002` já aplicada, valida as revisões existentes sem reescrevê-las e não altera memberships. Caso encontre uma revisão incompatível, a migration falha em vez de modificar o histórico silenciosamente.

O comportamento complementa as instruções técnicas do código. Não altera ferramentas disponíveis, RLS, assinatura, confirmação ou idempotência. Contexto assinado anterior continua sendo memória, nunca autorização. Não há seleção de modelo/provedor nesta tela.

O consumo vem das etapas reais do SDK/provedor, incluindo chamadas intermediárias e a conclusão. `messageMetadata` recebe partes `start-step`, `finish-step`, `finish`, `abort` e `error`. Contadores obrigatórios são validados por etapa; `totalUsage` sozinho não prova completude, pois a implementação instalada soma ausências como zero quando outra etapa fornece o contador. `onEnd`, `onError` e `onAbort` registram apenas metadados permitidos, incluindo versão e ID da execução, sem corpo do comportamento ou das mensagens.

Snapshots incrementais levam ID aleatório do servidor e sequência. Eventos transitórios `data-usage` alimentam um acumulador na aba, separado das mensagens que `useChat.regenerate()` substitui. Eventos duplicados/atrasados não somam novamente. A metadata da mensagem mostra o consumo daquela resposta; o cabeçalho inclui todas as execuções, inclusive tentativas substituídas. Nova conversa limpa mensagens e acumulador.

Entrada, saída e total usam os contadores normalizados do SDK. Cache lido/escrito e raciocínio são detalhes já incluídos nesses totais; não são somados novamente. Contagem zero informada é válida. Ausência, valores inválidos, etapa não contabilizada, erro ou cancelamento resultam em indicação parcial/indisponível. Detalhes opcionais refletem apenas etapas que os informaram. Nenhum contador bruto de provedor ou metadata de consumo entra no contexto do modelo.

## Motivo

Esse desenho mantém autorização no banco/servidor, torna restauração auditável e impede sobrescrita concorrente silenciosa. O acumulador por execução preserva gasto conhecido mesmo quando a UI substitui a resposta. A validação por etapa evita apresentar agregados incompletos como completos.

## Limites e publicação

O medidor não representa fatura nem custo monetário. Após desconexão, só permanece o último snapshot entregue ao navegador; não há reconciliação posterior com o provedor. Recarregar ou desmontar o chat perde a memória da conversa. Uma falha anterior ao recebimento do ID do servidor aparece como tentativa indisponível, sem presumir consumo zero.

As migrations `20261021000200` e `20261021000300` estão aplicadas localmente e no projeto remoto dedicado; a interface e o endpoint estão publicados. A validação remota comprovou permissões com conta sintética, uma saudação real com consumo completo e revisão capturada, além das telas de edição/restauração e acumulação de retry com respostas simuladas. Os testes de gravação e concorrência de revisões continuam restritos ao banco local descartável, preservando o histórico de produção. Resumo auditável em `docs/validation/chat-assistente.md`. A eficácia linguística do comportamento inicial exige avaliação separada com o modelo configurado.
