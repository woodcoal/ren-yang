import type { OpenVikingCapabilityView } from '../../../shared/types/context'
import type { ContextProvider, EvidenceCandidate, EvidenceSearchRequest } from '../../ports/ContextProvider'

/** 在运行创建前按显式开关选择上下文提供器，运行中绝不自动降级。 */
export class SwitchableContextProvider implements ContextProvider {
  /**
   * 创建可切换上下文提供器。
   * @param local 始终可用的 SQLite FTS5 提供器。
   * @param openViking 可选 OpenViking 提供器。
   * @param openVikingEnabled 当前启动配置中的明确开关。
   */
  constructor(
    private readonly local: ContextProvider,
    private readonly openViking: ContextProvider,
    private readonly openVikingEnabled: boolean,
  ) {}

  /** @returns 新运行实际固定的提供器。 */
  getProvider(): 'sqlite_fts5' | 'openviking' {
    return this.openVikingEnabled ? 'openviking' : 'sqlite_fts5'
  }

  /** @returns OpenViking 非敏感能力状态。 */
  getOpenVikingCapability(): OpenVikingCapabilityView {
    return this.openViking.getOpenVikingCapability()
  }

  /** @param request 检索范围和查询。 @returns 仅由当前明确选择的提供器返回的统一证据。 */
  async search(request: EvidenceSearchRequest): Promise<EvidenceCandidate[]> {
    return await (this.openVikingEnabled ? this.openViking : this.local).search(request)
  }
}
