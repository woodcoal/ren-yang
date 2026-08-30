# SQLite 事实源与 OpenViking 隔离投影开发记录

> 后续状态：本文记录的是早期 Trusted 请求头隔离方案。当前 API Key 多 User 隔离方案见《31-OpenViking-API-Key多User隔离》，身份与重建规则以新记录为准。

## 完成内容

- 把 OpenViking 同步键从单资料改为资料、范围类型和范围标识组合。
- 世界资料写 User Resources，人物资料写 Peer Resources；移除账号共享 URI 和非空 `reason`。
- 资料关联、解除关联、人物换世界、人物/世界删除均排持久同步任务。
- 运行创建前执行 OpenViking 健康选择，故障时固定使用持续维护的 FTS5。
- 新增有效成长与记忆 FTS5，数据库触发器只索引 active 状态。
- 新增 OpenViking Session 持久状态和任务；普通运行禁用长期 Memory，反馈只允许 Peer events。
- OpenViking 派生记忆同步回 SQLite 后固定为候选。
- 人物详情增加通俗化记忆审核区，可确认、拒绝、停用和恢复。
- 全量重建先清理旧共享目录与已知精确投影，再从 SQLite 当前关联展开。
- 人物换世界时先用旧 User 身份删除旧投影；删除失败会保留旧身份和 URI，重试成功后才写入新世界。
- 健康检查强制确认 Trusted 认证模式，避免 API Key 模式忽略动态世界 User 请求头后发生串台。
- 启动时补偿扫描 SQLite 当前投影、终态运行和反馈，补回异常退出窗口中缺失的持久任务；相同来源的排队任务保持幂等。

## 数据迁移

迁移 `0006_openviking_projection_memory.sql`：

- 重建 `context_sync_records`，旧单资料同步记录丢弃并等待安全重建。
- 新增 `openviking_session_records`、`persona_memories`、`persona_growth_records`。
- 新增 `persona_learning_fts` 及状态感知触发器。
- 扩展证据角色，允许保存 growth 和 memory 快照。

旧账号共享目录不由迁移直接联网删除；管理员执行上下文重建时由适配器精确清理。

## 验证结果

- OpenViking HTTP 契约：Trusted 身份头、User/Peer URI、空 reason、精确 URI 检索、受限 Session Memory。
- SQLite 集成：多范围投影、异步删除重试、全量重建、active-only FTS5。
- 针对性测试覆盖跨世界投影删除重试、Trusted 模式门禁和启动任务补偿。
- 全量 Vitest：29 个测试文件、145 项测试全部通过。
- Nuxt 生产构建通过。
- `vue-tsc` 被工作区已有 TypeScript 7.0.2 与 vue-tsc 3.3.11 的导出兼容问题阻断：TypeScript 未导出 `./lib/tsc`。该依赖修改不属于本次提交，且生产构建与全部运行测试均通过。
