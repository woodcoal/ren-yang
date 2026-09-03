import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { PersonaDistillationRunView } from '#shared/types/personaDistillation'
import CandidateReview from '../../app/components/distillation/CandidateReview.vue'
import RestartModal from '../../app/components/distillation/RestartModal.vue'
import PersonaDistillationPage from '../../app/pages/personas/distillations/[id].vue'

const RUN_ID = '30000000-0000-4000-8000-000000000001'
const CANDIDATE_HASH = 'a'.repeat(64)

/** 创建自由分析完成后等待人工确认的稳定运行视图。 */
function createRun(overrides: Partial<PersonaDistillationRunView> = {}): PersonaDistillationRunView {
  return {
    id: RUN_ID,
    retryOfRunId: null,
    mode: 'create',
    status: 'awaiting_candidate_review',
    requestedName: '顾岚',
    objective: '提炼谨慎且重视证据的判断方式。',
    worldId: null,
    provider: 'sqlite_fts5',
    analysisReport: '## 判断方式\n先明确判断依据。\n\n## 未知边界\n资料不足时不推断。',
    candidateName: '顾岚',
    candidatePromptText: '# 心智模型\n先明确判断依据。',
    candidatePromptHash: CANDIDATE_HASH,
    preparedPromptHash: CANDIDATE_HASH,
    createdPersonaId: null,
    errorCode: null,
    errorMessage: null,
    inputs: [{
      id: '31000000-0000-4000-8000-000000000001',
      inputType: 'source_material',
      sourceId: '32000000-0000-4000-8000-000000000001',
      name: '人物访谈',
      sourceRole: 'canon_fact',
      independentSourceKey: 'interview-1',
      contentHash: 'b'.repeat(64),
      contentSnapshot: '我会先明确判断依据。',
      sourceAvailable: true,
      originUrl: null,
      authorName: null,
      publishedAt: null,
    }],
    createdAt: 1_000,
    updatedAt: 2_000,
    completedAt: null,
    ...overrides,
  }
}

let pageRun = createRun()
let cancelRequests = 0

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint(`/api/v1/persona-distillations/${RUN_ID}`, () => ({ data: pageRun }))
registerEndpoint(`/api/v1/persona-distillations/${RUN_ID}/cancel`, {
  method: 'POST',
  handler: () => {
    cancelRequests += 1
    pageRun = createRun({ status: 'canceled', updatedAt: 3_000 })
    return { data: pageRun }
  },
})

describe('人物自由蒸馏工作区', () => {
  beforeEach(() => {
    pageRun = createRun()
    cancelRequests = 0
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('重新蒸馏弹窗保留最近一次蒸馏用途，且允许按本次需求编辑', async () => {
    const wrapper = await mountSuspended(RestartModal, {
      props: {
        open: false,
        personaName: '顾岚',
        sources: [],
        initialSourceIds: [],
        initialObjective: '保留谨慎判断方式，用于发布商业观察短文。',
        loading: false,
        errorMessage: null,
      },
    })
    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(document.body.textContent).toContain('最终确认后只发布当前人物的新灵魂版本')
    const objective = document.querySelector<HTMLTextAreaElement>('[data-persona-redistillation-form] textarea')
    if (!objective) throw new Error('重新蒸馏弹窗缺少聚焦方向输入')
    expect(objective.value).toBe('保留谨慎判断方式，用于发布商业观察短文。')
    await new DOMWrapper(objective).setValue('保留当前判断原则，重点校准表达特征。')
    const submit = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('开始重新蒸馏'))
    if (!submit) throw new Error('重新蒸馏弹窗缺少提交按钮')
    await new DOMWrapper(submit).trigger('click')
    await flushPromises()
    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      objective: '保留当前判断原则，重点校准表达特征。', sourceIds: [],
    })
  })

  it('展示自由分析报告，人工校准后无需再次评测即可确认', async () => {
    const wrapper = await mountSuspended(CandidateReview, {
      props: { run: createRun(), loading: false },
    })
    expect(wrapper.text()).toContain('人物分析报告')
    expect(wrapper.text()).toContain('资料不足时不推断。')
    const confirmButton = wrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === '确认创建人物')
    if (!confirmButton) throw new Error('最终检查点缺少确认创建人物按钮')
    expect(confirmButton.props('disabled')).toBe(false)

    await wrapper.get('textarea').setValue('# 心智模型\n校准后的正文。')
    expect(confirmButton.props('disabled')).toBe(true)
    const saveButton = wrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === '保存校准版本')
    if (!saveButton) throw new Error('最终检查点缺少保存校准版本按钮')
    await saveButton.trigger('click')
    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
      expectedUpdatedAt: 2_000,
      promptText: '# 心智模型\n校准后的正文。',
    })
  })

  it('分析阶段重复点击取消只发送一次请求', async () => {
    pageRun = createRun({ status: 'analyzing', analysisReport: null, candidateName: null, candidatePromptText: null, candidatePromptHash: null, preparedPromptHash: null })
    const wrapper = await mountSuspended(PersonaDistillationPage, { route: `/personas/distillations/${RUN_ID}` })
    const cancelButton = wrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === '取消运行')
    if (!cancelButton) throw new Error('人物蒸馏工作区缺少取消按钮')
    await Promise.all([cancelButton.trigger('click'), cancelButton.trigger('click')])
    await vi.waitFor(() => expect(cancelRequests).toBe(1))
    await vi.waitFor(() => expect(wrapper.text()).toContain('人物蒸馏已取消'))
  })

  it('失败运行展示脱敏错误和固定输入重试入口', async () => {
    pageRun = createRun({ status: 'failed', errorCode: 'MODEL_OUTPUT_INVALID', errorMessage: '人物蒸馏模型输出无效。' })
    const wrapper = await mountSuspended(PersonaDistillationPage, { route: `/personas/distillations/${RUN_ID}` })
    await vi.waitFor(() => expect(wrapper.text()).toContain('人物蒸馏模型输出无效。'))
    expect(wrapper.findAllComponents({ name: 'UButton' }).some(button => button.text() === '使用固定输入重试')).toBe(true)
  })
})
