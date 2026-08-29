import type { OpenVikingCapabilityView } from '../../../shared/types/context'
import type { ContextProvider, EvidenceSearchRequest } from '../../ports/ContextProvider'
import type { OpenVikingPort } from '../../ports/OpenVikingPort'

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
    private readonly openViking: ContextProvider & Pick<OpenVikingPort, 'checkHealth'>,
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
  async search(request: EvidenceSearchRequest) {
    if (!this.openVikingEnabled) return await this.local.search(request)
    try {
      await this.openViking.checkHealth()
      return await this.openViking.search(request)
    }
    catch {
      // 运行尚未创建，允许固定为 SQLite；一旦结果写入运行快照，后续执行不会再次检索或切换。
      return await this.local.search(request)
    }
  }
}
