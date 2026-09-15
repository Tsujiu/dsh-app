/**
 * The Hooks settings section: entry cards with live mount status, an
 * add/edit form (dialect-selective fields + file/inline mode toggle), enable
 * toggles, and delete via the in-app ConfirmDialog.
 * @module @dsh-app/plugin-hooks/client/hooks-section
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ConfirmDialog } from './confirm-dialog.tsx'

const ROUTE = '/plugins/@dsh-app/plugin-hooks/api'

interface BridgeView {
  id: string
  dialect: string
  enabled: boolean
  configSource: string
  configPath: string
  configContent?: string
  pluginRoot?: string
  projectDir?: string
  model?: string
  defaultTimeoutMs?: number
  stderrSummaryMaxChars?: number
  status: { state: string; message?: string }
}
interface HooksResponse {
  enabled: boolean
  filePath: string
  mountAvailable: boolean
  bridges: readonly BridgeView[]
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init })
  const body = (await response.json()) as { ok: boolean; value?: T; error?: { message?: string } }
  if (!response.ok || body.ok !== true) throw new Error(body.error?.message ?? `HTTP ${response.status}`)
  return body.value as T
}

interface Draft {
  id: string | null
  dialect: 'native' | 'claude-code' | 'codex'
  enabled: boolean
  configSource: 'file' | 'inline'
  configPath: string
  configContent: string
  pluginRoot: string
  projectDir: string
  model: string
  defaultTimeoutMs: string
  stderrSummaryMaxChars: string
}

function emptyDraft(): Draft {
  return { id: null, dialect: 'native', enabled: true, configSource: 'inline', configPath: '', configContent: '', pluginRoot: '', projectDir: '', model: '', defaultTimeoutMs: '', stderrSummaryMaxChars: '' }
}
function draftFromView(view: BridgeView): Draft {
  return {
    id: view.id,
    dialect: view.dialect === 'codex' ? 'codex' : view.dialect === 'claude-code' ? 'claude-code' : 'native',
    enabled: view.enabled,
    configSource: view.configSource === 'inline' ? 'inline' : 'file',
    configPath: view.configPath,
    configContent: view.configContent ?? '',
    pluginRoot: view.pluginRoot ?? '',
    projectDir: view.projectDir ?? '',
    model: view.model ?? '',
    defaultTimeoutMs: view.defaultTimeoutMs === undefined ? '' : String(view.defaultTimeoutMs),
    stderrSummaryMaxChars: view.stderrSummaryMaxChars === undefined ? '' : String(view.stderrSummaryMaxChars),
  }
}

const NATIVE_PLACEHOLDER = JSON.stringify({ rules: [
  { name: 'Não modificar diretórios gerados', on: 'pre-tool-use', matcher: 'write|edit', action: 'block', message: 'Arquivos em diretórios gerados não podem ser modificados' },
  { name: 'Lembrete de padrões de código', on: 'prompt-submit', action: 'context', message: 'Siga sempre os padrões de contribuição do projeto' },
] }, null, 2)

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  mounted: { label: 'Montado', className: 'dshHk-badge dshHk-badgeOn' },
  starting: { label: 'Montando', className: 'dshHk-badge' },
  disabled: { label: 'Desativado', className: 'dshHk-badge dshHk-badgeOff' },
  error: { label: 'Falha ao montar', className: 'dshHk-badge dshHk-badgeErr' },
  unavailable: { label: 'Não suportado pelo kernel', className: 'dshHk-badge dshHk-badgeErr' },
}

export function HooksSection(): ReactNode {
  const [data, setData] = useState<HooksResponse | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<BridgeView | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setData(await fetchJson<HooksResponse>(`${ROUTE}/hooks`)); setError(undefined) }
    catch (f) { setError(f instanceof Error ? f.message : String(f)) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (notice === undefined) return
    const timer = setTimeout(() => { setNotice(undefined) }, 5_000)
    return () => { clearTimeout(timer) }
  }, [notice])

  const post = useCallback(async (path: string, body: Record<string, unknown>) => {
    setBusy(true); setNotice(undefined)
    try {
      const value = await fetchJson<HooksResponse>(`${ROUTE}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      setData(value)
    } catch (f) { setError(f instanceof Error ? f.message : String(f)); throw f }
    finally { setBusy(false) }
  }, [])

  const onSave = useCallback(async () => {
    if (draft === null) return
    const inlineMode = draft.dialect === 'native' || draft.configSource === 'inline'
    const body: Record<string, unknown> = {
      dialect: draft.dialect,
      enabled: draft.id === null ? true : draft.enabled,
      configSource: inlineMode ? 'inline' : 'file',
    }
    if (inlineMode) {
      const content = draft.configContent.trim()
      if (content === '') { setError('O conteúdo da configuração não pode ficar vazio'); return }
      body.configContent = draft.configContent
    } else {
      const configPath = draft.configPath.trim()
      if (configPath === '') { setError('Informe o caminho absoluto de hooks.json'); return }
      // Empty-only gate here: the absolute-path shape is validated server-side
      // (validateBridge → 400 with a zh-CN reason, surfaced by post), so the
      // client never duplicates that rule.
      body.configPath = configPath
    }
    if (draft.dialect === 'claude-code') {
      if (draft.pluginRoot.trim() !== '') body.pluginRoot = draft.pluginRoot.trim()
      if (draft.projectDir.trim() !== '') body.projectDir = draft.projectDir.trim()
    } else if (draft.dialect === 'codex') {
      if (draft.model.trim() !== '') body.model = draft.model.trim()
    }
    for (const [field, val] of [['defaultTimeoutMs', draft.defaultTimeoutMs], ['stderrSummaryMaxChars', draft.stderrSummaryMaxChars]] as const) {
      if (val.trim() !== '') {
        // Empty-only gate: positivity is enforced server-side (400, surfaced by
        // post); a non-numeric entry serializes to null and is rejected there.
        body[field] = Number(val)
      }
    }
    try {
      await post(draft.id === null ? 'bridge/create' : 'bridge/update', draft.id === null ? body : { ...body, id: draft.id })
      setDraft(null)
      setNotice(draft.id === null ? 'Adicionado e montado' : 'Salvo e montado novamente')
    } catch { /* post surfaced the error */ }
  }, [draft, post])

  const onToggle = useCallback(async (view: BridgeView) => {
    try { await post('bridge/update', { ...view, enabled: !view.enabled }); setNotice(!view.enabled ? 'Ativado' : 'Desativado') }
    catch { /* post surfaced */ }
  }, [post])

  const onDelete = useCallback(async (view: BridgeView) => {
    try {
      await post('bridge/delete', { id: view.id })
      if (draft?.id === view.id) setDraft(null)
      setConfirmTarget(null)
      setNotice('Excluído')
    } catch { /* post surfaced */ }
  }, [draft, post])

  const sorted = useMemo(() => data === null ? [] : [...data.bridges].sort((a, b) => a.dialect.localeCompare(b.dialect) || a.configPath.localeCompare(b.configPath)), [data])

  return (
    <div className="dshHk-section">
      <p className="dshHk-title">Ganchos</p>
      <p className="dshHk-hint">
        Reutilize uma configuração existente de hooks do Claude Code / Codex ou escreva uma aqui: hooks de comando para SessionStart, envio de prompts, antes/depois de chamadas de ferramentas e Stop entram em vigor automaticamente.
        Os comandos são executados localmente; confirme que a origem é confiável. Eles são montados imediatamente após o salvamento.
      </p>
      {error !== undefined ? <div className="dshHk-banner" role="alert">{error}</div> : null}
      {notice !== undefined ? <div className="dshHk-noticeOk">{notice}</div> : null}
      {data !== null && !data.mountAvailable ? <div className="dshHk-warning">O kernel atual não suporta montagem dinâmica: a configuração pode ser salva, mas não entrará em vigor.</div> : null}

      {draft !== null ? (
        <form className="dshHk-form" onSubmit={(e) => { e.preventDefault(); void onSave() }}>
          <p className="dshHk-formTitle">{draft.id === null ? 'Adicionar configuração de Hook' : 'Editar configuração de Hook'}</p>
          <div className="dshHk-row">
            <div className="dshHk-field">
              <span className="dshHk-label">Tipo</span>
              <div className="dshHk-radioGroup" role="radiogroup" aria-label="Tipo">
                <label><input type="radio" name="dshHkDialect" checked={draft.dialect === 'native'} disabled={busy} onChange={() => { setDraft({ ...draft, dialect: 'native' }) }} />DSH nativo (recomendado)</label>
                <label><input type="radio" name="dshHkDialect" checked={draft.dialect === 'claude-code'} disabled={busy} onChange={() => { setDraft({ ...draft, dialect: 'claude-code' }) }} />Compatível com Claude Code</label>
                <label><input type="radio" name="dshHkDialect" checked={draft.dialect === 'codex'} disabled={busy} onChange={() => { setDraft({ ...draft, dialect: 'codex' }) }} />Compatível com Codex</label>
              </div>
              <span className="dshHk-fieldHint">O formato nativo do DSH pertence ao aplicativo e tem regras mais simples. Os formatos compatíveis reutilizam arquivos de hooks do Claude Code ou Codex. O aplicativo apenas lê e gerencia a configuração; não grava nos diretórios de instalação.</span>
            </div>
          </div>

          {draft.dialect !== 'native' && (
            <div className="dshHk-field">
              <span className="dshHk-label">Origem da configuração</span>
              <div className="dshHk-radioGroup" role="radiogroup" aria-label="Origem da configuração">
                <label><input type="radio" name="dshHkSource" checked={draft.configSource === 'file'} disabled={busy} onChange={() => { setDraft({ ...draft, configSource: 'file' }) }} />Importar configuração existente</label>
                <label><input type="radio" name="dshHkSource" checked={draft.configSource === 'inline'} disabled={busy} onChange={() => { setDraft({ ...draft, configSource: 'inline' }) }} />Escrever manualmente</label>
              </div>
            </div>
          )}

          {draft.dialect === 'native' ? (
            <div className="dshHk-field">
              <span className="dshHk-label">Configuração das regras</span>
              <textarea className="dshHk-input" style={{ minHeight: '220px', fontFamily: 'ui-monospace,monospace', whiteSpace: 'pre', overflowX: 'auto' }} value={draft.configContent} spellCheck={false} disabled={busy}
                placeholder={NATIVE_PLACEHOLDER}
                onChange={(e) => { setDraft({ ...draft, configContent: e.target.value }) }} />
              <span className="dshHk-fieldHint">
                 Campos: name (nome), on (momento: pre-tool-use / post-tool-use / prompt-submit / session-start), matcher (regex opcional para nome da ferramenta), action (block = bloquear, context = inserir contexto de aviso), message (motivo do bloqueio ou texto do aviso).
              </span>
            </div>
          ) : draft.configSource === 'file' ? (
            <div className="dshHk-field dshHk-fieldGrow">
               <span className="dshHk-label">Caminho do arquivo de configuração</span>
              <input className="dshHk-input" value={draft.configPath} placeholder="ex.: D:/proj/.claude/hooks.json" disabled={busy} onChange={(e) => { setDraft({ ...draft, configPath: e.target.value }) }} />
               <span className="dshHk-fieldHint">Aponte para um hooks.json existente; o aplicativo apenas lê o arquivo e não o modifica.</span>
            </div>
          ) : (
            <div className="dshHk-field">
               <span className="dshHk-label">Conteúdo da configuração</span>
              <textarea className="dshHk-input" style={{ minHeight: '200px', fontFamily: 'ui-monospace,monospace', whiteSpace: 'pre', overflowX: 'auto' }} value={draft.configContent} spellCheck={false} disabled={busy}
                placeholder={'{\n  "hooks": {\n    "Stop": [\n      { "hooks": [{ "type": "command", "command": "echo done" }] }\n    ]\n  }\n}'}
                onChange={(e) => { setDraft({ ...draft, configContent: e.target.value }) }} />
               <span className="dshHk-fieldHint">Escreva ou cole o conteúdo do hooks.json; depois de salvar, o aplicativo gerenciará o conteúdo sem exigir manutenção manual do arquivo.</span>
            </div>
          )}

          {draft.dialect === 'claude-code' && (
            <div className="dshHk-row">
              <div className="dshHk-field dshHk-fieldGrow">
                 <span className="dshHk-label">Diretório raiz do plugin (opcional)</span>
                <input className="dshHk-input" value={draft.pluginRoot} disabled={busy} onChange={(e) => { setDraft({ ...draft, pluginRoot: e.target.value }) }} />
                 <span className="dshHk-fieldHint">Substitui este valor quando um comando referencia o caminho do plugin</span>
              </div>
              <div className="dshHk-field dshHk-fieldGrow">
                 <span className="dshHk-label">Diretório do projeto (opcional)</span>
                <input className="dshHk-input" value={draft.projectDir} disabled={busy} onChange={(e) => { setDraft({ ...draft, projectDir: e.target.value }) }} />
                 <span className="dshHk-fieldHint">Substitui este valor quando um comando referencia o caminho do projeto; o padrão é o workspace da sessão</span>
              </div>
            </div>
          )}
          {draft.dialect === 'codex' && (
            <div className="dshHk-field dshHk-fieldGrow">
               <span className="dshHk-label">Nome do modelo (opcional)</span>
              <input className="dshHk-input" value={draft.model} placeholder="ex.: deepseek-v4" disabled={busy} onChange={(e) => { setDraft({ ...draft, model: e.target.value }) }} />
               <span className="dshHk-fieldHint">Nome do modelo gravado nos eventos Codex</span>
            </div>
          )}
          <div className="dshHk-row">
            <div className="dshHk-field">
               <span className="dshHk-label">Tempo limite padrão em ms (opcional)</span>
              <input className="dshHk-input" value={draft.defaultTimeoutMs} placeholder="600000" disabled={busy} onChange={(e) => { setDraft({ ...draft, defaultTimeoutMs: e.target.value }) }} />
            </div>
            <div className="dshHk-field">
               <span className="dshHk-label">Limite do resumo stderr (opcional)</span>
              <input className="dshHk-input" value={draft.stderrSummaryMaxChars} placeholder="500" disabled={busy} onChange={(e) => { setDraft({ ...draft, stderrSummaryMaxChars: e.target.value }) }} />
            </div>
          </div>
          <div className="dshHk-formActions">
            <button type="submit" className="dshHk-button dshHk-buttonPrimary" disabled={busy}>{busy ? 'Salvando…' : draft.id === null ? 'Adicionar e montar' : 'Salvar e montar novamente'}</button>
            <button type="button" className="dshHk-button" disabled={busy} onClick={() => { setDraft(null); setError(undefined) }}>Cancelar</button>
          </div>
        </form>
      ) : (
        <div className="dshHk-toolbar">
          <span className="dshHk-count">{data === null ? '' : `${String(data.bridges.length)} configurações`}</span>
          <button type="button" className="dshHk-button dshHk-buttonPrimary" disabled={busy || (data !== null && !data.enabled)} onClick={() => { setDraft(emptyDraft()); setError(undefined) }}>Adicionar configuração de Hook</button>
        </div>
      )}

      <div className="dshHk-list">
        {sorted.length === 0 && draft === null ? <div className="dshHk-empty">Nenhuma configuração de Hook. Importe um hooks.json existente ou escreva uma manualmente.</div> : null}
        {sorted.map((view) => {
          const badge = STATUS_BADGE[view.status.state] ?? STATUS_BADGE.disabled
          return (
            <div key={view.id} className="dshHk-card">
              <div className="dshHk-cardHead">
                <span className="dshHk-dialect">{view.dialect === 'native' ? 'DSH nativo' : view.dialect}</span>
                <span className="dshHk-badge">{view.configSource === 'inline' ? 'Escrito no app' : 'Arquivo'}</span>
                <span className={badge.className}>{badge.label}</span>
              </div>
              {view.status.message !== undefined ? <div className="dshHk-warning">{view.status.message}</div> : null}
              <div className="dshHk-meta">{view.configPath}</div>
              <div className="dshHk-cardActions">
                <button type="button" className="dshHk-toggle" role="switch" aria-checked={view.enabled} aria-label="Ativar/desativar" disabled={busy} onClick={() => { void onToggle(view) }} />
                <button type="button" className="dshHk-button" disabled={busy} onClick={() => { setDraft(draftFromView(view)) }}>Editar</button>
                <button type="button" className="dshHk-button dshHk-buttonDanger" disabled={busy} onClick={() => { setConfirmTarget(view) }}>Excluir</button>
              </div>
            </div>
          )
        })}
      </div>
      {data !== null ? <p className="dshHk-path" title={data.filePath}>Arquivo de configuração: {data.filePath}</p> : null}
      <ConfirmDialog
        open={confirmTarget !== null}
        title="Excluir configuração de Hook"
        message="A configuração deixará de ser executada e a entrada correspondente será removida do arquivo."
        confirmLabel="Excluir"
        busy={busy}
        onConfirm={() => { if (confirmTarget !== null) void onDelete(confirmTarget) }}
        onClose={() => { setConfirmTarget(null) }}
      />
    </div>
  )
}
