import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import HistoryPage from '../../app/pages/history.vue'

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint('/api/v1/runs', () => ({ data: [] }))
registerEndpoint('/api/v1/personas', () => ({
  data: [{
    id: '10000000-0000-4000-8000-000000000001', worldId: null, worldName: null, name: '林默', origin: 'original',
    activeVersionId: '11000000-0000-4000-8000-000000000001', currentSummary: '档案员', isEnabled: true,
    versionCount: 1, sourceCount: 0, createdAt: 1_000, updatedAt: 1_000,
  }],
}))
registerEndpoint('/api/v1/worlds', () => ({ data: [] }))
registerEndpoint('/api/v1/analysis-batches', () => ({
  data: [{
    id: '70000000-0000-4000-8000-000000000001', analysisType: 'persona_memory',
    subjectId: '10000000-0000-4000-8000-000000000001', mode: 'incremental', status: 'queued',
    baselineSoulVersionId: '11000000-0000-4000-8000-000000000001', inputs: [], proposals: [],
    resultSummary: null, errorCode: null, errorMessage: null, createdAt: 2_000, updatedAt: 2_000, completedAt: null,
  }],
}))

describe('统一任务记录页', () => {
  it('展示后台人物记忆提炼批次及排队状态', async () => {
    const wrapper = await mountSuspended(HistoryPage, { route: '/history' })
    await flushPromises()

    expect(wrapper.text()).toContain('人物记忆提炼')
    expect(wrapper.text()).toContain('林默')
    expect(wrapper.text()).toContain('排队中')
  })
})
