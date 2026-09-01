import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SystemAiSettingsApplicationService } from '../../server/application/systemAi/SystemAiSettingsApplicationService'
import { SqliteAiConfigurationRepository } from '../../server/infrastructure/database/SqliteAiConfigurationRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteSystemAiSettingsRepository } from '../../server/infrastructure/database/SqliteSystemAiSettingsRepository'

let directory: string
let database: SqliteDatabase

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-default-models-test-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('默认模型设置', () => {
  it('首次读取只返回空的默认文本和图片模型', async () => {
    await expect(createService().getSettings()).resolves.toEqual({
      values: { textModelDeploymentId: '', imageModelDeploymentId: '' },
      updatedAt: null,
    })
  })

  it('保存启用且类型匹配的默认部署，并写入管理员审计', async () => {
    insertDeployment('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000011', 'text')
    insertDeployment('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000012', 'image')
    const values = {
      textModelDeploymentId: '10000000-0000-4000-8000-000000000011',
      imageModelDeploymentId: '10000000-0000-4000-8000-000000000012',
    }

    await expect(createService().updateSettings(values)).resolves.toEqual({ values, updatedAt: 8_000 })
    await expect(createService().getSettings()).resolves.toEqual({ values, updatedAt: 8_000 })
    expect(database.getClient().prepare(`
      SELECT action, target_type FROM audit_events WHERE action = 'system_ai_settings_updated'
    `).get()).toEqual({ action: 'system_ai_settings_updated', target_type: 'system_ai_settings' })
  })

  it('拒绝类型错误、未启用或所属接口未启用的默认部署', async () => {
    insertDeployment('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000013', 'image')
    insertDeployment('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000014', 'text', false)
    insertDeployment('10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000015', 'text', true, false)
    const service = createService()

    await expect(service.updateSettings({
      textModelDeploymentId: '10000000-0000-4000-8000-000000000013', imageModelDeploymentId: '',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 422 })
    await expect(service.updateSettings({
      textModelDeploymentId: '10000000-0000-4000-8000-000000000014', imageModelDeploymentId: '',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 422 })
    await expect(service.updateSettings({
      textModelDeploymentId: '10000000-0000-4000-8000-000000000015', imageModelDeploymentId: '',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 422 })
  })
})

/**
 * 创建使用固定时间的默认模型设置服务。
 * @returns 连接真实临时数据库的应用服务。
 */
function createService(): SystemAiSettingsApplicationService {
  return new SystemAiSettingsApplicationService({
    repository: new SqliteSystemAiSettingsRepository(database.getClient()),
    aiConfiguration: new SqliteAiConfigurationRepository(database.getClient()),
    clock: { now: () => 8_000 },
  })
}

/**
 * 插入默认模型校验所需的连接和部署。
 * @param connectionId AI 接口连接 UUID。
 * @param deploymentId 模型部署 UUID。
 * @param modality 模型输出类型。
 * @param deploymentEnabled 部署是否启用。
 * @param connectionEnabled 所属接口是否启用。
 * @returns 写入完成时结束。
 */
function insertDeployment(
  connectionId: string,
  deploymentId: string,
  modality: 'text' | 'image',
  deploymentEnabled = true,
  connectionEnabled = true,
): void {
  database.getClient().prepare(`
    INSERT INTO ai_connections (
      id, name, protocol, endpoint, user_agent, api_key_ciphertext, is_enabled, created_at, updated_at
    ) VALUES (?, ?, 'openai_compatible', 'https://model.example/v1', '', 'ciphertext', ?, 1000, 1000)
  `).run(connectionId, `接口-${connectionId}`, connectionEnabled ? 1 : 0)
  database.getClient().prepare(`
    INSERT INTO ai_model_deployments (
      id, connection_id, name, model, modality, is_enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1000, 1000)
  `).run(deploymentId, connectionId, `部署-${deploymentId}`, `model-${deploymentId}`, modality, deploymentEnabled ? 1 : 0)
}
