# CONTEXT — Vocabulário compartilhado do sidebar-dock

> Documento vivo de entrevistas de requisitos (processo requirements-interview,
> convergência em duas rodadas em 2026-08-22).
> Marcadores de estado: ✅ confirmado / 🟡 hipótese de trabalho (a confirmar) / ❓ em aberto

## Glossário (Glossary)

| Termo | Definição (perspectiva do usuário) | Estado |
|---|---|---|
| **Sidebar Dock** | Contêiner de painel expansível/recolhível à direita da página de sessão, que abriga várias páginas da barra lateral | ✅ |
| **Página da barra lateral** (Sidebar Page / Tab) | Área de conteúdo em formato de aba dentro do dock | ✅ |
| **Trilho de alternância** (Dock Toggle Rail) | Coluna vertical de ícones no canto superior direito, logo abaixo dos controles nativos da janela; cada ícone expande/recolhe sua página, no estilo da barra de atividades do VSCode | ✅ (proposta da rodada 1: abaixo do botão de fechar da barra de título) |
| **Páginas incorporadas** (Built-in Pages) | Árvore/visualização de arquivos, edição, terminal, Git e tarefas de subagentes. **A conversa lateral foi removida** (rodada 2, “não é necessária”); navegador incorporado é candidato futuro | ✅ |
| **Registro de terceiros** (Third-party Registration) | Outros plugins dsh registram páginas da barra lateral e visualizadores de arquivos pelo serviço `ctx.dshAppSidebar` (`registerTab` / `registerFileViewer`) | ✅ (forma inspirada em solução open source semelhante) |
| **Árvore / visualização / edição de arquivos** | Navegar pelo workspace → visualizar somente leitura (destaque/imagem/MD) → salvar alterações, em três níveis progressivos | ✅ |
| **Barreira de confiança** (Trust Fence) | Barreira de confiança do navegador na rota host (validação de loopback no cabeçalho Host) + restrição de caminhos do workspace para gravação | 🟡 (nome herdado da referência, confirmar durante a implementação) |
| **Plugin de duas faces** (Dual-face Plugin) | Plugin dsh em um único pacote com lado host (Node: fs/pty/git) e lado client (React UI), seguindo padrão semelhante já validado | ✅ |

## Mapeamento de nomes (Naming)

| Termo do produto | Nome no código | Estado |
|---|---|---|
| Plugin do sidebar dock | `@dsh-app/plugin-sidebar` (`plugins/plugin-sidebar/`) | 🟡 |
| Serviço de registro de terceiros | `ctx.dshAppSidebar` (`registerTab` / `registerFileViewer`) | 🟡 |
| Prefixo de rota das capacidades host | `/plugins/@dsh-app/plugin-sidebar/*` (fenced) | 🟡 |
| Prefixo das classes de UI do painel | `dshAsb-` | 🟡 |
| Diretório da documentação de requisitos | `docs/sidebar-dock/` | ✅ |

## Decisões a preservar (ADR)

### ADR-1: registro de terceiros = serviço ctx próprio (não slot oficial nem protocolo independente)
- Preocupação do usuário: evitar poluir o dsh oficial.
- Decisão: o protocolo de registro é um **serviço exposto pelo nosso próprio plugin** (`ctx.dshAppSidebar`); a tabela de slots oficial não é alterada. Reutilizamos as dependências e o ciclo de vida dos serviços cordis, sem criar um protocolo de registro próprio. A forma segue o padrão de serviço ctx de uma solução semelhante, cuja escala do ecossistema já foi validada.
- ✅ Estabelecido junto com a decisão de desenvolver internamente na rodada 2.

### ADR-2: desenvolvimento interno, sem integrar solução open source semelhante
- Decisão do usuário: este plugin “tem muitos bugs”; não encapsular nem distribuir diretamente, usando-o apenas como referência arquitetural (MIT).
- Consequência: o caminho de construção própria das capacidades host (fs/pty/git + rotas fenced) foi validado pela existência do projeto e é viável; o terminal foi antecipado de “posterior” para a investigação de riscos em M2.
- ❓ Pendente: o usuário deve fornecer a lista de bugs para convertê-la em regressões de aceitação (SPEC, questão aberta #1).

### ADR-3: plugin de duas faces host+client, sem passar capacidades pela wire API do kernel
- A wire API do kernel não oferece terminal/Git/gravação de arquivos; o lado host expõe diretamente as capacidades Node (node-pty / spawn git / fs) por rotas fenced autorregistradas.
- Não fazer fork do kernel nem contornar seu modelo de segurança (usar uma trust-fence própria, equivalente à barreira do gateway dsh).

## Progresso das entrevistas (convergido)

- **Rodada 1 (2026-08-22)**: MVP = dock + árvore/visualização de arquivos primeiro; alternância = abaixo do botão de fechar da barra de título; esclarecimento da extensão de terceiros (preocupação do usuário com “poluir o oficial”).
- **Rodada 2 (2026-08-22)**: o usuário apresentou uma solução open source semelhante → três perguntas, três respostas: **desenvolvimento interno** (muitos bugs na referência, não integrar); **remover conversa lateral**; descartar estratégia de versões. Estado final: plugin próprio de duas faces + 5 páginas incorporadas + registro via serviço ctx + alternância na coluna de ícones.
- Entregas: SPEC.md / PRD.md / PLAN.md (neste diretório). Pendências: lista de bugs do usuário; investigar o ponto de montagem de conversation antes de M1.
