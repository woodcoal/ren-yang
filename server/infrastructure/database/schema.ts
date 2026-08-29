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

/** 可选的世界设定聚合根。 */
export const worlds = sqliteTable(
  'worlds',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    summary: text('summary').notNull().default(''),
    activeVersionId: text('active_version_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [check('worlds_name_not_empty_check', sql`length(trim(${table.name})) > 0`)],
)

/** 世界设定的不可变内容版本。 */
export const worldVersions = sqliteTable(
  'world_versions',
  {
    id: text('id').primaryKey(),
    worldId: text('world_id').notNull().references(() => worlds.id, { onDelete: 'cascade' }),
    parentVersionId: text('parent_version_id'),
    status: text('status').notNull().default('candidate'),
    snapshotJson: text('snapshot_json').notNull(),
    changeSummary: text('change_summary').notNull(),
    publishedAt: integer('published_at'),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    index('world_versions_world_created_at_index').on(table.worldId, table.createdAt),
    check('world_versions_status_check', sql`${table.status} IN ('candidate', 'published', 'rejected')`),
  ],
)

/** 人物聚合根，世界和当前版本均为可选指针。 */
export const personas = sqliteTable(
  'personas',
  {
    id: text('id').primaryKey(),
    worldId: text('world_id').references(() => worlds.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    origin: text('origin').notNull(),
    activeVersionId: text('active_version_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('personas_world_id_index').on(table.worldId),
    check('personas_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
    check('personas_origin_check', sql`${table.origin} IN ('original', 'source_based', 'hybrid')`),
  ],
)

/** 人物档案的不可变内容版本。 */
export const personaVersions = sqliteTable(
  'persona_versions',
  {
    id: text('id').primaryKey(),
    personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
    parentVersionId: text('parent_version_id'),
    status: text('status').notNull().default('candidate'),
    snapshotJson: text('snapshot_json').notNull(),
    changeSummary: text('change_summary').notNull(),
    publishedAt: integer('published_at'),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    index('persona_versions_persona_created_at_index').on(table.personaId, table.createdAt),
    check('persona_versions_status_check', sql`${table.status} IN ('candidate', 'published', 'rejected')`),
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

/** 世界设定与可复用资料的显式关联。 */
export const worldSources = sqliteTable(
  'world_sources',
  {
    worldId: text('world_id').notNull().references(() => worlds.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull().references(() => sourceMaterials.id, { onDelete: 'restrict' }),
    priority: integer('priority').notNull().default(100),
  },
  table => [
    uniqueIndex('world_sources_unique').on(table.worldId, table.sourceId),
    index('world_sources_source_id_index').on(table.sourceId),
    check('world_sources_priority_check', sql`${table.priority} >= 0`),
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
    personaVersionId: text('persona_version_id').notNull().references(() => personaVersions.id, { onDelete: 'restrict' }),
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
    check('evidence_snapshots_role_check', sql`${table.role} IN ('user_setting', 'canon_fact', 'reference', 'style_sample')`),
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

/** 反馈产生且等待评测和发布的人物修订提案。 */
export const revisionProposals = sqliteTable(
  'revision_proposals',
  {
    id: text('id').primaryKey(),
    feedbackId: text('feedback_id').notNull().references(() => feedbackEvents.id, { onDelete: 'cascade' }),
    personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
    baseVersionId: text('base_version_id').notNull().references(() => personaVersions.id, { onDelete: 'cascade' }),
    candidateVersionId: text('candidate_version_id').notNull().references(() => personaVersions.id, { onDelete: 'cascade' }),
    riskLevel: text('risk_level').notNull(),
    status: text('status').notNull().default('awaiting_evaluation'),
    patchesJson: text('patches_json').notNull(),
    riskReasonsJson: text('risk_reasons_json').notNull(),
    hasEvidenceConflict: integer('has_evidence_conflict').notNull().default(0),
    latestEvaluationRunId: text('latest_evaluation_run_id'),
    decisionReason: text('decision_reason'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('revision_proposals_feedback_unique').on(table.feedbackId),
    uniqueIndex('revision_proposals_candidate_version_unique').on(table.candidateVersionId),
    index('revision_proposals_persona_status_created_index').on(table.personaId, table.status, table.createdAt),
    check('revision_proposals_risk_check', sql`${table.riskLevel} IN ('low', 'high', 'critical')`),
    check('revision_proposals_status_check', sql`${table.status} IN ('awaiting_evaluation', 'evaluation_failed', 'ready', 'published', 'rejected')`),
    check('revision_proposals_conflict_check', sql`${table.hasEvidenceConflict} IN (0, 1)`),
  ],
)

/** 场景或明确长期反馈形成且已转入提案门禁的候选记忆。 */
export const candidateMemories = sqliteTable(
  'candidate_memories',
  {
    id: text('id').primaryKey(),
    feedbackId: text('feedback_id').notNull().references(() => feedbackEvents.id, { onDelete: 'cascade' }),
    personaId: text('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    status: text('status').notNull().default('proposed'),
    proposalId: text('proposal_id').references(() => revisionProposals.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    uniqueIndex('candidate_memories_feedback_unique').on(table.feedbackId),
    check('candidate_memories_status_check', sql`${table.status} IN ('proposed', 'promoted', 'rejected')`),
    check('candidate_memories_content_check', sql`length(trim(${table.content})) > 0`),
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

/** 一次提案评测的固定模型、参数、提示和汇总。 */
export const evaluationRuns = sqliteTable(
  'evaluation_runs',
  {
    id: text('id').primaryKey(),
    proposalId: text('proposal_id').notNull().references(() => revisionProposals.id, { onDelete: 'cascade' }),
    candidateVersionId: text('candidate_version_id').notNull().references(() => personaVersions.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('queued'),
    modelSnapshotJson: text('model_snapshot_json').notNull(),
    parameterSnapshotJson: text('parameter_snapshot_json').notNull(),
    promptVersion: text('prompt_version').notNull(),
    passedCases: integer('passed_cases').notNull().default(0),
    totalCases: integer('total_cases').notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at').notNull(),
    completedAt: integer('completed_at'),
  },
  table => [
    index('evaluation_runs_proposal_created_index').on(table.proposalId, table.createdAt),
    check('evaluation_runs_status_check', sql`${table.status} IN ('queued', 'running', 'passed', 'failed')`),
    check('evaluation_runs_count_check', sql`${table.passedCases} >= 0 AND ${table.totalCases} > 0 AND ${table.passedCases} <= ${table.totalCases}`),
  ],
)

/** 评测模型证据与确定性规则形成的逐用例结果。 */
export const evaluationResults = sqliteTable(
  'evaluation_results',
  {
    id: text('id').primaryKey(),
    evaluationRunId: text('evaluation_run_id').notNull().references(() => evaluationRuns.id, { onDelete: 'cascade' }),
    caseId: text('case_id').notNull().references(() => evaluationCases.id, { onDelete: 'restrict' }),
    caseName: text('case_name').notNull(),
    status: text('status').notNull(),
    baseScore: integer('base_score_millionths').notNull(),
    candidateScore: integer('candidate_score_millionths').notNull(),
    baseOutput: text('base_output').notNull(),
    candidateOutput: text('candidate_output').notNull(),
    failuresJson: text('failures_json').notNull(),
    reasoningSummary: text('reasoning_summary').notNull(),
  },
  table => [
    uniqueIndex('evaluation_results_run_case_unique').on(table.evaluationRunId, table.caseId),
    check('evaluation_results_status_check', sql`${table.status} IN ('passed', 'failed')`),
    check('evaluation_results_base_score_check', sql`${table.baseScore} BETWEEN 0 AND 1000000`),
    check('evaluation_results_candidate_score_check', sql`${table.candidateScore} BETWEEN 0 AND 1000000`),
  ],
)

/** 可选上下文提供器对每项 SQLite 资料的可重建同步状态。 */
export const contextSyncRecords = sqliteTable(
  'context_sync_records',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id').notNull().references(() => sourceMaterials.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    remoteUri: text('remote_uri'),
    contentHash: text('content_hash').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('context_sync_records_source_provider_unique').on(table.sourceId, table.provider),
    index('context_sync_records_provider_status_index').on(table.provider, table.status),
    check('context_sync_records_provider_check', sql`${table.provider} IN ('openviking')`),
    check('context_sync_records_status_check', sql`${table.status} IN ('pending', 'synchronized', 'failed')`),
    check('context_sync_records_hash_check', sql`length(${table.contentHash}) = 64`),
  ],
)

/** 数据库 Schema 的统一导出，供 Drizzle 查询和迁移使用。 */
export const databaseSchema = {
  administrators,
  auditEvents,
  taskJobs,
  worlds,
  worldVersions,
  personas,
  personaVersions,
  sourceMaterials,
  sourceChunks,
  personaSources,
  worldSources,
  formatTemplates,
  parameterProfiles,
  generationRuns,
  evidenceSnapshots,
  documentSpecs,
  artifactDocuments,
  artifactBlocks,
  blockAttempts,
  imageAssets,
  feedbackEvents,
  feedbackSuggestions,
  feedbackResolutions,
  revisionProposals,
  candidateMemories,
  evaluationCases,
  evaluationRuns,
  evaluationResults,
  contextSyncRecords,
}
