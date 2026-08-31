import type { PublishAiPromptDraftInput, SaveAiPromptDraftInput } from '../../../shared/schemas/aiPrompt'
import type { AiPromptVersionView, AiPromptWorkspaceView, RenderedAiPrompt, RenderedAiPromptForTest } from '../../../shared/types/aiPrompt'
import type { AiPromptDefinitionRecord, AiPromptRepository } from '../../ports/AiPromptRepository'
import type { Clock } from '../../ports/Clock'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import { ApplicationError } from '../errors/ApplicationError'

/** AI 提示词管理与运行时渲染依赖。 */
export interface AiPromptApplicationServiceDependencies {
  /** 固定定义、草稿和版本事实源。 */
  repository: AiPromptRepository
  /** 新草稿与版本 UUID 生成端口。 */
  identifiers: IdentifierGenerator
  /** 保存和发布使用的可测试时钟。 */
  clock: Clock
}

/** 统一管理并渲染全站 AI 提示词。 */
export class AiPromptApplicationService {
  /**
   * 创建 AI 提示词应用服务。
   * @param dependencies 仓储、标识和时钟端口。
   */
  constructor(private readonly dependencies: AiPromptApplicationServiceDependencies) {}

  /**
   * 读取全部提示词、当前版本、草稿和历史。
   * @returns 按固定定义顺序排列的管理工作区。
   */
  async listWorkspaces(): Promise<AiPromptWorkspaceView[]> {
    const definitions = await this.dependencies.repository.listDefinitions()
    return await Promise.all(definitions.map(definition => this.toWorkspace(definition)))
  }

  /**
   * 保存不会立即影响新 AI 操作的草稿。
   * @param code 提示词稳定编码。
   * @param input 完整模板、基础版本与修改说明。
   * @returns 保存后的完整工作区。
   */
  async saveDraft(code: string, input: SaveAiPromptDraftInput): Promise<AiPromptWorkspaceView> {
    const definition = await this.requireDefinition(code)
    if (definition.activeVersionId !== input.baseVersionId) {
      throw new ApplicationError('VERSION_CONFLICT', '当前已发布版本已经变化，请刷新后重新编辑', 409)
    }
    const normalizedSystemTemplate = normalizeSystemTemplate(definition, input.systemPromptTemplate)
    validateTemplateContract(definition, normalizedSystemTemplate, input.userPromptTemplate)
    await this.dependencies.repository.saveDraft({
      id: this.dependencies.identifiers.create(),
      promptCode: code,
      baseVersionId: input.baseVersionId,
      systemPromptTemplate: normalizedSystemTemplate,
      userPromptTemplate: input.userPromptTemplate,
      changeSummary: input.changeSummary,
      timestamp: this.dependencies.clock.now(),
    })
    return await this.toWorkspace(definition)
  }

  /**
   * 删除尚未发布的提示词草稿。
   * @param code 提示词稳定编码。
   * @returns 删除后的完整工作区。
   */
  async deleteDraft(code: string): Promise<AiPromptWorkspaceView> {
    const definition = await this.requireDefinition(code)
    if (!await this.dependencies.repository.deleteDraft(code)) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '当前提示词没有可删除的草稿', 404)
    }
    return await this.toWorkspace(definition)
  }

  /**
   * 把当前草稿发布为新不可变版本并影响之后的新 AI 操作。
   * @param code 提示词稳定编码。
   * @param input 草稿更新时间并发保护参数。
   * @returns 新发布版本。
   */
  async publishDraft(code: string, input: PublishAiPromptDraftInput): Promise<AiPromptVersionView> {
    await this.requireDefinition(code)
    const published = await this.dependencies.repository.publishDraft(
      code,
      input.expectedDraftUpdatedAt,
      this.dependencies.identifiers.create(),
      this.dependencies.clock.now(),
    )
    if (!published) {
      throw new ApplicationError('VERSION_CONFLICT', '草稿或已发布版本已经变化，请刷新后重试', 409)
    }
    return published
  }

  /**
   * 固定一组新任务后续必须使用的已发布提示词版本。
   * @param codes 新任务可能调用的提示词稳定编码。
   * @returns 编码到不可变版本 UUID 的快照。
   */
  async snapshotPublishedVersions(codes: string[]): Promise<Record<string, string>> {
    const uniqueCodes = [...new Set(codes)]
    const entries = await Promise.all(uniqueCodes.map(async (code) => {
      const definition = await this.requireDefinition(code)
      if (!definition.activeVersionId) {
        throw new ApplicationError('AI_PROMPT_NOT_PUBLISHED', `提示词“${definition.name}”尚未发布，不能执行 AI 操作`, 409)
      }
      return [code, definition.activeVersionId] as const
    }))
    return Object.fromEntries(entries)
  }

  /**
   * 使用当前已发布版本或指定历史版本渲染最终提示词。
   * @param code 提示词稳定编码。
   * @param variables 业务调用提供的完整变量值。
   * @param versionId 任务已固定的历史版本 UUID；省略时使用当前发布版本。
   * @returns 带实际版本标识的最终提示词。
   */
  async render(code: string, variables: Record<string, string>, versionId?: string): Promise<RenderedAiPrompt> {
    const definition = await this.requireDefinition(code)
    const targetVersionId = versionId ?? definition.activeVersionId
    if (!targetVersionId) {
      throw new ApplicationError('AI_PROMPT_NOT_PUBLISHED', `提示词“${definition.name}”尚未发布，不能执行 AI 操作`, 409)
    }
    const version = await this.dependencies.repository.findVersion(targetVersionId)
    if (!version || version.promptCode !== code) {
      throw new ApplicationError('AI_PROMPT_VERSION_MISSING', `提示词“${definition.name}”的固定版本不存在`, 409)
    }
    validateRenderVariables(definition, variables)
    return {
      code,
      versionId: version.id,
      versionNo: version.versionNo,
      systemPrompt: version.systemPromptTemplate === null ? '' : renderTemplate(version.systemPromptTemplate, variables),
      userPrompt: renderTemplate(version.userPromptTemplate, variables),
    }
  }

  /**
   * 为管理员算法测试优先渲染当前草稿，无草稿时退回当前发布版本。
   * @param code 提示词稳定编码。
   * @param variables 业务测试提供的完整变量值。
   * @returns 实际来源、版本号及完成变量替换后的提示词。
   * @remarks 该方法只读取模板，不保存、发布或修改任何提示词。
   */
  async renderDraftPreferred(code: string, variables: Record<string, string>): Promise<RenderedAiPromptForTest> {
    const definition = await this.requireDefinition(code)
    validateRenderVariables(definition, variables)
    const draft = await this.dependencies.repository.findDraft(code)
    if (draft) {
      return {
        code,
        source: 'draft',
        versionNo: null,
        systemPrompt: draft.systemPromptTemplate === null ? '' : renderTemplate(draft.systemPromptTemplate, variables),
        userPrompt: renderTemplate(draft.userPromptTemplate, variables),
      }
    }
    const rendered = await this.render(code, variables)
    return {
      code,
      source: 'published',
      versionNo: rendered.versionNo,
      systemPrompt: rendered.systemPrompt,
      userPrompt: rendered.userPrompt,
    }
  }

  /**
   * 读取一个存在的固定提示词定义。
   * @param code 提示词稳定编码。
   * @returns 固定定义。
   */
  private async requireDefinition(code: string): Promise<AiPromptDefinitionRecord> {
    const definition = await this.dependencies.repository.findDefinition(code)
    if (!definition) throw new ApplicationError('RESOURCE_NOT_FOUND', '提示词不存在', 404)
    return definition
  }

  /**
   * 合并固定定义、草稿和全部不可变版本。
   * @param definition 固定提示词定义。
   * @returns 管理界面完整工作区。
   */
  private async toWorkspace(definition: AiPromptDefinitionRecord): Promise<AiPromptWorkspaceView> {
    const [draft, versions] = await Promise.all([
      this.dependencies.repository.findDraft(definition.code),
      this.dependencies.repository.listVersions(definition.code),
    ])
    return {
      ...definition,
      activeVersion: versions.find(version => version.id === definition.activeVersionId) ?? null,
      draft,
      versions,
    }
  }
}

/**
 * 把模型形态与系统模板归一为唯一合法表达。
 * @param definition 固定提示词定义。
 * @param systemPromptTemplate 表单提交的系统模板。
 * @returns 文本提示词的原值，或图片提示词固定的 null。
 */
function normalizeSystemTemplate(definition: AiPromptDefinitionRecord, systemPromptTemplate: string | null): string | null {
  if (definition.kind === 'image') return null
  if (systemPromptTemplate === null || systemPromptTemplate.trim().length === 0) {
    throw new ApplicationError('VALIDATION_FAILED', '文本模型提示词的系统模板不能为空', 400)
  }
  return systemPromptTemplate
}

/**
 * 校验模板只引用定义允许的变量，并且没有遗漏任何变量。
 * @param definition 固定提示词定义。
 * @param systemPromptTemplate 已按模型形态归一的系统模板。
 * @param userPromptTemplate 用户或图片提示模板。
 * @returns 契约有效时无返回值。
 */
function validateTemplateContract(
  definition: AiPromptDefinitionRecord,
  systemPromptTemplate: string | null,
  userPromptTemplate: string,
): void {
  const declared = new Set(definition.variables.map(variable => variable.name))
  const referenced = new Set([
    ...extractTemplateVariables(systemPromptTemplate ?? ''),
    ...extractTemplateVariables(userPromptTemplate),
  ])
  const unknown = [...referenced].filter(name => !declared.has(name))
  const missing = [...declared].filter(name => !referenced.has(name))
  if (unknown.length > 0 || missing.length > 0) {
    throw new ApplicationError('AI_PROMPT_TEMPLATE_INVALID', '提示词模板变量与固定契约不一致', 400, {
      unknownVariables: unknown,
      missingVariables: missing,
    })
  }
}

/**
 * 校验运行时变量与固定定义完全一致。
 * @param definition 固定提示词定义。
 * @param variables 业务模块提供的变量。
 * @returns 契约有效时无返回值。
 */
function validateRenderVariables(definition: AiPromptDefinitionRecord, variables: Record<string, string>): void {
  const declared = new Set(definition.variables.map(variable => variable.name))
  const provided = new Set(Object.keys(variables))
  const missing = [...declared].filter(name => !provided.has(name))
  const unknown = [...provided].filter(name => !declared.has(name))
  if (missing.length > 0 || unknown.length > 0 || Object.values(variables).some(value => typeof value !== 'string')) {
    throw new ApplicationError('AI_PROMPT_VARIABLE_INVALID', `提示词“${definition.name}”的运行变量不完整`, 500, {
      missingVariables: missing,
      unknownVariables: unknown,
    })
  }
}

/**
 * 提取模板中的双花括号变量，并拒绝无法识别的未闭合占位符。
 * @param template 待检查模板。
 * @returns 按出现顺序去重后的变量名。
 */
function extractTemplateVariables(template: string): string[] {
  const names = [...template.matchAll(/\{\{([a-z][a-zA-Z0-9_]*)\}\}/g)].map(match => match[1]!)
  const stripped = template.replace(/\{\{[a-z][a-zA-Z0-9_]*\}\}/g, '')
  if (stripped.includes('{{') || stripped.includes('}}')) {
    throw new ApplicationError('AI_PROMPT_TEMPLATE_INVALID', '提示词模板包含无效或未闭合的变量占位符', 400)
  }
  return [...new Set(names)]
}

/**
 * 对经过契约校验的模板执行无转义纯文本替换。
 * @param template 提示词模板。
 * @param variables 已完整校验的变量值。
 * @returns 最终发送给模型的文本。
 */
function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{([a-z][a-zA-Z0-9_]*)\}\}/g, (_placeholder, name: string) => variables[name]!)
}
