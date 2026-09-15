/**
 * The swarm settings section: enable toggle (restart-applied), adaptive
 * toggle, and the numeric scheduling knobs. Reads and writes the user config
 * file through the host half's routes; scheduling edits apply to the next
 * swarm call without a restart.
 *
 * @module @dsh-app/plugin-swarm/client/swarm-section
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

const ROUTE = '/plugins/@dsh-app/plugin-swarm/api'

/** One numeric field's presentation metadata. */
interface FieldSpec {
  readonly key: string
  readonly label: string
  readonly hint: string
}

const NUMERIC_FIELDS: readonly FieldSpec[] = [
  { key: 'defaultConcurrency', label: 'Concorrência inicial', hint: 'Número de subagentes paralelos no início do lote' },
  { key: 'maxConcurrency', label: 'Limite de concorrência', hint: 'Limite estável da recuperação adaptativa; sem valor definido, o pool testa valores maiores (máximo 64)' },
  { key: 'maxItems', label: 'Limite de tarefas por lote', hint: 'Número máximo de subtarefas em uma chamada swarm' },
  { key: 'startStaggerMs', label: 'Intervalo de inicialização (ms)', hint: 'Intervalo entre subagentes adjacentes para suavizar a pressão no gateway' },
  { key: 'itemMaxRetries', label: 'Tentativas após falha', hint: 'Tentativas automáticas após erros transitórios, como limitação de taxa ou queda de conexão' },
  { key: 'itemRetryDelayMs', label: 'Retardo entre tentativas (ms)', hint: 'Tempo de espera da primeira tentativa, dobrado a cada vez' },
  { key: 'perItemOutputLimit', label: 'Truncamento do resultado por tarefa', hint: 'Número máximo de caracteres retornados por cada subtarefa' },
  { key: 'tokenBudget', label: 'Orçamento de tokens do lote', hint: '0 significa sem limite; ao atingir o orçamento, novas subtarefas deixam de ser iniciadas' },
]

/** The host route's config payload (mirror of SwarmConfigResponse). */
interface ConfigResponse {
  readonly defaults: Record<string, number | boolean>
  readonly overrides: Record<string, number | boolean>
  readonly effective: Record<string, number | boolean>
  readonly filePath: string
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init })
  const body = (await response.json()) as { ok: boolean, value?: T, error?: { message?: string } }
  if (!response.ok || body.ok !== true) {
    throw new Error(body.error?.message ?? `HTTP ${response.status}`)
  }
  return body.value as T
}

export function SwarmSection(): ReactNode {
  const [config, setConfig] = useState<ConfigResponse | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<ConfigResponse>(`${ROUTE}/config`)
      setConfig(data)
      const nextDraft: Record<string, string> = {}
      for (const field of NUMERIC_FIELDS) {
        nextDraft[field.key] = String(data.effective[field.key] ?? '')
      }
      setDraft(nextDraft)
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /** Fields whose draft differs from the current effective value. */
  const dirtyFields = useMemo(() => {
    if (config === null) return []
    return NUMERIC_FIELDS.filter(field => {
      const value = draft[field.key]
      return value !== undefined && value !== String(config.effective[field.key] ?? '')
    })
  }, [config, draft])

  const post = useCallback(async (patch: Record<string, number | boolean | null>) => {
    setBusy(true)
    setNotice(undefined)
    try {
      await fetchJson<ConfigResponse>(`${ROUTE}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      await load()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      throw failure
    } finally {
      setBusy(false)
    }
  }, [load])

  const onSave = useCallback(async () => {
    if (config === null || dirtyFields.length === 0) return
    const patch: Record<string, number | null> = {}
    for (const field of dirtyFields) {
      const raw = draft[field.key] ?? ''
      if (raw.trim() === '') {
        // Cleared input = clear the override (fall back to the overlay value).
        patch[field.key] = null
        continue
      }
      const value = Number(raw)
      if (!Number.isFinite(value)) {
        setError(`"${field.label}" não é um número válido`)
        return
      }
      patch[field.key] = value
    }
    try {
      await post(patch)
      setNotice('Salvo; entrará em vigor na próxima tarefa paralela')
    } catch {
      // post() already surfaced the error banner.
    }
  }, [config, dirtyFields, draft, post])

  const onResetAll = useCallback(async () => {
    if (config === null) return
    const patch: Record<string, null> = {}
    for (const key of Object.keys(config.overrides)) patch[key] = null
    if (Object.keys(patch).length === 0) {
      setNotice('Não há itens personalizados; todos usam os valores padrão')
      return
    }
    try {
      await post(patch)
      setNotice('Valores padrão restaurados')
    } catch {
      // post() already surfaced the error banner.
    }
  }, [config, post])

  const onToggleEnabled = useCallback(async () => {
    if (config === null) return
    const next = !(config.effective.enabled !== false)
    try {
      await post({ enabled: next })
      setNotice(next ? 'Definido como ativado; entrará em vigor após reiniciar o aplicativo' : 'Definido como desativado; entrará em vigor após reiniciar o aplicativo')
    } catch {
      // post() already surfaced the error banner.
    }
  }, [config, post])

  const onToggleAdaptive = useCallback(async () => {
    if (config === null) return
    const next = !(config.effective.adaptive !== false)
    try {
      await post({ adaptive: next })
      setNotice(next ? 'Agendamento adaptativo ativado; entrará em vigor na próxima chamada' : 'Agendamento adaptativo desativado: a concorrência ficará fixa no valor inicial na próxima chamada')
    } catch {
      // post() already surfaced the error banner.
    }
  }, [config, post])

  const enabled = config !== null && config.effective.enabled !== false
  const adaptive = config !== null && config.effective.adaptive !== false

  return (
    <div className="dshs_section">
      <p className="dshs_title">Subagentes paralelos (Swarm)</p>
      <p className="dshs_hint">
        Divida tarefas paralelizáveis entre vários subagentes executados simultaneamente. Os parâmetros de agendamento entram em vigor na próxima chamada; ativar ou desativar exige reiniciar o aplicativo.
        Com o agendamento adaptativo ativado, a velocidade diminui automaticamente sob limitação de taxa, sobe lentamente após a recuperação e pode testar a capacidade disponível do gateway (máximo 64).
      </p>

      {error !== undefined ? <div className="dshs_banner" role="alert">{error}</div> : null}
      {notice !== undefined ? <div className="dshs_noticeOk">{notice}</div> : null}

      <div className="dshs_toggleRow">
        <span className="dshs_toggleLabel">
          Ativar subagentes paralelos ({config === null ? '…' : enabled ? 'ativado' : 'desativado'})
          <span className="dshs_toggleHint">Quando desativados, a ferramenta swarm e o comando /swarm deixam de ser registrados após reiniciar o aplicativo</span>
        </span>
        <button
          type="button"
          className="dshs_toggle"
          role="switch"
          aria-checked={enabled}
          aria-label="Ativar subagentes paralelos"
          disabled={busy || config === null}
          onClick={() => { void onToggleEnabled() }}
        />
      </div>

      <div className="dshs_toggleRow">
        <span className="dshs_toggleLabel">
          Agendamento adaptativo ({config === null ? '…' : adaptive ? 'ativado' : 'desativado'})
          <span className="dshs_toggleHint">Após uma falha, a concorrência é reduzida pela metade e sobe gradualmente após a recuperação; desativado, fica fixa no valor inicial</span>
        </span>
        <button
          type="button"
          className="dshs_toggle"
          role="switch"
          aria-checked={adaptive}
          aria-label="Agendamento adaptativo"
          disabled={busy || config === null}
          onClick={() => { void onToggleAdaptive() }}
        />
      </div>

      <div className="dshs_grid">
        {NUMERIC_FIELDS.map((field) => {
          const overridden = config !== null && config.overrides[field.key] !== undefined
          const dirty = dirtyFields.some(dirtyField => dirtyField.key === field.key)
          return (
            <div key={field.key} className="dshs_field">
              <span className="dshs_fieldLabel">
                {field.label}
                <span className={overridden ? 'dshs_fieldBadge dshs_fieldBadgeCustom' : 'dshs_fieldBadge'}>
                  {overridden ? 'Personalizado' : `Padrão ${String(config?.defaults[field.key] ?? '…')}`}
                </span>
              </span>
              <input
                className="dshs_fieldInput"
                type="number"
                min={0}
                value={draft[field.key] ?? ''}
                disabled={busy || config === null}
                aria-label={field.label}
                onChange={(event) => {
                  const { value } = event.target
                  setDraft(previous => ({ ...previous, [field.key]: value }))
                }}
              />
              <span className="dshs_fieldHint">{field.hint}{dirty ? ' (não salvo)' : ''}</span>
            </div>
          )
        })}
      </div>

      <div className="dshs_actions">
        <button
          type="button"
          className="dshs_button dshs_buttonPrimary"
          disabled={busy || config === null || dirtyFields.length === 0}
          onClick={() => { void onSave() }}
        >Salvar alterações{dirtyFields.length > 0 ? ` (${String(dirtyFields.length)} itens)` : ''}</button>
        <button
          type="button"
          className="dshs_button"
          disabled={busy || config === null || Object.keys(config.overrides).length === 0}
          onClick={() => { void onResetAll() }}
        >Restaurar todos os padrões</button>
      </div>

      {config !== null
        ? <p className="dshs_path" title={config.filePath}>配置文件：{config.filePath}</p>
        : null}
    </div>
  )
}
