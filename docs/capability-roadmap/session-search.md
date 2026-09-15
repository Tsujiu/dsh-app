# Pesquisa de texto completo em sessões (P2)

> Objetivo: permitir que usuário e agent "encontrem o passado" — pesquisar sessões históricas por conteúdo (não apenas por título) e unir isso ao plugin-memory como dois canais: "memória + pesquisa histórica".

## 1. Contexto e situação atual

- O kernel `ctx.sessionQuery` (`@deepseek-ai/dsh-session-query`) é o serviço unificado de consulta do histórico de sessões: listar sessões, ler eventos, rastrear linhagem e fazer **pesquisa de texto completo** (requer backend sqlite). É publicado com o dsh.
- O backend sqlite `dsh-session-query-sqlite` já está montado no base bundle, mas `openAt: never` (`packages/bundle/base/cordis.patch.yml:129`) significa **desativado por padrão**. Os comentários do web bundle indicam o caminho: uma camada de patch posterior sobrescreve `openAt` para `first-search` (o handle sqlite só é aberto na primeira pesquisa, mantendo a inicialização silenciosa).
- A ferramenta do lado do agent `tool-session-query` (pesquisar/ler sessões históricas) existe, mas não está montada.
- UI do usuário: não há interface de pesquisa por conteúdo (a barra lateral só tem a linha de pesquisa por título).

## 2. Design da solução

### 2.1 Habilitação em três camadas

1. **uma linha de overlay** (`dsh-app.patch.yml`):
   ```yaml
   - id: session-query-sqlite
     config:
        path: ':memory:'      # ou um arquivo persistente em $DSH_HOME; veja questões em aberto
       openAt: first-search
   ```
    (sobrescreve o config da linha base; id alinhado ao id da linha base, last-write-wins.)
   > Lição de 2026-09-07: não adicionar uma linha insert para `tool-session-query`: o pacote (`@deepseek-ai/dsh-tool-session-query`) não está no closure de runtime do CLI (`apps/cli` não tem essa dependência). O insert causa `ERR_MODULE_NOT_FOUND` no loader, fazendo `cordis:include` falhar, a árvore inteira de plugins falhar e o Electron exibir uma tela branca. Antes de inserir qualquer pacote no overlay, confirme que ele está no closure do CLI.
2. **Capacidade do agent** (adiada): quando o pacote `tool-session-query` entrar no closure do CLI, montar essa linha; o modelo obterá a ferramenta "pesquisar sessões históricas" — o segundo canal de conhecimento persistente além da memória (memória = entradas selecionadas; pesquisa = conversa original). Até lá, archives `/search` retorna `agentToolAvailable: false`; a página informa isso sem afetar a pesquisa.
3. **UI do usuário**: expandir plugin-archives para um "centro do histórico de sessões": adicionar uma caixa de pesquisa acima da lista de arquivos (host route protegida pelo fence envolvendo `ctx.sessionQuery.search`), com cartões de sessão como resultado (título/projeto/resumo do match/horário, clique para abrir a sessão). Não criar plugin novo (unificar o mesmo domínio mantém um membro a menos no conjunto).

### 2.2 Desempenho e custo

- Semântica de `first-search`: custo zero na inicialização do processo; o índice em memória só é criado na primeira pesquisa (node:sqlite).
- Escopo do índice = todos os session logs persistentes; a primeira pesquisa em um banco grande pode levar segundos — adicionar o status "indexando" à UI e definir um time budget na route do backend.

## 3. MVP / V2 / aceitação

**MVP**: habilitar o overlay + montar a ferramenta do agent + caixa de pesquisa em archives (palavra-chave → lista de cartões de sessão).
**V2**: expandir matches no nível de eventos (`readSession` lê contexto limitado); filtrar por projeto/horário; citar com um clique a partir de uma sessão encontrada para continuar em uma nova sessão.
**Aceitação**:
1. Pesquisar uma palavra que aparece no conteúdo histórico, mas não no título, retorna a sessão correspondente;
2. Antes da primeira pesquisa, os logs de inicialização não mostram handles sqlite (first-search funcionando);
3. banco vazio / zero matches / consulta muito longa têm resposta zh-CN estável;
4. tool-session-query pode ser chamado em uma sessão do standard preset (a validar depois que o pacote entrar no closure do CLI;
   a afirmação anterior de que o "probe V1 confirmaria a forma de montagem na camada preset" era imprecisa: o probe usava o ambiente dev pnpm,
   cuja resolução de pacotes não coincide com o closure do CLI empacotado).

## 4. Questões em aberto

- Q1 Persistência do índice: `:memory:` (reconstruído na primeira pesquisa, frio) vs arquivo fixo (persistente, requer estratégia de limpeza). Usar primeiro `:memory:` (igual ao padrão do web upstream); avaliar arquivos na V2.
- Q2 Permissões: a pesquisa completa expõe o conteúdo das sessões de todos os projetos ao agent da sessão atual — seguir o modelo de confiança upstream (produto local de usuário único), mas declarar o escopo na descrição da ferramenta.
