# SQLite 与 OpenViking 协同架构修改需求

## 1. 最终决策

SQLite 是唯一业务事实源。所有资料、关联、人物设定、世界设定、运行、反馈、成长、记忆、审核状态、异步任务和远端投影状态都先写入 SQLite。OpenViking 负责可重建的语义检索、Session 归档和候选记忆提取，不得成为唯一数据来源。

FTS5 不是故障发生后临时建立的备用索引。系统持续维护资料切片、有效成长和有效记忆索引，以便 OpenViking 故障时新运行仍可执行核心流程。

## 2. 隔离映射

```text
Account：租户或独立部署
└── User：世界；无世界人物使用独立 User
    ├── User Resources：世界资料
    ├── Session：所属人物交流，消息携带 peer_id
    └── Peer：人物
        ├── Peer Resources：人物资料
        └── Peer Memories：人物候选长期记忆
```

稳定标识：

- 世界 User：`world-{worldId}`。
- 无世界人物 User：`standalone-{personaId}`。
- 人物 Peer：`persona-{personaId}`。
- 世界资料 URI：`viking://~/resources/ren-yang/{sourceId}.md`。
- 人物资料 URI：`viking://~/peers/{peerId}/resources/ren-yang/{sourceId}.md`。

一份本地资料可以关联多个世界和人物，因此同步单位是 `sourceId + scopeType + scopeId`，不是单独的 `sourceId`。

## 3. 写入与补偿

1. HTTP 控制器只调用应用服务。
2. 应用服务先完成 SQLite 写入，再创建 `task_jobs` 持久任务。
3. Worker 只调用上下文同步应用服务。
4. 同步服务读取 SQLite 当前事实，计算应存在和应删除的远端投影。
5. 外部调用结束后以短事务保存成功、失败或候选记忆结果。
6. 删除资料、解除关联、删除人物、删除世界或人物换世界时，必须清理旧投影。
7. OpenViking 恢复后重试 SQLite 中未完成任务；全量重建从 SQLite 当前关联重新展开全部投影。
8. 进程启动时对比 SQLite 当前投影、终态运行、反馈和同步记录，幂等补回业务写入与任务入队之间异常退出造成的缺失任务。

Resource 同步必须传空 `reason`，防止普通资料触发 Memory 提取。

## 4. 运行提供器选择

新运行创建前执行一次选择：

```text
OpenViking 未启用 → SQLite FTS5
OpenViking 健康且首次检索成功 → OpenViking
OpenViking 健康检查或首次检索失败 → SQLite FTS5
```

选择结果写入 `generation_runs.context_provider`。运行一旦创建，后续规划、生成、重试和历史回放都使用已保存证据快照，不得中途更换提供器。

## 5. Session 与记忆门禁

- 普通运行完成后写入世界 User Session，用户和人物消息均携带人物 `peer_id`。
- 普通 Session 使用 `memory_types=[]`，不得自动生成长期人物记忆。
- 明确反馈 Session 只允许 Peer `events`；`self=false`，不得写世界 User 画像。
- 禁止普通流程自动修改 `profile`、`identity`、`soul`、核心人物版本或灵魂。
- OpenViking 提取的记忆读取回 SQLite 后一律为 `candidate`。
- 用户可把候选记忆确认为 `active`、拒绝为 `rejected`；有效记忆可停用为 `deprecated`，废弃记忆可恢复。
- 只有 `active` 成长和记忆可以进入 FTS5、精确远端 URI 范围或提示词证据快照。

SQLite 已审核但尚无远端 URI 的有效成长和记忆作为确定性事实直接加入上下文；有远端 URI 的有效记忆才交给 OpenViking 做语义召回。

## 6. 故障语义

OpenViking 故障时仍可使用：

- 人物、世界、资料和版本管理；
- 兴趣判断和纯文本/图文生成；
- 反馈、评测、发布、回滚和历史查询；
- SQLite FTS5 资料及有效成长/记忆检索。

暂停能力：

- OpenViking 语义召回；
- Session 远端归档；
- 自动摘要和新候选记忆提取。

失败的 Resource、Session 和 Memory 任务保留在 SQLite，不能丢弃、伪装成功或在同一已创建运行内静默切换提供器。

## 7. 部署前提

世界映射为动态 User 需要 OpenViking Trusted 模式。后端必须作为受信网关传递 Account、User 和 Actor Peer，并禁止浏览器或移动端直连 OpenViking。API Key 模式下普通 User Key 固定属于一个 User，不能用请求头动态切换世界 User。

应用健康检查必须验证 OpenViking 返回的 `auth_mode=trusted`。若服务处于 `api_key` 或无法确认认证模式，则 OpenViking 能力判定为不可用，新运行固定降级到 FTS5，同步任务保留等待配置修正。

OpenViking 必须使用“人样”专用 Account 或独立部署，不能与 Codex Memory Plugin 共用普通用户空间。

## 8. 验收标准

1. 同一资料关联世界和人物时产生两个不同 URI 投影。
2. 解除关联或删除后，远端精确投影最终被删除；失败任务可重试。
3. OpenViking 故障时新运行保存 `sqlite_fts5`，恢复后不改变该运行快照。
4. 普通 Session 不产生人物候选记忆。
5. 反馈 Session 只提取 Peer events，回写状态为 candidate。
6. 候选、废弃和拒绝记忆不会被 FTS5 或 OpenViking 检索。
7. 确认后的有效记忆进入新运行证据，历史运行证据不变化。
8. 删除 OpenViking 数据后，可以从 SQLite 重建全部资料投影；Session 派生结果仍以 SQLite 审核状态为准。
