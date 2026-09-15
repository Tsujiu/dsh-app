<p align="center">
  <img src="resources/icon.png" alt="DSH APP" width="128">
</p>

<h1 align="center">DSH APP</h1>

<p align="center">
  Cliente desktop de marca do DeepSeek Harness (`dsh`), mantido pela comunidade.<br>
  Windows / macOS / Linux, voltado para lançamento público.
</p>

<p align="center">
  <strong>Português (Brasil)</strong> · <a href="README.en.md">English</a>
</p>

O shell traz seu próprio runtime dsh versionado (atualizações e reversão
autogerenciadas) e renderiza a interface web oficial do dsh em uma janela com
sandbox; os recursos de marca são implementados como um conjunto de plugins do
dsh, sem fazer fork do upstream. O design em camadas, o layout do runtime do
kernel, o mecanismo de atualização e reversão e o empacotamento estão em
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Recursos do cliente de marca

DSH APP é um cliente **autocontido e sem fork**: o kernel é autogerenciado
(`userData/kernel/`, ativação atômica + reversão), e todos os recursos são um
conjunto de plugins dsh (`plugins/`) sobre o kernel upstream. Assim, um
lançamento upstream é apenas uma atualização comum do kernel. Capacidades atuais:

| Recurso | Plugin | Implementação |
|---|---|---|
| Barra lateral de conversa (visualizações nativas): **Git** — alterações agrupadas por diretório, diff unificado com números de linha duplos, stage/restore/commit, lista de arquivos do repositório e grafo do Git (clique em um commit para ver título/corpo/estatísticas). A árvore de arquivos foi aposentada: a barra lateral upstream fornece o gerenciamento do workspace nativamente | `@dsh-app/plugin-sidebar` (host + client) | `plugins/plugin-sidebar/src/client/git-tab.tsx` |
| Página de configurações avançadas de modelos: editores por modelo e gerenciamento completo da lista llm-pi-ai (esforço de raciocínio, modalidades de entrada, switches de compatibilidade); declarar o esforço preenche automaticamente `supportsDeveloperRole` false + `maxTokensField`, apenas de forma aditiva; migração de rota companheira para modelos fora do catálogo; preenchimento de models.dev com fallback automático para espelho gh-proxy | `@dsh-app/plugin-client-ui` | `plugins/plugin-client-ui/src/client/models-advanced/` |
| Tema de marca e interface totalmente em português (pt-BR): sobreposições de tokens `--dsw-alias-*` | `@dsh-app/plugin-client-ui` | `plugins/plugin-client-ui/src/client.ts:58` |
| Fundo de baleia da marca: quadro estático em repouso, dispersão do ponteiro apenas ao passar o mouse (o loop pausa quando o ponteiro sai, sem engasgos na rolagem); contraste sensível ao tema; flutua sobre o compositor e, na fase ativa, amplia e centraliza na coluna de conversa | `@dsh-app/plugin-client-ui` | `plugins/plugin-client-ui/src/client/whale-background.ts` |
| Memória entre sessões: ferramentas `memory_save`/`memory_recall`/`memory_forget` + injeção no prompt de sistema (mais recentes primeiro, dentro do orçamento), memória global e por projeto roteada pelo cwd da sessão; alternâncias na página de configurações; destilador em segundo plano preenche sessões silenciosas após 60 segundos por chamada direta ao modelo (tokens e duração registrados), com varreduras do curador acionadas por cooldown e alterações de arquivos | `@dsh-app/plugin-memory` | `plugins/plugin-memory/src/{tools,routes,distiller,curator}.ts` |
| Orquestração de subagentes em lote: subtarefas independentes distribuídas a filhos paralelos continuáveis, com controle adaptativo de concorrência (reduz em falhas, cresce em sequências bem-sucedidas), nova tentativa automática por item em sessões preservadas e retomada por identificador do filho; ferramenta `swarm` + comando `/swarm` | `@dsh-app/plugin-swarm` | `plugins/plugin-swarm/src/orchestrator.ts` |
| Estatísticas de uso: cartão de saldo (provedores oficiais deepseek, preços CNY em dois níveis, ocioso/pico, chave nunca sai do host), mapa de calor diário e gráfico de tendência; cache de saldo com TTL de 5 minutos (single-flight, atualização silenciosa na montagem, nova consulta forçada ao clicar no cartão) | `@dsh-app/plugin-usage` | `plugins/plugin-usage/src/client/usage-section.tsx` |
| Gerenciador de arquivamento de sessões: agrupado pelo diretório de trabalho do projeto (recolhível, com teclado), confirmação de exclusão em duas etapas; exclusão remove fisicamente o diretório de log via `resolveCurrentLog` (sessões pré-migração usam o layout do backend como fallback), e o registro é mantido como barreira de visibilidade, recuperado pela ação de limpeza do painel | `@dsh-app/plugin-archives` | `plugins/plugin-archives/src/client/archives-section.tsx` |
| Busca rápida de arquivos: ferramentas `fffind`/`ffgrep`/`fff-glob` sobre um índice compartilhado em memória por workspace, com cada busca limitada ao workspace da sessão em execução | `@dsh-app/plugin-fff` (host) | `plugins/plugin-fff/src/tools.ts` |
| Gerenciador de servidores MCP: CRUD na página de configurações, montagem/desmontagem dinâmica, ferramentas registradas nativamente como `mcp__<server>__<tool>`; valores de chaves mascarados na leitura | `@dsh-app/plugin-mcp` (dual) | `plugins/plugin-mcp/src/client/mcp-section.tsx` |
| Ponte de hooks externos: CRUD na página de configurações para `hooks.json` do Claude Code / Codex, montados como instâncias de hook ativas (interceptam prompts, ferramentas e turnos) | `@dsh-app/plugin-hooks` (dual) | `plugins/plugin-hooks/src/client/hooks-section.tsx` |

Conexão do conjunto (executada automaticamente a cada início do server, `src/main/brand-suite.ts`):

1. **Resolução de módulos**: os plugins do conjunto são vinculados a `$DSH_HOME/profiles/node_modules/@dsh-app/` (junction no Windows); no desenvolvimento vêm de `plugins/*` deste repositório, e em produção de `app/node_modules/@dsh-app/*` do kernel ativo.
2. **Overlay do loader**: `plugins/dsh-app.patch.yml` é copiado para userData e injetado por `dsh web --patch`, com entradas do conjunto aplicadas após as camadas do bundle oficial (last write wins, sem alterar o template de perfil upstream).

Ambas as costuras **degradam graciosamente**: se o kernel não tiver os plugins do conjunto (por exemplo, um alvo de reversão), ele inicia como vanilla, sem bloqueio.

## Início rápido (desenvolvimento)

Requer Node.js 22+ e pnpm. O kernel de desenvolvimento é o checkout local do deepseek-harness.

Pré-requisitos (uma vez):

```powershell
# 1. Há um checkout irmão do deepseek-harness (../deepseek-harness),
#    com dependências instaladas e o frontend web compilado:
cd ../deepseek-harness
pnpm install
pnpm run build:web

# 2. Instalar dependências do shell
cd ../dsh-app
npm install
```

Inicialização (**observação: o Windows PowerShell não suporta a sintaxe `VAR=1 cmd`**):

```powershell
# PowerShell
$env:DSH_APP_DEV="1"; npm start
```

```bat
:: cmd
set DSH_APP_DEV=1 && npm start
```

No modo de desenvolvimento, o shell executa `pnpm dsh web` no checkout local (porta livre aleatória), sem downloads nem artefatos de kernel. A inicialização dev é muito mais lenta que a de produção: pnpm + transpilação imediata de todo o TypeScript por tsx são o principal custo; em produção, executa diretamente o `lib/bin.js` pré-compilado e fica pronto em segundos.

### Usar outro checkout

```powershell
$env:DSH_APP_DEV="1"; $env:DSH_APP_DEV_RUNTIME="D:/codes/DSH-APP/deepseek-harness"; npm start
```

### Diferenças conhecidas entre desenvolvimento e produção

| Item | Modo de desenvolvimento | Produção |
|---|---|---|
| Fonte do kernel | checkout local (`pnpm dsh web`, compilação imediata por tsx) | runtime pré-instalado em `userData/kernel/` (binário node direto) |
| Velocidade de inicialização | lenta (cerca de 10 s) | rápida (cerca de 2 s) |
| Verificação de atualizações | ignorada (fixada no checkout) | automática a cada 6 h + manual pela bandeja |

## Sistema de atualização do kernel

O aplicativo traz um kernel versionado (`userData/kernel/`) e não depende de um dsh instalado no sistema. Fluxo: resolver a versão pela dist-tag do npm registry → baixar o artefato de runtime do GitHub Releases → verificar o sha512 anexado → ativar atomicamente (a versão antiga fica como `previous`) → reverter automaticamente após 2 falhas consecutivas de inicialização. Consulte [ARCHITECTURE.md §4–5](docs/ARCHITECTURE.md) para o layout e o fluxo.

**Detecção de deriva do runtime embutido**: durante uma atualização, se o conteúdo do runtime embutido diferir do diretório do kernel com o mesmo nome no disco (por exemplo, se o conjunto ganhou um plugin), a inicialização detecta isso (comparação sha512 + proteção de versão) e reativa o runtime embutido. Conteúdo antigo nunca perde plugins silenciosamente, e um kernel atualizado online nunca é sobrescrito por downgrade.

### Atualizações do aplicativo (shell)

O Windows usa um fluxo personalizado; macOS / Linux usam `electron-updater`.

1. Detectar: `github.com/<owner>/<repo>/releases/latest/download/latest.yml` (fallback de espelho)
2. Baixar: escolher o instalador pela arquitetura, priorizando a URL oficial e depois ghfast.top / gh-proxy.com
3. Verificar: comparar sha512 com latest.yml; um espelho nunca substitui o conteúdo
4. Instalar: **assistente de instalação visível** — "instalar agora" encerra o aplicativo e abre o mesmo assistente NSIS da primeira instalação (todo o progresso fica visível); ao terminar, o aplicativo reinicia e o instalador é excluído (também ao cancelar)

### Adaptação de rede na China continental (atualizações sem VPN)

Ambos os fluxos têm cadeias de fallback e funcionam de imediato:

| Fluxo | Fonte oficial | Fallback | Substituição |
|---|---|---|---|
| Resolução de versão | `registry.npmjs.org` | `registry.npmmirror.com` | `DSH_APP_NPM_REGISTRIES` (separadas por vírgula) ou `NPM_CONFIG_REGISTRY` |
| Download de artefato | Release do `github.com` | `ghfast.top`, `gh-proxy.com` (em ordem) | `DSH_APP_GITHUB_MIRRORS` (prefixos separados por vírgula; vazio = espelhos desligados) |

Modelo de segurança: **os metadados sha512 são obtidos primeiro do GitHub oficial**; os espelhos só participam do download de arquivos grandes, e cada candidato (oficial + cada espelho) é verificado com o mesmo sha512 confiável.

Autoverificação de conectividade (execute uma vez no ambiente de rede de destino):

```powershell
node scripts/probe-mirror.mjs
```

## Adaptação de desktop

O shell injeta recursos de desktop na Web UI em runtime, sem alterar o código-fonte do harness: arrastar a janela, espaço para botões nativos, sincronização em tempo real da cor da barra superior e UI totalmente localizada em pt-BR. Os recursos de marca (barra lateral, página de modelos etc.) também usam o conjunto de plugins, com overlays `--patch` e injeções de slot, sem alterações no upstream. Veja [ARCHITECTURE.md §2](docs/ARCHITECTURE.md).

## Compilação e distribuição

```sh
npm run dist:win     # instalador NSIS (x64 + arm64)
npm run dist:mac     # dmg + zip (x64 + arm64; notarização via variáveis de ambiente)
npm run dist:linux   # AppImage + deb (x64 + arm64)
```

Ícone do aplicativo: `resources/icon.png` é um ícone de marca placeholder; substitua-o pelo ícone final antes do lançamento. `npm run icon:gen` gera o placeholder, e `npm run icon:build` deriva PNGs de vários tamanhos + ICO (requer Pillow).

O artefato de runtime do kernel é compilado por `scripts/build-runtime.mjs` (um por platform/arch), e o workflow de CI o publica no GitHub Releases:

```sh
node scripts/build-runtime.mjs win32 x64 0.1.0-rc.8
```
