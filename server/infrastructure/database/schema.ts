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

/** 数据库 Schema 的统一导出，供 Drizzle 查询和迁移使用。 */
export const databaseSchema = {
  administrators,
  taskJobs,
}
