import type {
  BatchEnabledStateInput,
  BatchLearningStatusInput,
  CreateGrowthInput,
  CreatePersonaFeedbackSourceInput,
  DeletePersonaFeedbackSourcesInput,
} from '../../../shared/schemas/learning'
import type {
  PersonaFeedbackSourceView,
  PersonaGrowthWorkspaceView,
  PersonaMemoryWorkspaceView,
  WorldGrowthWorkspaceView,
} from '../../../shared/types/learning'
import type { Clock } from '../../ports/Clock'
import type { ContentRepository } from '../../ports/ContentRepository'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { LearningRepository } from '../../ports/LearningRepository'
import { ApplicationError } from '../errors/ApplicationError'

/** 统一学习应用服务依赖。 */
export interface LearningApplicationServiceDependencies {
  /** 人物与世界存在性查询端口。 */
  content: Pick<ContentRepository, 'findPersona' | 'findWorld'>
  /** 成长、处理记录和记忆事实源。 */
  learning: LearningRepository
  /** UUID 生成端口。 */
  identifiers: IdentifierGenerator
  /** 可测试时钟。 */
  clock: Clock
}

/** 编排世界成长、人物成长和人物记忆的人工管理闭环。 */
export class LearningApplicationService {
  /**
   * 创建统一学习应用服务。
   * @param dependencies 内容存在性、学习事实、标识和时间端口。
   */
  constructor(private readonly dependencies: LearningApplicationServiceDependencies) {}

  /** @param worldId 世界 UUID。 @returns 世界资料和成长完整工作区。 */
  async getWorldGrowthWorkspace(worldId: string): Promise<WorldGrowthWorkspaceView> {
    await this.requireWorld(worldId)
    const [sources, growth] = await Promise.all([
      this.dependencies.learning.listWorldGrowthSources(worldId),
      this.dependencies.learning.listGrowth('world', worldId),
    ])
    return { sources, growth }
  }

  /** @param worldId 世界 UUID。 @param input 批量启用状态。 @returns 更新后的完整工作区。 */
  async updateWorldSourceStates(worldId: string, input: BatchEnabledStateInput): Promise<WorldGrowthWorkspaceView> {
    await this.requireWorld(worldId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.updateWorldGrowthSourceStates(
      worldId, ids, input.isEnabled, this.dependencies.clock.now(),
    )
    requireCompleteBatch(changes, ids.length, '部分世界资料不存在或不属于当前世界')
    return await this.getWorldGrowthWorkspace(worldId)
  }

  /** @param personaId 人物 UUID。 @returns 反馈资料和成长完整工作区。 */
  async getPersonaGrowthWorkspace(personaId: string): Promise<PersonaGrowthWorkspaceView> {
    await this.requirePersona(personaId)
    const [feedbackSources, growth] = await Promise.all([
      this.dependencies.learning.listPersonaFeedbackSources(personaId),
      this.dependencies.learning.listGrowth('persona', personaId),
    ])
    return { feedbackSources, growth }
  }

  /** @param personaId 人物 UUID。 @param input 人工反馈资料。 @returns 新建资料。 */
  async createPersonaFeedbackSource(personaId: string, input: CreatePersonaFeedbackSourceInput): Promise<PersonaFeedbackSourceView> {
    await this.requirePersona(personaId)
    const id = this.dependencies.identifiers.create()
    await this.dependencies.learning.createPersonaFeedbackSource({
      id,
      personaId,
      title: input.title,
      content: input.content,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      timestamp: this.dependencies.clock.now(),
    })
    const created = (await this.dependencies.learning.listPersonaFeedbackSources(personaId)).find(item => item.id === id)
    if (!created) throw new ApplicationError('PERSISTENCE_CONFLICT', '反馈资料创建后无法读取', 409)
    return created
  }

  /** @param personaId 人物 UUID。 @param input 批量启用状态。 @returns 更新后的完整工作区。 */
  async updatePersonaFeedbackSourceStates(personaId: string, input: BatchEnabledStateInput): Promise<PersonaGrowthWorkspaceView> {
    await this.requirePersona(personaId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.updatePersonaFeedbackSourceStates(
      personaId, ids, input.isEnabled, this.dependencies.clock.now(),
    )
    requireCompleteBatch(changes, ids.length, '部分反馈资料不存在、待删除或不属于当前人物')
    return await this.getPersonaGrowthWorkspace(personaId)
  }

  /** @param personaId 人物 UUID。 @param input 批量删除标识。 @returns 更新后的完整工作区。 */
  async deletePersonaFeedbackSources(personaId: string, input: DeletePersonaFeedbackSourcesInput): Promise<PersonaGrowthWorkspaceView> {
    await this.requirePersona(personaId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.deletePersonaFeedbackSources(
      personaId, ids, this.dependencies.clock.now(),
    )
    requireCompleteBatch(changes, ids.length, '部分反馈资料不存在、待删除或不属于当前人物')
    return await this.getPersonaGrowthWorkspace(personaId)
  }

  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @param input 人工成长候选。 @returns 更新后的成长工作区。 */
  async createGrowth(subjectType: 'world' | 'persona', subjectId: string, input: CreateGrowthInput): Promise<WorldGrowthWorkspaceView | PersonaGrowthWorkspaceView> {
    await this.requireSubject(subjectType, subjectId)
    const sourceIds = uniqueIds(input.sourceIds)
    await this.validateGrowthSources(subjectType, subjectId, sourceIds)
    await this.dependencies.learning.createGrowth({
      id: this.dependencies.identifiers.create(),
      revisionId: this.dependencies.identifiers.create(),
      subjectType,
      subjectId,
      content: input.content,
      scope: input.scope,
      importance: input.importance,
      sourceIds,
      timestamp: this.dependencies.clock.now(),
    })
    return subjectType === 'world'
      ? await this.getWorldGrowthWorkspace(subjectId)
      : await this.getPersonaGrowthWorkspace(subjectId)
  }

  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @param input 批量目标状态。 @returns 更新后的成长工作区。 */
  async updateGrowthStates(subjectType: 'world' | 'persona', subjectId: string, input: BatchLearningStatusInput): Promise<WorldGrowthWorkspaceView | PersonaGrowthWorkspaceView> {
    await this.requireSubject(subjectType, subjectId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.updateGrowthStates(
      subjectType, subjectId, ids, input.status, this.dependencies.clock.now(),
    )
    requireCompleteBatch(changes, ids.length, '部分成长不存在、不属于当前对象或状态不允许该操作')
    return subjectType === 'world'
      ? await this.getWorldGrowthWorkspace(subjectId)
      : await this.getPersonaGrowthWorkspace(subjectId)
  }

  /** @param personaId 人物 UUID。 @returns 处理记录和记忆完整工作区。 */
  async getPersonaMemoryWorkspace(personaId: string): Promise<PersonaMemoryWorkspaceView> {
    await this.requirePersona(personaId)
    const [operationRecords, memories] = await Promise.all([
      this.dependencies.learning.listPersonaOperationRecords(personaId),
      this.dependencies.learning.listMemories(personaId),
    ])
    return { operationRecords, memories }
  }

  /** @param personaId 人物 UUID。 @param input 处理记录批量启用状态。 @returns 更新后的记忆工作区。 */
  async updateOperationRecordStates(personaId: string, input: BatchEnabledStateInput): Promise<PersonaMemoryWorkspaceView> {
    await this.requirePersona(personaId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.updatePersonaOperationRecordStates(
      personaId, ids, input.isEnabled, this.dependencies.clock.now(),
    )
    requireCompleteBatch(changes, ids.length, '部分处理记录不存在或不属于当前人物')
    return await this.getPersonaMemoryWorkspace(personaId)
  }

  /** @param personaId 人物 UUID。 @param input 记忆批量目标状态。 @returns 更新后的记忆工作区。 */
  async updateMemoryStates(personaId: string, input: BatchLearningStatusInput): Promise<PersonaMemoryWorkspaceView> {
    await this.requirePersona(personaId)
    const ids = uniqueIds(input.ids)
    const changes = await this.dependencies.learning.updateMemoryStates(
      personaId, ids, input.status, this.dependencies.clock.now(),
    )
    requireCompleteBatch(changes, ids.length, '部分记忆不存在、不属于当前人物或状态不允许该操作')
    return await this.getPersonaMemoryWorkspace(personaId)
  }

  /** @param personaId 人物 UUID。 @param memoryId 记忆 UUID。 @returns 由记忆显式创建的人物反馈资料。 */
  async convertMemoryToFeedbackSource(personaId: string, memoryId: string): Promise<PersonaFeedbackSourceView> {
    await this.requirePersona(personaId)
    const created = await this.dependencies.learning.convertMemoryToFeedbackSource(
      personaId, memoryId, this.dependencies.identifiers.create(), this.dependencies.clock.now(),
    )
    if (!created) throw new ApplicationError('RESOURCE_NOT_FOUND', '人物记忆不存在', 404)
    return created
  }

  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @returns 对象存在时结束。 */
  private async requireSubject(subjectType: 'world' | 'persona', subjectId: string): Promise<void> {
    if (subjectType === 'world') await this.requireWorld(subjectId)
    else await this.requirePersona(subjectId)
  }

  /** @param worldId 世界 UUID。 @returns 世界存在时结束。 */
  private async requireWorld(worldId: string): Promise<void> {
    if (!await this.dependencies.content.findWorld(worldId)) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '世界不存在', 404)
    }
  }

  /** @param personaId 人物 UUID。 @returns 人物存在时结束。 */
  private async requirePersona(personaId: string): Promise<void> {
    if (!await this.dependencies.content.findPersona(personaId)) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '人物不存在', 404)
    }
  }

  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @param sourceIds 来源 UUID。 @returns 来源全部归属当前对象时结束。 */
  private async validateGrowthSources(subjectType: 'world' | 'persona', subjectId: string, sourceIds: string[]): Promise<void> {
    if (sourceIds.length === 0) return
    const availableIds = new Set(subjectType === 'world'
      ? (await this.dependencies.learning.listWorldGrowthSources(subjectId)).map(item => item.id)
      : (await this.dependencies.learning.listPersonaFeedbackSources(subjectId)).map(item => item.id))
    if (sourceIds.some(id => !availableIds.has(id))) {
      throw new ApplicationError('RESOURCE_SCOPE_MISMATCH', '成长来源不存在或不属于当前对象', 409)
    }
  }
}

/** @param ids 可能重复的 UUID。 @returns 保持首次顺序的唯一 UUID。 */
function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)]
}

/** @param changes 实际处理数量。 @param expected 期望数量。 @param message 冲突说明。 @returns 数量一致时结束。 */
function requireCompleteBatch(changes: number, expected: number, message: string): void {
  if (changes !== expected) throw new ApplicationError('RESOURCE_SCOPE_MISMATCH', message, 409)
}
