import { describe, expect, it } from 'vitest'
import {
  AiCacheAffinityScheduler,
  buildAiCacheAffinityKey,
} from '../../server/application/aiConfiguration/AiCacheAffinityScheduler'

/** @returns 可由测试显式完成的异步信号。 */
function createSignal(): { promise: Promise<void>, resolve: () => void } {
  let resolve = () => {}
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

/** 构造不包含变化文本、运行标识或凭据的固定亲和键输入。 */
const FIXED_KEY_INPUT = {
  systemPrompt: '固定算法规则与人物心智 A',
  algorithmCode: 'interest_assessment',
  promptVersionId: 'prompt-version-a',
  modelDeploymentId: 'deployment-a',
  fixedParameters: {
    temperature: 0.2,
    maxOutputTokens: 2_048,
    timeoutMs: 60_000,
    responseSchemaName: 'interest_batch_assessment',
    responseFormat: 'json_object',
    thinkingDisableMode: 'none',
  },
} as const

describe('AiCacheAffinityScheduler', () => {
  it('同一亲和键严格按提交顺序串行执行', async () => {
    const scheduler = new AiCacheAffinityScheduler()
    const firstStarted = createSignal()
    const releaseFirst = createSignal()
    const events: string[] = []
    const first = scheduler.run('same-key', async () => {
      events.push('first-started')
      firstStarted.resolve()
      await releaseFirst.promise
      events.push('first-finished')
    })
    const second = scheduler.run('same-key', async () => {
      events.push('second-started')
    })

    await firstStarted.promise
    await Promise.resolve()
    expect(events).toEqual(['first-started'])
    releaseFirst.resolve()
    await Promise.all([first, second])

    expect(events).toEqual(['first-started', 'first-finished', 'second-started'])
  })

  it('不同亲和键互不等待并可同时执行', async () => {
    const scheduler = new AiCacheAffinityScheduler()
    const firstStarted = createSignal()
    const secondStarted = createSignal()
    const release = createSignal()
    const first = scheduler.run('first-key', async () => {
      firstStarted.resolve()
      await release.promise
    })
    const second = scheduler.run('second-key', async () => {
      secondStarted.resolve()
      await release.promise
    })

    await Promise.all([firstStarted.promise, secondStarted.promise])
    expect(scheduler.activeKeyCount).toBe(2)
    release.resolve()
    await Promise.all([first, second])
  })

  it('前序调用失败后释放同键后续调用并清理空闲键', async () => {
    const scheduler = new AiCacheAffinityScheduler()
    const releaseFirst = createSignal()
    const first = scheduler.run('same-key', async () => {
      await releaseFirst.promise
      throw new Error('供应商调用失败')
    })
    const second = scheduler.run('same-key', async () => '后续调用完成')

    releaseFirst.resolve()
    await expect(first).rejects.toThrow('供应商调用失败')
    await expect(second).resolves.toBe('后续调用完成')
    expect(scheduler.activeKeyCount).toBe(0)
  })
})

describe('buildAiCacheAffinityKey', () => {
  it('相同固定快照字段生成相同键且不受对象字段顺序影响', () => {
    const reordered = {
      ...FIXED_KEY_INPUT,
      fixedParameters: {
        timeoutMs: 60_000,
        maxOutputTokens: 2_048,
        temperature: 0.2,
        thinkingDisableMode: 'none',
        responseFormat: 'json_object',
        responseSchemaName: 'interest_batch_assessment',
      },
    }

    expect(buildAiCacheAffinityKey(FIXED_KEY_INPUT)).toBe(buildAiCacheAffinityKey(reordered))
  })

  it.each([
    ['系统提示词', { systemPrompt: '固定算法规则与人物心智 B' }],
    ['算法', { algorithmCode: 'article_generation' }],
    ['提示词版本', { promptVersionId: 'prompt-version-b' }],
    ['模型部署', { modelDeploymentId: 'deployment-b' }],
    ['固定参数', { fixedParameters: { ...FIXED_KEY_INPUT.fixedParameters, temperature: 0.7 } }],
  ])('%s 变化时生成不同亲和键', (_label, changes) => {
    expect(buildAiCacheAffinityKey({ ...FIXED_KEY_INPUT, ...changes })).not.toBe(buildAiCacheAffinityKey(FIXED_KEY_INPUT))
  })
})
