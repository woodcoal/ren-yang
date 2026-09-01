import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SystemAiSettingsApplicationService } from '../../server/application/systemAi/SystemAiSettingsApplicationService'
import { SqliteAiConfigurationRepository } from '../../server/infrastructure/database/SqliteAiConfigurationRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteSystemAiSettingsRepository } from '../../server/infrastructure/database/SqliteSystemAiSettingsRepository'

/** 当前测试使用的临时数据目录。 */
let directory: string
/** 当前测试使用的迁移后 SQLite 数据库。 */
let database: SqliteDatabase

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-system-ai-settings-test-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('系统 AI 设置', () => {
  it('首次读取返回按场景区分且不包含图文块限制的默认值', async () => {
    const service = createService()

    await expect(service.getSettings()).resolves.toEqual({
      values: {
        textModelDeploymentId: '',
        imageModelDeploymentId: '',
        draftGeneration: { temperature: 0.4, maxOutputTokens: 2_048, timeoutMs: 60_000 },
        feedbackClassification: { temperature: 0, maxOutputTokens: 4_096, timeoutMs: 60_000 },
      },
      updatedAt: null,
    })
  })

  it('读取旧记录时丢弃已经由固定算法接管的兴趣和内容分析参数', async () => {
    database.getClient().prepare(`
      INSERT INTO system_ai_settings (id, values_json, updated_at) VALUES ('system_ai_settings', ?, 7000)
    `).run(JSON.stringify({
      textModelDeploymentId: '',
      imageModelDeploymentId: '',
      interestAnalysis: { temperature: 0.4, maxOutputTokens: 2_048, timeoutMs: 60_000, maxEvidenceChunks: 8 },
      contentAnalysis: { temperature: 1.8, maxOutputTokens: 8_192, timeoutMs: 120_000 },
      draftGeneration: { temperature: 0.4, maxOutputTokens: 2_048, timeoutMs: 60_000 },
      feedbackClassification: { temperature: 0, maxOutputTokens: 4_096, timeoutMs: 60_000 },
    }))

    await expect(createService().getSettings()).resolves.toEqual({
      values: {
        textModelDeploymentId: '',
        imageModelDeploymentId: '',
        draftGeneration: { temperature: 0.4, maxOutputTokens: 2_048, timeoutMs: 60_000 },
        feedbackClassification: { temperature: 0, maxOutputTokens: 4_096, timeoutMs: 60_000 },
      },
      updatedAt: 7_000,
    })
  })

  it('保存后持久化完整设置、写入审计并只覆盖目标场景参数', async () => {
    const service = createService()
    const values = (await service.getSettings()).values
    values.draftGeneration.temperature = 0.1
    values.feedbackClassification.timeoutMs = 30_000

    await expect(service.updateSettings(values)).resolves.toMatchObject({ values, updatedAt: 8_000 })
    await expect(createService().getSettings()).resolves.toMatchObject({ values, updatedAt: 8_000 })
    await expect(service.resolveParameters('draftGeneration', {
      temperature: 1, maxOutputTokens: 64, timeoutMs: 1_000, maxEvidenceChunks: 1,
      maxTextBlocks: 7, maxImageBlocks: 3, maxPromptCharacters: 10_000, maxTotalTokens: 5_000,
      maxBlockAttempts: 2, contextWindowTokens: 32_768, reservedOutputTokens: 4_096,
      safetyMarginTokens: 2_048, worldBudgetTokens: 5_000, worldSoulBudgetTokens: 2_500,
      worldGrowthBudgetTokens: 2_500, personaBudgetTokens: 9_000, personaSoulBudgetTokens: 3_500,
      personaGrowthBudgetTokens: 2_500, personaMemoryBudgetTokens: 3_000, sourceBudgetTokens: 5_000,
    })).resolves.toMatchObject({
      temperature: 0.1, maxOutputTokens: 2_048, timeoutMs: 60_000, maxEvidenceChunks: 1,
      maxTextBlocks: 7, maxImageBlocks: 3,
    })
    expect(database.getClient().prepare(`
      SELECT actor, action, target_type FROM audit_events WHERE action = 'system_ai_settings_updated'
    `).get()).toEqual({ actor: 'administrator', action: 'system_ai_settings_updated', target_type: 'system_ai_settings' })
  })
})

/** @returns 使用固定时钟的系统 AI 设置服务。 */
function createService(): SystemAiSettingsApplicationService {
  return new SystemAiSettingsApplicationService({
    repository: new SqliteSystemAiSettingsRepository(database.getClient()),
    aiConfiguration: new SqliteAiConfigurationRepository(database.getClient()),
    clock: { now: () => 8_000 },
  })
}
