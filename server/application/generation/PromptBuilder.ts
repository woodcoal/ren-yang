import type { ArticleOutput, ArtifactOutputFormat, DocumentSpec, ImageVisualBrief } from '../../../shared/schemas/generation'
import type { EvidenceSnapshotRecord } from '../../domain/generation/GenerationModels'
import type { PersonaSnapshot, WorldSnapshot } from '../../domain/content/ContentModels'

/** 生成模块使用的固定提示词编码。 */
export const GENERATION_PROMPT_CODES = {
  worldDraft: 'generation.world_draft',
  interestAssessment: 'generation.interest_assessment',
  article: 'generation.article',
  articleImages: 'generation.article_images',
  documentPlan: 'generation.document_plan',
  textBlock: 'generation.text_block',
  imageBlock: 'generation.image_block',
  jsonRetry: 'generation.json_retry',
} as const

/** 构建提示所需的固定运行上下文。 */
export interface PromptContext {
  /** 当前已发布人物灵魂。 */
  persona: PersonaSnapshot
  /** 可选已发布世界灵魂。 */
  world: WorldSnapshot | null
  /** 创建运行时固定的当前世界成长提示词。 */
  worldGrowthPrompt: string | null
  /** 创建运行时固定的当前人物成长提示词。 */
  personaGrowthPrompt: string | null
  /** 创建运行时固定的当前人物记忆提示词。 */
  personaMemoryPrompt: string | null
  /** 只影响当前运行的历史场景对象或整批附加提示词。 */
  scene: unknown
  /** 经过范围与预算筛选的证据。 */
  evidence: EvidenceSnapshotRecord[]
}

/**
 * 构建世界候选草稿模板变量。
 * @param prompt 用户对世界背景、规则和风格的明确描述。
 * @returns 与固定提示词变量契约完全一致的字符串映射。
 */
export function buildWorldDraftPromptVariables(prompt: string): Record<string, string> {
  return { promptJson: JSON.stringify(prompt) }
}

/**
 * 构建兴趣判断模板变量。
 * @param context 固定人物、世界、场景和证据快照。
 * @param content 待判断内容。
 * @returns 与固定提示词变量契约完全一致的字符串映射。
 */
export function buildInterestPromptVariables(context: PromptContext, content: string): Record<string, string> {
  return { ...buildContextVariables(context), contentJson: JSON.stringify(content) }
}

/**
 * 构建批量兴趣判定模板变量，并把变化文本固定放在公共人物前缀之后。
 * @param context 固定人物、世界和证据快照。
 * @param items 保持客户端输入顺序的稳定编号与文本。
 * @returns 与兴趣算法提示词变量契约一致的字符串映射。
 */
export function buildInterestBatchPromptVariables(
  context: PromptContext,
  items: Array<{ itemId: string, text: string }>,
): Record<string, string> {
  return { ...buildContextVariables(context), contentJson: JSON.stringify(items) }
}

/**
 * 构建一次直出文章模板变量。
 * @param context 固定人物、世界、场景和证据快照。
 * @param requirement 用户明确的创作条件。
 * @param outputFormat 最终 HTML 或纯文本输出格式。
 * @returns 与固定提示词变量契约完全一致的字符串映射。
 */
export function buildArticlePromptVariables(
  context: PromptContext,
  requirement: string,
  outputFormat: ArtifactOutputFormat,
): Record<string, string> {
  return {
    ...buildContextVariables(context),
    requirementJson: JSON.stringify(requirement),
    outputFormat: JSON.stringify(outputFormat),
  }
}

/**
 * 构建文章后置配图分析模板变量。
 * @param article 已通过结构校验的最终文章。
 * @param imageCount 用户要求的准确图片数量。
 * @returns 与固定提示词变量契约完全一致的字符串映射。
 */
export function buildArticleImagesPromptVariables(article: ArticleOutput, imageCount: number): Record<string, string> {
  return {
    articleJson: JSON.stringify(article),
    imageCount: String(imageCount),
  }
}

/**
 * 构建文档规格规划模板变量。
 * @param context 固定人物、世界、场景和证据快照。
 * @param requirement 用户创作要求。
 * @param guidance 格式模板指导。
 * @param minimumBlocks 最少文档块数。
 * @param maximumBlocks 最大文档块数。
 * @param allowImages 本次运行是否允许图片块。
 * @returns 与固定提示词变量契约完全一致的字符串映射。
 */
export function buildDocumentPlanPromptVariables(
  context: PromptContext,
  requirement: string,
  guidance: string,
  minimumBlocks: number,
  maximumBlocks: number,
  allowImages: boolean,
): Record<string, string> {
  return {
    ...buildContextVariables(context),
    requirementJson: JSON.stringify(requirement),
    guidanceJson: JSON.stringify(guidance),
    minimumBlocks: String(minimumBlocks),
    maximumBlocks: String(maximumBlocks),
    allowImages: String(allowImages),
  }
}

/**
 * 构建图片块生成模板变量。
 * @param context 固定人物、世界、场景和证据快照。
 * @param brief 已确认视觉简报。
 * @param previousOutputs 前置成功文字块。
 * @returns 与固定提示词变量契约完全一致的字符串映射。
 */
export function buildImagePromptVariables(
  context: PromptContext,
  brief: ImageVisualBrief,
  previousOutputs: Array<{ key: string, text: string }>,
): Record<string, string> {
  return {
    personaPromptJson: JSON.stringify(context.persona.promptText),
    worldPromptJson: JSON.stringify(context.world?.promptText ?? null),
    briefJson: JSON.stringify(brief),
    previousOutputsJson: JSON.stringify(previousOutputs),
    negativePromptJson: JSON.stringify(brief.negativePrompt),
  }
}

/**
 * 构建单个文字块生成模板变量。
 * @param context 固定人物、世界、场景和证据快照。
 * @param documentSpec 已确认文档规格。
 * @param block 当前块规格。
 * @param previousOutputs 已成功前置块的纯文本。
 * @returns 与固定提示词变量契约完全一致的字符串映射。
 */
export function buildTextBlockPromptVariables(
  context: PromptContext,
  documentSpec: DocumentSpec,
  block: DocumentSpec['blocks'][number],
  previousOutputs: Array<{ key: string, text: string }>,
): Record<string, string> {
  return {
    ...buildContextVariables(context),
    instructionJson: JSON.stringify(block.instruction),
    documentSpecJson: JSON.stringify(documentSpec),
    previousOutputsJson: JSON.stringify(previousOutputs),
  }
}

/**
 * 把固定上下文转换为各类任务共享的模板变量。
 * @param context 已固定的心智、场景和证据。
 * @returns 公共模板变量。
 */
function buildContextVariables(context: PromptContext): Record<string, string> {
  const evidence = groupEvidence(context.evidence)
  return {
    personaPromptJson: JSON.stringify(context.persona.promptText),
    worldPromptJson: JSON.stringify(context.world?.promptText ?? null),
    worldGrowthPromptJson: JSON.stringify(context.worldGrowthPrompt),
    personaGrowthPromptJson: JSON.stringify(context.personaGrowthPrompt),
    personaMemoryPromptJson: JSON.stringify(context.personaMemoryPrompt),
    worldGrowthEvidenceJson: serializeEvidenceItems(evidence.worldGrowth),
    personaGrowthEvidenceJson: serializeEvidenceItems(evidence.personaGrowth),
    personaMemoryEvidenceJson: serializeEvidenceItems(evidence.personaMemory),
    sourceEvidenceJson: serializeEvidenceItems(evidence.source),
    sceneJson: JSON.stringify(context.scene),
  }
}

/** 按预算分类整理后的证据集合。 */
interface GroupedEvidence {
  /** 世界成长证据。 */
  worldGrowth: EvidenceSnapshotRecord[]
  /** 人物成长证据。 */
  personaGrowth: EvidenceSnapshotRecord[]
  /** 人物记忆证据。 */
  personaMemory: EvidenceSnapshotRecord[]
  /** 普通资料证据。 */
  source: EvidenceSnapshotRecord[]
}

/**
 * 按运行预算分类证据，避免不同长期信息混入同一变量。
 * @param evidence 运行创建时固定的证据快照。
 * @returns 四个明确分类的证据集合。
 */
function groupEvidence(evidence: EvidenceSnapshotRecord[]): GroupedEvidence {
  const grouped: GroupedEvidence = { worldGrowth: [], personaGrowth: [], personaMemory: [], source: [] }
  for (const item of evidence) {
    const category = typeof item.metadata.category === 'string'
      ? item.metadata.category
      : item.role === 'memory' ? 'persona_memory' : item.role === 'growth' ? 'persona_growth' : 'source'
    if (category === 'world_growth') grouped.worldGrowth.push(item)
    else if (category === 'persona_growth') grouped.personaGrowth.push(item)
    else if (category === 'persona_memory') grouped.personaMemory.push(item)
    else grouped.source.push(item)
  }
  return grouped
}

/**
 * 只序列化模型需要的证据字段。
 * @param items 同一预算分类的证据。
 * @returns JSON 数组字符串。
 */
function serializeEvidenceItems(items: EvidenceSnapshotRecord[]): string {
  return JSON.stringify(items.map(item => ({
    id: typeof item.metadata.promptEvidenceId === 'string' ? item.metadata.promptEvidenceId : item.id,
    entityId: typeof item.metadata.entityId === 'string' ? item.metadata.entityId : item.sourceId,
    role: item.role,
    content: item.content,
  })))
}
