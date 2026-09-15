/**
 * The memory settings section: master toggle, global stats, file path, and
 * the per-project memory list — each project row shows its own entry
 * count/size and a (confirmed, irreversible) clear action. All data flows
 * through the host half's routes; the toggle takes effect on the next
 * prompt assembly without a restart.
 *
 * @module @dsh-app/plugin-memory/client/memory-section
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ConfirmDialog } from './confirm-dialog.tsx'
import { ROUTE_PREFIX, type MemoryDistillActivity, type MemoryEntriesResponse, type MemoryProjectSummary, type MemoryStatus } from '../types.ts'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

/** Local wall-clock time for one distill trace, e.g. `14:03`. */
function fmtTime(at: number): string {
  const d = new Date(at)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Display name for a project: basename of the cwd, falling back to slug. */
function projectTitle(project: MemoryProjectSummary): string {
  if (project.cwd === '') return project.slug
  const parts = project.cwd.replace(/[\\/]+$/u, '').split(/[\\/]/u)
  return parts[parts.length - 1] ?? project.slug
}

/** Backend + token suffix for one distill trace, e.g. ` · chamada direta 1.2k tokens`. */
function formatBackend(item: MemoryDistillActivity): string {
  if (item.backend === undefined) return ''
  const channel = item.backend === 'direct' ? 'chamada direta' : 'subagente'
  if (item.tokens === undefined) return ` · ${channel}`
  const tokens = item.tokens >= 1000 ? `${(item.tokens / 1000).toFixed(1)}k` : String(item.tokens)
  return ` · ${channel} ${tokens} tokens`
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init })
  const body = (await response.json()) as { ok: boolean, value?: T, error?: { message?: string } }
  if (!response.ok || body.ok !== true) {
    throw new Error(body.error?.message ?? `HTTP ${response.status}`)
  }
  return body.value as T
}

/** Distill-activity rows shown before the "show all" fold (list caps at 20). */
const ACTIVITY_PREVIEW = 5

/** Global entry rows shown before the "show all" fold. */
const ENTRIES_PREVIEW = 5

/** Longest row excerpt a single-entry confirm quotes back; rows can be paragraphs. */
const FORGET_EXCERPT_CHARS = 120

/** What the confirm dialog is armed to destroy: a whole store, or a single row. */
type ConfirmState =
  | { kind: 'clear', scope: 'global' | 'project', slug: string, title: string, entries: number }
  | { kind: 'forget', scope: 'global' | 'project', slug: string, text: string, pinned: boolean }

/** Quote at most {@link FORGET_EXCERPT_CHARS} of a row back at the user. */
function excerpt(text: string): string {
  return text.length <= FORGET_EXCERPT_CHARS ? text : `${text.slice(0, FORGET_EXCERPT_CHARS)}…`
}

/** Dialog heading for the armed action. */
function confirmTitle(state: ConfirmState | null): string {
  if (state === null) return ''
  if (state.kind === 'clear') return state.scope === 'global' ? 'Limpar memória global' : 'Excluir memória do projeto'
  return state.pinned ? 'Excluir item fixado' : 'Excluir esta memória'
}

/** Dialog body for the armed action. */
function confirmMessage(state: ConfirmState | null): string {
  if (state === null) return ''
  if (state.kind === 'clear') {
    return `A memória ${state.scope === 'global' ? 'global' : `do projeto "${state.title}"`} será excluída (${String(state.entries)} itens); essa ação não pode ser desfeita.`
  }
  const where = state.scope === 'global' ? 'memória global' : 'memória do projeto'
  return `Este item será excluído da ${where}:\n"${excerpt(state.text)}"\nEssa ação não pode ser desfeita.`
}

export function MemorySection(): ReactNode {
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<ConfirmState | null>(null)
  const [activityExpanded, setActivityExpanded] = useState(false)
  const [entriesExpanded, setEntriesExpanded] = useState(false)
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const [projectRows, setProjectRows] = useState<{ slug: string, entries: MemoryEntriesResponse['entries'] } | null>(null)
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    try {
      setStatus(await fetchJson<MemoryStatus>(`${ROUTE_PREFIX}/status`))
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [])

  const loadProjectRows = useCallback(async (slug: string) => {
    const data = await fetchJson<MemoryEntriesResponse>(`${ROUTE_PREFIX}/entries?slug=${encodeURIComponent(slug)}`)
    setProjectRows({ slug, entries: data.entries })
  }, [])

  useEffect(() => { void load() }, [load])

  const onToggle = useCallback(async () => {
    if (status === null || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setNotice(undefined)
    try {
      const next = !status.enabled
      await fetchJson<{ enabled: boolean }>(`${ROUTE_PREFIX}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      setNotice(next ? 'Ativado: novas sessões receberão memórias e o modelo poderá registrá-las' : 'Desativado: novas sessões não receberão memórias e a ferramenta de salvamento recusará gravações')
      await load()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
      inFlight.current = false
    }
  }, [status, load])

  const onToggleDistill = useCallback(async () => {
    if (status === null || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setNotice(undefined)
    try {
      const next = !status.distill
      await fetchJson(`${ROUTE_PREFIX}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ distill: next }),
      })
      setNotice(next ? 'Refinamento em segundo plano ativado: após 1 minuto de silêncio, conteúdo novo suficiente será salvo na memória do projeto' : 'Refinamento em segundo plano desativado: somente registros imediatos da conversa serão mantidos')
      await load()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
      inFlight.current = false
    }
  }, [status, load])

  const onPin = useCallback(async (scope: 'global' | 'project', slug: string, text: string, pinned: boolean) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setNotice(undefined)
    try {
      await fetchJson(`${ROUTE_PREFIX}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, pinned, ...(scope === 'project' ? { scope: 'project', slug } : {}) }),
      })
       setNotice(pinned ? 'Fixado: este item sempre será incluído na sessão e não será afetado pelo limite de injeção' : 'Fixação removida')
      if (scope === 'project') await loadProjectRows(slug)
      else await load()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
      inFlight.current = false
    }
  }, [load, loadProjectRows])

  /** Drop one row by exact content. Every caller goes through the confirm dialog. */
  const runForget = useCallback(async (scope: 'global' | 'project', slug: string, text: string) => {
    const result = await fetchJson<{ forgotten: number }>(`${ROUTE_PREFIX}/forget`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match: text, ...(scope === 'project' ? { scope: 'project', slug } : {}) }),
    })
    setNotice(result.forgotten > 0 ? `${String(result.forgotten)} memórias excluídas` : 'Nenhum item correspondente foi encontrado')
    if (scope === 'project') { await loadProjectRows(slug); await load() }
    else await load()
  }, [load, loadProjectRows])

  const onToggleProject = useCallback(async (project: MemoryProjectSummary) => {
    if (openSlug === project.slug) {
      setOpenSlug(null)
      return
    }
    setOpenSlug(project.slug)
    setProjectRows(null)
    setNotice(undefined)
    try {
      await loadProjectRows(project.slug)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setOpenSlug(null)
    }
  }, [openSlug, loadProjectRows])

  /** Run whatever the confirm dialog was armed for: clear a store, or drop one row. */
  const onConfirm = useCallback(async () => {
    const target = confirming
    if (target === null || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setConfirming(null)
    setNotice(undefined)
    try {
      if (target.kind === 'clear') {
        await fetchJson(`${ROUTE_PREFIX}/clear`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(target.scope === 'global' ? { scope: 'global' } : { scope: 'project', slug: target.slug }),
        })
        setNotice(target.scope === 'global' ? 'Memória global limpa' : `Memória do projeto "${target.title}" excluída`)
        await load()
      } else {
        await runForget(target.scope, target.slug, target.text)
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
      inFlight.current = false
    }
  }, [confirming, load, runForget])

  return (
    <div className="dshm_section">
      <p className="dshm_title">Memória da sessão</p>
      <p className="dshm_hint">
         O modelo registra ativamente informações duradouras durante a conversa (persistentes entre sessões), e cada nova sessão as recebe automaticamente.
         A memória global (preferências e hábitos) vale para todos os projetos e só pode ser salva pelo AI ou escrita por você; a memória do projeto (decisões, acordos e aprendizados) é injetada apenas nas sessões desse projeto e complementada pelo refinamento em segundo plano, sem mistura entre projetos.
         As memórias não contêm chaves nem outros dados sensíveis; o arquivo é texto puro e pode ser editado manualmente.
      </p>

      {error !== undefined ? <div className="dshm_banner" role="alert">{error}</div> : null}
      {notice !== undefined ? <div className="dshm_noticeOk">{notice}</div> : null}
      {/* A destructive confirmation is a body-portal modal, not a banner at the
          top of the section: the button that armed it sits far down the list,
          so a top-anchored banner would make the user hunt for it. */}
      <ConfirmDialog
        open={confirming !== null}
        title={confirmTitle(confirming)}
        message={confirmMessage(confirming)}
         confirmLabel="Excluir"
        busy={busy}
        onConfirm={() => { void onConfirm() }}
        onClose={() => { setConfirming(null) }}
      />

      <div className="dshm_toggleRow">
         <span className="dshm_toggleLabel">Ativar memória da sessão ({status === null ? '…' : status.enabled ? 'ativada' : 'desativada'})</span>
        <button
          type="button"
          className="dshm_toggle"
          role="switch"
          aria-checked={status?.enabled ?? false}
           aria-label="Ativar memória da sessão"
          disabled={busy || status === null}
          onClick={() => { void onToggle() }}
        />
      </div>

      <div className="dshm_toggleRow">
        <span className="dshm_toggleLabel">
           Refinamento automático em segundo plano ({status === null ? '…' : status.distill ? 'ativado' : 'desativado'})
           <span className="dshm_toggleHint">Após 1 minuto de silêncio e conteúdo novo suficiente, o segundo plano registra memórias de projeto esquecidas (chamada direta ao modelo, baixo consumo)</span>
        </span>
        <button
          type="button"
          className="dshm_toggle"
          role="switch"
          aria-checked={status?.distill ?? false}
           aria-label="Refinamento automático em segundo plano"
          disabled={busy || status === null || (status !== null && !status.enabled)}
          onClick={() => { void onToggleDistill() }}
        />
      </div>

      <div className="dshm_cards">
        <div className="dshm_card">
           <div className="dshm_cardLabel">Itens de memória global</div>
          <div className="dshm_cardValue">{status === null ? '…' : String(status.entries)}</div>
        </div>
        <div className="dshm_card">
           <div className="dshm_cardLabel">Uso global</div>
          <div className="dshm_cardValue">{status === null ? '…' : fmtBytes(status.sizeBytes)}</div>
        </div>
        <div className="dshm_card">
           <div className="dshm_cardLabel">Projetos com memória</div>
          <div className="dshm_cardValue">{status === null ? '…' : String(status.projects.length)}</div>
        </div>
        <div className="dshm_card">
           <div className="dshm_cardLabel">Arquivo de memória global</div>
          <div className="dshm_cardPath" title={status?.filePath ?? ''}>{status === null ? '…' : status.filePath}</div>
        </div>
      </div>

      {status !== null && status.distill && status.activity.length > 0
        ? (
          <div className="dshm_projects">
             <div className="dshm_projectsTitle">Refinamentos recentes</div>
             <div className="dshm_hint">O refinamento roda após 1 minuto de silêncio e conteúdo novo suficiente; ele grava apenas memória do projeto (chamada direta ao modelo, baixo consumo). Abaixo estão os registros recentes (hora · sessão de origem · itens salvos · canal).</div>
            {status.activity.slice(0, activityExpanded ? status.activity.length : ACTIVITY_PREVIEW).map((item: MemoryDistillActivity) => (
              <div key={`${item.at}-${item.session}`} className="dshm_activityRow">
                <span className="dshm_activityTime">{fmtTime(item.at)}</span>
                <span className="dshm_activityMeta">Sessão {item.session} · {item.saved === 0 ? 'nenhum item novo' : `${String(item.saved)} itens salvos`}{formatBackend(item)}</span>
              </div>
            ))}
            {status.activity.length > ACTIVITY_PREVIEW
              ? (
                <button
                  type="button"
                  className="dshm_button dshm_activityMore"
                  aria-expanded={activityExpanded}
                  onClick={() => { setActivityExpanded(expanded => !expanded) }}
                >
                   {activityExpanded ? 'Recolher' : `Ver tudo (${String(status.activity.length)} itens)`}
                </button>
              )
              : null}
          </div>
        )
        : null}

      {status !== null && status.globalList.length > 0
        ? (
          <div className="dshm_projects">
             <div className="dshm_projectsTitle">Itens globais</div>
             <div className="dshm_hint">Itens fixados (📌) sempre são incluídos na sessão e não sofrem com o limite de injeção; os demais são escolhidos mantendo o item mais recente de cada categoria. A lista é ordenada do mais recente para o mais antigo e mostra por padrão os últimos {String(ENTRIES_PREVIEW)} itens.</div>
            {[...status.globalList].reverse().slice(0, entriesExpanded ? status.globalList.length : ENTRIES_PREVIEW).map((entry, index) => (
              <div key={`${entry.text}-${index}`} className="dshm_entryRow">
                <span className="dshm_entryText">{entry.text}</span>
                <button
                  type="button"
                  className={entry.pinned ? 'dshm_pinBtn dshm_pinBtnOn' : 'dshm_pinBtn'}
                  aria-pressed={entry.pinned}
                   aria-label={entry.pinned ? 'Remover fixação deste item' : 'Fixar este item'}
                  disabled={busy}
                  onClick={() => { void onPin('global', '', entry.text, !entry.pinned) }}
                 >{entry.pinned ? 'Fixado' : 'Fixar'}</button>
                <button
                  type="button"
                  className="dshm_button dshm_buttonDanger"
                   aria-label="Excluir este item"
                  disabled={busy}
                  onClick={() => { setConfirming({ kind: 'forget', scope: 'global', slug: '', text: entry.text, pinned: entry.pinned }) }}
                 >Excluir</button>
              </div>
            ))}
            {status.globalList.length > ENTRIES_PREVIEW
              ? (
                <button
                  type="button"
                  className="dshm_button dshm_activityMore"
                  aria-expanded={entriesExpanded}
                  onClick={() => { setEntriesExpanded(expanded => !expanded) }}
                >
                   {entriesExpanded ? 'Recolher' : `Ver tudo (${String(status.globalList.length)} itens)`}
                </button>
              )
              : null}
          </div>
        )
        : null}

      <div className="dshm_actions">
        <button
          type="button"
          className="dshm_button dshm_buttonDanger"
          disabled={busy || status === null || status.entries === 0}
          onClick={() => { setConfirming({ kind: 'clear', scope: 'global', slug: '', title: 'global', entries: status?.entries ?? 0 }) }}
         >Limpar memória global</button>
      </div>

      {status !== null && status.projects.length > 0
        ? (
          <div className="dshm_projects">
             <div className="dshm_projectsTitle">Memória dos projetos</div>
             <div className="dshm_hint">Clique em “Itens” para expandir os detalhes da memória do projeto e fixar ou excluir itens individualmente; “Excluir” remove todo o diretório de memória do projeto. A exclusão de itens e projetos exige confirmação.</div>
            {status.projects.map(project => (
              <div key={project.slug} className="dshm_projectBlock">
                <div className="dshm_projectRow">
                  <span className="dshm_projectName" title={project.cwd === '' ? project.slug : project.cwd}>{projectTitle(project)}</span>
                   <span className="dshm_projectMeta">{String(project.entries)} itens · {fmtBytes(project.sizeBytes)}</span>
                  <button
                    type="button"
                    className="dshm_button"
                    aria-expanded={openSlug === project.slug}
                    disabled={busy}
                    onClick={() => { void onToggleProject(project) }}
                   >{openSlug === project.slug ? 'Recolher' : 'Itens'}</button>
                  <button
                    type="button"
                    className="dshm_button dshm_buttonDanger"
                    disabled={busy}
                    onClick={() => { setConfirming({ kind: 'clear', scope: 'project', slug: project.slug, title: projectTitle(project), entries: project.entries }) }}
                   >Excluir</button>
                </div>
                {openSlug === project.slug
                  ? (
                    projectRows === null || projectRows.slug !== project.slug
                       ? <div className="dshm_hint">Carregando…</div>
                      : projectRows.entries.length === 0
                         ? <div className="dshm_hint">(Nenhum item)</div>
                        : [...projectRows.entries].reverse().map((entry, index) => (
                          <div key={`${entry.text}-${index}`} className="dshm_entryRow">
                            <span className="dshm_entryText">{entry.text}</span>
                            <button
                              type="button"
                              className={entry.pinned ? 'dshm_pinBtn dshm_pinBtnOn' : 'dshm_pinBtn'}
                              aria-pressed={entry.pinned}
                               aria-label={entry.pinned ? 'Remover fixação deste item' : 'Fixar este item'}
                              disabled={busy}
                              onClick={() => { void onPin('project', project.slug, entry.text, !entry.pinned) }}
                             >{entry.pinned ? 'Fixado' : 'Fixar'}</button>
                            <button
                              type="button"
                              className="dshm_button dshm_buttonDanger"
                               aria-label="Excluir este item"
                              disabled={busy}
                              onClick={() => { setConfirming({ kind: 'forget', scope: 'project', slug: project.slug, text: entry.text, pinned: entry.pinned }) }}
                             >Excluir</button>
                          </div>
                        ))
                  )
                  : null}
              </div>
            ))}
          </div>
        )
        : null}
    </div>
  )
}
