# OpenViking API Key 多 User 隔离开发记录

日期：2026-08-30

## 目标

把 OpenViking 从单一 `default` User 下的逻辑请求头隔离，改为 OpenViking v0.4.16 API Key 模式提供的真实 User 边界：

```text
Account：ren-yang
├── default：ADMIN，同时承载全部无世界人物
│   └── persona-{personaId}：无世界人物 Peer
└── world-{worldId}：一个世界对应一个业务 User
```

人物在所属业务 User 内映射为 `persona-{personaId}` Peer。SQLite 继续作为唯一业务事实源，OpenViking 只保存可删除、可重建的检索和记忆投影。

## 已验证的 OpenViking 契约

针对实际部署的 OpenViking v0.4.16 完成黑盒验证：

- `/health` 返回 `auth_mode=api_key`。
- 当前 Account 为 `ren-yang`，当前 ADMIN User 为 `default`。
- ADMIN User Key 可以创建、查询、刷新和删除同 Account 的 User。
- 创建 User 与刷新 Key 接口都会返回对应 `user_key`。
- User Key 调用 `/api/v1/system/status` 时返回其所属 User。
- 测试过程中未输出、记录或提交 ADMIN/User Key，临时测试 User 已删除。

## 实现内容

### 控制面与数据面

- `NUXT_OPEN_VIKING_API_KEY` 只接受当前 Account 的 ADMIN User Key。
- ADMIN Key 调用 Account User 管理接口，并承载无世界人物的数据操作。
- 世界资料、人物资料、检索和 Session 使用目标世界 User 的 User Key；无世界人物使用 ADMIN Key。
- User Key 只缓存在当前进程内，不写入 SQLite、日志或接口响应。
- 进程重启后按需刷新 User Key；业务请求遇到 401 或 403 时刷新一次并重试。
- 人物请求只附加 `X-OpenViking-Actor-Peer`，不再发送在 API Key 模式下无效的动态 Account/User 请求头。

### User 生命周期

- 世界创建、删除，人物创建、删除和人物切换世界后，排入持久化 `sync_openviking_users` 对账任务。
- 对账创建 SQLite 缺失的业务 User，并删除 SQLite 已不存在的孤立业务 User。
- 对账还会删除旧版本遗留的 `standalone-*` User；OpenViking 返回异步删除任务时，等待任务完成后再判定成功。
- OpenViking 对 User 初始化、删除返回 412 时，在有限维护窗口内重试。
- 全量重建保留仍有效的 User，只刷新 User Key 并原位清理受管 Resource、Session 和 Peer；不再删除后立即同名重建。
- 全量重建后把 SQLite 中已完成的 Session 标记为待重放，并重新排入 Session 同步任务；SQLite 已保存的派生记忆不删除。

### 全量重建的语义队列处理

OpenViking v0.4.16 的 `DELETE /api/v1/fs` 在文件和向量删除完成后，`wait=true` 还会等待语义刷新。真实环境中递归删除受管 Resource 或 Peer 目录会因语义队列积压阻塞超过 180 秒。

本次按 OpenViking v0.4.16 源码契约调整为：

- 全量重建递归删除受管 Resource 和 Peer 目录时使用 `wait=false`；
- 后续从 SQLite 重放资料仍使用 `wait=true`，由同一队列顺序确认最终新索引；
- 远端受管目录清理成功后，只删除旧 SQLite 同步状态，不再对每条旧 URI 重复发起语义删除；
- 每次写入前读取稳定资源目录内的原文并核对 SHA-256，已一致时直接收敛 SQLite 同步状态，避免客户端超时后重复删除重传；
- 首次写入的远端原文不存在时跳过无效删除，只有远端原文存在且哈希变化时才删除替换；
- 日常增量资料删除仍使用 `wait=true`，不改变已有一致性语义。

OpenViking v0.4.16 队列观察接口的 `is_healthy/has_errors` 来自进程启动后的累计错误次数，一次资料错误会一直保留到服务重启。因此应用只用该接口判断队列组件当前是否可达，不再把累计错误解释为全局不可写。单条资料嵌入上下文超限属于输入限制，只失败该条投影并使用 SQLite 回退。

## 主要修改文件

- `server/infrastructure/context/OpenVikingHttpContextProvider.ts`
- `server/application/context/ContextSynchronizationApplicationService.ts`
- `server/application/content/ContentApplicationService.ts`
- `server/application/tasks/TaskRoutingApplicationService.ts`
- `server/infrastructure/database/SqliteContextIndexRepository.ts`
- `server/infrastructure/database/SqliteContextSyncTaskQueue.ts`
- `server/ports/ContextIndexRepository.ts`
- `server/ports/ContextSyncTaskQueue.ts`
- `server/ports/OpenVikingPort.ts`
- `app/pages/settings.vue`
- `.env.example`
- `docs/09-部署备份与安全.md`
- `docs/14-SQLite与OpenViking协同架构修改需求.md`
- `docs/调研/OpenViking账号用户Peer与数据隔离.md`

## 自动化验证

- 定向测试：`tests/unit/openviking-context-provider.test.ts`、`tests/integration/context-reindex.test.ts` 与 `tests/integration/content-management.test.ts`，43 项通过。
- 全量 Vitest：36 个测试文件、190 项测试通过。
- Nuxt 生产构建通过。
- `pnpm typecheck` 仍被既有 TypeScript 7.0.2 与 vue-tsc 3.3.11 导出兼容问题阻断：TypeScript 未导出 `./lib/tsc`。该问题发生在项目源码检查前，不是本次代码错误。

测试覆盖 ADMIN 权限门禁、不同世界使用不同 User Key、无世界人物复用 `default`、User 对账等待异步删除、累计队列错误不误降级、单条嵌入超限不全局降级、旧 `default` 清理顺序、原位重建、412 重试、过期 User 状态恢复、已删除 User 不重建、递归维护删除不等待语义队列、原文哈希幂等收敛、Session 重放和 SQLite 派生记忆保留。

## 真实环境结果

Account `ren-yang` 已存在并与 SQLite 一致：

- `default`：ADMIN User；
- `world-78c316ad-4965-4eff-b1d7-5195d86ba226`：三国；
- `world-2dbb3a08-ef3a-4f60-bb57-084dd83b16ec`：北宋末年·宋徽宗时期；
- `standalone-a72b0d3e-db93-4a6c-9e69-d3192111ef61`：当前无世界的刘备。

以上是 2026-08-30 的历史实测快照。当前映射已调整为：无世界人物刘备位于 `default` 下的 `persona-a72b0d3e-db93-4a6c-9e69-d3192111ef61` Peer；旧 `standalone-*` 由 User 对账删除。

首次真实资料重建共 8 条投影，客户端均因 OpenViking 语义等待超时保存为失败状态。后续按稳定 URI 核对原文发现其中 6 条已在客户端超时后由 OpenViking 完成写入；加入哈希幂等逻辑并执行增量收敛后，这 6 条无需重传即改为同步。另 2 条三国资料跳过无效删除后首次上传，其中 1 条在超时后完成并经哈希确认。最终 SQLite 为 7 条 `synchronized`、1 条 `failed`。

真实 User Key 黑盒验证结果：

- 三个业务 User 调用 `/api/v1/system/status` 均返回各自 User；
- 北宋 User 读取自身世界资料返回 200，三国 User 读取同一相对 URI 返回 404；
- 独立人物 User 读取自身 Peer 资料返回 200，北宋 User 携带同一 Peer 读取返回 404。

这证明控制面 User 映射和数据面资源隔离均已生效。OpenViking 观察接口同时显示：

- OpenViking HTTP 健康，版本为 v0.4.16；
- Models、VikingDB、Lock 和 Filesystem 健康；
- Queue 不健康，最后检查时 Embedding 已累计 2 个错误；
- Semantic 存在等待及处理中任务，并已累计大量重新排队；
- `/api/v1/system/wait` 返回 `DEADLINE_EXCEEDED`。

因此，多 User 隔离已经真实验证；剩余阻断是 1 条资料投影和语义检索完整性尚未通过。当前机器没有 Docker，OpenViking 位于另一台主机的 20000 端口，本项目没有可安全调用的远程重启接口。

## 当前恢复与验收步骤

后续源码核对确认，`/api/v1/observer/queue` 的错误数是进程生命周期内的累计值，不能据此要求重启 OpenViking。当前失败资料实际超过嵌入模型 1280 Token 上下文限制，属于单条输入问题。

1. 缩短失败资料，或提高 OpenViking 嵌入模型上下文上限后重新同步该资料。
2. 在系统中心执行 OpenViking 连接测试；服务、ADMIN 权限和队列接口可达即通过，不再要求累计错误数归零。
3. 执行全量重建，确认 User 对账等待异步删除完成，并移除多余 `world-*` 与旧 `standalone-*`。
4. 后台存在四个世界时，远端最终只保留 `default` 和四个对应 `world-*`，共五个 User。
5. 确认其他资料不受单条嵌入超限影响，失败资料保留明确错误并使用 SQLite 回退。
6. 分别在世界 User 和 `default` 下的无世界人物 Peer 执行语义检索，确认资料范围不串台。
