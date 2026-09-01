import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { generatePersonaAvatarSchema } from '../../shared/schemas/content'
import { ContentApplicationService } from '../../server/application/content/ContentApplicationService'
import type { PersonaRecord, PersonaVersionRecord } from '../../server/domain/content/ContentModels'
import { LocalPersonaAvatarStorage } from '../../server/infrastructure/content/LocalPersonaAvatarStorage'
import { NodeSourceContentProcessor } from '../../server/infrastructure/content/NodeSourceContentProcessor'
import { LocalSourceFileStorage } from '../../server/infrastructure/content/LocalSourceFileStorage'
import { ConservativeTokenCounter } from '../../server/infrastructure/model/ConservativeTokenCounter'
import { SystemClock } from '../../server/infrastructure/system/SystemClock'
import { SystemIdentifierGenerator } from '../../server/infrastructure/system/SystemIdentifierGenerator'
import type { ContentRepository } from '../../server/ports/ContentRepository'
import type { ImageModelPort, ImageModelRequest, ImageModelResponse } from '../../server/ports/ImageModelPort'
import type { SoulRepository } from '../../server/ports/SoulRepository'

/** 测试人物 UUID。 */
const PERSONA_ID = '00000000-0000-4000-8000-000000000001'
/** 测试人物当前版本 UUID。 */
const VERSION_ID = '00000000-0000-4000-8000-000000000002'
/** 用于验证应用服务原样保存头像的 640×320 测试 PNG。 */
const PNG_BYTES = new Uint8Array(await sharp({
  create: { width: 640, height: 320, channels: 4, background: '#32658f' },
}).png().toBuffer())
/** 固定人物记录。 */
const PERSONA: PersonaRecord = {
  id: PERSONA_ID,
  worldId: null,
  name: '林默',
  origin: 'original',
  activeVersionId: VERSION_ID,
  isEnabled: true,
  createdAt: 1_000,
  updatedAt: 1_000,
}
/** 固定当前灵魂版本。 */
const VERSION: PersonaVersionRecord = {
  id: VERSION_ID,
  personaId: PERSONA_ID,
  parentVersionId: null,
  status: 'published',
  snapshot: { promptText: '谨慎克制的档案管理员，重视事实证据。' },
  runtimeTokenCount: 20,
  tokenCounter: 'test',
  changeSummary: '建立人物',
  publishedAt: 1_000,
  createdAt: 1_000,
}

/** 返回固定 PNG 并记录视觉提示的图片模型。 */
class RecordingImageModel implements ImageModelPort {
  /** 收到的全部图片生成请求。 */
  public readonly requests: ImageModelRequest[] = []
  /** 是否模拟算法二次裁剪并返回裁剪前原图。 */
  public retainOriginal = false

  /**
   * 返回固定非敏感模型配置。
   * @returns 已配置的测试图片模型快照。
   */
  getConfiguredModel() {
    return { provider: 'openai_compatible_images' as const, model: 'avatar-test', endpointOrigin: 'https://model.test' }
  }

  /**
   * 记录头像生成请求并返回测试 PNG。
   * @param request 应用服务构造的头像生成请求。
   * @returns 固定图片字节和声明类型。
   */
  async generate(request: ImageModelRequest): Promise<ImageModelResponse> {
    this.requests.push(request)
    return {
      bytes: PNG_BYTES,
      declaredMediaType: 'image/png',
      ...(this.retainOriginal
        ? { original: { bytes: PNG_BYTES, declaredMediaType: 'image/png' } }
        : {}),
    }
  }
}

/** 当前测试独占数据目录。 */
let directory: string
/** 当前测试应用服务。 */
let service: ContentApplicationService
/** 记录头像生成请求的测试模型。 */
let imageModel: RecordingImageModel

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-avatar-service-test-'))
  const identifiers = new SystemIdentifierGenerator()
  const repository = {
    /** @returns 固定人物记录。 */
    async findPersona(id: string) { return id === PERSONA_ID ? PERSONA : null },
    /** @returns 固定当前人物版本。 */
    async findPersonaVersion(id: string) { return id === VERSION_ID ? VERSION : null },
    /** @returns 固定人物版本列表。 */
    async listPersonaVersions(id: string) { return id === PERSONA_ID ? [VERSION] : [] },
    /** @returns 当前人物没有资料。 */
    async listPersonaSources() { return [] },
    /** @returns 当前人物没有所属世界。 */
    async findWorld() { return null },
    /** @returns 当前人物没有运行历史。 */
    async getPersonaRunHistoryStatistics() {
      return { runs: 0, tasks: 0, evidenceSnapshots: 0, documentSpecs: 0, artifactBlocks: 0, blockAttempts: 0 }
    },
    /** @returns 当前人物没有运行资产目录。 */
    async listPersonaRunIds() { return [] },
  } as unknown as ContentRepository & SoulRepository
  imageModel = new RecordingImageModel()
  service = new ContentApplicationService({
    repository,
    souls: repository,
    identifiers,
    clock: new SystemClock(),
    tokenCounter: new ConservativeTokenCounter(),
    tokenBudgets: { world: 2_500, persona: 3_500 },
    sourceProcessor: new NodeSourceContentProcessor(identifiers),
    sourceFiles: new LocalSourceFileStorage(directory),
    personaAvatars: new LocalPersonaAvatarStorage(directory),
    imageModel,
    prompts: {
      /**
       * 使用头像提示词固定变量构造测试图片请求。
       * @param _code 头像提示词稳定编码。
       * @param variables 人物名称、灵魂和补充要求 JSON 变量。
       * @returns 可供图片模型断言的测试渲染结果。
       */
      async render(_code: string, variables: Record<string, string>) {
        return {
          code: 'content.persona_avatar',
          versionId: '00000000-0000-4000-8000-000000000099',
          versionNo: 1,
          systemPrompt: '',
          userPrompt: [
            `人物名称：${JSON.parse(variables.nameJson!)}`,
            `人物设定：${JSON.parse(variables.soulPromptJson!)}`,
            `用户补充视觉要求：${JSON.parse(variables.additionalPromptJson!)}`,
            '用户补充要求不得替换人物名称、人物设定。',
            '不得出现文字、标志或水印。',
          ].join('\n'),
        }
      },
    },
  })
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('人物头像应用服务', () => {
  it('保存上传头像并在人物摘要中公开受保护读取地址', async () => {
    const summary = await service.uploadPersonaAvatar(PERSONA_ID, PNG_BYTES, 'image/png')
    const avatar = await service.getPersonaAvatar(PERSONA_ID)
    const metadata = await sharp(avatar.bytes).metadata()

    expect(summary.avatarUrl).toBe(`/api/v1/personas/${PERSONA_ID}/avatar`)
    expect(summary.avatarOriginalUrl).toBeNull()
    expect(avatar.mediaType).toBe('image/png')
    expect(metadata).toMatchObject({ width: 640, height: 320 })
  })

  it('使用人物名称和当前灵魂请求 1:1 图片并原样保存模型结果', async () => {
    imageModel.retainOriginal = true
    const summary = await service.generatePersonaAvatar(PERSONA_ID, { additionalPrompt: '' })

    expect(summary.avatarUrl).toBe(`/api/v1/personas/${PERSONA_ID}/avatar`)
    expect(summary.avatarOriginalUrl).toBe(`/api/v1/personas/${PERSONA_ID}/avatar?variant=original`)
    expect(imageModel.requests).toHaveLength(1)
    expect(imageModel.requests[0]).toMatchObject({ aspectRatio: '1:1', timeoutMs: 120_000 })
    expect(imageModel.requests[0]?.prompt).toContain('人物名称：林默')
    expect(imageModel.requests[0]?.prompt).toContain(VERSION.snapshot.promptText)
    expect(imageModel.requests[0]?.prompt).toContain('不得出现文字')
    const avatar = await service.getPersonaAvatar(PERSONA_ID)
    await expect(sharp(avatar.bytes).metadata()).resolves.toMatchObject({ width: 640, height: 320 })
    await expect(service.getPersonaAvatar(PERSONA_ID, 'original')).resolves.toMatchObject({ bytes: PNG_BYTES })
  })

  it('把自定义视觉要求追加到人物设定后并保留头像安全约束', async () => {
    await service.generatePersonaAvatar(PERSONA_ID, { additionalPrompt: '水彩插画，暖色逆光，旧档案馆背景。' })

    expect(imageModel.requests[0]?.prompt).toContain('用户补充视觉要求：水彩插画，暖色逆光，旧档案馆背景。')
    expect(imageModel.requests[0]?.prompt).toContain('人物名称：林默')
    expect(imageModel.requests[0]?.prompt).toContain('不得替换人物名称、人物设定')
    expect(imageModel.requests[0]?.prompt).toContain('不得出现文字')
  })

  it('校验并整理自定义头像补充提示词', () => {
    expect(generatePersonaAvatarSchema.parse({ additionalPrompt: '  暖色背景  ' })).toEqual({ additionalPrompt: '暖色背景' })
    expect(generatePersonaAvatarSchema.parse({})).toEqual({ additionalPrompt: '' })
    expect(generatePersonaAvatarSchema.safeParse({ additionalPrompt: '字'.repeat(2_001) }).success).toBe(false)
  })

  it('在读取不存在头像时返回稳定的资源不存在错误', async () => {
    await expect(service.getPersonaAvatar(PERSONA_ID)).rejects.toMatchObject({
      code: 'ASSET_NOT_FOUND',
      statusCode: 404,
    })
  })

  it('删除影响范围明确列出人物头像目录', async () => {
    await service.uploadPersonaAvatar(PERSONA_ID, PNG_BYTES, 'image/png')

    const impact = await service.getPersonaDeletionImpact(PERSONA_ID)

    expect(impact.files).toContain(`avatars/${PERSONA_ID}`)
  })
})
