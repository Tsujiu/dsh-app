/**
 * The PDF-mode system-prompt section.
 *
 * The section is registered once and its text is a per-assembly provider: when
 * the assembling agent's session has PDF mode on (an entry in the mode store),
 * the provider returns the compact workflow directive; otherwise it returns an
 * empty string, which the prompt renderer drops. The session id comes from the
 * same agent header the tools resolve the workspace cwd against, so what the
 * tools see and what the prompt injects can never diverge.
 *
 * The directive pins both legs of the workflow — read an existing PDF as
 * material, or author a project and render it — plus the ordering and the
 * no-fabrication rule; the full format details live in the skill.
 *
 * @module @dsh-app/plugin-pdf/prompt
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
 * The unconditional PDF-entry rule, injected into every assembly regardless of
 * mode state: an explicit PDF / report / white-paper request must reach the PDF
 * workflow even when the session never toggled the capsule.
 */
export function pdfDefaultSectionText(): string {
  return [
    '## PDF / report request',
    'When the user mentions a PDF, asks for a report, white paper, or professionally laid-out document, or provides PDF material: use skill `dsh-pdf` and the PDF workflow — use pdf_read to understand an existing PDF as structured text; to produce a PDF, use pdf_write to write the structured JSON project (*.pdf.json) → pdf_check validates and fixes issues one by one → pdf_render renders a professionally laid-out PDF. Do not answer with ordinary long-form text or replace the body with screenshots. Content must come from the user request and supplied materials.',
  ].join('\n')
}

/** The injected directive for an active PDF mode, in Chinese. */
export function renderPdfModeText(): string {
  return [
    '## PDF mode (enabled for this session)',
    '',
    'First determine which path applies: 1) use an existing PDF as material — use pdf_read on the workspace .pdf (it returns page count, per-page text, title, and author), then write from the excerpts; 2) generate a PDF from requirements — first catalog materials and prepare an outline, defining audience, purpose, and chapter order. Content may come only from the user request, supplied materials, and pdf_read results; if insufficient, ask the user or gather information online. Do not invent data or sources; clearly label example data.',
    '按提纲用 pdf_write 写入结构化 JSON 工程：顶层 { title, author?, size?: "a4"|"letter", style?: {header?: "light"|"dark"}, blocks }，blocks 是按顺序排列的内容块数组，每个块恰好命中一种内容键——heading{level:1|2|3,text}、paragraph{text}、bullets:string[]、table{headers,rows}、pageBreak:true。标题必须从 H1 开始且层级连续，不要跳级；表格每行的单元格数与表头一致，单元格放短语；单块不能超出一页。',
    'Every output must follow this order: pdf_write (write and validate immediately) → pdf_check (read-only full validation, fixing issues by block index and field) → pdf_render (force validation first; error refuses rendering, and success produces .pdf). Tell the user the returned .pdf path and project path; only status: exported counts as delivery. When status is needs_revision, keep fixing instead of repeatedly rendering. If pdf_render reports missing glyphs, rewrite the copy as instructed or use a font that covers the character.',
  ].join('\n')
}

/**
 * Section provider body: resolve the assembling session's id and return the
 * directive, or an empty string (dropped by the renderer) when the session has
 * PDF mode off or the assembly has no agent.
 */
export function pdfModeSectionText(
  isEnabled: (sessionId: string) => boolean,
  context: { agent?: PromptAssemblyAgent },
): string {
  const sessionId = context.agent?.session?.header?.id
  if (typeof sessionId !== 'string' || sessionId === '') return ''
  if (!isEnabled(sessionId)) return ''
  return renderPdfModeText()
}
