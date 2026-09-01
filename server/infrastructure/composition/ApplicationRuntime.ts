import type { H3Event } from 'h3'
import { AuthenticationApplicationService } from '../../application/authentication/AuthenticationApplicationService'
import { ApiKeyApplicationService } from '../../application/authentication/ApiKeyApplicationService'
import { PublicApiApplicationService } from '../../application/publicApi/PublicApiApplicationService'
import { AdministratorMaintenanceApplicationService } from '../../application/authentication/AdministratorMaintenanceApplicationService'
import { ContentApplicationService } from '../../application/content/ContentApplicationService'
import { SoulApplicationService } from '../../application/content/SoulApplicationService'
import { GenerationApplicationService } from '../../application/generation/GenerationApplicationService'
import { FeedbackApplicationService } from '../../application/feedback/FeedbackApplicationService'
import { ContextSynchronizationApplicationService, OPEN_VIKING_SECRET_CONTEXT } from '../../application/context/ContextSynchronizationApplicationService'
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
import { SqliteConfiguredImageModel, SqliteConfiguredTextModel } from '../models/SqliteConfiguredModels'
import { OpenVikingHttpContextProvider } from '../context/OpenVikingHttpContextProvider'
import { SwitchableContextProvider } from '../context/SwitchableContextProvider'
import { LocalBackupManager } from '../backup/LocalBackupManager'
import { ConservativeTokenCounter } from '../model/ConservativeTokenCounter'
import { LearningApplicationService } from '../../application/learning/LearningApplicationService'
import { SqliteLearningRepository } from '../database/SqliteLearningRepository'
import { AnalysisApplicationService } from '../../application/analysis/AnalysisApplicationService'
import { SqliteAnalysisRepository } from '../database/SqliteAnalysisRepository'
import { AesGcmSecretCipher } from '../security/AesGcmSecretCipher'
import { AiPromptApplicationService } from '../../application/aiPrompts/AiPromptApplicationService'
import { SqliteAiPromptRepository } from '../database/SqliteAiPromptRepository'
import { HistoryApplicationService } from '../../application/history/HistoryApplicationService'
import { SqliteHistoryRepository } from '../database/SqliteHistoryRepository'
import { SystemAiSettingsApplicationService } from '../../application/systemAi/SystemAiSettingsApplicationService'
import { SqliteSystemAiSettingsRepository } from '../database/SqliteSystemAiSettingsRepository'
import { AiConfigurationApplicationService } from '../../application/aiConfiguration/AiConfigurationApplicationService'
import { AiAlgorithmApplicationService } from '../../application/aiConfiguration/AiAlgorithmApplicationService'
import { AiAlgorithmTestApplicationService } from '../../application/aiConfiguration/AiAlgorithmTestApplicationService'
import { SqliteAiConfigurationRepository } from '../database/SqliteAiConfigurationRepository'
import { SqliteApiKeyRepository } from '../database/SqliteApiKeyRepository'
import { SqlitePublicApiRepository } from '../database/SqlitePublicApiRepository'
import { SqliteOpenVikingSettingsRepository } from '../database/SqliteOpenVikingSettingsRepository'
import { OpenAiCompatibleModelFactory } from '../models/OpenAiCompatibleModelFactory'

/** 应用运行时组合配置。 */
export interface ApplicationRuntimeOptions {
  /** SQLite 与文件资产的数据目录。 */
  dataDirectory: string
  /** Drizzle 迁移目录。 */
  migrationsDirectory: string
  /** 人物账号与 AI 接口凭据共同使用的仓库外密钥材料。 */
  credentialEncryptionSecret: string
  /** Worker 空闲轮询间隔。 */
  workerPollIntervalMs?: number
  /** Worker 单任务租约长度。 */
  workerLeaseDurationMs?: number
  /** 每次创建新文件后必须保留的磁盘字节数。 */
  minimumFreeDiskBytes?: number
  /** 开发热更新期间是否允许同一 PID 的新旧运行时短暂重叠。 */
  allowSameProcessLockReentry?: boolean
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
  /** 请求与 Worker 共用的全站 AI 提示词目录。 */
  private readonly aiPromptService: AiPromptApplicationService
  /** 请求间可安全共享的灵魂应用服务。 */
  private readonly soulService: SoulApplicationService
  /** 请求间可安全共享的成长与记忆应用服务。 */
  private readonly learningService: LearningApplicationService
  /** 请求与 Worker 共用的成长与记忆 AI 分析应用服务。 */
  private readonly analysisService: AnalysisApplicationService
  /** 请求与 Worker 共用的生成应用服务。 */
  private readonly generationService: GenerationApplicationService
  /** 请求间共享的统一任务记录查询服务。 */
  private readonly historyService: HistoryApplicationService
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
  /** 请求与各 AI 业务服务共用的系统 AI 参数设置。 */
  private readonly systemAiSettingsService: SystemAiSettingsApplicationService
  /** 请求间共享的 AI 接口、模型部署和算法配置管理服务。 */
  private readonly aiConfigurationService: AiConfigurationApplicationService
  /** 请求间共享且不保存结果的固定算法测试服务。 */
  private readonly aiAlgorithmTestService: AiAlgorithmTestApplicationService
  /** 请求间共享的 API Key 管理与认证服务。 */
  private readonly apiKeyService: ApiKeyApplicationService
  /** 公共写请求幂等和审计服务。 */
  private readonly publicApiService: PublicApiApplicationService

  /**
   * 创建并连接阶段一所需的全部运行时对象。
   * @param options 数据目录、迁移目录和 Worker 时序配置。
   */
  constructor(options: ApplicationRuntimeOptions) {
    this.instanceLock = new ApplicationInstanceLock(options.dataDirectory, {
      allowSameProcessReentry: options.allowSameProcessLockReentry,
    })
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
    this.apiKeyService = new ApiKeyApplicationService({
      repository: new SqliteApiKeyRepository(this.sqlite.getClient()),
      identifiers,
      clock: this.clock,
    })
    this.publicApiService = new PublicApiApplicationService({
      repository: new SqlitePublicApiRepository(this.sqlite.getClient()),
      identifiers,
      clock: this.clock,
    })
    const contentRepository = new SqliteContentRepository(this.sqlite.getClient())
    this.aiPromptService = new AiPromptApplicationService({
      repository: new SqliteAiPromptRepository(this.sqlite.getClient()),
      identifiers,
      clock: this.clock,
    })
    const learningRepository = new SqliteLearningRepository(this.sqlite.getClient())
    const sourceProcessor = new NodeSourceContentProcessor(identifiers)
    const storageCapacity = new NodeStorageCapacityGuard(options.minimumFreeDiskBytes)
    const imageAssets = new LocalImageAssetStorage(options.dataDirectory, storageCapacity)
    const personaAvatars = new LocalPersonaAvatarStorage(options.dataDirectory, storageCapacity)
    const secretCipher = new AesGcmSecretCipher(options.credentialEncryptionSecret)
    const aiConfigurationRepository = new SqliteAiConfigurationRepository(this.sqlite.getClient())
    this.systemAiSettingsService = new SystemAiSettingsApplicationService({
      repository: new SqliteSystemAiSettingsRepository(this.sqlite.getClient()),
      aiConfiguration: aiConfigurationRepository,
      clock: this.clock,
    })
    const textModel = new SqliteConfiguredTextModel(this.sqlite.getClient(), secretCipher)
    const imageModel = new SqliteConfiguredImageModel(this.sqlite.getClient(), secretCipher)
    const dynamicModelFactory = new OpenAiCompatibleModelFactory()
    this.aiConfigurationService = new AiConfigurationApplicationService({
      repository: aiConfigurationRepository,
      secretCipher,
      modelFactory: dynamicModelFactory,
      prompts: this.aiPromptService,
      identifiers,
      clock: this.clock,
    })
    const aiAlgorithms = new AiAlgorithmApplicationService({
      repository: aiConfigurationRepository,
      prompts: this.aiPromptService,
      secretCipher,
      modelFactory: dynamicModelFactory,
    })
    this.aiAlgorithmTestService = new AiAlgorithmTestApplicationService({ algorithms: aiAlgorithms })
    const tokenCounter = new ConservativeTokenCounter()
    const contextRepository = new SqliteContextIndexRepository(this.sqlite.getClient())
    const openVikingSettings = new SqliteOpenVikingSettingsRepository(this.sqlite.getClient())
    const openViking = new OpenVikingHttpContextProvider({
      enabled: false,
      endpoint: '',
      apiKey: '',
      timeoutMs: 60_000,
      repository: contextRepository,
      configurationSource: () => {
        const current = openVikingSettings.findCurrent()
        return current
          ? {
              enabled: current.enabled,
              endpoint: current.endpoint,
              apiKey: current.apiKeyCiphertext
                ? secretCipher.decrypt(current.apiKeyCiphertext, OPEN_VIKING_SECRET_CONTEXT)
                : '',
              timeoutMs: current.timeoutMs,
            }
          : { enabled: false, endpoint: '', apiKey: '', timeoutMs: 60_000 }
      },
    })
    const contextSyncQueue = new SqliteContextSyncTaskQueue(
      this.sqlite.getClient(),
      () => openViking.getCapability().enabled,
    )
    const contextProvider = new SwitchableContextProvider(
      new SqliteContextProvider(this.sqlite.getClient()),
      openViking,
      () => openViking.getCapability().enabled,
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
      prompts: this.aiPromptService,
      contextSyncQueue,
      secretCipher,
    })
    this.soulService = new SoulApplicationService({
      content: contentRepository,
      souls: contentRepository,
      identifiers,
      clock: this.clock,
      systemAiSettings: this.systemAiSettingsService,
      tokenCounter,
      model: textModel,
      prompts: this.aiPromptService,
      tokenBudgets: { world: 2_500, persona: 3_500 },
      algorithms: aiAlgorithms,
    })
    const analysisRepository = new SqliteAnalysisRepository(this.sqlite.getClient())
    this.learningService = new LearningApplicationService({
      content: contentRepository,
      learning: learningRepository,
      analysis: analysisRepository,
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
      analysis: analysisRepository,
      model: textModel,
      prompts: this.aiPromptService,
      identifiers,
      clock: this.clock,
      systemAiSettings: this.systemAiSettingsService,
      algorithms: aiAlgorithms,
    })
    this.generationService = new GenerationApplicationService({
      runs: new SqliteRunRepository(this.sqlite.getClient()),
      content: contentRepository,
      context: contextProvider,
      model: textModel,
      prompts: this.aiPromptService,
      imageModel,
      imageAssets,
      identifiers,
      clock: this.clock,
      sourceProcessor,
      tokenCounter,
      learning: learningRepository,
      contextSyncQueue,
      systemAiSettings: this.systemAiSettingsService,
    })
    this.historyService = new HistoryApplicationService({
      history: new SqliteHistoryRepository(this.sqlite.getClient()),
    })
    this.feedbackService = new FeedbackApplicationService({
      repository: new SqliteFeedbackRepository(this.sqlite.getClient()),
      model: textModel,
      prompts: this.aiPromptService,
      identifiers,
      clock: this.clock,
      contextSyncQueue,
      systemAiSettings: this.systemAiSettingsService,
    })
    this.contextSynchronizationService = new ContextSynchronizationApplicationService({
      repository: contextRepository,
      openViking,
      settings: openVikingSettings,
      secretCipher,
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
      apiKeys: this.apiKeyService,
      publicApi: this.publicApiService,
      aiConfiguration: this.aiConfigurationService,
      aiAlgorithmTesting: this.aiAlgorithmTestService,
      aiPrompts: this.aiPromptService,
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
      history: this.historyService,
      feedback: this.feedbackService,
      contextSynchronization: this.contextSynchronizationService,
      backup: this.backupService,
      system: this.systemService,
      systemAiSettings: this.systemAiSettingsService,
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
