import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { createHash } from 'node:crypto'
import { packageArtifact } from '../../server/application/generation/ArtifactPackager'
import { renderArtifact, type SelectedArtifactBlock } from '../../server/application/generation/ArtifactRenderer'
import type { DocumentSpec } from '../../shared/schemas/generation'
import type { ArtifactBlockRecord, GenerationRunRecord, ImageAssetRecord } from '../../server/domain/generation/GenerationModels'

/** 测试确认规格，包含危险文本以验证转义。 */
const SPEC: DocumentSpec = {
  title: '../<危险>标题',
  summary: '摘要<script>alert(1)</script>',
  purpose: '测试',
  constraints: [],
  requestedFormats: ['html', 'markdown', 'txt'],
  blocks: [
    { key: 'heading', type: 'text', role: 'heading', instruction: '标题', acceptanceCriteria: ['准确'], dependsOn: [] },
    {
      key: 'image', type: 'image', role: 'illustration', instruction: '插图', acceptanceCriteria: ['清晰'], dependsOn: ['heading'],
      visualBrief: { theme: '学院', subject: '图书馆', composition: '居中', colorPalette: '蓝色', texture: '纸张', aspectRatio: '16:9', altText: '插图](javascript:alert(1))', negativePrompt: '' },
    },
    { key: 'body', type: 'text', role: 'paragraph', instruction: '正文', acceptanceCriteria: ['简洁'], dependsOn: ['heading'] },
  ],
}

/** 测试图片资产。 */
const ASSET: ImageAssetRecord = {
  id: '00000000-0000-4000-8000-000000000011',
  attemptId: '00000000-0000-4000-8000-000000000012',
  relativePath: 'assets/00000000-0000-4000-8000-000000000011.png',
  mediaType: 'image/png',
  sizeBytes: 9,
  contentHash: 'a'.repeat(64),
  altText: '插图](javascript:alert(1))',
  createdAt: 1_000,
}

/** @param index 规格块下标。 @returns 对应的持久块记录。 */
function block(index: number): ArtifactBlockRecord {
  const value = SPEC.blocks[index]!
  return {
    id: `00000000-0000-4000-8000-00000000002${index}`,
    documentId: '00000000-0000-4000-8000-000000000030',
    specKey: value.key,
    ordinal: index,
    type: value.type,
    role: value.role,
    spec: value,
    status: 'succeeded',
    selectedAttemptId: ASSET.attemptId,
    isLocked: false,
    selectedAt: 1_000,
    lockedAt: null,
    createdAt: 1_000,
    updatedAt: 1_000,
  }
}

/** @returns 同一组选中图文块。 */
function selectedBlocks(): SelectedArtifactBlock[] {
  return [
    { block: block(0), outputText: '<img src=x onerror=alert(1)>', asset: null },
    { block: block(1), outputText: null, asset: ASSET },
    { block: block(2), outputText: '正文\u0000内容', asset: null },
  ]
}

/** @returns 导出打包使用的固定运行记录。 */
function run(): GenerationRunRecord {
  return {
    id: '00000000-0000-4000-8000-000000000040', kind: 'artifact_generation',
    personaVersionId: '00000000-0000-4000-8000-000000000041', formatTemplateId: null, parameterProfileId: null,
    status: 'succeeded', input: { requirement: '测试', outputFormat: 'html', imageCount: 1 }, scene: null,
    parameterSnapshot: { temperature: 0.4, maxOutputTokens: 2048, timeoutMs: 60000, maxEvidenceChunks: 8, maxTextBlocks: 12, maxImageBlocks: 4, maxPromptCharacters: 120000, maxTotalTokens: 50000, maxBlockAttempts: 2, contextWindowTokens: 32768, reservedOutputTokens: 4096, safetyMarginTokens: 2048, worldBudgetTokens: 5000, worldSoulBudgetTokens: 2500, worldGrowthBudgetTokens: 2500, personaBudgetTokens: 9000, personaSoulBudgetTokens: 3500, personaGrowthBudgetTokens: 2500, personaMemoryBudgetTokens: 3000, sourceBudgetTokens: 5000 },
    modelSnapshot: { provider: 'openai_compatible', model: 'test', endpointOrigin: 'https://text.test' },
    imageModelSnapshot: { provider: 'openai_compatible_images', model: 'test-image', endpointOrigin: 'https://image.test' },
    promptVersion: 'artifact-v2', contextProvider: 'sqlite_fts5', promptContextSnapshot: null, result: null, usage: null,
    errorCode: null, errorMessage: null, createdAt: 1_000, updatedAt: 2_000, completedAt: 2_000,
  }
}

describe('统一图文渲染与打包', () => {
  it('三种格式使用相同块顺序且不执行不可信标记', () => {
    const rendered = renderArtifact(SPEC, selectedBlocks(), ['html', 'markdown', 'txt'])

    expect(rendered.html).toContain('&lt;危险&gt;标题')
    expect(rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(rendered.html).not.toContain('<script>alert(1)</script>')
    expect(rendered.html?.indexOf('&lt;img')).toBeLessThan(rendered.html!.indexOf('<figure>'))
    expect(rendered.html?.indexOf('<figure>')).toBeLessThan(rendered.html!.indexOf('正文内容'))

    expect(rendered.markdown).toContain('assets/00000000-0000-4000-8000-000000000011.png')
    expect(rendered.markdown).toContain('![插图\\](javascript:alert(1))](assets/00000000-0000-4000-8000-000000000011.png)')
    expect(rendered.markdown).toContain('摘要\\<script\\>alert\\(1\\)\\</script\\>')
    expect(rendered.txt).not.toContain('[图片：')
    expect(rendered.txt).not.toContain('assets/00000000-0000-4000-8000-000000000011.png')
    expect(rendered.txt).not.toContain('\u0000')
  })

  it('含图片导出为带大小和 SHA-256 清单的安全 ZIP', () => {
    const document = renderArtifact(SPEC, selectedBlocks(), ['html']).html!
    const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])
    const packaged = packageArtifact(run(), SPEC.title, 'html', document, [{ asset: ASSET, bytes: imageBytes }], 3_000)
    const files = unzipSync(packaged.bytes)
    const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as {
      files: Array<{ relativePath: string, sizeBytes: number, sha256: string }>
    }

    expect(packaged).toMatchObject({ fileName: expect.stringMatching(/^危险-标题-00000000\.zip$/), mediaType: 'application/zip' })
    expect(Object.keys(files).sort()).toEqual(['assets/00000000-0000-4000-8000-000000000011.png', 'document.html', 'manifest.json'])
    const imageManifest = manifest.files.find(item => item.relativePath === ASSET.relativePath)
    expect(imageManifest).toEqual({
      relativePath: ASSET.relativePath,
      sizeBytes: imageBytes.byteLength,
      sha256: createHash('sha256').update(imageBytes).digest('hex'),
      mediaType: 'image/png',
    })
  })

  it('无图片时直接返回目标格式单文件', () => {
    const packaged = packageArtifact(run(), 'CON', 'txt', '正文\n', [], 3_000)
    expect(packaged).toMatchObject({ fileName: 'document-00000000.txt', mediaType: 'text/plain; charset=utf-8' })
    expect(strFromU8(packaged.bytes)).toBe('正文\n')
  })
})
