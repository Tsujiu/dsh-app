<p align="center">
  <img src="resources/icon.png" alt="DSH APP" width="128">
</p>

<h1 align="center">DSH APP</h1>

<p align="center">
  Um cliente desktop de marca, mantido pela comunidade, para o
  <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> (`dsh`).<br>
  Windows / macOS / Linux, voltado para lançamento público.
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <strong>Português (Brasil)</strong>
</p>

O shell empacota um runtime dsh com versão própria (atualizações e reversão
autogerenciadas) e renderiza a interface web oficial do dsh em uma janela com
sandbox; toda a marca é entregue como um conjunto de plugins do dsh — o upstream
nunca é bifurcado. Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para o
design em camadas, o layout do runtime do kernel, o mecanismo de atualização e
reversão e o empacotamento.

## Recursos do cliente de marca

DSH APP é um cliente de marca **autocontido, sem fork**: o kernel é
auto-hospedado (`userData/kernel/`, ativação atômica + reversão) e todos os
recursos são um conjunto de plugins do dsh (`plugins/`) sobrepostos ao kernel
upstream, de modo que um lançamento upstream é apenas uma atualização comum do
kernel. Capacidades atuais dos plugins:

| Recurso | Plugin | Implementação |
|---|---|---|
| Barra lateral de conversa (visualizações nativas): **Git** — lista de alterações agrupadas por diretório, diff unificado com números de linha duplos, stage/restore/commit, lista de arquivos rastreados, modal de grafo (clique em um commit para ver título/corpo/estatísticas de arquivos). A aba de árvore de arquivos foi aposentada: a barra lateral upstream já traz o gerenciamento de arquivos do workspace nativamente | `@dsh-app/plugin-sidebar` (face host + client) | `plugins/plugin-sidebar/src/client/git-tab.tsx` |
| Página de configurações avançadas de modelos: editores em nível de modelo e gerenciamento de lista completa para modelos llm-pi-ai (esforço de raciocínio, modalidades de entrada, switches de compatibilidade); declarar um nível de raciocínio preenche automaticamente os switches de compatibilidade (`supportsDeveloperRole` false + `maxTokensField`), apenas aditivo e sem sobrescrever valores explícitos; migração de rota companheira para modelos fora do catálogo; preenchimento models.dev com fallback de espelho gh-proxy | `@dsh-app/plugin-client-ui` | `plugins/plugin-client-ui/src/client/models-advanced/` |
| Tema de marca e interface totalmente em português (pt-BR): sobreposições de tokens `--dsw-alias-*` | `@dsh-app/plugin-client-ui` | `plugins/plugin-client-ui/src/client.ts:58` |
| Fundo de baleia da marca: quadro estático em repouso, dispersão pelo ponteiro apenas ao passar o mouse (o loop de renderização pausa quando o ponteiro sai — sem engasgo de rolagem); contraste sensível ao tema (realce no claro para legibilidade, marca d'água de baixa opacidade no escuro); flutua acima do compositor; a fase ativa amplia e centraliza na coluna de conversa | `@dsh-app/plugin-client-ui` | `plugins/plugin-client-ui/src/client/whale-background.ts` |
| Memória entre sessões: ferramentas `memory_save`/`memory_recall`/`memory_forget` + injeção no prompt de sistema (mais recentes primeiro, sob orçamentos), arquivos de memória globais vs por projeto roteados pelo cwd da sessão; alternâncias na página de configurações; um destilador em segundo plano preenche sessões silenciosas após 60 segundos por meio de uma chamada direta ao modelo (tokens e duração de cada chamada registrados), com varreduras do curador limitadas por cooldown e detecção de alteração de arquivos, chamando o modelo da mesma forma | `@dsh-app/plugin-memory` | `plugins/plugin-memory/src/{tools,routes,distiller,curator}.ts` |
| Orquestração de subagentes em lote: subtarefas independentes se ramificam para filhos paralelos continuáveis com um portão de concorrência adaptativo (reduz em falhas, cresce em sequências limpas), nova tentativa automática por item em sessões preservadas, retomada por id do filho; ferramenta `swarm` + comando `/swarm` | `@dsh-app/plugin-swarm` | `plugins/plugin-swarm/src/orchestrator.ts` |
| Estatísticas de uso: cartão de saldo (provedores oficiais deepseek, preços duplos CNY ocioso/pico, a chave nunca sai do host), mapa de calor diário e gráfico de tendência; cache de saldo com TTL de 5 minutos (single-flight, atualização silenciosa ao montar, nova consulta forçada ao clicar no cartão) | `@dsh-app/plugin-usage` | `plugins/plugin-usage/src/client/usage-section.tsx` |
| Gerenciador de arquivamento de sessões: agrupado pelo cwd do projeto (recolhível, com suporte a teclado), confirmação de exclusão em duas etapas; a exclusão remove fisicamente o diretório de log da sessão via `resolveCurrentLog` (sessões pré-migração recorrem a uma busca de diretório pelo layout do backend), e o registro de arquivamento é mantido como cerca de visibilidade do cliente, recuperado pela ação de poda do painel | `@dsh-app/plugin-archives` | `plugins/plugin-archives/src/client/archives-section.tsx` |
| Busca rápida de arquivos: ferramentas `fffind`/`ffgrep`/`fff-glob` sobre um índice compartilhado em memória por workspace, cada busca limitada ao workspace da sessão do agente em execução | `@dsh-app/plugin-fff` (host) | `plugins/plugin-fff/src/tools.ts` |
| Gerenciador de servidores MCP: CRUD na página de configurações, montagem/desmontagem dinâmica, ferramentas de cada servidor registradas como `mcp__<server>__<tool>` nativas; valores secretos mascarados na leitura | `@dsh-app/plugin-mcp` (face dupla) | `plugins/plugin-mcp/src/client/mcp-section.tsx` |
| Ponte de hooks externos: CRUD na página de configurações sobre arquivos `hooks.json` do Claude Code / Codex, montados como instâncias de hook ativas que limitam prompts, ferramentas e turnos | `@dsh-app/plugin-hooks` (face dupla) | `plugins/plugin-hooks/src/client/hooks-section.tsx` |

Conexão do conjunto (executada a cada início do servidor, `src/main/brand-suite.ts`):

1. **Resolução de módulos**: os plugins do conjunto são vinculados em
   `$DSH_HOME/profiles/node_modules/@dsh-app/` (junction no Windows); o dev usa
   `plugins/*` deste repositório, e a produção usa
   `app/node_modules/@dsh-app/*` do kernel ativo.
2. **Overlay do loader**: `plugins/dsh-app.patch.yml` é copiado para userData e
   injetado via `dsh web --patch` — entradas dos plugins do conjunto aplicadas
   após as camadas do bundle oficial (última escrita vence, sem alterações no
   template de perfil upstream).

Ambas as costuras **degradam graciosamente**: um kernel sem os plugins do
conjunto (ex.: alvo de reversão) inicializa vanilla, nunca bloqueado pela
conexão de marca.

## Início rápido (desenvolvimento)

Requer Node.js 22+ e pnpm. No modo dev, o kernel é o checkout local do
deepseek-harness.

Pré-requisitos únicos:

```powershell
# 1. Um checkout irmão do deepseek-harness (../deepseek-harness),
#    com dependências instaladas e o frontend web compilado:
cd ../deepseek-harness
pnpm install
pnpm run build:web

# 2. Instalar as dependências do shell
cd ../dsh-app
npm install
```

Inicialização (**observação: o Windows PowerShell não suporta a sintaxe
`VAR=1 cmd`**):

```powershell
# PowerShell
$env:DSH_APP_DEV="1"; npm start
```

```bat
:: cmd
set DSH_APP_DEV=1 && npm start
```

No modo dev, o shell executa `pnpm dsh web` dentro do checkout local (porta
livre aleatória) — sem downloads, sem artefatos de kernel. A inicialização em
dev é muito mais lenta que em produção: pnpm + transpilação on-the-fly de todo
o código TypeScript (tsx) é o principal custo; em produção o shell executa o
`lib/bin.js` pré-compilado e fica pronto em segundos.

### Apontar para outro checkout

```powershell
$env:DSH_APP_DEV="1"; $env:DSH_APP_DEV_RUNTIME="D:/codes/DSH-APP/deepseek-harness"; npm start
```

### Diferenças conhecidas dev/prod

| Item | Modo dev | Produção |
|---|---|---|
| Fonte do kernel | checkout local (`pnpm dsh web`, tsx on the fly) | runtime pré-instalado em `userData/kernel/` (binário node direto) |
| Tempo de inicialização | lento (ordem de 10 s) | rápido (ordem de 2 s) |
| Verificações de atualização | ignoradas (presas ao checkout) | a cada 6 h automática + manual pela bandeja |


## Sistema de atualização do kernel

O aplicativo entrega um kernel com versão em `userData/kernel/` e nunca depende
de um dsh instalado no sistema. Pipeline de atualização: resolve a versão pelas
dist-tags do registro npm → baixa o artefato de runtime dos GitHub Releases →
verifica o sha512 anexado → ativa atomicamente (a versão anterior é mantida
como `previous`) → reverte automaticamente após duas falhas consecutivas de
inicialização. Veja [ARCHITECTURE.md §4–5](docs/ARCHITECTURE.md) para o layout
do runtime e o fluxo completo de atualização.

**Detecção de deriva do runtime embutido**: em uma atualização, se o conteúdo
do runtime embutido difere do diretório do kernel de mesmo nome no disco (ex.:
o conjunto ganhou um plugin), a inicialização detecta (comparação de sha512 +
guarda de versão) e reativa o bundle — conteúdo obsoleto nunca perde plugins
silenciosamente; um kernel mais novo instalado online nunca é sobrescrito por
downgrade.

### Atualizações do shell (aplicativo)

O Windows usa um fluxo personalizado no aplicativo; macOS / Linux usam
`electron-updater`.

1. Detectar: `github.com/<owner>/<repo>/releases/latest/download/latest.yml`
   (fallback de espelho)
2. Baixar: instalador compatível com a arquitetura, URL oficial primeiro com
   cadeia de fallback ghfast.top / gh-proxy.com
3. Verificar: sha512 contra latest.yml — um espelho nunca pode substituir conteúdo
4. Instalar: **assistente de instalação visível** — "instalar agora" encerra o
   aplicativo e abre o mesmo assistente NSIS da primeira instalação (progresso
   totalmente visível); o aplicativo reinicia ao concluir e o arquivo do
   instalador é excluído depois (também ao cancelar)

### Adaptação de rede na China continental (atualizações funcionam sem VPN)

Ambos os caminhos de atualização têm cadeias de fallback e funcionam de
prontidão:

| Caminho | Oficial | Fallback | Sobrescrita |
|---|---|---|---|
| Resolução de versão | `registry.npmjs.org` | `registry.npmmirror.com` | `DSH_APP_NPM_REGISTRIES` (separadas por vírgula) ou `NPM_CONFIG_REGISTRY` |
| Download de artefato | Release do `github.com` | `ghfast.top`, `gh-proxy.com` (tentados em ordem) | `DSH_APP_GITHUB_MIRRORS` (prefixos separados por vírgula; vazio = espelhos desligados) |

Modelo de segurança: **os metadados sha512 são buscados primeiro no GitHub
oficial**; os espelhos participam apenas do estágio de download de arquivos
grandes, e cada candidato (oficial + cada espelho) é verificado contra o mesmo
sha512 confiável — um espelho sequestrado não pode substituir conteúdo.

Autoverificação de conectividade (execute uma vez no ambiente de rede de
destino):

```powershell
node scripts/probe-mirror.mjs
```


## Adaptação de desktop

O shell injeta recursos de desktop na interface web em tempo de execução com
zero alteração no código-fonte do harness: arrastar janela, espaço para os
botões nativos da janela, sincronização de cor da barra de título em tempo
real e uma interface totalmente localizada (pt-BR). A funcionalidade de marca
(barra lateral, página de modelos, …) também é zero-alteração-upstream via o
conjunto de plugins acima — overlays `--patch` e injeções de slot. Veja
[ARCHITECTURE.md §2](docs/ARCHITECTURE.md) para detalhes de implementação.

## Compilação e distribuição

```sh
npm run dist:win     # instalador NSIS (x64 + arm64)
npm run dist:mac     # dmg + zip (x64 + arm64; notarização via variáveis de ambiente)
npm run dist:linux   # AppImage + deb (x64 + arm64)
```

Ícone do aplicativo: `resources/icon.png` é atualmente um ícone de marca
placeholder — substitua-o pelo ícone final antes do lançamento;
`npm run icon:gen` gera o placeholder e `npm run icon:build` deriva PNGs
multi-tamanho + ICO a partir dele (requer Pillow).

O artefato do runtime do kernel é compilado por `scripts/build-runtime.mjs`
(um por plataforma/arquitetura); o CI os publica nos GitHub Releases:

```sh
node scripts/build-runtime.mjs win32 x64 0.1.0-rc.8
```

