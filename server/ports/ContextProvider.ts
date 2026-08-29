import type { OpenVikingCapabilityView } from '../../shared/types/context'

/** 本地检索返回且尚未复制到运行的证据候选。 */
export interface EvidenceCandidate {
  sourceId: string | null
  chunkId: string | null
  role: 'canon_fact' | 'reference' | 'style_sample' | 'growth' | 'memory'
  heading: string | null
  content: string
  contentHash: string
  priority: number
}

/** 新运行完成上下文选择和检索后的固定结果。 */
export interface ContextSearchResult {
  /** 当前运行必须持久化且后续不得改变的提供器。 */
  provider: 'sqlite_fts5' | 'openviking'
  /** 已限定人物和世界范围的证据候选。 */
  candidates: EvidenceCandidate[]
}

/** 运行证据检索请求。 */
export interface EvidenceSearchRequest {
  personaId: string
  worldId: string | null
  query: string
  limit: number
}

/** 可替换的上下文检索端口。 */
export interface ContextProvider {
  /** @returns 当前新运行实际使用的上下文提供器。 */
  getProvider(): 'sqlite_fts5' | 'openviking'
  /** @returns OpenViking 非敏感配置，即使当前使用本地检索也可展示。 */
  getOpenVikingCapability(): OpenVikingCapabilityView
  /**
   * 在人物和世界已关联资料中检索证据。
   * @param request 目标范围、查询和上限。
   * @returns 已按证据角色、关联优先级和相关性排序的候选。
   */
  search(request: EvidenceSearchRequest): Promise<ContextSearchResult>
}

/** 上下文检索失败；同一运行不得静默切换另一提供器。 */
export class ContextProviderError extends Error {
  /**
   * 创建稳定上下文异常。
   * @param message 已脱敏原因。
   */
  constructor(message: string) {
    super(message)
    this.name = 'ContextProviderError'
  }
}
