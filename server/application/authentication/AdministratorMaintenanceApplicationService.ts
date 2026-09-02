import type { AdministratorIdentity } from '../../../shared/types/api'
import { ADMINISTRATOR_ID } from '../../domain/authentication/Administrator'
import type { AdministratorRepository } from '../../ports/AdministratorRepository'
import type { Clock } from '../../ports/Clock'
import type { PasswordHasher } from '../../ports/AuthenticationPorts'
import { ApplicationError } from '../errors/ApplicationError'

/** 管理员维护服务的依赖。 */
export interface AdministratorMaintenanceDependencies {
  /** 管理员数据访问端口。 */
  administratorRepository: AdministratorRepository
  /** 密码安全哈希端口。 */
  passwordHasher: PasswordHasher
  /** 可测试的系统时钟。 */
  clock: Clock
}

/** 提供只能从本机命令行执行的管理员维护用例。 */
export class AdministratorMaintenanceApplicationService {
  /**
   * 创建管理员维护服务。
   * @param dependencies 数据、密码和时间端口。
   */
  constructor(private readonly dependencies: AdministratorMaintenanceDependencies) {}

  /**
   * 重置唯一管理员密码并使所有已有会话失效。
   * @param plainPassword 已通过共享密码规则校验的新明文密码。
   * @returns 更新后的管理员公开身份。
   * @throws ApplicationError 尚未完成首次设置时抛出。
   */
  async resetPassword(plainPassword: string): Promise<AdministratorIdentity> {
    const passwordHash = await this.dependencies.passwordHasher.hash(plainPassword)
    const administrator = await this.dependencies.administratorRepository.updatePassword(
      ADMINISTRATOR_ID,
      passwordHash,
      this.dependencies.clock.now(),
      'maintenance',
    )

    if (!administrator) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '管理员尚未创建，不能重置密码', 404)
    }

    return {
      id: administrator.id,
      username: administrator.username,
    }
  }
}
