/**
 * Close-confirmation dialog: the themed in-frame dialog specialized to the
 * window-close question. Thin facade over in-frame-dialog.ts — the rendering,
 * theming, keyboard, and dedup logic live there once.
 */

import { inFrameDialogScript } from './in-frame-dialog'

export type CloseDialogChoice = 'tray' | 'quit' | 'cancel'

const CLOSE_CONFIG = {
  rootId: 'dsh-close-dialog',
  title: 'Fechar DSH APP',
  message: 'Como deseja prosseguir ao fechar a janela?',
  buttons: [
    { label: 'Cancelar', value: 'cancel' },
    { label: 'Sair do aplicativo', value: 'quit' },
    { label: 'Minimizar para a bandeja', value: 'tray', primary: true },
  ],
  cancelValue: 'cancel',
  enterValue: 'tray',
} as const

/** The one in-page script; resolves to {@link CloseDialogChoice}. */
export const CLOSE_DIALOG_SCRIPT: string = inFrameDialogScript(CLOSE_CONFIG)
