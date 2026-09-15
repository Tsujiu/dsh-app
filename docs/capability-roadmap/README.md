# Capability Roadmap — Roteiro de capacidades e aprimoramentos funcionais

> Pesquisa iniciada em 2026-09-06. Fonte: inventário sistemático dos domínios de
> capacidade não montados no kernel 0.1.2-rc.1 (mesma linha compatível com dsh-app)
> e comparação com produtos semelhantes. Níveis de evidência e referências estão nos documentos.
>
> Marcadores de status: 📄 planejado (este documento) / 🔍 a verificar (há etapas prévias) / 👀 em observação / ✅ concluído

## Contexto e conclusão

Em `packages/` do kernel há vários domínios **completamente implementados, mas não montados ou desativados por padrão pela camada de composição do `dsh web`**.
O pacote CLI publicado do `dsh` (dependencies de `apps/cli/package.json`) já contém
`dsh-mcp-client`、`dsh-schedule`、`dsh-hooks-claude-code`、`dsh-hooks-codex`、
`dsh-webhook(-github)` — portanto esses pacotes já estão no `node_modules` plano do tarball de runtime;
basta montá-los pelo nome no overlay, **sem alterar o kernel nem adicionar dependências npm**.

Já montados por padrão (não recriar): plan mode, goal, todo, compaction, skills, jobs,
workflow/ralph, subagent(spawn/fork), pesquisa web, aprovações, predefinições de permissões, trajetória, `/export`.

## Índice e prioridade dos documentos

| Prioridade | Documento | Tema | Status |
|---|---|---|---|
| P0 | [mcp-manager.md](mcp-manager.md) | Gerenciamento de servidores MCP (configuração por UI + montagem dinâmica) | ✅ implementado (main ainda não recebeu push) |
| P1 | [hooks-bridge.md](hooks-bridge.md) | Ponte de Hooks + regras nativas do DSH | ✅ implementado (main ainda não recebeu push; usuário testou a interceptação) |
| P2 | [session-search.md](session-search.md) | Pesquisa de texto completo em sessões (backend sqlite + UI) | ✅ implementado (main ainda não recebeu push; ferramenta do agent adiada, veja a seção suspensa) |
| P3 | [schedule-reminders.md](schedule-reminders.md) | Lembretes agendados dentro da sessão | ✅ implementado (main ainda não recebeu push; usuário testou a entrega; notificações do sistema V2 aguardam o desktop bridge) |
| — | [code-quality-enhancements.md](code-quality-enhancements.md) | Hooks de aceitação (MVP verificado, valor isolado insuficiente, investimento encerrado; substituto equivalente = Hook nativo configurado pelo usuário) | 📄 |
| — | [desktop-shell-experience.md](desktop-shell-experience.md) | Implementação do plugin-brand / centro de diagnóstico / conclusão da primeira inicialização | 📄 |
| — | [dev-process-tooling.md](dev-process-tooling.md) | CI de PR / probe de smoke do conjunto / script de alinhamento de versões | 🔧 barreira de CI + probe de smoke implementados; testes/alinhamento/painel pendentes |

## Seção suspensa (itens encerrados, mantidos para consulta, fora da fila)

| Prioridade original | Tema | Motivo do encerramento | Condição para reiniciar |
|---|---|---|---|
| P4 | Subagentes CLI externos (Claude Code / Codex) | Pacotes backend de provider (dsh-subagent-claude-code / -codex) não estão no closure do CLI; insistir exigiria alterar a composição do build e traria risco de tela branca | Upstream incluir os pacotes no closure de `apps/cli` |
| P5 | Ferramentas de inteligência de código LSP | dsh-lsp / -stdio / tool-lsp não estão no closure do CLI, mesmo motivo | Igual ao anterior |
| P6 | Agent Teams | Experimental no upstream, ainda instável | Upstream estabilizar |
| Subitem P2 | Ferramenta `session_search` no agent | dsh-tool-session-query não está no closure do CLI; um insert já fez toda a árvore falhar com tela branca (incidente de 2026-09-07) | Igual ao anterior |

## Dependências

```
desktop-shell-experience (plugin-brand: app-info + desktop bridge) ←── notificações do sistema de schedule-reminders
                                                                 ←── centro de diagnóstico
 mcp-manager (P0) ── estabelece o padrão de "montagem dinâmica de pacotes opcionais do kernel por plugins do conjunto"
                 ── hooks-bridge / lsp-tools reutilizam diretamente este padrão
 probe de smoke do conjunto de dev-process-tooling ── recomendado antes de P0-P3 (caso contrário plugins novos não terão verificação em runtime)
```

## Padrão comum de implementação (compartilhado por P0–P2; após MCP, é trabalho de linha de produção)

1. **Montagem**: adicionar uma linha `insert` a `plugins/dsh-app.patch.yml` (o shell copia o overlay a cada inicialização do server, em `brand-suite.ts`). Os pacotes opcionais do kernel são publicados com o dsh; basta referenciá-los pelo nome.
2. **Configuração do usuário**: seguir a convenção existente do conjunto — `$DSH_HOME/storages/dsh-app-plugin-<name>/config.json`, lido na inicialização do plugin e editável na página de configurações; o overlay é estático e alterações manuais não persistem, portanto todo estado editável pelo usuário fica no arquivo de storage (como em plugin-swarm / plugin-usage / plugin-memory).
3. **UI**: o lado client usa `ctx.slots.inject('settings.section', ...)` (consulte
   `plugins/plugin-client-ui/src/client.ts:188`); distribuir order evitando o upstream
   (11=configurações avançadas de modelos ocupado, 15=Plugins, 20=agent-presets):
   **12=MCP, 13=Hooks, 14=Diagnóstico**.
4. **Host routes**: `/plugins/@dsh-app/plugin-<name>/api/*`, todos protegidos pelo Host fence (validação de loopback, consulte `plugins/plugin-sidebar/src/trust-fence.ts`).
5. **Degradação**: se o kernel não tiver o serviço correspondente, montar apenas a rota de status; o boot não é afetado (disciplina de estabilidade existente do conjunto).

## Fora do escopo (não fazer nesta etapa)

- Ponte de MCP resources/prompts (upstream declara explicitamente Only tools are bridged).
- Empacotamento de recursos já montados por padrão no upstream (veja acima).
- agent-team / acp / e2b / webhook (veja a tabela).
