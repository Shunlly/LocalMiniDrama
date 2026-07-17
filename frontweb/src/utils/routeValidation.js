export function isValidResourceId(value) {
  return /^[1-9]\d*$/.test(String(value ?? ''))
}

export function requireValidDramaId(to) {
  if (isValidResourceId(to?.params?.id)) return true
  return {
    path: '/not-found',
    replace: true,
    query: { from: to?.fullPath || '' },
  }
}
