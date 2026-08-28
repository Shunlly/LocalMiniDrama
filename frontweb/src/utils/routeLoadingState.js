export function createRouteLoadingState() {
  let latestToken = 0
  let loading = false

  return {
    get loading() {
      return loading
    },
    begin() {
      latestToken += 1
      loading = true
      return latestToken
    },
    complete(token) {
      if (token !== latestToken) return false
      loading = false
      return true
    },
  }
}
