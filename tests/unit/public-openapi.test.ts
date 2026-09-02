import { describe, expect, it } from 'vitest'
import { createPublicOpenApiDocument } from '../../server/openapi/publicApiDocument'

/** 当前实现必须与文档双向覆盖的公共资源路径。 */
const EXPECTED_PATHS = [
  '/api/v2/personas',
  '/api/v2/personas/{personaId}',
  '/api/v2/personas/{personaId}/status',
  '/api/v2/personas/{personaId}/deletion-impact',
  '/api/v2/personas/{personaId}/world',
  '/api/v2/personas/{personaId}/soul',
  '/api/v2/personas/{personaId}/soul/draft',
  '/api/v2/personas/{personaId}/soul/publish',
  '/api/v2/worlds',
  '/api/v2/worlds/{worldId}',
  '/api/v2/worlds/{worldId}/status',
  '/api/v2/worlds/{worldId}/deletion-impact',
  '/api/v2/worlds/{worldId}/soul',
  '/api/v2/worlds/{worldId}/soul/draft',
  '/api/v2/worlds/{worldId}/soul/publish',
  '/api/v2/sources',
  '/api/v2/sources/files',
  '/api/v2/sources/{sourceId}',
  '/api/v2/sources/{sourceId}/status',
  '/api/v2/sources/{sourceId}/deletion-impact',
  '/api/v2/sources/{sourceId}/links',
  '/api/v2/sources/{sourceId}/links/{linkId}',
  '/api/v2/sources/{sourceId}/global',
  '/api/v2/generation-runs',
  '/api/v2/generation-runs/sync',
  '/api/v2/interest-batches',
  '/api/v2/interest-batches/sync',
  '/api/v2/interest-batches/{batchId}',
  '/api/v2/interest-batches/{batchId}/items/{itemId}/retry',
  '/api/v2/runs',
  '/api/v2/runs/{runId}',
  '/api/v2/runs/{runId}/cancel',
  '/api/v2/runs/{runId}/retry',
  '/api/v2/runs/{runId}/render',
  '/api/v2/runs/{runId}/assets/{assetId}',
  '/api/v2/runs/{runId}/exports/{format}',
]

describe('公共 OpenAPI 契约', () => {
  it('只覆盖 /api/v2 公共接口且与实现资源路径一致', () => {
    const document = createPublicOpenApiDocument()
    expect(document.openapi).toBe('3.1.0')
    expect(Object.keys(document.paths).sort()).toEqual([...EXPECTED_PATHS].sort())
    expect(JSON.stringify(document)).not.toContain('/api/v1')
    expect(document.components.securitySchemes.ApiKeyBearer).toMatchObject({ type: 'http', scheme: 'bearer' })
  })

  it('每个操作声明用途、权限、成功示例和统一失败响应', () => {
    const document = createPublicOpenApiDocument()
    for (const pathItem of Object.values(document.paths)) {
      for (const operation of Object.values(pathItem)) {
        expect(operation.summary).toBeTruthy()
        expect(operation.description).toContain('权限：')
        expect(operation.security).toEqual([{ ApiKeyBearer: [] }])
        expect(operation['x-required-scope']).toBeTruthy()
        expect(operation.responses['401']).toBeTruthy()
        expect(operation.responses['403']).toBeTruthy()
        expect(operation.responses['404']).toBeTruthy()
        expect(operation.responses['422']).toBeTruthy()
        expect(operation.responses['429']).toBeTruthy()
        const success = operation.responses['200'] ?? operation.responses['201'] ?? operation.responses['202'] ?? operation.responses['204']
        if (operation.operationId === 'getRunAsset' || operation.operationId === 'exportRun') {
          expect(success?.description).toContain('二进制')
        }
        else if (operation.responses['204']) {
          expect(success?.content).toBeUndefined()
        }
        else {
          expect(success?.content?.['application/json']?.examples?.success).toBeTruthy()
          expect(success?.content?.['application/json']?.schema).toMatchObject({
            properties: { data: { $ref: expect.stringMatching(/^#\/components\/schemas\//) } },
          })
        }
      }
    }
    expect(document.paths['/api/v2/personas']?.get?.responses['200']?.content?.['application/json']?.schema)
      .toMatchObject({ properties: { data: { $ref: '#/components/schemas/PersonaPage' } } })
    expect(document.paths['/api/v2/sources/{sourceId}']?.get?.responses['200']?.content?.['application/json']?.schema)
      .toMatchObject({ properties: { data: { $ref: '#/components/schemas/SourceDetails' } } })
    expect(document.paths['/api/v2/personas/{personaId}']?.delete?.responses['204']?.content).toBeUndefined()
    expect(document.paths['/api/v2/worlds/{worldId}']?.delete?.responses['204']?.content).toBeUndefined()
    expect(document.paths['/api/v2/sources/{sourceId}']?.delete?.responses['204']?.content).toBeUndefined()
    expect(document.paths['/api/v2/generation-runs']?.post?.responses['202']?.content?.['application/json']?.schema)
      .toMatchObject({ properties: { data: { $ref: '#/components/schemas/CreatedRun' } } })
    expect(document.paths['/api/v2/interest-batches']?.post?.responses['202']?.content?.['application/json']?.schema)
      .toMatchObject({ properties: { data: { $ref: '#/components/schemas/InterestBatch' } } })
    expect(document.paths['/api/v2/interest-batches/sync']?.post?.responses).toMatchObject({
      200: { content: { 'application/json': { schema: { properties: { data: { $ref: '#/components/schemas/SynchronousInterestBatch' } } } } } },
      202: { content: { 'application/json': { schema: { properties: { data: { $ref: '#/components/schemas/SynchronousInterestBatch' } } } } } },
    })
    expect(document.paths['/api/v2/generation-runs/sync']?.post?.responses).toMatchObject({
      200: { content: { 'application/json': { schema: { properties: { data: { $ref: '#/components/schemas/SynchronousGenerationRun' } } } } } },
      202: { content: { 'application/json': { schema: { properties: { data: { $ref: '#/components/schemas/SynchronousGenerationRun' } } } } } },
    })
    expect(document.components.schemas.CreateInterestBatch).toMatchObject({
      properties: {
        personaId: { $ref: '#/components/schemas/PersonaIdentifier' },
        additionalPrompt: { type: 'string', maxLength: 4_000, default: '' },
      },
    })
    expect(document.components.schemas.CreateGenerationRun).toMatchObject({
      properties: { personaId: { $ref: '#/components/schemas/PersonaIdentifier' } },
    })
    expect(document.paths['/api/v2/personas']?.post).toMatchObject({
      summary: expect.stringContaining('不调用 AI'),
    })
    expect(document.components.schemas.CreatePersona.description).toContain('按原文发布')
    expect(document.components.schemas.CreateSource).toMatchObject({
      properties: {
        originUrl: { type: ['string', 'null'], format: 'uri' },
        authorName: { type: ['string', 'null'] },
        publishedAt: { type: ['string', 'null'], format: 'date-time' },
        originalSourceKey: { type: ['string', 'null'] },
      },
    })
    expect(document.components.schemas.SourceFileForm).toMatchObject({
      properties: {
        originUrl: { type: 'string', format: 'uri' },
        publishedAt: { type: 'string', format: 'date-time' },
        originalSourceKey: { type: 'string' },
      },
    })
    expect(document.components.schemas.CreateSynchronousInterestBatch).toMatchObject({
      properties: { waitTimeoutMs: { type: 'integer', minimum: 1_000, maximum: 120_000, default: 30_000 } },
    })
    expect(document.components.schemas.CreateSynchronousGenerationRun).toMatchObject({
      properties: { waitTimeoutMs: { type: 'integer', minimum: 1_000, maximum: 120_000, default: 120_000 } },
    })
    expect(document.components.schemas.PersonaIdentifier).toEqual({
      type: 'string', minLength: 1, maxLength: 320,
      description: '人物 UUID、用户名或邮箱；用户名和邮箱忽略大小写及首尾空白。',
    })
    expect(document.paths['/api/v2/personas/{personaId}']?.get?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'personaId',
        schema: { $ref: '#/components/schemas/PersonaIdentifier' },
      }),
    ]))
    for (const [path, pathItem] of Object.entries(document.paths)) {
      if (!path.startsWith('/api/v2/personas/{personaId}')) continue
      for (const operation of Object.values(pathItem)) {
        expect(operation.parameters).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'personaId', schema: { $ref: '#/components/schemas/PersonaIdentifier' } }),
        ]))
      }
    }
    expect(document.components.schemas.SourceTarget).toMatchObject({
      oneOf: expect.arrayContaining([
        expect.objectContaining({ properties: expect.objectContaining({ targetType: { type: 'string', const: 'persona' }, targetId: { $ref: '#/components/schemas/PersonaIdentifier' } }) }),
      ]),
    })
    expect(document.components.schemas.SourceLinkInput).toMatchObject({
      oneOf: expect.arrayContaining([
        expect.objectContaining({ properties: expect.objectContaining({ targetType: { type: 'string', const: 'persona' }, targetId: { $ref: '#/components/schemas/PersonaIdentifier' } }) }),
      ]),
    })
    expect(document.components.schemas.InterestBatchItem).toMatchObject({
      required: expect.arrayContaining(['text']),
      properties: { text: { type: 'string' } },
    })
    expect(document.components.schemas.InterestBatch).toMatchObject({
      required: expect.arrayContaining(['additionalPrompt']),
      properties: { additionalPrompt: { type: 'string' } },
    })
    expect(document.paths['/api/v2/interest-batches/{batchId}']?.get?.['x-required-scope']).toBe('generation:read')
    expect(document.paths['/api/v2/interest-batches/{batchId}/items/{itemId}/retry']?.post?.['x-required-scope']).toBe('generation:write')
    expect(document.paths['/api/v2/runs/{runId}']?.get?.['x-required-scope']).toBe('generation:read')
    expect(document.paths['/api/v2/runs/{runId}/retry']?.post?.['x-required-scope']).toBe('generation:write')
    expect(document.paths['/api/v2/runs/{runId}/assets/{assetId}']?.get?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'variant', in: 'query', schema: { type: 'string', enum: ['result', 'original'], default: 'result' } }),
    ]))
  })

  it('所有写操作都声明幂等键，同一分页参数用于三类列表', () => {
    const document = createPublicOpenApiDocument()
    for (const pathItem of Object.values(document.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (method === 'get') continue
        expect(operation.parameters).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'Idempotency-Key', in: 'header', required: true }),
        ]))
        expect(operation.responses['409']).toBeTruthy()
        expect(operation.responses['413']).toBeTruthy()
      }
    }
    for (const path of ['/api/v2/personas', '/api/v2/worlds', '/api/v2/sources'] as const) {
      expect(document.paths[path]?.get?.parameters?.map(parameter => parameter.name)).toEqual([
        'page', 'pageSize', 'query', 'status', 'sort', 'order',
      ])
    }
    expect(document.paths['/api/v2/runs']?.get?.parameters?.map(parameter => parameter.name)).toEqual([
      'personaId', 'kind', 'status', 'limit',
    ])
    expect(document.paths['/api/v2/runs']?.get?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'personaId', schema: { $ref: '#/components/schemas/PersonaIdentifier' } }),
    ]))
  })
})
