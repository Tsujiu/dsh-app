# Gerenciamento de servidores MCP (P0)

> Objetivo: transformar "configurar um servidor MCP exige escrever YAML de patch manualmente" em uma operação de formulário na página de configurações. A capacidade do kernel (`@deepseek-ai/dsh-mcp-client`) já é publicada com o runtime dsh; esta demanda é inteiramente do conjunto.

## 1. Contexto

MCP (Model Context Protocol) é o padrão de fato para conectar agents a servidores de ferramentas externas: sistema de arquivos, GitHub, bancos de dados, controle de navegador, servidores de memória etc. O kernel já tem uma ponte completa (ferramentas registradas nativamente como `mcp__<serverName>__<tool>`, reconexão automática e proteção contra conflitos de nomes), mas o upstream pressupõe que "o operador escreva a linha do overlay" e não oferece UI para usuários finais:

- Entrada de configuração = editar manualmente uma linha de `cordis.patch.yml` (o exemplo de `packages/mcp/mcp-client/README.md` é a forma final);
- alterar um server exige editar o overlay → reiniciar → consultar logs para diagnosticar erros;
- dor relatada por usuários: *"realmente não há uma página intuitiva para configurar isso; configurar MCP é especialmente complicado"*.

Produtos semelhantes (Claude Desktop / Cursor / `.mcp.json` do Claude Code) tratam a configuração MCP como UI/arquivo de primeira classe; esta é uma lacuna evidente do DSH APP.

## 2. Contrato do kernel (verificado, L1)

Fonte: `deepseek-harness/packages/mcp/mcp-client/README.md` (0.1.2-rc.1).

**Um server = uma linha de plugin**; vários servers usam várias linhas do mesmo plugin, cada uma com seu próprio config:

```yaml
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN

- id: mcp-web
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: web
    transport: streamable-http
    url: http://localhost:3000/mcp
    headers:
      Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

| Campo | Padrão | Descrição |
|---|---|---|
| `transport` | obrigatório | `stdio` ou `streamable-http` |
| `serverName` | obrigatório | namespace das ferramentas, `[A-Za-z0-9_-]{1,32}`, único no mesmo domínio de registro |
| `command`/`args`/`env`/`cwd` | — | stdio: executável, argumentos, env adicional (com ambiente filtrado) e diretório de trabalho |
| `url`/`headers` | — | streamable-http: endpoint e cabeçalhos de requisição adicionais |
| `toolCallTimeoutMs` | 60000 | timeout de uma chamada `tools/call` |
| `failOnStartupError` | false | quando true, uma falha de conexão inicial faz o harness recusar a inicialização (**fixamos como false**) |
| `reconnect.{enabled,initialDelayMs,maxDelayMs,maxAttempts}` | true/500/30000/10 | orçamento de reconexão após desconexão |

Comportamentos importantes:

- O nome da ferramenta é `mcp__<serverName>__<rawName>`, igual ao de Claude Code / Codex; assim, as regras de permissão em reinicializações e no histórico da sessão permanecem estáveis.
- Falha de conexão inicial: o harness inicia normalmente, as ferramentas desse server não aparecem e o erro vai para o log (`failOnStartupError:false`).
- Proteção contra conflitos: se houver o mesmo serverName, o carregado depois falha; nomes de ferramentas duplicados dentro do server fazem todo o conjunto ser recusado (não aparece um conjunto parcial).
- **Somente tools são conectadas**; resources/prompts não são suportados.
- Aviso de custo (incluir no texto da UI): as definições de ferramentas de cada server ocupam contexto em toda requisição; montar muitos servers aumenta o uso de tokens.

## 3. Design do produto

### 3.0 Edição JSON e importação em lote (adicionado em 2026-09-06, feedback dos usuários)

Além do formulário da §3.1, completar dois fluxos JSON (seguindo a alternância formulário/JSON do editor MCP do VS Code):

- **Modal de edição em dois modos, formulário/JSON**: alternância no canto superior direito. A visão JSON exibe/aceita o fragmento padrão mcpServers dessa entrada, `{"server-name": {...}}`, permitindo colar diretamente o formato do Claude / Cursor / VS Code (`type: "stdio"|"http"`, `command`/`args`/`env`/`cwd`/`url`/`headers`/`toolCallTimeoutMs`); o formato encapsulado `{"mcpServers": {...}}` só é aceito quando há um único servidor (o modo de edição corresponde a um servidor). Conversão bidirecional formulário ⇄ JSON; em caso de falha no JSON, permanecer nessa visão e exibir o erro. As regras de mascaramento são iguais às do formulário (valores em texto puro aparecem como •••••• e são preservados no retorno).
- **"Importar JSON" na página de lista**: colar em lote `{"mcpServers": {...}}` ou um mapa sem wrapper; importar item a item (`POST /server/import`), sem que uma falha impeça as demais, retornando o relatório `{imported, failed}` e montando cada item.
- **Regras de mapeamento** (`src/wire.ts`, módulo puro reutilizável no browser): rejeitar explicitamente `type: sse` (a ponte do kernel só suporta stdio e Streamable HTTP); quando type estiver ausente, inferir a partir de url/command; ignorar campos desconhecidos (compatibilidade futura); o nome do servidor é a chave e deve obedecer ao padrão de serverName.

### 3.1 Seção da página de configurações (order 12, "Servidores MCP")

Visualização de lista (um cartão por server):

- nome (serverName), distintivo do tipo de transporte (stdio / HTTP) e chave de habilitação;
- linha de estado: número de ferramentas e resultado da conexão mais recente (sucesso / resumo do motivo da falha / desabilitado);
- área expandida: campos completos de configuração + lista de ferramentas fornecidas pelo server (nome + descrição em uma frase);
- ações: editar / testar conexão / excluir.

Formulário de adição/edição:

- seleção única de transport para alternar os grupos de campos (stdio: command/args/env/cwd; http: url/headers);
- validação em tempo real de `serverName` com `[A-Za-z0-9_-]{1,32}` + verificação de nome duplicado;
- editor de pares chave-valor de env; editor de pares chave-valor de headers (http);
- área avançada recolhida: parâmetros de toolCallTimeoutMs e reconnect (com valores padrão, expondo poucos detalhes).

Estados de interação (obrigatórios): salvando / testando / exibição do motivo da falha de conexão / confirmação dupla de exclusão / orientação no estado vazio ("O que é MCP + adicionar o primeiro servidor").

### 3.2 Relação com as linhas manuais de `$DSH_HOME/cordis.patch.yml` (coexistência / migração)

A definição do upstream é que a configuração MCP seja uma linha escrita manualmente pelo operador na camada patch; por isso, usuários antigos (inclusive nossas máquinas de desenvolvimento) podem já ter uma linha `@deepseek-ai/dsh-mcp-client` em `$DSH_HOME/cordis.patch.yml`.
Relação entre as duas fontes:

| | Linha manual de cordis.patch.yml | servers.json (este plugin) |
|---|---|---|
| Natureza | montagem estática do loader na inicialização do kernel | montagem dinâmica do plugin (`ctx.loader.create`) |
| Aplicação | requer reinicialização após alteração (ou depende de HMR) | monta/desmonta imediatamente ao salvar |
| Visibilidade | sem UI; falhas aparecem apenas no log do kernel | distintivo de estado + número de ferramentas em tempo real + motivo da falha |
| Impacto do erro | YAML incorreto afeta toda a camada do usuário | cada falha é exibida individualmente; o boot não é afetado |

- **Podem coexistir**: são entradas diferentes do loader e não se conhecem; todas as ferramentas são registradas como `mcp__<serverName>__*`. O único conflito: **o mesmo serverName configurado nos dois lados faz a montagem posterior falhar** (o upstream rejeita nomes duplicados no domínio de registro; como a instância deste plugin é montada depois, a falha aparece no estado da UI).
- **Recomenda-se convergir para servers.json como fonte única**: o caminho de migração é copiar a linha manual para JSON mcpServers (ou colá-la usando "Importar JSON") e, após confirmar a montagem, excluir a linha correspondente de cordis.patch.yml. Por exemplo, `- id: mcp-exa / name: '@deepseek-ai/dsh-mcp-client' / config: {serverName: exa, transport: streamable-http, url: ..., toolCallTimeoutMs: 120000}` equivale a
  `{"exa": {"type": "http", "url": "...", "toolCallTimeoutMs": 120000}}`。
- Não fazer importação por análise automática do arquivo patch: o YAML da camada do usuário aceita expressões `!!js` e âncoras, cuja análise segura exigiria toda a semântica do loader; a importação por colagem de JSON já cobre o custo de migração.

### 3.3 Fluxo de dados

```
Página de configurações (client) ──POST/PUT/DELETE──> /plugins/@dsh-app/plugin-mcp/api/servers (host, fenced)
                                        │ validação (validade de serverName, completude dos campos de transporte, deduplicação)
                                        ▼
                              $DSH_HOME/storages/dsh-app-plugin-mcp/servers.json
                                         │ após alteração
                                        ▼
                           montar/desmontar dinamicamente a instância mcp-client correspondente (ver §4.2)
```

## 4. Arquitetura da solução

### 4.1 Novo plugin dual `@dsh-app/plugin-mcp`

- host (`src/index.ts`): ler `servers.json` → montar dinamicamente o mcp-client para cada server habilitado; registrar API routes fenced (CRUD + test + status); nenhum efeito colateral global.
- client (`src/client.ts`): `settings.section` order 12; formulário + lista; estado por polling ou push.
- Integração: adicionar `plugin-mcp` a `SUITE_PLUGIN_DIRS` de `brand-suite.ts`; adicionar a linha de overlay a `dsh-app.patch.yml`; não é necessário alterar `build-runtime.mjs` (a suite é enumerada pelo diretório).
- **Não escrever nenhuma linha de server no overlay** (a configuração do usuário não fica no overlay), apenas a linha do plugin:
  `- id: mcp-manager \n  name: '@dsh-app/plugin-mcp'`.

### 4.2 Montagem dinâmica (único ponto de incerteza técnica desta demanda → verificar primeiro)

Plano principal: criar/destruir instâncias dinamicamente usando o cordis loader dentro do plugin host:

```ts
const dispose = await ctx.loader.create({
  name: '@deepseek-ai/dsh-mcp-client',
  config: { serverName, transport, command, args, env, ... },
})
// Ao desmontar/desabilitar, chamar dispose ou a API de destruição correspondente do loader
```

Base: `apps/cli/src/profile-boot.ts:283-285` já usa `ctx.loader.create({ name, config })` no contexto host para montar plugins (caminho de fallback do HMR); o padrão existe.

**Etapa de validação V1** (meio dia, antes de escrever o código): no modo dev, um plugin probe temporário usa `ctx.loader.create` para montar um servidor MCP local stdio echo e confirma (a) que as ferramentas da instância aparecem no próximo prompt; (b) que desaparecem após dispose; (c) que uma falha de conexão não afeta o boot.

Alternativa (se V1 falhar): depois que o plugin gravar a alteração em `servers.json`, o shell incorpora os servers habilitados às linhas insert de `dsh-app.patch.yml` na **próxima inicialização do server** (`brand-suite.ts` já reescreve o overlay a cada inicialização). Custo: adicionar, remover ou editar um server exige reiniciar o server (a bandeja já tem a ação "reiniciar serviço", bastando orientar na UI). Essa opção não introduz mecanismo novo e pode ser usada no MVP.

### 4.3 Estado e lista de ferramentas

- Estado da conexão: o mcp-client apenas registra falhas no log. O plugin precisa ler no ctx o resultado de cada instância; a superfície exata (consulta de instâncias do loader / contagem no registro de tools pelo prefixo `mcp__<server>__`) será confirmada em V1. No pior caso, o MVP exibirá apenas "habilitado/desabilitado", orientando a consultar o log para erros (o centro de diagnóstico P dará continuidade depois).

## 5. Segurança (itens rigorosos)

1. **stdio server = execução de qualquer comando na máquina do usuário**. A UI deve deixar isso explícito ao adicionar um stdio server ("este comando iniciará um processo na máquina local") e mostrar o command+args completo. Isso equivale à configuração escrita manualmente pelo usuário; não há sandbox (o sistema de sandbox do upstream tem outra finalidade), mas o aviso é obrigatório.
2. **Credenciais**: env/headers podem conter tokens. Convenções:
   - os valores aceitam a sintaxe de referência `$ENV:VAR_NAME` (ao salvar, tratar como referência a uma variável de ambiente; armazenar apenas o nome da referência no arquivo);
   - valores em texto puro no arquivo são permitidos (mesmo risco local do `.mcp.json` do Claude Code), mas **as routes devolvem dados mascarados ao client** (o valor é substituído por `••••`; ao editar, restaurar o original apenas se o usuário o digitar novamente);
   - reutilizar nas logs a regra de redact de server.ts; nenhuma route pode devolver um token completo.
3. **Todas as routes passam pelo Host fence** (loopback + validação do cabeçalho Host); operações de escrita ficam limitadas à UI local.
4. Validar `serverName` por allowlist (a expressão regular é o contrato do upstream), evitando injeção no namespace das ferramentas.

## 6. MVP / V2

**MVP (recomendação: 1 iteração)**:
- armazenamento em servers.json + routes CRUD completas + validação do formulário;
- montagem: V1 aprovada → montagem dinâmica; V1 falha → combinação via overlay + aplicação após reiniciar;
- listar/adicionar/editar/excluir/habilitar/desabilitar + motivo da falha (resumo do log);
- sintaxe de referência `$ENV:` + mascaramento nas respostas.

**V2 (iterações posteriores)**:
- pré-visualização da lista de ferramentas e contagem de ferramentas; botão de testar conexão;
- **importação em um clique** da configuração do Claude Code / Cursor (ler a chave mcpServers de `~/.claude.json` ou `.mcp.json`, reduzindo o custo de migração);
- catálogo de servers comuns (modelos predefinidos oficiais como filesystem/github/fetch, preenchidos em um clique).

## 7. Critérios de aceitação (comportamentais)

1. Adicionar um stdio server (como filesystem) sem reiniciar; na próxima conversa, as ferramentas `mcp__<name>__*` aparecem na lista do modelo e são chamadas com sucesso; após excluir, as ferramentas desaparecem.
2. serverName duplicado / caracteres inválidos / campo transport ausente: o salvamento é recusado com um motivo em zh-CN.
3. Server inacessível na inicialização: o harness inicia normalmente, as demais funções não são afetadas e a UI mostra a falha desse server.
4. Valores de env salvos não aparecem em texto puro nem na resposta GET nem nos logs.
5. Após rollback do kernel para uma versão antiga sem mcp-client, somente a funcionalidade deste plugin fica ausente; o boot não é afetado.
6. `npm run typecheck` + tsc do plugin passam; as novas routes passam pelo probe do fence.

## 8. Esforço e riscos

> **Status da implementação (2026-09-06)**: implementado conforme esta proposta (`plugins/plugin-mcp/`, linha de overlay + integração com `SUITE_PLUGIN_DIRS`), ainda não commitado. A validação V1 da §4.2 foi coberta automaticamente por `scripts/smoke-suite.mjs` (no kernel real, create → montagem das ferramentas `mcp__smokeecho__*` → disable → delete, com asserções de 200/status em todo o fluxo); o mascaramento bidirecional e os caminhos de rejeição da validação têm testes unitários (`plugins/plugin-mcp/tests/`, 23 casos). Entrada testada pelo usuário: Configurações → Servidores MCP.

- Esforço: plugin host + routes + armazenamento ~2 dias; formulário/lista client ~2-3 dias; validação V1 0,5 dia; integração 1 dia. Total: núcleo de aproximadamente uma iteração.
- Riscos:
  - R1 montagem dinâmica do loader indisponível no contexto do plugin → alternativa como fallback (§4.2), sem alterar a forma de entrega;
  - R2 mcp-client sem superfície de consulta de estado → exibição de estado degradada no MVP (§4.3);
  - R3 alterações da API upstream (normais na linha rc) → probe de smoke da suite (dev-process-tooling.md) implementado primeiro, cobrindo também a validação V1.
