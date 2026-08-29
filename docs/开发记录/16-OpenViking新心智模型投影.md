# OpenViking 新心智模型投影开发记录

## 阶段目标

将 OpenViking 明确为 SQLite 业务事实的可重建投影，并按既定隔离模型保存资料和人物交流：

- 一个世界对应一个 OpenViking User；
- 一个人物对应所属 User 下的一个 Peer；
- 世界资料写入 User Resource；
- 人物资料、人物反馈资料写入 Peer Resource；
- 人物处理记录写入 Peer Session；
- OpenViking 自动提取内容仅作为 SQLite 中的记忆分析原始素材，不能直接成为有效记忆。

## 完成内容

### 1. 投影身份与同步任务

- `context_sync_records` 增加 `entity_type` 和 `operation`，同步键不再只依赖资料标识。
- 支持 `source_material`、`persona_feedback_source`、`growth`、`memory` 四类逻辑实体。
- 支持 `upsert`、`delete` 两类投影意图。
- 普通资料 URI 调整为：
  - 世界：`viking://~/resources/ren-yang/world-source/{sourceId}.md`
  - 人物：`viking://~/peers/{peerId}/resources/ren-yang/persona-source/{sourceId}.md`
- 人物反馈资料 URI 调整为：
  - `viking://~/peers/{peerId}/resources/ren-yang/feedback-source/{feedbackId}.md`
- 世界或人物归属变化时，根据 SQLite 当前身份删除旧投影，再写入新投影。

### 2. 人物反馈资料两阶段删除

OpenViking 启用时，删除流程改为：

1. SQLite 将反馈资料标记为 `pending_remote_delete` 并禁用；
2. 持久任务删除 Peer Resource；
3. 远端失败时保留本地正文、删除意图和失败事实，等待重试；
4. 远端成功后清空历史分析输入正文、标记证据不可用、删除本地反馈资料和同步记录，并写入审计事件。

OpenViking 未启用时仍由 SQLite 在同一事务内直接完成本地删除。

### 3. Session 与派生分析素材

- 只有已经生成 `persona_operation_records` 的成功运行才进入 Session 补偿范围。
- Session 同步成功后，将远端派生内容保存至新增表 `openviking_derived_memories`。
- 同步更新 `persona_operation_records.session_record_id`，建立本地处理记录与远端 Session 的关联。
- 不再把 OpenViking 派生内容直接写入旧 `persona_memories`。
- 人物记忆分析读取已启用处理记录、OpenViking 派生素材和当前有效记忆。
- 增量分析键使用 `input_type + input_id + content_hash`，同一派生素材正文变化后可重新进入分析。
- 记忆提案仍必须引用至少两个不同人物处理记录；OpenViking 派生素材不能替代独立运行证据。

### 4. SQLite 降级检索

- 删除旧 `persona_learning_fts`。
- 新建 `learning_fts`，仅索引已生效的世界成长、人物成长和人物记忆。
- 通过成长、记忆主记录触发器维护索引，候选、拒绝或归档内容不会进入运行检索。

## 数据迁移

- 新增：`drizzle/0010_openviking-learning-projection.sql`
- 新增：`drizzle/meta/0010_snapshot.json`
- 新增业务表：`openviking_derived_memories`
- 迁移旧 `context_sync_records` 时，历史记录统一补为：
  - `entity_type = 'source_material'`
  - `operation = 'upsert'`

## 分层约束

- API 控制器未直接访问数据库或 OpenViking。
- `LearningApplicationService` 仅通过学习仓储和同步任务队列提交事实与投影意图。
- `ContextSynchronizationApplicationService` 仅通过上下文仓储、OpenViking 端口和任务端口执行同步。
- SQLite 始终保存唯一业务事实；OpenViking 内容可由 SQLite 重建。

## 验证结果

执行：

```text
pnpm exec tsc -p .nuxt/tsconfig.json --noEmit
pnpm exec vitest run tests/unit/openviking-context-provider.test.ts tests/integration/context-reindex.test.ts tests/integration/learning-management.test.ts tests/integration/analysis-iteration.test.ts
pnpm run build
```

结果：

- TypeScript 类型检查通过；
- 4 个测试文件、23 项测试全部通过；
- Nuxt 生产构建通过；
- 构建仅出现第三方产物注释位置警告，不影响构建结果。

## 后续事项

- 实现灵魂、成长、记忆、世界内容的分层 Token 预算及运行上下文快照；
- 移除旧反馈直接生成灵魂版本的路径；
- 清理旧 `persona_versions`、`world_versions`、`persona_growth_records`、`persona_memories` 依赖；
- 按方案 A 清空业务数据并重建，仅保留管理员凭据。
