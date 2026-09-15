# Lembretes agendados dentro da sessão (P3)

> Objetivo: permitir lembretes e retomadas agendadas dentro da sessão do agent; o shell desktop acrescenta as **notificações do sistema** que não existem no upstream.

## 1. Contexto e contrato do kernel (L1, `docs/user/guide/schedule.md` + exemplo de overlay)

- Lembretes persistentes por sessão: o modelo os gerencia por `schedule_create` / `schedule_list` / `schedule_delete`; há suporte a `after_seconds`, `at` absoluto (RFC 3339) e intervalo fixo `every_seconds` (≥300s). Ao vencer, uma mensagem follow-up comum é enfileirada na **mesma sessão** (entregue quando o agent estiver ocioso).
- Os registros persistem com o log da sessão: continuam válidos ao reabrir a sessão após reiniciar; não atravessam sessões e não há email/push (o upstream declara explicitamente "sem notificações externas" — espaço de diferenciação do shell desktop).
- A forma oficial de habilitar é um overlay de 3 linhas (`apps/cli/config/examples/schedule/cordis.yml`):

  ```yaml
  - insert:
      - id: time-context
        name: '@deepseek-ai/dsh-time-context'
      - id: schedule
        name: '@deepseek-ai/dsh-schedule'

  - id: ui-schedule
    disabled: false      # esta linha é disabled: true no base/web bundle; aqui ela é habilitada
  ```

Após habilitar, a web UI obtém automaticamente: um diretório de lembretes somente leitura no cabeçalho da sessão + um marcador de alarme na linha da barra lateral (a renderização já existe no upstream; não precisamos de trabalho de UI).

## 2. Design da solução

### 2.1 Montagem (copiar diretamente)

Adicionar as 3 linhas acima a `dsh-app.patch.yml`. Não há superfície de configuração do usuário (o upstream define que o modelo gerencia por ferramentas e o usuário apenas visualiza na UI); não haverá página de configurações nesta etapa.

### 2.2 Valor agregado desktop: notificação do sistema ao vencer (depende do plugin-brand desktop bridge)

- Lacuna atual: a entrega do lembrete é uma mensagem na sessão; o usuário não percebe se não estiver na página da sessão.
- Solução: o desktop bridge do plugin-brand (desktop-shell-experience.md §1) fornece `notify(title, body)`; o conjunto escuta o evento de entrega (id da sessão + resumo) → dispara uma notificação do Windows/OS; clicar na notificação → o shell focaliza a janela e abre a sessão correspondente.
- Ponto de escuta: a entrega tem um registro durable dispatch no log da sessão (documentação upstream); o plugin do conjunto pode filtrar em tempo real por `session/event` (plugin-usage já usa o mesmo padrão).
- O salto para a sessão ao clicar fica para V2 (requer um protocolo de roteamento de sessão shell ↔ web; primeiro implementar apenas a notificação).

## 3. MVP / aceitação

**MVP**: habilitar o overlay de 3 linhas + verificar a entrega dos três tipos de temporização (after/at/every) em uma sessão real.
**V2**: ponte de notificação do sistema (pré-requisito: plugin-brand desktop bridge).
**Aceitação**:
1. "Lembre-me de fazer commit em 10 minutos" → uma mensagem follow-up aparece na sessão após 10 minutos, e o diretório no cabeçalho exibe o lembrete;
2. reabrir a sessão após reiniciar o dsh server e confirmar que o lembrete pendente continua válido (persistência);
3. kernel de reversão sem o overlay: boot normal (linhas ausentes por nome são ignoradas graciosamente — disciplina do conjunto; confirmar no probe que o loader emite warn, não crash, e incluir na lista de validação V1 do mcp-manager).

Risco: baixo. O upstream tem um guia completo do usuário + overlay de exemplo; esforço ≈ meio dia + verificação.

## 4. Registro da implementação (2026-09-07)

- As 3 linhas do overlay foram adicionadas a `dsh-app.patch.yml` (time-context + insert de schedule, habilitação de ui-schedule). Ambos os pacotes estão nas dependencies de `apps/cli` (L1), e o boot da árvore completa foi testado com o `bin.js` packaged (não confiar apenas no closure pnpm dev — lição da tela branca de tool-session-query). `--dump-config` confirmou as três linhas na árvore composta.
- Não feito: ponte de notificações do sistema (V2, depende do plugin-brand desktop bridge) e validação ponta a ponta da entrega (requer chamada de modelo real, a ser testada pelo usuário).
