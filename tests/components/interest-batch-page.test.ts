import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it } from 'vitest'
import InterestBatchPage from '../../app/pages/interest-batches/[id].vue'
import type { InterestBatchView } from '../../shared/types/generation'

const BATCH_ID = '70000000-0000-4000-8000-000000000101'
const FAILED_ITEM_ID = 'second'
let retryRequests = 0

/** 批次详情页测试使用的固定顺序结果。 */
const BATCH: InterestBatchView = {
  batchId: BATCH_ID,
  personaId: '10000000-0000-4000-8000-000000000001',
  personaName: '林默',
  additionalPrompt: '只按长期兴趣判断。',
  status: 'completed',
  items: [
    {
      itemId: 'first', runId: '71000000-0000-4000-8000-000000000001', text: '学院课程安排', status: 'succeeded',
      decision: 'interested', probability: 0.88, confidence: 0.82, reason: '符合人物长期兴趣。', error: null,
    },
    {
      itemId: FAILED_ITEM_ID, runId: '71000000-0000-4000-8000-000000000002', text: '娱乐新闻', status: 'failed',
      decision: null, probability: null, confidence: null, reason: null,
      error: { code: 'MODEL_OUTPUT_INVALID', message: '模型未返回该条结果' },
    },
  ],
  createdAt: 1_000,
  updatedAt: 2_000,
}

beforeEach(() => {
  retryRequests = 0
})

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint(`/api/v1/interest-batches/${BATCH_ID}`, () => ({ data: BATCH }))
registerEndpoint(`/api/v1/interest-batches/${BATCH_ID}/items/${FAILED_ITEM_ID}/retry`, {
  method: 'POST',
  handler: () => {
    retryRequests += 1
    return {
      data: {
        ...BATCH,
        status: 'queued',
        items: BATCH.items.map(item => item.itemId === FAILED_ITEM_ID
          ? { ...item, status: 'queued', error: null }
          : item),
      },
    }
  },
})

describe('兴趣批次详情页', () => {
  it('按输入顺序集中展示人物、附加提示词和全部判断结果', async () => {
    const wrapper = await mountSuspended(InterestBatchPage, { route: `/interest-batches/${BATCH_ID}` })
    await flushPromises()

    expect(wrapper.text()).toContain('林默')
    expect(wrapper.text()).toContain('只按长期兴趣判断。')
    expect(wrapper.text().indexOf('学院课程安排')).toBeLessThan(wrapper.text().indexOf('娱乐新闻'))
    expect(wrapper.text()).toContain('感兴趣')
    expect(wrapper.text()).toContain('88%')
    expect(wrapper.text()).toContain('MODEL_OUTPUT_INVALID：模型未返回该条结果')
  })

  it('只对失败条目提供单项重试并使用批次接口', async () => {
    const wrapper = await mountSuspended(InterestBatchPage, { route: `/interest-batches/${BATCH_ID}` })
    await flushPromises()

    const retryButton = wrapper.findAll('button').find(button => button.text() === '重试此条')
    expect(retryButton).toBeDefined()
    await retryButton!.trigger('click')
    await flushPromises()

    expect(retryRequests).toBe(1)
    expect(wrapper.text()).toContain('排队中')
    expect(wrapper.findAll('button').some(button => button.text() === '重试此条')).toBe(false)
  })
})
