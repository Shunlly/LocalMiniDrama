import test from "node:test"
import assert from "node:assert/strict"

import {
  clearSourceIntakeDraft,
  isAiConfigRoundTrip,
  restoreSourceIntakeDraft,
  saveSourceIntakeDraft,
} from "../src/components/sourceIntake/sourceIntakeDraft.js"
import { createSourceIntakeLeaveController } from "../src/components/sourceIntake/sourceIntakeLeaveGuard.js"

const DRAMA_ID = 11
const OTHER_ID = 22
assert.notEqual(DRAMA_ID, OTHER_ID)

function memoryStorage() {
  const data = new Map()
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null },
    setItem(key, value) { data.set(key, String(value)) },
    removeItem(key) { data.delete(key) },
  }
}

test("AI config round trip is detected", () => {
  assert.equal(isAiConfigRoundTrip({ path: "/ai-config", query: { returnTo: "/drama/11" } }), true)
  assert.equal(isAiConfigRoundTrip({ name: "ai-config" }), true)
  assert.equal(isAiConfigRoundTrip({ path: "/drama/11" }), false)
  assert.equal(isAiConfigRoundTrip(null), false)
})

test("source intake draft is keyed by drama id", () => {
  const storage = memoryStorage()
  const form = { title: "", source_type: "", target_episode_count: 1, source_url: "", text: "" }
  const saved = { title: "moon", source_type: "web", target_episode_count: 3, source_url: "https://example.com/story", text: "body" }
  assert.equal(saveSourceIntakeDraft(DRAMA_ID, saved, storage), true)
  assert.equal(restoreSourceIntakeDraft(OTHER_ID, form, storage), false)
  assert.equal(form.source_url, "")
  assert.equal(restoreSourceIntakeDraft(DRAMA_ID, form, storage), true)
  assert.equal(form.source_url, saved.source_url)
  assert.equal(form.text, saved.text)
  assert.equal(form.title, saved.title)
  assert.notEqual(String(form.source_url), String(OTHER_ID))
  clearSourceIntakeDraft(DRAMA_ID, storage)
  const empty = { title: "", source_url: "", text: "" }
  assert.equal(restoreSourceIntakeDraft(DRAMA_ID, empty, storage), false)
})

test("leaving to AI config persists draft and skips confirm", async () => {
  const storage = memoryStorage()
  const form = { title: "", source_url: "https://example.com/a", text: "" }
  const cleared = []
  const controller = createSourceIntakeLeaveController({
    sourceOperationActive: { value: false },
    hasUnsavedSourceInput: { value: true },
    showWorkflowMessage() {},
    persistDraftForRoundTrip: () => saveSourceIntakeDraft(DRAMA_ID, form, storage),
    clearDraft: () => { cleared.push(true) },
  })
  assert.equal(await controller.confirmSourceInputLeave({ path: "/ai-config" }), true)
  const restored = { title: "", source_url: "", text: "" }
  assert.equal(restoreSourceIntakeDraft(DRAMA_ID, restored, storage), true)
  assert.equal(restored.source_url, form.source_url)
  assert.deepEqual(cleared, [])
})
