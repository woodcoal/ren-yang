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

/** 数据库 Schema 的统一导出，供 Drizzle 查询和迁移使用。 */
export const databaseSchema = {
  administrators,
  taskJobs,
  worlds,
  worldVersions,
  personas,
  personaVersions,
  sourceMaterials,
  sourceChunks,
  personaSources,
  worldSources,
}
