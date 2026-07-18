export async function runAiConfigCreateBatch(items, createOne) {
  const source = Array.isArray(items) ? [...items] : []
  let success = 0
  let failed = 0

  for (const item of source) {
    try {
      await createOne(item)
      success += 1
    } catch (_) {
      failed += 1
    }
  }

  return { success, failed }
}
