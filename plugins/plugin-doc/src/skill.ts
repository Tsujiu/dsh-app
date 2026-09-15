/**
 * Skill installation.
 *
 * The kernel exposes no skill-registry seam this plugin can call, so the skill
 * materializes as a SKILL.md under `$DSH_HOME/skills/<name>/` — the
 * conventional discovery location — written at plugin mount. The write is
 * content-compared and skipped when unchanged, so repeated boots never touch
 * the file. Failures log and degrade instead of failing the mount.
 *
 * @module @dsh-app/plugin-doc/skill
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

export const SKILL_NAME = 'dsh-word'

/** The skill body (Portuguese, per the product's user-facing language). */
export const SKILL_MARKDOWN = `---
name: ${SKILL_NAME}
description: Escreva um projeto de documento JSON estruturado e produza um documento Word editável nativamente (.docx). Use quando o usuário pedir para criar ou gerar um Word / .docx / documento editável, ou organizar conteúdo em um documento formal.
---

# Geração de documentos Word (${SKILL_NAME})

Objetivo: produzir para o usuário um .docx **editável nativamente** e um projeto JSON reutilizável. Todo o conteúdo deve ser composto por objetos Word de títulos, parágrafos, listas, tabelas e imagens, para que o usuário possa continuar editando diretamente no Word / WPS; é proibido substituir o corpo por capturas de tela ou imagens de página inteira.

## Fluxo por etapas (siga rigorosamente a ordem, sem pular etapas)

1. Levante os materiais e prepare o roteiro: defina o público, o objetivo e a ordem dos capítulos, e catalogue as necessidades e os documentos fornecidos pelo usuário. Se faltarem materiais, pergunte primeiro ou pesquise na internet; dados de exemplo devem ser identificados claramente e nunca inventados.
2. 用 \`doc_write\` 把整份文档写成结构化 JSON（\`*.doc.json\`，工作区相对路径）。\`doc_write\` 会先校验、发现 error 时不写盘并返回问题清单。
3. 调用只读的 \`doc_check\`（入参 \`file_path\`）。返回 \`needs_revision\` 是正常的写作反馈：问题清单会完整返回，每条带块索引、字段与修复指引。
4. 按 **块索引 + 字段** 逐条修复：用普通文件工具读取该 \`.doc.json\`，改好后用 \`doc_write\` 整份覆盖（替换已存在文件必须带上一次返回的 \`expected_sha256\`），再次 \`doc_check\`。
5. 校验通过后调用 \`doc_render\`（入参 \`file_path\` 与新的 \`output_file\`，\`.docx\` 结尾）。渲染内部仍会复验：\`status: needs_revision\` 表示未导出任何文件，回到第 4 步继续修；\`status: exported\` 才算交付。最后在回复结尾给出产出 \`.docx\` 的**明确路径引用**（让用户能直接打开）与 \`.doc.json\` 工程路径，并说明可用你本机的 Word 打开继续编辑；不声称已在本机打开验证过。

## 工程格式

\`\`\`json
{
  "title": "季度复盘",
  "subtitle": "增长组内部评审材料",
  "author": "增长组",
  "date": "2026-04-10",
  "sections": [
    { "heading": { "level": 1, "text": "结论" } },
    { "paragraph": { "text": "本季度核心指标全面达标。", "bold": true } },
    { "bullets": ["营收同比增长 22%", "毛利率提升 3.3 个百分点"] },
    { "heading": { "level": 2, "text": "关键指标" } },
    { "table": { "headers": ["指标", "本期", "上期"], "rows": [["营收", "1,280 万", "1,050 万"]] } },
    { "image": { "path": "assets/trend.png" } }
  ]
}
\`\`\`

Campos e limites:

- 顶层只允许 \`title\`（必填）、\`subtitle\`（可选，副标题）、\`author\`（可选）、\`date\`（可选，如 2026-04-10）、\`sections\`（必填，块数组，最多 500 块）；其他字段是校验错误。
- \`author\` 与 \`date\` 会排成标题下的一行小字“作者 · 日期”，有就写上。
- 每个块**恰好命中一种内容键**：\`heading\`、\`paragraph\`、\`bullets\`、\`table\`、\`image\`。同时写两种、或一种都不写都是错误。
- \`heading.level\` 只能是 1、2、3，\`text\` 非空。层级必须连续：从 H1 跳到 H3 是 error，会拒绝导出。\`heading.text\` 超过 42 字是 error：标题要短句化，只写核心论点。
- 每个 H1 / H2 标题后必须紧跟至少一个非标题块（段落、列表、表格或图片），否则是“空章节” error。
- \`paragraph.bold\` / \`paragraph.italic\` 省略时是普通正文，写了必须是 true / false。
- \`bullets\` 是非空字符串数组（最多 100 条），每条用完整短句，不要自己加 "·" 前缀。
- \`table\` 必须有非空 \`headers\`；每一行 \`rows[i]\` 是字符串数组，长度必须与表头列数一致，单元格文本不超过 300 字。
- \`image.path\` 是**工作区相对路径**（正斜杠），不要绝对路径、不要 \`..\`；只支持 png / jpg / jpeg / gif / bmp。图片先放入工作区再引用，文件缺失时渲染会拒绝导出。
- O documento deve ter pelo menos um bloco de conteúdo; \`sections\` vazio é um erro.

## Regras rígidas (o validador recusa a exportação nestes casos)

- 单文档块数上限 500，表格列数上限 8、行数上限 200，单元格文本上限 300 字；超限请拆分或改写。
- 标题层级跳跃、标题超过 42 字、H1/H2 后没有正文内容都是 error，会拒绝导出。
- 段落超过 600 字、表格超过 60 行是 warning（不阻塞导出），但会明显影响排版，交付前应拆分。
- 未知字段（拼写错误、旧字段名）一律是 error，不会静默忽略。
- 内容全部来自用户需求与材料；数字要同时保留单位、期间与来源。表格只放精确数值清单，叙述性内容用段落或列表。

## Regras de layout (aplicadas pelo renderizador; organize o conteúdo de acordo)

- 页面 A4，上下页边距 2.54cm、左右 3.17cm，页脚居中显示“第 N 页 共 M 页”（真实 PAGE / NUMPAGES 域，编辑后自动重算）。
- 字号阶梯：文档大标题 22pt、H1 18pt、H2 15pt、H3 13pt、正文 11pt、表格数据 10pt（表头 11pt）；标题深灰近黑，不使用彩色标题。
- 正文 1.5 倍行距、段后 6pt；标题段前 12pt、段后 6pt；列表缩进 0.74cm。
- 表格：表头加粗并带浅色底，只画横向分隔线（表头下、合计行上各一条深色线），不画竖线与外框；数值列右对齐，同列统一小数位并加千分位，比率列写成百分比（如 12.8%），文本列左对齐；列宽按显示宽度（中文按 2 个单位）自动分配，最多 8 列才排得下，超过请拆表。
- 合计/总计行放在表格最后一行，首列写“合计”“总计”等词，渲染会自动加粗并加浅色底。
- 排版靠样式统一生效，写作时不要用空段落手动留白，也不要把正文塞进表格或一个超长段落。
- 每章先标题后正文；标题写成名词短语式的短句，一屏内可读；并列要点用 \`bullets\`，精确数值用 \`table\`。
`

/** Where the skill file lands under the harness home. */
export function skillFilePath(dshHome: string): string {
  return join(dshHome, 'skills', SKILL_NAME, 'SKILL.md')
}

/**
 * Install (or refresh) the skill file. Content-compared: unchanged boots do not
 * rewrite. Returns what happened, for the boot log.
 */
export async function installSkill(dshHome: string): Promise<'installed' | 'unchanged'> {
  const file = skillFilePath(dshHome)
  let current: string | undefined
  try {
    current = await readFile(file, 'utf8')
  } catch {
    // Absent or unreadable → treat as a fresh install.
  }
  const changed = current !== SKILL_MARKDOWN
  if (changed) {
    // mkdir is implied by writeFileAtomic's parent creation.
    await writeFileAtomic(file, SKILL_MARKDOWN, { mode: 0o644 })
  }
  return changed ? 'installed' : 'unchanged'
}
