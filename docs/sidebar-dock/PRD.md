# PRD — Sidebar dock (sidebar-dock)

> Estado: rascunho final após a rodada 2 de entrevistas (2026-08-22). Consulte SPEC.md no mesmo diretório para o escopo.

## 1. Valor para o usuário

Durante o processo de “escrever código em colaboração com o modelo”, os usuários do DSH APP repetidamente sentem falta de três coisas: **visibilidade** (como são os arquivos do projeto e o que mudou), **acesso rápido** (alterar uma linha ou executar um comando) e **acompanhamento** (o que os subagentes estão fazendo e as mudanças do Git). Este recurso coloca as três em um painel recolhível à direita da página de sessão, evitando alternâncias entre o DSH APP e um IDE/terminal.

## 2. Usuários e cenários-alvo

- Usuários principais: engenheiros que usam o DSH APP no desenvolvimento diário, sobretudo em projetos existentes.
- Cenários principais:
  1. O modelo menciona um arquivo durante a sessão → abri-lo diretamente na barra lateral para consultar/comparar;
  2. Uma pequena alteração não justifica trocar de IDE → editar e salvar na barra lateral;
  3. Validar o resultado do modelo → executar um comando no terminal da barra lateral;
  4. Várias tarefas em paralelo → consultar topologia e saída na página de subagentes e alterações pendentes na página Git.

## 3. Lista de requisitos e prioridades

| Prioridade | Requisito | Entrega |
|---|---|---|
| **P0** | Sidebar dock (painel + alternância na coluna de ícones + persistência isolada por sessão) | M1 |
| **P0** | Árvore de arquivos + visualização (destaque de texto/imagem/Markdown) | M1 |
| **P1** | Serviço de registro de terceiros (`registerTab` / `registerFileViewer`) | M1 (superfície mínima entregue com o dock) |
| **P1** | Terminal real (node-pty + xterm.js, reprodução após desconexão) | M2 |
| **P2** | Edição e salvamento de arquivos (barreira de confiança para gravação) | M3 |
| **P2** | Painel Git (status/diff/stage/commit/revert) | M4 |
| **P2** | Página de subagentes/tarefas em segundo plano | M5 |
| Não fazer | Conversa lateral (decisão do usuário: não é necessária, 2026-08-22) | — |
| Futuro | Página de navegador incorporado | A avaliar |

> Base da prioridade: consenso do MVP na rodada 1 (dock + árvore/visualização primeiro); o terminal foi antecipado para P1/M2 porque o caminho da capacidade host (node-pty no CI) é o maior risco e deve ser investigado cedo (correção da rodada 2; a avaliação original de “deixar a lacuna para depois” não se aplica ao caminho do plugin de duas faces host).

## 4. Indicadores de sucesso

- **Utilizável**: toda a lista de aceitação da SPEC aprovada (probe cobrindo o fluxo principal);
- **Estável**: comparar com a solução de referência (avaliada pelo usuário como tendo “muitos bugs”), evitar cada problema conhecido durante a implementação e não repetir problemas equivalentes após a entrega;
- **Leve**: custo zero de inicialização com o plugin desabilitado; incremento de inicialização ≤ ~350KB quando habilitado (chunks pesados carregados sob demanda);
- **Aberto**: documentação mínima utilizável do serviço de registro de terceiros + um exemplo de registro para autoteste (incluído no probe).

## 5. Requisitos de experiência do usuário

- Coluna de ícones: canto superior direito da janela, logo abaixo dos controles nativos, em disposição vertical; o foco do mouse mostra o nome da página; o estado ativo fica destacado;
- Painel: largura padrão de ~320px, redimensionável; conteúdo isolado ao trocar de sessão; estado persistido por sessão;
- Erros: terminal indisponível (sem shell), Git indisponível (fora de um repositório/sem git) e arquivo ilegível (permissão) devem exibir avisos claros em português, sem tela em branco;
- Teclado: botões da coluna podem receber foco por Tab e expandir com Enter; Escape recolhe o painel sem roubar o foco do campo de entrada.

## 6. Fora dos objetivos

- Não fazer editor no nível do VS Code (LSP, múltiplos cursores, refatoração no nível do workspace);
- Não fazer conversa lateral nem navegador incorporado nesta versão;
- Não modificar o kernel dsh nem contornar seu modelo de segurança (as rotas host têm sua própria trust-fence).
