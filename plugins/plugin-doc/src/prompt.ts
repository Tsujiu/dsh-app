/**
 * The Word-mode system-prompt section.
 *
 * The section is registered once and its text is a per-assembly provider: when
 * the assembling agent's session has Word mode on (an entry in the mode store),
 * the provider returns the compact workflow directive; otherwise it returns an
 * empty string, which the prompt renderer drops. The session id comes from the
 * same agent header the tools resolve the workspace cwd against, so what the
 * tools see and what the prompt injects can never diverge.
 *
 * The directive pins the workflow ordering and the content-sourcing rule; the
 * full format details live in the skill.
 *
 * @module @dsh-app/plugin-doc/prompt
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
 * The unconditional Word-entry rule, injected into every assembly regardless
 * of mode state: an explicit Word/.docx/document request must reach the DOC
 * workflow even when the session never toggled the capsule.
 */
export function docDefaultSectionText(): string {
  return [
    '## Word / document request',
    'When the user explicitly asks for a Word document, .docx, or an editable document: use skill `dsh-word` and the DOC workflow — doc_write writes the structured JSON project (*.doc.json) → doc_check validates and fixes each issue → doc_render exports an editable .docx. Do not answer with ordinary long-form text or replace the body with screenshots or images. Content must come from the user request and supplied materials.',
  ].join('\n')
}

/** The injected directive for an active Word mode, in Chinese. */
export function renderDocModeText(): string {
  return [
    '## Word generation mode (enabled for this session)',
    '',
    'First catalog the materials and prepare an outline: define the audience, document purpose, and chapter order. Content may come only from the user request and supplied documents/materials; if materials are insufficient, ask the user or gather information online first. Do not invent data or sources; clearly label example data.',
    '按提纲用 doc_write 写入结构化 JSON 工程：顶层 { title, subtitle?, author?, date?, sections }，sections 是按顺序排列的内容块数组，每个块恰好命中一种内容键——heading{level:1|2|3,text}、paragraph{text,bold?,italic?}、bullets:string[]、table{headers,rows}、image{path}。标题层级连续（H1 → H2 → H3），不要跳级；标题写成 42 字以内的短句，每个 H1/H2 标题后必须紧跟正文块；表格列数不超过 8、每行的单元格数与表头一致，单元格放短语；超过 600 字的段落拆成多段或列表。',
    'Every document output must follow this order: doc_write (write and validate immediately) → doc_check (read-only full validation, fixing issues by block index and field) → doc_render (force validation first; error refuses export, and success produces .docx). Tell the user the returned .docx path and project path; only status: exported counts as delivery. When status is needs_revision, keep fixing instead of repeatedly exporting.',
  ].join('\n')
}

/**
 * Section provider body: resolve the assembling session's id and return the
 * directive, or an empty string (dropped by the renderer) when the session has
 * Word mode off or the assembly has no agent.
 */
export function docModeSectionText(
  isEnabled: (sessionId: string) => boolean,
  context: { agent?: PromptAssemblyAgent },
): string {
  const sessionId = context.agent?.session?.header?.id
  if (typeof sessionId !== 'string' || sessionId === '') return ''
  if (!isEnabled(sessionId)) return ''
  return renderDocModeText()
}
