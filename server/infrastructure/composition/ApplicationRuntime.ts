import type { H3Event } from 'h3'
import { AuthenticationApplicationService } from '../../application/authentication/AuthenticationApplicationService'
import { AdministratorMaintenanceApplicationService } from '../../application/authentication/AdministratorMaintenanceApplicationService'
import { ContentApplicationService } from '../../application/content/ContentApplicationService'
import { SoulApplicationService } from '../../application/content/SoulApplicationService'
import { GenerationApplicationService } from '../../application/generation/GenerationApplicationService'
import { FeedbackApplicationService } from '../../application/feedback/FeedbackApplicationService'
import { ContextSynchronizationApplicationService } from '../../application/context/ContextSynchronizationApplicationService'
import { BackupApplicationService } from '../../application/backup/BackupApplicationService'
import type { RequestApplicationServices } from '../../application/RequestApplicationServices'
import { SystemApplicationService } from '../../application/system/SystemApplicationService'
import { WorkerApplicationService } from '../../application/tasks/WorkerApplicationService'
import { TaskRoutingApplicationService } from '../../application/tasks/TaskRoutingApplicationService'
import { InternalWorker } from '../../worker/InternalWorker'
import { H3RequestSecurity } from '../authentication/H3RequestSecurity'
import { NuxtAuthenticationSession } from '../authentication/NuxtAuthenticationSession'
import { ScryptPasswordHasher } from '../authentication/ScryptPasswordHasher'
import { LocalSourceFileStorage } from '../content/LocalSourceFileStorage'
import { LocalImageAssetStorage } from '../content/LocalImageAssetStorage'
import { LocalPersonaAvatarStorage } from '../content/LocalPersonaAvatarStorage'
import { NodeSourceContentProcessor } from '../content/NodeSourceContentProcessor'
import { SqliteContextProvider } from '../context/SqliteContextProvider'
import { DrizzleAdministratorRepository } from '../database/DrizzleAdministratorRepository'
import { SqliteContentRepository } from '../database/SqliteContentRepository'
import { SqliteRunRepository } from '../database/SqliteRunRepository'
import { SqliteFeedbackRepository } from '../database/SqliteFeedbackRepository'
import { SqliteContextIndexRepository } from '../database/SqliteContextIndexRepository'
import { SqliteContextSyncTaskQueue } from '../database/SqliteContextSyncTaskQueue'
import { SqliteDatabase } from '../database/SqliteDatabase'
import { SqliteTaskJobRepository } from '../database/SqliteTaskJobRepository'
import { SqliteAuditRepository } from '../database/SqliteAuditRepository'
import { SystemClock } from '../system/SystemClock'
import { SystemIdentifierGenerator } from '../system/SystemIdentifierGenerator'
import { ApplicationInstanceLock } from '../system/ApplicationInstanceLock'
import { NodeStorageCapacityGuard } from '../system/NodeStorageCapacityGuard'
import { OpenAiCompatibleTextModel } from '../models/OpenAiCompatibleTextModel'
import { OpenAiCompatibleImageModel } from '../models/OpenAiCompatibleImageModel'
import { OpenVikingHttpContextProvider } from '../context/OpenVikingHttpContextProvider'
import { SwitchableContextProvider } from '../context/SwitchableContextProvider'
import { LocalBackupManager } from '../backup/LocalBackupManager'
import { ConservativeTokenCounter } from '../model/ConservativeTokenCounter'
import { LearningApplicationService } from '../../application/learning/LearningApplicationService'
import { SqliteLearningRepository } from '../database/SqliteLearningRepository'
import { AnalysisApplicationService } from '../../application/analysis/AnalysisApplicationService'
import { SqliteAnalysisRepository } from '../database/SqliteAnalysisRepository'
import { AesGcmSecretCipher } from '../security/AesGcmSecretCipher'

/** 应用运行时组合配置。 */
export interface ApplicationRuntimeOptions {
  /** SQLite 与文件资产的数据目录。 */
  dataDirectory: string
  /** Drizzle 迁移目录。 */
  migrationsDirectory: string
  /** 人物第三方账号密码使用的仓库外密钥材料。 */
  credentialEncryptionSecret: string
  /** Worker 空闲轮询间隔。 */
  workerPollIntervalMs?: number
  /** Worker 单任务租约长度。 */
  workerLeaseDurationMs?: number
  /** 每次创建新文件后必须保留的磁盘字节数。 */
  minimumFreeDiskBytes?: number
  /** OpenAI-compatible 文本模型配置。 */
  textModel?: {
    /** API 根地址或 Chat Completions 完整接口 URL。 */
    endpoint: string
    /** 仓库外访问凭据。 */
    apiKey: string
    /** 供应商模型名称。 */
    model: string
  }
  /** OpenAI-compatible 图片模型配置。 */
  imageModel?: {
    /** API 根地址或 Images Generations 完整接口 URL。 */
    endpoint: string
    /** 仓库外访问凭据。 */
    apiKey: string
    /** 供应商模型名称。 */
    model: string
  }
  /** 可选 OpenViking 上下文索引配置。 */
  openViking?: {
    /** 是否作为新运行的上下文提供器。 */
    enabled: boolean
    /** OpenViking 服务根地址。 */
    endpoint: string
    /** 可选 API Key。 */
    apiKey: string
    /** 单次 HTTP 超时。 */
    timeoutMs: number
  }
}

/** 唯一组合根，负责连接基础设施适配器与应用服务。 */
export class ApplicationRuntime {
  /** 数据目录单实例锁。 */
  private readonly instanceLock: ApplicationInstanceLock
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
  /** 请求间可安全共享的灵魂应用服务。 */
  private readonly soulService: SoulApplicationService
  /** 请求间可安全共享的成长与记忆应用服务。 */
  private readonly learningService: LearningApplicationService
  /** 请求与 Worker 共用的成长与记忆 AI 分析应用服务。 */
  private readonly analysisService: AnalysisApplicationService
  /** 请求与 Worker 共用的生成应用服务。 */
  private readonly generationService: GenerationApplicationService
  /** 请求间共享的反馈分类与人物成长素材应用服务。 */
  private readonly feedbackService: FeedbackApplicationService
  /** OpenViking 检测与重建应用服务。 */
  private readonly contextSynchronizationService: ContextSynchronizationApplicationService
  /** 在线一致性备份应用服务。 */
  private readonly backupService: BackupApplicationService
  /** 进程内 Worker。 */
  private readonly worker: InternalWorker
  /** 请求间可安全共享的系统应用服务。 */
  private readonly systemService: SystemApplicationService

  /**
   * 创建并连接阶段一所需的全部运行时对象。
   * @param options 数据目录、迁移目录和 Worker 时序配置。
   */
  constructor(options: ApplicationRuntimeOptions) {
    this.instanceLock = new ApplicationInstanceLock(options.dataDirectory)
    try {
      this.sqlite = new SqliteDatabase({
        dataDirectory: options.dataDirectory,
        migrationsDirectory: options.migrationsDirectory,
      })
    }
    catch (error: unknown) {
      this.instanceLock.release()
      throw error
    }
    this.administratorRepository = new DrizzleAdministratorRepository(this.sqlite.db)
    const identifiers = new SystemIdentifierGenerator()
    const contentRepository = new SqliteContentRepository(this.sqlite.getClient())
    const learningRepository = new SqliteLearningRepository(this.sqlite.getClient())
    const sourceProcessor = new NodeSourceContentProcessor(identifiers)
    const storageCapacity = new NodeStorageCapacityGuard(options.minimumFreeDiskBytes)
    const imageAssets = new LocalImageAssetStorage(options.dataDirectory, storageCapacity)
    const personaAvatars = new LocalPersonaAvatarStorage(options.dataDirectory, storageCapacity)
    const textModel = new OpenAiCompatibleTextModel(options.textModel ?? { endpoint: '', apiKey: '', model: '' })
    const imageModel = new OpenAiCompatibleImageModel(options.imageModel ?? { endpoint: '', apiKey: '', model: '' })
    const tokenCounter = new ConservativeTokenCounter()
    const contextRepository = new SqliteContextIndexRepository(this.sqlite.getClient())
    const openVikingOptions = options.openViking ?? { enabled: false, endpoint: '', apiKey: '', timeoutMs: 60_000 }
    const openViking = new OpenVikingHttpContextProvider({ ...openVikingOptions, repository: contextRepository })
    const contextSyncQueue = openVikingOptions.enabled
      ? new SqliteContextSyncTaskQueue(this.sqlite.getClient())
      : undefined
    const contextProvider = new SwitchableContextProvider(
      new SqliteContextProvider(this.sqlite.getClient()),
      openViking,
      openVikingOptions.enabled,
    )
    this.contentService = new ContentApplicationService({
      repository: contentRepository,
      souls: contentRepository,
      identifiers,
      clock: this.clock,
      tokenCounter,
      tokenBudgets: { world: 2_500, persona: 3_500 },
      sourceProcessor,
      sourceFiles: new LocalSourceFileStorage(options.dataDirectory, storageCapacity),
      imageAssets,
      personaAvatars,
      imageModel,
      contextSyncQueue,
      secretCipher: new AesGcmSecretCipher(options.credentialEncryptionSecret),
    })
    this.soulService = new SoulApplicationService({
      content: contentRepository,
      souls: contentRepository,
      identifiers,
      clock: this.clock,
      tokenCounter,
      model: textModel,
      tokenBudgets: { world: 2_500, persona: 3_500 },
    })
    this.learningService = new LearningApplicationService({
      content: contentRepository,
      learning: learningRepository,
      identifiers,
      clock: this.clock,
      tokenCounter,
      promptTokenBudgets: { world_growth: 2_500, persona_growth: 2_500, persona_memory: 3_000 },
      contextSyncQueue,
    })
    this.analysisService = new AnalysisApplicationService({
      content: contentRepository,
      souls: contentRepository,
      learning: learningRepository,
      analysis: new SqliteAnalysisRepository(this.sqlite.getClient()),
      model: textModel,
      identifiers,
      clock: this.clock,
    })
    this.generationService = new GenerationApplicationService({
      runs: new SqliteRunRepository(this.sqlite.getClient()),
      content: contentRepository,
      context: contextProvider,
      model: textModel,
      imageModel,
      imageAssets,
      identifiers,
      clock: this.clock,
      sourceProcessor,
      tokenCounter,
      learning: learningRepository,
      contextSyncQueue,
    })
    this.feedbackService = new FeedbackApplicationService({
      repository: new SqliteFeedbackRepository(this.sqlite.getClient()),
      model: textModel,
      identifiers,
      clock: this.clock,
      contextSyncQueue,
    })
    this.contextSynchronizationService = new ContextSynchronizationApplicationService({
      repository: contextRepository,
      openViking,
      identifiers,
      clock: this.clock,
      taskQueue: contextSyncQueue,
    })
    this.backupService = new BackupApplicationService(new LocalBackupManager(
      options.dataDirectory,
      options.migrationsDirectory,
    ))

    const taskJobRepository = new SqliteTaskJobRepository(this.sqlite.getClient())
    const workerService = new WorkerApplicationService({
      taskJobRepository,
      taskHandler: new TaskRoutingApplicationService(
        this.generationService,
        this.contextSynchronizationService,
        this.analysisService,
      ),
      clock: this.clock,
      leaseDurationMs: options.workerLeaseDurationMs ?? 60_000,
    })
    this.worker = new InternalWorker(workerService, options.workerPollIntervalMs ?? 1_000)
    this.systemService = new SystemApplicationService({
      administratorRepository: this.administratorRepository,
      databaseHealth: this.sqlite,
      workerStatus: this.worker,
      taskQueue: taskJobRepository,
      audit: new SqliteAuditRepository(this.sqlite.getClient()),
    })
  }

  /**
   * 恢复过期任务并启动内部 Worker。
   * @returns 无返回值。
   */
  async start(): Promise<void> {
    await this.contextSynchronizationService.recoverPendingTasks()
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
      soul: this.soulService,
      learning: this.learningService,
      analysis: this.analysisService,
      generation: this.generationService,
      feedback: this.feedbackService,
      contextSynchronization: this.contextSynchronizationService,
      backup: this.backupService,
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
    try {
      await this.worker.stop()
    }
    finally {
      try {
        this.sqlite.close()
      }
      finally {
        this.instanceLock.release()
      }
    }
  }
}
