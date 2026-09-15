/**
 * The model-facing shape of a DOC check: status plus per-issue locations with
 * actionable Chinese messages. Every issue is anchored to the document file
 * and, where it belongs to one, a 1-based block index and its field, so one
 * round trip carries the whole fix list and the next `doc_write` is targeted.
 * `needs_revision` is a normal authoring result, never a delivery.
 *
 * @module @dsh-app/plugin-doc/docd/report
 */

import type { DocCheckResult, DocIssue } from './types.ts'

export interface ReportIssue extends DocIssue {
  /** Workspace-relative or absolute document path the issue belongs to. */
  readonly file: string
}

export interface ValidationReport {
  readonly status: 'pass' | 'warning' | 'needs_revision'
  readonly file: string
  readonly blockCount: number
  readonly errorCount: number
  readonly warningCount: number
  readonly issues: readonly ReportIssue[]
}

/** Bind a check result to the document it was computed from. */
export function validationReport(check: DocCheckResult, context: { file: string }): ValidationReport {
  return {
    status: check.status === 'fail' ? 'needs_revision' : check.status,
    file: context.file,
    blockCount: check.blockCount,
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
    `${title}: ${report.errorCount} itens precisam de correção, ${report.warningCount} são sugestões (${report.blockCount} blocos).`,
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
    lines.push('Edite o conteúdo de doc_write por índice de bloco e campo e valide novamente; nenhum .docx será exportado antes das correções.')
  }
  return lines.join('\n')
}
