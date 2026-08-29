import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import DocumentSpecEditor from '../../app/components/generation/DocumentSpecEditor.vue'
import ArtifactBlockCard from '../../app/components/generation/ArtifactBlockCard.vue'
import ArtifactPreview from '../../app/components/generation/ArtifactPreview.vue'
import EvidenceList from '../../app/components/generation/EvidenceList.vue'
import RunStatusPanel from '../../app/components/generation/RunStatusPanel.vue'
import type { ArtifactBlockView, RenderedArtifactView, RunSummary } from '../../shared/types/generation'

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
  parameters: { temperature: 0.4, maxOutputTokens: 2048, timeoutMs: 60000, maxEvidenceChunks: 8, maxTextBlocks: 12, maxImageBlocks: 4, maxPromptCharacters: 120000, maxTotalTokens: 50000, maxBlockAttempts: 2 },
  model: { provider: 'openai_compatible', model: 'test-model', endpointOrigin: 'https://model.test' },
  imageModel: null,
  promptVersion: 'artifact-v2',
  contextProvider: 'sqlite_fts5',
  result: null,
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  errorCode: 'MODEL_OUTPUT_INVALID',
  errorMessage: '输出结构无效',
  createdAt: 1_000,
  updatedAt: 2_000,
  completedAt: 2_000,
}

describe('阶段三生成组件', () => {
  it('规格编辑器阻止空标题并在修正后提交独立规格', async () => {
    const wrapper = await mountSuspended(DocumentSpecEditor, {
      props: {
        spec: {
          title: '学院观察', summary: '摘要',
          purpose: '', constraints: [], requestedFormats: ['html', 'markdown', 'txt'],
          blocks: [{ key: 'title', type: 'text', role: 'heading', instruction: '写标题', acceptanceCriteria: ['简短'], dependsOn: [] }],
        },
      },
    })
    const title = wrapper.findAll('input')[0]!
    await title.setValue('')
    const save = wrapper.findAll('button').find(button => button.text().includes('保存新修订'))!
    await save.trigger('click')
    expect(wrapper.text()).toContain('文档标题不能为空')
    expect(wrapper.emitted('save')).toBeUndefined()

    await title.setValue('新标题')
    await save.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ title: '新标题', blocks: [{ key: 'title' }] })
  })

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

/** 组件测试使用的图片块及两次成功尝试。 */
const IMAGE_BLOCK: ArtifactBlockView = {
  id: '00000000-0000-4000-8000-000000000010',
  specKey: 'hero',
  ordinal: 1,
  type: 'image',
  role: 'hero_image',
  instruction: '生成主图',
  acceptanceCriteria: ['清晰'],
  status: 'succeeded',
  selectedAttemptId: '00000000-0000-4000-8000-000000000011',
  isLocked: false,
  selectedAt: 2_000,
  lockedAt: null,
  attempts: [
    {
      id: '00000000-0000-4000-8000-000000000012', attemptNo: 2, status: 'succeeded', outputText: null,
      usage: null,
      asset: {
        id: '00000000-0000-4000-8000-000000000013', relativePath: 'assets/00000000-0000-4000-8000-000000000013.png',
        mediaType: 'image/png', sizeBytes: 1024, contentHash: 'b'.repeat(64), altText: '学院主图新版',
      },
      errorCode: null, errorMessage: null, createdAt: 1_500, completedAt: 1_600,
    },
    {
      id: '00000000-0000-4000-8000-000000000011', attemptNo: 1, status: 'succeeded', outputText: null,
      usage: null,
      asset: {
        id: '00000000-0000-4000-8000-000000000014', relativePath: 'assets/00000000-0000-4000-8000-000000000014.png',
        mediaType: 'image/png', sizeBytes: 900, contentHash: 'c'.repeat(64), altText: '学院主图',
      },
      errorCode: null, errorMessage: null, createdAt: 1_000, completedAt: 1_100,
    },
  ],
}

/** 组件测试使用的三格式预览。 */
const PREVIEW: RenderedArtifactView = {
  runId: '00000000-0000-4000-8000-000000000020',
  documents: {
    html: '<!doctype html><html><body><img src="assets/00000000-0000-4000-8000-000000000013.png" alt="学院主图"></body></html>',
    markdown: '# 学院观察\n\n正文\n',
    txt: '学院观察\n\n正文\n',
  },
  assets: [{
    id: '00000000-0000-4000-8000-000000000013', relativePath: 'assets/00000000-0000-4000-8000-000000000013.png',
    mediaType: 'image/png', sizeBytes: 1024, contentHash: 'b'.repeat(64), altText: '学院主图',
  }],
}

describe('阶段四图文组件', () => {
  it('规格编辑器在运行允许时编辑并提交完整视觉简报', async () => {
    const wrapper = await mountSuspended(DocumentSpecEditor, {
      props: {
        allowImages: true,
        spec: {
          title: '学院观察', summary: '摘要', purpose: '介绍学院', constraints: [], requestedFormats: ['html', 'markdown', 'txt'],
          blocks: [
            { key: 'title', type: 'text', role: 'heading', instruction: '写标题', acceptanceCriteria: ['简短'], dependsOn: [] },
            {
              key: 'hero', type: 'image', role: 'hero_image', instruction: '生成学院插图', acceptanceCriteria: ['清晰'], dependsOn: ['title'],
              visualBrief: {
                theme: '魔法学院', subject: '图书馆', composition: '横向构图', colorPalette: '蓝金色', texture: '纸张质感',
                aspectRatio: '16:9', altText: '学院图书馆', negativePrompt: '',
              },
            },
          ],
        },
      },
    })

    expect(wrapper.findAll('button').some(button => button.text().includes('增加图片块'))).toBe(true)
    expect(wrapper.text()).toContain('图片主题')
    const subject = wrapper.findAll('input').find(input => input.element.value === '图书馆')!
    await subject.setValue('档案馆')
    const save = wrapper.findAll('button').find(button => button.text().includes('保存新修订'))!
    await save.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      blocks: [
        { type: 'text' },
        { type: 'image', visualBrief: { theme: '魔法学院', subject: '档案馆', altText: '学院图书馆' } },
      ],
    })
  })

  it('图片块显示受控资产并发出选择、重试和锁定意图', async () => {
    const wrapper = await mountSuspended(ArtifactBlockCard, {
      props: { runId: PREVIEW.runId, block: IMAGE_BLOCK },
    })

    const image = wrapper.find('img')
    expect(image.attributes()).toMatchObject({
      src: `/api/v1/runs/${PREVIEW.runId}/assets/00000000-0000-4000-8000-000000000013`,
      alt: '学院主图新版',
    })
    await wrapper.findAll('button').find(button => button.text().includes('选择此尝试'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('单块重试'))!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('锁定选中结果'))!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['00000000-0000-4000-8000-000000000012']])
    expect(wrapper.emitted('retry')).toHaveLength(1)
    expect(wrapper.emitted('lock')).toEqual([[true]])
  })

  it('块达到运行快照的累计尝试上限后不再提供重试入口', async () => {
    const wrapper = await mountSuspended(ArtifactBlockCard, {
      props: { runId: PREVIEW.runId, block: IMAGE_BLOCK, maxAttempts: 2 },
    })

    expect(wrapper.text()).toContain('已达到 2 次尝试上限')
    expect(wrapper.findAll('button').some(button => button.text().includes('单块重试'))).toBe(false)
  })

  it('HTML 只进入沙箱 srcdoc 并把相对图片改写为授权接口', async () => {
    const wrapper = await mountSuspended(ArtifactPreview, {
      props: { runId: PREVIEW.runId, formats: ['html', 'markdown', 'txt'], preview: PREVIEW },
    })

    const frame = wrapper.find('iframe')
    expect(frame.attributes('sandbox')).toBe('')
    expect(frame.attributes('srcdoc')).toContain(`/api/v1/runs/${PREVIEW.runId}/assets/00000000-0000-4000-8000-000000000013`)
    expect(frame.attributes('srcdoc')).not.toContain('src="assets/')
    await wrapper.findAll('button').find(button => button.text() === 'Markdown')!.trigger('click')
    expect(wrapper.find('pre').text()).toContain('# 学院观察')
    await wrapper.findAll('button').find(button => button.text().includes('刷新预览'))!.trigger('click')
    expect(wrapper.emitted('render')).toHaveLength(1)
    expect(wrapper.text()).toContain('下载 HTML')
    expect(wrapper.text()).toContain('下载 Markdown')
    expect(wrapper.text()).toContain('下载 TXT')
  })
})
