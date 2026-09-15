/**
 * The preset-packages settings section: the list of locally authored presets
 * with per-row export (download a `.dshpreset` file) and a file-picker
 * import. Above it sits the config-backup block: a whole-config zip (plugin
 * configs, market sources, the profile patch layer) with one-click export —
 * secret-shaped content is scanned and a hit refuses the export — and a
 * file-picker import that turns a 409 conflict into an explicit overwrite
 * confirmation. The host enforces every rule (whitelist, containment, caps);
 * this half only mirrors the upload size caps for an instant local answer.
 *
 * @module @dsh-app/plugin-presets/client/presets-section
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ConfirmDialog } from './confirm-dialog.tsx'

const ROUTE = '/plugins/@dsh-app/plugin-presets/api'

/** Mirror of the host cap for an instant client-side answer (preset package). */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** Mirror of the host cap for an instant client-side answer (config backup). */
const MAX_BACKUP_UPLOAD_BYTES = 20 * 1024 * 1024

/** Mirror of the list route's payload. */
interface PresetSummary {
  readonly entry: string
  readonly files: number
  readonly bytes: number
}

interface PresetsResponse {
  readonly root: string
  readonly presets: readonly PresetSummary[]
}

/** Error envelope the host answers with. */
interface ErrorBody {
  readonly ok?: boolean
  readonly error?: { readonly code?: string, readonly message?: string, readonly entry?: string, readonly files?: unknown }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init })
  const body = (await response.json()) as { ok: boolean, value?: T, error?: { message?: string } }
  if (!response.ok || body.ok !== true) {
    throw new Error(body.error?.message ?? `HTTP ${response.status}`)
  }
  return body.value as T
}

/** Pull a zh-CN reason out of a failed response, tolerating non-JSON bodies. */
async function errorReasonOf(response: Response): Promise<{ code: string, message: string, entry: string, files: readonly string[] }> {
  const body = await response.json().catch(() => undefined) as ErrorBody | undefined
  return {
    code: body?.error?.code ?? '',
    message: body?.error?.message ?? `Falha na solicitação (HTTP ${String(response.status)})`,
    entry: body?.error?.entry ?? '',
    files: Array.isArray(body?.error?.files)
      ? (body.error.files as unknown[]).filter((item): item is string => typeof item === 'string')
      : [],
  }
}

/** Local-calendar date stamp (YYYY-MM-DD) for the backup file name. */
function localDateStamp(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * The conflict list of an overwrite confirmation, capped so a huge backup
 * cannot flood the dialog (the full list stays in the host's refusal).
 */
function describeConflictFiles(files: readonly string[]): string {
  if (files.length === 0) return '(o servidor não retornou uma lista detalhada)'
  const head = files.slice(0, 5).join(', ')
  return files.length > 5 ? `${head} e mais ${String(files.length)} arquivos` : head
}

/** Human size for a file count/bytes summary. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function PresetsSection(): ReactNode {
  const [data, setData] = useState<PresetsResponse | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [pendingOverwrite, setPendingOverwrite] = useState<{ buffer: ArrayBuffer, entry: string } | null>(null)
  const [pendingBackupOverwrite, setPendingBackupOverwrite] = useState<{ buffer: ArrayBuffer, files: readonly string[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const backupInputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    try {
      const value = await fetchJson<PresetsResponse>(`${ROUTE}/presets`)
      setData(value)
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Success notices are transient; errors stay until the next action.
  useEffect(() => {
    if (notice === undefined) return
    const timer = setTimeout(() => { setNotice(undefined) }, 5_000)
    return () => { clearTimeout(timer) }
  }, [notice])

  const onExport = useCallback(async (entry: string) => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const response = await fetch(`${ROUTE}/export?entry=${encodeURIComponent(entry)}`, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) {
        throw new Error((await errorReasonOf(response)).message)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${entry}.dshpreset`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => { URL.revokeObjectURL(url) }, 10_000)
      setNotice(`${entry}.dshpreset exportado`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }, [])

  const runImport = useCallback(async (buffer: ArrayBuffer, overwrite: boolean) => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const response = await fetch(`${ROUTE}/import${overwrite ? '?overwrite=1' : ''}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
      })
      if (response.status === 409) {
        // Existing entry: the explicit confirmation IS the overwrite flag's
        // source, so stage the upload and re-post only after the user agrees.
        const reason = await errorReasonOf(response)
        setPendingOverwrite({ buffer, entry: reason.entry })
        setError(undefined)
        return
      }
      if (!response.ok) {
        throw new Error((await errorReasonOf(response)).message)
      }
      const body = (await response.json()) as { ok: boolean, value?: { entry: string, files: number } }
      if (body.ok === true && body.value !== undefined) {
        setNotice(`Predefinição "${body.value.entry}" importada (${String(body.value.files)} arquivos). Ela já pode ser usada no seletor da sessão.`)
        await load()
      } else {
        throw new Error('A resposta da importação não pôde ser reconhecida')
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }, [load])

  const onFileChosen = useCallback(async (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('O pacote de predefinição excede o limite de 10 MB')
      return
    }
    try {
      const buffer = await file.arrayBuffer()
      await runImport(buffer, false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [runImport])

  /** Download the whole-config backup as a dated zip file. */
  const onBackupExport = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const response = await fetch(`${ROUTE}/config-export`, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) {
        throw new Error((await errorReasonOf(response)).message)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `dsh-config-backup-${localDateStamp()}.zip`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => { URL.revokeObjectURL(url) }, 10_000)
      setNotice(`dsh-config-backup-${localDateStamp()}.zip exportado (nenhuma chave encontrada na verificação)`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }, [])

  const runBackupImport = useCallback(async (buffer: ArrayBuffer, overwrite: boolean) => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const response = await fetch(`${ROUTE}/config-import${overwrite ? '?overwrite=1' : ''}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
      })
      if (response.status === 409) {
        // Differing files on disk: the explicit confirmation IS the overwrite
        // flag's source, so stage the upload and re-post only after the user
        // agrees.
        const reason = await errorReasonOf(response)
        setPendingBackupOverwrite({ buffer, files: reason.files })
        setError(undefined)
        return
      }
      if (!response.ok) {
        throw new Error((await errorReasonOf(response)).message)
      }
      const body = (await response.json()) as { ok: boolean, value?: { written: number, unchanged: number, backups: readonly string[] } }
      if (body.ok === true && body.value !== undefined) {
        const { written, unchanged, backups } = body.value
        const parts = [`${String(written)} configurações restauradas`]
        if (unchanged > 0) parts.push(`${String(unchanged)} sem alterações ignoradas`)
        if (backups.length > 0) parts.push('camadas de patch originais copiadas automaticamente')
        setNotice(`${parts.join(', ')}. Alterações na lista de dependências exigem reiniciar o aplicativo.`)
      } else {
        throw new Error('A resposta da importação não pôde ser reconhecida')
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }, [])

  const onBackupFileChosen = useCallback(async (file: File) => {
    if (file.size > MAX_BACKUP_UPLOAD_BYTES) {
      setError('O backup da configuração excede o limite de 20 MB')
      return
    }
    try {
      const buffer = await file.arrayBuffer()
      await runBackupImport(buffer, false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [runBackupImport])

  const presets = data?.presets ?? []

  return (
    <div className="dshPresets-section">
      <p className="dshPresets-title">Pacotes de predefinições</p>

      {error !== undefined ? <div className="dshPresets-banner" role="alert">{error}</div> : null}
      {notice !== undefined ? <div className="dshPresets-noticeOk">{notice}</div> : null}

      <div className="dshPresets-card">
        <div className="dshPresets-cardMain">
          <span className="dshPresets-entryName">Backup da configuração</span>
          <span className="dshPresets-hint">
            Exporte ou restaure a configuração atual. O backup inclui configurações de plugins e camadas de patch; chaves comuns são verificadas automaticamente e a exportação é recusada quando encontradas. Não coloque credenciais manualmente nos arquivos.
            Caminhos locais file: da lista de dependências são restaurados sem alterações e podem não funcionar em outra máquina.
          </span>
        </div>
        <div className="dshPresets-cardActions">
          <button
            type="button"
            className="dshPresets-button"
            disabled={busy}
            aria-label="Exportar backup da configuração"
            onClick={() => { void onBackupExport() }}
          >Exportar backup da configuração</button>
          <button
            type="button"
            className="dshPresets-button dshPresets-buttonPrimary"
            disabled={busy}
            onClick={() => { backupInputRef.current?.click() }}
          >Importar backup da configuração</button>
        </div>
      </div>
      <input
        ref={backupInputRef}
        type="file"
        accept=".zip"
        aria-label="Selecionar arquivo zip de backup da configuração"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file !== undefined) void onBackupFileChosen(file)
        }}
      />

      <p className="dshPresets-hint">
        Empacote predefinições de agente personalizadas em arquivos .dshpreset para compartilhar ou importe-as de um arquivo. Apenas predefinições personalizadas locais são listadas.
        Predefinições integradas acompanham o aplicativo e não podem ser exportadas. A importação valida a estrutura e a segurança dos caminhos, grava no diretório local e disponibiliza a predefinição no seletor da sessão.
      </p>

      <div className="dshPresets-toolbar">
        <span className="dshPresets-count">{data === null ? '' : `${String(presets.length)} predefinições personalizadas`}</span>
        <div className="dshPresets-cardActions">
          <button
            type="button"
            className="dshPresets-button dshPresets-buttonPrimary"
            disabled={busy}
            onClick={() => { fileInputRef.current?.click() }}
          >Importar pacote de predefinição</button>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".dshpreset"
        aria-label="Selecionar arquivo .dshpreset"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file !== undefined) void onFileChosen(file)
        }}
      />

      <div className="dshPresets-list">
        {data !== null && presets.length === 0
          ? (
            <div className="dshPresets-empty">
              Não há predefinições personalizadas para exportar. Copie uma predefinição existente em uma sessão para criar uma ou importe um arquivo .dshpreset compartilhado.
            </div>
          )
          : null}
        {presets.map(summary => (
          <div key={summary.entry} className="dshPresets-card">
            <div className="dshPresets-cardMain">
              <span className="dshPresets-entryName">{summary.entry}</span>
              <span className="dshPresets-meta">{String(summary.files)} arquivos · {formatBytes(summary.bytes)}</span>
            </div>
            <div className="dshPresets-cardActions">
              <button
                type="button"
                className="dshPresets-button"
                disabled={busy}
                aria-label={`Exportar predefinição ${summary.entry}`}
                onClick={() => { void onExport(summary.entry) }}
              >导出</button>
            </div>
          </div>
        ))}
      </div>

      {data !== null && data.root !== '' ? <p className="dshPresets-path">Diretório de predefinições: {data.root}</p> : null}

      <ConfirmDialog
        open={pendingOverwrite !== null}
        title={`Substituir predefinição "${pendingOverwrite?.entry ?? ''}"`}
        message="Já existe uma predefinição com o mesmo nome. A importação com substituição trocará todos os arquivos e não poderá ser desfeita."
        confirmLabel="Importar e substituir"
        busy={busy}
        onConfirm={() => {
          if (pendingOverwrite === null) return
          const { buffer } = pendingOverwrite
          setPendingOverwrite(null)
          void runImport(buffer, true)
        }}
        onClose={() => { setPendingOverwrite(null) }}
      />

      <ConfirmDialog
        open={pendingBackupOverwrite !== null}
        title="Substituir configuração existente"
        message={pendingBackupOverwrite === null
          ? ''
           : `Os arquivos a seguir no backup diferem da configuração local. A importação substituirá esses arquivos, fará backup das camadas de patch originais e não poderá ser desfeita: ${describeConflictFiles(pendingBackupOverwrite.files)}`}
        confirmLabel="Importar e substituir"
        busy={busy}
        onConfirm={() => {
          if (pendingBackupOverwrite === null) return
          const { buffer } = pendingBackupOverwrite
          setPendingBackupOverwrite(null)
          void runBackupImport(buffer, true)
        }}
        onClose={() => { setPendingBackupOverwrite(null) }}
      />
    </div>
  )
}
