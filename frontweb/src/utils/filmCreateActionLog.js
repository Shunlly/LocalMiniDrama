import { logOperation } from '@/utils/operationLog'

export function trackFilmCreateAction(action, payload = {}) {
  const { extra, cancelled, ...rest } = payload
  let phase = 'info'
  if (/_failed$/.test(action)) phase = 'error'
  else if (/stop_complete$|cancel/.test(action)) phase = 'cancel'
  else if (/_complete$|_partial$/.test(action)) phase = 'success'
  else if (/_start$|_click$/.test(action)) phase = 'start'
  logOperation({
    operation: 'film_create',
    phase,
    action,
    cancelled: cancelled === true,
    ...(rest || {}),
    ...(extra && typeof extra === 'object' ? extra : {}),
  })
}
