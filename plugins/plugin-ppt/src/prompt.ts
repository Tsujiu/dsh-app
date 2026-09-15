/**
 * The PPT-mode system-prompt section.
 *
 * The section is registered once and its text is a per-assembly provider:
 * when the assembling agent's session has PPT mode on (an entry in the mode
 * store), the provider returns the compact workflow directive; otherwise it
 * returns an empty string, which the prompt renderer drops. The session id
 * comes from the same agent header the tools resolve the workspace cwd
 * against, so what the tools see and what the prompt injects can never
 * diverge.
 *
 * The directive pins the workflow ordering, the active template's name and
 * the content-sourcing rule (materials from the user or web search, never
 * template sample copy); the full schema details live in the skill.
 *
 * @module @dsh-app/plugin-ppt/prompt
 */

/** Structural slice of the assembly context (keeps this module dep-free). */
export interface PromptAssemblyAgent {
  session?: {
    header?: {
      id?: string
    }
  }
}

/**
 * The unconditional PPT-entry rule, injected into every assembly regardless
 * of mode state: a natural-language PPT request must reach the pptd workflow
 * even when the session never enabled PPT mode. Without a template choice the
 * document defaults to the paper theme and the pages are organized freely
 * from the content; an explicit template (mode on with a pick) keeps priority.
 */
export function pptDefaultSectionText(): string {
  return [
    '## PPT / presentation request',
    'When the user asks for a PPT, slides, or a presentation: use skill `dsh-ppt` and the pptd workflow — pptd_write_file creates the PPTD project → pptd_check validates it and fixes issues one by one → pptd_render exports an editable .pptx. Do not answer with ordinary long-form text. If PPT mode is off (no template selected), do not apply a fixed template layout; organize pages by content relationships and use the paper theme by default (warm paper background + dark body text + blue accent; see the skill for palette and writing rules). When a template is selected, its theme and layout take priority.',
  ].join('\n')
}

/** The mode state the section provider reads for the assembling session. */
export interface PptModeState {
  /** Whether the session's PPT mode is on. */
  readonly enabled: boolean
  /** The chosen template, or `null` for the 常规主题 free mode. */
  readonly template: string | null
}

/**
 * The injected directive for an active session that has not picked a template:
 * pages are organized by content relationships instead of any template
 * skeleton, on the built-in paper default theme, under the same gates as the
 * template mode.
 */
export function renderPptFreeModeText(): string {
  return [
    '## PPT generation mode (enabled for this session, standard theme)',
    '',
    'No template is selected: do not follow any template layout. Organize each page and its visual hierarchy by content relationships (line/area charts for trends, bar/column charts for comparisons, pie charts for proportions, KPI cards for progress, tables for precise values, and visualized text for hierarchies and processes). Do not force a fixed layout skeleton.',
    'The manifest theme defaults to paper: background #FDFAE7, body #111111, accent #1E2BFA, surface #E9E8E0, secondary #6B6B6B. See the skill for font and element-reference syntax.',
    'Every presentation must follow this order: pptd_write_file creates the PPTD project → pptd_check validates and fixes issues by file/page/element ID → pptd_render produces the .pptx; only status: exported counts as delivery. Do not invent data or replace text with full-page screenshots or images.',
    'The same quality gates as template mode apply: textCapacity limits, one primary cover message, valid colors, and chart rules.',
  ].join('\n')
}

/**
 * The injected directive for one active template, in Chinese (the product's
 * user-facing language, matching the skill text).
 */
export function renderPptModeText(templateId: string, templateName: string): string {
  return [
    '## PPT generation mode (enabled for this session)',
    '',
    `Template "${templateName}" (${templateId}). First call ppt_list_templates to confirm the catalog, then use ppt_get_template_reference and ppt_get_template_pages to read layouts (up to 12 pages per call), choose layouts by content relationships, and rebuild editable elements with the user's own text.`,
    'The template supplies only colors, fonts, and a layout skeleton, not content: all text must come from the user request and supplied documents/materials. If materials are insufficient, ask the user first or search the web before writing. Do not invent data or use template sample copy as presentation content.',
    '任何演示文稿产出必须按序执行：pptd_write_file 建立 PPTD 工程（清单顶层必须写 theme 字段：当前模板的调色板写入 theme.colors、字体写入 theme.textStyles，元素以 $名称 引用）→ pptd_check 校验并按 文件/页/元素 ID 逐条修复 → pptd_render 产出 .pptx 并把工程目录与输出路径告知用户；status: exported 才算交付，渲染报 needs_revision 时继续修复而不是反复导出。禁止用整页截图或图片代替文字。',
    'Each text area has a textCapacity recommended maximum: if exceeded, rewrite it shorter, enlarge the area, or split the page; do not force text in by shrinking the font. Keep one primary message on the cover (no more than 3 text elements), use short phrases in table cells, and write colors only as #RRGGBB or $ references from theme.colors.',
  ].join('\n')
}

/**
 * Section provider body: resolve the assembling session's id and return the
 * directive, or an empty string (dropped by the renderer) when the session
 * has PPT mode off or the assembly has no agent. An on-without-template
 * session gets the free-mode directive instead of the template one.
 */
export function pptModeSectionText(
  modeOf: (sessionId: string) => PptModeState,
  templateNameOf: (templateId: string) => string | undefined,
  context: { agent?: PromptAssemblyAgent },
): string {
  const sessionId = context.agent?.session?.header?.id
  if (typeof sessionId !== 'string' || sessionId === '') return ''
  const mode = modeOf(sessionId)
  if (!mode.enabled) return ''
  if (mode.template === null) return renderPptFreeModeText()
  return renderPptModeText(mode.template, templateNameOf(mode.template) ?? mode.template)
}
