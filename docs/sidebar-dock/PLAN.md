# PLAN — Sidebar dock (sidebar-dock)

> Estado: rascunho final após a rodada 2 de entrevistas (2026-08-22). Consulte a SPEC para o escopo e o PRD para valor e prioridades.

## 0. Linha de base arquitetural (compartilhada por todas as fases)

- Novo plugin `@dsh-app/plugin-sidebar`: **pacote único de duas faces host+client** (`dsh.plugin.json`: host main + client main), conectado por symlink do brand-suite (mesmo padrão de plugin-brand/plugin-client-ui) e empacotado no runtime com o suite.
- Lado host: rotas HTTP fenced autorregistradas (prefixo `/plugins/@dsh-app/plugin-sidebar/...`, reproduzindo a trust-fence do gateway dsh com validação de loopback no cabeçalho Host) expõem capacidades fs / pty / git.
- Lado client: montagem de slot/serviço cordis + UI React; serviço de registro `ctx.dshAppSidebar` (`registerTab` / `registerFileViewer`).
- A pipeline de verificação segue [[plugin-client-ui-verify-pipeline]]: `tsc --noEmit && esbuild → implantação sobre o kernel instalado → electron probe`.

## Plano por fases

### M1 — Dock + árvore/visualização + superfície mínima do serviço de registro (P0/P1)
| Item | Conteúdo |
|---|---|
| host | Rota fs: árvore de diretórios (fragmentos carregados sob demanda), leitura de arquivos (limite de tamanho + detecção binária); trust-fence |
| client | Contêiner do dock (painel direito + coluna de ícones + redimensionamento + persistência isolada por sessão); página da árvore; visualizadores de texto (destaque)/imagem/Markdown; superfície mínima de `registerTab`/`registerFileViewer` |
| Investigação prévia | Estrutura do pacote conversation e slots (escolher o ponto de montagem do painel principal: slot oficial primeiro, âncora DOM estável como alternativa) |
| Aceitação | Quatro grupos de asserções da SPEC §4 para dock/árvore/visualização/registro de terceiros + probe |
| Estimativa | 3–5 dias úteis |

### M2 — Terminal (P1, investigação de risco da capacidade host)
- host: gerenciamento de sessões node-pty (isoladas por sessão, buffer de reprodução após desconexão); **incluir compilação nativa de node-pty no CI do runtime** (matriz de dependências de build-runtime.mjs, seis plataformas);
- client: chunk xterm.js carregado sob demanda; página do terminal (conectar/desconectar/reconectar).
- Aceitação: três asserções de terminal da SPEC; artefatos de build das seis plataformas no CI.
- Estimativa: 3–4 dias úteis (incluindo depuração do CI).

### M3 — Edição e salvamento de arquivos (P2)
- Escolher o editor (preferência por CodeMirror 6: pequeno, pacotes de sintaxe sob demanda); salvar pela rota de escrita fs do host (barreira de confiança: gravável somente dentro do workspace da sessão);
- Aviso de estado dirty, Ctrl+S e conflito de salvamento (validação de mtime).
- Estimativa: 2–3 dias úteis.

### M4 — Painel Git (P2)
- host: executar `git` a cada solicitação (status/diff/log/stage/commit/revert, sem repositório e sem estado, seguindo o padrão de referência); aviso degradado quando git não estiver disponível.
- client: lista de status + visualização de diff + ações.
- Estimativa: 2–3 dias úteis.

### M5 — Página de subagentes/tarefas em segundo plano (P2)
- Somente client (wire API `subagents` existente + fluxo de eventos), sem alterações no host.
- Estimativa: 1–2 dias úteis.

## Dependências e ordem

M1 → (M2 ∥ M3 podem ocorrer em paralelo, mas recomenda-se investigar M2 primeiro) → M4 → M5. O design da API do dock em M1 deve reservar todas as formas de página de M2–M5 (ícone/título da aba e protocolo de painel carregado sob demanda), evitando retrabalho; usar as sete capacidades da SPEC §2 como teste de estresse do design.

## Lista de riscos

| Risco | Nível | Mitigação |
|---|---|---|
| Build de node-pty no CI para seis plataformas (muitos problemas históricos: ABI do electron / prebuilt ausente) | Alto | Investigação independente em M2; começar apenas com win/mac/linux x64 e acrescentar arm64 conforme os prebuilt upstream |
| Ponto de montagem frágil na página de sessão (mudanças no DOM após atualização do kernel) | Médio | Priorizar slot oficial; concentrar a âncora DOM em um módulo + asserção no probe |
| Atualização do kernel dsh quebra o registro de rotas fenced | Médio | Seguir a abordagem de matriz de versões suportadas da solução semelhante; fixar versão do suite + probe de atualização |
| Chunk pesado prejudica a primeira tela | Médio | Carregamento sob demanda + incluir o incremento de inicialização nos indicadores de aceitação |
| Barreira de segurança da gravação de arquivos (escape de caminho) | Alto | Rota de escrita permite somente caminhos dentro do workspace da sessão (validação de prefixo após resolve); probe inclui caso de escape |

## Estratégia de testes

- Cada fase: `tsc --noEmit` + esbuild + electron probe (renderização/interação/gravação real em disco seguida de restauração);
- Rotas host: casos positivos e negativos da trust-fence (loopback aceita / não loopback recusa); casos de escape de caminho;
- Semântica de desinstalação: nenhum DOM/rota residual após desabilitar o plugin (asserção no probe);
- Regressão dos problemas da referência: converter a lista de bugs do usuário em asserções quando fornecida (SPEC, questão aberta #1).
