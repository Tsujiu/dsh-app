/**
 * The MCP settings section: server cards with live mount status, an add/edit
 * dialog with a FORM/JSON toggle (VS Code MCP editor style — the JSON side
 * speaks the standard mcpServers shape), and a bulk JSON import over the
 * host's /server/import route. Saves apply to the running process inline, so
 * a save is always also the deployment.
 *
 * Secret hygiene: literal env/header values come back from the host masked
 * (••••••); a form or JSON view that leaves the mask untouched sends it back
 * and the host keeps the stored value. `$ENV:NAME` references are verbatim.
 *
 * @module @dsh-app/plugin-mcp/client/mcp-section
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { entryToExternal, mapExternalServer, parseMcpServersJson, McpValidationError } from '../wire.ts'
import { ConfirmDialog } from './confirm-dialog.tsx'

const ROUTE = '/plugins/@dsh-app/plugin-mcp/api'

/** The host route's payload (mirror of McpServersResponse). */
interface ServerView {
  readonly id: string
  readonly serverName: string
  readonly transport: string
  readonly enabled: boolean
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly toolCallTimeoutMs?: number
  readonly status: { readonly state: string, readonly message?: string, readonly toolCount?: number }
}

interface ServersResponse {
  readonly enabled: boolean
  readonly filePath: string
  readonly mountAvailable: boolean
  readonly servers: readonly ServerView[]
  readonly imported?: readonly string[]
  readonly renamed?: ReadonlyArray<{ readonly from: string, readonly to: string }>
  readonly failed?: ReadonlyArray<{ readonly name: string, readonly reason: string }>
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init })
  const body = (await response.json()) as { ok: boolean, value?: T, error?: { message?: string } }
  if (!response.ok || body.ok !== true) {
    throw new Error(body.error?.message ?? `HTTP ${response.status}`)
  }
  return body.value as T
}

/** Editable form state; every field is a string (textareas included). */
interface Draft {
  id: string | null
  serverName: string
  transport: 'stdio' | 'streamable-http'
  enabled: boolean
  command: string
  argsText: string
  envText: string
  cwd: string
  url: string
  headersText: string
  toolCallTimeoutMs: string
}

function emptyDraft(): Draft {
  return {
    id: null,
    serverName: '',
    transport: 'stdio',
    enabled: true,
    command: '',
    argsText: '',
    envText: '',
    cwd: '',
    url: '',
    headersText: '',
    toolCallTimeoutMs: '',
  }
}

function draftFromView(view: ServerView): Draft {
  return {
    id: view.id,
    serverName: view.serverName,
    transport: view.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
    enabled: view.enabled,
    command: view.command ?? '',
    argsText: (view.args ?? []).join('\n'),
    envText: Object.entries(view.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'),
    cwd: view.cwd ?? '',
    url: view.url ?? '',
    headersText: Object.entries(view.headers ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'),
    toolCallTimeoutMs: view.toolCallTimeoutMs === undefined ? '' : String(view.toolCallTimeoutMs),
  }
}

/** `KEY=VALUE` per line → record; a line without `=` is an error. */
function parseKeyValue(text: string): { ok: true, value: Record<string, string> } | { ok: false, reason: string } {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) return { ok: false, reason: `Formato de par incorreto: "${trimmed}" (esperado KEY=VALUE)` }
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return { ok: true, value: out }
}

/** Serialize the current form state into the external mcpServers fragment.
 * An untouched new draft (no name yet) serializes to '' — the textarea then
 * shows its placeholder example instead of a nonsense `"": {...}` fragment. */
function draftToExternal(draft: Draft): string {
  if (draft.id === null && draft.serverName.trim() === '') return ''
  const args = draft.argsText.split('\n').map(line => line.trim()).filter(line => line !== '')
  const env = parseKeyValue(draft.envText)
  const headers = parseKeyValue(draft.headersText)
  const timeout = Number(draft.toolCallTimeoutMs)
  return JSON.stringify(entryToExternal({
    serverName: draft.serverName,
    transport: draft.transport,
    ...(draft.transport === 'stdio'
      ? { command: draft.command.trim(), ...(args.length > 0 ? { args } : {}), ...(env.ok ? { env: env.value } : {}), ...(draft.cwd.trim() !== '' ? { cwd: draft.cwd.trim() } : {}) }
      : { url: draft.url.trim(), ...(headers.ok ? { headers: headers.value } : {}) }),
    ...(draft.toolCallTimeoutMs.trim() !== '' && Number.isFinite(timeout) && timeout > 0 ? { toolCallTimeoutMs: timeout } : {}),
  }), null, 2)
}

/**
 * Parse the JSON editor's text into an updated draft. Accepts a bare
 * `{"name": {...}}` fragment (the editor's own serialization) or a wrapped
 * `{"mcpServers": {...}}` paste — the latter only when it holds exactly one
 * server, because the edit dialog is one server's editor (use Import JSON for
 * bulk). Throws Error with a zh-CN reason.
 */
function draftFromJson(text: string, previous: Draft): Draft {
  const parsed = parseMcpServersJson(text)
  if (parsed.length !== 1) {
    throw new Error(`O modo de edição corresponde a apenas um servidor (o JSON atual contém ${String(parsed.length)}); para configuração em lote, use "Importar JSON" na lista`)
  }
  const { name, def } = parsed[0]
  const raw = mapExternalServer(name, def) as Record<string, unknown>
  const env = (raw.env as Record<string, string> | undefined) ?? {}
  const headers = (raw.headers as Record<string, string> | undefined) ?? {}
  return {
    ...previous,
    serverName: String(raw.serverName),
    transport: raw.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
    command: typeof raw.command === 'string' ? raw.command : '',
    argsText: Array.isArray(raw.args) ? (raw.args as string[]).join('\n') : '',
    envText: Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n'),
    cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
    url: typeof raw.url === 'string' ? raw.url : '',
    headersText: Object.entries(headers).map(([key, value]) => `${key}=${value}`).join('\n'),
    toolCallTimeoutMs: raw.toolCallTimeoutMs === undefined ? '' : String(raw.toolCallTimeoutMs),
  }
}

/** One structured save body from either editor view. */
function bodyFromDraft(draft: Draft): Record<string, unknown> {
  const name = draft.serverName.trim()
  // Empty-only gate: the serverName shape is validated server-side
  // (validateEntry → 400 with a zh-CN reason); the client never duplicates it.
  if (name === '') {
    throw new McpValidationError('Informe o nome do servidor (serverName)')
  }
  const body: Record<string, unknown> = {
    serverName: name,
    transport: draft.transport,
    // Preserve the entry's own enabled state: saving an edit to a disabled
    // server must not implicitly re-enable and mount it.
    enabled: draft.id === null ? true : draft.enabled,
  }
  if (draft.transport === 'stdio') {
    if (draft.command.trim() === '') {
      throw new McpValidationError('Um servidor stdio deve informar o comando de inicialização (command)')
    }
    body.command = draft.command.trim()
    const args = draft.argsText.split('\n').map(line => line.trim()).filter(line => line !== '')
    if (args.length > 0) body.args = args
    if (draft.envText.trim() !== '') {
      const env = parseKeyValue(draft.envText)
      if (!env.ok) throw new McpValidationError(env.reason)
      body.env = env.value
    }
    if (draft.cwd.trim() !== '') body.cwd = draft.cwd.trim()
  } else {
    const url = draft.url.trim()
    // Empty-only gate: URL legality is validated server-side (validateEntry →
    // 400); an empty value is rejected here so a blank form never posts.
    if (url === '') {
      throw new McpValidationError('Informe a URL do servidor streamable-http')
    }
    body.url = url
    if (draft.headersText.trim() !== '') {
      const headers = parseKeyValue(draft.headersText)
      if (!headers.ok) throw new McpValidationError(headers.reason)
      body.headers = headers.value
    }
  }
  if (draft.toolCallTimeoutMs.trim() !== '') {
    // Empty-only gate: positivity is enforced server-side (validateEntry →
    // 400); a non-numeric entry serializes to null and is rejected there.
    body.toolCallTimeoutMs = Number(draft.toolCallTimeoutMs)
  }
  return body
}

const STATUS_BADGE: Record<string, { label: string, className: string }> = {
  mounted: { label: 'Montado', className: 'dshMcp-badge dshMcp-badgeOn' },
  starting: { label: 'Montando', className: 'dshMcp-badge' },
  disabled: { label: 'Desativado', className: 'dshMcp-badge dshMcp-badgeOff' },
  error: { label: 'Falha ao montar', className: 'dshMcp-badge dshMcp-badgeErr' },
  unavailable: { label: 'Não suportado pelo kernel', className: 'dshMcp-badge dshMcp-badgeErr' },
}

export function McpSection(): ReactNode {
  const [data, setData] = useState<ServersResponse | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editView, setEditView] = useState<'form' | 'json'>('form')
  const [jsonText, setJsonText] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importReport, setImportReport] = useState<{ imported: readonly string[], renamed: ReadonlyArray<{ from: string, to: string }>, failed: ReadonlyArray<{ name: string, reason: string }> } | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<ServerView | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const value = await fetchJson<ServersResponse>(`${ROUTE}/servers`)
      setData(value)
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Success notices are transient: auto-clear shortly after they appear, so
  // the user isn't left with a stale toast until the next navigation. Errors
  // stay until the next action (they carry actionable context worth reading).
  useEffect(() => {
    if (notice === undefined) return
    const timer = setTimeout(() => { setNotice(undefined) }, 5_000)
    return () => { clearTimeout(timer) }
  }, [notice])

  const post = useCallback(async (path: string, body: Record<string, unknown>) => {
    setBusy(true)
    setNotice(undefined)
    try {
      const value = await fetchJson<ServersResponse>(`${ROUTE}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setData(value)
      return value
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      throw failure
    } finally {
      setBusy(false)
    }
  }, [])

  const openEdit = useCallback((view: ServerView) => {
    const next = draftFromView(view)
    setDraft(next)
    setEditView('form')
    setJsonText(draftToExternal(next))
  }, [])

  /** JSON → form: only switches when the JSON parses into one server. An
   * empty editor (untouched new draft) switches freely — nothing to parse. */
  const switchToForm = useCallback(() => {
    if (jsonText.trim() === '') {
      setEditView('form')
      setError(undefined)
      return
    }
    try {
      if (draft !== null) setDraft(draftFromJson(jsonText, draft))
      setEditView('form')
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [draft, jsonText])

  const onSave = useCallback(async () => {
    if (draft === null) return
    let body: Record<string, unknown>
    try {
      body = editView === 'json'
        ? (() => {
            const next = draftFromJson(jsonText, draft)
            return bodyFromDraft(next)
          })()
        : bodyFromDraft(draft)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      return
    }
    try {
      await post(draft.id === null ? 'server/create' : 'server/update', draft.id === null ? body : { ...body, id: draft.id })
      setDraft(null)
      setNotice(draft.id === null ? 'Adicionado e montado; as ferramentas já estão disponíveis para a sessão atual e as novas' : 'Salvo e montado novamente')
    } catch {
      // post() already surfaced the error banner.
    }
  }, [draft, editView, jsonText, post])

  const onImport = useCallback(async () => {
    try {
      const value = await post('server/import', { json: importText })
      const report = { imported: value.imported ?? [], renamed: value.renamed ?? [], failed: value.failed ?? [] }
      setImportReport(report)
      if (report.failed.length === 0) {
        setImportOpen(false)
        setImportText('')
        const renamedNote = report.renamed.length > 0
          ? ` (renomeados automaticamente: ${report.renamed.map(entry => `${entry.from} → ${entry.to}`).join(', ')})`
          : ''
        setNotice(`${String(report.imported.length)} servidores importados e montados${renamedNote}`)
      }
    } catch {
      // post() already surfaced the error banner.
    }
  }, [importText, post])

  const onToggle = useCallback(async (view: ServerView) => {
    try {
      await post('server/update', { ...view, enabled: !view.enabled })
      setNotice(!view.enabled ? `${view.serverName} ativado` : `${view.serverName} desativado`)
    } catch {
      // post() already surfaced the error banner.
    }
  }, [post])

  const onDelete = useCallback(async (view: ServerView) => {
    try {
      await post('server/delete', { id: view.id })
      if (draft?.id === view.id) setDraft(null)
      setConfirmTarget(null)
      setNotice(`${view.serverName} excluído`)
    } catch {
      // post() already surfaced the error banner.
    }
  }, [draft, post])

  const sortedServers = useMemo(() => {
    if (data === null) return []
    return [...data.servers].sort((a, b) => a.serverName.localeCompare(b.serverName))
  }, [data])

  const jsonInvalid = editView === 'json' && error !== undefined

  return (
    <div className="dshMcp-section">
      <p className="dshMcp-title">Servidores MCP</p>
      <p className="dshMcp-hint">
        Conecte servidores MCP externos ao modelo. As ferramentas aparecem como mcp__nome-do-servidor__nome-da-ferramenta.
        Servidores stdio iniciam um processo local; confirme que o comando é confiável. O salvamento monta o servidor imediatamente, sem reiniciar.
        Cole JSON no formato mcpServers, igual às configurações de Claude, Cursor e VS Code. As ferramentas ocupam contexto em cada conversa; ative apenas quando necessário.
      </p>

      {error !== undefined ? <div className="dshMcp-banner" role="alert">{error}</div> : null}
      {notice !== undefined ? <div className="dshMcp-noticeOk">{notice}</div> : null}
      {data !== null && !data.mountAvailable
        ? <div className="dshMcp-warning">O kernel atual não suporta montagem dinâmica de MCP: a configuração pode ser salva, mas o servidor não será montado e as ferramentas ficarão indisponíveis.</div>
        : null}

      {draft !== null
        ? (
          <form className="dshMcp-form" onSubmit={(event) => { event.preventDefault(); void onSave() }}>
            <div className="dshMcp-formHead">
              <p className="dshMcp-formTitle">{draft.id === null ? 'Adicionar servidor MCP' : `Editar ${draft.serverName}`}</p>
              <div className="dshMcp-viewToggle" role="tablist" aria-label="Visualização de edição">
                <button
                  type="button"
                  role="tab"
                  aria-selected={editView === 'form'}
                  className={editView === 'form' ? 'dshMcp-viewBtn dshMcp-viewBtnOn' : 'dshMcp-viewBtn'}
                  disabled={busy || editView === 'form'}
                  onClick={switchToForm}
                >Formulário</button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editView === 'json'}
                  className={editView === 'json' ? 'dshMcp-viewBtn dshMcp-viewBtnOn' : 'dshMcp-viewBtn'}
                  disabled={busy || editView === 'json'}
                  onClick={() => { setJsonText(draftToExternal(draft)); setEditView('json'); setError(undefined) }}
                >JSON</button>
              </div>
            </div>

            {editView === 'json'
              ? (
                <div className="dshMcp-field">
                   <span className="dshMcp-label">Configuração completa</span>
                  <textarea
                    className="dshMcp-textarea dshMcp-jsonArea"
                    value={jsonText}
                    spellCheck={false}
                    placeholder={'{\n  "figma": {\n    "type": "stdio",\n    "command": "npx",\n    "args": ["-y", "figma-developer-mcp"]\n  }\n}'}
                    disabled={busy}
                     aria-label="Configuração JSON do servidor MCP"
                    onChange={(event) => { setJsonText(event.target.value) }}
                  />
                  <span className="dshMcp-fieldHint">
                     Cole {'{"server-name": {...}}'} ou {'{"mcpServers": {"server-name": {...}}}'}; o modo de edição corresponde a um servidor. Use "Importar JSON" para lotes.
                     {jsonInvalid ? 'O conteúdo não pôde ser interpretado; corrija-o para salvar ou volte ao formulário.' : ''}
                  </span>
                </div>
              )
              : (
                <>
                  <div className="dshMcp-row">
                    <div className="dshMcp-field dshMcp-fieldGrow">
                       <span className="dshMcp-label">serverName (namespace das ferramentas)</span>
                      <input
                        className="dshMcp-input"
                        value={draft.serverName}
                         placeholder="ex.: github"
                        disabled={busy}
                        aria-label="serverName"
                        onChange={(event) => { setDraft({ ...draft, serverName: event.target.value }) }}
                      />
                       <span className="dshMcp-fieldHint">1 a 32 letras, números, sublinhados ou hífens; ferramentas usam mcp__nome-do-servidor__nome-da-ferramenta</span>
                    </div>
                    <div className="dshMcp-field">
                       <span className="dshMcp-label">Transporte</span>
                       <div className="dshMcp-radioGroup" role="radiogroup" aria-label="Transporte">
                        <label>
                          <input
                            type="radio"
                            name="dshMcpTransport"
                            checked={draft.transport === 'stdio'}
                            disabled={busy}
                            onChange={() => { setDraft({ ...draft, transport: 'stdio' }) }}
                          />
                          stdio (processo local)
                        </label>
                        <label>
                          <input
                            type="radio"
                            name="dshMcpTransport"
                            checked={draft.transport === 'streamable-http'}
                            disabled={busy}
                            onChange={() => { setDraft({ ...draft, transport: 'streamable-http' }) }}
                          />
                          Streamable HTTP
                        </label>
                      </div>
                    </div>
                  </div>

                  {draft.transport === 'stdio'
                    ? (
                      <>
                        <div className="dshMcp-row">
                          <div className="dshMcp-field dshMcp-fieldGrow">
                            <span className="dshMcp-label">Comando de inicialização</span>
                            <input
                              className="dshMcp-input"
                              value={draft.command}
                              placeholder="ex.: npx"
                              disabled={busy}
                              aria-label="Comando de inicialização"
                              onChange={(event) => { setDraft({ ...draft, command: event.target.value }) }}
                            />
                          </div>
                          <div className="dshMcp-field">
                            <span className="dshMcp-label">Diretório de trabalho (opcional)</span>
                            <input
                              className="dshMcp-input"
                              value={draft.cwd}
                              disabled={busy}
                              aria-label="Diretório de trabalho"
                              onChange={(event) => { setDraft({ ...draft, cwd: event.target.value }) }}
                            />
                          </div>
                        </div>
                        <div className="dshMcp-field">
                          <span className="dshMcp-label">Argumentos (um por linha)</span>
                          <textarea
                            className="dshMcp-textarea"
                            value={draft.argsText}
                            placeholder={'-y\n@modelcontextprotocol/server-filesystem\nD:/workspace'}
                            disabled={busy}
                            aria-label="Argumentos de inicialização"
                            onChange={(event) => { setDraft({ ...draft, argsText: event.target.value }) }}
                          />
                        </div>
                        <div className="dshMcp-field">
                          <span className="dshMcp-label">Variáveis de ambiente (KEY=VALUE por linha; use $ENV:NOME para referenciar o ambiente)</span>
                          <textarea
                            className="dshMcp-textarea"
                            value={draft.envText}
                            placeholder={'GITHUB_TOKEN=$ENV:GITHUB_TOKEN'}
                            disabled={busy}
                            aria-label="Variáveis de ambiente"
                            onChange={(event) => { setDraft({ ...draft, envText: event.target.value }) }}
                          />
                        </div>
                      </>
                    )
                    : (
                      <>
                        <div className="dshMcp-field">
                           <span className="dshMcp-label">Endereço do serviço</span>
                          <input
                            className="dshMcp-input"
                            value={draft.url}
                            placeholder="http://127.0.0.1:3000/mcp"
                            disabled={busy}
                             aria-label="Endereço do serviço"
                            onChange={(event) => { setDraft({ ...draft, url: event.target.value }) }}
                          />
                        </div>
                        <div className="dshMcp-field">
                           <span className="dshMcp-label">Cabeçalhos (KEY=VALUE por linha; use $ENV:NOME para referenciar o ambiente)</span>
                          <textarea
                            className="dshMcp-textarea"
                            value={draft.headersText}
                            placeholder={'Authorization=$ENV:MCP_TOKEN'}
                            disabled={busy}
                             aria-label="Cabeçalhos"
                            onChange={(event) => { setDraft({ ...draft, headersText: event.target.value }) }}
                          />
                        </div>
                      </>
                    )}

                  <div className="dshMcp-row">
                    <div className="dshMcp-field">
                       <span className="dshMcp-label">Tempo limite de chamada de ferramenta (ms, opcional, padrão 60000)</span>
                      <input
                        className="dshMcp-input"
                        value={draft.toolCallTimeoutMs}
                        disabled={busy}
                         aria-label="Tempo limite da ferramenta"
                        onChange={(event) => { setDraft({ ...draft, toolCallTimeoutMs: event.target.value }) }}
                      />
                    </div>
                  </div>
                </>
              )}

            <div className="dshMcp-formActions">
              <button type="submit" className="dshMcp-button dshMcp-buttonPrimary" disabled={busy}>
                {busy ? 'Salvando…' : draft.id === null ? 'Adicionar e montar' : 'Salvar e montar novamente'}
              </button>
              <button type="button" className="dshMcp-button" disabled={busy} onClick={() => { setDraft(null); setError(undefined) }}>Cancelar</button>
            </div>
          </form>
        )
        : (
          <div className="dshMcp-toolbar">
            <span className="dshMcp-count">{data === null ? '' : `${String(data.servers.length)} servidores`}</span>
            <div className="dshMcp-toolbarActions">
              <button
                type="button"
                className="dshMcp-button"
                disabled={busy || (data !== null && !data.enabled)}
                onClick={() => { setImportOpen(true); setImportReport(null); setError(undefined) }}
              >Importar JSON</button>
              <button
                type="button"
                className="dshMcp-button dshMcp-buttonPrimary"
                disabled={busy || (data !== null && !data.enabled)}
                onClick={() => { setDraft(emptyDraft()); setEditView('form'); setError(undefined) }}
              >Adicionar servidor</button>
            </div>
          </div>
        )}

      {importOpen
        ? (
          <form className="dshMcp-form" onSubmit={(event) => { event.preventDefault(); void onImport() }}>
            <p className="dshMcp-formTitle">Importar do JSON</p>
            <div className="dshMcp-field">
              <span className="dshMcp-label">Configuração mcpServers</span>
              <textarea
                className="dshMcp-textarea dshMcp-jsonArea"
                value={importText}
                spellCheck={false}
                disabled={busy}
                placeholder={'{\n  "mcpServers": {\n    "context7": {\n      "type": "stdio",\n      "command": "npx",\n      "args": ["-y", "@upstash/context7-mcp"]\n    },\n    "exa": { "type": "http", "url": "https://mcp.exa.ai/mcp" }\n  }\n}'}
                aria-label="mcpServers JSON"
                onChange={(event) => { setImportText(event.target.value) }}
              />
              <span className="dshMcp-fieldHint">
                Cole {'{"server-name": {...}}'} ou uma configuração completa com {"mcpServers"} (formato de Claude, Cursor e VS Code). A importação é individual; falhas não afetam os demais itens.
              </span>
            </div>
            {importReport !== null
              ? (
                <div className="dshMcp-importReport">
                  {importReport.imported.length > 0
                      ? <div className="dshMcp-noticeOk">Importados: {importReport.imported.join(', ')}</div>
                    : null}
                  {importReport.renamed.map(entry => (
                    <div key={entry.to} className="dshMcp-warning">
                       Renomeado automaticamente: {entry.from} → {entry.to} (o nome vira o namespace mcp__nome__ferramenta e não pode conter espaços)
                    </div>
                  ))}
                  {importReport.failed.map(entry => (
                    <div key={entry.name} className="dshMcp-banner">{entry.name}：{entry.reason}</div>
                  ))}
                </div>
              )
              : null}
            <div className="dshMcp-formActions">
              <button type="submit" className="dshMcp-button dshMcp-buttonPrimary" disabled={busy || importText.trim() === ''}>
                 {busy ? 'Importando…' : 'Importar e montar'}
              </button>
              <button type="button" className="dshMcp-button" disabled={busy} onClick={() => { setImportOpen(false); setImportReport(null) }}>Fechar</button>
            </div>
          </form>
        )
        : null}

      {data !== null && !data.enabled
        ? <div className="dshMcp-warning">O gerenciamento MCP foi desativado (enabled: false): a lista é somente leitura. Edite a configuração e reinicie para ativá-lo.</div>
        : null}

      <div className="dshMcp-list">
        {sortedServers.length === 0 && draft === null && !importOpen
          ? <div className="dshMcp-empty">Nenhum servidor MCP configurado. Adicione um, como filesystem ou github, ou cole um JSON mcpServers existente.</div>
          : null}
        {sortedServers.map((view) => {
          const badge = STATUS_BADGE[view.status.state] ?? STATUS_BADGE.disabled
          const meta = view.transport === 'stdio'
            ? `${view.command ?? ''} ${(view.args ?? []).join(' ')}`
            : view.url ?? ''
          return (
            <div key={view.id} className="dshMcp-card">
              <div className="dshMcp-cardHead">
                <span className="dshMcp-serverName">{view.serverName}</span>
                <span className="dshMcp-badge">{view.transport === 'stdio' ? 'stdio' : 'http'}</span>
                <span className={badge.className}>
                  {badge.label}{view.status.state === 'mounted' && view.status.toolCount !== undefined ? ` · ${String(view.status.toolCount)} ferramentas` : ''}
                </span>
              </div>
              {view.status.message !== undefined ? <div className="dshMcp-warning">{view.status.message}</div> : null}
              <div className="dshMcp-meta">{meta}</div>
              <div className="dshMcp-cardActions">
                <button
                  type="button"
                  className="dshMcp-toggle"
                  role="switch"
                  aria-checked={view.enabled}
                  aria-label={`Ativar ${view.serverName}`}
                  disabled={busy}
                  onClick={() => { void onToggle(view) }}
                />
                <button type="button" className="dshMcp-button" disabled={busy} onClick={() => { openEdit(view) }}>Editar</button>
                <button type="button" className="dshMcp-button dshMcp-buttonDanger" disabled={busy} onClick={() => { setConfirmTarget(view) }}>Excluir</button>
              </div>
            </div>
          )
        })}
      </div>

      {data !== null ? <p className="dshMcp-path" title={data.filePath}>Arquivo de configuração: {data.filePath}</p> : null}

      <ConfirmDialog
        open={confirmTarget !== null}
        title={`Excluir servidor MCP "${confirmTarget?.serverName ?? ''}"`}
        message="As ferramentas registradas por este servidor serão removidas imediatamente e sua entrada será excluída do arquivo de configuração."
        confirmLabel="Excluir"
        busy={busy}
        onConfirm={() => { if (confirmTarget !== null) void onDelete(confirmTarget) }}
        onClose={() => { setConfirmTarget(null) }}
      />
    </div>
  )
}
