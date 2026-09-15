# Experiência do shell desktop (implementação do plugin-brand / centro de diagnóstico / conclusão da primeira inicialização / acesso direto ao workspace)

> A diferenciação do shell desktop em relação a "abrir dsh web no navegador" está nesta camada. plugin-brand é a base necessária para a maioria dos itens.

## 1. Implementação do plugin-brand (pré-requisito, fazer primeiro)

Situação atual: três TODOs em `plugins/plugin-brand/src/index.ts:27-40` (settings namespace, serviço app-info, desktop bridge remotes), o único shell vazio do conjunto.

**Plano** (conforme o design original de AGENTS.md §11):
1. **Serviço app-info**: o shell injeta informações de versão ao iniciar o server (ou a host route lê o manifest + arquivo de versão do shell) → o client exibe "DSH APP x.y.z / kernel dsh a.b.c", e o cartão de atualização mostra versões reais.
2. **settings namespace `brand`**: preferências do shell (canal de atualização, placeholder de telemetria, marcador de onboarding) usam o sistema dsh-settings, não um IPC próprio.
3. **desktop bridge remotes**: `openInFolder(path)` (abrir no gerenciador de arquivos), `saveTextAs(name, content)` (salvar como nativo, base para exportação de trajetória), `notify(title, body)` (notificação do sistema, dependência do schedule-reminders V2) e `focusSession(sessionId)` (base para saltar ao clicar em uma notificação). Todos passam pelo trusted-host fence; o client chama pelo seam normal da API dsh (eliminando IPC dedicado).

**Aceitação**: a página de configurações "Sobre" exibe as duas versões reais; o botão "Abrir diretório de logs" abre o gerenciador de arquivos pelo bridge.

## 2. Centro de diagnóstico (necessidade essencial de suporte)

Situação atual: solucionar problemas significa pedir ao usuário que examine `<userData>/logs` (logs enviados pelo tee de server.ts) e descreva o ocorrido manualmente.

**Plano**: seção "Diagnóstico" na página de configurações (order 14):
- cartão de status: versões do shell e active/previous do kernel, canal, último horário de verificação do kernel, tempo de execução e contagem de reinicializações do server (esses estados internos já existem em index.ts; falta expô-los por IPC/serviço);
- logs: tail em tempo real das 200 linhas mais recentes (host route lê o final do arquivo) + "Abrir diretório de logs" (bridge);
- exportar pacote de diagnóstico: zip com dados sanitizados (logs + current.json + informações do sistema; reutiliza o filtro de credenciais de server.ts), salvar como com um clique (bridge);
- ações rápidas: reiniciar server / verificar atualização do kernel (transformar capacidades existentes da bandeja em UI).

**MVP**: cartão de status + tail de logs + abrir diretório de logs. **V2**: exportação do pacote de diagnóstico.
**Aceitação**: após simular um crash restart, a página de diagnóstico mostra a contagem de reinicializações e as linhas de erro recentes;
o zip exportado passa por revisão de redaction sem ocorrências de `api[key|_key]/authorization/token`.

## 3. Conclusão da experiência de primeira inicialização (listada em AGENTS.md §11)

- **pausar/retomar** o download do kernel (o fluxo install da setup window já tem progress; adicionar semântica de cancel para distinguir "pausar" de "abandonar");
- **exibição do checksum**: mostrar os primeiros 16 caracteres de sha512 + selo "verificado" na página de conclusão (integrity.ts já tem a lógica, falta apenas exibir);
- separar as mensagens de falha: falha de rede / toda a cadeia de espelhos falhou / falha de verificação, cada uma com sugestão acionável.

## 4. Acesso direto ao workspace (experiência a verificar)

- `dsh-app.exe <path>` abre esse workspace ao iniciar (🔴 V1: ler `src/main/index.ts`/`window.ts` para confirmar o tratamento atual de argv e o formato da URL de abertura de workspace do dsh web);
- menu da bandeja "Workspaces recentes" (o shell registra os caminhos recentes; clique → focar/abrir nova sessão);
- menu de contexto do Windows Explorer "Abrir no DSH APP" (entrada de registro do instalador, configuração NSIS).

**Aceitação**: iniciar com um caminho abre diretamente a sessão desse workspace; a lista de recentes da bandeja abre o caminho correto.
