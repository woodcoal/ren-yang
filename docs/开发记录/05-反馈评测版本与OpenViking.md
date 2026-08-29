# 阶段五开发记录：反馈、评测、版本与 OpenViking

## 阶段状态

- 完成日期：2026-08-29。
- 范围：反馈归因、候选记忆、人物修订提案、固定评测、发布门禁、OpenViking 可选上下文索引和管理界面。
- 前置提交：`d49f668`（阶段四图片、图文块与三格式导出）。
- 结果：阶段五完成；SQLite 继续作为唯一业务事实源，OpenViking 仅是可关闭、可重建的外部索引。

## 实现边界

本阶段没有训练模型，也没有把自由文本反馈直接写入当前人物。固定流程为：

```text
原始反馈（不可变）
  → AI 分类建议（不可执行）
  → 用户确认或纠正
  → 当前产物重试 / 参数建议 / 资料冲突记录 / 候选人物版本
  → 固定后台评测
  → 确定性风险门禁
  → 自动发布或人工发布 / 拒绝
```

- 当前产物反馈只创建一个新的单块任务，不修改人物。
- 参数反馈只保存下次运行覆盖建议，不原地修改参数方案。
- 资料事实反馈只保存冲突和修订建议，不自动改资料或人物。
- 长期人物反馈创建候选记忆、不可变候选版本和修订提案。
- 候选记忆不能直接晋升为人物版本，必须经过同一提案和评测门禁。

## 反馈事实与风险门禁

原始反馈、模型建议和用户确认分别保存，用户确认后不允许重复执行。直接编辑结果、评价方向、长期意图和可选产物块均保留供审计。

低风险严格限定为：

- 只修改 `expressionStyle` 或 `interests` 中一个字段。
- 新值完整保留旧值，只追加内容。
- 追加内容不超过 500 字。
- 不存在资料证据冲突。

以下情况禁止自动发布：

- 身份、价值观、人物定位、外观或视觉风格变化。
- `constraints` 约束与安全边界变化；该字段为最高风险。
- 同时修改多个字段、覆盖或删除原内容。
- 存在证据冲突。
- 固定评测未全部通过，或提案基础版本已不再是人物当前版本。

低风险提案只有在全部评测通过、基础版本仍有效、无冲突且部署明确开启 `NUXT_FEEDBACK_AUTO_PUBLISH_LOW_RISK=true` 时才自动发布。默认关闭。高风险和最高风险提案即使评测通过也必须人工确认。发布和拒绝均保存原因，旧版本不覆盖。

## 后台评测

`POST /revision-proposals/{id}/evaluate` 只固定输入并原子创建 `evaluation_run` 与持久任务，返回 HTTP 202。Worker 通过应用层任务路由调用反馈应用服务，不由控制器或 Worker 访问数据层。

每项评测固定保存：

- 基础人物版本与候选人物版本。
- 活动评测用例集合。
- 文本模型、参数和提示版本。
- 基础输出、候选输出、两者评分和简短说明。
- 确定性失败原因与最终状态。

模型分数只作为证据。必需词、禁用词、最低候选分、目标改善和最大退化由应用代码判断。评测任务最多执行两次；Worker 重启后，租约过期的排队或运行中评测可以恢复。

## SQLite 迁移

新增 `drizzle/0004_feedback-evaluation-openviking.sql`，包含九张表：

| 表 | 职责 |
|---|---|
| `feedback_events` | 不可变原始反馈 |
| `feedback_suggestions` | 固定模型分类建议及快照 |
| `feedback_resolutions` | 用户确认目标和动作结果 |
| `revision_proposals` | 字段差异、风险、状态和决策原因 |
| `candidate_memories` | 尚未晋升的长期假设 |
| `evaluation_cases` | 人物固定回归用例 |
| `evaluation_runs` | 后台评测输入与汇总状态 |
| `evaluation_results` | 逐用例比较证据和硬规则结果 |
| `context_sync_records` | OpenViking 逐资料同步事实 |

真实升级测试先用 `0000` 至 `0003` 创建阶段四数据库，写入人物、人物版本、生成运行、文档、块尝试和图片资产，再应用 `0004`。升级后旧数据和图片资产完整保留，九张新表为空，`PRAGMA foreign_key_check` 无错误。

## OpenViking 集成

生产适配器使用 OpenViking 原生 HTTP 契约：

```text
GET    /health
POST   /api/v1/resources/temp_upload
POST   /api/v1/resources                  wait=true
POST   /api/v1/search/find                read_content=true
DELETE /api/v1/fs
```

每项 SQLite 资料映射为稳定 URI：

```text
viking://resources/ren-yang/{sourceId}.md
```

OpenViking 开启时，资料创建、文件导入和资料更新只在 SQLite 成功后创建 `sync_context_source` 持久任务。Worker 读取执行时的最新 SQLite 正文，最多尝试三次，并保存 `pending`、`synchronized` 或 `failed` 状态、正文哈希、远端 URI 和脱敏错误。资料 HTTP 请求本身不等待外部网络。

关闭 OpenViking 时不创建同步任务，运行使用 SQLite FTS5。开启后故障不会在同一次运行中静默回退 SQLite。管理页可主动检查健康状态，也可明确确认后删除 `viking://resources/ren-yang` 并从 SQLite 全量重建。SQLite 正文、关联、版本和运行历史均不依赖远端索引恢复。

## 应用分层

```text
页面 / API 控制器
        ↓
内容、反馈、上下文应用服务
        ↓
仓储、任务队列、模型、上下文端口
        ↓
SQLite / OpenAI-compatible HTTP / OpenViking HTTP

内部 Worker
        ↓
WorkerApplicationService → TaskRoutingApplicationService
        ↓
生成 / 反馈评测 / 上下文同步应用服务
```

- 控制器只解析输入并调用请求上下文中的应用服务。
- 内容服务只通过 `ContextSyncTaskQueue` 排队，不导入 OpenViking 或 SQLite 实现。
- Worker 只领取、路由和完成任务，不访问仓储实现。
- 应用层不依赖 H3、Drizzle、better-sqlite3 或基础设施目录。
- `ApplicationRuntime` 是唯一组合根；OpenViking 关闭时不向内容服务注入同步队列。

## API 与管理界面

新增接口：

- 反馈：提交、历史列表、分类确认。
- 修订提案：列表、详情、后台评测、人工发布和拒绝。
- 评测：人物回归用例创建/列表、评测运行详情。
- 系统：提供器检测、OpenViking 全量重建和逐资料同步状态。

新增管理界面：

- 运行详情：反馈提交、AI 分类确认、固定人物版本快照和关联资料。
- `/feedback`：提案审核、评测用例和反馈事件历史。
- `/evaluations/[id]`：后台轮询与逐用例基础/候选结果。
- `/settings`：OpenViking 非敏感能力、健康检测、全量重建和同步记录。

页面继续只做数据编排。反馈表单、分类确认、提案审核、评测用例和评测结果均为独立组件，使用类型化 Props 与事件。模型、资料和用户文本只通过文本插值展示，不使用 `v-html`。

## 自动化测试

执行 `pnpm test`：18 个测试文件、90 项测试全部通过。

| 测试组 | 阶段五验证内容 |
|---|---|
| 风险策略单元测试 | 字段风险、追加限制、自动和人工发布门禁、基础版本冲突 |
| 反馈评测集成 | 四类归因、候选记忆、候选版本、硬规则优先、异步排队、评测执行和发布 |
| OpenViking 单元测试 | 上传、写入、限定 URI 检索、关闭使用 SQLite、启用故障不降级 |
| 上下文集成 | 全量重建、逐项状态、启用增量任务、Worker 路由、更新同步和关闭不排队 |
| SQLite 升级 | 阶段四数据与图片资产保留、新表为空、外键完整 |
| Nuxt 组件 | 空反馈、目标专属必填、人物字段补丁、拒绝原因和不可信评测文本 |
| 分层架构 | 控制器、Worker 和应用层继续满足禁止依赖规则 |

完整验证结果：

- `pnpm typecheck`：通过。
- `pnpm test`：18 个文件、90 项通过。
- `pnpm exec drizzle-kit check`：通过。
- `pnpm build`：通过。
- `git diff --check`：通过。

生产构建仍仅出现依赖包注解位置和构建钩子耗时警告，不影响 Nitro 产物。

## 生产 HTTP 黑盒

使用真实 `.output/server/index.mjs`、真实 SQLite、真实内部 Worker 和临时 OpenAI-compatible/OpenViking HTTP 替身完成两组验收。

OpenViking 关闭路径：

1. 创建管理员、退出并重新登录。
2. 创建并发布原创人物。
3. 创建兴趣运行，由 SQLite FTS5 路径成功完成。
4. 提交长期人物反馈并确认修改高风险 `summary` 字段。
5. 创建固定评测用例，后台评测状态为 `passed`。
6. 人工发布提案，人物当前版本指针切到候选版本。
7. 请求 OpenViking 重建返回 HTTP 422 和 `CAPABILITY_DISABLED`。

OpenViking 开启路径：

1. 创建资料后，增量任务把状态更新为 `synchronized`。
2. 删除人样专属远端根并从 SQLite 重建，唯一资料同步成功。
3. 创建关联资料的人物并发布，兴趣运行固定使用 `openviking`，远端结果转换并保存为证据快照。
4. 模拟 OpenViking 检索 HTTP 503；创建运行直接返回 `PROVIDER_UNAVAILABLE`，运行数量不增加，也没有改用 SQLite 资料证据。

黑盒结束后停止临时服务并删除两套临时数据目录、Cookie 和验证脚本，未写入仓库数据目录。

## 已知边界

- 当前只把资料正文同步到 OpenViking Resource，不同步人物版本、候选记忆或反馈到 Memory。
- 删除无关联资料后，旧远端 URI 可能保留到下一次全量重建；人物和世界检索范围已不包含该资料，因此不会被新运行检索。
- 全量重建是管理员显式同步请求；资料增量同步才经过后台任务。
- OpenViking 检索发生在运行事实创建前；外部检索失败会返回 503，不创建缺少证据快照的不完整运行。
- 每个人物最多 10 个活动评测用例；当前不提供停用或编辑用例接口。
- 参数反馈只保留建议，尚无一键创建新参数方案的操作。
- 自动发布默认关闭；启用属于部署决策，不能绕过风险、评测、冲突或基础版本门禁。
- 备份恢复、资源限额、日志轮转和正式部署加固属于阶段六。

## 阶段完成标准

- [x] 四类反馈目标可确认且不会跨目标执行动作。
- [x] 原始反馈、模型建议、用户确认和决策原因可审计。
- [x] 候选记忆不能绕过提案与评测进入人物版本。
- [x] 风险规则和自动/人工发布门禁由确定性代码执行。
- [x] 固定评测后台运行并保存逐用例证据。
- [x] OpenViking 可关闭、可检测、可增量同步、可全量重建。
- [x] OpenViking 故障不静默回退 SQLite。
- [x] SQLite 始终保存全部业务事实。
- [x] 控制器、Worker、应用服务和数据层没有跨层访问。
- [x] 类型、90 项测试、迁移、构建和生产 HTTP 黑盒通过。
