---
name: web-inventory
description: Opera o inventário atual do app ToniTech por CLI autenticada. Use quando consultar localização, saldo, estoque baixo, categorias ou histórico, cadastrar Item, registrar Take/Add, Relocate ou Recategorize. Para preservar, auditar ou exportar notas originais do Obsidian, use garage-inventory.
---

# Inventário operacional

## Preparação

Requer Node 22.18+, sistema POSIX (Linux/macOS) e checkout completo deste repositório. Não requer instalação npm. Execute os comandos a partir da raiz do checkout; caminhos abaixo são relativos à raiz. O script usa a API do app e as permissões do usuário autorizado. Leia `.claude/CONTEXT.md` para a linguagem do domínio e `.claude/docs/adr/0004-web-inventory.md` para os limites de acesso e da fonte operacional.

```bash
node .claude/skills/web-inventory/scripts/inventory.mjs --help
```

Execute o help no início da tarefa. Ele é a fonte única dos comandos, campos, filtros, formatos, limites e localização da configuração privada. Os scripts ficam em `scripts/` dentro desta skill e acompanham o checkout entre máquinas.

### Primeiro acesso em cada computador

O humano executa no próprio terminal, sem transmitir senha ao agente:

```bash
node .claude/skills/web-inventory/scripts/inventory.mjs auth configure
node .claude/skills/web-inventory/scripts/inventory.mjs auth login
node .claude/skills/web-inventory/scripts/inventory.mjs auth status
```

Configure a URL do projeto e a chave pública **anon/publishable**, disponíveis na configuração pública do app ou no painel Supabase. O prompt oferece o destino operacional padrão. Nunca use chave administrativa. O login pede e-mail e senha oculta; a senha não é persistida. A sessão fica em arquivo privado fora do checkout. Não copie a sessão para outra máquina: faça login nela. Não passe segredos por argumentos, chat, Markdown, logs ou arquivos do repositório. A entrada `--stdin` é destinada a pipes privados de ferramentas locais, não a literais com senha em comandos.

Use uma conta já autorizada. A CLI não provisiona contas nem altera senhas. Se houver troca obrigatória, conclua-a no app e faça novo login. Não existe identidade de agente provisionada automaticamente; as movimentações têm a autoria do usuário autenticado. O status consulta a autorização atual, e a sessão é renovada quando necessário. `auth logout` apaga a sessão local mesmo se a revogação remota falhar; nesse caso, reporte o erro.

## Operação

Use `find` para resolver o Item por nome e Aliases. Se houver vários candidatos, apresente localização e quantidade e peça a escolha em texto numerado. Leia todas as páginas pertinentes antes de concluir ausência ou unicidade. `has_more` indica resultados restantes; `offset` conta resultados já filtrados. Escritas exigem o UUID retornado, nunca nome aproximado.

Antes de Take/Add, confirme a quantidade inteira e a unidade descrita no Item. Não converta metros em peças. Em cadastro, procure duplicatas e obtenha nome, quantidade, Category e Location completa; confirme Aliases, Minimum Safe Stock e observações/unidade quando faltarem. Consulte `categories` para os valores atuais. Em Relocate, obtenha Shelf e Place juntos; não invente localização. O servidor valida Category e invariantes, calcula saldo/Status/Low Stock e registra histórico.

Reporte o Item retornado, saldo e localização, incluindo `warning` e Low Stock. Falha de transporte durante uma escrita significa **resultado incerto**: não repita automaticamente. Consulte `show` e `history` e reconcilie com o usuário; para cadastro sem UUID retornado, localize primeiro com `find`. As leituras paginadas não são um snapshot transacional: se houver alterações concorrentes, consulte novamente antes de uma decisão crítica.

Nunca use as notas do vault para consultar saldo atual ou registrar estoque operacional. A skill `garage-inventory` atende somente os originais preservados.

## Exemplos em fixture

O UUID abaixo pertence apenas à fixture de teste. Não execute este bloco contra produção; numa operação real, use o UUID obtido em `find` e os dados confirmados pelo usuário.

```bash
node .claude/skills/web-inventory/scripts/inventory.mjs find 'ACUCAR' --limit 1 --offset 0
node .claude/skills/web-inventory/scripts/inventory.mjs list --category Electronics --shelf 2 --surface B --place B03 --status in_stock --low-stock
node .claude/skills/web-inventory/scripts/inventory.mjs show 12345678-1234-1234-1234-123456789012
node .claude/skills/web-inventory/scripts/inventory.mjs categories
node .claude/skills/web-inventory/scripts/inventory.mjs history 12345678-1234-1234-1234-123456789012 --limit 10
node .claude/skills/web-inventory/scripts/inventory.mjs create --name 'Módulo' --shelf 2 --place B03 --qty 2 --category Electronics --aliases '["AÇÚCAR"]' --minimum-safe-stock 3 --body 'Unidade: peças.'
node .claude/skills/web-inventory/scripts/inventory.mjs take 12345678-1234-1234-1234-123456789012 --n 1
node .claude/skills/web-inventory/scripts/inventory.mjs add 12345678-1234-1234-1234-123456789012 --n 3
node .claude/skills/web-inventory/scripts/inventory.mjs relocate 12345678-1234-1234-1234-123456789012 --shelf 3 --place W12
node .claude/skills/web-inventory/scripts/inventory.mjs recategorize 12345678-1234-1234-1234-123456789012 --category Tools
node .claude/skills/web-inventory/scripts/inventory.mjs auth logout
```

## Verificação

```bash
node --test .claude/skills/web-inventory/scripts/cli.test.mjs
```

O teste requer também Bash e Python 3 para verificar o prompt oculto num terminal real. Cria servidor HTTP e sessões efêmeras locais. Exercita a CLI em subprocessos, inclusive os exemplos acima em checkout mínimo movido com espaços. Não usa credenciais nem Itens reais. Os contratos de Auth, tabelas e RPCs ficam nas migrations de `app/supabase/migrations/`; a busca compartilhada fica em `app/src/inventory.ts`.
