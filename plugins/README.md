# DSH APP — conjunto de plugins de marca

O conjunto contém dezesseis plugins dsh sobre o dsh upstream **sem fazer fork
dele**. Isso mantém o aplicativo desktop atualizável: quando o dsh upstream
lança uma nova versão, o shell troca o kernel e estes plugins continuam funcionando.

## Pacotes

| Pacote | Lado | Função |
|---|---|---|
| `plugin-brand` | host | **scaffold** — namespace de configurações, serviço app-info e desktop bridge declarados, mas ainda não conectados; o shell injeta diretamente o chrome desktop |
| `plugin-client-ui` | client | tema de marca, seção de configurações Models da marca |
| `plugin-sidebar` | dual | painel Git como aba nativa de conversation-view (a árvore de arquivos foi aposentada: o upstream fornece o gerenciamento de arquivos nativamente) |
| `plugin-swarm` | host | orquestração paralela de subagentes em lote (ferramenta `swarm` + comando `/swarm`), concorrência adaptativa, nova tentativa por item |
| `plugin-usage` | dual | captura de uso nos logs de sessão + cartão de saldo, mapa de calor e gráfico de tendência diária na página de configurações |
| `plugin-archives` | dual | gerenciador de arquivo de sessões (rotas de listagem/exclusão + seção na página de configurações agrupada por projeto) |
| `plugin-memory` | dual | cross-session memory (global/project files injected per prompt, memory_save/recall/forget tools, background distiller + curator, settings page with per-entry pin/delete) |
| `plugin-fff` | host | busca nativa rápida de arquivos, exposta aos agents como ferramenta |
| `plugin-mcp` | dual | gerenciador externo de servidores MCP: CRUD na página de configurações, montagem dinâmica, ferramentas registradas como `mcp__<server>__<tool>` nativas |
| `plugin-hooks` | dual | ponte de hooks externos: CRUD na página de configurações para `hooks.json` do Claude Code / Codex, montados como instâncias de hook ativas |
| `plugin-ppt` | dual | editable PPTX generation: the model authors a local PPTD project (`.pptd` manifest + `.page` YAML) against bundled layout templates via `ppt_list_templates`/`ppt_get_template_reference`/`ppt_get_template_pages`/`pptd_write_file`/`pptd_list_files`/`pptd_read_file`/`pptd_check`/`pptd_render` (read-only check locates text overflow/occlusion per file-page-elementId before export), a guiding skill installed into `$DSH_HOME/skills`, and the PPT mode capsule in the **office-suite capsule bar** — the row of format capsules injected after the composer card (container class `dshOfficeBar`, one host per format as `[data-office-format]`, container reused and hosts ordered/deduplicated by that attribute so later Word/Excel/PDF plugins join the same row; see `plugins/plugin-ppt/src/client/office-bar.ts`). The capsule toggles the mode and opens a real cover-preview template panel behind its ▾ dropdown; a pick made before any session exists is parked and applied to the session once it starts |
| `plugin-market` | dual | plugin marketplace: sidebar footer entry + drawer panel over user-configurable catalog sources, install/uninstall through the kernel CLI with registry-only validation |
| `plugin-presets` | dual | portable preset packages: settings-page export of a preset directory as a shareable `.dshpreset` archive and import with kernel-roster-aligned name/path/size fencing |
| `plugin-doc` | dual | Word documents: `doc_write`/`doc_check`/`doc_render` tools over a validated JSON document project, rendered to an editable `.docx`; Word capsule in the shared office bar |
| `plugin-sheet` | dual | Excel workbooks: `sheet_write`/`sheet_check`/`sheet_render` tools over a validated JSON workbook project, rendered to an editable `.xlsx` with formulas; Excel capsule in the shared office bar |
| `plugin-pdf` | dual | PDF mode: `pdf_read` extracts text/metadata from workspace PDFs for the agent, `pdf_write`/`pdf_check`/`pdf_render` produce a paginated, rule-checked PDF with an embedded CJK font subset; PDF capsule in the shared office bar |

O roster existe nos locais abaixo, que devem permanecer sincronizados — `SUITE_PLUGIN_DIRS`
(src/main/brand-suite.ts), as linhas de overlay em `dsh-app.patch.yml`,
`SUITE_PLUGINS` em scripts/kernel-line.mjs, o loop de pre-build em
`.github/workflows/release.yml` e scripts/smoke-suite.mjs.

## Integração ao runtime do kernel

O build do artefato de runtime (scripts/build-runtime.mjs) adiciona o conjunto por meio de
referências `file:` no package.json do perfil de runtime, de modo que um kernel
publicado contenha dsh + o conjunto em um único diretório imutável. Quando o
conjunto for publicado no npm, troque essas referências por intervalos de versão.

O overlay do loader (`dsh-app.patch.yml`) é copiado para userData na inicialização
do server e passado a `dsh web --patch ...`; ele insere as dezesseis entradas do
conjunto após cada camada do bundle e o patch do próprio perfil (last write wins).
