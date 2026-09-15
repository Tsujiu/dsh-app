/**
 * models.dev import dialog: search the feed, pick a provider, check models,
 * adopt them as draft rows. Nothing is written here — adoption only fills
 * the form; the section's save path (validated, conflict-checked
 * `settings.mutate`) decides what actually lands in settings.yaml.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ModelDraft } from './fields.ts'
import { fetchModelsDev, mapProviderModels, searchModels, searchProviders } from './models-dev.ts'
import type { ModelsDevModelHit, ModelsDevProvider } from './models-dev.ts'

/** Props of {@link ModelsDevImportDialog}. */
export interface ModelsDevImportDialogProps {
  /** Whether the dialog is open. */
  open: boolean
  /** Close the dialog. */
  onClose: () => void
  /** Adopt the picked rows into the current edit target. */
  onAdopt: (rows: ModelDraft[]) => void
  /** Ids already configured; those rows start unchecked. */
  existingIds: ReadonlySet<string>
}

/** One provider row with its mapped models and pick state. */
interface ProviderDraft {
  provider: ModelsDevProvider
  models: { id: string; draft: ModelDraft }[]
}

/**
 * The import flow. The feed fetch runs once per open; a network/CORS failure
 * is a dead end for the BUTTON, not the page — the manual form stays usable.
 */
export function ModelsDevImportDialog(props: ModelsDevImportDialogProps): ReactNode {
  const { open, onClose, onAdopt, existingIds } = props
  const [providers, setProviders] = useState<readonly ModelsDevProvider[] | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ProviderDraft | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  /** Picks from the model-name search list (keyed providerId + space + modelId). */
  const [pickedModels, setPickedModels] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || providers !== undefined) return
    let stale = false
    setBusy(true)
    setFailure(undefined)
    fetchModelsDev().then(
      (result) => {
        if (!stale) { setProviders(result); setBusy(false) }
      },
      (error: unknown) => {
        if (stale) return
        setBusy(false)
        setFailure(error instanceof Error ? error.message : String(error))
      },
    )
    return () => { stale = true }
  }, [open, providers])

  const results = useMemo(
    () => providers === undefined ? [] : searchProviders(providers, query).slice(0, 20),
    [providers, query],
  )
  const modelHits = useMemo(
    () => providers === undefined ? [] : searchModels(providers, query, 30),
    [providers, query],
  )
  const hitKey = (hit: ModelsDevModelHit): string => hit.providerId + ' ' + hit.modelId
  const pickedHits = modelHits.filter(hit => pickedModels.has(hitKey(hit)))
  const adoptCount = pickedHits.length > 0
    ? pickedHits.length
    : expanded === undefined ? 0 : picked.size

  const openProvider = (provider: ModelsDevProvider): void => {
    setExpanded({ provider, models: mapProviderModels(provider) })
    setPicked(new Set(
      mapProviderModels(provider)
        .filter(model => !existingIds.has(model.id))
        .map(model => model.id),
    ))
  }

  if (!open) return null
  return (
    <div className="dshAma-modalMask" role="presentation" onClick={onClose}>
      {/* Stop-mask-click container: clicks inside the dialog must not close it. */}
      <div
        className="dshAma-modal"
        role="dialog"
        aria-modal="true"
         aria-label="Importar modelos do models.dev"
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className="dshAma-modalHead">
           <span className="dshAma-modalTitle">Importar modelos do models.dev</span>
           <button type="button" className="dshAma-iconButton" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="dshAma-modalBody">
          {failure !== undefined
            ? (
              <div className="dshAma-error">
                 <p>Não foi possível acessar o models.dev ({failure}). Pode ser um problema de rede ou de CORS; feche esta janela e preencha os campos manualmente.</p>
                <button
                  type="button" className="dshAma-button"
                  onClick={() => { setProviders(undefined); setFailure(undefined) }}
                 >Tentar novamente</button>
              </div>
            )
            : busy || providers === undefined
               ? <p className="dshAma-hint">Obtendo o catálogo do models.dev…</p>
              : (
                <>
                  <input
                    className="dshAma-input"
                    type="text"
                    value={query}
                     placeholder="Pesquisar ID, nome ou provider (ex.: V4.1, deepseek-flash, opencode)"
                     aria-label="Pesquisar modelo ou provider"
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setExpanded(undefined)
                      setPickedModels(new Set())
                    }}
                  />
                  {query.trim() === ''
                     ? <p className="dshAma-hint">Pesquise também pelo nome de exibição (ex.: V4.1 Flash). O ID wire pode ser diferente do nome comercial; por exemplo, o ID de V4.1 é deepseek-flash.</p>
                    : null}
                  {modelHits.length > 0 ? (
                    <div className="dshAma-candidateBlock">
                       <p className="dshAma-hint">Modelos encontrados (ID wire e nome de exibição):</p>
                      <ul className="dshAma-candidateList">
                        {modelHits.map(hit => {
                          const key = hitKey(hit)
                          const name = typeof hit.draft.name === 'string' ? hit.draft.name : ''
                          return (
                            <li key={key} className="dshAma-candidate">
                              <label className="dshAma-check">
                                <input
                                  type="checkbox"
                                  checked={pickedModels.has(key)}
                                  onChange={() => {
                                    setPickedModels(current => {
                                      const next = new Set(current)
                                      if (!next.delete(key)) next.add(key)
                                      return next
                                    })
                                  }}
                                />
                                <span>
                                  {name !== '' && name !== hit.modelId ? name + '（' + hit.modelId + '）' : hit.modelId}
                                </span>
                                <span className="dshAma-muted"> · {hit.providerId}</span>
                                 {existingIds.has(hit.modelId) ? <span className="dshAma-muted"> (já configurado)</span> : null}
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ) : null}
                  <div className="dshAma-providerList">
                    {results.map(provider => (
                      <button
                        key={provider.id}
                        type="button"
                        className={`dshAma-providerRow${expanded?.provider.id === provider.id ? ' dshAma-providerRowActive' : ''}`}
                        onClick={() => { openProvider(provider) }}
                      >
                        <span className="dshAma-providerId">{provider.id}</span>
                        <span className="dshAma-providerMeta">
                          {provider.npm ?? provider.api ?? ''}
                           {provider.npm === '@ai-sdk/openai-compatible' ? ' · referência openai-completions' : ''}
                        </span>
                      </button>
                    ))}
                    {query.trim() !== '' && results.length === 0 && modelHits.length === 0
                       ? <p className="dshAma-hint">Nenhum provider ou modelo encontrado.</p>
                      : null}
                  </div>
                  {expanded === undefined ? null : (
                    <div className="dshAma-candidateBlock">
                      <p className="dshAma-hint">
                         Modelos de {expanded.provider.id} (itens sem suporte a ferramentas foram ignorados; confirme as predefinições de compatibilidade por gateway):
                      </p>
                      <ul className="dshAma-candidateList">
                        {expanded.models.map(model => (
                          <li key={model.id} className="dshAma-candidate">
                            <label className="dshAma-check">
                              <input
                                type="checkbox"
                                checked={picked.has(model.id)}
                                onChange={() => {
                                  setPicked(current => {
                                    const next = new Set(current)
                                    if (!next.delete(model.id)) next.add(model.id)
                                    return next
                                  })
                                }}
                              />
                              <span>{model.id}</span>
                               {existingIds.has(model.id) ? <span className="dshAma-muted"> (já configurado)</span> : null}
                            </label>
                          </li>
                        ))}
                        {expanded.models.length === 0
                           ? <p className="dshAma-hint">Este provider não possui modelos importáveis (talvez nenhum aceite chamadas de ferramentas).</p>
                          : null}
                      </ul>
                    </div>
                  )}
                </>
              )}
        </div>
        <div className="dshAma-modalFoot">
           <button type="button" className="dshAma-button" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="dshAma-button dshAma-buttonPrimary"
            disabled={adoptCount === 0}
            onClick={() => {
              if (pickedHits.length > 0) {
                onAdopt(pickedHits.map(hit => hit.draft))
              } else if (expanded !== undefined && picked.size > 0) {
                onAdopt(expanded.models.filter(model => picked.has(model.id)).map(model => model.draft))
              } else {
                return
              }
              onClose()
            }}
           >{`Adicionar ${String(adoptCount)} modelos`}</button>
        </div>
      </div>
    </div>
  )
}
