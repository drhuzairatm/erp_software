export interface ActionResult {
  ok: boolean
  message?: string
  fieldErrors?: Record<string, string[]>
  /** extra data for the UI, e.g. duplicate warnings or stage warnings */
  data?: Record<string, unknown>
}

export const initialResult: ActionResult = { ok: false }
