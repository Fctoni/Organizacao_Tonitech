# Inventário web com mutações atômicas e importação recuperável

## Decisão

O app usa React, TypeScript e Vite; Supabase fornece Auth e Postgres. O domínio permanece no contexto existente. Cada Item tem uma Location. O banco valida invariantes, deriva Status/Low Stock e serializa mutações por Item. Histórico imutável acompanha cada operação.

O acesso requer associação explícita ao usuário autorizado e troca de senha confirmada por endpoint servidor com Admin API. O marcador fica em tabela privada, nunca em user_metadata. Clientes não escrevem tabelas diretamente. Cadastro público fica desabilitado. A credencial administrativa existe somente no servidor.

`inventory.sh export` é a exceção JSON às leituras TSV do ADR-0001: exporta projeção completa, corpo, campos extras, referências, bytes em base64 e SHA-256. CSV, Base e dashboard são fontes preservadas, não novos Itens. `AGENTS.md` é reservado como instrução, não como Item. O acesso às notas continua mediado pelo script conforme ADR-0002.

A importação insere apenas originais inéditos. Uma origem já conhecida com hash diferente gera erro; nunca sobrescreve alterações operacionais. Snapshots ficam restritos no banco. Após revisão, publicação e provisionamento autorizados, o banco remoto do app é a fonte operacional. O vault permanece intacto como origem preservada, sem movimentações paralelas. Apenas a pasta `app` é enviada ao provedor de deploy.

## Limites

Clientes operacionais usam Auth de usuário autorizado e as mesmas RPCs do app, sem credencial administrativa. Sessões da CLI são privadas por máquina e ficam fora do repositório; apenas código e procedimentos acompanham o checkout. As mutações são atômicas, mas não idempotentes: clientes não repetem escritas automaticamente e tratam resposta perdida como resultado incerto, reconciliado pelo histórico. Isso evita duplicar movimentações sem ampliar o contrato do banco com chaves de idempotência.

O projeto dedicado usa a organização TecnoHard (`msxuixhofofwiecxcvkr`), assinatura Pro existente, região `sa-east-1` e compute Micro. O usuário autorizou o incremento estimado de US$ 10/mês para evitar a quota global gratuita. Não há alteração de planos, billing ou projetos alheios. A Vercel usa o escopo `felipes-projects-93cc7c39`, com upload apenas de `app`.

Não há multi-local nem soma de quantidades de Itens diferentes. A unidade continua descrita pela nota original; metros não são convertidos em peças. A senha temporária é entregue exclusivamente no chat final, usando o retorno de ferramenta como transporte expressamente autorizado; nunca é persistida no repositório, auditoria, GitHub, screenshots ou ambiente.
