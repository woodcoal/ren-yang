import type { CreateSoulDraftFromVersionInput, SaveSoulDraftInput } from '../../../shared/schemas/content'
import type { SoulDraftView, SoulVersionView, SoulWorkspaceView } from '../../../shared/types/content'
import type { SoulDraftRecord, SoulSubjectType, SoulVersionRecord } from '../../domain/content/ContentModels'
import { normalizeSoulSnapshot, SoulStructureError } from '../../domain/content/SoulRules'
import type { Clock } from '../../ports/Clock'
import type { ContentRepository } from '../../ports/ContentRepository'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { SoulRepository } from '../../ports/SoulRepository'
import type { TokenCounter } from '../../ports/TokenCounter'
import { ApplicationError } from '../errors/ApplicationError'

/** 灵魂发布时使用的最小预算配置。 */
export interface SoulTokenBudgets {
  /** 世界灵魂运行摘要最多可占 Token。 */
  world: number
  /** 人物灵魂运行摘要最多可占 Token。 */
  persona: number
}

/** 灵魂应用服务的全部外部依赖。 */
export interface SoulApplicationServiceDependencies {
  /** 模拟对象元数据事实源。 */
  content: Pick<ContentRepository, 'findWorld' | 'findPersona'>
  /** 灵魂草稿与版本事实源。 */
  souls: SoulRepository
  /** UUID 生成端口。 */
  identifiers: IdentifierGenerator
  /** 可测试时钟。 */
  clock: Clock
  /** 发布时 Token 计数端口。 */
  tokenCounter: TokenCounter
  /** 世界与人物运行摘要预算。 */
  tokenBudgets: SoulTokenBudgets
}

/** 管理世界与人物共用的灵魂草稿和不可变发布版本。 */
export class SoulApplicationService {
  /**
   * 创建灵魂应用服务。
   * @param dependencies 元数据、灵魂事实源、标识、时间、计数和预算端口。
   */
  constructor(private readonly dependencies: SoulApplicationServiceDependencies) {}

  /**
   * 查询指定模拟对象的灵魂工作区。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @returns 当前版本、草稿和历史版本。
   */
  async getSoul(subjectType: SoulSubjectType, subjectId: string): Promise<SoulWorkspaceView> {
    const activeVersionId = await this.requireSubject(subjectType, subjectId)
    const [draft, versions] = await Promise.all([
      this.dependencies.souls.findSoulDraft(subjectType, subjectId),
      this.dependencies.souls.listSoulVersions(subjectType, subjectId),
    ])
    return {
      subjectType,
      subjectId,
      activeVersion: versions.find(version => version.id === activeVersionId) ?? null,
      draft: draft ? toSoulDraftView(draft) : null,
      versions: versions.map(toSoulVersionView),
    }
  }

  /**
   * 创建或覆盖指定对象当前唯一灵魂草稿。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @param input 基础版本、完整章节、运行摘要和修改说明。
   * @returns 保存后的草稿。
   */
  async saveDraft(subjectType: SoulSubjectType, subjectId: string, input: SaveSoulDraftInput): Promise<SoulDraftView> {
    await this.requireSubject(subjectType, subjectId)
    await this.requireOptionalBaseVersion(subjectType, subjectId, input.baseVersionId)
    const existing = await this.dependencies.souls.findSoulDraft(subjectType, subjectId)
    let snapshot
    try {
      snapshot = normalizeSoulSnapshot(input.snapshot)
    }
    catch (error: unknown) {
      if (error instanceof SoulStructureError) {
        throw new ApplicationError('INVALID_SOUL_STRUCTURE', error.message, 422)
      }
      throw error
    }
    const timestamp = this.dependencies.clock.now()
    const draft = await this.dependencies.souls.saveSoulDraft({
      id: existing?.id ?? this.dependencies.identifiers.create(),
      subjectType,
      subjectId,
      baseVersionId: input.baseVersionId,
      snapshot,
      changeSummary: input.changeSummary,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
    return toSoulDraftView(draft)
  }

  /**
   * 删除指定对象尚未发布的灵魂草稿。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @returns 无返回值。
   */
  async deleteDraft(subjectType: SoulSubjectType, subjectId: string): Promise<void> {
    await this.requireSubject(subjectType, subjectId)
    const deleted = await this.dependencies.souls.deleteSoulDraft(subjectType, subjectId)
    if (deleted !== 1) {
      throw new ApplicationError('SOUL_DRAFT_NOT_FOUND', '当前没有可删除的灵魂草稿', 404)
    }
  }

  /**
   * 从指定历史发布版本完整复制一份新的可编辑草稿。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @param input 待复制的历史版本标识。
   * @returns 新的当前草稿。
   */
  async createDraftFromVersion(
    subjectType: SoulSubjectType,
    subjectId: string,
    input: CreateSoulDraftFromVersionInput,
  ): Promise<SoulDraftView> {
    await this.requireSubject(subjectType, subjectId)
    const version = await this.requireOwnedVersion(subjectType, subjectId, input.versionId)
    return await this.saveDraft(subjectType, subjectId, {
      baseVersionId: version.id,
      snapshot: version.snapshot,
      changeSummary: `基于“${version.changeSummary}”继续修改`,
    })
  }

  /**
   * 校验预算并原子发布当前草稿。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @returns 新发布的不可变灵魂版本。
   */
  async publishDraft(subjectType: SoulSubjectType, subjectId: string): Promise<SoulVersionView> {
    await this.requireSubject(subjectType, subjectId)
    const draft = await this.dependencies.souls.findSoulDraft(subjectType, subjectId)
    if (!draft) {
      throw new ApplicationError('SOUL_DRAFT_NOT_FOUND', '当前没有可发布的灵魂草稿', 404)
    }
    const count = this.dependencies.tokenCounter.count(null, draft.snapshot.runtimeSummary)
    const budget = this.dependencies.tokenBudgets[subjectType]
    if (count.tokens > budget) {
      throw new ApplicationError(
        'SOUL_TOKEN_BUDGET_EXCEEDED',
        `运行摘要预计 ${count.tokens} Token，超过当前 ${budget} Token 限制，请先压缩摘要`,
        422,
      )
    }
    const version = await this.dependencies.souls.publishSoulDraft({
      draftId: draft.id,
      versionId: this.dependencies.identifiers.create(),
      runtimeTokenCount: count.tokens,
      tokenCounter: count.counter,
      timestamp: this.dependencies.clock.now(),
    })
    if (!version) {
      throw new ApplicationError('SOUL_DRAFT_CONFLICT', '草稿已经变化，请刷新后重试', 409)
    }
    return toSoulVersionView(version)
  }

  /**
   * 校验对象存在并返回当前灵魂版本标识。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @returns 当前灵魂版本标识或 null。
   */
  private async requireSubject(subjectType: SoulSubjectType, subjectId: string): Promise<string | null> {
    const subject = subjectType === 'world'
      ? await this.dependencies.content.findWorld(subjectId)
      : await this.dependencies.content.findPersona(subjectId)
    if (!subject) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', subjectType === 'world' ? '世界不存在' : '人物不存在', 404)
    }
    return subject.activeVersionId
  }

  /**
   * 校验可选基础版本属于指定模拟对象。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @param versionId 可选基础版本 UUID。
   * @returns 无返回值。
   */
  private async requireOptionalBaseVersion(
    subjectType: SoulSubjectType,
    subjectId: string,
    versionId: string | null,
  ): Promise<void> {
    if (versionId === null) return
    await this.requireOwnedVersion(subjectType, subjectId, versionId)
  }

  /**
   * 查询并校验灵魂版本归属。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @param versionId 版本 UUID。
   * @returns 归属正确的灵魂版本。
   */
  private async requireOwnedVersion(
    subjectType: SoulSubjectType,
    subjectId: string,
    versionId: string,
  ): Promise<SoulVersionRecord> {
    const version = await this.dependencies.souls.findSoulVersion(versionId)
    if (!version || version.subjectType !== subjectType || version.subjectId !== subjectId) {
      throw new ApplicationError('VERSION_CONFLICT', '基础灵魂版本不属于当前对象', 409)
    }
    return version
  }
}

/**
 * 把领域草稿复制为共享公开视图。
 * @param draft 领域草稿。
 * @returns 不暴露持久层字段的草稿视图。
 */
function toSoulDraftView(draft: SoulDraftRecord): SoulDraftView {
  return { ...draft, snapshot: normalizeSoulSnapshot(draft.snapshot) }
}

/**
 * 把领域版本复制为共享公开视图。
 * @param version 领域灵魂版本。
 * @returns 不暴露持久层字段的版本视图。
 */
function toSoulVersionView(version: SoulVersionRecord): SoulVersionView {
  return { ...version, snapshot: normalizeSoulSnapshot(version.snapshot) }
}
