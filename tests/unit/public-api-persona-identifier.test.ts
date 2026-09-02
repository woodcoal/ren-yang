import { describe, expect, it } from 'vitest'
import { createInterestBatchSchema, createGenerationRunSchema, listRunsQuerySchema } from '../../shared/schemas/generation'
import {
  publicCreateGenerationRunSchema,
  publicCreateInterestBatchSchema,
  publicCreateSynchronousGenerationRunSchema,
  publicCreateSynchronousInterestBatchSchema,
  publicCreateSourceLinkSchema,
  publicCreateSourceWithTargetsSchema,
  publicListRunsQuerySchema,
  publicPersonaIdentifierSchema,
} from '../../shared/schemas/publicApi'

describe('公共 API v2 人物标识契约', () => {
  it('允许 UUID、用户名和邮箱，并统一别名的大小写与首尾空白', () => {
    expect(publicPersonaIdentifierSchema.parse('00000000-0000-4000-8000-000000000001'))
      .toBe('00000000-0000-4000-8000-000000000001')
    expect(publicPersonaIdentifierSchema.parse('  LinMo  ')).toBe('linmo')
    expect(publicPersonaIdentifierSchema.parse(' LINMO@EXAMPLE.COM ')).toBe('linmo@example.com')
  })

  it('v2 兴趣、图文和运行筛选接受人物别名，v1 共用 Schema 仍只接受 UUID', () => {
    expect(publicCreateInterestBatchSchema.parse({
      personaId: 'linmo', items: [{ itemId: 'item-1', text: '测试兴趣' }],
    }).personaId).toBe('linmo')
    expect(publicCreateGenerationRunSchema.parse({ personaId: 'linmo@example.com', requirement: '写一段简介' }).personaId)
      .toBe('linmo@example.com')
    expect(publicListRunsQuerySchema.parse({ personaId: 'LinMo' }).personaId).toBe('linmo')

    expect(() => createInterestBatchSchema.parse({
      personaId: 'linmo', items: [{ itemId: 'item-1', text: '测试兴趣' }],
    })).toThrow()
    expect(() => createGenerationRunSchema.parse({ personaId: 'linmo', requirement: '写一段简介' })).toThrow()
    expect(() => listRunsQuerySchema.parse({ personaId: 'linmo' })).toThrow()
  })

  it('同步优先接口使用各自默认等待时间并拒绝超过两分钟', () => {
    expect(publicCreateSynchronousInterestBatchSchema.parse({
      personaId: 'linmo', items: [{ itemId: 'item-1', text: '测试兴趣' }],
    }).waitTimeoutMs).toBe(30_000)
    expect(publicCreateSynchronousGenerationRunSchema.parse({
      personaId: 'linmo', requirement: '写一段简介',
    }).waitTimeoutMs).toBe(120_000)
    expect(() => publicCreateSynchronousGenerationRunSchema.parse({
      personaId: 'linmo', requirement: '写一段简介', waitTimeoutMs: 120_001,
    })).toThrow('同步等待不能超过 120000 毫秒')
    expect(() => publicCreateSynchronousInterestBatchSchema.parse({
      personaId: 'linmo', items: [{ itemId: 'item-1', text: '测试兴趣' }], waitTimeoutMs: 999,
    })).toThrow('同步等待不能少于 1000 毫秒')
  })

  it('资料关系仅在人物目标中接受别名，世界目标继续要求 UUID', () => {
    const parsed = publicCreateSourceWithTargetsSchema.parse({
      name: '资料', role: 'reference', content: '正文',
      originUrl: 'https://example.com/interview',
      authorName: '受访者',
      publishedAt: '2026-09-03T08:00:00Z',
      originalSourceKey: 'interview:2026-09-03',
      targets: [{ targetType: 'persona', targetId: 'LinMo' }],
    })
    expect(parsed).toMatchObject({
      originUrl: 'https://example.com/interview',
      authorName: '受访者',
      publishedAt: Date.parse('2026-09-03T08:00:00Z'),
      originalSourceKey: 'interview:2026-09-03',
      targets: [{ targetType: 'persona', targetId: 'linmo' }],
    })
    expect(publicCreateSourceLinkSchema.parse({ targetType: 'persona', targetId: 'linmo@example.com' }))
      .toMatchObject({ targetType: 'persona', targetId: 'linmo@example.com', priority: 100 })
    expect(() => publicCreateSourceWithTargetsSchema.parse({
      name: '资料', role: 'reference', content: '正文', publishedAt: '2026-09-03',
    })).toThrow('资料发表时间必须是带时区的 ISO 8601 时间')
    expect(() => publicCreateSourceLinkSchema.parse({ targetType: 'world', targetId: 'not-a-uuid' })).toThrow()
  })
})
