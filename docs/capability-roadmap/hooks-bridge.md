# Ponte de Hooks (P1)

> Objetivo: fazer com que o `hooks.json` existente do Claude Code / Codex funcione diretamente no DSH APP: executar hooks shell do usuário na inicialização da sessão, envio de prompt, antes/depois de chamadas de ferramentas e fim da execução; interceptar prompts/chamadas de ferramentas e injetar contexto. É um canal de "regras obrigatórias" sem custo de contexto.

## 1. Contexto e valor

- O conjunto de hooks do kernel (`packages/hooks/`) fornece o engine `hook-protocol` + duas pontes de dialeto:
  `dsh-hooks-claude-code` e `dsh-hooks-codex`. **Ambos os pacotes estão nas dependências do CLI `dsh` publicado**
  (`apps/cli/package.json`) e estão disponíveis em runtime.
- Referência: o Claude Code recomenda oficialmente "use hooks para regras que devem ocorrer sempre (o modelo não pode contorná-las) e skills para conhecimento contextual". Hooks não consomem contexto do modelo (análise arXiv 2026).
- Alavanca de qualidade: interceptação PreToolUse (como "proibir alterações em `src/generated/**`" ou "exigir lint antes do commit") é uma barreira determinística, muito mais confiável que convenções em prompts.

## 2. Contrato do kernel (L1, `packages/hooks/hooks-claude-code/README.md`)

Montagem de uma linha apontando para o arquivo de configuração existente:

```yaml
- name: '@deepseek-ai/dsh-hooks-claude-code'
  config:
    configPath: ./.claude/hooks.json   # obrigatório; hooks.json ou arquivo de settings com a chave hooks
    pluginRoot: ./.claude/plugins/my-plugin   # opcional; substitui ${CLAUDE_PLUGIN_ROOT}
    projectDir: .                       # workspace padrão da sessão; substitui ${CLAUDE_PROJECT_DIR}
    defaultTimeoutMs: 600000
    stderrSummaryMaxChars: 500
```

- Abrange o subconjunto documentado de command-hook do Claude Code; `SessionStart` / envio de prompt /
  em eventos como PreToolUse / PostToolUse / Stop; pode bloquear (retornando uma mensagem visível ao modelo), adicionar contexto e forçar a continuação.
- A ponte codex tem o mesmo formato (`configPath` aponta para a configuração de hooks do Codex).
- Atenção às permissões: hooks = execução shell, e o arquivo de configuração tem o mesmo nível de confiança do acesso shell (palavras do upstream); a UI deve deixar isso explícito.

## 3. Design da solução

### 3.1 Montagem (fina)

Adicionar o plugin dual `@dsh-app/plugin-hooks` (mesmo padrão de mcp-manager):

- Configuração: `$DSH_HOME/storages/dsh-app-plugin-hooks/config.json`:
  ```json
  { "enabled": true, "bridges": [
      { "dialect": "claude-code", "enabled": true, "configPath": "D:/proj/.claude/hooks.json" }
  ] }
  ```
- na inicialização, o host faz a montagem dinâmica de cada bridge habilitada seguindo o padrão da §mcp-manager (ou usa a combinação via overlay como alternativa).
  `configPath` aceita caminhos absolutos e expansão de `~`; **o conteúdo do arquivo não é validado** (o dialeto é analisado pelo upstream; em caso de falha, degrada para log + estado da UI "falha ao carregar").

### 3.2 Seção da página de configurações (order 13, "Hooks")

MVP:
- controles: chave geral + chave individual por bridge;
- lista de bridges: dialeto, configPath, estado de habilitação e resultado do carregamento;
- assistente de adição: escolher o dialeto → informar o caminho (sugestão padrão `~/.claude/hooks.json`) → salvar;
- texto de segurança (hooks = execução de comandos na máquina local; o que vier do arquivo será executado).

V2:
- fluxo de logs de execução dos hooks (o upstream persiste um resumo de stderr de `hook/result`; depois de confirmar a superfície de eventos, criar uma lista das execuções recentes:
  horário/nome do hook/resultado/motivo do bloqueio);
- criar um modelo de hooks.json (exemplo de interceptação PreToolUse: proteger caminhos / barreira de lint).

## 4. MVP / V2 / aceitação

**MVP**: uma bridge (dialeto claude-code) + chave geral + configuração de caminho + aplicação após reiniciar + exibição de estado.
**V2**: dialeto codex, múltiplas bridges, logs de execução e modelos.
**Aceitação**:
1. Montar um hooks.json com bloqueio PreToolUse (interceptando a escrita em um caminho); a tentativa de escrita do agent é recusada e o modelo recebe a mensagem do hook;
2. configPath inexistente: o harness inicia normalmente, a UI exibe "falha ao carregar" e não ocorre crash;
3. Reiniciar com a chave geral desligada: nenhum hook é executado;
4. Degradação: o boot não é afetado quando o kernel não tem o pacote de hooks.

Risco: a semântica per-session do engine de hooks em múltiplas sessões web (superfície de disparo de SessionStart) precisa ser confirmada pelo probe V1, em conjunto com a validação V1 do mcp-manager.
