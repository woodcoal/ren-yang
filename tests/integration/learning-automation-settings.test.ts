import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteLearningAutomationSettingsRepository } from '../../server/infrastructure/database/SqliteLearningAutomationSettingsRepository'

let directory: string
let database: SqliteDatabase

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-learning-automation-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('学习自动化周期持久化', () => {
  it('默认 24 小时，修改后重算下次执行时间并持久保存', async () => {
    const repository = new SqliteLearningAutomationSettingsRepository(database.getClient())
    await expect(repository.find()).resolves.toMatchObject({ intervalHours: 24, nextRunAt: 0, lastRunAt: null })

    await expect(repository.update(48, 10_000)).resolves.toMatchObject({
      intervalHours: 48,
      nextRunAt: 10_000 + 48 * 60 * 60 * 1_000,
    })
    await expect(repository.claimDueCycle(11_000)).resolves.toBe(false)
  })
})
