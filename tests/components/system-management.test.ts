import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CapabilityStatusPanel from '../../app/components/system/CapabilityStatusPanel.vue'
import DashboardWorkPanel from '../../app/components/system/DashboardWorkPanel.vue'
import NavigationStatus from '../../app/components/system/NavigationStatus.vue'
import type { FeedbackView } from '../../shared/types/feedback'
import type { RunSummary } from '../../shared/types/generation'

/** 管理组件测试共用的能力状态。 */
const CAPABILITIES = {
  textModel: { configured: true as const, provider: 'openai_compatible' as const, model: 'text-model', endpointOrigin: 'https://text.test' },
  imageModel: { configured: false as const, provider: 'openai_compatible_images' as const, model: null, endpointOrigin: null },
  algorithmCapabilities: { articleGeneration: true, articleImageGeneration: false, interestAssessment: true },
  openViking: { configured: false, enabled: false, provider: 'openviking' as const, endpointOrigin: null },
  contextProvider: 'sqlite_fts5' as const,
  defaultParameters: {
    temperature: 0.4, maxOutputTokens: 2048, timeoutMs: 60000, maxEvidenceChunks: 8,
    maxTextBlocks: 12, maxImageBlocks: 4, maxPromptCharacters: 120000,
    maxTotalTokens: 50000, maxBlockAttempts: 2,
  },
}

describe('系统管理组件', () => {
  it('能力面板显示可用状态、降级影响和系统默认运行限制', async () => {
    const wrapper = await mountSuspended(CapabilityStatusPanel, {
      props: {
        capabilities: CAPABILITIES,
        showLimits: true,
      },
    })

    expect(wrapper.text()).toContain('文本生成可用')
    expect(wrapper.text()).toContain('图片块已禁用，纯文本不受影响')
    expect(wrapper.text()).toContain('SQLite FTS5')
    expect(wrapper.text()).toContain('最多 12 个文字块')
    expect(wrapper.text()).toContain('运行累计 50000 Token')
  })

  it('全局状态条显示登录账户、后台任务数和能力影响', async () => {
    const wrapper = await mountSuspended(NavigationStatus, {
      props: {
        username: 'e2e_admin',
        taskQueue: { userQueued: 2, queued: 2, running: 1, cancelRequested: 0, total: 3 },
        capabilities: CAPABILITIES,
      },
    })

    expect(wrapper.text()).toContain('e2e_admin')
    expect(wrapper.text()).toContain('后台任务 3')
    expect(wrapper.text()).toContain('文本可用')
    expect(wrapper.text()).toContain('图片关闭')
    expect(wrapper.text()).toContain('本地检索')
  })

  it('仪表盘工作摘要只列出活动运行并汇总待处理反馈', async () => {
    const activeRun: RunSummary = {
      id: '00000000-0000-4000-8000-000000000010', kind: 'artifact_generation',
      personaVersionId: '00000000-0000-4000-8000-000000000011', personaId: '00000000-0000-4000-8000-000000000012', personaName: '林默',
      status: 'running', input: { requirement: '写学院观察', outputFormat: 'text', imageCount: 0 }, scene: null,
      parameters: CAPABILITIES.defaultParameters,
      model: { provider: 'openai_compatible', model: 'text-model', endpointOrigin: 'https://text.test' }, imageModel: null,
      promptVersion: 'artifact-v2', contextProvider: 'sqlite_fts5', result: null, usage: null,
      errorCode: null, errorMessage: null, createdAt: 2_000, updatedAt: 3_000, completedAt: null,
    }
    const completedRun: RunSummary = { ...activeRun, id: '00000000-0000-4000-8000-000000000013', personaName: '已完成人物', status: 'succeeded', completedAt: 4_000 }
    const pendingFeedback: FeedbackView[] = [
      {
        id: '00000000-0000-4000-8000-000000000020', runId: activeRun.id, blockId: null,
        content: '正文需要更简洁。', rating: 'negative', isLongTerm: false, editedOutput: null,
        suggestion: { targetType: 'artifact', confidence: 0.9, rationale: '修正当前正文' },
        confirmedTarget: null, resolution: null, createdAt: 4_000, confirmedAt: null,
      },
      {
        id: '00000000-0000-4000-8000-000000000021', runId: completedRun.id, blockId: null,
        content: '以后都保持短句。', rating: null, isLongTerm: true, editedOutput: null,
        suggestion: { targetType: 'persona', confidence: 0.8, rationale: '人物成长素材' },
        confirmedTarget: null, resolution: null, createdAt: 5_000, confirmedAt: null,
      },
    ]
    const wrapper = await mountSuspended(DashboardWorkPanel, {
      props: {
        personas: [{
          id: activeRun.personaId, worldId: null, worldName: null, name: '林默', origin: 'original',
          activeVersionId: activeRun.personaVersionId, currentSummary: '学院观察员', versionCount: 1,
          sourceCount: 0, createdAt: 1_000, updatedAt: 3_000,
        }],
        runs: [activeRun, completedRun],
        pendingFeedback,
      },
    })

    expect(wrapper.text()).toContain('活动运行 1')
    expect(wrapper.text()).toContain('待处理反馈 2')
    expect(wrapper.text()).toContain('正文需要更简洁。')
    expect(wrapper.find(`a[href="/runs/${activeRun.id}"]`).exists()).toBe(true)
    expect(wrapper.text()).toContain('林默')
    expect(wrapper.text()).not.toContain('已完成人物')
  })
})
