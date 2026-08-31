# SQLite 与 OpenViking 协同架构修改需求

## 1. 最终决策

SQLite 是唯一业务事实源。所有世界、人物、灵魂、成长、记忆、原始资料、处理记录、审核状态、分析批次、异步任务和远端投影状态都先写入 SQLite。

OpenViking 负责可重建的 Resource、Session、派生内容和语义排序，不得成为对象是否存在、原始数据是否启用、成长或记忆是否生效的判断依据。

FTS5 持续维护资料切片以及当前有效成长和记忆索引。OpenViking 故障时，已经确认的核心业务继续运行；语义排序和新派生暂停。

## 2. 隔离映射

```text
Account：租户或独立部署
├── default：ADMIN，同时承载无世界人物
│   └── Peer：无世界人物
│       ├── Peer Resources：人物参考资料和人物反馈资料
│       └── Peer Session：人物处理过程
└── world-{worldId}：世界
    ├── User Resources：世界资料
    └── Peer：该世界人物
        ├── Peer Resources：人物参考资料和人物反馈资料
        └── Peer Session：人物处理过程
```

稳定标识：

- 世界 User：`world-{worldId}`。
- 无显式世界的人物复用 `default` ADMIN User，不创建额外 User。
- 人物 Peer：`persona-{personaId}`。
- 世界资料 URI：`viking://~/resources/ren-yang/world-source/{sourceId}.md`。
- 人物资料 URI：`viking://~/peers/{peerId}/resources/ren-yang/persona-source/{sourceId}.md`。
- 人物反馈资料 URI：`viking://~/peers/{peerId}/resources/ren-yang/feedback-source/{feedbackSourceId}.md`。

一份本地参考资料可以关联多个范围，因此投影单位是“业务实体 + 目标范围”，不是单独资料标识。

## 3. 业务对象与远端能力

| SQLite 对象 | OpenViking 投影 | 业务用途 |
|---|---|---|
| 世界资料 | User Resource | 世界成长分析和任务世界证据 |
| 人物参考资料 | Peer Resource | 人物任务外部证据 |
| 人物反馈资料 | Peer Resource | 人物成长分析 |
| 人物处理记录 | Peer Session | 记忆派生和语义分析素材 |
| 有效世界/人物成长 | 精确可过滤投影 | 运行时相关性排序 |
| 有效人物记忆 | 精确可过滤投影 | 运行时相关性排序 |

世界没有记忆，不创建世界 Session 记忆管道。人物任务和交流写入所属 Peer 的 Session；User 只承担世界范围隔离和共享资源。

## 4. 写入与补偿

1. HTTP 控制器只调用应用服务。
2. 应用服务先完成 SQLite 业务事务，再创建 `task_jobs` 持久任务。
3. Worker 只调用上下文同步或分析应用服务。
4. 同步服务读取 SQLite 当前事实，计算应新增、更新或删除的远端投影。
5. 外部调用结束后使用短事务保存远端标识、成功、失败或派生结果。
6. 删除资料、删除人物反馈资料、解除关联、人物换世界、删除人物或世界时，必须清理旧投影。
7. OpenViking 恢复后重试未完成任务；全量重建从 SQLite 当前事实展开全部投影。
8. 进程启动时幂等补回业务写入与任务入队之间异常退出造成的缺失任务。

普通参考资料同步不得携带会触发长期人物修改的指令。人物反馈资料和 Session 可以请求派生，但派生结果只能回写 SQLite 的分析素材或候选状态。

## 5. 原始数据状态和删除

- 禁用世界资料或人物反馈资料后，下一次分析不得提交该条内容。
- 禁用人物处理记录后，下一次记忆分析不得把它作为有效证据。
- 已经同步的人物反馈资料删除时，SQLite 先标记 `pending_remote_delete` 并建立远端删除任务。
- 远端删除成功后清理本地反馈正文和活动业务行；分析批次保留哈希、标题摘要和不可变审计信息。
- 删除来源不会自动删除已确认成长或记忆，只更新来源可用状态并提示重新分析。
- 待远端删除实体不得进入任何新运行或分析范围。

## 6. Session 与派生记忆门禁

1. 人物任务完成后先在 SQLite 创建处理记录，再异步写入对应 Peer Session。
2. Session 保存人物输入、输出、选择、兴趣结论、用户反馈、任务效果和当时使用的心智标识。
3. OpenViking 可以从 Session 派生偏好、规律或经验素材。
4. 派生结果回写 SQLite 后只能作为记忆分析素材或 `candidate`，不得直接进入运行提示词。
5. 应用层把派生素材与已启用处理记录、当前有效记忆进行合并、去重和冲突分析。
6. 用户审核后才产生或修订 `active` 记忆。
7. 禁止 OpenViking 自动修改人物或世界灵魂、成长有效状态以及 SQLite 审核结果。

## 7. 分析边界

### 世界成长

应用先从 SQLite 取得已启用世界资料标识，再让 OpenViking 在对应 User Resources 内检索相关内容。分析结果保存为世界成长提案。

### 人物成长

应用先从 SQLite 取得已启用人物反馈资料标识，再让 OpenViking 在对应 Peer Resources 内检索相关内容。普通人物参考资料不能混入成长来源。

### 人物记忆

应用以已启用处理记录为业务证据；OpenViking Session 派生内容只提供补充分析素材。独立证据数量按 SQLite 的不同运行计算，不能使用 OpenViking 返回条数代替。

## 8. 运行检索门禁

新运行检索流程：

```text
SQLite 确定当前 active 且未删除的允许集合
→ OpenViking 或 FTS5 在允许集合中排序
→ 服务层复核对象、状态、哈希和范围
→ 提示词预算选择
→ 保存实际使用和跳过快照
```

OpenViking 检索必须接收精确 URI 或允许标识。空范围、默认全域、其他世界 User、其他人物 Peer、候选、归档、取代、拒绝和待删除内容一律不得进入结果。

SQLite 已确认但尚未同步远端的有效成长或记忆仍可以由 FTS5 检索。OpenViking 返回远端旧哈希时丢弃该结果并建立修复任务。

## 9. 运行提供器选择

```text
OpenViking 未启用 → SQLite FTS5
OpenViking 健康且首次范围检索成功 → OpenViking
健康检查或首次检索失败 → SQLite FTS5
```

选择结果写入运行快照。运行创建后不得切换提供器；重试继续使用已经保存的实际上下文和证据快照。

## 10. 故障语义

OpenViking 故障时仍可使用：

- 世界、人物、灵魂、成长、记忆和原始数据管理；
- SQLite FTS5 检索；
- 兴趣判断和纯文本/图文生成；
- 反馈、审核、评测、发布、历史和备份；
- 新人物处理记录保存。

暂停或降级：

- OpenViking 语义排序；
- Resource 和 Session 远端处理；
- 新的 OpenViking 派生素材；
- 依赖 OpenViking 的成长或记忆分析，界面显示暂停原因。

失败任务保留在 SQLite，不能丢弃、伪装成功或让已创建运行静默更换提供器。

## 11. 部署前提

OpenViking 使用 `api_key` 模式。数据库配置的 ADMIN User Key 必须属于当前 Account 的 `default` ADMIN User；应用为每个世界创建 `world-{worldId}` User，无世界人物直接使用 `default`。

世界业务资料、检索、删除和 Session 必须使用目标世界 User 自己的 User Key；无世界人物的数据操作使用 ADMIN Key，人物操作额外携带 Peer。世界 User Key 由 ADMIN Key 创建或刷新，只在当前应用进程内缓存，不写入 SQLite、备份、响应或日志。进程重启后可按 SQLite 的确定性 User 标识重新取得，因此 OpenViking 仍是可重建投影。

健康检查必须验证 `auth_mode=api_key`，并实际调用当前 Account 的 User 列表接口确认 ADMIN 权限。认证模式错误、密钥不是 ADMIN Key 或管理接口不可用时，OpenViking 能力判定不可用，新运行固定降级到 FTS5，同步任务保留失败事实并等待恢复。

OpenViking 使用本项目专用 Account 或独立部署，不与其他插件或项目共用普通用户空间。

`/api/v1/observer/queue` 的 `is_healthy` 和 `has_errors` 是进程启动后的累计错误状态，不能作为当前写入能力判断；健康检查只验证队列接口当前可达。单条资料的嵌入上下文超限只标记该投影失败并回退 SQLite，不得触发全局自动降级。

## 12. 全量重建

全量重建从 SQLite 读取：

- 当前世界与人物隔离映射；
- 当前有效资料关联和启用状态；
- 未删除人物反馈资料；
- 当前有效成长和记忆修订；
- 需要补传的处理记录 Session；
- 待删除投影。

重建只恢复可重建投影。SQLite 已审核内容、分析批次和运行快照不由 OpenViking 反向覆盖。

User 对账必须删除 SQLite 已不存在的 `world-*` 和旧版遗留 `standalone-*`。OpenViking 删除 User 返回异步任务时，必须等待任务成功终态后才能判定重建完成。

## 13. 验收标准

1. 同一资料投影到不同世界或人物时 URI 与范围独立。
2. 同 Account 下不同 User、同 User 下不同 Peer 之间的检索不会串台。
3. 世界资料、人物参考资料和人物反馈资料进入正确 Resource 范围。
4. 人物任务进入对应 Peer Session，世界不产生记忆。
5. OpenViking 派生结果只能形成分析素材或候选，不能直接成为有效记忆。
6. SQLite 禁用、归档、取代、拒绝和待删除内容不能被运行检索。
7. 人物反馈资料删除最终同步删除远端 Resource；失败任务可重试。
8. OpenViking 故障时新运行固定使用 FTS5，恢复后不改变历史运行快照。
9. FTS5 只召回当前有效成长、记忆和允许资料。
10. 删除 OpenViking 数据后，可以从 SQLite 重建当前投影和待处理任务。
