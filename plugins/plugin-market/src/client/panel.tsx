/**
 * The market panel: a sidebar footer entry ("插件市场") that opens a
 * right-side drawer over the host's market routes.
 *
 * Three tabs keep each concern scannable: 目录 (browse + install/update, with
 * per-source failure reporting), 已安装 (profile dependencies + mount state +
 * updates + uninstall), 软件源 (the https URL list the catalog is fetched
 * from). The installed tab separates its two counts: the label carries the
 * installed total (what the user owns), while pending updates live in a
 * corner badge and a dismissible in-tab banner (one day per dismissal) — a
 * backlog of 2 inside a library of 15 never reads as "only 2 installed".
 * Opening renders from the host's TTL cache when it answers
 * (`cached`), and the payload's `stale`/`snapshot` flags drive an explicit
 * rescue banner instead of silent background work — a failed fetch already
 * burned its timeout once, so retrying stays a visible user decision. The
 * catalog and the installed list are independent requests, and the installed
 * list itself loads in two phases: the local facts first (no registry
 * round-trip, so it paints at once), then a `?updates=1` probe whose fields
 * merge onto the rows already on screen. All
 * state is local to the open panel — closing it drops the view, reopening
 * refetches, so the panel never shows stale mount state.
 *
 * @module @dsh-app/plugin-market/client/panel
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { normalizeNpmName } from '../identity.ts'
import { marketApi, MarketApiError, PAGED_SOURCE_HOST } from './api.ts'
import type { CatalogEntry, CatalogValue, InstalledPackage, SourcesValue, UpdateValue } from './api.ts'
import { categoryOptionsOf, entryMatchesQuery } from './catalog-filter.ts'
import { ConfirmDialog } from './confirm-dialog.tsx'
import { sameNameStateOf, updatablePackages, mergeUpdateFacts } from './installed-projection.ts'

type Tab = 'catalog' | 'installed' | 'sources'

/** One line of the dismissible status strip (error or success notice). */
interface Strip {
  readonly kind: 'error' | 'ok'
  readonly text: string
  /** CLI output tail attachable to a success notice. */
  readonly output?: string
  /**
   * Package names pnpm skipped build scripts for — the strip grows a warning
   * bar with the allow-and-retry action (present = signal detected; possibly
   * empty when no name could be extracted from the message).
   */
  readonly blockedBuilds?: readonly string[]
  /** The package a blocked-builds retry would reinstall. */
  readonly retryPackage?: string
}

/** How the served catalog payload was produced (drives the hint banners). */
interface ServedCatalogInfo {
  readonly cachedAt?: number
  readonly cached?: boolean
  readonly stale?: boolean
  readonly snapshot?: boolean
  readonly snapshotAt?: string
}

/** Age beyond which the cache hint calls the snapshot old. */
const CATALOG_CACHE_STALE_MS = 24 * 60 * 60 * 1000

/** Success notices self-clear; errors stay until dismissed (they need reading time). */
const STRIP_AUTO_CLEAR_MS = 8000

/** Beyond these sizes the CLI output tail starts collapsed behind a toggle. */
const LOG_COLLAPSE_LINES = 6
const LOG_COLLAPSE_CHARS = 400

/** localStorage key remembering the day the updates banner was dismissed. */
const UPDATES_BANNER_KEY = 'dshMkt.updatesBannerDismissedOn'

/** Local-calendar date stamp (YYYY-MM-DD) — "same day" follows the user's clock. */
function localDateStamp(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function isUpdatesBannerDismissed(): boolean {
  try {
    return localStorage.getItem(UPDATES_BANNER_KEY) === localDateStamp()
  } catch {
    // Storage unavailable (private mode etc.): the banner simply stays askable.
    return false
  }
}

function isLongOutput(output: string): boolean {
  return output.split(/\r?\n/).length > LOG_COLLAPSE_LINES || output.length > LOG_COLLAPSE_CHARS
}

/** Humanized cache age for the hint ("3 分钟前"); sub-minute reads as fresh. */
function cacheAgeText(cachedAt: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - cachedAt) / 60_000))
  if (minutes < 1) return 'agora mesmo'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  return `há ${Math.floor(hours / 24)} dias`
}

function messageOf(error: unknown): string {
  if (error instanceof MarketApiError) return error.message
  return error instanceof Error ? error.message : 'Falha na solicitação'
}

/**
 * The CLI output tail of a status strip: short tails render directly, long
 * ones start collapsed behind a "查看日志" toggle so a full pnpm log cannot
 * flood the panel.
 */
function StripOutput({ output }: { output: string }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const long = isLongOutput(output)
  return (
    <>
      {long ? (
        <button type="button" className="dshMkt-logToggle" onClick={() => setExpanded(flag => !flag)}>
           {expanded ? 'Ocultar log' : 'Ver log'}
        </button>
      ) : null}
      {!long || expanded ? <pre className="dshMkt-log">{output}</pre> : null}
    </>
  )
}

/**
 * The blocked-builds warning inside a status strip: names the packages whose
 * build scripts pnpm skipped and offers the allow-and-retry action. When no
 * name could be extracted from the pnpm message the button stays hidden —
 * retrying with an empty whitelist could not change anything — and the copy
 * points at the manual fix instead.
 */
function BlockedBuildBar({
  names, retryPackage, busyPackage, onRetry,
}: {
  names: readonly string[]
  retryPackage: string | undefined
  busyPackage: string | null
  onRetry: (pkg: string, names: readonly string[]) => void
}): ReactNode {
  return (
    <div className="dshMkt-blockedBar">
      <span className="dshMkt-stripText">
        {names.length > 0
           ? `Scripts de build bloqueados e possivelmente afetando o funcionamento: ${names.join(', ')}`
           : 'Scripts de build de dependências foram bloqueados. Libere-os em onlyBuiltDependencies no pnpm-workspace.yaml do profile.'}
      </span>
      {names.length > 0 && retryPackage !== undefined ? (
        <button
          type="button"
          className="dshMkt-button dshMkt-buttonPrimary"
          disabled={busyPackage !== null}
          onClick={() => { onRetry(retryPackage, names) }}
        >
          {busyPackage === retryPackage ? <span className="dshMkt-spinner" aria-hidden="true" /> : null}
           {busyPackage === retryPackage ? ' Liberando…' : 'Liberar e tentar novamente'}
        </button>
      ) : null}
    </div>
  )
}

/**
 * Market glyph: a 2×2 grid of rounded plugin tiles in the host's linear icon
 * language; the bottom-right tile carries an inset outline — the "active"
 * tile in the collection.
 */
function MarketGlyph({ size }: { size: number }): ReactNode {
  return (
    <svg className="dshMkt-glyph" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.25" y="3.25" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <rect x="12.75" y="3.25" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <rect x="3.25" y="12.75" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <rect x="12.75" y="12.75" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <rect x="14.95" y="14.95" width="3.6" height="3.6" rx="1" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * The sidebar footer action: a labeled row when the sidebar is wide, a plain
 * icon button on the 56px rail. Geometry mirrors the host's settings trigger
 * (42px row / 36px rail circle, 16px wide icon / 18px rail icon) so both foot
 * rows read as one control set.
 */
export function MarketFooterAction(props: { wide: boolean }): ReactNode {
  const { wide } = props
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={wide ? 'dshMkt-rowBtn' : 'dshMkt-iconBtn'}
        aria-haspopup="dialog"
        aria-expanded={open}
         aria-label="Marketplace de plugins"
         title="Marketplace de plugins"
        onClick={() => setOpen(true)}
      >
        <MarketGlyph size={wide ? 16 : 18} />
         {wide ? <span>Marketplace de plugins</span> : null}
      </button>
      {open ? <MarketPanel onClose={() => setOpen(false)} /> : null}
    </>
  )
}

/**
 * The drawer body. Mounts only while open (the entry above unmounts it), so
 * every open starts from fresh data.
 */
function MarketPanel({ onClose }: { onClose: () => void }): ReactNode {
  const [tab, setTab] = useState<Tab>('catalog')
  const [strip, setStrip] = useState<Strip | null>(null)
  const [loading, setLoading] = useState(true)
  const [installedLoading, setInstalledLoading] = useState(true)
  /** True while the follow-up `?updates=1` probe runs (list already visible). */
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [cacheInfo, setCacheInfo] = useState<ServedCatalogInfo | null>(null)
  const [entries, setEntries] = useState<readonly CatalogEntry[]>([])
  const [failedSources, setFailedSources] = useState<ReadonlyArray<{ url: string, reason: string }>>([])
  /** The catalog request itself failed (kept apart from per-source failures). */
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [installed, setInstalled] = useState<readonly InstalledPackage[]>([])
  const [sources, setSources] = useState<readonly string[]>([])
  const [sourceInput, setSourceInput] = useState('')
  const [busyPackage, setBusyPackage] = useState<string | null>(null)
  const [togglingPackage, setTogglingPackage] = useState<string | null>(null)
  const [savingSources, setSavingSources] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<InstalledPackage | null>(null)
  /**
   * The entry an install confirm is open for, with the cross-origin flag the
   * card computed: it upgrades the confirm copy and turns the request into
   * the force-confirmed replacement the host's gate requires.
   */
  const [installTarget, setInstallTarget] = useState<{ readonly entry: CatalogEntry, readonly crossOrigin: boolean } | null>(null)
  // Read once per panel mount: a same-day dismissal survives closing and
  // reopening the panel, a new day asks again.
  const [updatesDismissed, setUpdatesDismissed] = useState(isUpdatesBannerDismissed)
  // Enter/exit are one CSS transition: the drawer mounts off-screen and is
  // flipped on the next frame, and a close request flips it back before the
  // unmount lands, so the panel slides both ways instead of vanishing.
  const [shown, setShown] = useState(false)
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => { setShown(true) })
    return () => { cancelAnimationFrame(id) }
  }, [])

  const requestClose = useCallback((): void => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    window.setTimeout(onClose, CLOSE_ANIMATION_MS)
  }, [onClose])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [requestClose])

  // Success strips self-clear so a settled action never lingers; each new
  // strip (object identity) restarts the timer, unmount cancels it. A strip
  // carrying a blocked-builds warning stays up: it carries the pending
  // allow-and-retry decision, and a self-clearing action button would vanish
  // before the user reaches it.
  useEffect(() => {
    if (strip === null || strip.kind !== 'ok' || strip.blockedBuilds !== undefined) return
    const timer = setTimeout(() => { setStrip(null) }, STRIP_AUTO_CLEAR_MS)
    return () => { clearTimeout(timer) }
  }, [strip])

  const applyCatalogValue = useCallback((value: CatalogValue): void => {
    setEntries(value.plugins)
    setFailedSources(value.failed)
    setSources(value.sources)
    setCacheInfo({
      cachedAt: value.cachedAt,
      cached: value.cached,
      stale: value.stale,
      snapshot: value.snapshot,
      snapshotAt: value.snapshotAt,
    })
    setCatalogError(null)
  }, [])

  /**
   * Second paint: ask for the registry update facts and merge them onto the
   * rows already on screen. Runs only after the local read has rendered, so
   * the registry round-trips can never gate the list; a failure leaves the
   * local rows untouched (the tab's refresh retries).
   */
  const loadInstalledUpdates = useCallback(async (): Promise<void> => {
    setCheckingUpdates(true)
    try {
      const probed = await marketApi.installed(true)
      // mergeUpdateFacts keeps the array identity when nothing changed, so a
      // "no updates" answer re-renders nothing and the list never jumps.
      setInstalled(current => mergeUpdateFacts(current, probed.packages))
    } catch {
      // Supplement only: the probe timing out or failing must not disturb the
      // local facts already shown.
    } finally {
      setCheckingUpdates(false)
    }
  }, [])

  const loadInstalled = useCallback(async (): Promise<void> => {
    setInstalledLoading(true)
    try {
      // Local facts only: no `updates`, so the host answers from disk and the
      // list paints without waiting on any registry request.
      const value = await marketApi.installed()
      setInstalled(value.packages)
    } catch (error) {
      setStrip({ kind: 'error', text: `Falha ao ler a lista instalada: ${messageOf(error)}` })
      return
    } finally {
      setInstalledLoading(false)
    }
    void loadInstalledUpdates()
  }, [loadInstalledUpdates])

  /**
   * Force reload: skips the host cache and pays the live fetch. The spinner
   * blocks the tab honestly — the user pressed "reload", not "browse cache".
   */
  const refreshCatalog = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      applyCatalogValue(await marketApi.catalog(true))
    } catch (error) {
      // The request (not a source) failed: the catalog tab shows the reason
      // with a prominent reload, not the top strip alone.
      setCatalogError(messageOf(error))
    } finally {
      setLoading(false)
    }
  }, [applyCatalogValue])

  useEffect(() => {
    let cancelled = false
    // Two independent requests. On a cold open the catalog may pay a live
    // source fetch (no cache, 30 s per source), so the installed list must
    // never queue behind it — it starts now and paints from the local read.
    void (async (): Promise<void> => {
      setLoading(true)
      try {
        const served = await marketApi.catalog()
        if (cancelled) return
        applyCatalogValue(served)
      } catch (error) {
        if (!cancelled) setCatalogError(messageOf(error))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    void loadInstalled()
    return () => { cancelled = true }
  }, [applyCatalogValue, loadInstalled])

  // Keys are normalized npm names: a catalog source's casing must never hide
  // a same-name collision.
  const installedByName = new Map(installed.map(pkg => [normalizeNpmName(pkg.name), pkg]))
  const updatable = updatablePackages(installed)
  const updateCount = updatable.length

  /** Dismiss the updates banner for the rest of the day. */
  const dismissUpdatesBanner = (): void => {
    try {
      localStorage.setItem(UPDATES_BANNER_KEY, localDateStamp())
    } catch {
      // Same degradation as the read: the panel-local state still hides it.
    }
    setUpdatesDismissed(true)
  }

  const saveSources = async (urls: readonly string[]): Promise<boolean> => {
    setSavingSources(true)
    try {
      const value: SourcesValue = await marketApi.saveSources(urls)
      setSources(value.sources)
      setStrip(null)
      return true
    } catch (error) {
      setStrip({ kind: 'error', text: `Falha ao salvar: ${messageOf(error)}` })
      return false
    } finally {
      setSavingSources(false)
    }
  }

  const addSource = async (): Promise<void> => {
    const candidate = sourceInput.trim()
    if (candidate === '') return
    // Keep the optimistic append; a rejected save restores the previous list.
    const previous = sources
    setSourceInput('')
    setSources([...sources, candidate])
    const saved = await saveSources([...sources, candidate])
    if (!saved) setSources(previous)
  }

  const removeSource = async (url: string): Promise<void> => {
    const next = sources.filter(item => item !== url)
    const previous = sources
    setSources(next)
    const saved = await saveSources(next)
    if (!saved) setSources(previous)
  }

  /** Blocked-builds fields of a result/error, for the strip's warning bar. */
  const blockedStripFields = (blockedBuilds: readonly string[] | undefined, retryPackage: string) =>
    (blockedBuilds !== undefined ? { blockedBuilds, retryPackage } : {})

  const install = async (target: { readonly entry: CatalogEntry, readonly crossOrigin: boolean }): Promise<void> => {
    const { entry, crossOrigin } = target
    setBusyPackage(entry.package)
    setInstallTarget(null)
    setStrip(null)
    try {
      // A cross-origin replacement rides the force path: the flag satisfies
      // the host's same-name gate, and the entry's repo key lets the gate's
      // refusal/log name both sides of the comparison.
      const result = await marketApi.install(entry.package, undefined, crossOrigin ? true : undefined, entry.repoKey)
      void loadInstalled()
      const replacedNote = result.replacedLocal === true
        ? ' (substituiu a versão local/Git anterior)'
        : (crossOrigin ? ' (substituiu o plugin anterior de mesmo nome)' : '')
      setStrip({
        kind: 'ok',
        text: `${entry.package}${result.version === undefined ? '' : `@${result.version}`} instalado. Reinicie o aplicativo para aplicar.${replacedNote}`,
        output: result.output,
        ...blockedStripFields(result.blockedBuilds, entry.package),
      })
    } catch (error) {
      const blocked = error instanceof MarketApiError ? error.blockedBuilds : undefined
      setStrip({
        kind: 'error',
        text: `Falha na instalação: ${messageOf(error)}`,
        ...blockedStripFields(blocked, entry.package),
      })
    } finally {
      setBusyPackage(null)
    }
  }

  /**
   * Retry path after a blocked-builds result: whitelist the packages, then
   * re-run the install. The retry may still report blocked builds (e.g. more
   * than one package needed approving across runs), so the strip keeps its
   * warning bar in that case.
   */
  const allowAndRetry = async (pkgName: string, names: readonly string[]): Promise<void> => {
    setBusyPackage(pkgName)
    try {
      const result = await marketApi.allowBuild(pkgName, names)
      void loadInstalled()
      setStrip({
        kind: 'ok',
        text: `Scripts liberados e ${pkgName}${result.version === undefined ? '' : `@${result.version}`} reinstalado. Reinicie o aplicativo para aplicar.`,
        output: result.output,
        ...blockedStripFields(result.blockedBuilds, pkgName),
      })
    } catch (error) {
      const blocked = error instanceof MarketApiError ? error.blockedBuilds : undefined
      setStrip({
        kind: 'error',
        text: `Falha ao liberar e tentar novamente: ${messageOf(error)}`,
        ...blockedStripFields(blocked, pkgName),
      })
    } finally {
      setBusyPackage(null)
    }
  }

  /**
   * One installed package to the registry's latest, server-gated via /update.
   * Returns whether it succeeded so the batch loop can count failures.
   */
  const updatePackage = async (pkg: InstalledPackage): Promise<boolean> => {
    setBusyPackage(pkg.name)
    setStrip(null)
    try {
      const result: UpdateValue = await marketApi.update(pkg.name)
      void loadInstalled()
      setStrip({
        kind: 'ok',
        text: `${pkg.name}${result.version === undefined ? '' : `@${result.version}`} atualizado. Reinicie o aplicativo para aplicar.`,
        output: result.output,
        ...blockedStripFields(result.blockedBuilds, pkg.name),
      })
      return true
    } catch (error) {
      const blocked = error instanceof MarketApiError ? error.blockedBuilds : undefined
      setStrip({
        kind: 'error',
        text: `Falha na atualização: ${messageOf(error)}`,
        ...blockedStripFields(blocked, pkg.name),
      })
      return false
    } finally {
      setBusyPackage(null)
    }
  }

  /**
   * Batch update over exactly the packages the tab badge counts. One at a
   * time — the installer queue serializes server-side and the panel is honest
   * about a single mutation — and over a list snapshotted at click: each
   * per-package refresh re-renders `installed`, and the loop must not
   * re-derive its targets mid-run.
   */
  const updateAll = async (): Promise<void> => {
    const targets = updatablePackages(installed)
    let failed = 0
    for (const pkg of targets) {
      const ok = await updatePackage(pkg)
      if (!ok) failed += 1
    }
    setStrip(failed === 0
      ? { kind: 'ok', text: `${targets.length} plugins atualizados. Reinicie o aplicativo para aplicar.` }
      : { kind: 'error', text: `Atualização em lote concluída: ${targets.length - failed} com sucesso, ${failed} com falha. Tente novamente individualmente.` })
  }

  const uninstall = async (pkg: InstalledPackage): Promise<void> => {
    setBusyPackage(pkg.name)
    setConfirmTarget(null)
    setStrip(null)
    try {
      const result = await marketApi.uninstall(pkg.name)
      void loadInstalled()
      setStrip({ kind: 'ok', text: `${pkg.name} desinstalado. Reinicie o aplicativo para aplicar.`, output: result.output })
    } catch (error) {
      setStrip({ kind: 'error', text: `Falha ao desinstalar: ${messageOf(error)}` })
    } finally {
      setBusyPackage(null)
    }
  }

  const togglePackage = async (pkg: InstalledPackage): Promise<void> => {
    setTogglingPackage(pkg.name)
    setStrip(null)
    try {
      const value = await marketApi.toggle(pkg.name, pkg.entryId, !pkg.enabled)
      void loadInstalled()
      setStrip({ kind: 'ok', text: `${value.package} ${value.enabled ? 'ativado' : 'desativado'} (configuração recarregada).` })
    } catch (error) {
      setStrip({ kind: 'error', text: `Falha ao ${pkg.enabled ? 'desativar' : 'ativar'}: ${messageOf(error)}` })
    } finally {
      setTogglingPackage(null)
    }
  }

  /**
   * Install confirm copy. A cross-origin install leads with the replacement
   * warning — the locally installed repo when provable, 未知来源 when not —
   * so the confirm button reads as an informed replacement decision, never
   * a plain install.
   */
  const installConfirmMessage = (): string => {
    if (installTarget === null) return ''
    const installed = installedByName.get(normalizeNpmName(installTarget.entry.package))
    const warning = installTarget.crossOrigin && installed !== undefined
      ? `已安装的同名插件来自不同仓库（本地：${installed.repoKey ?? '未知来源'}），安装将替换它。`
      : ''
    return `${warning}将安装 ${installTarget.entry.package}（${installTarget.entry.name}）。安装会执行该包随包携带的安装脚本，请确认它来自你信任的软件源。`
  }

  return (
    <div className={shown && !closing ? 'dshMkt-drawer dshMkt-drawerOn' : 'dshMkt-drawer'} role="presentation">
      {/* The drawer slides in over the right edge without dimming the page:
          browsing a catalog is not a modal decision. The collapse control is
          the edge handle (centered on the left border), so no control has to
          live near the native window buttons or the drag strip. */}
      <button
        type="button"
        className="dshMkt-handle"
        onClick={requestClose}
         aria-label="Recolher marketplace de plugins"
         title="Recolher"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="dshMkt-panel" role="dialog" aria-modal="false" aria-label="Marketplace de plugins">
        <div className="dshMkt-head">
          <h2 className="dshMkt-title">Marketplace de plugins</h2>
        </div>
        <div className="dshMkt-tabs" role="tablist">
          {([['catalog', 'Catálogo'], ['installed', 'Instalados'], ['sources', 'Fontes']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'dshMkt-tab dshMkt-tabOn' : 'dshMkt-tab'}
              onClick={() => { setTab(key) }}
            >
              {key === 'installed' ? `${label}（${installed.length}）` : label}
              {key === 'installed' && updateCount > 0 ? (
                <span className="dshMkt-tabBadge" title={`${updateCount} plugins têm atualizações disponíveis`}>
                  {updateCount > 99 ? '99+' : updateCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="dshMkt-body">
          {strip !== null ? (
            <div className={strip.kind === 'error' ? 'dshMkt-banner' : 'dshMkt-noticeOk'} role={strip.kind === 'error' ? 'alert' : 'status'}>
              <div className="dshMkt-stripBody">
                <span className="dshMkt-stripText">{strip.text}</span>
                <button type="button" className="dshMkt-stripClose" aria-label="Fechar aviso" onClick={() => { setStrip(null) }}>
                  ×
                </button>
              </div>
              {strip.output !== undefined && strip.output !== ''
                ? <StripOutput key={strip.output} output={strip.output} />
                : null}
              {strip.blockedBuilds !== undefined ? (
                <BlockedBuildBar
                  names={strip.blockedBuilds}
                  retryPackage={strip.retryPackage}
                  busyPackage={busyPackage}
                  onRetry={(pkgName, names) => { void allowAndRetry(pkgName, names) }}
                />
              ) : null}
            </div>
          ) : null}

          {tab === 'catalog' ? (
            <CatalogTab
              loading={loading}
              loadError={catalogError}
              entries={entries}
              failedSources={failedSources}
              installedByName={installedByName}
              busyPackage={busyPackage}
              cacheInfo={cacheInfo}
              onRefresh={() => { void refreshCatalog() }}
              onGoSources={() => { setTab('sources') }}
              onInstall={(entry, crossOrigin) => { setInstallTarget({ entry, crossOrigin }) }}
              onUpdate={(pkg) => { void updatePackage(pkg) }}
            />
          ) : null}

          {tab === 'installed' ? (
            <>
              {updateCount > 0 && !updatesDismissed ? (
                <div className="dshMkt-noticeOk" role="status">
                  <div className="dshMkt-stripBody">
                    <span className="dshMkt-stripText">{updateCount} plugins têm atualizações disponíveis</span>
                    <button
                      type="button"
                      className="dshMkt-button dshMkt-buttonPrimary"
                      disabled={busyPackage !== null || togglingPackage !== null}
                      onClick={() => { void updateAll() }}
                    >
                      Atualizar todos
                    </button>
                    <button type="button" className="dshMkt-stripClose" aria-label="Não lembrar hoje" onClick={dismissUpdatesBanner}>
                      ×
                    </button>
                  </div>
                </div>
              ) : null}
              <InstalledTab
                loading={installedLoading}
                checkingUpdates={checkingUpdates}
                packages={installed}
                busyPackage={busyPackage}
                togglingPackage={togglingPackage}
                onRefresh={() => { void loadInstalled() }}
                onToggle={(pkg) => { void togglePackage(pkg) }}
                onUninstall={(pkg) => { setConfirmTarget(pkg) }}
                onUpdate={(pkg) => { void updatePackage(pkg) }}
              />
            </>
          ) : null}

          {tab === 'sources' ? (
            <SourcesTab
              loading={loading}
              sources={sources}
              saving={savingSources}
              input={sourceInput}
              onInput={setSourceInput}
              onAdd={() => { void addSource() }}
              onRemove={(url) => { void removeSource(url) }}
              onRefresh={() => { void refreshCatalog() }}
            />
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmTarget !== null}
        title="Desinstalar plugin"
        message={confirmTarget === null ? '' : `Desinstalar ${confirmTarget.name}? Ele também será removido da camada montada e exigirá reiniciar o aplicativo.`}
        confirmLabel="Desinstalar"
        tone="dark"
        busy={busyPackage !== null}
        onConfirm={() => { if (confirmTarget !== null) void uninstall(confirmTarget) }}
        onClose={() => { setConfirmTarget(null) }}
      />

      <ConfirmDialog
        open={installTarget !== null}
        title="Instalar plugin"
        message={installConfirmMessage()}
        confirmLabel="Instalar"
        busy={busyPackage !== null}
        onConfirm={() => { if (installTarget !== null) void install(installTarget) }}
        onClose={() => { setInstallTarget(null) }}
      />
    </div>
  )
}

interface CatalogTabProps {
  loading: boolean
  /** Non-null = the catalog request itself failed (distinct from per-source failures). */
  loadError: string | null
  entries: readonly CatalogEntry[]
  failedSources: ReadonlyArray<{ url: string, reason: string }>
  installedByName: ReadonlyMap<string, InstalledPackage>
  busyPackage: string | null
  cacheInfo: ServedCatalogInfo | null
  onRefresh: () => void
  onGoSources: () => void
  /** `crossOrigin` marks the same-name-different-repo install (upgraded confirm + force). */
  onInstall: (entry: CatalogEntry, crossOrigin: boolean) => void
  onUpdate: (pkg: InstalledPackage) => void
}

/** Rows rendered per page: large directories stay past 3000 entries. */
/** Must match the drawer's CSS transition duration. */
const CLOSE_ANIMATION_MS = 220
const CATALOG_PAGE_SIZE = 100

/** "作者 · 下载量/ stars · 分类" byline of a catalog card (parts may be absent). */
function cardByline(entry: CatalogEntry): string {
  const metric = entry.installs30d !== undefined
    ? `30 天安装 ${entry.installs30d}`
    : (entry.stars !== undefined ? `★ ${entry.stars}` : undefined)
  return [entry.owner, metric, entry.category].filter(part => part !== undefined).join(' · ')
}

function CatalogTab({
  loading, loadError, entries, failedSources, installedByName, busyPackage, cacheInfo, onRefresh, onGoSources, onInstall, onUpdate,
}: CatalogTabProps): ReactNode {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [visible, setVisible] = useState(CATALOG_PAGE_SIZE)

  // Distinct options in first-seen order, keyed on the stable categoryId (the
  // label is the fallback key for rows persisted before ids were resolved);
  // "全部" stays the implicit first choice.
  const categories = categoryOptionsOf(entries)

  // Client-side narrowing only — the host already merged and capped the rows.
  const needle = query.trim().toLowerCase()
  const filtered = entries.filter((entry) => {
    if (category !== '' && (entry.categoryId ?? entry.category) !== category) return false
    return entryMatchesQuery(entry, needle)
  })

  // A new filter resets the page window, so a fresh search starts at the top.
  useEffect(() => { setVisible(CATALOG_PAGE_SIZE) }, [query, category])

  if (loading) {
    return (
      <div className="dshMkt-empty">
        <span className="dshMkt-spinner" aria-hidden="true" /> Carregando catálogo…
      </div>
    )
  }
  // Request-level failure with nothing to show: the reload must be the
  // prominent action on the catalog page, not a line in the top strip.
  // (The snapshot fallback always brings entries, so it never lands here.)
  if (loadError !== null || (entries.length === 0 && failedSources.length > 0)) {
    return (
      <div className="dshMkt-failBox" role="alert">
        <p className="dshMkt-failTitle">Falha ao carregar o catálogo</p>
        {loadError !== null ? <p className="dshMkt-failReason">{loadError}</p> : null}
        {failedSources.map(item => (
          <p key={item.url} className="dshMkt-failReason">{item.url} — {item.reason}</p>
        ))}
        <button type="button" className="dshMkt-button dshMkt-buttonPrimary" onClick={onRefresh}>Recarregar</button>
      </div>
    )
  }
  return (
    <>
      {cacheInfo?.snapshot === true ? (
        <div className="dshMkt-noticeOk" role="status">
          <div className="dshMkt-stripBody">
            <span className="dshMkt-stripText">Snapshot offline · {entries.length} itens · clique para obter dados atuais</span>
          </div>
          <div className="dshMkt-bannerActions">
            <button type="button" className="dshMkt-button" onClick={onRefresh}>Recarregar</button>
          </div>
        </div>
      ) : cacheInfo?.stale === true ? (
        <div className="dshMkt-banner" role="alert">
          As fontes do catálogo estão indisponíveis; exibindo conteúdo em cache de {cacheAgeText(cacheInfo.cachedAt ?? Date.now())}.
        </div>
      ) : cacheInfo?.cached === true ? (
        <div className="dshMkt-rowBetween">
          <span className="dshMkt-hint">
            Catálogo armazenado em cache {cacheAgeText(cacheInfo.cachedAt ?? Date.now())}; atualização automática após 6 horas
            {cacheInfo.cachedAt !== undefined && Date.now() - cacheInfo.cachedAt > CATALOG_CACHE_STALE_MS ? ' (cache antigo)' : ''}
          </span>
          <button type="button" className="dshMkt-button" onClick={onRefresh}>Recarregar</button>
        </div>
      ) : null}
      {failedSources.length > 0 && cacheInfo?.snapshot !== true ? (
        <div className="dshMkt-banner" role="alert">
          Falha ao obter {failedSources.length} fontes do catálogo:
          {failedSources.map(item => (
            <div key={item.url}>{item.url} — {item.reason}</div>
          ))}
          <div className="dshMkt-bannerActions">
            <button type="button" className="dshMkt-button" onClick={onRefresh}>Recarregar</button>
          </div>
        </div>
      ) : null}
      <div className="dshMkt-filters">
        <input
          className="dshMkt-input"
          type="search"
          placeholder="Pesquisar plugin ou autor…"
          aria-label="Pesquisar plugin ou autor"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="dshMkt-input dshMkt-select"
          aria-label="Filtrar por categoria"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">Todas as categorias</option>
          {categories.map(option => (
            <option key={option.key} value={option.key}>{option.label}（{option.count}）</option>
          ))}
        </select>
      </div>
      <div className="dshMkt-rowBetween">
        <span className="dshMkt-hint">
          {filtered.length === entries.length
            ? `${entries.length} plugins de fontes configuradas`
            : `${filtered.length} de ${entries.length} plugins após o filtro`}
        </span>
        <button type="button" className="dshMkt-button" onClick={onRefresh}>Atualizar</button>
      </div>
      {entries.length === 0 ? (
        <div className="dshMkt-empty">
          O catálogo está vazio.
          <button type="button" className="dshMkt-button" onClick={onGoSources}>Adicionar fonte</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="dshMkt-empty">Nenhum plugin encontrado. Tente outra palavra-chave ou categoria.</div>
      ) : filtered.slice(0, visible).map(entry => {
        const pkg = installedByName.get(normalizeNpmName(entry.package))
        const busy = busyPackage === entry.package
        const sourceOnly = entry.installable === false
        // Same-name verdict: the npm name alone never proves identity — the
        // normalized repo keys decide between "the same plugin", "a different
        // plugin sharing the name", and the local/git dev install the market
        // must not touch.
        const state = sameNameStateOf(entry, pkg)
        const localPkg = state.kind === 'local-git' ? pkg : undefined
        const localBadge = localPkg === undefined
          ? undefined
              : (localPkg.source === 'git' ? 'Versão Git instalada' : 'Versão local instalada')
        const localTitle = localPkg === undefined
          ? undefined
          : (localPkg.source === 'git'
            ? 'Este plugin foi instalado via Git (a dependência aponta para uma fonte Git); o marketplace não oferece substituição. Atualize localmente e reinstale.'
            : 'Este plugin foi instalado a partir de um arquivo local (dependência file:); o marketplace não oferece substituição. Empacote e instale novamente.')
        // Updates ride the same-origin path alone: a cross-origin or
        // local/git "update" would replace a different plugin's install.
        const updatable = state.kind === 'same-origin'
          && pkg !== undefined
          && pkg.updateAvailable === true
          && !pkg.suite
          && !sourceOnly
        // The desktop shell routes cross-origin window.open targets to the
        // system browser, so the title jumps straight to the entry's page.
        const openHomepage = (): void => { if (entry.homepage !== undefined) window.open(entry.homepage, '_blank', 'noopener') }
        return (
          <div key={entry.package} className="dshMkt-card">
            <div className="dshMkt-cardHead">
              {entry.homepage !== undefined ? (
                <button
                  type="button"
                  className="dshMkt-pkgName dshMkt-linkName"
                  title="Abrir página do repositório (navegador do sistema)"
                  onClick={openHomepage}
                >
                  {entry.name}
                </button>
              ) : (
                <span className="dshMkt-pkgName">{entry.name}</span>
              )}
              <span className="dshMkt-cardAction">
                {sourceOnly ? null : localPkg !== undefined ? (
                  <span className="dshMkt-badge dshMkt-badgeOn" title={localTitle}>{localBadge}</span>
                ) : state.kind === 'cross-origin' ? (
                  <span className="dshMkt-actionPair">
                    <span
                      className="dshMkt-badge dshMkt-badgeWarn"
                      title="O plugin instalado com o mesmo nome vem de outro repositório e não é o mesmo item do catálogo"
                    >
                      Mesmo nome, fonte diferente
                    </span>
                    <button
                      type="button"
                      className="dshMkt-button dshMkt-buttonPrimary"
                      disabled={busyPackage !== null}
                      title="A instalação substituirá o plugin local de mesmo nome e exigirá confirmação novamente"
                      onClick={() => onInstall(entry, true)}
                    >
                      {busy ? <span className="dshMkt-spinner" aria-hidden="true" /> : null}
                      {busy ? ' Instalando…' : 'Instalar'}
                    </button>
                  </span>
                ) : pkg === undefined ? (
                  <button
                    type="button"
                    className="dshMkt-button dshMkt-buttonPrimary"
                    disabled={busyPackage !== null}
                    onClick={() => onInstall(entry, false)}
                  >
                    {busy ? <span className="dshMkt-spinner" aria-hidden="true" /> : null}
                    {busy ? ' Instalando…' : 'Instalar'}
                  </button>
                ) : updatable ? (
                  <button
                    type="button"
                    className="dshMkt-button dshMkt-buttonPrimary"
                    disabled={busyPackage !== null}
                    title={pkg.latest !== undefined ? `Atualizar para ${pkg.latest} (pelo fluxo de instalação)` : 'Atualizar para o latest do npm (pelo fluxo de instalação)'}
                    onClick={() => onUpdate(pkg)}
                  >
                    {busy ? <span className="dshMkt-spinner" aria-hidden="true" /> : null}
                    {busy ? ' Atualizando…' : 'Atualizar'}
                  </button>
                ) : (
                  <span className="dshMkt-badge dshMkt-badgeOn">Instalado</span>
                )}
              </span>
            </div>
            <div className="dshMkt-cardByline">{cardByline(entry)}</div>
            <p className="dshMkt-desc">{entry.description === '' ? '(sem descrição)' : entry.description}</p>
            <div className="dshMkt-meta">{entry.package}</div>
            <div className="dshMkt-cardTags">
              {entry.category !== undefined ? <span className="dshMkt-badge">{entry.category}</span> : null}
              {sourceOnly ? (
                <span
                  className="dshMkt-badge dshMkt-badgeOff"
                  title={entry.homepage !== undefined
                    ? `Pacote npm não publicado; consulte o código-fonte em ${entry.homepage}`
                    : 'Pacote npm não publicado; a instalação automática está indisponível'}
                >
                  Apenas código-fonte
                </span>
              ) : null}
              {entry.version !== undefined ? (
                <span className="dshMkt-badge" title="Versão declarada no catálogo (apenas informativa; a instalação usa o npm registry)">v{entry.version}</span>
              ) : null}
              {state.kind === 'local-git' && state.sameRepo ? (
                <span className="dshMkt-badge" title="A versão local/Git instalada vem do mesmo repositório deste item do catálogo">Mesma fonte</span>
              ) : null}
            </div>
          </div>
        )
      })
      }
      {filtered.length > visible ? (
        <button type="button" className="dshMkt-button" onClick={() => setVisible(count => count + CATALOG_PAGE_SIZE)}>
          Mostrar mais ({filtered.length - visible} restantes)
        </button>
      ) : null}
    </>
  )
}

interface InstalledTabProps {
  loading: boolean
  /** True while the follow-up registry probe runs; the list is already visible. */
  checkingUpdates: boolean
  packages: readonly InstalledPackage[]
  busyPackage: string | null
  togglingPackage: string | null
  onRefresh: () => void
  onToggle: (pkg: InstalledPackage) => void
  onUninstall: (pkg: InstalledPackage) => void
  onUpdate: (pkg: InstalledPackage) => void
}

function InstalledTab({
  loading, checkingUpdates, packages, busyPackage, togglingPackage, onRefresh, onToggle, onUninstall, onUpdate,
}: InstalledTabProps): ReactNode {
  if (loading) {
    return (
      <div className="dshMkt-empty">
        <span className="dshMkt-spinner" aria-hidden="true" /> Lendo lista instalada…
      </div>
    )
  }
  // One mutation at a time across the panel: the installer queue serializes
  // server-side, these flags keep the UI honest about it.
  const actionsBusy = busyPackage !== null || togglingPackage !== null
  return (
    <>
      <div className="dshMkt-rowBetween">
        <span className="dshMkt-hint">
        Desativar/ativar grava na configuração do profile e recarrega imediatamente; plugins do conjunto são gerenciados pelo aplicativo.
        {checkingUpdates ? ' · verificando atualizações…' : ''}
        </span>
        <button type="button" className="dshMkt-button" disabled={actionsBusy} onClick={onRefresh}>Atualizar</button>
      </div>
      {packages.length === 0 ? (
        <div className="dshMkt-empty">Nenhum plugin instalado.</div>
      ) : packages.map(pkg => {
        const busy = busyPackage === pkg.name
        const toggling = togglingPackage === pkg.name
        // Local/git installs are user-managed development copies: the badge in
        // the update slot explains why no update is offered, while toggle and
        // uninstall stay fully usable.
        const local = pkg.source !== 'registry'
        const updatable = pkg.updateAvailable === true && !pkg.suite && !local
        return (
          <div key={pkg.name} className="dshMkt-card">
            <div className="dshMkt-cardHead">
              <span className="dshMkt-pkgName">{pkg.name}</span>
              <span className="dshMkt-badge" title={`依赖声明：${pkg.version}`}>
                {pkg.installedVersion ?? pkg.version}
              </span>
              {updatable && pkg.latest !== undefined && pkg.installedVersion !== undefined ? (
                <span
                  className="dshMkt-badge dshMkt-badgeUpdate"
                  title="npm 上已有更新的版本，可一键更新"
                >
                  Atualização disponível: v{pkg.installedVersion} → v{pkg.latest}
                </span>
              ) : local ? (
                <span
                  className="dshMkt-badge dshMkt-badgeOn"
                  title={pkg.source === 'git'
                    ? 'Instalação Git: a dependência aponta para uma fonte Git; o marketplace não oferece atualização npm'
                    : 'Instalação local: a dependência aponta para um caminho local (file:); o marketplace não oferece atualização npm'}
                >
                  {pkg.source === 'git' ? 'Instalação Git' : 'Instalação local'}
                </span>
              ) : null}
              <span className={pkg.bundled ? 'dshMkt-badge dshMkt-badgeOn' : 'dshMkt-badge dshMkt-badgeOff'}>
                {pkg.bundled ? 'Montado' : 'Não montado'}
              </span>
              {pkg.suite ? <span className="dshMkt-badge">Conjunto</span> : null}
            </div>
            <div className="dshMkt-cardFoot">
              <button
                type="button"
                role="switch"
                aria-checked={pkg.enabled}
                className={pkg.enabled ? 'dshMkt-switch dshMkt-switchOn' : 'dshMkt-switch'}
                disabled={pkg.suite || actionsBusy}
                title={pkg.suite
                  ? 'Plugins do conjunto são gerenciados pelo aplicativo'
                   : (pkg.enabled ? 'Clique para desativar (configuração recarregada imediatamente)' : 'Clique para ativar (configuração recarregada imediatamente)')}
                onClick={() => onToggle(pkg)}
              >
                {toggling ? <span className="dshMkt-spinner" aria-hidden="true" /> : (
                  <span className="dshMkt-switchTrack" aria-hidden="true"><span className="dshMkt-switchThumb" /></span>
                )}
                {pkg.enabled ? 'Ativado' : 'Desativado'}
              </button>
              {updatable ? (
                <button
                  type="button"
                  className="dshMkt-button dshMkt-buttonPrimary"
                  disabled={actionsBusy}
                  title={pkg.latest !== undefined ? `更新到 ${pkg.latest}（走安装流程）` : '更新到 npm latest（走安装流程）'}
                  onClick={() => onUpdate(pkg)}
                >
                  {busy ? <span className="dshMkt-spinner" aria-hidden="true" /> : null}
                  {busy ? ' 更新中…' : '更新'}
                </button>
              ) : null}
              <button
                type="button"
                className="dshMkt-button dshMkt-buttonDanger"
                disabled={actionsBusy}
                onClick={() => onUninstall(pkg)}
              >
                {busy ? <span className="dshMkt-spinner" aria-hidden="true" /> : null}
                {busy ? ' 卸载中…' : '卸载'}
              </button>
            </div>
          </div>
        )
      })}
    </>
  )
}

interface SourcesTabProps {
  loading: boolean
  sources: readonly string[]
  saving: boolean
  input: string
  onInput: (value: string) => void
  onAdd: () => void
  onRemove: (url: string) => void
  onRefresh: () => void
}

function SourcesTab({ loading, sources, saving, input, onInput, onAdd, onRemove, onRefresh }: SourcesTabProps): ReactNode {
  if (loading) {
    return (
      <div className="dshMkt-empty">
        <span className="dshMkt-spinner" aria-hidden="true" /> 正在读取目录源…
      </div>
    )
  }
  return (
    <>
      <p className="dshMkt-hint">
        目录源是提供插件目录的 https JSON 地址；安装时一律从 npm 官方 registry 下载，目录源只决定列表内容。
      </p>
      <div className="dshMkt-row">
        <input
          className="dshMkt-input"
          type="url"
          placeholder="https://example.com/plugins.json"
          value={input}
          aria-label="目录源地址"
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') onAdd() }}
        />
        <button type="button" className="dshMkt-button dshMkt-buttonPrimary" disabled={saving || input.trim() === ''} onClick={onAdd}>
          添加
        </button>
      </div>
      {sources.length === 0 ? (
        <div className="dshMkt-empty">尚未添加任何目录源。</div>
      ) : sources.map(url => (
        <div key={url} className="dshMkt-card">
          <div className="dshMkt-rowBetween">
            <span className="dshMkt-sourceUrl">{url}</span>
            <button type="button" className="dshMkt-button dshMkt-buttonDanger" disabled={saving} onClick={() => onRemove(url)}>
              删除
            </button>
          </div>
          {url.includes(PAGED_SOURCE_HOST) ? (
            <p className="dshMkt-hint">该源显示前 100 个热门插件</p>
          ) : null}
        </div>
      ))}
      <div className="dshMkt-rowBetween">
        <span className="dshMkt-hint">修改后回到「目录」标签查看最新列表</span>
        <button type="button" className="dshMkt-button" onClick={onRefresh}>刷新</button>
      </div>
    </>
  )
}
