import type { AdministratorRepository } from '../../ports/AdministratorRepository'
import type { DatabaseHealthReader } from '../../ports/DatabaseHealth'
import type { WorkerStatusReader } from '../../ports/TaskPorts'
import type { SystemHealthResult } from '../../../shared/types/system'
import type { AuditRepository } from '../../ports/AuditRepository'
import type { AuditEventView } from '../../../shared/types/system'

/** 系统状态应用服务的依赖。 */
export interface SystemApplicationServiceDependencies {
  /** 管理员数据访问端口。 */
  administratorRepository: AdministratorRepository
  /** SQLite 健康检查端口。 */
  databaseHealth: DatabaseHealthReader
  /** Worker 状态读取端口。 */
  workerStatus: WorkerStatusReader
  /** 关键动作审计历史端口。 */
  audit: AuditRepository
}

/** 聚合管理界面需要的非敏感系统状态。 */
export class SystemApplicationService {
  /**
   * 创建系统状态应用服务。
   * @param dependencies 管理员、数据库和 Worker 状态端口。
   */
  constructor(private readonly dependencies: SystemApplicationServiceDependencies) {}

  /**
   * 读取应用、SQLite 和 Worker 的当前状态。
   * @returns 不包含密钥和绝对调用参数的健康摘要。
   */
  async getHealth(): Promise<SystemHealthResult> {
    const [database, administratorExists] = await Promise.all([
      this.dependencies.databaseHealth.check(),
      this.dependencies.administratorRepository.exists(),
    ])
    const worker = this.dependencies.workerStatus.getStatus()

    return {
      healthy: database.healthy && worker.running,
      setupRequired: !administratorExists,
      database: {
        healthy: database.healthy,
        journalMode: database.journalMode,
        foreignKeysEnabled: database.foreignKeysEnabled,
        integrity: database.integrity,
      },
      worker,
    }
  }

  /** @param limit 最大返回数量。 @returns 新记录在前的关键动作审计历史。 */
  async listAuditEvents(limit: number): Promise<AuditEventView[]> {
    return await this.dependencies.audit.list(limit)
  }
}
