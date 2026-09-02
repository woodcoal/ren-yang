import { describe, expect, it } from 'vitest'
import { AuthenticationApplicationService } from '../../server/application/authentication/AuthenticationApplicationService'
import { AdministratorMaintenanceApplicationService } from '../../server/application/authentication/AdministratorMaintenanceApplicationService'
import type { Administrator } from '../../server/domain/authentication/Administrator'
import type {
  AdministratorPasswordUpdateSource,
  AdministratorRepository,
  CreateAdministratorRecord,
} from '../../server/ports/AdministratorRepository'
import type {
  AdministratorSessionPrincipal,
  AuthenticationSession,
  PasswordHasher,
  RequestSecurity,
} from '../../server/ports/AuthenticationPorts'
import type { Clock } from '../../server/ports/Clock'

/** 测试使用的内存管理员仓储。 */
class InMemoryAdministratorRepository implements AdministratorRepository {
  /** 当前唯一管理员记录。 */
  public administrator: Administrator | null = null

  /** @returns 管理员存在时返回 true。 */
  async exists(): Promise<boolean> {
    return this.administrator !== null
  }

  /** @param username 用户名。 @returns 匹配的管理员或 null。 */
  async findByUsername(username: string): Promise<Administrator | null> {
    return this.administrator?.username === username ? this.administrator : null
  }

  /** @param id 管理员标识。 @returns 匹配的管理员或 null。 */
  async findById(id: string): Promise<Administrator | null> {
    return this.administrator?.id === id ? this.administrator : null
  }

  /** @param record 创建数据。 @returns 首次创建返回 true。 */
  async createIfAbsent(record: CreateAdministratorRecord): Promise<boolean> {
    if (this.administrator) {
      return false
    }
    this.administrator = {
      id: record.id,
      username: record.username,
      passwordHash: record.passwordHash,
      credentialVersion: record.credentialVersion,
      createdAt: record.timestamp,
      updatedAt: record.timestamp,
    }
    return true
  }

  /**
   * @param id 管理员标识。
   * @param passwordHash 新哈希。
   * @param timestamp 更新时间。
   * @param _source 密码更新来源；内存仓储不写审计。
   * @returns 更新记录或 null。
   */
  async updatePassword(
    id: string,
    passwordHash: string,
    timestamp: number,
    _source: AdministratorPasswordUpdateSource,
  ): Promise<Administrator | null> {
    if (!this.administrator || this.administrator.id !== id) {
      return null
    }
    this.administrator = {
      ...this.administrator,
      passwordHash,
      credentialVersion: this.administrator.credentialVersion + 1,
      updatedAt: timestamp,
    }
    return this.administrator
  }
}

/** 测试使用的请求会话。 */
class InMemorySession implements AuthenticationSession {
  /** 当前会话身份。 */
  public principal: AdministratorSessionPrincipal | null = null
  /** 会话被清除的次数。 */
  public clearCount = 0

  /** @returns 当前会话身份。 */
  async getPrincipal(): Promise<AdministratorSessionPrincipal | null> {
    return this.principal
  }

  /** @param principal 新会话身份。 @returns 无返回值。 */
  async setPrincipal(principal: AdministratorSessionPrincipal): Promise<void> {
    this.principal = principal
  }

  /** @returns 无返回值。 */
  async clear(): Promise<void> {
    this.principal = null
    this.clearCount += 1
  }
}

/** 测试使用的确定性密码哈希器。 */
class DeterministicPasswordHasher implements PasswordHasher {
  /** @param plainPassword 明文密码。 @returns 测试哈希。 */
  async hash(plainPassword: string): Promise<string> {
    return `hash:${plainPassword}`
  }

  /** @param passwordHash 测试哈希。 @param plainPassword 明文密码。 @returns 是否匹配。 */
  async verify(passwordHash: string, plainPassword: string): Promise<boolean> {
    return passwordHash === `hash:${plainPassword}`
  }
}

/** 可控制的请求来源。 */
class FixedRequestSecurity implements RequestSecurity {
  /** @param loopback 是否模拟回环请求。 */
  constructor(public loopback = true) {}

  /** @returns 当前设定的回环结果。 */
  isLoopbackRequest(): boolean {
    return this.loopback
  }
}

/** 可控制的测试时钟。 */
class FixedClock implements Clock {
  /** @param timestamp 固定时间。 */
  constructor(public timestamp = 1_000) {}

  /** @returns 固定时间。 */
  now(): number {
    return this.timestamp
  }
}

/** 认证服务测试夹具。 */
interface AuthenticationHarness {
  /** 被测服务。 */
  service: AuthenticationApplicationService
  /** 内存仓储。 */
  repository: InMemoryAdministratorRepository
  /** 内存会话。 */
  session: InMemorySession
  /** 请求来源开关。 */
  requestSecurity: FixedRequestSecurity
  /** 固定时钟。 */
  clock: FixedClock
  /** 测试密码器。 */
  passwordHasher: DeterministicPasswordHasher
}

/**
 * 创建彼此隔离的认证服务测试夹具。
 * @returns 被测服务和可观察端口。
 */
function createHarness(): AuthenticationHarness {
  const repository = new InMemoryAdministratorRepository()
  const session = new InMemorySession()
  const requestSecurity = new FixedRequestSecurity()
  const clock = new FixedClock()
  const passwordHasher = new DeterministicPasswordHasher()
  return {
    repository,
    session,
    requestSecurity,
    clock,
    passwordHasher,
    service: new AuthenticationApplicationService({
      administratorRepository: repository,
      session,
      requestSecurity,
      clock,
      passwordHasher,
    }),
  }
}

/** 统一的有效首次设置输入。 */
const setupInput = {
  username: 'admin',
  password: 'correct-password',
  passwordConfirmation: 'correct-password',
}

describe('AuthenticationApplicationService', () => {
  it('只允许从回环地址执行首次设置', async () => {
    const harness = createHarness()
    harness.requestSecurity.loopback = false

    await expect(harness.service.setupAdministrator(setupInput)).rejects.toMatchObject({
      code: 'LOCAL_SETUP_REQUIRED',
      statusCode: 403,
    })
    expect(harness.repository.administrator).toBeNull()
  })

  it('原子创建唯一管理员并建立会话', async () => {
    const harness = createHarness()

    await expect(harness.service.setupAdministrator(setupInput)).resolves.toEqual({
      id: 'administrator',
      username: 'admin',
    })
    expect(harness.session.principal).toEqual({
      id: 'administrator',
      username: 'admin',
      credentialVersion: 1,
    })
    await expect(harness.service.setupAdministrator(setupInput)).rejects.toMatchObject({
      code: 'SETUP_ALREADY_COMPLETED',
    })
  })

  it('使用统一错误拒绝无效凭据并接受正确凭据', async () => {
    const harness = createHarness()
    await harness.service.setupAdministrator(setupInput)
    await harness.service.logout()

    await expect(harness.service.login({ username: 'admin', password: 'wrong' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    })
    await expect(harness.service.login({ username: 'admin', password: 'correct-password' })).resolves.toEqual({
      id: 'administrator',
      username: 'admin',
    })
  })

  it('校验当前密码后更新凭据并保留当前会话', async () => {
    const harness = createHarness()
    await harness.service.setupAdministrator(setupInput)

    await expect(harness.service.changePassword({
      currentPassword: 'wrong-password',
      newPassword: 'new-correct-password',
      newPasswordConfirmation: 'new-correct-password',
    })).rejects.toMatchObject({ code: 'INVALID_CURRENT_PASSWORD', statusCode: 400 })
    expect(harness.repository.administrator?.credentialVersion).toBe(1)

    await expect(harness.service.changePassword({
      currentPassword: 'correct-password',
      newPassword: 'new-correct-password',
      newPasswordConfirmation: 'new-correct-password',
    })).resolves.toEqual({ id: 'administrator', username: 'admin' })
    expect(harness.repository.administrator).toMatchObject({
      passwordHash: 'hash:new-correct-password',
      credentialVersion: 2,
    })
    expect(harness.session.principal).toEqual({
      id: 'administrator', username: 'admin', credentialVersion: 2,
    })
    await expect(harness.service.getSession()).resolves.toEqual({
      authenticated: true,
      administrator: { id: 'administrator', username: 'admin' },
    })
  })

  it('密码重置递增凭据版本并使旧会话失效', async () => {
    const harness = createHarness()
    await harness.service.setupAdministrator(setupInput)
    const maintenance = new AdministratorMaintenanceApplicationService({
      administratorRepository: harness.repository,
      passwordHasher: harness.passwordHasher,
      clock: harness.clock,
    })

    await maintenance.resetPassword('new-correct-password')

    await expect(harness.service.getSession()).resolves.toEqual({
      authenticated: false,
      administrator: null,
    })
    expect(harness.session.clearCount).toBe(1)
  })
})
