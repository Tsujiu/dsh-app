# SPEC — Sidebar dock (sidebar-dock)

> Estado: final (2026-08-22, convergência de duas rodadas de entrevistas + conversão da lista de problemas da referência). Consulte o CONTEXT.md no mesmo diretório para os termos.
> Contexto: uma solução open source semelhante tem sobreposição funcional, mas muitos bugs na prática; **a decisão é desenvolver internamente**, usando somente seus padrões arquiteturais validados como referência (cópia local de referência sob licença MIT).

## 1. Definição do problema

Os usuários do DSH APP (cliente desktop dsh) precisam, durante a sessão, de uma superfície auxiliar no estilo IDE: navegar e visualizar arquivos do projeto, editar arquivos, usar um terminal, consultar o status do Git e acompanhar tarefas de subagentes. A Web UI oficial do dsh não oferece essas capacidades; as soluções de terceiros existentes não atendem ao padrão de qualidade da marca.

## 2. Escopo

### In (páginas incorporadas e dock)
| # | Capacidade | Descrição |
|---|---|---|
| 1 | **Sidebar dock** | Contêiner de painel à direita da sessão + alternância na coluna de ícones no canto superior direito (abaixo dos controles da janela, estilo da barra de atividades do VSCode); troca de páginas, expansão/recolhimento e largura redimensionável |
| 2 | **Árvore + visualização de arquivos** | Árvore do workspace da sessão atual (carregamento sob demanda); clicar em um arquivo abre seu conteúdo (texto/destaque de código/imagem/Markdown) |
| 3 | **Edição de arquivos** | Alternar da visualização para edição e salvar de volta (permissão de escrita limitada pela barreira de confiança) |
| 4 | **Terminal** | Shell real (lado host node-pty), frontend xterm.js, isolamento por sessão e reprodução após desconexão |
| 5 | **Painel Git** | status/diff/histórico/stage/commit/revert; executar `git` do sistema a cada solicitação (sem repositório e sem estado) |
| 6 | **Página de subagentes/tarefas em segundo plano** | Baseada na wire API `subagents` existente do dsh: topologia, saída em tempo real e encerramento |
| 7 | **Serviço de registro de terceiros** | Serviço `ctx.dshAppSidebar`: `registerTab` / `registerFileViewer`, para outros plugins dsh registrarem páginas e visualizadores de arquivos |

### Out (explicitamente não fazer / futuro)
- **Conversa lateral**: decisão do usuário: não é necessária (2026-08-22).
- **Página de navegador incorporado**: candidata para o futuro.
- **Fork ou modificação do kernel dsh**: linha vermelha da arquitetura (no-fork).
- Editor no nível do VS Code (LSP/múltiplos cursores etc.): edição limitada a texto básico + destaque de sintaxe.

## 3. Restrições técnicas e decisões de arquitetura

1. **Veículo**: novo plugin `@dsh-app/plugin-sidebar` (pacote único de duas faces host+client; `dsh.plugin.json` declara host main + client main), conectado por symlink do brand-suite e empacotado com o suite.
2. **Capacidades host próprias**: leitura/gravação (node fs), terminal (node-pty) e Git (spawn git) não dependem da wire API do kernel. As capacidades host são expostas por **rotas HTTP fenced** autorregistradas via `ctx.webServer.register({ kind: 'prefix', path, handler })`; a barreira reproduz a confiança do navegador do gateway dsh (validação de loopback no cabeçalho Host, evitando DNS rebinding).
3. **Build nativo de node-pty**: incluir na cadeia de build do runtime no CI (dependências de build-runtime.mjs + matriz por plataforma), sem build na máquina do usuário.
4. **UI/textos**: pt-BR; usar tokens do tema da marca (`--dsw-alias-*`), sem valores de cor codificados.
5. **Não poluir o oficial**: o registro de terceiros usa nosso próprio serviço ctx, sem alterar a tabela de slots oficial; montar na página de configurações usa `settings.section` (ponto oficial de extensão).
6. **Dependências pesadas sob demanda**: carregar chunks pesados como xterm/editor/Mermaid sob demanda, com incremento de inicialização ≤ ~350KB.
7. **Disciplina de subprocessos**: todo `spawn` (git, shell) deve usar `windowsHide: true` + ambiente controlado (consulte §4.6).

## 4. Verificações de aceitação (mensuráveis)

### 4.1 Dock
- [ ] A coluna de ícones aparece no canto superior direito da janela (logo abaixo dos controles); clicar expande/recolhe o painel direito; a largura pode ser redimensionada; o estado persiste após atualizar (isolado por sessão)
- [ ] **A expansão da barra lateral usa layout lado a lado, comprimindo a coluna principal; não pode sobrepor o conteúdo da sessão** (regressão #R1)

### 4.2 Árvore / visualização de arquivos
- [ ] A árvore de diretórios expande com carregamento sob demanda; texto/imagem/Markdown abrem no visualizador correspondente; diretórios vazios/grandes (>1000 itens) não travam
- [ ] Texto com destaque de sintaxe; imagens exibidas; Markdown renderizado (modo de segurança strict)
- [ ] **As respostas de visualização HTML/texto devem conter `charset=utf-8`; conteúdo chinês sem caracteres corrompidos** (regressão #R4)
- [ ] **Após salvar uma edição, a visualização é renderizada novamente sem fechar e reabrir** (regressão #R5)

### 4.3 Edição
- [ ] Alterações salvas de volta no disco, com diff correto; caminhos fora da barreira de confiança recusados com aviso

### 4.4 Terminal
- [ ] Shell real interativo; terminais independentes ao trocar de sessão; reprodução ao reconectar
- [ ] **PTY inicia com uma base de ambiente limpa + injeção por lista de permissões, sem contaminação do ambiente do processo host** (regressão #R3)
- [ ] **A criação do PTY não falha repetidamente com host sem console (serviço Windows)** (regressão #R7; limitações da plataforma devem ser marcadas honestamente)

### 4.5 Git / subagentes
- [ ] status/diff/stage/commit/revert totalmente disponíveis
- [ ] **Todo spawn git usa `windowsHide: true`; uso prolongado não causa cintilação de janela de console** (regressão #R6)
- [ ] Página de subagentes: topologia + saída em tempo real + encerramento

### 4.6 Comportamento e estabilidade
- [ ] **Após habilitar o plugin, resume de qualquer sessão histórica sem erros** (o lado host não pode contaminar o contexto/combinação de escopos global do cordis) (regressão #R2)
- [ ] **O acesso por 127.0.0.1 e localhost funciona (inclusive quando o navegador envia Origin sem porta), sem bloqueio indevido pela fence** (regressão #R8)
- [ ] **Todo comportamento de abertura automática fica desativado por padrão e tem uma alternância individual nas configurações; a página focalizada corresponde ao item de configuração** (regressão #R9/#R10)
- [ ] **Em dispositivos móveis/janelas estreitas (<768px), não abrir automaticamente uma gaveta que cubra o chat** (regressão #R9)
- [ ] **Todos os ícones da coluna seguem 16px, sem qualquer variação de tamanho** (regressão #R11)

### 4.7 Extensão e desinstalação
- [ ] A página registrada por um plugin simulado via `ctx.dshAppSidebar.registerTab` aparece na coluna e pode ser aberta; extensões personalizadas registradas por `registerFileViewer` abrem no visualizador correspondente
- [ ] Após desinstalar/desabilitar o plugin: nenhuma sobra de DOM ou rota na página de sessão; resume de sessões históricas normal

### 4.8 Gate de engenharia
- [ ] Probe de ponta a ponta: typecheck + esbuild + electron probe (seguindo a pipeline de verificação existente)

## 5. Lista de regressões (problemas publicados da solução semelhante, referenciados por número em §4)

| # | Problema | Nossa medida |
|---|---|---|
| R1 | Contêiner da barra lateral sobrepõe a coluna principal da sessão | Layout lado a lado (compressão flex), com asserção no probe de que a coluna principal permanece visível |
| R2 | Resume de sessão falha após a instalação (contaminação do contexto host nos escopos de outros plugins) | Nenhum efeito colateral global no lado host; probe de regressão de resume |
| R3 | Contaminação do ambiente do processo pai causa falhas nas ferramentas do terminal | Base de ambiente PTY limpa + lista de permissões explícita |
| R4 | Visualização HTML sem charset=utf-8 causa caracteres chineses corrompidos | Forçar charset em toda resposta de texto; caso com conteúdo chinês |
| R5 | Visualização Markdown não atualiza após salvar | Renderização novamente invalidada pelo evento de salvamento |
| R6 | spawn git no Windows sem windowsHide causa cintilação periódica do console | Disciplina de spawn (§3.7) + probe de longa duração |
| R7 | node-pty AttachConsole falha repetidamente em serviço Windows sem console | Sessão ConPTY explícita/caminho degradado; limitação da plataforma marcada honestamente |
| R8 | Todo acesso por 127.0.0.1 retorna 403 (fence bloqueia Origin sem porta) | Casos de fence cobrem Origin 127.0.0.1/localhost com e sem porta |
| R9 | Abertura automática ativada sem alternância; gaveta móvel cobre o chat | Comportamento automático desativado + alternância individual nas configurações + asserção para tela estreita |
| R10 | Abertura automática aciona a página errada | Asserção de que o foco corresponde à identidade do item de configuração |
| R11 | Tamanhos inconsistentes de ícones; nova visualização não entra no grupo após dividir o painel | Padronização em 16px; asserção de inclusão da visualização no grupo |
| R12 | Script de instalação falha ao analisar BOM/versão (Windows) | Não aplicável: a distribuição é integrada ao CI, sem script de instalação na máquina do usuário |

## 6. Dependências

- Referência de padrões arquiteturais: cópia local de solução open source semelhante (MIT; caminho interno da equipe); usar apenas os padrões, sem copiar código.
- Infraestrutura existente: pipeline de verificação do plugin-client-ui (build → implantação sobre o kernel → probe); symlink do brand-suite; experiência de montagem com `settings.section`.

## 7. Questões em aberto

| Questão | Responsável | Próximo passo |
|---|---|---|
| Escolha do ponto de montagem do painel principal da sessão (conversation DOM/slot) | Implementação | Reconhecimento M1 (em andamento) |
| Escolha do componente editor de arquivos (CodeMirror 6 vs Monaco) | Implementação | Decidir antes de M3 conforme o tamanho do bundle e a estratégia de carregamento sob demanda |
| Testabilidade de R7 com host sem console (máquina local fora de ambiente de serviço) | Implementação | Fornecer caminho degradado em M2 + garantia em nível de revisão de código, marcando honestamente os limites da verificação |
