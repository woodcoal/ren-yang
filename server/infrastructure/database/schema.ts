import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
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
    leaseUntil: integer('lease_until'),
    heartbeatAt: integer('heartbeat_at'),
    cancelRequestedAt: integer('cancel_requested_at'),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('task_jobs_status_created_at_index').on(table.status, table.createdAt),
    index('task_jobs_lease_until_index').on(table.leaseUntil),
    check(
      'task_jobs_status_check',
      sql`${table.status} IN ('queued', 'running', 'succeeded', 'failed', 'cancel_requested', 'canceled')`,
    ),
    check('task_jobs_attempt_count_check', sql`${table.attemptCount} >= 0`),
    check('task_jobs_max_attempts_check', sql`${table.maxAttempts} > 0`),
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
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    check('worlds_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
    check('worlds_enabled_check', sql`${table.isEnabled} IN (0, 1)`),
  ],
)

/** 人物聚合根，世界和当前灵魂版本均为可选指针。 */
export const personas = sqliteTable(
  'personas',
  {
    id: text('id').primaryKey(),
    worldId: text('world_id').references(() => worlds.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    origin: text('origin').notNull(),
    activeSoulVersionId: text('active_soul_version_id'),
    isEnabled: integer('is_enabled').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('personas_world_id_index').on(table.worldId),
    check('personas_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
    check('personas_origin_check', sql`${table.origin} IN ('original', 'source_based', 'hybrid')`),
    check('personas_enabled_check', sql`${table.isEnabled} IN (0, 1)`),
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
    chaptersJson: text('chapters_json').notNull(),
    runtimeSummary: text('runtime_summary').notNull(),
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
    check('soul_drafts_runtime_summary_not_empty_check', sql`length(trim(${table.runtimeSummary})) > 0`),
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
    chaptersJson: text('chapters_json').notNull(),
    runtimeSummary: text('runtime_summary').notNull(),
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
    check('soul_versions_runtime_summary_not_empty_check', sql`length(trim(${table.runtimeSummary})) > 0`),
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
    baselineJson: text('baseline_json').notNull(),
    modelSnapshotJson: text('model_snapshot_json').notNull(),
    parameterSnapshotJson: text('parameter_snapshot_json').notNull(),
    promptVersion: text('prompt_version').notNull(),
    rawResultJson: text('raw_result_json'),
    status: text('status').notNull().default('queued'),
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
    check('analysis_batches_baseline_json_check', sql`json_valid(${table.baselineJson})`),
    check('analysis_batches_model_json_check', sql`json_valid(${table.modelSnapshotJson})`),
    check('analysis_batches_parameter_json_check', sql`json_valid(${table.parameterSnapshotJson})`),
    check('analysis_batches_raw_json_check', sql`${table.rawResultJson} IS NULL OR json_valid(${table.rawResultJson})`),
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
    isNew: integer('is_new').notNull().default(1),
    sourceAvailable: integer('source_available').notNull().default(1),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    uniqueIndex('analysis_batch_inputs_unique').on(table.batchId, table.inputType, table.inputId),
    index('analysis_batch_inputs_source_index').on(table.inputType, table.inputId),
    check('analysis_batch_inputs_type_check', sql`${table.inputType} IN ('world_source', 'persona_feedback_source', 'persona_operation_record', 'openviking_memory')`),
    check('analysis_batch_inputs_hash_check', sql`length(${table.contentHash}) = 64`),
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

/** AI 规划且必须由用户确认的文档规格修订。 */
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
    createdAt: integer('created_at').notNull(),
  },
  table => [
    uniqueIndex('image_assets_attempt_unique').on(table.attemptId),
    uniqueIndex('image_assets_relative_path_unique').on(table.relativePath),
    check('image_assets_path_check', sql`${table.relativePath} GLOB 'assets/*' AND instr(${table.relativePath}, '..') = 0`),
    check('image_assets_media_type_check', sql`${table.mediaType} IN ('image/png', 'image/jpeg', 'image/webp')`),
    check('image_assets_size_check', sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 10485760`),
    check('image_assets_hash_check', sql`length(${table.contentHash}) = 64`),
    check('image_assets_alt_text_check', sql`length(trim(${table.altText})) > 0`),
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

/** 人物维护的固定回归评测用例。 */
export const evaluationCases = sqliteTable(
  'evaluation_cases',
  {
    id: text('id').primaryKey(),
    personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category').notNull(),
    prompt: text('prompt').notNull(),
    expectedChange: text('expected_change').notNull(),
    assertionsJson: text('assertions_json').notNull(),
    isActive: integer('is_active').notNull().default(1),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    uniqueIndex('evaluation_cases_persona_name_unique').on(table.personaId, table.name),
    index('evaluation_cases_persona_active_index').on(table.personaId, table.isActive),
    check('evaluation_cases_name_check', sql`length(trim(${table.name})) > 0`),
    check('evaluation_cases_category_check', sql`${table.category} IN ('behavior', 'style', 'safety')`),
    check('evaluation_cases_expected_change_check', sql`${table.expectedChange} IN ('improve', 'retain')`),
    check('evaluation_cases_active_check', sql`${table.isActive} IN (0, 1)`),
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
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('context_sync_records_projection_unique').on(table.entityType, table.sourceId, table.scopeType, table.scopeId, table.provider),
    index('context_sync_records_provider_status_index').on(table.provider, table.status),
    check('context_sync_records_provider_check', sql`${table.provider} IN ('openviking')`),
    check('context_sync_records_entity_type_check', sql`${table.entityType} IN ('source_material', 'persona_feedback_source', 'growth', 'memory')`),
    check('context_sync_records_scope_type_check', sql`${table.scopeType} IN ('world', 'persona')`),
    check('context_sync_records_status_check', sql`${table.status} IN ('pending', 'synchronized', 'failed')`),
    check('context_sync_records_operation_check', sql`${table.operation} IN ('upsert', 'delete')`),
    check('context_sync_records_hash_check', sql`length(${table.contentHash}) = 64`),
  ],
)

/** 数据库 Schema 的统一导出，供 Drizzle 查询和迁移使用。 */
export const databaseSchema = {
  administrators,
  auditEvents,
  taskJobs,
  worlds,
  personas,
  soulDrafts,
  soulVersions,
  sourceMaterials,
  sourceChunks,
  personaSources,
  worldSources,
  personaFeedbackSources,
  growthRecords,
  growthRevisions,
  growthRevisionEvidence,
  formatTemplates,
  parameterProfiles,
  generationRuns,
  personaOperationRecords,
  memoryRecords,
  memoryRevisions,
  memoryRevisionEvidence,
  analysisBatches,
  analysisBatchInputs,
  iterationProposals,
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
  evaluationCases,
  contextSyncRecords,
}
