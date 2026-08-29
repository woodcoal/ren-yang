import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DrizzleAdministratorRepository } from '../../server/infrastructure/database/DrizzleAdministratorRepository'
import { SqliteAuditRepository } from '../../server/infrastructure/database/SqliteAuditRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'

let directory: string
let database: SqliteDatabase

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-administrator-audit-test-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('管理员关键动作审计', () => {
  it('首次创建和密码重置与管理员记录原子写入审计历史', async () => {
    const administrators = new DrizzleAdministratorRepository(database.db)
    await administrators.createIfAbsent({
      id: 'administrator', username: 'admin', passwordHash: 'hash-1', credentialVersion: 1, timestamp: 1_000,
    })
    await administrators.updatePassword('administrator', 'hash-2', 2_000)

    const events = await new SqliteAuditRepository(database.getClient()).list(10)
    expect(events.map(event => ({ action: event.action, actor: event.actor, createdAt: event.createdAt }))).toEqual([
      { action: 'administrator_password_reset', actor: 'maintenance', createdAt: 2_000 },
      { action: 'administrator_created', actor: 'system', createdAt: 1_000 },
    ])
    expect(JSON.stringify(events)).not.toContain('hash-1')
    expect(JSON.stringify(events)).not.toContain('hash-2')
  })
})
