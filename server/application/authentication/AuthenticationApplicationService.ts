import type {
  ChangeAdministratorPasswordInput,
  LoginInput,
  SetupAdministratorInput,
} from '../../../shared/schemas/authentication'
import type {
  AdministratorIdentity,
  AuthenticationSessionResult,
  SetupStatusResult,
} from '../../../shared/types/api'
import { ADMINISTRATOR_ID, type Administrator } from '../../domain/authentication/Administrator'
import type { AdministratorRepository } from '../../ports/AdministratorRepository'
import type { Clock } from '../../ports/Clock'
import type { AuthenticationSession, PasswordHasher, RequestSecurity } from '../../ports/AuthenticationPorts'
import { ApplicationError } from '../errors/ApplicationError'

/** 认证应用服务的依赖。 */
export interface AuthenticationApplicationServiceDependencies {
  /** 管理员数据访问端口。 */
  administratorRepository: AdministratorRepository
  /** 密码安全哈希端口。 */
  passwordHasher: PasswordHasher
  /** 当前请求会话端口。 */
  session: AuthenticationSession
  /** 当前请求来源安全端口。 */
  requestSecurity: RequestSecurity
  /** 可测试的系统时钟。 */
  clock: Clock
}

/** 编排首次设置、登录、退出和会话验证。 */
export class AuthenticationApplicationService {
  /**
   * 创建认证应用服务。
   * @param dependencies 数据、密码、会话、请求来源和时间端口。
   */
  constructor(private readonly dependencies: AuthenticationApplicationServiceDependencies) {}

  /**
   * 查询系统是否仍需要创建唯一管理员。
   * @returns 首次设置状态。
   */
  async getSetupStatus(): Promise<SetupStatusResult> {
    return {
      setupRequired: !(await this.dependencies.administratorRepository.exists()),
    }
  }

  /**
   * 从本机回环请求创建唯一管理员并立即建立会话。
   * @param input 已通过共享 Schema 校验的用户名和密码。
   * @returns 新管理员的公开身份。
   * @throws ApplicationError 请求不是本机或管理员已存在时抛出。
   */
  async setupAdministrator(input: SetupAdministratorInput): Promise<AdministratorIdentity> {
    if (!this.dependencies.requestSecurity.isLoopbackRequest()) {
      throw new ApplicationError('LOCAL_SETUP_REQUIRED', '首次设置只能从应用所在机器访问', 403)
    }

    const timestamp = this.dependencies.clock.now()
    const passwordHash = await this.dependencies.passwordHasher.hash(input.password)
    const created = await this.dependencies.administratorRepository.createIfAbsent({
      id: ADMINISTRATOR_ID,
      username: input.username,
      passwordHash,
      credentialVersion: 1,
      timestamp,
    })

    if (!created) {
      throw new ApplicationError('SETUP_ALREADY_COMPLETED', '唯一管理员已经创建', 409)
    }

    const administrator: AdministratorIdentity = {
      id: ADMINISTRATOR_ID,
      username: input.username,
    }
    await this.dependencies.session.setPrincipal({ ...administrator, credentialVersion: 1 })
    return administrator
  }

  /**
   * 验证管理员凭据并建立加密 Cookie 会话。
   * @param input 已通过共享 Schema 校验的登录信息。
   * @returns 登录成功后的公开管理员身份。
   * @throws ApplicationError 管理员不存在或密码不匹配时抛出统一错误。
   */
  async login(input: LoginInput): Promise<AdministratorIdentity> {
    const administrator = await this.dependencies.administratorRepository.findByUsername(input.username)
    const passwordMatches = administrator
      ? await this.dependencies.passwordHasher.verify(administrator.passwordHash, input.password)
      : false

    if (!administrator || !passwordMatches) {
      throw new ApplicationError('INVALID_CREDENTIALS', '用户名或密码错误', 401)
    }

    await this.dependencies.session.setPrincipal({
      id: administrator.id,
      username: administrator.username,
      credentialVersion: administrator.credentialVersion,
    })
    return toIdentity(administrator)
  }

  /**
   * 校验当前凭据后修改唯一管理员密码，并让当前会话使用新的凭据版本。
   * @param input 当前密码、符合统一规则的新密码及其确认值。
   * @returns 密码修改后的公开管理员身份。
   * @throws ApplicationError 当前会话无效、当前密码错误或管理员记录消失时抛出。
   * @remarks 数据库递增凭据版本会使其他旧会话失效；当前会话在成功后立即刷新。
   */
  async changePassword(input: ChangeAdministratorPasswordInput): Promise<AdministratorIdentity> {
    const identity = await this.requireAuthenticatedAdministrator()
    const administrator = await this.dependencies.administratorRepository.findById(identity.id)
    if (!administrator) {
      throw new ApplicationError('AUTH_REQUIRED', '需要登录后才能修改密码', 401)
    }

    const passwordMatches = await this.dependencies.passwordHasher.verify(
      administrator.passwordHash,
      input.currentPassword,
    )
    if (!passwordMatches) {
      throw new ApplicationError('INVALID_CURRENT_PASSWORD', '当前密码错误', 400)
    }

    const passwordHash = await this.dependencies.passwordHasher.hash(input.newPassword)
    const updated = await this.dependencies.administratorRepository.updatePassword(
      administrator.id,
      passwordHash,
      this.dependencies.clock.now(),
      'administrator',
    )
    if (!updated) {
      throw new ApplicationError('AUTH_REQUIRED', '管理员账户已失效，请重新登录', 401)
    }

    await this.dependencies.session.setPrincipal({
      id: updated.id,
      username: updated.username,
      credentialVersion: updated.credentialVersion,
    })
    return toIdentity(updated)
  }

  /**
   * 返回经过数据库凭据版本复核的当前会话。
   * @returns 有效会话及管理员身份；无效或过期会话返回未登录状态。
   */
  async getSession(): Promise<AuthenticationSessionResult> {
    const principal = await this.dependencies.session.getPrincipal()
    if (!principal) {
      return { authenticated: false, administrator: null }
    }

    const administrator = await this.dependencies.administratorRepository.findById(principal.id)
    if (!administrator || administrator.credentialVersion !== principal.credentialVersion) {
      await this.dependencies.session.clear()
      return { authenticated: false, administrator: null }
    }

    return {
      authenticated: true,
      administrator: toIdentity(administrator),
    }
  }

  /**
   * 强制要求当前请求具有有效管理员会话。
   * @returns 已验证的管理员公开身份。
   * @throws ApplicationError 未登录或旧会话已失效时抛出。
   */
  async requireAuthenticatedAdministrator(): Promise<AdministratorIdentity> {
    const session = await this.getSession()
    if (!session.authenticated || !session.administrator) {
      throw new ApplicationError('AUTH_REQUIRED', '需要登录后才能访问', 401)
    }
    return session.administrator
  }

  /**
   * 清除当前管理员会话。
   * @returns 无返回值。
   */
  async logout(): Promise<void> {
    await this.dependencies.session.clear()
  }
}

/**
 * 将包含密码哈希的管理员记录转换为公开身份。
 * @param administrator 管理员持久化记录。
 * @returns 不包含密码哈希和凭据版本的公开身份。
 */
function toIdentity(administrator: Administrator): AdministratorIdentity {
  return {
    id: administrator.id,
    username: administrator.username,
  }
}
