/**
 * One model entry's advanced editor: capacities, input modalities, the
 * reasoning-effort tri-state, and protocol-gated compat switches — the field
 * groups the official Models page deliberately leaves to `settings.yaml`.
 *
 * Rows are structurally open like upstream's editors: the draft carries every
 * stored key, this form edits the ones it knows, and anything else survives
 * untouched (a future schema field, a hand-written `chatTemplateKwargs`).
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  COMPAT_PRESETS, MODALITIES, REASONING_LEVELS,
  compatFieldsForApi, formatCapacity, parseCapacity, readReasoning, reasoningCompatFill,
} from './fields.ts'
import type { ModelDraft, ReasoningDraft } from './fields.ts'

/** Props of {@link ModelEntryEditor}. */
export interface ModelEntryEditorProps {
  /** The row as currently drafted (structurally open). */
  row: ModelDraft
  /** Replace the row with the next draft. */
  onChange: (next: ModelDraft) => void
  /** Lock the id input (override rows address a catalog id by key). */
  lockedId?: boolean
  /**
   * Resolved wire protocol for this row (model.api ?? route.api). Gates the
   * compat editor and the reasoning auto-fill. Unknown → union of hand
   * protocols plus a warning.
   */
  api?: string
  /** True when the owning route is hand-declared (no catalog base). */
  handDeclared?: boolean
  /** Index for aria labels. */
  index: number
  /** Disable every control (read-only settings or a pending write). */
  disabled: boolean
}

/** Remove a key, immutably, when the value is undefined. */
function withoutUndefined(row: ModelDraft, key: string): ModelDraft {
  if (!(key in row)) return row
  const next = { ...row }
  delete next[key]
  return next
}

/**
 * Reasoning-mode change with a protocol-aware compat auto-fill. Once a row
 * starts declaring reasoning levels, private OpenAI-compatible gateways may
 * mis-detect as OpenAI and flip the system prompt to `developer`. Fill only
 * switches the row's protocol actually takes; never overwrite user-set keys.
 */
function reasoningChange(
  row: ModelDraft,
  onChange: (next: ModelDraft) => void,
  next: ReasoningDraft,
  api: string | undefined,
): void {
  const compatDict = typeof row.compat === 'object' && row.compat !== null && !Array.isArray(row.compat)
    ? row.compat as Record<string, unknown>
    : {}
  if (next !== undefined && next !== false && compatDict.supportsDeveloperRole === undefined) {
    const fill = reasoningCompatFill(api)
    if (Object.keys(fill).length === 0) {
      onChange({ ...row, reasoningEfforts: next })
      return
    }
    const merged: Record<string, unknown> = { ...compatDict }
    for (const [key, value] of Object.entries(fill)) {
      if (merged[key] === undefined) merged[key] = value
    }
    onChange({ ...row, reasoningEfforts: next, compat: merged })
    return
  }
  onChange(next === undefined
    ? withoutUndefined({ ...row }, 'reasoningEfforts')
    : { ...row, reasoningEfforts: next })
}

/** Chevron that rotates while its row is open. */
export function IconChevron({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}
    >
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Trash glyph for row removal (rendered by the parent list). */
export function IconTrash(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Reasoning-effort editor: inherit / disabled / explicit level set.
 *
 * Inherit means different things by route kind — catalog routes can ride a
 * same-id installed model; hand-declared routes have no catalog base, so
 * omitting `reasoningEfforts` is literally "non-reasoning" and the chat model
 * picker will not offer an effort control. That trap is the main reason this
 * page exists for private gateways.
 */
function ReasoningEditor(props: {
  value: ReasoningDraft
  onChange: (next: ReasoningDraft) => void
  /** True when the route is hand-declared (no installed catalog base). */
  handDeclared: boolean
  index: number
  disabled: boolean
}): ReactNode {
  const { value, onChange, handDeclared, index, disabled } = props
  const mode = value === undefined ? 'inherit' : value === false ? 'off' : 'custom'
  const dict = mode === 'custom' && typeof value === 'object' && value !== null ? value : {}

  const suggestedLevels = (): string[] => ['low', 'medium', 'high']

  const setMode = (next: 'inherit' | 'off' | 'custom'): void => {
    if (next === 'inherit') {
      onChange(undefined)
      return
    }
    if (next === 'off') {
      onChange(false)
      return
    }
    const initial = suggestedLevels()
    onChange(Object.fromEntries(initial.map(level => [level, level])))
  }

  const enableReasoning = (): void => {
    const initial = suggestedLevels()
    onChange(Object.fromEntries(initial.map(level => [level, level])))
  }

  const toggleLevel = (level: string, on: boolean): void => {
    if (!on) {
      const next = { ...dict }
      delete next[level]
      // Empty dict is illegal; drop back to inherit rather than a broken value.
      onChange(Object.keys(next).length === 0 ? undefined : next)
      return
    }
    onChange({ ...dict, [level]: level })
  }

  const enabled = new Set(Object.keys(dict))
  const spellable = Object.entries(dict)
  return (
    <div className="dshAma-field">
       <span className="dshAma-fieldLabel">Nível de raciocínio</span>
      <div className="dshAma-inline">
        <select
          className="dshAma-input dshAma-select"
          value={mode}
           aria-label={`Modo de raciocínio ${index + 1}`}
          disabled={disabled}
          onChange={(event) => { setMode(event.target.value as 'inherit' | 'off' | 'custom') }}
        >
          <option value="inherit">
             {handDeclared ? 'Não declarar raciocínio (sem níveis no seletor)' : 'Herdar capacidade do catálogo oficial'}
          </option>
           <option value="off">Desativar raciocínio explicitamente</option>
           <option value="custom">Personalizar níveis compatíveis</option>
        </select>
        {mode === 'inherit' && handDeclared
          ? (
            <button
              type="button" className="dshAma-button dshAma-buttonPrimary"
              disabled={disabled}
              onClick={enableReasoning}
            >Ativar raciocínio (low/medium/high)</button>
          )
          : null}
      </div>
      {mode === 'inherit'
        ? (
          handDeclared
            ? (
              <p className="dshAma-error">
                 A rota manual não possui catálogo oficial para herdar: sem reasoningEfforts, o seletor de modelos
                 <b> não mostrará níveis de raciocínio</b>. Clique em "Ativar raciocínio" ou escolha "Personalizar níveis" e salve.
              </p>
            )
            : (
              <p className="dshAma-hint">
                 Sem gravar reasoningEfforts, será usada a capacidade do modelo com o mesmo ID no catálogo oficial;
                 se o modelo não existir ou não oferecer raciocínio, o seletor também não mostrará níveis.
              </p>
            )
        )
        : null}
      {mode === 'off'
         ? <p className="dshAma-hint">Grava false: mesmo que o catálogo ou a sessão declare raciocínio, este modelo será usado sem raciocínio.</p>
        : null}
      {mode === 'custom'
        ? (
          <>
             <div className="dshAma-levelGrid" role="group" aria-label={`Níveis de raciocínio ${index + 1}`}>
              {REASONING_LEVELS.map(level => (
                <label key={level} className="dshAma-check">
                  <input
                    type="checkbox"
                    checked={enabled.has(level)}
                    disabled={disabled}
                    onChange={(event) => { toggleLevel(level, event.target.checked) }}
                  />
                  <span>{level}</span>
                </label>
              ))}
            </div>
            <div className="dshAma-hint">
               Marque os níveis compatíveis com este modelo. Apenas off não forma uma configuração válida; a grafia wire usa o mesmo nome por padrão e pode ser ajustada por gateway.
            </div>
          </>
        )
        : null}
      {mode === 'custom' && spellable.length > 0
        ? (
          <div className="dshAma-field">
             <span className="dshAma-fieldLabel">Nome enviado ao gateway (igual por padrão)</span>
            {spellable.map(([level, spelling]) => (
              <div key={level} className="dshAma-kvRow">
                <span className="dshAma-kvKey">{level}</span>
                <input
                  className="dshAma-input"
                  type="text"
                  value={spelling ?? ''}
                   placeholder="(não enviar parâmetro)"
                   aria-label={`Nome wire de ${level}`}
                  disabled={disabled}
                  onChange={(event) => {
                    const raw = event.target.value.trim()
                    onChange({ ...dict, [level]: raw === '' ? null : raw })
                  }}
                />
                <button
                  type="button" className="dshAma-iconButton"
                   aria-label={`Remover nível ${level}`}
                  disabled={disabled}
                  onClick={() => { toggleLevel(level, false) }}
                ><IconTrash /></button>
              </div>
            ))}
          </div>
        )
        : null}
    </div>
  )
}

/**
 * Compat-switch editor, filtered to switches the resolved protocol offers.
 * Unknown protocol shows the union of hand-declared protocols plus a warning.
 */
function CompatEditor(props: {
  value: Record<string, unknown> | undefined
  onChange: (next: Record<string, unknown> | undefined) => void
  api: string | undefined
  index: number
  disabled: boolean
}): ReactNode {
  const { value, onChange, api, index, disabled } = props
  const dict = value ?? {}
  const fields = compatFieldsForApi(api)
  const knownKeys = new Set(fields.map(field => field.key))
  const unusedKeys = fields.filter(field => !(field.key in dict))
  // Stored keys this protocol does not take: show them read-only so the user
  // can remove the invalid ones instead of losing them in a silent overwrite.
  const invalidKeys = Object.keys(dict).filter(key => !knownKeys.has(key)
    && !['chatTemplateKwargs', 'chatTemplateArgs'].includes(key))

  const setKey = (key: string, next: unknown): void => {
    const rows = { ...dict, [key]: next }
    onChange(Object.keys(rows).length === 0 ? undefined : rows)
  }
  const removeKey = (key: string): void => {
    const next = { ...dict }
    delete next[key]
    onChange(Object.keys(next).length === 0 ? undefined : next)
  }
  const valueControl = (field: { key: string; kind: 'boolean' | { enum: readonly string[] } }, current: unknown) => {
    if (field.kind === 'boolean') {
      return (
        <select
          className="dshAma-input dshAma-select"
          value={current === true ? 'true' : 'false'}
          aria-label={field.key}
          disabled={disabled}
          onChange={(event) => { setKey(field.key, event.target.value === 'true') }}
        >
           <option value="true">Ativado</option>
           <option value="false">Desativado</option>
        </select>
      )
    }
    return (
      <select
        className="dshAma-input dshAma-select"
        value={typeof current === 'string' ? current : ''}
        aria-label={field.key}
        disabled={disabled}
        onChange={(event) => { setKey(field.key, event.target.value) }}
      >
         <option value="">(selecione um valor)</option>
        {field.kind.enum.map(choice => <option key={choice} value={choice}>{choice}</option>)}
      </select>
    )
  }

  // Presets only apply keys this protocol accepts.
  const applyPreset = (presetId: string): void => {
    const preset = COMPAT_PRESETS.find(candidate => candidate.id === presetId)
    if (preset === undefined) return
    const filtered: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(preset.value)) {
      if (knownKeys.has(key) && dict[key] === undefined) filtered[key] = val
    }
    onChange({ ...filtered, ...dict })
  }

  return (
    <div className="dshAma-field">
             <span className="dshAma-fieldLabel">Opções de compatibilidade (compat)</span>
      <div className="dshAma-inline">
        <select
          className="dshAma-input dshAma-select"
          value=""
           aria-label={`Aplicar predefinição de compatibilidade ${index + 1}`}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value !== '') applyPreset(event.target.value)
          }}
        >
           <option value="">Aplicar predefinição da família…</option>
          {COMPAT_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
        </select>
        <select
          className="dshAma-input dshAma-select"
          value=""
           aria-label={`Adicionar opção de compatibilidade ${index + 1}`}
          disabled={disabled || unusedKeys.length === 0}
          onChange={(event) => {
            const field = fields.find(candidate => candidate.key === event.target.value)
            if (field === undefined) return
            setKey(field.key, field.kind === 'boolean' ? false : field.kind.enum[0])
          }}
        >
           {unusedKeys.length === 0 ? <option value="">Tudo já foi adicionado</option> : <option value="">Adicionar opção…</option>}
          {unusedKeys.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}
        </select>
        {api === undefined || api === ''
           ? <span className="dshAma-muted">Protocolo desconhecido</span>
          : <span className="dshAma-muted">{api}</span>}
      </div>
      <div className="dshAma-hint">
        {api === undefined || api === ''
           ? 'Nenhum protocolo wire foi declarado. A lista reúne opções de todos os protocolos; declarar api na rota filtra por protocolo.'
           : `Exibindo apenas opções compatíveis com o protocolo ${api}; chaves de outros protocolos não podem ser salvas.`}
        {' '}O models.dev não fornece essas informações do gateway; use settings.yaml manualmente para chaves desconhecidas.
      </div>
      {invalidKeys.map(key => (
        <div key={key} className="dshAma-kvRow">
          <span className="dshAma-kvKey dshAma-invalid" title={key}>{key}</span>
           <span className="dshAma-readonlyValue">Não se aplica ao protocolo {api ?? 'atual'}</span>
          <button
            type="button" className="dshAma-iconButton dshAma-iconButtonDanger"
             aria-label={`Remover opção incompatível ${key}`}
            disabled={disabled}
            onClick={() => { removeKey(key) }}
          >×</button>
        </div>
      ))}
      {Object.entries(dict).map(([key, current]) => {
        if (!knownKeys.has(key)) return null
        const meta = fields.find(field => field.key === key)
        return (
          <div key={key} className="dshAma-kvRow">
            <span className="dshAma-kvKey" title={key}>{meta?.label ?? key}</span>
            {meta === undefined
              ? <span className="dshAma-readonlyValue">{JSON.stringify(current)}</span>
              : valueControl(meta, current)}
            <button
              type="button" className="dshAma-iconButton"
               aria-label={`Remover opção de compatibilidade ${key}`}
              disabled={disabled}
              onClick={() => { removeKey(key) }}
            ><IconTrash /></button>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Render one model entry's expanded editor.
 * @param props - the drafted row, its replacement callback, and chrome state.
 * @returns the entry editor.
 */
export function ModelEntryEditor(props: ModelEntryEditorProps): ReactNode {
  const { row, onChange, api, handDeclared, index, disabled } = props
  // Capacities are edited as text; the buffer lives here so keystrokes are
  // never rewritten by the K/M formatter mid-word. The component stays
  // mounted while its row does, so the buffer is displaced only by the user.
  const [contextText, setContextText] = useState(() => formatCapacity(
    typeof row.contextWindow === 'number' ? row.contextWindow : undefined,
  ))
  const [maxTokensText, setMaxTokensText] = useState(() => formatCapacity(
    typeof row.maxTokens === 'number' ? row.maxTokens : undefined,
  ))
  const stringAt = (key: string): string => typeof row[key] === 'string' ? row[key] as string : ''
  const setString = (key: string, next: string): void => {
    const clean = next.trim()
    onChange(clean === '' ? withoutUndefined({ ...row }, key) : { ...row, [key]: clean })
  }
  const editCapacity = (key: 'contextWindow' | 'maxTokens', text: string): void => {
    if (key === 'contextWindow') setContextText(text)
    else setMaxTokensText(text)
    const parsed = parseCapacity(text)
    // NaN is kept in the buffer so the refusal names a row the user can
    // still see; the section's save gate refuses the write.
    onChange(parsed === undefined
      ? withoutUndefined({ ...row }, key)
      : { ...row, [key]: parsed })
  }
  const input = Array.isArray(row.input)
    ? row.input.filter((m): m is string => typeof m === 'string')
    : []
  const toggleModality = (modality: string): void => {
    const next = input.includes(modality)
      ? input.filter(m => m !== modality)
      : [...input, modality]
    // An empty list is stored as absent: the schema materializes [] for a
    // missing array anyway, and absence keeps "inherit the catalog" legible.
    onChange(next.length === 0 ? withoutUndefined({ ...row }, 'input') : { ...row, input: next })
  }
  return (
    <div className="dshAma-entryBody">
      {props.lockedId === true
        ? null
        : (
          <label className="dshAma-field">
             <span className="dshAma-fieldLabel">ID do modelo (nome wire)</span>
            <input
              className="dshAma-input"
              type="text"
              value={stringAt('id')}
               placeholder="ex.: glm-5.2"
               aria-label={`ID do modelo ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { onChange({ ...row, id: event.target.value }) }}
            />
          </label>
        )}
      <label className="dshAma-field">
         <span className="dshAma-fieldLabel">Nome de exibição</span>
        <input
          className="dshAma-input"
          type="text"
          value={stringAt('name')}
           placeholder="(igual ao ID por padrão)"
             aria-label={`Nome de exibição ${index + 1}`}
          disabled={disabled}
          onChange={(event) => { setString('name', event.target.value) }}
        />
      </label>
      <div className="dshAma-capacityRow">
        <label className="dshAma-field">
           <span className="dshAma-fieldLabel">Janela de contexto</span>
          <input
            className="dshAma-input"
            type="text"
            inputMode="numeric"
            value={contextText}
             placeholder="ex.: 1000000 ou 1M"
             aria-label={`Janela de contexto ${index + 1}`}
            disabled={disabled}
            onChange={(event) => { editCapacity('contextWindow', event.target.value) }}
          />
        </label>
        <label className="dshAma-field">
           <span className="dshAma-fieldLabel">Limite de saída</span>
          <input
            className="dshAma-input"
            type="text"
            inputMode="numeric"
            value={maxTokensText}
             placeholder="ex.: 131072 ou 128K"
             aria-label={`Limite de saída ${index + 1}`}
            disabled={disabled}
            onChange={(event) => { editCapacity('maxTokens', event.target.value) }}
          />
        </label>
      </div>
      <div className="dshAma-field">
         <span className="dshAma-fieldLabel">Modalidades de entrada</span>
        <div className="dshAma-inline">
          {MODALITIES.map(modality => (
            <label key={modality} className="dshAma-check">
              <input
                type="checkbox"
                checked={input.includes(modality)}
                disabled={disabled}
                onChange={() => { toggleModality(modality) }}
              />
               <span>{modality === 'text' ? 'Texto' : 'Imagem'}</span>
            </label>
          ))}
        </div>
        <div className="dshAma-hint">Modelos visuais precisam marcar explicitamente "Imagem"; não marcar nada herda o padrão da rota ou do catálogo.</div>
      </div>
      <ReasoningEditor
        index={index}
        disabled={disabled}
        handDeclared={handDeclared === true}
        value={readReasoning(row.reasoningEfforts)}
        onChange={(next) => reasoningChange(row, onChange, next, api)}
      />
      <CompatEditor
        index={index}
        disabled={disabled}
        api={api}
        value={typeof row.compat === 'object' && row.compat !== null && !Array.isArray(row.compat)
          ? row.compat as Record<string, unknown>
          : undefined}
        onChange={(next) => {
          onChange(next === undefined ? withoutUndefined({ ...row }, 'compat') : { ...row, compat: next })
        }}
      />
    </div>
  )
}
