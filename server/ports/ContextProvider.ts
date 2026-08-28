/** 本地检索返回且尚未复制到运行的证据候选。 */
export interface EvidenceCandidate {
  sourceId: string
  chunkId: string
  role: 'canon_fact' | 'reference' | 'style_sample'
  heading: string | null
  content: string
  contentHash: string
  priority: number
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
  /**
   * 在人物和世界已关联资料中检索证据。
   * @param request 目标范围、查询和上限。
   * @returns 已按证据角色、关联优先级和相关性排序的候选。
   */
  search(request: EvidenceSearchRequest): Promise<EvidenceCandidate[]>
}
