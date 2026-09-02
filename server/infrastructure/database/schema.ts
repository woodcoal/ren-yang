import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

/** 唯一管理员表；固定主键约束从数据库层阻止多管理员。 */
export const administrators = sqliteTable(
  'administrators',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    credentialVersion: integer('credential_version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('administrators_username_unique').on(table.username),
    check('administrators_singleton_check', sql`${table.id} = 'administrator'`),
    check('administrators_username_not_empty_check', sql`length(trim(${table.username})) > 0`),
    check('administrators_credential_version_check', sql`${table.credentialVersion} > 0`),
  ],
)

/** 管理员创建的公共 API Key；只保存不可逆摘要和人工辨认前缀。 */
export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyDigest: text('key_digest').notNull(),
    scopesJson: text('scopes_json').notNull(),
    expiresAt: integer('expires_at'),
    lastUsedAt: integer('last_used_at'),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    uniqueIndex('api_keys_digest_unique').on(table.keyDigest),
    index('api_keys_created_at_index').on(table.createdAt),
    check('api_keys_name_check', sql`length(trim(${table.name})) > 0`),
    check('api_keys_prefix_check', sql`length(${table.keyPrefix}) = 12`),
    check('api_keys_digest_check', sql`length(${table.keyDigest}) = 64`),
    check('api_keys_scopes_json_check', sql`json_valid(${table.scopesJson}) AND json_type(${table.scopesJson}) = 'array'`),
  ],
)

/** 公共写请求首次成功结果的永久幂等记录。 */
export const publicApiIdempotencyRecords = sqliteTable(
  'public_api_idempotency_records',
  {
    id: text('id').primaryKey(),
    apiKeyId: text('api_key_id').notNull().references(() => apiKeys.id, { onDelete: 'restrict' }),
    method: text('method').notNull(),
    path: text('path').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseJson: text('response_json'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('public_api_idempotency_identity_unique').on(table.apiKeyId, table.method, table.path, table.idempotencyKey),
    index('public_api_idempotency_created_at_index').on(table.createdAt),
    check('public_api_idempotency_method_check', sql`length(trim(${table.method})) > 0`),
    check('public_api_idempotency_path_check', sql`length(trim(${table.path})) > 0`),
    check('public_api_idempotency_key_check', sql`length(trim(${table.idempotencyKey})) BETWEEN 1 AND 200`),
    check('public_api_idempotency_hash_check', sql`length(${table.requestHash}) = 64`),
    check('public_api_idempotency_response_check', sql`${table.responseJson} IS NULL OR json_valid(${table.responseJson})`),
  ],
)

/** 可按 Key、请求、资源和结果定位的公共 API 脱敏审计。 */
export const publicApiAuditEvents = sqliteTable(
  'public_api_audit_events',
  {
    id: text('id').primaryKey(),
    apiKeyId: text('api_key_id').notNull().references(() => apiKeys.id, { onDelete: 'restrict' }),
    requestId: text('request_id').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    result: text('result').notNull(),
    statusCode: integer('status_code').notNull(),
    errorCode: text('error_code'),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    index('public_api_audit_key_created_at_index').on(table.apiKeyId, table.createdAt),
    index('public_api_audit_created_at_index').on(table.createdAt),
    check('public_api_audit_result_check', sql`${table.result} IN ('succeeded', 'failed')`),
    check('public_api_audit_status_check', sql`${table.statusCode} BETWEEN 100 AND 599`),
  ],
)

/** 管理员关键变更与维护动作的不可变审计记录。 */
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    detailsJson: text('details_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    index('audit_events_created_at_index').on(table.createdAt),
    index('audit_events_action_created_at_index').on(table.action, table.createdAt),
    check('audit_events_actor_check', sql`${table.actor} IN ('administrator', 'maintenance', 'system')`),
    check('audit_events_action_check', sql`length(trim(${table.action})) > 0`),
    check('audit_events_target_type_check', sql`length(trim(${table.targetType})) > 0`),
    check('audit_events_details_json_check', sql`json_valid(${table.detailsJson})`),
  ],
)

/** 管理员可维护的唯一一份系统 AI 当前参数。 */
export const systemAiSettings = sqliteTable(
  'system_ai_settings',
  {
    id: text('id').primaryKey(),
    valuesJson: text('values_json').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    check('system_ai_settings_singleton_check', sql`${table.id} = 'system_ai_settings'`),
    check('system_ai_settings_values_json_check', sql`json_valid(${table.valuesJson})`),
  ],
)

/** 管理员维护的唯一 OpenViking 配置；ADMIN Key 仅保存 AES-GCM 密文。 */
export const openVikingSettings = sqliteTable(
  'openviking_settings',
  {
    id: text('id').primaryKey(),
    enabled: integer('enabled').notNull().default(0),
    endpoint: text('endpoint').notNull().default(''),
    accountId: text('account_id').notNull().default('ren-yang'),
    apiKeyCiphertext: text('api_key_ciphertext').notNull().default(''),
    timeoutMs: integer('timeout_ms').notNull().default(60_000),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    check('openviking_settings_singleton_check', sql`${table.id} = 'openviking_settings'`),
    check('openviking_settings_enabled_check', sql`${table.enabled} IN (0, 1)`),
    check('openviking_settings_account_id_check', sql`length(trim(${table.accountId})) > 0`),
    check('openviking_settings_timeout_check', sql`${table.timeoutMs} BETWEEN 1000 AND 300000`),
  ],
)

/** 管理员维护的 AI 接口连接；访问凭据仅保存 AES-GCM 密文。 */
export const aiConnections = sqliteTable(
  'ai_connections',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    protocol: text('protocol').notNull(),
    endpoint: text('endpoint').notNull(),
    userAgent: text('user_agent').notNull().default(''),
    apiKeyCiphertext: text('api_key_ciphertext').notNull(),
    isEnabled: integer('is_enabled').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('ai_connections_name_unique').on(table.name),
    check('ai_connections_name_check', sql`length(trim(${table.name})) > 0`),
    check('ai_connections_protocol_check', sql`${table.protocol} IN ('openai_compatible')`),
    check('ai_connections_endpoint_check', sql`length(trim(${table.endpoint})) > 0`),
    check('ai_connections_ciphertext_check', sql`length(trim(${table.apiKeyCiphertext})) > 0`),
    check('ai_connections_enabled_check', sql`${table.isEnabled} IN (0, 1)`),
  ],
)

/** 一个 AI 接口连接上可独立选择的文本或图片模型部署。 */
export const aiModelDeployments = sqliteTable(
  'ai_model_deployments',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull().references(() => aiConnections.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    model: text('model').notNull(),
    modality: text('modality').notNull(),
    thinkingControl: text('thinking_control').notNull().default('none'),
    defaultTimeoutMs: integer('default_timeout_ms').notNull().default(60_000),
    isEnabled: integer('is_enabled').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('ai_model_deployments_name_unique').on(table.name),
    index('ai_model_deployments_connection_index').on(table.connectionId, table.modality),
    check('ai_model_deployments_name_check', sql`length(trim(${table.name})) > 0`),
    check('ai_model_deployments_model_check', sql`length(trim(${table.model})) > 0`),
    check('ai_model_deployments_modality_check', sql`${table.modality} IN ('text', 'image')`),
    check('ai_model_deployments_thinking_control_check', sql`${table.thinkingControl} IN ('none', 'enable_thinking', 'reasoning_effort', 'reasoning')`),
    check('ai_model_deployments_default_timeout_check', sql`${table.defaultTimeoutMs} BETWEEN 1000 AND 120000`),
    check('ai_model_deployments_enabled_check', sql`${table.isEnabled} IN (0, 1)`),
  ],
)

/** 同进程 Worker 使用的持久化任务表。 */
export const taskJobs = sqliteTable(
  'task_jobs',
  {
    id: text('id').primaryKey(),
    runId: text('run_id'),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    status: text('status').notNull().default('queued'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(2),
    availableAt: integer('available_at').notNull().default(0),
    leaseUntil: integer('lease_until'),
    heartbeatAt: integer('heartbeat_at'),
    cancelRequestedAt: integer('cancel_requested_at'),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('task_jobs_status_available_at_created_at_index').on(table.status, table.availableAt, table.createdAt),
    index('task_jobs_lease_until_index').on(table.leaseUntil),
    check(
      'task_jobs_status_check',
      sql`${table.status} IN ('queued', 'running', 'succeeded', 'failed', 'cancel_requested', 'canceled')`,
    ),
    check('task_jobs_attempt_count_check', sql`${table.attemptCount} >= 0`),
    check('task_jobs_max_attempts_check', sql`${table.maxAttempts} > 0`),
  ],
)

/** 仅保存尚未送达 OpenViking 的可恢复同步意图；成功或终止后立即删除。 */
export const openVikingSyncOutbox = sqliteTable(
  'openviking_sync_outbox',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    status: text('status').notNull().default('queued'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    availableAt: integer('available_at').notNull().default(0),
    leaseUntil: integer('lease_until'),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('openviking_sync_outbox_status_available_index').on(table.status, table.availableAt, table.createdAt),
    index('openviking_sync_outbox_lease_index').on(table.leaseUntil),
    check('openviking_sync_outbox_type_check', sql`${table.type} IN ('sync_context_source', 'sync_openviking_users', 'sync_openviking_session')`),
    check('openviking_sync_outbox_status_check', sql`${table.status} IN ('queued', 'running')`),
    check('openviking_sync_outbox_attempt_check', sql`${table.attemptCount} >= 0`),
    check('openviking_sync_outbox_max_attempts_check', sql`${table.maxAttempts} > 0`),
  ],
)

/** OpenViking 写入异常时跨进程共享的熔断和恢复时间。 */
export const openVikingSyncRuntime = sqliteTable(
  'openviking_sync_runtime',
  {
    id: text('id').primaryKey(),
    state: text('state').notNull().default('healthy'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    retryAfter: integer('retry_after'),
    lastError: text('last_error'),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    check('openviking_sync_runtime_singleton_check', sql`${table.id} = 'openviking_sync_runtime'`),
    check('openviking_sync_runtime_state_check', sql`${table.state} IN ('healthy', 'degraded')`),
    check('openviking_sync_runtime_failures_check', sql`${table.consecutiveFailures} >= 0`),
  ],
)

/** 可选的世界聚合根。 */
export const worlds = sqliteTable(
  'worlds',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    summary: text('summary').notNull().default(''),
    activeSoulVersionId: text('active_soul_version_id'),
    isEnabled: integer('is_enabled').notNull().default(1),
    automaticLearningEnabled: integer('automatic_learning_enabled').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    check('worlds_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
    check('worlds_enabled_check', sql`${table.isEnabled} IN (0, 1)`),
    check('worlds_automatic_learning_check', sql`${table.automaticLearningEnabled} IN (0, 1)`),
  ],
)

/** 人物聚合根，世界和当前灵魂版本均为可选指针。 */
export const personas = sqliteTable(
  'personas',
  {
    id: text('id').primaryKey(),
    worldId: text('world_id').references(() => worlds.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    username: text('username'),
    email: text('email'),
    passwordCiphertext: text('password_ciphertext'),
    origin: text('origin').notNull(),
    activeSoulVersionId: text('active_soul_version_id'),
    isEnabled: integer('is_enabled').notNull().default(1),
    automaticLearningEnabled: integer('automatic_learning_enabled').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('personas_world_id_index').on(table.worldId),
    uniqueIndex('personas_username_unique').on(table.username),
    uniqueIndex('personas_email_unique').on(table.email),
    check('personas_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
    check('personas_origin_check', sql`${table.origin} IN ('original', 'source_based', 'hybrid')`),
    check('personas_enabled_check', sql`${table.isEnabled} IN (0, 1)`),
    check('personas_automatic_learning_check', sql`${table.automaticLearningEnabled} IN (0, 1)`),
  ],
)

/** 世界或人物当前唯一可编辑的灵魂草稿。 */
export const soulDrafts = sqliteTable(
  'soul_drafts',
  {
    id: text('id').primaryKey(),
    subjectType: text('subject_type').notNull(),
    worldId: text('world_id').references(() => worlds.id, { onDelete: 'cascade' }),
    personaId: text('persona_id').references(() => personas.id, { onDelete: 'cascade' }),
    baseVersionId: text('base_version_id'),
    promptText: text('prompt_text').notNull(),
    changeSummary: text('change_summary').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('soul_drafts_world_unique').on(table.worldId),
    uniqueIndex('soul_drafts_persona_unique').on(table.personaId),
    check('soul_drafts_subject_type_check', sql`${table.subjectType} IN ('world', 'persona')`),
    check('soul_drafts_subject_check', sql`(
      (${table.subjectType} = 'world' AND ${table.worldId} IS NOT NULL AND ${table.personaId} IS NULL)
      OR (${table.subjectType} = 'persona' AND ${table.personaId} IS NOT NULL AND ${table.worldId} IS NULL)
    )`),
    check('soul_drafts_prompt_text_not_empty_check', sql`length(trim(${table.promptText})) > 0`),
  ],
)

/** 世界与人物共用的不可变灵魂版本。 */
export const soulVersions = sqliteTable(
  'soul_versions',
  {
    id: text('id').primaryKey(),
    subjectType: text('subject_type').notNull(),
    worldId: text('world_id').references(() => worlds.id, { onDelete: 'cascade' }),
    personaId: text('persona_id').references(() => personas.id, { onDelete: 'cascade' }),
    parentVersionId: text('parent_version_id'),
    promptText: text('prompt_text').notNull(),
    runtimeTokenCount: integer('runtime_token_count').notNull(),
    tokenCounter: text('token_counter').notNull(),
    changeSummary: text('change_summary').notNull(),
    status: text('status').notNull().default('published'),
    publishedAt: integer('published_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    index('soul_versions_world_created_at_index').on(table.worldId, table.createdAt),
    index('soul_versions_persona_created_at_index').on(table.personaId, table.createdAt),
    check('soul_versions_subject_type_check', sql`${table.subjectType} IN ('world', 'persona')`),
    check('soul_versions_subject_check', sql`(
      (${table.subjectType} = 'world' AND ${table.worldId} IS NOT NULL AND ${table.personaId} IS NULL)
      OR (${table.subjectType} = 'persona' AND ${table.personaId} IS NOT NULL AND ${table.worldId} IS NULL)
    )`),
    check('soul_versions_status_check', sql`${table.status} IN ('published', 'archived', 'rejected')`),
    check('soul_versions_prompt_text_not_empty_check', sql`length(trim(${table.promptText})) > 0`),
    check('soul_versions_runtime_token_count_check', sql`${table.runtimeTokenCount} >= 0`),
  ],
)

/** 用户导入并可复用的事实或风格资料。 */
export const sourceMaterials = sqliteTable(
  'source_materials',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    role: text('role').notNull(),
    inputType: text('input_type').notNull(),
    contentHash: text('content_hash').notNull(),
    contentText: text('content_text').notNull(),
    originalFilePath: text('original_file_path'),
    originUrl: text('origin_url'),
    authorName: text('author_name'),
    publishedAt: integer('published_at'),
    originalSourceKey: text('original_source_key'),
    isEnabled: integer('is_enabled').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('source_materials_created_at_index').on(table.createdAt),
    check('source_materials_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
    check('source_materials_role_check', sql`${table.role} IN ('canon_fact', 'reference', 'style_sample')`),
    check('source_materials_input_type_check', sql`${table.inputType} IN ('paste', 'txt', 'markdown')`),
    check('source_materials_hash_check', sql`length(${table.contentHash}) = 64`),
    check('source_materials_content_not_empty_check', sql`length(trim(${table.contentText})) > 0`),
    check('source_materials_enabled_check', sql`${table.isEnabled} IN (0, 1)`),
  ],
)

/** 资料的确定性文本切片。 */
export const sourceChunks = sqliteTable(
  'source_chunks',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id').notNull().references(() => sourceMaterials.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    heading: text('heading'),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
  },
  table => [
    uniqueIndex('source_chunks_source_ordinal_unique').on(table.sourceId, table.ordinal),
    check('source_chunks_ordinal_check', sql`${table.ordinal} >= 0`),
    check('source_chunks_content_not_empty_check', sql`length(trim(${table.content})) > 0`),
    check('source_chunks_hash_check', sql`length(${table.contentHash}) = 64`),
  ],
)

/** 人物与可复用资料的显式关联。 */
export const personaSources = sqliteTable(
  'persona_sources',
  {
    personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull().references(() => sourceMaterials.id, { onDelete: 'restrict' }),
    priority: integer('priority').notNull().default(100),
  },
  table => [
    uniqueIndex('persona_sources_unique').on(table.personaId, table.sourceId),
    index('persona_sources_source_id_index').on(table.sourceId),
    check('persona_sources_priority_check', sql`${table.priority} >= 0`),
  ],
)

/** 世界与可复用资料的显式关联。 */
export const worldSources = sqliteTable(
  'world_sources',
  {
    worldId: text('world_id').notNull().references(() => worlds.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull().references(() => sourceMaterials.id, { onDelete: 'restrict' }),
    priority: integer('priority').notNull().default(100),
    isEnabled: integer('is_enabled').notNull().default(1),
    enabledAt: integer('enabled_at'),
    disabledAt: integer('disabled_at'),
    updatedAt: integer('updated_at').notNull().default(0),
  },
  table => [
    uniqueIndex('world_sources_unique').on(table.worldId, table.sourceId),
    index('world_sources_source_id_index').on(table.sourceId),
    check('world_sources_priority_check', sql`${table.priority} >= 0`),
    check('world_sources_enabled_check', sql`${table.isEnabled} IN (0, 1)`),
  ],
)

/** 当前 Account 下所有人物和世界共同使用的资料关系。 */
export const globalSources = sqliteTable(
  'global_sources',
  {
    sourceId: text('source_id').primaryKey().references(() => sourceMaterials.id, { onDelete: 'restrict' }),
    priority: integer('priority').notNull().default(100),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    check('global_sources_priority_check', sql`${table.priority} >= 0`),
  ],
)

/** 人物创建前的可审计蒸馏运行。 */
export const personaDistillationRuns = sqliteTable(
  'persona_distillation_runs',
  {
    id: text('id').primaryKey(),
    retryOfRunId: text('retry_of_run_id').references((): AnySQLiteColumn => personaDistillationRuns.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('assessing_sources'),
    requestedName: text('requested_name').notNull(),
    objective: text('objective').notNull(),
    worldId: text('world_id').references(() => worlds.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    coverageSnapshotJson: text('coverage_snapshot_json'),
    algorithmSnapshotJson: text('algorithm_snapshot_json').notNull(),
    rawExtractionJson: text('raw_extraction_json'),
    validatedExtractionJson: text('validated_extraction_json'),
    qualityGateJson: text('quality_gate_json'),
    candidateName: text('candidate_name'),
    candidatePromptText: text('candidate_prompt_text'),
    candidatePromptHash: text('candidate_prompt_hash'),
    evaluatedPromptHash: text('evaluated_prompt_hash'),
    reviewedPromptText: text('reviewed_prompt_text'),
    createdPersonaId: text('created_persona_id').references(() => personas.id, { onDelete: 'set null' }),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    sourceReviewedAt: integer('source_reviewed_at'),
    canceledAt: integer('canceled_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
  },
  table => [
    index('persona_distillation_runs_status_updated_index').on(table.status, table.updatedAt),
    index('persona_distillation_runs_created_persona_index').on(table.createdPersonaId),
    check('persona_distillation_runs_status_check', sql`${table.status} IN ('assessing_sources', 'awaiting_source_review', 'extracting', 'synthesizing', 'evaluating', 'awaiting_candidate_review', 'completed', 'failed', 'canceled')`),
    check('persona_distillation_runs_name_check', sql`length(trim(${table.requestedName})) BETWEEN 1 AND 100`),
    check('persona_distillation_runs_objective_check', sql`length(trim(${table.objective})) BETWEEN 1 AND 20000`),
    check('persona_distillation_runs_provider_check', sql`${table.provider} IN ('sqlite_fts5', 'openviking')`),
    check('persona_distillation_runs_coverage_json_check', sql`${table.coverageSnapshotJson} IS NULL OR json_valid(${table.coverageSnapshotJson})`),
    check('persona_distillation_runs_algorithm_json_check', sql`json_valid(${table.algorithmSnapshotJson})`),
    check('persona_distillation_runs_raw_json_check', sql`${table.rawExtractionJson} IS NULL OR json_valid(${table.rawExtractionJson})`),
    check('persona_distillation_runs_validated_json_check', sql`${table.validatedExtractionJson} IS NULL OR json_valid(${table.validatedExtractionJson})`),
    check('persona_distillation_runs_quality_json_check', sql`${table.qualityGateJson} IS NULL OR json_valid(${table.qualityGateJson})`),
    check('persona_distillation_runs_candidate_hash_check', sql`${table.candidatePromptHash} IS NULL OR length(${table.candidatePromptHash}) = 64`),
    check('persona_distillation_runs_evaluated_hash_check', sql`${table.evaluatedPromptHash} IS NULL OR length(${table.evaluatedPromptHash}) = 64`),
    check('persona_distillation_runs_candidate_check', sql`(${table.candidatePromptText} IS NULL AND ${table.candidatePromptHash} IS NULL) OR (length(trim(${table.candidatePromptText})) > 0 AND length(${table.candidatePromptHash}) = 64)`),
    check('persona_distillation_runs_completed_check', sql`${table.status} <> 'completed' OR (${table.createdPersonaId} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`),
    check('persona_distillation_runs_canceled_check', sql`${table.status} <> 'canceled' OR ${table.canceledAt} IS NOT NULL`),
  ],
)

/** 人物蒸馏实际使用的资料或用户要求快照。 */
export const personaDistillationInputs = sqliteTable(
  'persona_distillation_inputs',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => personaDistillationRuns.id, { onDelete: 'cascade' }),
    inputType: text('input_type').notNull(),
    sourceId: text('source_id').references(() => sourceMaterials.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    sourceRole: text('source_role'),
    sourceRelation: text('source_relation'),
    coverageDimensionsJson: text('coverage_dimensions_json').notNull().default('[]'),
    independentSourceKey: text('independent_source_key'),
    contentHash: text('content_hash').notNull(),
    contentSnapshot: text('content_snapshot'),
    sourceAvailable: integer('source_available').notNull().default(1),
    accepted: integer('accepted').notNull().default(1),
    originUrl: text('origin_url'),
    authorName: text('author_name'),
    publishedAt: integer('published_at'),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    index('persona_distillation_inputs_run_created_index').on(table.runId, table.createdAt),
    index('persona_distillation_inputs_source_index').on(table.sourceId),
    check('persona_distillation_inputs_type_check', sql`${table.inputType} IN ('source_material', 'user_statement')`),
    check('persona_distillation_inputs_name_check', sql`length(trim(${table.name})) > 0`),
    check('persona_distillation_inputs_role_check', sql`${table.sourceRole} IS NULL OR ${table.sourceRole} IN ('canon_fact', 'reference', 'style_sample')`),
    check('persona_distillation_inputs_relation_check', sql`${table.sourceRelation} IS NULL OR ${table.sourceRelation} IN ('subject_authored', 'direct_conversation', 'observed_decision', 'subject_social', 'third_party', 'user_statement')`),
    check('persona_distillation_inputs_dimensions_check', sql`json_valid(${table.coverageDimensionsJson}) AND json_type(${table.coverageDimensionsJson}) = 'array'`),
    check('persona_distillation_inputs_hash_check', sql`length(${table.contentHash}) = 64`),
    check('persona_distillation_inputs_available_check', sql`${table.sourceAvailable} IN (0, 1)`),
    check('persona_distillation_inputs_accepted_check', sql`${table.accepted} IN (0, 1)`),
    check('persona_distillation_inputs_shape_check', sql`(
      (${table.inputType} = 'user_statement' AND ${table.sourceId} IS NULL AND ${table.sourceRole} IS NULL AND ${table.sourceRelation} = 'user_statement' AND ${table.contentSnapshot} IS NOT NULL AND ${table.sourceAvailable} = 1)
      OR (${table.inputType} = 'source_material' AND ${table.sourceRole} IS NOT NULL AND ((${table.sourceId} IS NOT NULL AND ${table.contentSnapshot} IS NOT NULL AND ${table.sourceAvailable} = 1) OR (${table.sourceId} IS NULL AND ${table.contentSnapshot} IS NULL AND ${table.sourceAvailable} = 0)))
    )`),
  ],
)

/** 通过程序校验的人物认知候选。 */
export const personaDistillationClaims = sqliteTable(
  'persona_distillation_claims',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => personaDistillationRuns.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    statement: text('statement').notNull(),
    applicability: text('applicability').notNull(),
    limitations: text('limitations').notNull().default(''),
    basis: text('basis').notNull(),
    confidenceMillionths: integer('confidence_millionths').notNull(),
    independentSourceCount: integer('independent_source_count').notNull(),
    crossContextCount: integer('cross_context_count').notNull(),
    status: text('status').notNull(),
    rejectionReasonsJson: text('rejection_reasons_json').notNull().default('[]'),
    warningsJson: text('warnings_json').notNull().default('[]'),
    conflictsJson: text('conflicts_json').notNull().default('[]'),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    index('persona_distillation_claims_run_category_index').on(table.runId, table.category),
    check('persona_distillation_claims_category_check', sql`${table.category} IN ('mental_model', 'decision_heuristic', 'expression', 'value', 'anti_pattern', 'tension', 'honesty_boundary', 'timeline')`),
    check('persona_distillation_claims_statement_check', sql`length(trim(${table.statement})) > 0`),
    check('persona_distillation_claims_applicability_check', sql`length(trim(${table.applicability})) > 0`),
    check('persona_distillation_claims_basis_check', sql`${table.basis} IN ('explicit', 'observed', 'inferred')`),
    check('persona_distillation_claims_confidence_check', sql`${table.confidenceMillionths} BETWEEN 0 AND 1000000`),
    check('persona_distillation_claims_counts_check', sql`${table.independentSourceCount} >= 0 AND ${table.crossContextCount} >= 0`),
    check('persona_distillation_claims_status_check', sql`${table.status} IN ('valid', 'warning', 'rejected')`),
    check('persona_distillation_claims_rejections_json_check', sql`json_valid(${table.rejectionReasonsJson}) AND json_type(${table.rejectionReasonsJson}) = 'array'`),
    check('persona_distillation_claims_warnings_json_check', sql`json_valid(${table.warningsJson}) AND json_type(${table.warningsJson}) = 'array'`),
    check('persona_distillation_claims_conflicts_json_check', sql`json_valid(${table.conflictsJson}) AND json_type(${table.conflictsJson}) = 'array'`),
  ],
)

/** 人物认知候选引用的精确输入片段。 */
export const personaDistillationEvidence = sqliteTable(
  'persona_distillation_evidence',
  {
    id: text('id').primaryKey(),
    claimId: text('claim_id').notNull().references(() => personaDistillationClaims.id, { onDelete: 'cascade' }),
    inputId: text('input_id').notNull().references(() => personaDistillationInputs.id, { onDelete: 'restrict' }),
    relation: text('relation').notNull(),
    quote: text('quote').notNull(),
    quoteHash: text('quote_hash').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    uniqueIndex('persona_distillation_evidence_unique').on(table.claimId, table.inputId, table.relation, table.quoteHash),
    check('persona_distillation_evidence_relation_check', sql`${table.relation} IN ('supporting', 'opposing')`),
    check('persona_distillation_evidence_quote_check', sql`length(trim(${table.quote})) > 0`),
    check('persona_distillation_evidence_hash_check', sql`length(${table.quoteHash}) = 64`),
  ],
)

/** 与候选正文哈希绑定且只追加的人物蒸馏评测结果。 */
export const personaDistillationEvaluations = sqliteTable(
  'persona_distillation_evaluations',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => personaDistillationRuns.id, { onDelete: 'cascade' }),
    roundNo: integer('round_no').notNull(),
    evaluationType: text('evaluation_type').notNull(),
    candidatePromptHash: text('candidate_prompt_hash').notNull(),
    inputJson: text('input_json').notNull(),
    expectedJson: text('expected_json').notNull(),
    outputJson: text('output_json').notNull(),
    status: text('status').notNull(),
    scoreMillionths: integer('score_millionths'),
    failureReasonsJson: text('failure_reasons_json').notNull().default('[]'),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    uniqueIndex('persona_distillation_evaluations_run_round_type_unique').on(table.runId, table.roundNo, table.evaluationType),
    check('persona_distillation_evaluations_round_check', sql`${table.roundNo} > 0`),
    check('persona_distillation_evaluations_type_check', sql`${table.evaluationType} IN ('known_fact', 'decision_tendency', 'unknown_boundary', 'expression', 'counterfactual', 'conflict_handling')`),
    check('persona_distillation_evaluations_hash_check', sql`length(${table.candidatePromptHash}) = 64`),
    check('persona_distillation_evaluations_input_json_check', sql`json_valid(${table.inputJson})`),
    check('persona_distillation_evaluations_expected_json_check', sql`json_valid(${table.expectedJson})`),
    check('persona_distillation_evaluations_output_json_check', sql`json_valid(${table.outputJson})`),
    check('persona_distillation_evaluations_status_check', sql`${table.status} IN ('passed', 'warning', 'failed')`),
    check('persona_distillation_evaluations_score_check', sql`${table.scoreMillionths} IS NULL OR ${table.scoreMillionths} BETWEEN 0 AND 1000000`),
    check('persona_distillation_evaluations_failures_json_check', sql`json_valid(${table.failureReasonsJson}) AND json_type(${table.failureReasonsJson}) = 'array'`),
  ],
)

/** 人物明确用于成长分析的反馈原始资料。 */
export const personaFeedbackSources = sqliteTable(
  'persona_feedback_sources',
  {
    id: text('id').primaryKey(),
    personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id'),
    isEnabled: integer('is_enabled').notNull().default(1),
    contentHash: text('content_hash').notNull(),
    deletionState: text('deletion_state').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('persona_feedback_sources_persona_enabled_index').on(table.personaId, table.isEnabled, table.createdAt),
    check('persona_feedback_sources_title_check', sql`length(trim(${table.title})) > 0`),
    check('persona_feedback_sources_content_check', sql`length(trim(${table.content})) > 0`),
    check('persona_feedback_sources_source_type_check', sql`${table.sourceType} IN ('run_feedback', 'manual', 'imported', 'memory_conversion')`),
    check('persona_feedback_sources_enabled_check', sql`${table.isEnabled} IN (0, 1)`),
    check('persona_feedback_sources_hash_check', sql`length(${table.contentHash}) = 64`),
    check('persona_feedback_sources_deletion_state_check', sql`${table.deletionState} IN ('active', 'pending_remote_delete')`),
  ],
)

/** 世界与人物共用的成长原始素材快照。 */
export const growthMaterials = sqliteTable(
  'growth_materials',
  {
    id: text('id').primaryKey(),
    subjectType: text('subject_type').notNull(),
    worldId: text('world_id').references(() => worlds.id, { onDelete: 'cascade' }),
    personaId: text('persona_id').references(() => personas.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    contentSnapshot: text('content_snapshot').notNull(),
    contentHash: text('content_hash').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id'),
    sourceHash: text('source_hash'),
    importance: integer('importance').notNull().default(3),
    isEnabled: integer('is_enabled').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('growth_materials_world_enabled_index').on(table.worldId, table.isEnabled, table.updatedAt),
    index('growth_materials_persona_enabled_index').on(table.personaId, table.isEnabled, table.updatedAt),
    uniqueIndex('growth_materials_world_source_unique')
      .on(table.worldId, table.sourceId)
      .where(sql`${table.subjectType} = 'world' AND ${table.sourceType} = 'source_material'`),
    uniqueIndex('growth_materials_persona_source_unique')
      .on(table.personaId, table.sourceId)
      .where(sql`${table.subjectType} = 'persona' AND ${table.sourceType} = 'source_material'`),
    check('growth_materials_subject_type_check', sql`${table.subjectType} IN ('world', 'persona')`),
    check('growth_materials_subject_check', sql`(
      (${table.subjectType} = 'world' AND ${table.worldId} IS NOT NULL AND ${table.personaId} IS NULL)
      OR (${table.subjectType} = 'persona' AND ${table.personaId} IS NOT NULL AND ${table.worldId} IS NULL)
    )`),
    check('growth_materials_title_check', sql`length(trim(${table.title})) > 0`),
    check('growth_materials_content_check', sql`length(trim(${table.contentSnapshot})) > 0`),
    check('growth_materials_hash_check', sql`length(${table.contentHash}) = 64`),
    check('growth_materials_source_type_check', sql`${table.sourceType} IN ('source_material', 'manual', 'legacy')`),
    check('growth_materials_source_check', sql`(
      (${table.sourceType} = 'source_material' AND ${table.sourceId} IS NOT NULL AND ${table.sourceHash} IS NOT NULL)
      OR ${table.sourceType} IN ('manual', 'legacy')
    )`),
    check('growth_materials_importance_check', sql`${table.importance} BETWEEN 1 AND 5`),
    check('growth_materials_enabled_check', sql`${table.isEnabled} IN (0, 1)`),
  ],
)

/** 世界与人物共用的逻辑成长记录。 */
export const growthRecords = sqliteTable(
  'growth_records',
  {
    id: text('id').primaryKey(),
    subjectType: text('subject_type').notNull(),
    worldId: text('world_id').references(() => worlds.id, { onDelete: 'cascade' }),
    personaId: text('persona_id').references(() => personas.id, { onDelete: 'cascade' }),
    currentRevisionId: text('current_revision_id').notNull(),
    status: text('status').notNull().default('candidate'),
    supersededById: text('superseded_by_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('growth_records_world_status_index').on(table.worldId, table.status, table.updatedAt),
    index('growth_records_persona_status_index').on(table.personaId, table.status, table.updatedAt),
    check('growth_records_subject_type_check', sql`${table.subjectType} IN ('world', 'persona')`),
    check('growth_records_subject_check', sql`(
      (${table.subjectType} = 'world' AND ${table.worldId} IS NOT NULL AND ${table.personaId} IS NULL)
      OR (${table.subjectType} = 'persona' AND ${table.personaId} IS NOT NULL AND ${table.worldId} IS NULL)
    )`),
    check('growth_records_status_check', sql`${table.status} IN ('candidate', 'active', 'superseded', 'archived', 'rejected')`),
  ],
)

/** 成长正文与适用范围的不可变修订。 */
export const growthRevisions = sqliteTable(
  'growth_revisions',
  {
    id: text('id').primaryKey(),
    growthId: text('growth_id').notNull().references(() => growthRecords.id, { onDelete: 'cascade' }),
    revisionNo: integer('revision_no').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    scope: text('scope').notNull(),
    importance: integer('importance').notNull(),
    conflictSummary: text('conflict_summary'),
    analysisBatchId: text('analysis_batch_id'),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    uniqueIndex('growth_revisions_growth_revision_unique').on(table.growthId, table.revisionNo),
    check('growth_revisions_revision_check', sql`${table.revisionNo} > 0`),
    check('growth_revisions_content_check', sql`length(trim(${table.content})) > 0`),
    check('growth_revisions_hash_check', sql`length(${table.contentHash}) = 64`),
    check('growth_revisions_scope_check', sql`length(trim(${table.scope})) > 0`),
    check('growth_revisions_importance_check', sql`${table.importance} BETWEEN 1 AND 5`),
    check('growth_revisions_created_by_check', sql`${table.createdBy} IN ('user', 'analysis')`),
  ],
)

/** 成长修订与原始资料之间的证据关系。 */
export const growthRevisionEvidence = sqliteTable(
  'growth_revision_evidence',
  {
    id: text('id').primaryKey(),
    growthRevisionId: text('growth_revision_id').notNull().references(() => growthRevisions.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    sourceHash: text('source_hash').notNull(),
    sourceTitle: text('source_title').notNull(),
    relationship: text('relationship').notNull(),
    sourceAvailable: integer('source_available').notNull().default(1),
  },
  table => [
    uniqueIndex('growth_revision_evidence_unique').on(table.growthRevisionId, table.sourceType, table.sourceId),
    check('growth_revision_evidence_source_type_check', sql`${table.sourceType} IN ('world_source', 'persona_feedback_source')`),
    check('growth_revision_evidence_relationship_check', sql`${table.relationship} IN ('supporting', 'opposing')`),
    check('growth_revision_evidence_available_check', sql`${table.sourceAvailable} IN (0, 1)`),
  ],
)

/** 不可变格式模板版本。 */
export const formatTemplates = sqliteTable(
  'format_templates',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    version: integer('version').notNull(),
    specJson: text('spec_json').notNull(),
    isActive: integer('is_active').notNull().default(1),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    uniqueIndex('format_templates_name_version_unique').on(table.name, table.version),
    check('format_templates_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
    check('format_templates_version_check', sql`${table.version} > 0`),
    check('format_templates_active_check', sql`${table.isActive} IN (0, 1)`),
  ],
)

/** 不可变文本模型参数方案版本。 */
export const parameterProfiles = sqliteTable(
  'parameter_profiles',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    version: integer('version').notNull(),
    scope: text('scope').notNull().default('system'),
    valuesJson: text('values_json').notNull(),
    isActive: integer('is_active').notNull().default(1),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    uniqueIndex('parameter_profiles_name_version_unique').on(table.name, table.version),
    check('parameter_profiles_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
    check('parameter_profiles_version_check', sql`${table.version} > 0`),
    check('parameter_profiles_scope_check', sql`${table.scope} IN ('system', 'persona', 'template')`),
    check('parameter_profiles_active_check', sql`${table.isActive} IN (0, 1)`),
  ],
)

/** 全站 AI 提示词的固定业务定义与当前发布版本指针。 */
export const aiPrompts = sqliteTable(
  'ai_prompts',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    description: text('description').notNull(),
    kind: text('kind').notNull(),
    variablesJson: text('variables_json').notNull(),
    activeVersionId: text('active_version_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('ai_prompts_category_name_index').on(table.category, table.name),
    check('ai_prompts_code_check', sql`length(trim(${table.code})) > 0`),
    check('ai_prompts_name_check', sql`length(trim(${table.name})) > 0`),
    check('ai_prompts_kind_check', sql`${table.kind} IN ('text', 'image')`),
    check('ai_prompts_variables_json_check', sql`json_valid(${table.variablesJson})`),
  ],
)

/** 已发布且不可变的全站 AI 提示词版本。 */
export const aiPromptVersions = sqliteTable(
  'ai_prompt_versions',
  {
    id: text('id').primaryKey(),
    promptCode: text('prompt_code').notNull().references(() => aiPrompts.code, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    systemPromptTemplate: text('system_prompt_template'),
    userPromptTemplate: text('user_prompt_template').notNull(),
    variableContractJson: text('variable_contract_json'),
    variableContractHash: text('variable_contract_hash'),
    changeSummary: text('change_summary').notNull(),
    publishedAt: integer('published_at').notNull(),
  },
  table => [
    uniqueIndex('ai_prompt_versions_code_number_unique').on(table.promptCode, table.versionNo),
    index('ai_prompt_versions_code_published_index').on(table.promptCode, table.publishedAt),
    check('ai_prompt_versions_number_check', sql`${table.versionNo} > 0`),
    check('ai_prompt_versions_user_template_check', sql`length(trim(${table.userPromptTemplate})) > 0`),
    check('ai_prompt_versions_variable_contract_json_check', sql`${table.variableContractJson} IS NULL OR json_valid(${table.variableContractJson})`),
    check('ai_prompt_versions_variable_contract_hash_check', sql`${table.variableContractHash} IS NULL OR length(${table.variableContractHash}) = 64`),
    check('ai_prompt_versions_summary_check', sql`length(trim(${table.changeSummary})) > 0`),
  ],
)

/** 发布前唯一可编辑的全站 AI 提示词草稿。 */
export const aiPromptDrafts = sqliteTable(
  'ai_prompt_drafts',
  {
    id: text('id').primaryKey(),
    promptCode: text('prompt_code').notNull().references(() => aiPrompts.code, { onDelete: 'cascade' }),
    baseVersionId: text('base_version_id'),
    systemPromptTemplate: text('system_prompt_template'),
    userPromptTemplate: text('user_prompt_template').notNull(),
    changeSummary: text('change_summary').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('ai_prompt_drafts_code_unique').on(table.promptCode),
    check('ai_prompt_drafts_user_template_check', sql`length(trim(${table.userPromptTemplate})) > 0`),
    check('ai_prompt_drafts_summary_check', sql`length(trim(${table.changeSummary})) > 0`),
  ],
)

/** 代码内固定流程的 AI 算法定义与当前配置版本指针。 */
export const aiAlgorithms = sqliteTable(
  'ai_algorithms',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    implementationVersion: integer('implementation_version').notNull(),
    activeConfigurationVersionId: text('active_configuration_version_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    check('ai_algorithms_code_check', sql`${table.code} IN ('persona_soul', 'world_soul', 'persona_growth', 'world_growth', 'persona_memory', 'persona_draft', 'world_draft', 'feedback_classification', 'persona_avatar', 'interest_assessment', 'article_generation', 'article_image_analysis', 'article_text_revision', 'article_image_generation')`),
    check('ai_algorithms_name_check', sql`length(trim(${table.name})) > 0`),
    check('ai_algorithms_implementation_version_check', sql`${table.implementationVersion} > 0`),
  ],
)

/** 算法每次完整保存形成的不可变配置版本。 */
export const aiAlgorithmConfigurationVersions = sqliteTable(
  'ai_algorithm_configuration_versions',
  {
    id: text('id').primaryKey(),
    algorithmCode: text('algorithm_code').notNull().references(() => aiAlgorithms.code, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    uniqueIndex('ai_algorithm_configuration_versions_unique').on(table.algorithmCode, table.versionNo),
    check('ai_algorithm_configuration_versions_number_check', sql`${table.versionNo} > 0`),
  ],
)

/** 一个算法配置版本内按固定顺序绑定的模型、提示词和参数。 */
export const aiAlgorithmStepConfigurations = sqliteTable(
  'ai_algorithm_step_configurations',
  {
    id: text('id').primaryKey(),
    configurationVersionId: text('configuration_version_id').notNull().references(() => aiAlgorithmConfigurationVersions.id, { onDelete: 'cascade' }),
    stepKey: text('step_key').notNull(),
    ordinal: integer('ordinal').notNull(),
    modelDeploymentId: text('model_deployment_id').references(() => aiModelDeployments.id, { onDelete: 'restrict' }),
    promptCode: text('prompt_code').notNull().references(() => aiPrompts.code, { onDelete: 'restrict' }),
    parametersJson: text('parameters_json').notNull(),
  },
  table => [
    uniqueIndex('ai_algorithm_step_configurations_key_unique').on(table.configurationVersionId, table.stepKey),
    uniqueIndex('ai_algorithm_step_configurations_ordinal_unique').on(table.configurationVersionId, table.ordinal),
    check('ai_algorithm_step_configurations_key_check', sql`length(trim(${table.stepKey})) > 0`),
    check('ai_algorithm_step_configurations_ordinal_check', sql`${table.ordinal} >= 0`),
    check('ai_algorithm_step_configurations_parameters_check', sql`json_valid(${table.parametersJson})`),
  ],
)

/** 兴趣判断或文档生成的一次可追溯运行。 */
export const generationRuns = sqliteTable(
  'generation_runs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    personaVersionId: text('persona_version_id').notNull().references(() => soulVersions.id, { onDelete: 'restrict' }),
    formatTemplateId: text('format_template_id').references(() => formatTemplates.id, { onDelete: 'restrict' }),
    parameterProfileId: text('parameter_profile_id').references(() => parameterProfiles.id, { onDelete: 'restrict' }),
    status: text('status').notNull(),
    inputJson: text('input_json').notNull(),
    sceneJson: text('scene_json'),
    parameterSnapshotJson: text('parameter_snapshot_json').notNull(),
    modelSnapshotJson: text('model_snapshot_json').notNull(),
    imageModelSnapshotJson: text('image_model_snapshot_json'),
    promptVersion: text('prompt_version').notNull(),
    contextProvider: text('context_provider').notNull(),
    promptContextSnapshotJson: text('prompt_context_snapshot_json'),
    algorithmSnapshotJson: text('algorithm_snapshot_json'),
    interestAlgorithmSnapshotJson: text('interest_algorithm_snapshot_json'),
    resultJson: text('result_json'),
    usageJson: text('usage_json'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
  },
  table => [
    index('generation_runs_persona_version_created_at_index').on(table.personaVersionId, table.createdAt),
    index('generation_runs_status_created_at_index').on(table.status, table.createdAt),
    check('generation_runs_kind_check', sql`${table.kind} IN ('interest_assessment', 'artifact_generation')`),
    check(
      'generation_runs_status_check',
      sql`${table.status} IN ('planning', 'awaiting_confirmation', 'queued', 'running', 'succeeded', 'partial', 'failed', 'canceled')`,
    ),
    check('generation_runs_context_provider_check', sql`${table.contextProvider} IN ('sqlite_fts5', 'openviking')`),
    check('generation_runs_prompt_context_json_check', sql`${table.promptContextSnapshotJson} IS NULL OR json_valid(${table.promptContextSnapshotJson})`),
    check('generation_runs_algorithm_json_check', sql`${table.algorithmSnapshotJson} IS NULL OR json_valid(${table.algorithmSnapshotJson})`),
    check('generation_runs_interest_algorithm_json_check', sql`${table.interestAlgorithmSnapshotJson} IS NULL OR json_valid(${table.interestAlgorithmSnapshotJson})`),
  ],
)

/** 同一人物一次模型调用处理的兴趣判定批次。 */
export const interestBatches = sqliteTable(
  'interest_batches',
  {
    id: text('id').primaryKey(),
    personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
    usageJson: text('usage_json'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('interest_batches_persona_created_at_index').on(table.personaId, table.createdAt),
    check('interest_batches_usage_json_check', sql`${table.usageJson} IS NULL OR json_valid(${table.usageJson})`),
  ],
)

/** 兴趣批次内客户端编号、输入顺序与独立运行的稳定关联。 */
export const interestBatchItems = sqliteTable(
  'interest_batch_items',
  {
    batchId: text('batch_id').notNull().references(() => interestBatches.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    runId: text('run_id').notNull().references(() => generationRuns.id, { onDelete: 'cascade' }),
  },
  table => [
    primaryKey({ columns: [table.batchId, table.itemId] }),
    uniqueIndex('interest_batch_items_ordinal_unique').on(table.batchId, table.ordinal),
    uniqueIndex('interest_batch_items_run_unique').on(table.runId),
    check('interest_batch_items_id_check', sql`length(trim(${table.itemId})) > 0`),
    check('interest_batch_items_ordinal_check', sql`${table.ordinal} >= 0`),
  ],
)

/** 人物执行任务后形成的记忆原始处理记录。 */
export const personaOperationRecords = sqliteTable(
  'persona_operation_records',
  {
    id: text('id').primaryKey(),
    personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
    runId: text('run_id').notNull().references(() => generationRuns.id, { onDelete: 'cascade' }),
    operationType: text('operation_type').notNull(),
    resultSummary: text('result_summary').notNull(),
    decisionJson: text('decision_json'),
    isEnabled: integer('is_enabled').notNull().default(1),
    contextSnapshotJson: text('context_snapshot_json').notNull(),
    sessionRecordId: text('session_record_id'),
    importance: integer('importance').notNull().default(3),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('persona_operation_records_run_unique').on(table.runId),
    index('persona_operation_records_persona_enabled_index').on(table.personaId, table.isEnabled, table.createdAt),
    check('persona_operation_records_type_check', sql`${table.operationType} IN ('interest_assessment', 'artifact_generation', 'content_analysis')`),
    check('persona_operation_records_summary_check', sql`length(trim(${table.resultSummary})) > 0`),
    check('persona_operation_records_enabled_check', sql`${table.isEnabled} IN (0, 1)`),
    check('persona_operation_records_decision_json_check', sql`${table.decisionJson} IS NULL OR json_valid(${table.decisionJson})`),
    check('persona_operation_records_context_json_check', sql`json_valid(${table.contextSnapshotJson})`),
    check('persona_operation_records_importance_check', sql`${table.importance} BETWEEN 1 AND 5`),
  ],
)

/** 管理员为人物补充、可参与记忆提炼的第三方经历记录。 */
export const personaExternalRecords = sqliteTable(
  'persona_external_records',
  {
    id: text('id').primaryKey(),
    personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
    occurredOn: text('occurred_on').notNull(),
    content: text('content').notNull(),
    referencesJson: text('references_json').notNull().default('[]'),
    isEnabled: integer('is_enabled').notNull().default(1),
    importance: integer('importance').notNull().default(3),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('persona_external_records_persona_enabled_index').on(table.personaId, table.isEnabled, table.occurredOn),
    check('persona_external_records_occurred_on_check', sql`length(${table.occurredOn}) = 10`),
    check('persona_external_records_content_check', sql`length(trim(${table.content})) > 0`),
    check('persona_external_records_references_json_check', sql`json_valid(${table.referencesJson})`),
    check('persona_external_records_enabled_check', sql`${table.isEnabled} IN (0, 1)`),
    check('persona_external_records_importance_check', sql`${table.importance} BETWEEN 1 AND 5`),
  ],
)

/** 人物逻辑记忆及其当前不可变修订指针。 */
export const memoryRecords = sqliteTable(
  'memory_records',
  {
    id: text('id').primaryKey(),
    personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
    currentRevisionId: text('current_revision_id').notNull(),
    memoryType: text('memory_type').notNull(),
    status: text('status').notNull().default('candidate'),
    supersededById: text('superseded_by_id'),
    openVikingUri: text('openviking_uri'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('memory_records_persona_status_index').on(table.personaId, table.status, table.updatedAt),
    uniqueIndex('memory_records_openviking_uri_unique').on(table.openVikingUri),
    check('memory_records_type_check', sql`${table.memoryType} IN ('interest', 'judgment', 'experience', 'preference')`),
    check('memory_records_status_check', sql`${table.status} IN ('candidate', 'active', 'superseded', 'archived', 'rejected')`),
  ],
)

/** 记忆正文和证据统计的不可变修订。 */
export const memoryRevisions = sqliteTable(
  'memory_revisions',
  {
    id: text('id').primaryKey(),
    memoryId: text('memory_id').notNull().references(() => memoryRecords.id, { onDelete: 'cascade' }),
    revisionNo: integer('revision_no').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    scope: text('scope').notNull(),
    importance: integer('importance').notNull(),
    occurredFrom: integer('occurred_from'),
    occurredTo: integer('occurred_to'),
    independentEvidenceCount: integer('independent_evidence_count').notNull(),
    conflictSummary: text('conflict_summary'),
    analysisBatchId: text('analysis_batch_id'),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    uniqueIndex('memory_revisions_memory_revision_unique').on(table.memoryId, table.revisionNo),
    check('memory_revisions_revision_check', sql`${table.revisionNo} > 0`),
    check('memory_revisions_content_check', sql`length(trim(${table.content})) > 0`),
    check('memory_revisions_hash_check', sql`length(${table.contentHash}) = 64`),
    check('memory_revisions_scope_check', sql`length(trim(${table.scope})) > 0`),
    check('memory_revisions_importance_check', sql`${table.importance} BETWEEN 1 AND 5`),
    check('memory_revisions_evidence_count_check', sql`${table.independentEvidenceCount} >= 0`),
    check('memory_revisions_created_by_check', sql`${table.createdBy} IN ('user', 'analysis')`),
  ],
)

/** 记忆修订与人物处理记录之间的证据关系。 */
export const memoryRevisionEvidence = sqliteTable(
  'memory_revision_evidence',
  {
    id: text('id').primaryKey(),
    memoryRevisionId: text('memory_revision_id').notNull().references(() => memoryRevisions.id, { onDelete: 'cascade' }),
    operationRecordId: text('operation_record_id').notNull().references(() => personaOperationRecords.id, { onDelete: 'restrict' }),
    runId: text('run_id').notNull(),
    relationship: text('relationship').notNull(),
  },
  table => [
    uniqueIndex('memory_revision_evidence_unique').on(table.memoryRevisionId, table.operationRecordId),
    check('memory_revision_evidence_relationship_check', sql`${table.relationship} IN ('supporting', 'opposing')`),
  ],
)

/** 一次世界成长、人物成长或人物记忆分析的固定输入与执行状态。 */
export const analysisBatches = sqliteTable(
  'analysis_batches',
  {
    id: text('id').primaryKey(),
    analysisType: text('analysis_type').notNull(),
    worldId: text('world_id').references(() => worlds.id, { onDelete: 'cascade' }),
    personaId: text('persona_id').references(() => personas.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    baselineSoulVersionId: text('baseline_soul_version_id').notNull().references(() => soulVersions.id, { onDelete: 'restrict' }),
    baselineLearningPromptVersionId: text('baseline_learning_prompt_version_id'),
    baselineLearningPromptHash: text('baseline_learning_prompt_hash'),
    baselineJson: text('baseline_json').notNull(),
    modelSnapshotJson: text('model_snapshot_json').notNull(),
    parameterSnapshotJson: text('parameter_snapshot_json').notNull(),
    promptVersion: text('prompt_version').notNull(),
    algorithmSnapshotJson: text('algorithm_snapshot_json'),
    rawResultJson: text('raw_result_json'),
    extractionResultJson: text('extraction_result_json'),
    validatedFactsJson: text('validated_facts_json'),
    status: text('status').notNull().default('queued'),
    autoPublish: integer('auto_publish').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
  },
  table => [
    index('analysis_batches_world_type_created_index').on(table.worldId, table.analysisType, table.createdAt),
    index('analysis_batches_persona_type_created_index').on(table.personaId, table.analysisType, table.createdAt),
    check('analysis_batches_type_check', sql`${table.analysisType} IN ('world_growth', 'persona_growth', 'persona_memory')`),
    check('analysis_batches_subject_check', sql`(
      (${table.analysisType} = 'world_growth' AND ${table.worldId} IS NOT NULL AND ${table.personaId} IS NULL)
      OR (${table.analysisType} IN ('persona_growth', 'persona_memory') AND ${table.personaId} IS NOT NULL AND ${table.worldId} IS NULL)
    )`),
    check('analysis_batches_mode_check', sql`${table.mode} IN ('incremental', 'full_rebuild')`),
    check('analysis_batches_status_check', sql`${table.status} IN ('queued', 'running', 'awaiting_review', 'completed', 'failed')`),
    check('analysis_batches_auto_publish_check', sql`${table.autoPublish} IN (0, 1)`),
    check('analysis_batches_baseline_json_check', sql`json_valid(${table.baselineJson})`),
    check('analysis_batches_model_json_check', sql`json_valid(${table.modelSnapshotJson})`),
    check('analysis_batches_parameter_json_check', sql`json_valid(${table.parameterSnapshotJson})`),
    check('analysis_batches_algorithm_json_check', sql`${table.algorithmSnapshotJson} IS NULL OR json_valid(${table.algorithmSnapshotJson})`),
    check('analysis_batches_raw_json_check', sql`${table.rawResultJson} IS NULL OR json_valid(${table.rawResultJson})`),
    check('analysis_batches_baseline_prompt_hash_check', sql`${table.baselineLearningPromptHash} IS NULL OR length(${table.baselineLearningPromptHash}) = 64`),
    check('analysis_batches_extraction_json_check', sql`${table.extractionResultJson} IS NULL OR json_valid(${table.extractionResultJson})`),
    check('analysis_batches_validated_facts_json_check', sql`${table.validatedFactsJson} IS NULL OR json_valid(${table.validatedFactsJson})`),
  ],
)

/** 管理员统一维护的学习自动化周期和下次扫描时间。 */
export const learningAutomationSettings = sqliteTable(
  'learning_automation_settings',
  {
    id: text('id').primaryKey(),
    intervalHours: integer('interval_hours').notNull().default(24),
    nextRunAt: integer('next_run_at').notNull().default(0),
    lastRunAt: integer('last_run_at'),
    updatedAt: integer('updated_at').notNull().default(0),
  },
  table => [
    check('learning_automation_settings_singleton_check', sql`${table.id} = 'learning_automation_settings'`),
    check('learning_automation_settings_interval_check', sql`${table.intervalHours} BETWEEN 1 AND 720`),
  ],
)

/** 分析批次实际使用的不可变原始输入快照。 */
export const analysisBatchInputs = sqliteTable(
  'analysis_batch_inputs',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull().references(() => analysisBatches.id, { onDelete: 'cascade' }),
    inputType: text('input_type').notNull(),
    inputId: text('input_id').notNull(),
    contentHash: text('content_hash').notNull(),
    title: text('title').notNull(),
    contentSnapshot: text('content_snapshot'),
    importance: integer('importance').notNull().default(3),
    isNew: integer('is_new').notNull().default(1),
    sourceAvailable: integer('source_available').notNull().default(1),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    uniqueIndex('analysis_batch_inputs_unique').on(table.batchId, table.inputType, table.inputId),
    index('analysis_batch_inputs_source_index').on(table.inputType, table.inputId),
    check('analysis_batch_inputs_type_check', sql`${table.inputType} IN ('growth_material', 'persona_operation_record', 'persona_external_record', 'world_source', 'persona_feedback_source', 'openviking_memory')`),
    check('analysis_batch_inputs_hash_check', sql`length(${table.contentHash}) = 64`),
    check('analysis_batch_inputs_importance_check', sql`${table.importance} BETWEEN 1 AND 5`),
    check('analysis_batch_inputs_new_check', sql`${table.isNew} IN (0, 1)`),
    check('analysis_batch_inputs_available_check', sql`${table.sourceAvailable} IN (0, 1)`),
  ],
)

/** AI 生成且必须人工审核的成长或记忆迭代提案。 */
export const iterationProposals = sqliteTable(
  'iteration_proposals',
  {
    id: text('id').primaryKey(),
    analysisBatchId: text('analysis_batch_id').notNull().references(() => analysisBatches.id, { onDelete: 'cascade' }),
    operation: text('operation').notNull(),
    targetType: text('target_type').notNull(),
    targetIdsJson: text('target_ids_json').notNull(),
    beforeJson: text('before_json').notNull(),
    proposedJson: text('proposed_json'),
    reviewedJson: text('reviewed_json'),
    evidenceInputIdsJson: text('evidence_input_ids_json').notNull(),
    conflictsJson: text('conflicts_json').notNull(),
    rationale: text('rationale').notNull(),
    status: text('status').notNull().default('pending'),
    reviewReason: text('review_reason'),
    reviewedAt: integer('reviewed_at'),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    index('iteration_proposals_batch_status_index').on(table.analysisBatchId, table.status, table.createdAt),
    check('iteration_proposals_operation_check', sql`${table.operation} IN ('add', 'revise', 'merge', 'supersede', 'archive', 'no_change')`),
    check('iteration_proposals_target_type_check', sql`${table.targetType} IN ('growth', 'memory')`),
    check('iteration_proposals_status_check', sql`${table.status} IN ('pending', 'accepted', 'rejected', 'applied')`),
    check('iteration_proposals_target_json_check', sql`json_valid(${table.targetIdsJson})`),
    check('iteration_proposals_before_json_check', sql`json_valid(${table.beforeJson})`),
    check('iteration_proposals_proposed_json_check', sql`${table.proposedJson} IS NULL OR json_valid(${table.proposedJson})`),
    check('iteration_proposals_reviewed_json_check', sql`${table.reviewedJson} IS NULL OR json_valid(${table.reviewedJson})`),
    check('iteration_proposals_evidence_json_check', sql`json_valid(${table.evidenceInputIdsJson})`),
    check('iteration_proposals_conflicts_json_check', sql`json_valid(${table.conflictsJson})`),
  ],
)

/** 世界成长、人物成长和人物记忆各自唯一的学习提示词。 */
export const learningPrompts = sqliteTable(
  'learning_prompts',
  {
    id: text('id').primaryKey(),
    promptType: text('prompt_type').notNull(),
    worldId: text('world_id').references(() => worlds.id, { onDelete: 'cascade' }),
    personaId: text('persona_id').references(() => personas.id, { onDelete: 'cascade' }),
    activeVersionId: text('active_version_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('learning_prompts_world_type_unique').on(table.worldId, table.promptType),
    uniqueIndex('learning_prompts_persona_type_unique').on(table.personaId, table.promptType),
    check('learning_prompts_type_check', sql`${table.promptType} IN ('world_growth', 'persona_growth', 'persona_memory')`),
    check('learning_prompts_subject_check', sql`(
      (${table.promptType} = 'world_growth' AND ${table.worldId} IS NOT NULL AND ${table.personaId} IS NULL)
      OR (${table.promptType} IN ('persona_growth', 'persona_memory') AND ${table.personaId} IS NOT NULL AND ${table.worldId} IS NULL)
    )`),
  ],
)

/** 已发布且不可变的完整学习提示词历史版本。 */
export const learningPromptVersions = sqliteTable(
  'learning_prompt_versions',
  {
    id: text('id').primaryKey(),
    promptId: text('prompt_id').notNull().references(() => learningPrompts.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    parentVersionId: text('parent_version_id'),
    promptText: text('prompt_text').notNull(),
    contentHash: text('content_hash').notNull(),
    sourceAnalysisBatchId: text('source_analysis_batch_id').references(() => analysisBatches.id, { onDelete: 'set null' }),
    changeSummary: text('change_summary').notNull(),
    createdBy: text('created_by').notNull(),
    publishedAt: integer('published_at').notNull(),
  },
  table => [
    uniqueIndex('learning_prompt_versions_prompt_number_unique').on(table.promptId, table.versionNo),
    index('learning_prompt_versions_prompt_published_index').on(table.promptId, table.publishedAt),
    check('learning_prompt_versions_number_check', sql`${table.versionNo} > 0`),
    check('learning_prompt_versions_text_check', sql`length(trim(${table.promptText})) > 0`),
    check('learning_prompt_versions_hash_check', sql`length(${table.contentHash}) = 64`),
    check('learning_prompt_versions_summary_check', sql`length(trim(${table.changeSummary})) > 0`),
    check('learning_prompt_versions_creator_check', sql`${table.createdBy} IN ('analysis', 'user', 'migration')`),
  ],
)

/** 发布前可编辑且不会进入任务的学习提示词草稿。 */
export const learningPromptDrafts = sqliteTable(
  'learning_prompt_drafts',
  {
    id: text('id').primaryKey(),
    promptId: text('prompt_id').notNull().references(() => learningPrompts.id, { onDelete: 'cascade' }),
    baseVersionId: text('base_version_id').references(() => learningPromptVersions.id, { onDelete: 'set null' }),
    promptText: text('prompt_text').notNull(),
    contentHash: text('content_hash').notNull(),
    sourceAnalysisBatchId: text('source_analysis_batch_id').references(() => analysisBatches.id, { onDelete: 'set null' }),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('learning_prompt_drafts_prompt_unique').on(table.promptId),
    check('learning_prompt_drafts_text_check', sql`length(trim(${table.promptText})) > 0`),
    check('learning_prompt_drafts_hash_check', sql`length(${table.contentHash}) = 64`),
    check('learning_prompt_drafts_creator_check', sql`${table.createdBy} IN ('analysis', 'user', 'migration')`),
  ],
)

/** 运行实际使用的不可变证据正文副本。 */
export const evidenceSnapshots = sqliteTable(
  'evidence_snapshots',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => generationRuns.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').references(() => sourceMaterials.id, { onDelete: 'set null' }),
    chunkId: text('chunk_id').references(() => sourceChunks.id, { onDelete: 'set null' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    rank: integer('rank').notNull(),
    metadataJson: text('metadata_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    index('evidence_snapshots_run_rank_index').on(table.runId, table.rank),
    check('evidence_snapshots_role_check', sql`${table.role} IN ('user_setting', 'canon_fact', 'reference', 'style_sample', 'growth', 'memory')`),
    check('evidence_snapshots_hash_check', sql`length(${table.contentHash}) = 64`),
    check('evidence_snapshots_rank_check', sql`${table.rank} >= 0`),
  ],
)

/** 系统根据最终文章和配图计划自动保存并确认的内部文档快照。 */
export const documentSpecs = sqliteTable(
  'document_specs',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => generationRuns.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    status: text('status').notNull().default('draft'),
    specJson: text('spec_json').notNull(),
    confirmedAt: integer('confirmed_at'),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    uniqueIndex('document_specs_run_revision_unique').on(table.runId, table.revision),
    check('document_specs_revision_check', sql`${table.revision} > 0`),
    check('document_specs_status_check', sql`${table.status} IN ('draft', 'confirmed', 'superseded')`),
  ],
)

/** 一次生成运行的统一产物文档。 */
export const artifactDocuments = sqliteTable(
  'artifact_documents',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => generationRuns.id, { onDelete: 'cascade' }),
    selectedSpecId: text('selected_spec_id').notNull().references(() => documentSpecs.id, { onDelete: 'restrict' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [uniqueIndex('artifact_documents_run_unique').on(table.runId)],
)

/** 统一产物文档中的文字块；阶段四再增加图片块。 */
export const artifactBlocks = sqliteTable(
  'artifact_blocks',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull().references(() => artifactDocuments.id, { onDelete: 'cascade' }),
    specKey: text('spec_key').notNull(),
    ordinal: integer('ordinal').notNull(),
    type: text('type').notNull().default('text'),
    role: text('role').notNull(),
    specJson: text('spec_json').notNull(),
    status: text('status').notNull().default('pending'),
    selectedAttemptId: text('selected_attempt_id'),
    isLocked: integer('is_locked').notNull().default(0),
    selectedAt: integer('selected_at'),
    lockedAt: integer('locked_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('artifact_blocks_document_ordinal_unique').on(table.documentId, table.ordinal),
    uniqueIndex('artifact_blocks_document_spec_key_unique').on(table.documentId, table.specKey),
    check('artifact_blocks_ordinal_check', sql`${table.ordinal} >= 0`),
    check('artifact_blocks_type_check', sql`${table.type} IN ('text', 'image')`),
    check('artifact_blocks_role_check', sql`${table.role} IN ('heading', 'paragraph', 'list', 'quote', 'hero_image', 'illustration')`),
    check('artifact_blocks_status_check', sql`${table.status} IN ('pending', 'running', 'succeeded', 'failed', 'canceled')`),
    check('artifact_blocks_locked_check', sql`${table.isLocked} IN (0, 1)`),
  ],
)

/** 文字块每次独立、不可覆盖的模型调用尝试。 */
export const blockAttempts = sqliteTable(
  'block_attempts',
  {
    id: text('id').primaryKey(),
    blockId: text('block_id').notNull().references(() => artifactBlocks.id, { onDelete: 'cascade' }),
    attemptNo: integer('attempt_no').notNull(),
    status: text('status').notNull(),
    inputSnapshotJson: text('input_snapshot_json').notNull(),
    outputText: text('output_text'),
    usageJson: text('usage_json'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at').notNull(),
    completedAt: integer('completed_at'),
  },
  table => [
    uniqueIndex('block_attempts_block_attempt_no_unique').on(table.blockId, table.attemptNo),
    check('block_attempts_attempt_no_check', sql`${table.attemptNo} > 0`),
    check('block_attempts_status_check', sql`${table.status} IN ('running', 'succeeded', 'failed')`),
  ],
)

/** 成功图片尝试下载并校验后的本地资产。 */
export const imageAssets = sqliteTable(
  'image_assets',
  {
    id: text('id').primaryKey(),
    attemptId: text('attempt_id').notNull().references(() => blockAttempts.id, { onDelete: 'cascade' }),
    relativePath: text('relative_path').notNull(),
    mediaType: text('media_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    contentHash: text('content_hash').notNull(),
    altText: text('alt_text').notNull(),
    originalRelativePath: text('original_relative_path'),
    originalMediaType: text('original_media_type'),
    originalSizeBytes: integer('original_size_bytes'),
    originalContentHash: text('original_content_hash'),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    uniqueIndex('image_assets_attempt_unique').on(table.attemptId),
    uniqueIndex('image_assets_relative_path_unique').on(table.relativePath),
    uniqueIndex('image_assets_original_relative_path_unique').on(table.originalRelativePath),
    check('image_assets_path_check', sql`${table.relativePath} GLOB 'assets/*' AND instr(${table.relativePath}, '..') = 0`),
    check('image_assets_media_type_check', sql`${table.mediaType} IN ('image/png', 'image/jpeg', 'image/webp')`),
    check('image_assets_size_check', sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 10485760`),
    check('image_assets_hash_check', sql`length(${table.contentHash}) = 64`),
    check('image_assets_alt_text_check', sql`length(trim(${table.altText})) > 0`),
    check('image_assets_original_fields_check', sql`(
      ${table.originalRelativePath} IS NULL AND ${table.originalMediaType} IS NULL
        AND ${table.originalSizeBytes} IS NULL AND ${table.originalContentHash} IS NULL
    ) OR (
      ${table.originalRelativePath} IS NOT NULL AND ${table.originalMediaType} IS NOT NULL
        AND ${table.originalSizeBytes} IS NOT NULL AND ${table.originalContentHash} IS NOT NULL
    )`),
    check('image_assets_original_path_check', sql`${table.originalRelativePath} IS NULL OR (${table.originalRelativePath} GLOB 'assets/*' AND instr(${table.originalRelativePath}, '..') = 0)`),
    check('image_assets_original_media_type_check', sql`${table.originalMediaType} IS NULL OR ${table.originalMediaType} IN ('image/png', 'image/jpeg', 'image/webp')`),
    check('image_assets_original_size_check', sql`${table.originalSizeBytes} IS NULL OR (${table.originalSizeBytes} > 0 AND ${table.originalSizeBytes} <= 10485760)`),
    check('image_assets_original_hash_check', sql`${table.originalContentHash} IS NULL OR length(${table.originalContentHash}) = 64`),
  ],
)

/** 用户对一次运行或具体产物块提交的不可变原始反馈。 */
export const feedbackEvents = sqliteTable(
  'feedback_events',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => generationRuns.id, { onDelete: 'cascade' }),
    blockId: text('block_id').references(() => artifactBlocks.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    rating: text('rating'),
    isLongTerm: integer('is_long_term').notNull().default(0),
    editedOutput: text('edited_output'),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    index('feedback_events_run_created_at_index').on(table.runId, table.createdAt),
    check('feedback_events_content_check', sql`length(trim(${table.content})) > 0`),
    check('feedback_events_rating_check', sql`${table.rating} IS NULL OR ${table.rating} IN ('positive', 'negative', 'neutral')`),
    check('feedback_events_long_term_check', sql`${table.isLongTerm} IN (0, 1)`),
  ],
)

/** 文本模型对反馈目标给出的可纠正分类建议。 */
export const feedbackSuggestions = sqliteTable(
  'feedback_suggestions',
  {
    feedbackId: text('feedback_id').primaryKey().references(() => feedbackEvents.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    confidence: integer('confidence_millionths').notNull(),
    rationale: text('rationale').notNull(),
    modelSnapshotJson: text('model_snapshot_json').notNull(),
    parameterSnapshotJson: text('parameter_snapshot_json').notNull(),
    promptVersion: text('prompt_version').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    check('feedback_suggestions_target_check', sql`${table.targetType} IN ('artifact', 'parameters', 'persona', 'source_fact')`),
    check('feedback_suggestions_confidence_check', sql`${table.confidence} BETWEEN 0 AND 1000000`),
  ],
)

/** 用户确认分类后唯一且不可重复的业务动作结果。 */
export const feedbackResolutions = sqliteTable(
  'feedback_resolutions',
  {
    feedbackId: text('feedback_id').primaryKey().references(() => feedbackEvents.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    resolutionJson: text('resolution_json').notNull(),
    confirmedAt: integer('confirmed_at').notNull(),
  },
  table => [check('feedback_resolutions_target_check', sql`${table.targetType} IN ('artifact', 'parameters', 'persona', 'source_fact')`)],
)

/** 本地交流向 OpenViking 世界 User Session 投影的持久状态。 */
export const openVikingSessionRecords = sqliteTable(
  'openviking_session_records',
  {
    id: text('id').primaryKey(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    personaId: text('persona_id').notNull(),
    userId: text('user_id').notNull(),
    peerId: text('peer_id').notNull(),
    remoteSessionId: text('remote_session_id').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('openviking_session_records_source_unique').on(table.sourceType, table.sourceId),
    index('openviking_session_records_status_index').on(table.status, table.updatedAt),
    check('openviking_session_records_source_type_check', sql`${table.sourceType} IN ('run', 'feedback')`),
    check('openviking_session_records_status_check', sql`${table.status} IN ('pending', 'synchronized', 'failed')`),
  ],
)

/** OpenViking 从人物 Peer Session 派生并同步回 SQLite 的记忆分析素材。 */
export const openVikingDerivedMemories = sqliteTable(
  'openviking_derived_memories',
  {
    id: text('id').primaryKey(),
    personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
    sourceSessionRecordId: text('source_session_record_id').notNull().references(() => openVikingSessionRecords.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    peerId: text('peer_id').notNull(),
    remoteUri: text('remote_uri').notNull(),
    memoryType: text('memory_type').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    isEnabled: integer('is_enabled').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('openviking_derived_memories_identity_uri_unique').on(table.userId, table.peerId, table.remoteUri),
    index('openviking_derived_memories_persona_enabled_index').on(table.personaId, table.isEnabled, table.updatedAt),
    check('openviking_derived_memories_type_check', sql`length(trim(${table.memoryType})) > 0`),
    check('openviking_derived_memories_content_check', sql`length(trim(${table.content})) > 0`),
    check('openviking_derived_memories_hash_check', sql`length(${table.contentHash}) = 64`),
    check('openviking_derived_memories_enabled_check', sql`${table.isEnabled} IN (0, 1)`),
  ],
)

/** 可选上下文提供器对每项 SQLite 资料的可重建同步状态。 */
export const contextSyncRecords = sqliteTable(
  'context_sync_records',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').notNull().default('source_material'),
    sourceId: text('source_id').notNull(),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    userId: text('user_id').notNull(),
    peerId: text('peer_id'),
    provider: text('provider').notNull(),
    remoteUri: text('remote_uri'),
    contentHash: text('content_hash').notNull(),
    status: text('status').notNull(),
    operation: text('operation').notNull().default('upsert'),
    error: text('error'),
    errorCode: text('error_code'),
    errorStage: text('error_stage'),
    failureCount: integer('failure_count').notNull().default(0),
    nextRetryAt: integer('next_retry_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('context_sync_records_projection_unique').on(table.entityType, table.sourceId, table.scopeType, table.scopeId, table.provider),
    index('context_sync_records_provider_status_index').on(table.provider, table.status),
    check('context_sync_records_provider_check', sql`${table.provider} IN ('openviking')`),
    check('context_sync_records_entity_type_check', sql`${table.entityType} IN ('source_material', 'persona_feedback_source', 'growth', 'memory')`),
    check('context_sync_records_scope_type_check', sql`${table.scopeType} IN ('world', 'persona', 'global')`),
    check('context_sync_records_status_check', sql`${table.status} IN ('pending', 'synchronized', 'failed')`),
    check('context_sync_records_operation_check', sql`${table.operation} IN ('upsert', 'delete')`),
    check('context_sync_records_hash_check', sql`length(${table.contentHash}) = 64`),
    check('context_sync_records_failure_count_check', sql`${table.failureCount} >= 0`),
  ],
)

/** 数据库 Schema 的统一导出，供 Drizzle 查询和迁移使用。 */
export const databaseSchema = {
  administrators,
  apiKeys,
  publicApiIdempotencyRecords,
  publicApiAuditEvents,
  auditEvents,
  systemAiSettings,
  openVikingSettings,
  openVikingSyncRuntime,
  openVikingSyncOutbox,
  aiConnections,
  aiModelDeployments,
  taskJobs,
  worlds,
  personas,
  soulDrafts,
  soulVersions,
  sourceMaterials,
  sourceChunks,
  personaSources,
  worldSources,
  globalSources,
  personaDistillationRuns,
  personaDistillationInputs,
  personaDistillationClaims,
  personaDistillationEvidence,
  personaDistillationEvaluations,
  personaFeedbackSources,
  growthMaterials,
  growthRecords,
  growthRevisions,
  growthRevisionEvidence,
  formatTemplates,
  parameterProfiles,
  aiPrompts,
  aiPromptVersions,
  aiPromptDrafts,
  aiAlgorithms,
  aiAlgorithmConfigurationVersions,
  aiAlgorithmStepConfigurations,
  generationRuns,
  personaOperationRecords,
  personaExternalRecords,
  memoryRecords,
  memoryRevisions,
  memoryRevisionEvidence,
  analysisBatches,
  learningAutomationSettings,
  analysisBatchInputs,
  iterationProposals,
  learningPrompts,
  learningPromptVersions,
  learningPromptDrafts,
  evidenceSnapshots,
  documentSpecs,
  artifactDocuments,
  artifactBlocks,
  blockAttempts,
  imageAssets,
  feedbackEvents,
  feedbackSuggestions,
  feedbackResolutions,
  openVikingSessionRecords,
  openVikingDerivedMemories,
  contextSyncRecords,
}
