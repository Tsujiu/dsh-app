/**
 * The Advanced Models settings page: model-level fields the official Models
 * page deliberately leaves to `settings.yaml` — reasoning efforts, input
 * modalities, compat switches — plus whole-list editing for hand-declared
 * routes and a guarded create flow for out-of-catalog models.
 *
 * Division of labour (deliberate, mirroring the retired brand shadow's
 * lesson): the official page owns provider CRUD, credentials, and endpoint
 * discovery. This page only writes under `llm-pi-ai` → `providers.<route>`
 * through path-addressed `settings.mutate` ops against the stored user layer,
 * with `expectedRevision` fencing concurrent edits.
 *
 * Two addressing modes, because the adapter makes them mutually exclusive:
 *  - `models` — the route owns a full model list (hand-declared routes, or a
 *    catalog route whose list the user already took over). Edits are whole-
 *    list: the array is one `set` op, exactly how the official editor writes.
 *  - `overrides` — per-id tweaks over the installed catalog. Adding an id the
 *    catalog does not carry would be rejected at resolve time, so a NEW model
 *    on a catalog route is guarded into its own split route (the
 *    `opencode-go-vision` pattern) instead of being smuggled in.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { cloneDraft, defaultReasoningEfforts, getPath, modelRowFailure, parseHeaders, parseRetryPolicy, readHeaders, readRetryPolicy, RETRY_POLICY_DEFAULTS, REASONING_LEVELS } from './fields.ts'
import { enrichDraftsFromModelsDev, fetchModelsDev } from './models-dev.ts'
import type { HeaderRow, ModelDraft, RetryPolicyDraft } from './fields.ts'
import { IconChevron, IconTrash, ModelEntryEditor } from './entry-editor.tsx'
import { AdvancedModelsStore, messageOf, protocolChoices, writeOps } from './store.ts'
import type { AdvancedModelsRemote, AdvancedModelsState, RouteRow, SchemaOps } from './store.ts'
import { ModelsDevImportDialog } from './import-dialog.tsx'
import { ProviderModelDiscoveryDialog } from './provider-discovery.tsx'
import type { ProviderDiscoveryTarget } from './provider-discovery.tsx'

/** The inject face the registering apply supplies (declared via `hooks`). */
export interface AdvancedModelsInjected {
  controller: AdvancedModelsStore
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: AdvancedModelsStore['store']
  }
  api: AdvancedModelsRemote
  schema: SchemaOps
}

/**
 * Props delivered by the slot outlet: the inject face spread flat with its
 * hooks compartment bound (see `InjectFace`); Partial because the renderer
 * may deliver before the face resolves, which the mount guard below handles.
 */
export type AdvancedModelsSectionProps = Partial<InjectFace<AdvancedModelsInjected>>

/** Which edit target a models.dev import adopts into. */
type ImportTarget = 'models' | 'new-route'

/** Draft of the create-route card. */
interface NewRouteDraft {
  id: string
  displayName: string
  api: string
  baseURL: string
  apiKeyEnv: string
  rows: ModelDraft[]
}

const EMPTY_NEW_ROUTE: NewRouteDraft = { id: '', displayName: '', api: '', baseURL: '', apiKeyEnv: '', rows: [] }

/** Route ids a new route must not collide with (every layer's keys). */
function existingRouteKeys(state: AdvancedModelsState, schema: SchemaOps): ReadonlySet<string> {
  const namespace = state.namespaces.get('llm-pi-ai')
  const providers = namespace === undefined ? undefined : schema.getPath(namespace.value, ['providers'])
  const keys = typeof providers === 'object' && providers !== null && !Array.isArray(providers)
    ? Object.keys(providers as Record<string, unknown>)
    : []
  return new Set(keys)
}

/** Strip blank optional fields; keep the create card's required shape. */
function cleanRouteValue(draft: NewRouteDraft): Record<string, unknown> {
  const value: Record<string, unknown> = { api: draft.api }
  if (draft.displayName.trim() !== '') value.displayName = draft.displayName.trim()
  if (draft.baseURL.trim() !== '') value.baseURL = draft.baseURL.trim()
  if (draft.apiKeyEnv.trim() !== '') value.apiKeyEnv = draft.apiKeyEnv.trim()
  if (draft.rows.length > 0) value.models = draft.rows
  return value
}

/** The override value this page would write: the row minus its display id. */
function overrideFields(row: ModelDraft): Record<string, unknown> {
  const { id: _drop, ...fields } = row
  return fields
}

/** Merge imported rows by model id while keeping manual blank rows intact. */
function mergeModelRows(existing: readonly ModelDraft[], additions: readonly ModelDraft[]): ModelDraft[] {
  const next = [...existing]
  const positions = new Map<string, number>()
  next.forEach((model, index) => {
    const id = typeof model.id === 'string' ? model.id.trim() : ''
    if (id !== '') positions.set(id, index)
  })
  for (const model of additions) {
    const id = typeof model.id === 'string' ? model.id.trim() : ''
    const position = id === '' ? undefined : positions.get(id)
    if (position === undefined) {
      if (id !== '' && typeof model.id === 'string' && model.id !== id) {
        next.push({ ...model, id })
      } else {
        next.push(model)
      }
      if (id !== '') positions.set(id, next.length - 1)
    } else {
      next[position] = model
    }
  }
  return next
}

/**
 * Render the Advanced Models settings section.
 * @param props - the inject face plus the slot's owner props.
 * @returns the section page.
 */
/** The resolved face the body component consumes (never partial inside). */
interface ResolvedFace {
  controller: AdvancedModelsStore
  useSnapshot: (selector: (snapshot: AdvancedModelsState) => AdvancedModelsState) => AdvancedModelsState
  api: AdvancedModelsRemote
  schema: SchemaOps
}

/**
 * Render the Advanced Models settings section.
 * @param props - the inject face plus the slot's owner props.
 * @returns the section page.
 */
export function AdvancedModelsSection(props: AdvancedModelsSectionProps): ReactNode {
  const { controller, useSnapshot, api, schema } = props
  if (controller === undefined || useSnapshot === undefined || api === undefined || schema === undefined) {
    // The face has not resolved yet; the outlet re-renders once it has.
    return null
  }
  return <AdvancedModelsBody controller={controller} useSnapshot={useSnapshot} api={api} schema={schema} />
}

/** The mounted page: everything below assumes a fully resolved face. */
function AdvancedModelsBody(face: ResolvedFace): ReactNode {
  const { controller, useSnapshot, api, schema } = face
  const state = useSnapshot((snapshot: AdvancedModelsState) => snapshot)
  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [state.status, controller])

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [modelsDraft, setModelsDraft] = useState<readonly ModelDraft[] | undefined>(undefined)
  const [overridesDraft, setOverridesDraft] = useState<Record<string, ModelDraft> | undefined>(undefined)
  // Expanded-row keys are string-scoped per list ('m3' model row 3, 'o:id'
  // one override, 'n1' one create-card row) so lists never alias state.
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [enrichBusy, setEnrichBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [newRoute, setNewRoute] = useState<NewRouteDraft | undefined>(undefined)
  const [modelsDevTarget, setModelsDevTarget] = useState<ImportTarget | undefined>(undefined)
  const [discoveryTarget, setDiscoveryTarget] = useState<ImportTarget | undefined>(undefined)
  const row: RouteRow | undefined = useMemo(
    () => state.routes.find(candidate => candidate.entry.provider === selectedId),
    [state.routes, selectedId],
  )
  const namespace = state.namespaces.get('llm-pi-ai')
  const disabled = !state.writable || busy

  // A selection change re-initializes the drafts; an in-flight push refresh
  // does NOT (the official editor's discipline: the revision fence at save
  // time decides, editing state is never ambushed).
  useEffect(() => {
    setModelsDraft(undefined)
    setOverridesDraft(undefined)
    setOpenRows(new Set())
    setFailure(undefined)
    setNotice(undefined)
    setModelsDevTarget(undefined)
    setDiscoveryTarget(undefined)
  }, [selectedId])

  // The first active route is immediately useful on entry; a refresh keeps the
  // current route when it still exists and falls back only when it vanished.
  useEffect(() => {
    if (state.status !== 'ready') return
    const fallback = state.routes.find(candidate => candidate.entry.active) ?? state.routes[0]
    setSelectedId(current => current !== undefined
      && state.routes.some(candidate => candidate.entry.provider === current)
      ? current
      : fallback?.entry.provider)
  }, [state.status, state.routes])

  /** The user-layer `models` array as loaded (undefined when unowned). */
  const baseModels = row !== undefined && Array.isArray(row.userProfile?.models)
    ? cloneDraft(row.userProfile.models as ModelDraft[])
    : undefined
  /** The user-layer `modelOverrides` object as loaded. */
  const baseOverrides = row !== undefined && typeof row.userProfile?.modelOverrides === 'object'
    && row.userProfile.modelOverrides !== null && !Array.isArray(row.userProfile.modelOverrides)
    ? cloneDraft(row.userProfile.modelOverrides as Record<string, ModelDraft>)
    : {}
  const models = modelsDraft ?? baseModels ?? []
  const overrides = overridesDraft ?? baseOverrides
  const inModelsMode = row !== undefined
    && (row.mode === 'models' || (row.mode === 'empty' && row.entry.declared === true))

  const modelIds = new Set(models.map(model => typeof model.id === 'string' ? model.id : ''))
  const overrideIds = Object.keys(overrides)
  /** Resolved wire protocol for the selected route (user-layer or composed profile.api). */
  const routeApi = (() => {
    if (row === undefined || namespace === undefined) return undefined
    const profile = getPath(namespace.value, row.entry.settingsPath)
    if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) return undefined
    const value = (profile as Record<string, unknown>).api
    return typeof value === 'string' && value !== '' ? value : undefined
  })()

  const rowsFailure = useMemo(() => {
    if (row === undefined) return undefined
    if (inModelsMode) {
      // Row validation first: the adapter's own validator would reject bad
      // rows with its English diagnostic, one model per attempt — the exact
      // trap this page exists to prevent.
      const seen = new Set<string>()
      for (const model of models) {
        const modelApi = typeof model.api === 'string' && model.api !== ''
          ? model.api as string
          : routeApi
        const text = modelRowFailure(model, seen, modelApi)
        if (text !== undefined) return text
        seen.add(typeof model.id === 'string' ? model.id : '')
      }
      return undefined
    }
    for (const [id, value] of Object.entries(overrides)) {
      // Override rows address a catalog id by key; a row that sets nothing
      // would write a meaningless empty object into settings.yaml.
       if (Object.keys(overrideFields(value)).length === 0) return `Substituição ${id}: defina pelo menos um campo`
      const text = modelRowFailure({ ...value, id }, new Set(), routeApi)
       if (text !== undefined) return text.replace(`${id} de `, `Substituição ${id}: `)
    }
    return undefined
  }, [row, inModelsMode, models, overrides, routeApi])

  const modelsChanged = modelsDraft !== undefined
    && JSON.stringify(models) !== JSON.stringify(baseModels ?? [])
  const overridesChanged = overridesDraft !== undefined
    && JSON.stringify(overrides) !== JSON.stringify(baseOverrides)
  const canSave = inModelsMode ? modelsChanged : overridesChanged

  /** Save the selected route's edits as path ops against the stored section. */
  const save = async (): Promise<void> => {
    if (row === undefined || namespace === undefined || rowsFailure !== undefined) return
    setBusy(true)
    setFailure(undefined)
    setNotice(undefined)
    const route = row.entry.provider
    const path = [...row.entry.settingsPath]
    let ops: SettingsPathOpView[]
    if (inModelsMode) {
      if (models.length === 0) {
        // An emptied list restores inheritance on a catalog route; a
        // hand-declared route has nothing to inherit and would serve nothing.
        if (row.entry.declared === true) {
           setFailure('Uma rota manual deve manter pelo menos um modelo. Para remover a rota inteira, use a página oficial de modelos.')
          setBusy(false)
          return
        }
        ops = [{ op: 'unset', path: [...path, 'models'] }]
      } else {
        ops = [{ op: 'set', path: [...path, 'models'], value: models as JsonValue }]
      }
    } else {
      ops = []
      for (const id of Object.keys(baseOverrides)) {
        if (!(id in overrides)) ops.push({ op: 'unset', path: [...path, 'modelOverrides', id] })
      }
      for (const [id, value] of Object.entries(overrides)) {
        const fields = overrideFields(value)
        // Compare like-for-like (the stored value never carries `id`); an
        // emptied override unsets rather than writing `{}`.
        const comparable = Object.keys(fields).length === 0 ? undefined : fields
        if (JSON.stringify(baseOverrides[id]) !== JSON.stringify(comparable)) {
          if (comparable === undefined) ops.push({ op: 'unset', path: [...path, 'modelOverrides', id] })
          else ops.push({ op: 'set', path: [...path, 'modelOverrides', id], value: fields as JsonValue })
        }
      }
    }
    if (ops.length === 0) {
       setNotice('Não há alterações para salvar.')
      setBusy(false)
      return
    }
    const outcome = await writeOps(api, ops, namespace.revision)
    setBusy(false)
    if (outcome.kind === 'conflict') {
       setFailure('A configuração foi alterada em outro local (ou outra alteração acabou de ser salva nesta página). Recarregamos os dados; revise e salve novamente.')
      setModelsDraft(undefined)
      setOverridesDraft(undefined)
      await controller.load()
      return
    }
    if (outcome.kind === 'failure') {
      setFailure(outcome.message)
      return
    }
    setModelsDraft(undefined)
    setOverridesDraft(undefined)
     setNotice('Salvo.')
    await controller.load()
  }

  /**
   * Upsert from the create card: a NEW id creates the whole profile; an id a
   * declared route already owns MERGES the card's rows into it (per-id, new
   * winning) — the "import another batch later" flow needs no second route.
   * A catalog route's id is refused: appending off-catalog rows there is the
   * write the adapter rejects, and in-catalog ids need no appending.
   */
  const createRoute = async (): Promise<void> => {
    if (newRoute === undefined || namespace === undefined) return
    const id = newRoute.id.trim()
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
       setFailure('O ID da rota pode conter apenas letras, números e hífens, começando por uma letra ou número.')
      return
    }
    const existingTarget = state.routes.find(candidate => candidate.entry.provider === id)
    if (existingTarget !== undefined && existingTarget.entry.declared !== true) {
       setFailure(`"${id}" é uma rota do catálogo oficial. Modelos do catálogo já estão disponíveis; use uma rota de integração separada para modelos externos.`)
      return
    }
    if (existingTarget === undefined && newRoute.api === '') {
       setFailure('Selecione o protocolo wire (api).')
      return
    }
    const seen = new Set<string>()
    for (const model of newRoute.rows) {
      const modelApi = typeof model.api === 'string' && model.api !== ''
        ? model.api as string
        : newRoute.api
      const text = modelRowFailure(model, seen, modelApi)
      if (text !== undefined) { setFailure(text); return }
      seen.add(typeof model.id === 'string' ? model.id : '')
    }
    setBusy(true)
    setFailure(undefined)
    let ops: SettingsPathOpView[]
    let doneNotice: string
    if (existingTarget === undefined) {
      ops = [{ op: 'set', path: ['providers', id], value: cleanRouteValue(newRoute) as JsonValue }]
       doneNotice = `A rota ${id} foi criada; você pode continuar editando seus campos de modelo.`
    } else {
      // Merge into the existing declared route: keep its profile fields, upsert rows by id.
      const current = profileAt(['providers', id]).models
      const byId = new Map<string, ModelDraft>()
      for (const model of Array.isArray(current) ? current as ModelDraft[] : []) {
        if (typeof model.id === 'string' && model.id !== '') byId.set(model.id, model)
      }
      for (const model of newRoute.rows) byId.set(typeof model.id === 'string' ? model.id : '', model)
      if (byId.size === 0) {
        setBusy(false)
         setFailure('Não há modelos para adicionar.')
        return
      }
      ops = [{ op: 'set', path: ['providers', id, 'models'], value: [...byId.values()] as JsonValue }]
       doneNotice = `${String(newRoute.rows.length)} modelos foram adicionados à rota ${id} (itens com o mesmo nome foram substituídos).`
    }
    const outcome = await writeOps(api, ops, namespace.revision)
    setBusy(false)
    if (outcome.kind === 'conflict') {
       setFailure('A configuração foi atualizada em outro local. Tente novamente.')
      await controller.load()
      return
    }
    if (outcome.kind === 'failure') {
      setFailure(outcome.message)
      return
    }
    setNewRoute(undefined)
    setNotice(doneNotice)
    setSelectedId(id)
    await controller.load()
  }

  const protocols = protocolChoices(namespace, schema)

  /** The existing route the create card's id addresses, when it does (upsert). */
  const upsertTarget = newRoute === undefined || newRoute.id.trim() === ''
    ? undefined
    : state.routes.find(candidate => candidate.entry.provider === newRoute.id.trim())

  /** The resolved (all-layers) profile at one settings path, for reads. */
  const profileAt = (settingsPath: readonly string[]): Record<string, unknown> => {
    const value = namespace === undefined
      ? undefined
      : getPath(namespace.value, settingsPath)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  }
  /** The resolved (all-layers) profile of one route, for the info bar. */
  const resolvedProfile = (row: RouteRow): Record<string, unknown> =>
    profileAt(row.entry.settingsPath)
  const providerDiscoveryTarget = (candidate: RouteRow): ProviderDiscoveryTarget => {
    const info = resolvedProfile(candidate)
    const baseURL = typeof info.baseURL === 'string' ? info.baseURL : undefined
    const apiName = typeof info.api === 'string' ? info.api : undefined
    return {
      settingsNs: candidate.entry.settingsNs,
      provider: candidate.entry.provider,
      ...(baseURL === undefined ? {} : { baseURL }),
      ...(apiName === undefined ? {} : { api: apiName }),
    }
  }
  const routeInfo = (row: RouteRow): ReactNode => {
    const info = resolvedProfile(row)
    const text = (key: string): string => typeof info[key] === 'string' ? info[key] as string : '—'
    return (
      <dl className="dshAma-routeInfo">
        <div>
           <dt>Tipo</dt>
          <dd>
            <span className={`dshAma-badge ${row.entry.declared === true ? 'dshAma-badgeCustom' : 'dshAma-badgeCatalog'}`}>
              {row.entry.declared === true ? 'Rota manual' : 'Rota do catálogo'}
            </span>
          </dd>
        </div>
        <div><dt>Nome de exibição</dt><dd>{text('displayName')}</dd></div>
        <div><dt>baseURL</dt><dd>{text('baseURL')}</dd></div>
        <div><dt>Protocolo</dt><dd>{text('api')}</dd></div>
        <div><dt>Variável de credencial</dt><dd>{text('apiKeyEnv')}</dd></div>
        <div><dt>Status</dt><dd>{row.entry.active ? 'Registrada' : 'Inativa'}</dd></div>
      </dl>
    )
  }

  /**
   * Gap-fill missing fields (especially reasoningEfforts) from models.dev by
   * model id. Hand-declared routes have no catalog inherit, so this is how a
   * batch of discovered/copied ids gets xhigh/max and the rest without a
   * per-row manual enable. Pass `explicitRows` when the caller just set a
   * draft this render has not seen yet (discovery adopt).
   */
  const enrichFromModelsDev = async (
    target: 'models' | 'new-route',
    explicitRows?: readonly ModelDraft[],
  ): Promise<void> => {
    const source = explicitRows
      ?? (target === 'new-route' && newRoute !== undefined ? newRoute.rows : models)
    const ids = source.filter(model => typeof model.id === 'string' && model.id.trim() !== '')
    if (ids.length === 0) {
       setNotice('A lista ainda não possui IDs de modelos para completar.')
      return
    }
    setEnrichBusy(true)
    setFailure(undefined)
    setNotice(undefined)
    try {
      const providers = await fetchModelsDev()
      const prefer = row?.entry.provider
      const result = enrichDraftsFromModelsDev(providers, source, prefer)
      if (target === 'new-route' && newRoute !== undefined) {
        setNewRoute({ ...newRoute, rows: result.drafts })
      } else {
        setModelsDraft(result.drafts)
      }
      if (result.filled.length === 0) {
        setNotice(result.missing.length > 0
           ? `Não encontrados no models.dev: ${result.missing.slice(0, 8).join(', ')}${result.missing.length > 8 ? '…' : ''}`
           : 'Todos os campos já estão preenchidos; nada para completar.')
      } else {
         setNotice(`${String(result.filled.length)} modelos foram completados pelo models.dev (incluindo níveis de raciocínio). Clique em "Salvar alterações". ${
           result.missing.length > 0 ? `Não encontrados: ${result.missing.slice(0, 5).join(', ')}…` : ''
        }`)
      }
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setEnrichBusy(false)
    }
  }

  const patchModel = (index: number, next: ModelDraft): void => {
    setModelsDraft(models.map((model, at) => at === index ? next : model))
  }

  /** Prefill the create card for an out-of-catalog model on a catalog route. */
  const startSplitRoute = (): void => {
    if (row === undefined) return
    const info = resolvedProfile(row)
    const text = (key: string): string => typeof info[key] === 'string' ? info[key] as string : ''
    // One companion suffix everywhere: -extra (the manual companion-route convention).
    const canonical = `${row.entry.provider}-extra`
    const exists = existingRouteKeys(state, schema).has(canonical)
    let id = canonical
    for (let attempt = 2; existingRouteKeys(state, schema).has(id); attempt += 1) {
      id = `${canonical}-${String(attempt)}`
    }
    setFailure(undefined)
    setNotice(undefined)
    setNewRoute({
      id,
       displayName: `${row.entry.displayName} extra`,
      // Prefill the source route's protocol when it names one; otherwise the
      // hand-declared default for manual creation.
      api: typeof info.api === 'string' && info.api !== '' ? info.api : 'openai-completions',
      baseURL: text('baseURL'),
      apiKeyEnv: text('apiKeyEnv'),
      rows: [],
    })
    if (exists) {
       setNotice(`A rota associada ${canonical} já existe: adicione modelos nela ou use um novo ID.`)
    }
  }

  const toggleOpen = (key: string): void => {
    setOpenRows(current => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }
  // Removing any row invalidates positional keys; collapsing everything is
  // correct and cheap (ids re-expand on click).
  const collapseAll = (): void => { setOpenRows(new Set()) }

  return (
     <section className="dshAma-root" aria-label="Configurações avançadas de modelos">
      <style>{ADVANCED_CSS}</style>
      <p className="dshAma-intro">
         Ajuste campos avançados dos modelos (níveis de raciocínio, modalidades de entrada e compatibilidade) e padrões da rota (cabeçalhos, tentativas e raciocínio padrão).
         Endpoints e credenciais continuam na página oficial de modelos. Diferencie:
         <b>rotas do catálogo</b> herdam a lista oficial e permitem substituições por ID;
         <b>rotas manuais</b> possuem seu próprio protocolo e lista. Crie uma rota associada <code>-extra</code> para modelos fora do catálogo.
      </p>
      {state.status === 'error'
         ? <p className="dshAma-error">{`Falha ao carregar: ${state.error ?? ''}`}</p>
        : state.status === 'loading' && state.routes.length === 0
           ? <p className="dshAma-hint">Carregando…</p>
          : null}
      {state.status === 'ready' && !state.writable
         ? <p className="dshAma-hint">A fonte de configurações atual é somente leitura; esta página permite apenas consultar.</p>
        : null}
      {state.status === 'loading' && state.routes.length > 0
         ? <p className="dshAma-hint" aria-live="polite">Sincronizando a configuração do provider…</p>
        : null}

      <div className="dshAma-routePicker">
        <div className="dshAma-field">
         <span className="dshAma-fieldLabel">Selecionar rota</span>
        <select
          className="dshAma-input dshAma-select"
          value={selectedId ?? ''}
           aria-label="Selecionar rota"
          onChange={(event) => {
            setSelectedId(event.target.value === '' ? undefined : event.target.value)
            setNewRoute(undefined)
          }}
        >
           <option value="">(selecione uma rota de provider para editar)</option>
          {state.routes.map(candidate => {
             const kind = candidate.entry.declared === true ? 'manual' : 'catálogo'
             const live = candidate.entry.active ? '' : ' · inativa'
            const name = candidate.entry.displayName === candidate.entry.provider
              ? candidate.entry.provider
              : `${candidate.entry.displayName}（${candidate.entry.provider}）`
            return (
              <option key={candidate.entry.provider} value={candidate.entry.provider}>
                {`[${kind}${live}] ${name}`}
              </option>
            )
          })}
        </select>
        </div>
        <button
          type="button"
          className="dshAma-iconButton dshAma-refreshButton"
           aria-label="Atualizar configuração do provider"
           title="Atualizar configuração do provider"
          disabled={state.status === 'loading'}
          onClick={() => { void controller.load() }}
        >⟳</button>
      </div>

      {row === undefined ? null : (
        <>
          {routeInfo(row)}
          <RouteReasoningCard
            key={`${row.entry.provider}-reasoning`}
            row={row} disabled={disabled} api={api}
            namespace={namespace} controller={controller}
          />
          <RetryPolicyCard
            key={row.entry.provider}
            row={row} disabled={disabled} api={api}
            namespace={namespace} controller={controller}
          />
          <HeadersCard
            key={`${row.entry.provider}-headers`}
            row={row} disabled={disabled} api={api}
            namespace={namespace} controller={controller}
          />
          {inModelsMode
            ? (
              <div className="dshAma-modeBanner">
                <b>Modo de lista completa</b>
                {row.entry.declared === true
                  ? ': a rota manual possui sua própria lista e o salvamento grava toda a lista em models.'
                  : ': a camada do usuário assumiu a lista da rota e o salvamento grava toda a lista em models (não é mais apenas uma substituição parcial).'}
                {' '}Limpar a lista de uma rota do catálogo restaura a herança do catálogo.
              </div>
            )
            : row.mode === 'overrides'
              ? (
                <div className="dshAma-modeBanner">
                  <b>Modo de substituição</b>: ajuste um modelo do catálogo oficial por ID (<code>modelOverrides</code>);
                  os demais modelos não são afetados. Para adicionar um modelo fora do catálogo,
                  <button type="button" className="dshAma-linkButton" onClick={startSplitRoute}>crie uma rota associada -extra</button>.
                </div>
              )
              : row.entry.declared === true
                ? (
                  <div className="dshAma-modeBanner">
                    <b>Rota manual</b>: ainda não há uma lista de modelos declarada. Adicionar um modelo ativará o modo de lista completa.
                  </div>
                )
                : (
                  <div className="dshAma-modeBanner">
                    <b>Rota do catálogo</b>: nenhum modelo é substituído; a lista oficial é usada.
                    Campos avançados podem ser substituídos por ID. Para um <b>modelo fora do catálogo</b>,
                    <button type="button" className="dshAma-linkButton" onClick={startSplitRoute}>crie uma rota associada -extra</button>
                    (mesmo endpoint e credencial, protocolo independente, sem afetar os modelos do catálogo).
                  </div>
                )}
          {inModelsMode
            ? (
              <>
                <div className="dshAma-listHead">
                  <span className="dshAma-listTitle">{`Lista de modelos (${String(models.length)})`}</span>
                  <button
                    type="button" className="dshAma-linkButton" disabled={disabled}
                    onClick={() => { setDiscoveryTarget('models') }}
                  >Obter do provider</button>
                  <button
                    type="button" className="dshAma-linkButton" disabled={disabled}
                    onClick={() => { setModelsDevTarget('models') }}
                  >Consultar models.dev</button>
                  <button
                    type="button" className="dshAma-linkButton" disabled={disabled}
                    onClick={() => {
                      const blank: ModelDraft = row.entry.declared === true
                        ? { id: '', ...defaultReasoningEfforts() as ModelDraft }
                        : { id: '' }
                      setModelsDraft([...models, blank])
                    }}
                  >Adicionar manualmente</button>
                  <button
                    type="button" className="dshAma-linkButton" disabled={disabled || enrichBusy}
                     title="Completar níveis de raciocínio, capacidade e modalidade pelo ID no models.dev (sem substituir campos existentes)"
                    onClick={() => { void enrichFromModelsDev('models') }}
                  >{enrichBusy ? 'Completando…' : 'Completar pelo models.dev'}</button>
                </div>
                {models.length === 0 ? <p className="dshAma-hint">A lista está vazia.</p> : null}
                {row.entry.declared === true && models.some(model => model.reasoningEfforts === undefined)
                  ? (
                    <p className="dshAma-hint">
                      {String(models.filter(model => model.reasoningEfforts === undefined).length)} modelos não declaram níveis de raciocínio:
                      rotas manuais não herdam do catálogo oficial e esses modelos
                      <b> não terão níveis de raciocínio</b> no seletor. Expanda a linha e clique em "Ativar raciocínio".
                    </p>
                  )
                  : null}
                {models.map((model, index) => (
                  <div key={index} className="dshAma-entry">
                    <div className="dshAma-entryHead">
                      <button
                        type="button" className="dshAma-iconButton" aria-expanded={openRows.has(`m${String(index)}`)}
                        aria-label={`Expandir modelo ${index + 1}`}
                        onClick={() => { toggleOpen(`m${String(index)}`) }}
                      ><IconChevron open={openRows.has('m' + String(index))} /></button>
                        <span className="dshAma-entryId">{typeof model.id === 'string' && model.id !== '' ? model.id : '(sem nome)'}</span>
                      <span className="dshAma-entryName">
                        {typeof model.name === 'string' ? model.name : ''}
                      </span>
                      <button
                        type="button" className="dshAma-iconButton dshAma-iconButtonDanger" aria-label={`Remover modelo ${index + 1}`}
                        disabled={disabled}
                        onClick={() => { collapseAll(); setModelsDraft(models.filter((_model, at) => at !== index)) }}
                      ><IconTrash /></button>
                    </div>
                    {openRows.has(`m${String(index)}`)
                      ? (
                        <ModelEntryEditor
                          row={model} index={index} disabled={disabled}
                          api={typeof model.api === 'string' && model.api !== ''
                            ? model.api as string
                            : routeApi}
                          handDeclared={row.entry.declared === true}
                          onChange={(next) => { patchModel(index, next) }}
                        />
                      )
                      : null}
                  </div>
                ))}
              </>
            )
            : (
              <>
                <div className="dshAma-listHead">
                  <span className="dshAma-listTitle">{`Substituições do catálogo (${String(overrideIds.length)})`}</span>
                  <span className="dshAma-hint">A lista de modelos do catálogo não está disponível.</span>
                </div>
                {overrideIds.length === 0
                  ? <p className="dshAma-hint">Nenhum modelo foi substituído. Crie uma rota de integração separada para modelos fora do catálogo.</p>
                  : null}
                {overrideIds.map(id => (
                  <div key={id} className="dshAma-entry">
                    <div className="dshAma-entryHead">
                      <button
                        type="button" className="dshAma-iconButton"
                        aria-expanded={openRows.has(`o:${id}`)}
                        aria-label={`Expandir substituição ${id}`}
                        onClick={() => { toggleOpen(`o:${id}`) }}
                       ><IconChevron open={openRows.has('o:' + id)} /></button>
                       <span className="dshAma-entryId">{id}</span>
                      <button
                        type="button" className="dshAma-iconButton dshAma-iconButtonDanger" aria-label={`Remover substituição ${id}`}
                        disabled={disabled}
                        onClick={() => {
                          const next = { ...overrides }
                          delete next[id]
                          setOverridesDraft(next)
                        }}
                      ><IconTrash /></button>
                    </div>
                    {openRows.has(`o:${id}`)
                      ? (
                        <ModelEntryEditor
                          row={{ ...overrides[id], id }} index={0} disabled={disabled} lockedId
                          api={routeApi}
                          handDeclared={false}
                          onChange={(next) => { setOverridesDraft({ ...overrides, [id]: next }) }}
                        />
                      )
                      : null}
                  </div>
                ))}
              </>
            )}
          <div className="dshAma-footer">
            {failure !== undefined ? <p className="dshAma-error">{failure}</p> : null}
            {/* The gate names WHY the write is refused while the button stays
                disabled — a silent disabled save is a dead end. */}
            {failure === undefined && rowsFailure !== undefined
              ? <p className="dshAma-error">{rowsFailure}</p>
              : null}
            {notice !== undefined ? <p className="dshAma-notice">{notice}</p> : null}
            <button
              type="button" className="dshAma-button dshAma-buttonPrimary"
              disabled={disabled || rowsFailure !== undefined || !canSave}
              onClick={() => { void save() }}
            >{busy ? 'Salvando…' : 'Salvar alterações'}</button>
            <button
              type="button" className="dshAma-button"
              disabled={disabled || !canSave}
              onClick={() => {
                setModelsDraft(undefined)
                setOverridesDraft(undefined)
                collapseAll()
              }}
            >Redefinir</button>
          </div>
        </>
      )}

      <details
        className="dshAma-newRoute"
        open={newRoute !== undefined}
        onToggle={(event) => {
          if (!(event.currentTarget as HTMLDetailsElement).open) setNewRoute(undefined)
        }}
      >
        <summary className="dshAma-newRouteSummary">Adicionar rota de integração (modelos fora do catálogo / gateway com vários protocolos)</summary>
        <div className="dshAma-newRouteBody">
          <p className="dshAma-hint">
            Use quando um modelo novo do gateway ainda não está no catálogo oficial ou quando um gateway usa vários protocolos e precisa ser dividido (como
            <code>opencode-go-vision</code>). O protocolo (api) é declarado na rota e vale apenas para ela.
          </p>
          {newRoute === undefined
            ? (
              <button
                type="button" className="dshAma-button"
                onClick={() => { setNewRoute({ ...EMPTY_NEW_ROUTE }); setFailure(undefined) }}
              >Começar criação</button>
            )
            : (
              <>
                {/* Upsert targeting: an existing declared route's id switches
                    the card from create to merge-append; a catalog route's id
                    is refused (its models resolve from the official catalog). */}
                {(() => {
                  const trimmed = newRoute.id.trim()
                  if (trimmed === '') return null
                  const target = state.routes.find(candidate => candidate.entry.provider === trimmed)
                  if (target === undefined) return null
                  return target.entry.declared === true
                    ? (
                      <p className="dshAma-hint">
                        A rota "{trimmed}" já existe (rota personalizada): os modelos abaixo serão <b>mesclados</b> por ID, com novos itens substituindo os antigos; as demais configurações serão mantidas.
                      </p>
                    )
                    : (
                      <p className="dshAma-error">
                        "{trimmed}" é uma rota do catálogo oficial e não pode receber itens aqui. Modelos do catálogo já estão disponíveis; crie uma rota de integração separada para modelos externos.
                      </p>
                    )
                })()}
                <div className="dshAma-grid">
                  <label className="dshAma-field">
                    <span className="dshAma-fieldLabel">ID da rota</span>
                    <input className="dshAma-input" type="text" value={newRoute.id} placeholder="ex.: my-gateway-vision"
                      aria-label="ID da rota" onChange={(event) => { setNewRoute({ ...newRoute, id: event.target.value }) }} />
                  </label>
                  <label className="dshAma-field">
                    <span className="dshAma-fieldLabel">Nome de exibição</span>
                    <input className="dshAma-input" type="text" value={newRoute.displayName} placeholder="(igual ao ID da rota por padrão)"
                      aria-label="Nome de exibição" disabled={upsertTarget !== undefined}
                      onChange={(event) => { setNewRoute({ ...newRoute, displayName: event.target.value }) }} />
                  </label>
                  <label className="dshAma-field">
                    <span className="dshAma-fieldLabel">Protocolo wire (api)</span>
                    <select className="dshAma-input dshAma-select" value={newRoute.api} aria-label="Protocolo wire"
                      disabled={upsertTarget !== undefined}
                      onChange={(event) => { setNewRoute({ ...newRoute, api: event.target.value }) }}>
                      <option value="">{upsertTarget !== undefined ? '(usar rota existente)' : '(obrigatório)'}</option>
                      {protocols.map(choice => <option key={choice} value={choice}>{choice}</option>)}
                    </select>
                  </label>
                  <label className="dshAma-field">
                    <span className="dshAma-fieldLabel">baseURL</span>
                    <input className="dshAma-input" type="text" value={newRoute.baseURL} placeholder="https://…/v1"
                      aria-label="baseURL" disabled={upsertTarget !== undefined}
                      onChange={(event) => { setNewRoute({ ...newRoute, baseURL: event.target.value }) }} />
                  </label>
                  <label className="dshAma-field">
                    <span className="dshAma-fieldLabel">Variável de credencial (apiKeyEnv)</span>
                    <input className="dshAma-input" type="text" value={newRoute.apiKeyEnv} placeholder="MY_GATEWAY_API_KEY"
                      aria-label="Variável de credencial" disabled={upsertTarget !== undefined}
                      onChange={(event) => { setNewRoute({ ...newRoute, apiKeyEnv: event.target.value }) }} />
                  </label>
                </div>
                <div className="dshAma-listHead">
                  <span className="dshAma-listTitle">{`${upsertTarget !== undefined ? 'A adicionar' : 'Iniciais'} modelos (${String(newRoute.rows.length)})`}</span>
                  <button type="button" className="dshAma-linkButton" disabled={disabled}
                    onClick={() => { setDiscoveryTarget('new-route') }}>Descobrir no provider</button>
                  <button type="button" className="dshAma-linkButton" disabled={disabled}
                    onClick={() => { setModelsDevTarget('new-route') }}>Consultar models.dev</button>
                  <button type="button" className="dshAma-linkButton" disabled={disabled || enrichBusy}
                    onClick={() => { void enrichFromModelsDev('new-route') }}>
                    {enrichBusy ? 'Completando…' : 'Completar pelo models.dev'}
                  </button>
                  <button type="button" className="dshAma-linkButton" disabled={disabled}
                    onClick={() => {
                      const blank: ModelDraft = { id: '', ...defaultReasoningEfforts() as ModelDraft }
                      setNewRoute({ ...newRoute, rows: [...newRoute.rows, blank] })
                    }}>Adicionar manualmente</button>
                </div>
                {newRoute.rows.map((model, index) => (
                  <div key={index} className="dshAma-entry">
                    <div className="dshAma-entryHead">
                      <button type="button" className="dshAma-iconButton" aria-label={`Expandir modelo inicial ${index + 1}`}
                        aria-expanded={openRows.has(`n${String(index)}`)}
                        onClick={() => { toggleOpen(`n${String(index)}`) }}><IconChevron open={openRows.has('n' + String(index))} /></button>
                      <span className="dshAma-entryId">
                        {typeof model.id === 'string' && model.id !== '' ? model.id : '(sem nome)'}
                      </span>
                      <button type="button" className="dshAma-iconButton dshAma-iconButtonDanger"
                        aria-label={`Remover modelo inicial ${index + 1}`} disabled={disabled}
                        onClick={() => {
                          collapseAll()
                          setNewRoute({ ...newRoute, rows: newRoute.rows.filter((_m, at) => at !== index) })
                        }}><IconTrash /></button>
                    </div>
                    {openRows.has(`n${String(index)}`)
                      ? (
                        <ModelEntryEditor
                          row={model} index={index} disabled={disabled}
                          api={typeof model.api === 'string' && model.api !== ''
                            ? model.api as string
                            : newRoute.api}
                          handDeclared
                          onChange={(next) => {
                            setNewRoute({ ...newRoute, rows: newRoute.rows.map((m, at) => at === index ? next : m) })
                          }}
                        />
                      )
                      : null}
                  </div>
                ))}
                <div className="dshAma-footer">
                  {failure !== undefined ? <p className="dshAma-error">{failure}</p> : null}
                  <button type="button" className="dshAma-button dshAma-buttonPrimary"
                    disabled={disabled || (upsertTarget !== undefined && upsertTarget.entry.declared !== true)}
                    onClick={() => { void createRoute() }}>
                    {busy
                      ? 'Processando…'
                      : upsertTarget === undefined
                        ? 'Criar rota'
                        : upsertTarget.entry.declared === true ? 'Adicionar à rota' : 'Não é possível adicionar (rota do catálogo)'}
                  </button>
                </div>
              </>
            )}
        </div>
      </details>

      <ModelsDevImportDialog
        open={modelsDevTarget !== undefined}
        onClose={() => { setModelsDevTarget(undefined) }}
        onAdopt={(rows) => {
          if (modelsDevTarget === 'new-route' && newRoute !== undefined) {
            setNewRoute({ ...newRoute, rows: mergeModelRows(newRoute.rows, rows) })
          } else {
            setModelsDraft(mergeModelRows(models, rows))
          }
        }}
        existingIds={modelsDevTarget === 'new-route' && newRoute !== undefined
          ? new Set(newRoute.rows.map(model => typeof model.id === 'string' ? model.id : ''))
          : modelIds}
      />
      <ProviderModelDiscoveryDialog
        open={discoveryTarget !== undefined}
        onClose={() => { setDiscoveryTarget(undefined) }}
        api={api}
        target={discoveryTarget === 'models' && row !== undefined
          ? providerDiscoveryTarget(row)
          : discoveryTarget === 'new-route' && newRoute !== undefined
            ? { settingsNs: 'llm-pi-ai', baseURL: newRoute.baseURL, api: newRoute.api }
            : undefined}
        existingIds={discoveryTarget === 'new-route' && newRoute !== undefined
          ? new Set(newRoute.rows.map(model => typeof model.id === 'string' ? model.id : ''))
          : modelIds}
        onAdopt={(rows) => {
          if (discoveryTarget === 'new-route' && newRoute !== undefined) {
            const merged = mergeModelRows(newRoute.rows, rows)
            setNewRoute({ ...newRoute, rows: merged })
            // Discovery only returns id/name/capacities — enrich reasoning etc.
            void enrichFromModelsDev('new-route', merged)
          } else {
            const merged = mergeModelRows(models, rows)
            setModelsDraft(merged)
            void enrichFromModelsDev('models', merged)
          }
        }}
      />
    </section>
  )
}

/** A blank retry-policy draft: every field "use the schema default". */
const BLANK_RETRY: RetryPolicyDraft = {
  mode: 'normal', maxRetries: '', initialDelayMs: '', maxDelayMs: '', jitterRatio: '',
}

/** One summary fragment for a customized policy, or the default label. */
function retrySummary(base: RetryPolicyDraft | undefined): string {
  if (base === undefined) return ' (padrão)'
  if (base.mode === 'always') return ' (personalizado: tentativas ilimitadas)'
  const retries = base.maxRetries.trim() === '' ? String(RETRY_POLICY_DEFAULTS.maxRetries) : base.maxRetries.trim()
  return ` (personalizado: até ${retries} tentativas)`
}

/**
 * Route-level default reasoning effort (`providers.<route>.reasoning`).
 * Not a capability declaration — it only seeds the effort when a call omits
 * one. Unsupported levels fail the request, so the picker offers only the
 * canonical levels and the copy says so.
 */
function RouteReasoningCard(props: {
  row: RouteRow
  disabled: boolean
  api: Pick<AdvancedModelsRemote, 'settings'>
  namespace: SettingsNamespaceView | undefined
  controller: AdvancedModelsStore
}): ReactNode {
  const { row, api, namespace, controller } = props
  const base = typeof row.userProfile?.reasoning === 'string' ? row.userProfile.reasoning as string : ''
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const effective = draft ?? base
  const changed = draft !== undefined && draft !== base
  const fieldDisabled = props.disabled || busy

  const run = async (ops: readonly SettingsPathOpView[], doneNotice: string): Promise<void> => {
    if (namespace === undefined) return
    setBusy(true)
    setFailure(undefined)
    setNotice(undefined)
    const outcome = await writeOps(api, ops, namespace.revision)
    setBusy(false)
    if (outcome.kind === 'conflict') {
      setFailure('A configuração foi alterada em outro local. Recarregamos os dados; revise e salve novamente.')
      setDraft(undefined)
      await controller.load()
      return
    }
    if (outcome.kind === 'failure') {
      setFailure(outcome.message)
      return
    }
    setDraft(undefined)
    setNotice(doneNotice)
    await controller.load()
  }

  const save = async (): Promise<void> => {
    if (draft === undefined) return
    await run(
      draft === ''
        ? [{ op: 'unset', path: [...row.entry.settingsPath, 'reasoning'] }]
        : [{ op: 'set', path: [...row.entry.settingsPath, 'reasoning'], value: draft as JsonValue }],
      'Nível de raciocínio padrão da rota salvo.',
    )
  }

  return (
    <details className="dshAma-newRoute dshAma-retryCard">
      <summary className="dshAma-newRouteSummary">
        {`Nível de raciocínio padrão da rota (reasoning)${base === '' ? ' (padrão: não especificado)' : ` (${base})`}`}
      </summary>
      <div className="dshAma-newRouteBody">
        <p className="dshAma-hint">
          Aplica-se apenas quando a sessão não escolhe um nível individualmente; não amplia os níveis compatíveis com o modelo.
          A solicitação falhará se o modelo não aceitar o nível. Mantenha-o consistente com a declaração de raciocínio do modelo.
        </p>
        <label className="dshAma-field">
          <span className="dshAma-fieldLabel">Nível padrão</span>
          <select
            className="dshAma-input dshAma-select" value={effective}
            aria-label="Nível de raciocínio padrão da rota" disabled={fieldDisabled}
            onChange={(event) => { setDraft(event.target.value) }}
          >
            <option value="">Não especificar (seguir sessão / catálogo)</option>
            {REASONING_LEVELS.map(level => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </label>
        <div className="dshAma-footer">
          {failure !== undefined ? <p className="dshAma-error">{failure}</p> : null}
          {notice !== undefined ? <p className="dshAma-notice">{notice}</p> : null}
          <button
            type="button" className="dshAma-button dshAma-buttonPrimary"
            disabled={fieldDisabled || !changed}
            onClick={() => { void save() }}
          >{busy ? 'Salvando…' : 'Salvar nível padrão'}</button>
          {changed ? (
            <button
              type="button" className="dshAma-button"
              disabled={fieldDisabled}
              onClick={() => { setDraft(undefined); setFailure(undefined); setNotice(undefined) }}
            >Desfazer alterações</button>
          ) : null}
        </div>
      </div>
    </details>
  )
}

/**
 * The provider-level retry-policy editor for the selected route. Saved on its
 * own button (a `set`/`unset` at `providers.<route>.retryPolicy`), separate
 * from the model-list save below — the two edit different levels of the same
 * profile and must not fence each other's writes.
 */
function RetryPolicyCard(props: {
  row: RouteRow
  disabled: boolean
  api: Pick<AdvancedModelsRemote, 'settings'>
  namespace: SettingsNamespaceView | undefined
  controller: AdvancedModelsStore
}): ReactNode {
  const { row, api, namespace, controller } = props
  const base = readRetryPolicy(row.userProfile?.retryPolicy)
  const [draft, setDraft] = useState<RetryPolicyDraft | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const effective = draft ?? base
  const changed = draft !== undefined
    && (base === undefined || JSON.stringify(draft) !== JSON.stringify(base))
  const fieldDisabled = props.disabled || busy
  /** Bind one string field of the draft, starting from blank on first edit. */
  const bind = (key: 'maxRetries' | 'initialDelayMs' | 'maxDelayMs' | 'jitterRatio') => ({
    value: effective?.[key] ?? '',
    onChange: (value: string) => { setDraft({ ...(effective ?? BLANK_RETRY), [key]: value }) },
  })

  const run = async (ops: readonly SettingsPathOpView[], doneNotice: string): Promise<void> => {
    if (namespace === undefined) return
    setBusy(true)
    setFailure(undefined)
    setNotice(undefined)
    const outcome = await writeOps(api, ops, namespace.revision)
    setBusy(false)
    if (outcome.kind === 'conflict') {
      setFailure('A configuração foi alterada em outro local. Recarregamos os dados; revise e salve novamente.')
      setDraft(undefined)
      await controller.load()
      return
    }
    if (outcome.kind === 'failure') {
      setFailure(outcome.message)
      return
    }
    setDraft(undefined)
    setNotice(doneNotice)
    await controller.load()
  }

  const save = async (): Promise<void> => {
    if (draft === undefined) return
    const parsed = parseRetryPolicy(draft)
    if (!parsed.ok) {
      setFailure(parsed.error)
      setNotice(undefined)
      return
    }
    await run(
      [{ op: 'set', path: [...row.entry.settingsPath, 'retryPolicy'], value: parsed.value as JsonValue }],
      'Política de tentativas salva.',
    )
  }

  const restoreDefault = async (): Promise<void> => {
    if (base === undefined) return
    await run(
      [{ op: 'unset', path: [...row.entry.settingsPath, 'retryPolicy'] }],
      'Política de tentativas padrão restaurada.',
    )
  }

  const maxRetries = bind('maxRetries')
  const initialDelayMs = bind('initialDelayMs')
  const maxDelayMs = bind('maxDelayMs')
  const jitterRatio = bind('jitterRatio')
  return (
    <details className="dshAma-newRoute dshAma-retryCard">
      <summary className="dshAma-newRouteSummary">
        {`Política de tentativas (retryPolicy)${retrySummary(base)}`}
      </summary>
      <div className="dshAma-newRouteBody">
        <p className="dshAma-hint">
          Política de tentativas das solicitações desta rota, ajustável à estabilidade do gateway. Campos vazios usam os padrões:
          até {` ${String(RETRY_POLICY_DEFAULTS.maxRetries)} `}tentativas, atraso inicial de
          {` ${String(RETRY_POLICY_DEFAULTS.initialDelayMs)}ms `}, máximo de
          {` ${String(RETRY_POLICY_DEFAULTS.maxDelayMs)}ms `} e jitter de ±
          {`${String(Math.round(RETRY_POLICY_DEFAULTS.jitterRatio * 100))}%`}. Interrupções
         (terminated), timeouts, limitação de taxa, erros do servidor e respostas vazias entram nas tentativas.
        </p>
        <div className="dshAma-grid">
          <label className="dshAma-field">
            <span className="dshAma-fieldLabel">Modo (mode)</span>
            <select
              className="dshAma-input dshAma-select" value={effective?.mode ?? 'normal'}
              aria-label="Modo de tentativas" disabled={fieldDisabled}
              onChange={(event) => {
                setDraft({ ...(effective ?? BLANK_RETRY), mode: event.target.value as RetryPolicyDraft['mode'] })
              }}
            >
              <option value="normal">Padrão (normal): apenas erros transitórios</option>
              <option value="always">Ilimitado (always): tentar novamente todos os erros</option>
            </select>
          </label>
          {effective?.mode === 'always'
            ? null
            : (
              <label className="dshAma-field">
                <span className="dshAma-fieldLabel">Máximo de tentativas (maxRetries)</span>
                <input
                  className="dshAma-input" type="text" inputMode="numeric"
                  value={maxRetries.value} placeholder={`padrão ${String(RETRY_POLICY_DEFAULTS.maxRetries)}`}
                  aria-label="Máximo de tentativas" disabled={fieldDisabled}
                  onChange={(event) => { maxRetries.onChange(event.target.value) }}
                />
              </label>
            )}
          <label className="dshAma-field">
            <span className="dshAma-fieldLabel">Atraso inicial em milissegundos (initialDelayMs)</span>
            <input
              className="dshAma-input" type="text" inputMode="numeric"
              value={initialDelayMs.value} placeholder={`padrão ${String(RETRY_POLICY_DEFAULTS.initialDelayMs)}`}
              aria-label="Atraso inicial da tentativa" disabled={fieldDisabled}
              onChange={(event) => { initialDelayMs.onChange(event.target.value) }}
            />
          </label>
          <label className="dshAma-field">
            <span className="dshAma-fieldLabel">Limite do atraso em milissegundos (maxDelayMs)</span>
            <input
              className="dshAma-input" type="text" inputMode="numeric"
              value={maxDelayMs.value} placeholder={`padrão ${String(RETRY_POLICY_DEFAULTS.maxDelayMs)}`}
              aria-label="Limite do atraso da tentativa" disabled={fieldDisabled}
              onChange={(event) => { maxDelayMs.onChange(event.target.value) }}
            />
          </label>
          <label className="dshAma-field">
            <span className="dshAma-fieldLabel">Proporção de jitter 0–1 (jitterRatio)</span>
            <input
              className="dshAma-input" type="text" inputMode="decimal"
              value={jitterRatio.value} placeholder={`padrão ${String(RETRY_POLICY_DEFAULTS.jitterRatio)}`}
              aria-label="Proporção de jitter da tentativa" disabled={fieldDisabled}
              onChange={(event) => { jitterRatio.onChange(event.target.value) }}
            />
          </label>
        </div>
        {effective?.mode === 'always'
          ? (
            <p className="dshAma-error">
              O modo ilimitado tenta novamente todos os erros, incluindo falhas de autenticação e excesso de cota. Solicitações podem ficar presas por muito tempo; em tarefas paralelas, prefira aumentar tentativas e atrasos do modo padrão.
            </p>
          )
          : null}
        <div className="dshAma-footer">
          {failure !== undefined ? <p className="dshAma-error">{failure}</p> : null}
          {notice !== undefined ? <p className="dshAma-notice">{notice}</p> : null}
          <button
            type="button" className="dshAma-button dshAma-buttonPrimary"
            disabled={fieldDisabled || !changed}
            onClick={() => { void save() }}
          >{busy ? 'Salvando…' : 'Salvar política de tentativas'}</button>
          {base === undefined ? null : (
            <button
              type="button" className="dshAma-button"
              disabled={fieldDisabled}
              onClick={() => { void restoreDefault() }}
            >Restaurar padrão</button>
          )}
          {changed ? (
            <button
              type="button" className="dshAma-button"
              disabled={fieldDisabled}
              onClick={() => { setDraft(undefined); setFailure(undefined); setNotice(undefined) }}
            >Desfazer alterações</button>
          ) : null}
        </div>
      </div>
    </details>
  )
}

/**
 * The provider-level request-header editor for the selected route. Writes
 * `providers.<route>.headers` as its own set/unset (same fence discipline as
 * RetryPolicyCard). Useful for gateways that require a custom header — e.g.
 * OpenCode Go's `x-opencode-session` — until upstream injects a per-session
 * value automatically. Attribution reserved names still win at request time.
 */
function HeadersCard(props: {
  row: RouteRow
  disabled: boolean
  api: Pick<AdvancedModelsRemote, 'settings'>
  namespace: SettingsNamespaceView | undefined
  controller: AdvancedModelsStore
}): ReactNode {
  const { row, api, namespace, controller } = props
  const base = readHeaders(row.userProfile?.headers)
  const [draft, setDraft] = useState<HeaderRow[] | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const effective = draft ?? base
  const changed = draft !== undefined && JSON.stringify(draft) !== JSON.stringify(base)
  const fieldDisabled = props.disabled || busy

  const run = async (ops: readonly SettingsPathOpView[], doneNotice: string): Promise<void> => {
    if (namespace === undefined) return
    setBusy(true)
    setFailure(undefined)
    setNotice(undefined)
    const outcome = await writeOps(api, ops, namespace.revision)
    setBusy(false)
    if (outcome.kind === 'conflict') {
      setFailure('A configuração foi alterada em outro local. Recarregamos os dados; revise e salve novamente.')
      setDraft(undefined)
      await controller.load()
      return
    }
    if (outcome.kind === 'failure') {
      setFailure(outcome.message)
      return
    }
    setDraft(undefined)
    setNotice(doneNotice)
    await controller.load()
  }

  const save = async (): Promise<void> => {
    if (draft === undefined) return
    const parsed = parseHeaders(draft)
    if (!parsed.ok) {
      setFailure(parsed.error)
      setNotice(undefined)
      return
    }
    await run(
      Object.keys(parsed.value).length === 0
        ? [{ op: 'unset', path: [...row.entry.settingsPath, 'headers'] }]
        : [{ op: 'set', path: [...row.entry.settingsPath, 'headers'], value: parsed.value as JsonValue }],
      'Cabeçalhos salvos.',
    )
  }

  const restoreDefault = async (): Promise<void> => {
    if (base.length === 0) return
    await run(
      [{ op: 'unset', path: [...row.entry.settingsPath, 'headers'] }],
      'Cabeçalhos personalizados removidos.',
    )
  }

  const patchRow = (index: number, patch: Partial<HeaderRow>): void => {
    const next = effective.map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
    setDraft(next)
  }

  return (
    <details className="dshAma-newRoute dshAma-retryCard">
      <summary className="dshAma-newRouteSummary">
        {`Cabeçalhos personalizados (headers)${base.length === 0 ? ' (padrão: nenhum)' : ` (${String(base.length)} personalizados)`}`}
      </summary>
      <div className="dshAma-newRouteBody">
        <p className="dshAma-hint">
          Cabeçalhos HTTP estáticos adicionados a cada solicitação de modelo desta rota. Úteis para campos obrigatórios do gateway, como
          <code> x-opencode-session</code>. Os valores são iguais em todas as sessões; quando o gateway roteia por sessão,
          um valor fixo pode invalidar o cache. Nomes reservados, como <code>User-Agent</code>, não são substituídos por esta tabela.
        </p>
        {effective.length === 0
          ? <p className="dshAma-hint">Nenhum cabeçalho personalizado configurado.</p>
          : effective.map((entry, index) => (
            <div key={index} className="dshAma-kvRow">
              <input
                className="dshAma-input" type="text" value={entry.name}
                placeholder="x-opencode-session" aria-label={`Nome do cabeçalho ${String(index + 1)}`}
                disabled={fieldDisabled}
                onChange={(event) => { patchRow(index, { name: event.target.value }) }}
              />
              <input
                className="dshAma-input" type="text" value={entry.value}
                placeholder="valor" aria-label={`Valor do cabeçalho ${String(index + 1)}`}
                disabled={fieldDisabled}
                onChange={(event) => { patchRow(index, { value: event.target.value }) }}
              />
              <button
                type="button" className="dshAma-iconButton dshAma-iconButtonDanger"
                aria-label={`Remover cabeçalho ${String(index + 1)}`} disabled={fieldDisabled}
                onClick={() => {
                  setDraft(effective.filter((_, i) => i !== index))
                }}
              >×</button>
            </div>
          ))}
        <div className="dshAma-footer">
          {failure !== undefined ? <p className="dshAma-error">{failure}</p> : null}
          {notice !== undefined ? <p className="dshAma-notice">{notice}</p> : null}
          <button
            type="button" className="dshAma-button"
            disabled={fieldDisabled}
            onClick={() => { setDraft([...effective, { name: '', value: '' }]) }}
          >Adicionar cabeçalho</button>
          <button
            type="button" className="dshAma-button dshAma-buttonPrimary"
            disabled={fieldDisabled || !changed}
            onClick={() => { void save() }}
          >{busy ? 'Salvando…' : 'Salvar cabeçalhos'}</button>
          {base.length === 0 ? null : (
            <button
              type="button" className="dshAma-button"
              disabled={fieldDisabled}
              onClick={() => { void restoreDefault() }}
            >Remover todos</button>
          )}
          {changed ? (
            <button
              type="button" className="dshAma-button"
              disabled={fieldDisabled}
              onClick={() => { setDraft(undefined); setFailure(undefined); setNotice(undefined) }}
            >Desfazer alterações</button>
          ) : null}
        </div>
      </div>
    </details>
  )
}

/** Page styles (class prefix dshAma-), injected inline — the brand bundle has no CSS pipeline. */
const ADVANCED_CSS = `
.dshAma-root { display: flex; flex-direction: column; gap: 10px; padding-top: 16px; font-size: 13px; color: var(--dsw-alias-label-primary, #0f172a); }
.dshAma-intro { margin: 0; color: var(--dsw-alias-label-secondary, #64748b); line-height: 1.6; }
.dshAma-intro code, .dshAma-modeBanner code, .dshAma-newRouteBody code { padding: 0 3px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2, #f1f5f9); font-size: 12px; }
.dshAma-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dshAma-fieldLabel { color: var(--dsw-alias-label-secondary, #64748b); font-size: 12px; }
.dshAma-input { box-sizing: border-box; width: 100%; padding: 5px 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(15,23,42,.18)); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; font-size: 13px; }
.dshAma-input:disabled { opacity: .55; }
.dshAma-select { appearance: auto; }
.dshAma-inline { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.dshAma-routePicker { display: flex; gap: 8px; align-items: flex-end; }
.dshAma-routePicker .dshAma-field { flex: 1; }
.dshAma-refreshButton { flex: none; margin-bottom: 1px; }
.dshAma-capacityRow { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.dshAma-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.dshAma-hint { margin: 2px 0; color: var(--dsw-alias-label-secondary, #64748b); font-size: 12px; line-height: 1.5; }
.dshAma-error { margin: 2px 0; color: #dc2626; font-size: 12px; }
.dshAma-notice { margin: 2px 0; color: #16a34a; font-size: 12px; }
.dshAma-muted { color: var(--dsw-alias-label-secondary, #94a3b8); }
.dshAma-routeInfo { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 6px; margin: 0; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1, rgba(15,23,42,.08)); border-radius: 8px; background: var(--dsw-alias-bg-layer-2, #f8fafc); }
.dshAma-routeInfo div { display: flex; gap: 6px; min-width: 0; }
.dshAma-routeInfo dt { color: var(--dsw-alias-label-secondary, #64748b); flex: none; font-size: 12px; }
.dshAma-routeInfo dd { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.dshAma-modeBanner { padding: 7px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1, rgba(15,23,42,.08)); background: var(--dsw-alias-bg-layer-2, #f8fafc); line-height: 1.6; color: var(--dsw-alias-label-secondary, #475569); }
.dshAma-listHead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
.dshAma-listTitle { font-weight: 600; }
.dshAma-linkButton { padding: 0; border: none; background: none; color: var(--dsw-alias-brand-primary, #3b82f6); cursor: pointer; font-size: 12px; }
.dshAma-linkButton:disabled { opacity: .5; cursor: default; }
.dshAma-addOverride { width: auto; min-width: 200px; }
.dshAma-entry { border: 1px solid var(--dsw-alias-border-l1, rgba(15,23,42,.08)); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #fff); overflow: hidden; }
.dshAma-entry + .dshAma-entry { margin-top: 6px; }
.dshAma-entryHead { display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
.dshAma-entryId { font-weight: 600; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshAma-entryName { color: var(--dsw-alias-label-secondary, #94a3b8); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshAma-badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; }
.dshAma-badgeCatalog { background: rgba(59, 130, 246, .12); color: #2563eb; }
.dshAma-badgeCustom { background: rgba(22, 163, 74, .12); color: #16a34a; }
.dshAma-entryBody { display: flex; flex-direction: column; gap: 10px; padding: 10px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(15,23,42,.08)); }
.dshAma-iconButton { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: none; border-radius: 6px; background: none; color: var(--dsw-alias-label-secondary, #64748b); cursor: pointer; font-size: 10px; }
.dshAma-iconButton:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, rgba(148,163,184,.15)); }
.dshAma-iconButtonDanger:hover:not(:disabled) { color: #dc2626; }
.dshAma-iconButton:disabled { opacity: .5; cursor: default; }
.dshAma-kvRow { display: grid; grid-template-columns: minmax(120px, 200px) 1fr 24px; gap: 6px; align-items: center; }
.dshAma-kvKey { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--dsw-alias-label-secondary, #475569); }
.dshAma-readonlyValue { font-size: 12px; color: var(--dsw-alias-label-secondary, #94a3b8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshAma-check { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.dshAma-levelGrid { display: flex; flex-wrap: wrap; gap: 10px 14px; padding: 6px 0; }
.dshAma-invalid { color: #dc2626; }
.dshAma-footer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.dshAma-button { padding: 5px 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(15,23,42,.18)); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; cursor: pointer; font-size: 12.5px; }
.dshAma-button:disabled { opacity: .5; cursor: default; }
.dshAma-buttonPrimary { border-color: transparent; background: var(--dsw-alias-brand-primary, #3b82f6); color: var(--dsw-alias-label-primary-foreground, #fff); }
.dshAma-newRoute { border: 1px solid var(--dsw-alias-border-l1, rgba(15,23,42,.08)); border-radius: 8px; margin-top: 8px; }
.dshAma-retryCard { margin-top: 0; }
.dshAma-newRouteSummary { padding: 8px 10px; cursor: pointer; color: var(--dsw-alias-label-secondary, #475569); font-size: 12.5px; }
.dshAma-newRouteBody { display: flex; flex-direction: column; gap: 10px; padding: 10px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(15,23,42,.08)); }
.dshAma-modalMask { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, .45); }
.dshAma-modal { display: flex; flex-direction: column; width: min(560px, calc(100vw - 48px)); max-height: min(560px, calc(100vh - 48px)); border-radius: 10px; background: var(--dsw-alias-bg-overlay, #fff); box-shadow: 0 20px 50px rgba(15, 23, 42, .25); }
.dshAma-modalHead { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(15,23,42,.08)); }
.dshAma-modalTitle { font-weight: 600; }
.dshAma-modalBody { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; overflow: auto; }
.dshAma-modalFoot { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(15,23,42,.08)); }
.dshAma-providerList { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow: auto; }
.dshAma-providerRow { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l1, rgba(15,23,42,.08)); border-radius: 8px; background: none; cursor: pointer; text-align: left; color: inherit; }
.dshAma-providerRowActive { border-color: var(--dsw-alias-brand-primary, #3b82f6); }
.dshAma-providerId { font-weight: 600; font-size: 12.5px; }
.dshAma-providerMeta { color: var(--dsw-alias-label-secondary, #94a3b8); font-size: 11.5px; }
.dshAma-candidateBlock { display: flex; flex-direction: column; gap: 6px; }
.dshAma-candidateList { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0 0 0 4px; list-style: none; max-height: 200px; overflow: auto; }
.dshAma-candidate { font-size: 12.5px; }
.dshAma-capabilityHint { padding: 6px 8px; border-left: 2px solid var(--dsw-alias-brand-primary, #3b82f6); background: var(--dsw-alias-bg-layer-2, #f1f5f9); color: var(--dsw-alias-label-secondary, #64748b); font-size: 12px; line-height: 1.5; }
.dshAma-discoveryModal { width: min(640px, calc(100vw - 48px)); }
.dshAma-discoverySource { display: flex; gap: 8px; align-items: center; min-width: 0; }
.dshAma-discoverySourceLabel { color: var(--dsw-alias-label-secondary, #64748b); font-size: 12px; }
.dshAma-discoverySource code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshAma-discoveryToolbar { display: flex; gap: 8px; align-items: center; }
.dshAma-discoveryToolbar .dshAma-input { flex: 1; min-width: 0; }
.dshAma-discoveryList { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow: auto; }
.dshAma-discoveryRow { display: flex; gap: 8px; align-items: flex-start; padding: 7px 8px; border: 1px solid var(--dsw-alias-border-l1, rgba(15,23,42,.08)); border-radius: 6px; cursor: pointer; }
.dshAma-discoveryRow:hover { background: var(--dsw-alias-bg-layer-2, #f1f5f9); }
.dshAma-discoveryModel { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 2px; }
.dshAma-discoveryModel strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.dshAma-discoveryModel small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary, #94a3b8); font-size: 11.5px; }
.dshAma-error p { margin: 0 0 6px; }
`
