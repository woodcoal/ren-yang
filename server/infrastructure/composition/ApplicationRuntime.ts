import type { H3Event } from 'h3'
import { AuthenticationApplicationService } from '../../application/authentication/AuthenticationApplicationService'
import { AdministratorMaintenanceApplicationService } from '../../application/authentication/AdministratorMaintenanceApplicationService'
import { ContentApplicationService } from '../../application/content/ContentApplicationService'
import type { RequestApplicationServices } from '../../application/RequestApplicationServices'
import { SystemApplicationService } from '../../application/system/SystemApplicationService'
import { WorkerApplicationService } from '../../application/tasks/WorkerApplicationService'
import { InternalWorker } from '../../worker/InternalWorker'
import { H3RequestSecurity } from '../authentication/H3RequestSecurity'
import { NuxtAuthenticationSession } from '../authentication/NuxtAuthenticationSession'
import { ScryptPasswordHasher } from '../authentication/ScryptPasswordHasher'
import { LocalSourceFileStorage } from '../content/LocalSourceFileStorage'
import { NodeSourceContentProcessor } from '../content/NodeSourceContentProcessor'
import { DrizzleAdministratorRepository } from '../database/DrizzleAdministratorRepository'
import { SqliteContentRepository } from '../database/SqliteContentRepository'
import { SqliteDatabase } from '../database/SqliteDatabase'
import { SqliteTaskJobRepository } from '../database/SqliteTaskJobRepository'
import { SystemClock } from '../system/SystemClock'
import { SystemIdentifierGenerator } from '../system/SystemIdentifierGenerator'
import { UnsupportedTaskHandler } from '../tasks/UnsupportedTaskHandler'

/** 应用运行时组合配置。 */
export interface ApplicationRuntimeOptions {
  /** SQLite 与文件资产的数据目录。 */
  dataDirectory: string
  /** Drizzle 迁移目录。 */
  migrationsDirectory: string
  /** Worker 空闲轮询间隔。 */
  workerPollIntervalMs?: number
  /** Worker 单任务租约长度。 */
  workerLeaseDurationMs?: number
}

/** 唯一组合根，负责连接基础设施适配器与应用服务。 */
export class ApplicationRuntime {
  /** SQLite 连接与健康检查。 */
  private readonly sqlite: SqliteDatabase
  /** 管理员数据适配器。 */
  private readonly administratorRepository: DrizzleAdministratorRepository
  /** 密码哈希适配器。 */
  private readonly passwordHasher = new ScryptPasswordHasher()
  /** 系统时钟适配器。 */
  private readonly clock = new SystemClock()
  /** 请求间可安全共享的内容应用服务。 */
  private readonly contentService: ContentApplicationService
  /** 进程内 Worker。 */
  private readonly worker: InternalWorker
  /** 请求间可安全共享的系统应用服务。 */
  private readonly systemService: SystemApplicationService

  /**
   * 创建并连接阶段一所需的全部运行时对象。
   * @param options 数据目录、迁移目录和 Worker 时序配置。
   */
  constructor(options: ApplicationRuntimeOptions) {
    this.sqlite = new SqliteDatabase({
      dataDirectory: options.dataDirectory,
      migrationsDirectory: options.migrationsDirectory,
    })
    this.administratorRepository = new DrizzleAdministratorRepository(this.sqlite.db)
    const identifiers = new SystemIdentifierGenerator()
    this.contentService = new ContentApplicationService({
      repository: new SqliteContentRepository(this.sqlite.getClient()),
      identifiers,
      clock: this.clock,
      sourceProcessor: new NodeSourceContentProcessor(identifiers),
      sourceFiles: new LocalSourceFileStorage(options.dataDirectory),
    })

    const workerService = new WorkerApplicationService({
      taskJobRepository: new SqliteTaskJobRepository(this.sqlite.getClient()),
      taskHandler: new UnsupportedTaskHandler(),
      clock: this.clock,
      leaseDurationMs: options.workerLeaseDurationMs ?? 60_000,
    })
    this.worker = new InternalWorker(workerService, options.workerPollIntervalMs ?? 1_000)
    this.systemService = new SystemApplicationService({
      administratorRepository: this.administratorRepository,
      databaseHealth: this.sqlite,
      workerStatus: this.worker,
    })
  }

  /**
   * 恢复过期任务并启动内部 Worker。
   * @returns 无返回值。
   */
  async start(): Promise<void> {
    await this.worker.start()
  }

  /**
   * 为当前 HTTP 请求创建只包含应用服务的入口。
   * @param event 当前 H3 请求事件。
   * @returns 请求级认证服务与共享系统服务。
   */
  createRequestServices(event: H3Event): RequestApplicationServices {
    return {
      authentication: new AuthenticationApplicationService({
        administratorRepository: this.administratorRepository,
        passwordHasher: this.passwordHasher,
        session: new NuxtAuthenticationSession(event),
        requestSecurity: new H3RequestSecurity(event),
        clock: this.clock,
      }),
      content: this.contentService,
      system: this.systemService,
    }
  }

  /**
   * 创建只供本机命令行使用的管理员维护服务。
   * @returns 不依赖 HTTP 会话的管理员维护服务。
   */
  createAdministratorMaintenanceService(): AdministratorMaintenanceApplicationService {
    return new AdministratorMaintenanceApplicationService({
      administratorRepository: this.administratorRepository,
      passwordHasher: this.passwordHasher,
      clock: this.clock,
    })
  }

  /**
   * 停止 Worker 并关闭 SQLite 连接。
   * @returns 无返回值。
   */
  async close(): Promise<void> {
    await this.worker.stop()
    this.sqlite.close()
  }
}
