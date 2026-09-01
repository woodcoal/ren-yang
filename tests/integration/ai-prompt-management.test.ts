import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { AiPromptApplicationService } from '../../server/application/aiPrompts/AiPromptApplicationService'
import { SqliteAiPromptRepository } from '../../server/infrastructure/database/SqliteAiPromptRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'

/** 当前测试独占的数据目录。 */
let temporaryDirectory: string
/** 当前测试数据库。 */
let database: SqliteDatabase
/** 被验证的提示词服务。 */
let service: AiPromptApplicationService
/** 测试使用的单调时间。 */
let timestamp: number

beforeEach(() => {
  temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-ai-prompts-test-'))
  database = new SqliteDatabase({ dataDirectory: temporaryDirectory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  timestamp = 2_000_000_000_000
  service = new AiPromptApplicationService({
    repository: new SqliteAiPromptRepository(database.getClient()),
    identifiers: { create: () => randomUUID() },
    clock: { now: () => timestamp++ },
  })
})

afterEach(() => {
  database.close()
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('全站 AI 提示词目录', () => {
  it('迁移初始化全部固定提示词并能按变量契约渲染', async () => {
    const prompts = await service.listWorkspaces()

    expect(prompts).toHaveLength(22)
    expect(prompts.map(prompt => prompt.code)).toEqual(expect.arrayContaining([
      'analysis.persona_memory_extract',
      'analysis.persona_memory_synthesize',
      'generation.article',
      'generation.article_images',
    ]))
    const interestPrompt = prompts.find(prompt => prompt.code === 'generation.interest_assessment')
    expect(interestPrompt?.activeVersion?.versionNo).toBe(3)
    expect(interestPrompt?.activeVersion?.userPromptTemplate).toContain('<附加提示词>{{sceneJson}}</附加提示词>')
    expect(interestPrompt?.variables.find(variable => variable.name === 'sceneJson')).toMatchObject({
      label: '附加提示词', description: 'JSON 字符串或 null',
    })
    expect(interestPrompt?.versions.map(version => version.versionNo)).toEqual([3, 2, 1])
    expect(prompts
      .filter(prompt => prompt.code !== 'generation.interest_assessment')
      .every(prompt => prompt.activeVersion?.versionNo === 1 && prompt.versions.length === 1)).toBe(true)
    for (const prompt of prompts) {
      const variables = Object.fromEntries(prompt.variables.map(variable => [variable.name, `测试-${variable.name}`]))
      const rendered = await service.render(prompt.code, variables)
      expect(rendered.versionId).toBe(prompt.activeVersion?.id)
      expect(`${rendered.systemPrompt}${rendered.userPrompt}`).not.toContain('{{')
    }
  })

  it('草稿保存后不生效，发布后形成新版本并保留历史', async () => {
    const initial = (await service.listWorkspaces()).find(prompt => prompt.code === 'generation.world_draft')!
    const initialRendered = await service.render(initial.code, { promptJson: '旧输入' })
    const draft = await service.saveDraft(initial.code, {
      baseVersionId: initial.activeVersion!.id,
      systemPromptTemplate: `${initial.activeVersion!.systemPromptTemplate}\n补充一条可维护规则。`,
      userPromptTemplate: '<用户明确世界>{{promptJson}}</用户明确世界>',
      changeSummary: '补充世界草稿规则',
    })

    expect(draft.draft?.changeSummary).toBe('补充世界草稿规则')
    await expect(service.render(initial.code, { promptJson: '旧输入' })).resolves.toMatchObject({
      versionId: initialRendered.versionId,
      versionNo: 1,
    })

    const published = await service.publishDraft(initial.code, { expectedDraftUpdatedAt: draft.draft!.updatedAt })
    const current = (await service.listWorkspaces()).find(prompt => prompt.code === initial.code)!
    expect(published.versionNo).toBe(2)
    expect(current.draft).toBeNull()
    expect(current.versions.map(version => version.versionNo)).toEqual([2, 1])
    await expect(service.render(initial.code, { promptJson: '新输入' })).resolves.toMatchObject({
      versionId: published.id,
      versionNo: 2,
    })
    await expect(service.render(initial.code, { promptJson: '旧任务输入' }, initialRendered.versionId)).resolves.toMatchObject({
      versionId: initialRendered.versionId,
      versionNo: 1,
    })
  })

  it('拒绝遗漏、未知或运行时不完整的模板变量', async () => {
    const initial = (await service.listWorkspaces()).find(prompt => prompt.code === 'generation.world_draft')!

    await expect(service.saveDraft(initial.code, {
      baseVersionId: initial.activeVersion!.id,
      systemPromptTemplate: initial.activeVersion!.systemPromptTemplate,
      userPromptTemplate: '<世界>{{unknown}}</世界>',
      changeSummary: '错误变量测试',
    })).rejects.toMatchObject({ code: 'AI_PROMPT_TEMPLATE_INVALID' })
    await expect(service.render(initial.code, {})).rejects.toMatchObject({ code: 'AI_PROMPT_VARIABLE_INVALID' })
  })
})
