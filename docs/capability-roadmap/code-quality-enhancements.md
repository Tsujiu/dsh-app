# Aprimoramentos de qualidade de código (hooks de aceitação / ponte de revisão / mapeamento de checkpoints)

> Três linhas de qualidade independentes, que podem ser planejadas separadamente. Princípio comum: **a qualidade é recuperada por mecanismos determinísticos, não pela autodisciplina do modelo.** Revisado em 2026-09-07: fundamentos acadêmicos adicionados e a camada de "autoverificação do modelo" removida.

## 0. Fundamentação teórica: por que fazer apenas feedback externo (pesquisa acadêmica de 2026-09-07)

- Self-Refine (Madaan et al., NeurIPS 2023): o mesmo modelo atua como generator + feedback + refiner, com média de +20% em 7 tarefas. Parece evidência de que "verificar a si mesmo" funciona.
- Huang et al. "Large Language Models Cannot Self-Correct Reasoning Yet"
  (Google DeepMind, ICLR 2024): sem os rótulos oracle, **a autocorreção intrínseca reduziu o desempenho de todos os modelos
  em todos os benchmarks de raciocínio** (GPT-3.5 caiu de 75,9% para 74,7% no GSM8K; Llama-2 despencou de 62%
  para 36,5%). O modelo transformou respostas corretas em incorretas (8,8%) mais vezes do que o contrário (7,6%).
  O "ganho" dos artigos anteriores veio de feedback oracle, prompts iniciais deliberadamente fracos e benefício de múltiplas amostras.
- A survey da TACL de 2024 (Kamoi et al.) conclui que o gargalo está na geração de feedback: "no prior work
  shows successful self-correction with feedback from prompted LLMs in general
  tasks"; **a autocorreção só funciona com feedback externo confiável**.
- OpenAI scaling-code-verification (2025-12): priorizar a relação sinal-ruído em produção — "A system
  that is slow, noisy, or cumbersome will be bypassed"。

Conclusão: **não fazer "enviar follow-up para o modelo conferir os requisitos" (intrinsic)** — isso foi refutado e pode transformar o correto em incorreto. **Fazer apenas "devolver erros do compilador ao modelo para correção" (feedback externo)** — erros de typecheck são determinísticos e independem do julgamento do modelo; ele só precisa corrigir conforme o erro.

## 1. Hooks de aceitação (ciclo de feedback de qualidade) [investimento encerrado, conclusão de 2026-09-07]

**Conclusão da validação**: o MVP de plugin-verify foi implementado e validado (devolução após turn/end quiet + comparação com baseline + proteção contra loop, 11/11 testes), mas **uma única barreira tsc tem cobertura estreita** (somente TS; JS seria barato, mas Python/Go/C++/C# exigem detecção de ambiente), portanto o retorno em workspaces multilíngues é insuficiente; o investimento foi encerrado e o código removido (nunca commitado).

**Substituto equivalente (mais adequado)**: o Hook nativo do DSH de P1 já suporta post-tool-use / session-start; o usuário pode configurar regras de aceitação por turn para seu projeto (por exemplo, executar ruff após escrever `.py`), mantendo a escolha da linguagem com o usuário. Depois que o kernel dsh adicionar eventos de hook por turn, basta acrescentar um tipo `on` ao formato nativo.

**Problema**: o agent afirmar que terminou não significa que o projeto compila ou passa nos testes. Testes verdes não significam requisitos atendidos (disciplina de AGENTS.md do usuário), mas atualmente essa verificação depende inteiramente do usuário.

**Solução**: após o debounce do fim do turn, o plugin do conjunto executa comandos de aceitação no **workspace da sessão**, devolvendo o **texto original do compilador** (feedback externo) em uma mensagem follow-up para o **mesmo modelo** corrigir:
- Sequência padrão de aceitação (configurável por projeto em `dsh-app-plugin-verify/config.json`):
  1. `typecheck` (detecta `npm run typecheck` por padrão; o comando pode ser substituído);
  2. opcional: comando `test` (desligado por padrão para evitar acionar suítes grandes por engano).
- A execução usa `execFile` no host com array de argumentos + cerca de caminho do workspace (baseline de segurança das git-routes de plugin-sidebar); há limite de tempo e truncamento da saída (mantém a parte final legível pelo modelo).
- Regra de devolução: **relatar apenas erros novos** (comparação com baseline; não relatar o que já estava quebrado, evitando ruído); sucesso é **silencioso**; após N falhas consecutivas, parar a devolução e avisar o usuário (evita loops consumindo tokens).
- Relação com Hooks: Hooks são a barreira fornecida pelo usuário (P1, tipo interceptação); este item é a
  rede de aceitação padrão integrada ao produto (tipo verificação posterior), disponível sem configuração. Podem coexistir por longo prazo.

**MVP**: somente typecheck, um workspace, comparação com baseline, devolução de falhas + proteção contra loops. **V2**: sequência personalizada por projeto, comando de testes e cartão de relatório (exibe os resultados recentes na página de configurações).
**Aceitação**: quebrar tipos intencionalmente → a sessão recebe automaticamente um resumo da falha de typecheck → depois que o modelo corrige, não há novas interrupções; workspaces sem package.json são ignorados silenciosamente; projetos que já estavam vermelhos não são bombardeados.

## 2. Ponte de revisão (alterações → sessão de revisão) [não implementada]

(Texto original preservado, consulte o histórico do git. Objetivo: revisão em um clique das alterações locais, complementar aos hooks de aceitação: hooks capturam compilação, revisão captura lógica. Porém, a conclusão dos artigos deve ser observada: o feedback do revisor também é um julgamento intrínseco, com alta taxa de falsos positivos; por isso, deve ser "acionado manualmente", e não uma barreira automática.)

## 3. Mapeamento de checkpoints (trajetória da sessão ↔ snapshot Git) [não implementado]

(Texto original preservado, consulte o histórico do git. O painel Git marca "este commit foi criado pela sessão X"; um rewind real não será implementado.)

## Prioridade

Hooks de aceitação > ponte de revisão > mapeamento de checkpoints. Hooks de aceitação são independentes de P0-P3 e podem vir primeiro (sem dependência do kernel), atendendo diretamente ao objetivo do usuário de "qualidade de código".
