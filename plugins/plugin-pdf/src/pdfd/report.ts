/**
 * The model-facing shape of a PDF check: status plus per-issue locations with
 * actionable Chinese messages. Every issue is anchored to the project file
 * and, where it belongs to one, a 1-based block index and its field, so one
 * round trip carries the whole fix list and the next `pdf_write` is targeted.
 * `needs_revision` is a normal authoring result, never a delivery.
 *
 * @module @dsh-app/plugin-pdf/pdfd/report
 */

import type { PdfCheckResult, PdfIssue } from './types.ts'

export interface ReportIssue extends PdfIssue {
  /** Workspace-relative or absolute project path the issue belongs to. */
  readonly file: string
}

export interface ValidationReport {
  readonly status: 'pass' | 'warning' | 'needs_revision'
  readonly file: string
  readonly blockCount: number
  readonly estimatedPages: number
  readonly errorCount: number
  readonly warningCount: number
  readonly issues: readonly ReportIssue[]
}

/** Bind a check result to the project it was computed from. */
export function validationReport(check: PdfCheckResult, context: { file: string }): ValidationReport {
  return {
    status: check.status === 'fail' ? 'needs_revision' : check.status,
    file: context.file,
    blockCount: check.blockCount,
    estimatedPages: check.estimatedPages,
    errorCount: check.errorCount,
    warningCount: check.warningCount,
    issues: check.issues.map(issue => ({ ...issue, file: context.file })),
  }
}

/**
 * Chinese, actionable plain-text rendering: one line per issue with its block
 * index and fix hint — the block the render gate returns when it refuses an
 * export.
 */
export function formatValidation(report: ValidationReport): string {
  const title = report.status === 'needs_revision'
    ? 'Validação reprovada; são necessários ajustes'
    : report.status === 'warning' ? 'Validação aprovada, com sugestões' : 'Validação aprovada'
  const lines: string[] = [
    `${title}: ${report.errorCount} itens precisam de correção, ${report.warningCount} são sugestões (${report.blockCount} blocos, aproximadamente ${report.estimatedPages} páginas).`,
    `Arquivo: ${report.file}`,
  ]
  for (const issue of report.issues) {
    lines.push([
      issue.severity === 'error' ? 'Corrigir' : 'Sugestão',
      issue.block === undefined ? '' : `Bloco ${issue.block}`,
      issue.field ?? '',
      `[${issue.code}] ${issue.message}`,
      issue.fix === undefined ? '' : `Correção: ${issue.fix}`,
    ].filter(Boolean).join(' · '))
  }
  if (report.status === 'needs_revision') {
    lines.push('Edite o conteúdo de pdf_write por índice de bloco e campo e valide novamente; nenhum PDF será renderizado antes das correções.')
  }
  return lines.join('\n')
}
