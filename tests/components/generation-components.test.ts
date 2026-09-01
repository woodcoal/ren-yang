import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ArtifactGenerationForm from '../../app/components/generation/ArtifactGenerationForm.vue'
import ArtifactResult from '../../app/components/generation/ArtifactResult.vue'
import EvidenceList from '../../app/components/generation/EvidenceList.vue'
import InterestBatchForm from '../../app/components/generation/InterestBatchForm.vue'
import RunStatusPanel from '../../app/components/generation/RunStatusPanel.vue'
import type { PersonaSummary } from '../../shared/types/content'
import type { RenderedArtifactView, RunSummary } from '../../shared/types/generation'

/** 组件测试使用的固定运行摘要。 */
const RUN: RunSummary = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'interest_assessment',
  personaVersionId: '00000000-0000-4000-8000-000000000002',
  personaId: '00000000-0000-4000-8000-000000000003',
  personaName: '林默',
  status: 'failed',
  input: { content: '课程' },
  scene: null,
  parameters: { temperature: 0.4, maxOutputTokens: 2048, timeoutMs: 60000, maxEvidenceChunks: 8, maxTextBlocks: 12, maxImageBlocks: 4, maxPromptCharacters: 120000, maxTotalTokens: 50000, maxBlockAttempts: 2, contextWindowTokens: 32768, reservedOutputTokens: 4096, safetyMarginTokens: 2048, worldBudgetTokens: 5000, worldSoulBudgetTokens: 2500, worldGrowthBudgetTokens: 2500, personaBudgetTokens: 9000, personaSoulBudgetTokens: 3500, personaGrowthBudgetTokens: 2500, personaMemoryBudgetTokens: 3000, sourceBudgetTokens: 5000 },
  model: { provider: 'openai_compatible', model: 'test-model', endpointOrigin: 'https://model.test' },
  imageModel: null,
  promptVersion: 'artifact-v2',
  contextProvider: 'sqlite_fts5',
  promptContext: null,
  result: null,
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  errorCode: 'MODEL_OUTPUT_INVALID',
  errorMessage: '输出结构无效',
  createdAt: 1_000,
  updatedAt: 2_000,
  completedAt: 2_000,
}

/** 组件测试使用的已发布人物。 */
const PERSONA: PersonaSummary = {
  id: RUN.personaId,
  worldId: null,
  worldName: null,
  name: '林默',
  avatarUrl: null,
  origin: 'original',
  activeVersionId: RUN.personaVersionId,
  currentSummary: '冷静严谨的学院观察员',
  isEnabled: true,
  versionCount: 1,
  sourceCount: 1,
  createdAt: 1_000,
  updatedAt: 1_000,
}

/** 组件测试使用的正文与独立图片数据。 */
const RESULT: RenderedArtifactView = {
  runId: '00000000-0000-4000-8000-000000000020',
  documents: {
    html: '<!doctype html><html><body><p>正文</p><img src="assets/00000000-0000-4000-8000-000000000013.png" alt="学院主图"></body></html>',
    txt: '学院观察\n\n正文\n',
  },
  assets: [{
    id: '00000000-0000-4000-8000-000000000013',
    relativePath: 'assets/00000000-0000-4000-8000-000000000013.png',
    mediaType: 'image/png',
    sizeBytes: 1024,
    contentHash: 'b'.repeat(64),
    altText: '学院主图',
    original: {
      relativePath: 'assets/00000000-0000-4000-8000-000000000014.png',
      mediaType: 'image/png',
      sizeBytes: 2048,
      contentHash: 'c'.repeat(64),
    },
  }],
}

describe('直接图文生成组件', () => {
  it('一次提交人物、生成条件、输出格式和图片数量', async () => {
    const wrapper = await mountSuspended(ArtifactGenerationForm, {
      props: { personas: [PERSONA], imageConfigured: true, generationConfigured: true },
    })

    await wrapper.get('select[aria-label="使用的人物"]').setValue(PERSONA.id)
    await wrapper.get('select[aria-label="输出格式"]').setValue('html')
    await wrapper.get('select[aria-label="图片数量"]').setValue('2')
    await wrapper.get('textarea').setValue('以人物口吻写一篇学院课程介绍。')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toEqual([[{
      personaId: PERSONA.id,
      requirement: '以人物口吻写一篇学院课程介绍。',
      outputFormat: 'html',
      imageCount: 2,
    }]])
  })

  it('图片模型未配置时图片数量固定为零', async () => {
    const wrapper = await mountSuspended(ArtifactGenerationForm, {
      props: { personas: [PERSONA], imageConfigured: false, generationConfigured: true },
    })

    const imageCount = wrapper.get('select[aria-label="图片数量"]')
    expect(imageCount.attributes('disabled')).toBeDefined()
    expect((imageCount.element as HTMLSelectElement).value).toBe('0')
  })

  it('HTML 结果只进入无脚本沙箱并按授权地址加载混排图片', async () => {
    const wrapper = await mountSuspended(ArtifactResult, {
      props: { runId: RESULT.runId, outputFormat: 'html', result: RESULT },
    })

    const frame = wrapper.get('iframe')
    expect(frame.attributes('sandbox')).toBe('')
    expect(frame.attributes('srcdoc')).toContain(`/api/v1/runs/${RESULT.runId}/assets/00000000-0000-4000-8000-000000000013`)
    expect(frame.attributes('srcdoc')).not.toContain('src="assets/')
    expect(wrapper.find('pre').exists()).toBe(false)
    expect(wrapper.text()).toContain('下载结果')
  })

  it('文本结果将正文与图片数据分区显示', async () => {
    const wrapper = await mountSuspended(ArtifactResult, {
      props: { runId: RESULT.runId, outputFormat: 'text', result: RESULT },
    })

    expect(wrapper.get('pre').text()).toContain('学院观察')
    expect(wrapper.get('img').attributes()).toMatchObject({
      src: `/api/v1/runs/${RESULT.runId}/assets/00000000-0000-4000-8000-000000000013`,
      alt: '学院主图',
    })
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('配图')
    expect(wrapper.get('a[aria-label="查看学院主图的裁剪前原图"]').attributes('href'))
      .toBe(`/api/v1/runs/${RESULT.runId}/assets/00000000-0000-4000-8000-000000000013?variant=original`)
  })
})

describe('批量兴趣判断组件', () => {
  it('一次提交同一人物的多条文本和整批附加提示词', async () => {
    const wrapper = await mountSuspended(InterestBatchForm, {
      props: { personas: [PERSONA], configured: true },
    })

    await wrapper.get('select[aria-label="使用的人物"]').setValue(PERSONA.id)
    await wrapper.get('textarea[aria-label="待判断文本 1"]').setValue('学院课程安排')
    await wrapper.get('button[aria-label="添加待判断文本"]').trigger('click')
    await wrapper.get('textarea[aria-label="待判断文本 2"]').setValue('无关娱乐新闻')
    await wrapper.get('textarea[aria-label="附加提示词"]').setValue('只根据人物长期兴趣判断，不考虑短期热点。')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toEqual([[{
      personaId: PERSONA.id,
      additionalPrompt: '只根据人物长期兴趣判断，不考虑短期热点。',
      items: [
        { itemId: 'item-1', text: '学院课程安排' },
        { itemId: 'item-2', text: '无关娱乐新闻' },
      ],
    }]])
    expect(wrapper.text()).not.toContain('年龄阶段')
    expect(wrapper.text()).not.toContain('地点')
    expect(wrapper.text()).not.toContain('当前目标')
    expect(wrapper.text()).not.toContain('情绪')
    expect(wrapper.text()).not.toContain('当前事件')
  })
})

describe('运行详情通用组件', () => {
  it('失败运行只提供重新执行并发出重试意图', async () => {
    const wrapper = await mountSuspended(RunStatusPanel, { props: { run: RUN, tasks: [] } })
    expect(wrapper.text()).toContain('重新执行')
    expect(wrapper.text()).not.toContain('取消运行')
    expect(wrapper.text()).toContain('15 / 50000')

    await wrapper.findAll('button').find(button => button.text().includes('重新执行'))!.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('证据正文按文本渲染，不把导入内容解释为 HTML', async () => {
    const wrapper = await mountSuspended(EvidenceList, {
      props: {
        evidence: [{
          id: '00000000-0000-4000-8000-000000000004', sourceId: null, chunkId: null,
          role: 'reference', content: '<script>alert(1)</script>', contentHash: 'a'.repeat(64), rank: 0, metadata: {},
        }],
      },
    })

    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('<script>alert(1)</script>')
  })

  it('证据快照明确标识来源以及对 AI 推断的支持或反对关系', async () => {
    const supportingId = '00000000-0000-4000-8000-000000000004'
    const opposingId = '00000000-0000-4000-8000-000000000005'
    const sourceId = '00000000-0000-4000-8000-000000000006'
    const wrapper = await mountSuspended(EvidenceList, {
      props: {
        evidence: [
          { id: supportingId, sourceId, chunkId: null, role: 'canon_fact', content: '支持内容', contentHash: 'a'.repeat(64), rank: 0, metadata: {} },
          { id: opposingId, sourceId: null, chunkId: null, role: 'user_setting', content: '反对内容', contentHash: 'b'.repeat(64), rank: 1, metadata: {} },
        ],
        supportingEvidenceIds: [supportingId],
        opposingEvidenceIds: [opposingId],
      },
    })

    expect(wrapper.text()).toContain('支持 AI 推断')
    expect(wrapper.text()).toContain('反对 AI 推断')
    expect(wrapper.text()).toContain('人物版本内设定')
    expect(wrapper.get(`a[href="/sources/${sourceId}"]`).text()).toContain(sourceId)
  })
})
