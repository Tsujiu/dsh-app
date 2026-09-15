# Ferramentas do processo de desenvolvimento (barreira de CI / probes de smoke / alinhamento de versões / testes / painel de canais)

> Objetivo: tornar o nosso próprio desenvolvimento mais rápido e estável. A prioridade recomendada é **anterior à implementação das funcionalidades P0-P3**: o probe de smoke do conjunto será o meio de verificação em runtime de cada novo plugin (mcp/hooks/…).

## 1. Barreira de CI para PR (`ci.yml`)

Situação atual: `.github/workflows/` contém apenas release.yml, e `on` dispara somente por tag push / workflow_dispatch; typecheck, tsc dos 8 plugins e testes de memory/swarm normalmente são executados manualmente (L1).

**Plano**: disparar em push + pull_request, com um único job ubuntu:
```sh
npm ci
npm run typecheck
node plugins/plugin-<name>/build.mjs   # loop de 8 plugins (brand usa tsc build)
(cd plugins/plugin-memory && npm test)
(cd plugins/plugin-swarm && npm test)
```
Um job Windows pode ser adicionado depois (expandir quando o código do conjunto tiver ramificações por plataforma). Tempo estimado <10 min.
**Aceitação**: status vermelho/verde disponível no PR; push para main também dispara.

## 2. Probe de smoke do conjunto (corrige o problema antigo "compile-green ≠ runtime-green")

Contexto: depois que alpha.4 removeu `Session.events`, typecheck/test do conjunto ficaram verdes, mas o runtime permaneceu silenciosamente quebrado por dias (lição explícita em AGENTS.md §6). Drift de API na linha rc é normal; cada bump do kernel hoje ocorre sem proteção.

**Plano**: `scripts/smoke-suite.mjs` (executável nos modos dev/prod):
1. Iniciar `dsh web` no modo dev (ou iniciar um processo com o bundled kernel) e montar o overlay completo;
2. Depois de passar na verificação de saúde, chamar as API routes de cada plugin e afirmar 200 + campos principais (usage/status, archives/list, memory/status, swarm/status, mcp/status…);
3. Afirmar a superfície montada: nenhum error relacionado ao conjunto nos logs do loader; `/plugins/.../client.js` pode ser obtido (integridade do bundle client);
4. Consolidar o código de saída para uso pelo CI e pelo `npm run verify` local (novo script no package.json).

Integração: adicionar um job ao ci.yml (kernel real iniciado no ubuntu); adicionar a etapa "executar smoke-suite" ao SOP de bump do kernel (AGENTS.md §4 step 4).

**Aceitação**: apontar manualmente uma linha para um plugin inexistente em patch.yml → probe vermelho; conjunto normal → verde. Fazer um ensaio de regressão para o bump rc.1→nova versão.

## 3. Script de alinhamento da versão do kernel (elimina etapas manuais sujeitas a erros)

Situação atual: um bump do kernel exige editar manualmente o `package.json` raiz + os
`@deepseek-ai/*` devDeps dos 8 `plugins/*/package.json` para a mesma versão
(AGENTS.md §4 step 2); esquecer um deles cria uma instância duplicada de
dsh-llm e faz o typecheck falhar.

**Solução**: `scripts/bump-kernel-deps.mjs <version|--dist-tag <tag>>`:
- analisar o dist-tag (reutilizando as regras de `sources/registry.ts`);
- editar a raiz e percorrer os package.json dos plugins, reescrevendo de forma uniforme os devDeps que correspondem a `@deepseek-ai/*`;
- imprimir um resumo do diff; não alterar o lockfile (avisar para executar depois `npm install` / `--legacy-peer-deps` dentro do plugin, seguindo as duas disciplinas de instalação diferentes da §4).
**Aceitação**: a versão-alvo produzida pelo dry-run na árvore atual coincide com o cálculo manual.

## 4. Primeiros testes unitários do shell/kernel (node:test, no mesmo estilo dos plugins)

Escopo (prioridade para lógica pura, sem tocar no Electron):
- `src/kernel/manifest.ts`: escrita atômica de current.json (tmp+rename), tolerância a arquivos corrompidos;
- `src/kernel/sources/registry.ts`: análise de dist-tag, fallback da cadeia de registries e regra de acompanhar a versão mais alta de prerelease;
- funções de decisão extraíveis de `src/kernel/manager.ts`: sugestão de atualização (comparação de versões + presença do artifact), condição de rollback (duas falhas de saúde → um rollback);
- regras de redact dos logs e análise de settled-URL em `src/main/server.ts`.

**Aceitação**: `npm run test` (adicionado ao package.json raiz) totalmente verde; integrado à barreira do CI.
Estimativa: cobrir mais de 60% das linhas da superfície de decisão do kernel, sem mocks de Electron.

## 5. Painel dos canais do kernel (ferramenta pequena)

Situação atual: o dist-tag do npm fica disponível primeiro, e os artifacts de `runtime-<v>` ficam completos depois (janela de diferença da §4); durante essa janela, a verificação informa "o pacote de instalação ainda não foi publicado", o que quase foi diagnosticado incorretamente como problema de rede do usuário (gotcha da §4 do AGENTS.md).

**Solução**: `scripts/probe-channel.mjs`: obter a tabela completa de dist-tags → para cada versão mais nova que a active, verificar se os assets das 6 cells da release `runtime-<v>` estão completos (`gh api` / GitHub API) → emitir uma matriz (versão × cell × pronta). Executar periodicamente no CI (ou manualmente) e acompanhar a completude após uma publicação.
**Aceitação**: produzir uma matriz totalmente verde para rc.1; encontrar intencionalmente uma release histórica com uma cell ausente e validar o alerta.

## Ordem de implementação

1 (ci.yml, estático) → 2 (probe de smoke, maior valor) → 4 (testes unitários) → 3 (script de alinhamento) → 5 (painel).
Depois que o item 2 estiver concluído, os critérios de aceitação de todos os novos plugins do capability-roadmap poderão usá-lo para regressão.
