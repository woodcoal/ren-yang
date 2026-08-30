import { AiPromptApplicationService } from '../../server/application/aiPrompts/AiPromptApplicationService'
import { SqliteAiPromptRepository } from '../../server/infrastructure/database/SqliteAiPromptRepository'
import type { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import type { Clock } from '../../server/ports/Clock'
import type { IdentifierGenerator } from '../../server/ports/IdentifierGenerator'

/**
 * 为数据库集成测试连接真实迁移初始化的 AI 提示词目录。
 * @param database 当前测试独占的 SQLite 数据库。
 * @param identifiers 测试使用的 UUID 生成端口。
 * @param clock 测试使用的时钟端口。
 * @returns 使用真实仓储和模板版本的提示词应用服务。
 */
export function createTestAiPromptService(
  database: SqliteDatabase,
  identifiers: IdentifierGenerator,
  clock: Clock,
): AiPromptApplicationService {
  return new AiPromptApplicationService({
    repository: new SqliteAiPromptRepository(database.getClient()),
    identifiers,
    clock,
  })
}
