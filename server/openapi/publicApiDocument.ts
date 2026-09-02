/** OpenAPI 参数的最小严格结构。 */
interface OpenApiParameter {
  name: string
  in: 'path' | 'query' | 'header'
  required?: boolean
  description: string
  schema: Record<string, unknown>
  example?: unknown
}

/** OpenAPI 响应的最小严格结构。 */
interface OpenApiResponse {
  description?: string
  content?: Record<string, { schema: Record<string, unknown>, examples: Record<string, { value: unknown }> }>
  $ref?: string
}

/** 单个公共 API 操作契约。 */
interface OpenApiOperation {
  tags: string[]
  operationId: string
  summary: string
  description: string
  security: Array<{ ApiKeyBearer: [] }>
  'x-required-scope': string
  parameters: OpenApiParameter[]
  requestBody?: Record<string, unknown>
  responses: Record<string, OpenApiResponse>
}

/** 本项目公共 API 使用的 OpenAPI 3.1 文档结构。 */
export interface PublicOpenApiDocument {
  openapi: '3.1.0'
  info: Record<string, unknown>
  servers: Array<{ url: string, description: string }>
  tags: Array<{ name: string, description: string }>
  paths: Record<string, Record<string, OpenApiOperation>>
  components: {
    securitySchemes: { ApiKeyBearer: Record<string, unknown> }
    schemas: Record<string, Record<string, unknown>>
    responses: Record<string, OpenApiResponse>
  }
}

/** 列表接口共用且顺序固定的分页、筛选和排序参数。 */
const LIST_PARAMETERS: OpenApiParameter[] = [
  { name: 'page', in: 'query', description: '从 1 开始的页码；超过末页时返回最后一页。', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'pageSize', in: 'query', description: '每页数量。', schema: { type: 'integer', enum: [5, 10, 20, 50, 100], default: 10 } },
  { name: 'query', in: 'query', description: '按名称模糊筛选，最多 200 字。', schema: { type: 'string', maxLength: 200 } },
  { name: 'status', in: 'query', description: '按启用状态筛选。', schema: { type: 'string', enum: ['all', 'enabled', 'disabled'], default: 'all' } },
  { name: 'sort', in: 'query', description: '稳定排序字段。', schema: { type: 'string', enum: ['name', 'createdAt', 'updatedAt'], default: 'updatedAt' } },
  { name: 'order', in: 'query', description: '排序方向。', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
]

/** 图文运行历史使用的固定筛选参数。 */
const RUN_LIST_PARAMETERS: OpenApiParameter[] = [
  { name: 'personaId', in: 'query', description: '按人物 UUID、用户名或邮箱筛选。', schema: { $ref: '#/components/schemas/PersonaIdentifier' } },
  { name: 'kind', in: 'query', description: '按运行类型筛选。', schema: { type: 'string', enum: ['interest_assessment', 'artifact_generation'] } },
  { name: 'status', in: 'query', description: '按运行状态筛选。', schema: { type: 'string', enum: ['planning', 'awaiting_confirmation', 'queued', 'running', 'succeeded', 'partial', 'failed', 'canceled'] } },
  { name: 'limit', in: 'query', description: '最多返回数量。', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
]

/** 公共写接口要求的持久幂等请求头。 */
const IDEMPOTENCY_PARAMETER: OpenApiParameter = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  description: '调用方生成的唯一操作标识，最多 200 字；相同请求永久复用首次成功结果。',
  schema: { type: 'string', minLength: 1, maxLength: 200 },
  example: 'operation-20260901-0001',
}

/** 每个公共操作成功返回的实际资源 Schema。 */
const RESPONSE_SCHEMA_BY_OPERATION: Record<string, string> = {
  listPersonas: 'PersonaPage',
  createPersona: 'PersonaDetails',
  getPersona: 'PersonaDetails',
  updatePersona: 'PersonaDetails',
  deletePersona: 'DeleteResult',
  updatePersonaStatus: 'PersonaDetails',
  getPersonaDeletionImpact: 'DeletionImpact',
  linkPersonaWorld: 'PersonaDetails',
  unlinkPersonaWorld: 'PersonaDetails',
  getPersonaSoul: 'SoulWorkspace',
  savePersonaSoulDraft: 'SoulDraft',
  publishPersonaSoul: 'SoulVersion',
  listWorlds: 'WorldPage',
  createWorld: 'WorldDetails',
  getWorld: 'WorldDetails',
  updateWorld: 'WorldDetails',
  deleteWorld: 'DeleteResult',
  updateWorldStatus: 'WorldDetails',
  getWorldDeletionImpact: 'DeletionImpact',
  getWorldSoul: 'SoulWorkspace',
  saveWorldSoulDraft: 'SoulDraft',
  publishWorldSoul: 'SoulVersion',
  listSources: 'SourcePage',
  createSource: 'SourceDetails',
  uploadSourceFile: 'SourceDetails',
  getSource: 'SourceDetails',
  updateSource: 'SourceDetails',
  deleteSource: 'DeleteResult',
  updateSourceStatus: 'SourceDetails',
  getSourceDeletionImpact: 'DeletionImpact',
  linkSource: 'SourceDetails',
  unlinkSource: 'SourceDetails',
  linkGlobalSource: 'GlobalSources',
  unlinkGlobalSource: 'GlobalSources',
  createGenerationRun: 'CreatedRun',
  createSynchronousGenerationRun: 'SynchronousGenerationRun',
  createInterestBatch: 'InterestBatch',
  createSynchronousInterestBatch: 'SynchronousInterestBatch',
  getInterestBatch: 'InterestBatch',
  retryInterestBatchItem: 'InterestBatch',
  listRuns: 'RunList',
  getRun: 'RunDetails',
  cancelRun: 'RunDetails',
  retryRun: 'CreatedRun',
  renderRun: 'RenderedArtifact',
}

/**
 * 创建公共资源共用的 UUID 路径参数。
 * @param name OpenAPI 路径参数名称字符串。
 * @param label 用于生成说明的资源中文名。
 * @returns 必填且格式为 UUID 的路径参数。
 */
function idParameter(name: string, label: string): OpenApiParameter {
  return { name, in: 'path', required: true, description: `${label}稳定 UUID。`, schema: { type: 'string', format: 'uuid' } }
}

/**
 * 创建允许 UUID、用户名或邮箱的人物路径参数。
 * @returns 指向统一人物标识 Schema 的必填路径参数。
 */
function personaIdentifierParameter(): OpenApiParameter {
  return {
    name: 'personaId', in: 'path', required: true,
    description: '人物 UUID、用户名或邮箱；用户名和邮箱忽略大小写及首尾空白。',
    schema: { $ref: '#/components/schemas/PersonaIdentifier' },
  }
}

/**
 * 创建人物、世界、资料库和图文运行公共 API 的唯一 OpenAPI 契约。
 * @returns 只包含 `/api/v2` 业务接口的 OpenAPI 3.1 文档。
 */
export function createPublicOpenApiDocument(): PublicOpenApiDocument {
  const personaId = personaIdentifierParameter()
  const worldId = idParameter('worldId', '世界')
  const sourceId = idParameter('sourceId', '资料')
  const runId = idParameter('runId', '运行')
  const batchId = idParameter('batchId', '兴趣批次')
  const itemId: OpenApiParameter = { name: 'itemId', in: 'path', required: true, description: '调用方在批次内提供的稳定条目标识。', schema: { type: 'string', minLength: 1, maxLength: 100 } }
  const assetId = idParameter('assetId', '图片资产')
  const assetVariant: OpenApiParameter = {
    name: 'variant', in: 'query', description: '读取最终裁剪结果或裁剪前原图。',
    schema: { type: 'string', enum: ['result', 'original'], default: 'result' },
  }
  const format: OpenApiParameter = { name: 'format', in: 'path', required: true, description: '导出格式。', schema: { type: 'string', enum: ['html', 'markdown', 'txt'] } }
  const linkId: OpenApiParameter = { name: 'linkId', in: 'path', required: true, description: '资料关系稳定标识。', schema: { type: 'string' } }
  return {
    openapi: '3.1.0',
    info: {
      title: '人样公共 API',
      version: '2.0.0',
      description: '面向外部 Agent、脚本和集成系统的人物、世界、资料库与直接图文生成 API。所有时间均为 ISO 8601 UTC。',
    },
    servers: [{ url: '/', description: '当前人样实例' }],
    tags: [
      { name: '人物', description: '人物元数据、启停、世界关系和灵魂发布。' },
      { name: '世界', description: '世界元数据、启停和灵魂发布。' },
      { name: '资料库', description: '文本/文件资料、启停以及人物、世界、全局关系。' },
      { name: '图文运行', description: '创建直接图文任务、查询状态、取消、整体重试、渲染与下载结果。' },
      { name: '兴趣判定', description: '同一人物批量判定多条文本，并逐项查询或重试失败结果。' },
    ],
    paths: {
      '/api/v2/personas': {
        get: readOperation('人物', 'listPersonas', '分页查询人物', 'persona:read', LIST_PARAMETERS),
        post: writeOperation('人物', 'createPersona', '创建人物并发布初始灵魂', 'persona:write', [], '#/components/schemas/CreatePersona', 201),
      },
      '/api/v2/personas/{personaId}': {
        get: readOperation('人物', 'getPersona', '查询人物详情', 'persona:read', [personaId]),
        patch: writeOperation('人物', 'updatePersona', '修改人物名称和世界关系', 'persona:write', [personaId], '#/components/schemas/UpdatePersona'),
        delete: writeOperation('人物', 'deletePersona', '受控删除人物', 'persona:write', [personaId], undefined, 204),
      },
      '/api/v2/personas/{personaId}/status': {
        patch: writeOperation('人物', 'updatePersonaStatus', '启用或停用人物', 'persona:write', [personaId], '#/components/schemas/StatusInput'),
      },
      '/api/v2/personas/{personaId}/deletion-impact': {
        get: readOperation('人物', 'getPersonaDeletionImpact', '查询人物删除影响', 'persona:read', [personaId]),
      },
      '/api/v2/personas/{personaId}/world': {
        put: writeOperation('人物', 'linkPersonaWorld', '关联人物与唯一世界', 'persona:write', [personaId], '#/components/schemas/PersonaWorldInput'),
        delete: writeOperation('人物', 'unlinkPersonaWorld', '解除人物世界关系', 'persona:write', [personaId]),
      },
      '/api/v2/personas/{personaId}/soul': {
        get: readOperation('人物', 'getPersonaSoul', '查询人物灵魂工作区', 'persona:read', [personaId]),
      },
      '/api/v2/personas/{personaId}/soul/draft': {
        put: writeOperation('人物', 'savePersonaSoulDraft', '保存人物灵魂草稿', 'persona:write', [personaId], '#/components/schemas/SoulDraftInput'),
      },
      '/api/v2/personas/{personaId}/soul/publish': {
        post: writeOperation('人物', 'publishPersonaSoul', '发布人物灵魂草稿', 'persona:write', [personaId]),
      },
      '/api/v2/worlds': {
        get: readOperation('世界', 'listWorlds', '分页查询世界', 'world:read', LIST_PARAMETERS),
        post: writeOperation('世界', 'createWorld', '创建世界并发布初始灵魂', 'world:write', [], '#/components/schemas/CreateWorld', 201),
      },
      '/api/v2/worlds/{worldId}': {
        get: readOperation('世界', 'getWorld', '查询世界详情', 'world:read', [worldId]),
        patch: writeOperation('世界', 'updateWorld', '修改世界名称和摘要', 'world:write', [worldId], '#/components/schemas/UpdateWorld'),
        delete: writeOperation('世界', 'deleteWorld', '受控删除世界', 'world:write', [worldId], undefined, 204),
      },
      '/api/v2/worlds/{worldId}/status': {
        patch: writeOperation('世界', 'updateWorldStatus', '启用或停用世界', 'world:write', [worldId], '#/components/schemas/StatusInput'),
      },
      '/api/v2/worlds/{worldId}/deletion-impact': {
        get: readOperation('世界', 'getWorldDeletionImpact', '查询世界删除影响', 'world:read', [worldId]),
      },
      '/api/v2/worlds/{worldId}/soul': {
        get: readOperation('世界', 'getWorldSoul', '查询世界灵魂工作区', 'world:read', [worldId]),
      },
      '/api/v2/worlds/{worldId}/soul/draft': {
        put: writeOperation('世界', 'saveWorldSoulDraft', '保存世界灵魂草稿', 'world:write', [worldId], '#/components/schemas/SoulDraftInput'),
      },
      '/api/v2/worlds/{worldId}/soul/publish': {
        post: writeOperation('世界', 'publishWorldSoul', '发布世界灵魂草稿', 'world:write', [worldId]),
      },
      '/api/v2/sources': {
        get: readOperation('资料库', 'listSources', '分页查询资料', 'library:read', LIST_PARAMETERS),
        post: writeOperation('资料库', 'createSource', '创建文本资料并建立初始关系', 'library:write', [], '#/components/schemas/CreateSource', 201),
      },
      '/api/v2/sources/files': {
        post: writeOperation('资料库', 'uploadSourceFile', '上传 TXT 或 Markdown 资料', 'library:write', [], '#/components/schemas/SourceFileForm', 201, 'multipart/form-data'),
      },
      '/api/v2/sources/{sourceId}': {
        get: readOperation('资料库', 'getSource', '查询资料正文和关系', 'library:read', [sourceId]),
        patch: writeOperation('资料库', 'updateSource', '修改资料元数据和正文', 'library:write', [sourceId], '#/components/schemas/UpdateSource'),
        delete: writeOperation('资料库', 'deleteSource', '受控删除资料', 'library:write', [sourceId], undefined, 204),
      },
      '/api/v2/sources/{sourceId}/status': {
        patch: writeOperation('资料库', 'updateSourceStatus', '启用或停用资料', 'library:write', [sourceId], '#/components/schemas/StatusInput'),
      },
      '/api/v2/sources/{sourceId}/deletion-impact': {
        get: readOperation('资料库', 'getSourceDeletionImpact', '查询资料删除影响', 'library:read', [sourceId]),
      },
      '/api/v2/sources/{sourceId}/links': {
        post: writeOperation('资料库', 'linkSource', '关联资料与人物或世界', 'library:write', [sourceId], '#/components/schemas/SourceLinkInput'),
      },
      '/api/v2/sources/{sourceId}/links/{linkId}': {
        delete: writeOperation('资料库', 'unlinkSource', '解除资料人物或世界关系', 'library:write', [sourceId, linkId]),
      },
      '/api/v2/sources/{sourceId}/global': {
        put: writeOperation('资料库', 'linkGlobalSource', '把资料加入全局范围', 'library:write', [sourceId]),
        delete: writeOperation('资料库', 'unlinkGlobalSource', '把资料移出全局范围', 'library:write', [sourceId]),
      },
      '/api/v2/generation-runs': {
        post: writeOperation('图文运行', 'createGenerationRun', '创建直接图文生成运行', 'generation:write', [], '#/components/schemas/CreateGenerationRun', 202),
      },
      '/api/v2/generation-runs/sync': {
        post: synchronousWriteOperation('图文运行', 'createSynchronousGenerationRun', '同步优先创建直接图文生成运行', 'generation:write', '#/components/schemas/CreateSynchronousGenerationRun'),
      },
      '/api/v2/interest-batches': {
        post: writeOperation('兴趣判定', 'createInterestBatch', '创建批量兴趣判定', 'generation:write', [], '#/components/schemas/CreateInterestBatch', 202),
      },
      '/api/v2/interest-batches/sync': {
        post: synchronousWriteOperation('兴趣判定', 'createSynchronousInterestBatch', '同步优先创建批量兴趣判定', 'generation:write', '#/components/schemas/CreateSynchronousInterestBatch'),
      },
      '/api/v2/interest-batches/{batchId}': {
        get: readOperation('兴趣判定', 'getInterestBatch', '查询批量兴趣判定', 'generation:read', [batchId]),
      },
      '/api/v2/interest-batches/{batchId}/items/{itemId}/retry': {
        post: writeOperation('兴趣判定', 'retryInterestBatchItem', '仅重试一个失败兴趣条目', 'generation:write', [batchId, itemId], undefined, 202),
      },
      '/api/v2/runs': {
        get: readOperation('图文运行', 'listRuns', '查询运行历史', 'generation:read', RUN_LIST_PARAMETERS),
      },
      '/api/v2/runs/{runId}': {
        get: readOperation('图文运行', 'getRun', '查询运行状态与结果', 'generation:read', [runId]),
      },
      '/api/v2/runs/{runId}/cancel': {
        post: writeOperation('图文运行', 'cancelRun', '请求协作式取消运行', 'generation:write', [runId]),
      },
      '/api/v2/runs/{runId}/retry': {
        post: writeOperation('图文运行', 'retryRun', '整体重试失败或部分成功运行', 'generation:write', [runId], undefined, 202),
      },
      '/api/v2/runs/{runId}/render': {
        post: writeOperation('图文运行', 'renderRun', '即时渲染运行结果', 'generation:read', [runId], '#/components/schemas/RenderRun'),
      },
      '/api/v2/runs/{runId}/assets/{assetId}': {
        get: binaryReadOperation('图文运行', 'getRunAsset', '读取运行图片资产', 'generation:read', [runId, assetId, assetVariant], 'image/png, image/jpeg 或 image/webp'),
      },
      '/api/v2/runs/{runId}/exports/{format}': {
        get: binaryReadOperation('图文运行', 'exportRun', '下载运行结果', 'generation:read', [runId, format], 'text/plain、text/html 或 application/zip'),
      },
    },
    components: {
      securitySchemes: {
        ApiKeyBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'ry_v2_*', description: '输入管理员创建时唯一一次显示的完整 API Key。' },
      },
      schemas: createSchemas(),
      responses: createErrorResponses(),
    },
  }
}

/**
 * 创建不需要幂等键的公共读取操作。
 * @param tag 业务分组标签。
 * @param operationId 稳定操作名。
 * @param summary 接口用途摘要。
 * @param scope 要求的 API Key 权限。
 * @param parameters 路径或查询参数列表。
 * @returns 含统一成功与失败响应的读取操作契约。
 */
function readOperation(tag: string, operationId: string, summary: string, scope: string, parameters: OpenApiParameter[]): OpenApiOperation {
  return operation(tag, operationId, summary, scope, parameters, false, undefined, 200)
}

/**
 * 创建受 API Key 保护的二进制读取操作。
 * @param tag 业务分组。
 * @param operationId 稳定操作名。
 * @param summary 接口摘要。
 * @param scope 所需读取权限。
 * @param parameters 路径参数。
 * @param mediaDescription 成功媒体类型说明。
 * @returns 含二进制成功响应和统一失败响应的操作。
 */
function binaryReadOperation(
  tag: string,
  operationId: string,
  summary: string,
  scope: string,
  parameters: OpenApiParameter[],
  mediaDescription: string,
): OpenApiOperation {
  return {
    tags: [tag], operationId, summary,
    description: `${summary}。权限：\`${scope}\`。成功响应通过 X-Request-Id 返回追踪标识。`,
    security: [{ ApiKeyBearer: [] }],
    'x-required-scope': scope,
    parameters,
    responses: {
      '200': { description: `返回受控二进制内容：${mediaDescription}。` },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '403': { $ref: '#/components/responses/Forbidden' },
      '404': { $ref: '#/components/responses/NotFound' },
      '422': { $ref: '#/components/responses/ValidationFailed' },
      '429': { $ref: '#/components/responses/TooManyRequests' },
    },
  }
}

/** @param tag 业务标签。 @param operationId 稳定操作名。 @param summary 用途。 @param scope 权限。 @param parameters 路径参数。 @param schemaRef 可选请求 Schema。 @param status 成功状态。 @param mediaType 请求媒体类型。 @returns 写操作契约。 */
function writeOperation(
  tag: string,
  operationId: string,
  summary: string,
  scope: string,
  parameters: OpenApiParameter[],
  schemaRef?: string,
  status = 200,
  mediaType = 'application/json',
): OpenApiOperation {
  return operation(tag, operationId, summary, scope, [...parameters, IDEMPOTENCY_PARAMETER], true, schemaRef, status, mediaType)
}

/**
 * 创建限时等待且可用 202 自动降级为异步查询的公共写操作。
 * @param tag 业务标签。
 * @param operationId 稳定操作名。
 * @param summary 接口用途摘要。
 * @param scope 要求的写权限。
 * @param schemaRef 同步优先请求 Schema。
 * @returns 同时声明 200 完成结果和 202 排队结果的写操作。
 * @remarks 幂等记录只固定资源创建，重放时会重新读取同一资源的当前状态。
 */
function synchronousWriteOperation(
  tag: string,
  operationId: string,
  summary: string,
  scope: string,
  schemaRef: string,
): OpenApiOperation {
  const result = writeOperation(tag, operationId, summary, scope, [], schemaRef, 200)
  result.responses['202'] = successResponse(`${summary}并转为异步查询`, operationId)
  result.description = `${summary}。权限：\`${scope}\`。写请求必须提供 Idempotency-Key；同一幂等键只创建一次资源。限时内终止返回 200，超时返回 202 且任务继续执行。`
  return result
}

/** 创建包含统一响应、示例和错误码的单个操作。 */
function operation(
  tag: string,
  operationId: string,
  summary: string,
  scope: string,
  parameters: OpenApiParameter[],
  write: boolean,
  schemaRef: string | undefined,
  status: number,
  mediaType = 'application/json',
): OpenApiOperation {
  const responses: Record<string, OpenApiResponse> = {
    [String(status)]: status === 204 ? { description: `${summary}成功，无响应体。` } : successResponse(summary, operationId),
    '401': { $ref: '#/components/responses/Unauthorized' },
    '403': { $ref: '#/components/responses/Forbidden' },
    '404': { $ref: '#/components/responses/NotFound' },
    '422': { $ref: '#/components/responses/ValidationFailed' },
    '429': { $ref: '#/components/responses/TooManyRequests' },
  }
  if (write) {
    responses['409'] = { $ref: '#/components/responses/Conflict' }
    responses['413'] = { $ref: '#/components/responses/PayloadTooLarge' }
  }
  return {
    tags: [tag],
    operationId,
    summary,
    description: `${summary}。权限：\`${scope}\`${write ? '。写请求必须提供 Idempotency-Key；首次成功结果永久复用。' : ''}`,
    security: [{ ApiKeyBearer: [] }],
    'x-required-scope': scope,
    parameters,
    ...(schemaRef ? { requestBody: { required: true, content: { [mediaType]: { schema: { $ref: schemaRef } } } } } : {}),
    responses,
  }
}

/**
 * 创建与操作实际资源结构绑定的成功响应。
 * @param summary 操作用途。
 * @param operationId 用于定位响应 Schema 的稳定操作名。
 * @returns 包含完整资源字段引用和成功示例的统一响应。
 */
function successResponse(summary: string, operationId: string): OpenApiResponse {
  const responseSchema = RESPONSE_SCHEMA_BY_OPERATION[operationId]
  if (!responseSchema) throw new Error(`公共 API 操作 ${operationId} 缺少成功响应 Schema`)
  return {
    description: `${summary}成功。`,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['data', 'meta'],
          properties: {
            data: { $ref: `#/components/schemas/${responseSchema}` },
            meta: { $ref: '#/components/schemas/ResponseMeta' },
          },
        },
        examples: {
          success: {
            value: {
              data: createSchemaExample({ $ref: `#/components/schemas/${responseSchema}` }, createSchemas()),
              meta: { requestId: 'f9a6d4e0-0000-4000-8000-000000000001', idempotencyReplayed: false },
            },
          },
        },
      },
    },
  }
}

/**
 * 创建公共请求与实际业务响应复用的 Schema 目录。
 * @returns 覆盖人物、世界、资料、灵魂、删除影响和统一元数据的 Schema。
 * @remarks 公共人物详情刻意不声明账号凭据字段。
 */
function createSchemas(): Record<string, Record<string, unknown>> {
  const uuid = { type: 'string', format: 'uuid' }
  const timestamp = { type: 'string', format: 'date-time', description: 'ISO 8601 UTC 时间。' }
  const nullableUuid = { oneOf: [uuid, { type: 'null' }] }
  const nullableString = { type: ['string', 'null'] }
  const sourceProvenanceProperties = {
    originUrl: { type: ['string', 'null'], format: 'uri', maxLength: 2_000, description: '原始来源地址。' },
    authorName: { type: ['string', 'null'], maxLength: 300, description: '作者或发言者。' },
    publishedAt: { type: ['string', 'null'], format: 'date-time', description: '发表或发生时间，ISO 8601 UTC。' },
    originalSourceKey: { type: ['string', 'null'], maxLength: 500, description: '同一作品、访谈或事件跨转载与切片复用的稳定键。' },
  }
  const soul = { type: 'object', required: ['promptText'], properties: { promptText: { type: 'string', minLength: 1, maxLength: 50_000 } } }
  const role = { type: 'string', enum: ['canon_fact', 'reference', 'style_sample'] }
  const sourceSummary = {
    type: 'object',
    required: ['id', 'name', 'role', 'inputType', 'contentHash', 'contentText', 'originalFilePath', 'originUrl', 'authorName', 'publishedAt', 'originalSourceKey', 'isEnabled', 'chunkCount', 'linkCount', 'isGlobal', 'createdAt', 'updatedAt'],
    properties: {
      id: uuid,
      name: { type: 'string' },
      role,
      inputType: { type: 'string', enum: ['paste', 'txt', 'markdown'] },
      contentHash: { type: 'string', description: '规范化正文 SHA-256。' },
      contentText: { type: 'string' },
      originalFilePath: nullableString,
      ...sourceProvenanceProperties,
      isEnabled: { type: 'boolean' },
      chunkCount: { type: 'integer', minimum: 0 },
      linkCount: { type: 'integer', minimum: 0 },
      isGlobal: { type: 'boolean' },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  }
  const personaSummary = {
    type: 'object',
    required: ['id', 'worldId', 'worldName', 'name', 'avatarUrl', 'origin', 'activeVersionId', 'currentSummary', 'isEnabled', 'versionCount', 'sourceCount', 'createdAt', 'updatedAt'],
    properties: {
      id: uuid,
      worldId: nullableUuid,
      worldName: nullableString,
      name: { type: 'string' },
      avatarUrl: nullableString,
      origin: { type: 'string', enum: ['original', 'source_based', 'hybrid'] },
      activeVersionId: nullableUuid,
      currentSummary: nullableString,
      isEnabled: { type: 'boolean' },
      versionCount: { type: 'integer', minimum: 0 },
      sourceCount: { type: 'integer', minimum: 0 },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  }
  const worldSummary = {
    type: 'object',
    required: ['id', 'name', 'summary', 'activeVersionId', 'currentContent', 'isEnabled', 'versionCount', 'personaCount', 'sourceCount', 'createdAt', 'updatedAt'],
    properties: {
      id: uuid,
      name: { type: 'string' },
      summary: { type: 'string' },
      activeVersionId: nullableUuid,
      currentContent: nullableString,
      isEnabled: { type: 'boolean' },
      versionCount: { type: 'integer', minimum: 0 },
      personaCount: { type: 'integer', minimum: 0 },
      sourceCount: { type: 'integer', minimum: 0 },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  }
  const pageProperties = {
    total: { type: 'integer', minimum: 0 },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', enum: [5, 10, 20, 50, 100] },
    totalPages: { type: 'integer', minimum: 1 },
  }
  return {
    ResponseMeta: { type: 'object', required: ['requestId'], properties: { requestId: uuid, idempotencyReplayed: { type: 'boolean' } } },
    ErrorResponse: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message', 'requestId'], properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' }, details: { type: 'object' } } } } },
    PersonaIdentifier: {
      type: 'string', minLength: 1, maxLength: 320,
      description: '人物 UUID、用户名或邮箱；用户名和邮箱忽略大小写及首尾空白。',
    },
    CreatePersona: { type: 'object', required: ['name', 'sourceIds', 'snapshot', 'changeSummary'], properties: { name: { type: 'string', maxLength: 100 }, worldId: { type: ['string', 'null'], format: 'uuid' }, sourceIds: { type: 'array', maxItems: 100, items: { type: 'string', format: 'uuid' } }, snapshot: soul, changeSummary: { type: 'string', maxLength: 500 } } },
    UpdatePersona: { type: 'object', required: ['name', 'worldId'], properties: { name: { type: 'string', maxLength: 100 }, worldId: { type: ['string', 'null'], format: 'uuid' } } },
    PersonaWorldInput: { type: 'object', required: ['worldId'], properties: { worldId: { type: 'string', format: 'uuid' } } },
    CreateWorld: { type: 'object', required: ['name', 'snapshot', 'changeSummary'], properties: { name: { type: 'string', maxLength: 100 }, summary: { type: 'string', maxLength: 2_000, default: '' }, snapshot: soul, changeSummary: { type: 'string', maxLength: 500 } } },
    UpdateWorld: { type: 'object', required: ['name', 'summary'], properties: { name: { type: 'string', maxLength: 100 }, summary: { type: 'string', maxLength: 2_000 } } },
    StatusInput: { type: 'object', required: ['isEnabled'], properties: { isEnabled: { type: 'boolean' } } },
    SoulDraftInput: { type: 'object', required: ['baseVersionId', 'snapshot'], properties: { baseVersionId: { type: ['string', 'null'], format: 'uuid' }, snapshot: soul, autoAnalyze: { type: 'boolean', default: false } } },
    SourceTarget: {
      oneOf: [
        { type: 'object', required: ['targetType', 'targetId'], properties: { targetType: { type: 'string', const: 'persona' }, targetId: { $ref: '#/components/schemas/PersonaIdentifier' } } },
        { type: 'object', required: ['targetType', 'targetId'], properties: { targetType: { type: 'string', const: 'world' }, targetId: { type: 'string', format: 'uuid' } } },
      ],
    },
    CreateSource: {
      type: 'object', required: ['name', 'role', 'content'],
      properties: { name: { type: 'string', maxLength: 200 }, role, content: { type: 'string', maxLength: 2_000_000 }, ...sourceProvenanceProperties, targets: { type: 'array', items: { $ref: '#/components/schemas/SourceTarget' }, default: [] } },
    },
    UpdateSource: {
      type: 'object', required: ['name', 'role', 'content'],
      properties: { name: { type: 'string', maxLength: 200 }, role, content: { type: 'string', maxLength: 2_000_000 }, ...sourceProvenanceProperties },
    },
    SourceLinkInput: {
      oneOf: [
        { type: 'object', required: ['targetType', 'targetId'], properties: { targetType: { type: 'string', const: 'persona' }, targetId: { $ref: '#/components/schemas/PersonaIdentifier' }, priority: { type: 'integer', minimum: 0, maximum: 10_000, default: 100 } } },
        { type: 'object', required: ['targetType', 'targetId'], properties: { targetType: { type: 'string', const: 'world' }, targetId: { type: 'string', format: 'uuid' }, priority: { type: 'integer', minimum: 0, maximum: 10_000, default: 100 } } },
      ],
    },
    SourceFileForm: {
      type: 'object', required: ['file', 'name', 'role'],
      properties: {
        file: { type: 'string', format: 'binary' }, name: { type: 'string', maxLength: 200 }, role,
        originUrl: { type: 'string', format: 'uri', maxLength: 2_000 },
        authorName: { type: 'string', maxLength: 300 },
        publishedAt: { type: 'string', format: 'date-time' },
        originalSourceKey: { type: 'string', maxLength: 500 },
        targets: { type: 'string', description: 'SourceTarget JSON 数组。', default: '[]' },
      },
    },
    CreateGenerationRun: {
      type: 'object', required: ['personaId', 'requirement'],
      properties: {
        personaId: { $ref: '#/components/schemas/PersonaIdentifier' },
        requirement: { type: 'string', minLength: 1, maxLength: 50_000 },
        outputFormat: { type: 'string', enum: ['html', 'text'], default: 'text' },
        imageCount: { type: 'integer', minimum: 0, maximum: 4, default: 0 },
      },
    },
    CreateSynchronousGenerationRun: {
      type: 'object', required: ['personaId', 'requirement'],
      properties: {
        personaId: { $ref: '#/components/schemas/PersonaIdentifier' },
        requirement: { type: 'string', minLength: 1, maxLength: 50_000 },
        outputFormat: { type: 'string', enum: ['html', 'text'], default: 'text' },
        imageCount: { type: 'integer', minimum: 0, maximum: 4, default: 0 },
        waitTimeoutMs: { type: 'integer', minimum: 1_000, maximum: 120_000, default: 120_000, description: '只控制当前 HTTP 请求等待时长，不改变模型调用超时。' },
      },
    },
    CreateInterestBatch: {
      type: 'object', required: ['personaId', 'items'],
      properties: {
        personaId: { $ref: '#/components/schemas/PersonaIdentifier' },
        additionalPrompt: { type: 'string', maxLength: 4_000, default: '', description: '可选；对整批文本生效且不修改人物长期设定。' },
        items: {
          type: 'array', minItems: 1, maxItems: 20,
          items: {
            type: 'object', required: ['itemId', 'text'],
            properties: {
              itemId: { type: 'string', minLength: 1, maxLength: 100 },
              text: { type: 'string', minLength: 1, maxLength: 50_000 },
            },
          },
        },
      },
    },
    CreateSynchronousInterestBatch: {
      type: 'object', required: ['personaId', 'items'],
      properties: {
        personaId: { $ref: '#/components/schemas/PersonaIdentifier' },
        additionalPrompt: { type: 'string', maxLength: 4_000, default: '', description: '可选；对整批文本生效且不修改人物长期设定。' },
        items: {
          type: 'array', minItems: 1, maxItems: 20,
          items: {
            type: 'object', required: ['itemId', 'text'],
            properties: {
              itemId: { type: 'string', minLength: 1, maxLength: 100 },
              text: { type: 'string', minLength: 1, maxLength: 50_000 },
            },
          },
        },
        waitTimeoutMs: { type: 'integer', minimum: 1_000, maximum: 120_000, default: 30_000, description: '只控制当前 HTTP 请求等待时长，不改变模型调用超时。' },
      },
    },
    RenderRun: {
      type: 'object', required: ['formats'],
      properties: { formats: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { type: 'string', enum: ['html', 'markdown', 'txt'] } } },
    },
    PersonaSummary: personaSummary,
    PersonaPage: {
      type: 'object', required: ['items', 'total', 'page', 'pageSize', 'totalPages'],
      properties: { items: { type: 'array', items: { $ref: '#/components/schemas/PersonaSummary' } }, ...pageProperties },
    },
    PersonaVersion: {
      type: 'object', required: ['id', 'personaId', 'parentVersionId', 'status', 'snapshot', 'changeSummary', 'publishedAt', 'createdAt'],
      properties: { id: uuid, personaId: uuid, parentVersionId: nullableUuid, status: { type: 'string', enum: ['published', 'archived', 'rejected'] }, snapshot: soul, changeSummary: { type: 'string' }, publishedAt: timestamp, createdAt: timestamp },
    },
    PersonaDetails: {
      type: 'object', required: ['persona', 'versions', 'draft', 'sources'],
      properties: {
        persona: { $ref: '#/components/schemas/PersonaSummary' },
        versions: { type: 'array', items: { $ref: '#/components/schemas/PersonaVersion' } },
        draft: { oneOf: [{ $ref: '#/components/schemas/SoulDraft' }, { type: 'null' }] },
        sources: { type: 'array', items: { $ref: '#/components/schemas/SourceSummary' } },
      },
    },
    WorldSummary: worldSummary,
    WorldPage: {
      type: 'object', required: ['items', 'total', 'page', 'pageSize', 'totalPages'],
      properties: { items: { type: 'array', items: { $ref: '#/components/schemas/WorldSummary' } }, ...pageProperties },
    },
    WorldVersion: {
      type: 'object', required: ['id', 'worldId', 'parentVersionId', 'status', 'snapshot', 'changeSummary', 'publishedAt', 'createdAt'],
      properties: { id: uuid, worldId: uuid, parentVersionId: nullableUuid, status: { type: 'string', enum: ['published', 'archived', 'rejected'] }, snapshot: soul, changeSummary: { type: 'string' }, publishedAt: timestamp, createdAt: timestamp },
    },
    WorldDetails: {
      type: 'object', required: ['world', 'versions', 'draft', 'personas', 'sources'],
      properties: {
        world: { $ref: '#/components/schemas/WorldSummary' },
        versions: { type: 'array', items: { $ref: '#/components/schemas/WorldVersion' } },
        draft: { oneOf: [{ $ref: '#/components/schemas/SoulDraft' }, { type: 'null' }] },
        personas: { type: 'array', items: { $ref: '#/components/schemas/PersonaSummary' } },
        sources: { type: 'array', items: { $ref: '#/components/schemas/SourceSummary' } },
      },
    },
    SourceSummary: sourceSummary,
    SourcePage: {
      type: 'object', required: ['items', 'total', 'page', 'pageSize', 'totalPages'],
      properties: { items: { type: 'array', items: { $ref: '#/components/schemas/SourceSummary' } }, ...pageProperties },
    },
    SourceChunk: {
      type: 'object', required: ['id', 'sourceId', 'ordinal', 'heading', 'content', 'contentHash'],
      properties: { id: uuid, sourceId: uuid, ordinal: { type: 'integer', minimum: 0 }, heading: nullableString, content: { type: 'string' }, contentHash: { type: 'string' } },
    },
    SourceLink: {
      type: 'object', required: ['id', 'targetType', 'targetId', 'targetName', 'priority'],
      properties: { id: { type: 'string' }, targetType: { type: 'string', enum: ['persona', 'world'] }, targetId: uuid, targetName: { type: 'string' }, priority: { type: 'integer', minimum: 0 } },
    },
    SourceDetails: {
      type: 'object', required: ['source', 'chunks', 'links'],
      properties: {
        source: { $ref: '#/components/schemas/SourceSummary' },
        chunks: { type: 'array', items: { $ref: '#/components/schemas/SourceChunk' } },
        links: { type: 'array', items: { $ref: '#/components/schemas/SourceLink' } },
      },
    },
    SoulDraft: {
      type: 'object', required: ['id', 'subjectType', 'subjectId', 'baseVersionId', 'snapshot', 'changeSummary', 'createdAt', 'updatedAt'],
      properties: { id: uuid, subjectType: { type: 'string', enum: ['world', 'persona'] }, subjectId: uuid, baseVersionId: nullableUuid, snapshot: soul, changeSummary: { type: 'string' }, createdAt: timestamp, updatedAt: timestamp },
    },
    SoulVersion: {
      type: 'object', required: ['id', 'subjectType', 'subjectId', 'parentVersionId', 'status', 'snapshot', 'runtimeTokenCount', 'tokenCounter', 'changeSummary', 'publishedAt', 'createdAt'],
      properties: { id: uuid, subjectType: { type: 'string', enum: ['world', 'persona'] }, subjectId: uuid, parentVersionId: nullableUuid, status: { type: 'string', enum: ['published', 'archived', 'rejected'] }, snapshot: soul, runtimeTokenCount: { type: 'integer', minimum: 0 }, tokenCounter: { type: 'string' }, changeSummary: { type: 'string' }, publishedAt: timestamp, createdAt: timestamp },
    },
    SoulWorkspace: {
      type: 'object', required: ['subjectType', 'subjectId', 'activeVersion', 'draft', 'versions'],
      properties: {
        subjectType: { type: 'string', enum: ['world', 'persona'] }, subjectId: uuid,
        activeVersion: { oneOf: [{ $ref: '#/components/schemas/SoulVersion' }, { type: 'null' }] },
        draft: { oneOf: [{ $ref: '#/components/schemas/SoulDraft' }, { type: 'null' }] },
        versions: { type: 'array', items: { $ref: '#/components/schemas/SoulVersion' } },
      },
    },
    DeletionImpact: {
      type: 'object', required: ['resourceType', 'resourceId', 'canDelete', 'blockers', 'relatedPersonas', 'relatedWorlds', 'relatedSources', 'versionCount', 'runHistory', 'files'],
      properties: {
        resourceType: { type: 'string', enum: ['persona', 'world', 'source'] }, resourceId: uuid, canDelete: { type: 'boolean' }, blockers: { type: 'array', items: { type: 'string' } },
        relatedPersonas: { type: 'array', items: { $ref: '#/components/schemas/NamedResource' } },
        relatedWorlds: { type: 'array', items: { $ref: '#/components/schemas/NamedResource' } },
        relatedSources: { type: 'array', items: { $ref: '#/components/schemas/NamedResource' } },
        versionCount: { type: 'integer', minimum: 0 },
        runHistory: { type: 'object', required: ['runs', 'tasks', 'evidenceSnapshots', 'documentSpecs', 'artifactBlocks', 'blockAttempts'], properties: { runs: { type: 'integer', minimum: 0 }, tasks: { type: 'integer', minimum: 0 }, evidenceSnapshots: { type: 'integer', minimum: 0 }, documentSpecs: { type: 'integer', minimum: 0 }, artifactBlocks: { type: 'integer', minimum: 0 }, blockAttempts: { type: 'integer', minimum: 0 } } },
        files: { type: 'array', items: { type: 'string' } },
      },
    },
    NamedResource: { type: 'object', required: ['id', 'name'], properties: { id: uuid, name: { type: 'string' } } },
    GlobalSources: { type: 'object', required: ['sourceIds', 'addedSourceIds', 'removedSourceIds'], properties: { sourceIds: { type: 'array', items: uuid }, addedSourceIds: { type: 'array', items: uuid }, removedSourceIds: { type: 'array', items: uuid } } },
    DeleteResult: { type: 'object', required: ['id', 'deleted'], properties: { id: uuid, deleted: { type: 'boolean' } } },
    CreatedRun: {
      type: 'object', required: ['runId', 'taskId', 'status'],
      properties: { runId: uuid, taskId: uuid, status: { type: 'string', enum: ['planning', 'queued'] } },
    },
    InterestBatchItem: {
      type: 'object', required: ['itemId', 'runId', 'text', 'status', 'decision', 'probability', 'confidence', 'reason', 'error'],
      properties: {
        itemId: { type: 'string' }, runId: uuid, text: { type: 'string' },
        status: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed'] },
        decision: { type: ['string', 'null'], enum: ['interested', 'not_interested', 'insufficient_information', null] },
        probability: { type: ['number', 'null'], minimum: 0, maximum: 1 },
        confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
        reason: nullableString,
        error: {
          oneOf: [
            { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } },
            { type: 'null' },
          ],
        },
      },
    },
    InterestBatch: {
      type: 'object', required: ['batchId', 'personaId', 'personaName', 'additionalPrompt', 'status', 'items', 'createdAt', 'updatedAt'],
      properties: {
        batchId: uuid, personaId: uuid, personaName: { type: 'string' }, additionalPrompt: { type: 'string' },
        status: { type: 'string', enum: ['queued', 'running', 'completed'] },
        items: { type: 'array', items: { $ref: '#/components/schemas/InterestBatchItem' } },
        createdAt: timestamp, updatedAt: timestamp,
      },
    },
    SynchronousInterestBatch: {
      type: 'object', required: ['mode', 'batch'],
      properties: {
        mode: { type: 'string', enum: ['completed', 'queued'], description: 'completed 返回 200；queued 返回 202。' },
        batch: { $ref: '#/components/schemas/InterestBatch' },
      },
    },
    RunSummary: {
      type: 'object', required: ['id', 'kind', 'personaId', 'personaName', 'status', 'input', 'parameters', 'model', 'contextProvider', 'createdAt', 'updatedAt'],
      properties: {
        id: uuid, kind: { type: 'string', enum: ['interest_assessment', 'artifact_generation'] },
        personaId: uuid, personaName: { type: 'string' },
        status: { type: 'string', enum: ['planning', 'awaiting_confirmation', 'queued', 'running', 'succeeded', 'partial', 'failed', 'canceled'] },
        input: { type: 'object', description: '创建运行时固定的业务输入。' },
        parameters: { type: 'object', description: '运行安全预算快照。' },
        model: { type: 'object', description: '本次运行文章算法使用的非敏感文本模型快照。' },
        imageModel: { oneOf: [{ type: 'object' }, { type: 'null' }] },
        contextProvider: { type: 'string', enum: ['sqlite_fts5', 'openviking'] },
        errorCode: nullableString, errorMessage: nullableString,
        createdAt: timestamp, updatedAt: timestamp, completedAt: { oneOf: [timestamp, { type: 'null' }] },
      },
    },
    RunList: { type: 'array', items: { $ref: '#/components/schemas/RunSummary' } },
    RunDetails: {
      type: 'object', required: ['run', 'evidence', 'documentSpecs', 'blocks', 'tasks'],
      properties: {
        run: { $ref: '#/components/schemas/RunSummary' },
        evidence: { type: 'array', items: { type: 'object' } },
        documentSpecs: { type: 'array', items: { type: 'object' } },
        blocks: { type: 'array', items: { type: 'object' } },
        tasks: { type: 'array', items: { type: 'object' } },
      },
    },
    SynchronousGenerationRun: {
      type: 'object', required: ['mode', 'taskId', 'details', 'result'],
      properties: {
        mode: { type: 'string', enum: ['completed', 'queued'], description: 'completed 返回 200；queued 返回 202。' },
        taskId: uuid,
        details: { $ref: '#/components/schemas/RunDetails' },
        result: { oneOf: [{ $ref: '#/components/schemas/RenderedArtifact' }, { type: 'null' }] },
      },
    },
    RenderedArtifact: {
      type: 'object', required: ['runId', 'documents', 'assets'],
      properties: {
        runId: uuid,
        documents: { type: 'object', description: '按请求格式返回的文档正文。' },
        assets: { type: 'array', items: { type: 'object', description: '文本格式独立返回的图片资产数据。' } },
      },
    },
  }
}

/**
 * 递归从响应 Schema 生成不包含凭据的成功示例。
 * @param schema 当前内联 Schema 或本地组件引用。
 * @param schemas 当前 OpenAPI 文档的 Schema 目录。
 * @param visited 已访问的引用名，用于防止未来循环引用。
 * @returns 与声明类型和字段一致的 JSON 示例。
 */
function createSchemaExample(
  schema: Record<string, unknown>,
  schemas: Record<string, Record<string, unknown>>,
  visited: ReadonlySet<string> = new Set(),
): unknown {
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.replace('#/components/schemas/', '')
    if (visited.has(name)) return null
    const target = schemas[name]
    return target ? createSchemaExample(target, schemas, new Set([...visited, name])) : null
  }
  if (schema.example !== undefined) return schema.example
  if (Array.isArray(schema.oneOf)) {
    const candidate = schema.oneOf.find(item => typeof item === 'object' && item !== null && (item as Record<string, unknown>).type !== 'null')
    return candidate && typeof candidate === 'object' ? createSchemaExample(candidate as Record<string, unknown>, schemas, visited) : null
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  const declaredType = Array.isArray(schema.type)
    ? schema.type.find(item => item !== 'null')
    : schema.type
  if (declaredType === 'object' || (typeof schema.properties === 'object' && schema.properties !== null)) {
    return Object.fromEntries(Object.entries(schema.properties as Record<string, Record<string, unknown>> ?? {})
      .map(([name, property]) => [name, createSchemaExample(property, schemas, visited)]))
  }
  if (declaredType === 'array') {
    const item = typeof schema.items === 'object' && schema.items !== null
      ? createSchemaExample(schema.items as Record<string, unknown>, schemas, visited)
      : null
    return item === null ? [] : [item]
  }
  if (declaredType === 'boolean') return true
  if (declaredType === 'integer' || declaredType === 'number') return typeof schema.minimum === 'number' ? schema.minimum : 1
  if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000001'
  if (schema.format === 'date-time') return '2026-09-01T08:00:00.000Z'
  return '示例文本'
}

/**
 * 创建公共 API 共用的错误响应目录。
 * @returns 包含稳定错误码、可读说明和失败示例的组件。
 * @remarks `429` 为后续实例频率控制预留的稳定契约。
 */
function createErrorResponses(): Record<string, OpenApiResponse> {
  return {
    Unauthorized: errorResponse('API Key 无效、过期或已吊销。', 'API_KEY_INVALID'),
    Forbidden: errorResponse('API Key 权限范围不足。', 'API_SCOPE_INSUFFICIENT'),
    NotFound: errorResponse('目标资源不存在。', 'RESOURCE_NOT_FOUND'),
    Conflict: errorResponse('幂等键冲突、版本冲突或业务状态阻断。', 'IDEMPOTENCY_CONFLICT'),
    PayloadTooLarge: errorResponse('请求正文超过实例允许的字节上限。', 'REQUEST_TOO_LARGE'),
    ValidationFailed: errorResponse('参数或业务校验失败。', 'VALIDATION_FAILED'),
    TooManyRequests: errorResponse('实例启用频率控制后调用过频。', 'RATE_LIMITED'),
  }
}

/** @param description 错误说明。 @param code 稳定错误码。 @returns 与实际错误体一致的失败示例响应。 */
function errorResponse(description: string, code: string): OpenApiResponse {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' },
        examples: { failure: { value: { error: { code, message: description, requestId: 'f9a6d4e0-0000-4000-8000-000000000002' } } } },
      },
    },
  }
}
