import test from 'node:test'
import assert from 'node:assert/strict'

import { createCanvasSaveCoordinator } from '../src/utils/canvasSaveCoordinator.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function isSettled(promise) {
  let settled = false
  promise.finally(() => { settled = true })
  await Promise.resolve()
  return settled
}

test('waitForSettlement waits until every pending save for the project completes', async () => {
  const coordinator = createCanvasSaveCoordinator()
  const completeFirst = coordinator.begin(101)
  const waiting = coordinator.waitForSettlement(101)
  const completeSecond = coordinator.begin(101)

  assert.equal(coordinator.hasPending(101), true)
  completeFirst()
  assert.equal(await isSettled(waiting), false)

  completeSecond()
  await waiting
  assert.equal(coordinator.hasPending(101), false)
})

test('begin returns an idempotent complete function without leaking pending state', async () => {
  const coordinator = createCanvasSaveCoordinator()
  const complete = coordinator.begin(101)

  complete()
  complete()
  complete()

  assert.equal(coordinator.hasPending(101), false)
  await coordinator.waitForSettlement(101)
})

test('pending saves and settlement waiters are isolated by project', async () => {
  const coordinator = createCanvasSaveCoordinator()
  const completeA = coordinator.begin(101)
  const completeB = coordinator.begin(202)
  const waitingA = coordinator.waitForSettlement(101)
  const waitingB = coordinator.waitForSettlement(202)

  completeA()
  await waitingA

  assert.equal(coordinator.hasPending(101), false)
  assert.equal(coordinator.hasPending(202), true)
  assert.equal(await isSettled(waitingB), false)

  completeB()
  await waitingB
  assert.equal(coordinator.hasPending(202), false)
})

test('concurrent navigation barriers for one project share one promise and execute once', async () => {
  const coordinator = createCanvasSaveCoordinator()
  const taskResult = deferred()
  let executions = 0
  const task = () => {
    executions += 1
    return taskResult.promise
  }

  const first = coordinator.runNavigationBarrier(101, task)
  const second = coordinator.runNavigationBarrier(101, task)

  assert.strictEqual(second, first)
  await Promise.resolve()
  assert.equal(executions, 1)

  taskResult.resolve('allowed')
  assert.equal(await first, 'allowed')
  assert.equal(await second, 'allowed')
})

test('navigation barriers execute independently for different projects', async () => {
  const coordinator = createCanvasSaveCoordinator()
  const taskA = deferred()
  const taskB = deferred()
  let executionsA = 0
  let executionsB = 0

  const barrierA = coordinator.runNavigationBarrier(101, () => {
    executionsA += 1
    return taskA.promise
  })
  const barrierB = coordinator.runNavigationBarrier(202, () => {
    executionsB += 1
    return taskB.promise
  })

  assert.notStrictEqual(barrierA, barrierB)
  await Promise.resolve()
  assert.equal(executionsA, 1)
  assert.equal(executionsB, 1)

  taskA.resolve('A')
  assert.equal(await barrierA, 'A')
  assert.equal(await isSettled(barrierB), false)

  taskB.resolve('B')
  assert.equal(await barrierB, 'B')
})

test('a completed navigation barrier is released so a later task can run', async () => {
  const coordinator = createCanvasSaveCoordinator()
  let executions = 0

  const first = coordinator.runNavigationBarrier(101, async () => {
    executions += 1
    return 'first'
  })
  assert.equal(await first, 'first')

  const second = coordinator.runNavigationBarrier(101, async () => {
    executions += 1
    return 'second'
  })
  assert.notStrictEqual(second, first)
  assert.equal(await second, 'second')
  assert.equal(executions, 2)
})

test('a rejected navigation barrier is released and its rejection is shared', async () => {
  const coordinator = createCanvasSaveCoordinator()
  const expectedError = new Error('save failed')
  let failedExecutions = 0

  const first = coordinator.runNavigationBarrier(101, async () => {
    failedExecutions += 1
    throw expectedError
  })
  const shared = coordinator.runNavigationBarrier(101, async () => {
    failedExecutions += 1
    return 'must not run'
  })

  assert.strictEqual(shared, first)
  await assert.rejects(first, (error) => error === expectedError)
  await assert.rejects(shared, (error) => error === expectedError)
  assert.equal(failedExecutions, 1)

  assert.equal(await coordinator.runNavigationBarrier(101, async () => 'recovered'), 'recovered')
})
