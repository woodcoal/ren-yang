# OpenViking 账号、用户、Peer 与数据隔离调研

调研日期：2026-08-29
适用基线：本机 OpenViking Server `v0.4.16`、Codex Memory Plugin `0.7.7`

## 结论

用户的担心成立，但要区分两类“串台”：

1. 当前项目使用一个固定 API Key，OpenViking 会把所有请求识别成同一个 `account_id/user_id`。若未来“人样”增加多个业务用户，OpenViking 不会自动知道当前登录的是谁，必须显式设计身份映射。
2. 当前资料写入 `viking://resources/ren-yang/{sourceId}.md`。该目录不是用户私有目录，而是当前 OpenViking `account` 内默认共享的资源区。同账号内其他用户可见；相同 URI 也指向同一对象，写入、删除和全量清理均可能互相影响。[S1][S5]
3. 当前检索并非完全无边界：项目会先从 SQLite 得到人物/世界实际关联的资料，再把这些资料的精确 URI 列表传给 `find`，并限制 `context_type=resource`。这降低了当前人物之间的误召回风险，但不能把共享目录变成权限隔离边界。
4. 当前项目传入了非空 `reason="人样资料索引同步"`。OpenViking `v0.4.16` 会把非空 `reason` 送入正常会话记忆提取流程，在当前 OpenViking 用户空间生成可引用该资源的记忆；这与项目文档中“只同步资料正文、不写 OpenViking Memory”的设想不一致，是另一条潜在串台来源。[S8]
5. 当前产品只有一个单例管理员，因此现阶段不需要立即建设完整多租户网关。最小安全方案是：为“人样”建立专用 OpenViking 用户/API Key，把资料迁到 `viking://~/resources/ren-yang/{instanceId}/{sourceId}.md`，并停止发送非空 `reason`。`peer` 不应被当作业务用户的替代品。

## 版本澄清

“0.7.7”不是 OpenViking Server 版本，而是 Codex Memory Plugin 的版本。官方 `v0.4.17` 仓库中的插件清单明确写着 `version: 0.7.7`；OpenViking Server 同期发布版本是 `v0.4.17`。[S11][S12]

使用本机 `ovcli.conf` 当前用户 Key 对已配置服务做只读核验，结果如下（未记录或输出密钥）：

```text
GET /health
version    = v0.4.16
auth_mode  = api_key
account_id = default
user_id    = coder
role       = user
```

因此，本机服务端基线是 `v0.4.16`，不能把插件版本 `0.7.7` 当成服务端版本。本文的行为判断优先采用 `v0.4.16` 标签下的官方文档和源码；官方在线文档跟随主分支，可能包含 `v0.4.17` 或尚未发布的变化。若“人样”运行进程使用另一把 Key，仍需在实施时单独核验该 Key 对应的 `account_id/user_id/role`。

`v0.4.17` 与本机 `v0.4.16` 最相关的差异是当前用户 URI：

- `v0.4.16` 同时支持 `viking://user/resources/...`、`viking://~/resources/...` 和显式 `viking://user/{user_id}/resources/...`。[S2][S7]
- `v0.4.17` 移除了公开接口中的旧式无用户 ID 写法 `viking://user/resources/...`，要求改用 `viking://~/resources/...` 或显式用户路径。[S12]
- 因而新代码应使用 `viking://~/resources/...`。它同时适用于本机 `v0.4.16` 和最新发布版，且由服务端根据已认证用户展开为规范 URI。

最新 `main` 在线文档还增加了共享资源 ACL，可在账号内限制 `viking://resources` 下的目录或文件；`v0.4.16/v0.4.17` 的正式多租户表仍将该区域定义为账号内共享。本项目不能在本机升级并完成兼容性验证前依赖 ACL。[S14]

### Codex 插件 0.7.7 的额外 Peer 行为

插件与本项目的 HTTP 适配器不是同一调用链，但它也解释了为什么“设置了 Peer”不等于“绝对隔离”：

- 插件会根据工作区路径生成 Peer，并在捕获消息时传 `peer_id`；
- 插件 Recall 默认是 broad 模式，会召回当前用户的全局记忆、当前工作区和其他工作区记忆；
- 只有设置 `OPENVIKING_RECALL_PEER_SCOPE=actor`，并配置明确 Peer，才进入 Actor 隔离模式；其 MCP 代理在 broad 模式下会故意不发送 `X-OpenViking-Actor-Peer`。[S15]

这些行为只影响 Codex Memory Plugin，不会自动改变“人样”当前的原生 HTTP 请求。但同一个 OpenViking 用户同时供 Codex 插件和“人样”使用时，非空 `reason` 生成的记忆可能进入插件的 broad recall，因此更应使用“人样”专用用户 Key。

## 身份模型

### Account

`account_id` 是外层租户边界，适合作为团队、客户、工作区或独立应用空间。相同公开 URI 在不同账号下会映射到不同物理路径：

```text
viking://resources/x.md
→ /local/{account_id}/resources/x.md
```

因此，不同 `account_id` 下的同名 URI 不冲突。官方存储实现会在所有 Viking URI 前增加账号目录。[S1][S5]

### User

`user_id` 是账号内的数据所有者边界：

- 普通用户只能访问自己的用户空间；
- 用户记忆和会话按 `user_id` 隔离；
- 用户私有资料位于 `viking://user/{user_id}/resources/...`；
- 用户私有技能位于 `viking://user/{user_id}/skills/...`。

在已认证请求中，`viking://~/...` 会展开为当前用户的 `viking://user/{user_id}/...`。同一个字面 URI `viking://~/resources/x.md` 由不同用户调用时会指向各自的规范目录。[S1][S2][S10]

### Peer

`peer_id` 是“当前用户正在与谁互动”的内容分区，不是租户，也不改变当前账号或用户身份。Peer 内容位于：

```text
viking://user/{user_id}/peers/{peer_id}/memories/...
viking://user/{user_id}/peers/{peer_id}/resources/...
```

请求头 `X-OpenViking-Actor-Peer` 或客户端参数 `actor_peer_id` 会把当前用户的 `peers` 集合限制到一个 Peer。它不会隐藏当前用户自己的资料、记忆和技能，也不会隐藏账号共享的 `viking://resources`；空目标检索仍包含当前用户根和共享资源区。[S1][S6]

因此：

- 业务登录用户应映射到 OpenViking `account/user`，不能只换 `peer`。
- 模拟人物不必天然映射成 OpenViking 用户或 Peer。当前模拟人物只是“人样”的业务对象，资料还可能同时关联多个人物和世界；将人物强行映射为 Peer 会造成资料复制或共享语义不清。
- 只有未来确实使用“关于某个交互对象的记忆/资料”时，才适合把人物或外部参与者映射到 Peer。

## 各类数据的隔离范围

| 数据路径 | 默认隔离范围 | 同账号内相同 URI 是否冲突 | 说明 |
| --- | --- | --- | --- |
| `viking://resources/...` | `account` | 是 | 账号共享资料；同账号普通用户默认可检索，后续版本可用 ACL 收紧 |
| `viking://user/{userId}/resources/...` | `account + user` | 不同用户不冲突 | 用户私有资料 |
| `viking://user/{userId}/peers/{peerId}/resources/...` | `account + user + peer` | 不同用户/Peer 不冲突 | 交互对象专属资料 |
| `viking://user/{userId}/memories/...` | `account + user` | 不同用户不冲突 | 当前用户记忆 |
| `viking://user/{userId}/peers/{peerId}/memories/...` | `account + user + peer` | 不同用户/Peer 不冲突 | 关于某个交互对象的记忆 |
| `viking://user/{userId}/skills/...` | `account + user` | 不同用户不冲突 | 用户私有技能 |
| `viking://agent/skills/...` | `account` | 是 | 账号共享 Agent Skill；不是按 `agent_id` 隔离 |

官方多租户表、URI 结构和 Skills API 对以上边界有直接说明。[S1][S2][S10]

## 服务端如何确定请求身份

### API Key 模式

数据接口使用 `X-API-Key: <user-key>` 或 `Authorization: Bearer <user-key>`。服务端从密钥记录解析 `account_id`、`user_id` 和角色，再构造贯穿 Router、Service、VikingFS 的 `RequestContext`。[S3][S4]

在 `api_key` 模式中：

- `X-OpenViking-Account` 和 `X-OpenViking-User` 不能用来切换身份；`v0.4.16` 会忽略并移除它们；
- ROOT Key 不绑定普通租户用户，不能调用 `find`、资料写入、文件删除等租户数据接口；
- 正常数据调用必须使用 USER 或 ADMIN 用户 Key。[S1][S4]

因此，当前项目只有一个静态 `NUXT_OPEN_VIKING_API_KEY` 时，OpenViking 永远把所有请求看成该 Key 对应的同一用户。本机即 `default/coder`。

### Trusted 模式

Trusted 模式由受信任上游传入：

```text
X-OpenViking-Account: <accountId>
X-OpenViking-User: <userId>
```

非本机部署还应配置并验证 `root_api_key`。服务端要求账号和用户身份成对出现，并用它们构造请求上下文。它适合由“人样”后端充当可信网关、按当前业务登录用户转发身份，但 OpenViking 不能暴露给绕过该网关的客户端。[S1][S9]

### Dev 模式

Dev 模式不认证请求，服务端使用 `default/default` ROOT 上下文，并且只允许监听本机。它适合临时开发，不适合多用户或远程部署；所有调用都会落入同一身份空间。[S1]

### Actor Peer

两种模式都可选传 `X-OpenViking-Actor-Peer`。它只增加 Peer 视图过滤，不替代 API Key，也不替代账号和用户身份。[S3][S6]

## 一把 API Key 是否会导致串台

在 `api_key` 模式中，一把用户 Key 固定对应一个 `account_id/user_id`：

- 多个“人样”业务用户共用它时，OpenViking 侧的用户隔离会完全合并，答案是会串台；
- 多个模拟人物共用它，但每次始终使用 SQLite 授权后的精确资料 URI 时，不会仅因共用 Key 就必然互相召回；不过权限、写入、删除和默认检索仍共用同一空间；
- `user_id=default` 本身不代表跨账号公开，账号边界仍存在；真正的问题是同一账号/用户被多少业务主体共同使用；
- Codex 插件和“人样”共用同一用户 Key 时，两者的用户 Memory 空间也共用。当前非空 `reason` 会放大这一风险。

所以“换成任意一把 USER Key”还不够；应使用“人样”专用 Key，并在未来多业务用户出现时建立一对一或可信网关映射。

## Add、Delete、Find、Search 的身份要求

四个接口都依赖同一个 `get_request_context`，所以身份规则一致；差别只在业务参数。[S3][S13]

| 操作 | API | API Key 模式必需身份 | Trusted 模式必需身份 | 可选 Peer | 业务范围字段 |
| --- | --- | --- | --- | --- | --- |
| 上传临时资料 | `POST /api/v1/resources/temp_upload` | USER/ADMIN Key | Account + User；远程部署还需可信凭据 | `X-OpenViking-Actor-Peer` | 文件本体 |
| 添加资料 | `POST /api/v1/resources` | USER/ADMIN Key | 同上 | 同上 | `to` 或 `parent` 决定共享、用户或 Peer 路径 |
| 删除资料 | `DELETE /api/v1/fs?uri=...` | USER/ADMIN Key | 同上 | 同上 | `uri`；服务端执行命名空间和 Peer 访问检查 |
| 直接检索 | `POST /api/v1/search/find` | USER/ADMIN Key | 同上 | 同上 | `target_uri` 限制检索目录；空值会搜当前用户根和共享资源 |
| 带会话检索 | `POST /api/v1/search/search` | USER/ADMIN Key | 同上 | 同上 | 与 `find` 相同，并可带 `session_id` |

请求体中不存在用于切换租户的 `user_id` 或 `peer_id`。Peer 视图应使用请求头/客户端 `actor_peer_id`；官方迁移文档明确说明 `find/search` 请求体中的 `peer_id` 不受支持。[S7]

## 当前项目风险审计

### 已有防线

当前 `OpenVikingHttpContextProvider` 有以下正确边界：

- SQLite 是业务事实源；
- 只把资料正文同步到 OpenViking；
- 检索前由 SQLite 计算当前人物/世界关联的资料范围；
- `find` 使用精确 `target_uri[]`、`context_type=resource` 和上限；
- 删除使用稳定的资料 UUID URI。

所以只要 SQLite 关联查询正确，当前人物 A 不会因为共享目录中存在人物 B 的资料就自动召回 B；主要风险在权限、覆盖、清理和未来多用户，而不是当前这条精确检索语句本身。

### 仍存在的风险

1. **账号共享资源**：`viking://resources/ren-yang/...` 对 `default` 账号内其他用户可见。
2. **静态身份**：所有“人样”请求都使用同一个 Key；未来增加多个业务用户后无法隔离。
3. **递归清理过宽**：全量重建会递归删除 `viking://resources/ren-yang`。如果另一实例或用户也使用该目录，会被一起删除。
4. **非空 reason 生成 Memory**：每次同步可能在 `default/coder` 下提取记忆，项目没有追踪这些记忆 URI；切换资料命名空间本身不会自动证明旧记忆已清空。[S8]
5. **配置与数据库身份脱节**：当前 SQLite 模型只有单例管理员，也没有 tenant/user 所有权字段。仅给 OpenViking 请求增加 Peer 头不会弥补业务库缺少多租户边界的问题。

## 推荐方案

### 当前阶段：专用 OpenViking 用户 + 用户私有资料

这是最小且与当前单管理员产品一致的方案：

1. 在 OpenViking 中为“人样”建立专用账号或至少专用用户，运行时只配置该 USER Key，不复用个人 Codex/OpenViking Key。
2. 资料根改为：

   ```text
   viking://~/resources/ren-yang/{instanceId}/{sourceId}.md
   ```

   `instanceId` 用于防止两套“人样”部署意外共用同一用户 Key；单实例也应生成并持久化一次，而不是每次启动变化。
3. 同步 `add_resource` 时保持 `reason` 为空；仅通过 `instruction` 约束解析，避免触发 Memory 提取。
4. 启动健康检查读取 `/health` 的 `auth_mode/account_id/user_id/role/version`，日志和设置页只显示非敏感身份摘要。若拿到 ROOT Key 或服务端版本不兼容，应拒绝启用数据同步。
5. 搜索仍使用 SQLite 计算出的精确 `target_uri[]`，不要改成空目标检索。
6. 人物和世界继续使用业务数据库关联资料；暂不引入 Peer 映射。

这能隔离“人样”和同账号其他用户的数据，但不会提前引入当前产品并不存在的多业务用户体系。

### 未来出现多个业务用户时

届时必须先给 SQLite 所有人物、世界、资料、运行和任务补充同一套 tenant/user 所有权，再选择以下一种 OpenViking 映射：

| 方案 | 做法 | 优点 | 代价 | 推荐场景 |
| --- | --- | --- | --- | --- |
| 每业务租户一个 OpenViking Account | 为每个客户创建账号和用户 Key | 隔离最强；共享范围清晰 | 账号/Key 生命周期管理最多 | SaaS 客户级硬隔离 |
| 同 Account、每业务用户一个 OpenViking User | 每用户使用独立用户 Key，资料写用户私有目录 | 符合 OpenViking原生模型 | 后端需安全保存、轮换多把 Key | 团队内多用户 |
| Trusted 网关 | “人样”后端验证登录后转发 Account/User 头 | 不必为每次请求切换存储 Key；适合动态多用户 | 必须严格限制网络边界，防止伪造头 | 后端能独占访问 OpenViking 时 |

不推荐“所有业务用户共用一个 OpenViking User，仅用 Peer 区分”。Peer 不改变用户身份，当前用户根和共享资源仍可见，无法形成完整租户边界。[S1][S6]

## 迁移风险与顺序

不能只改 URI 生成函数后直接重建。安全迁移顺序如下：

1. 固化并记录当前 OpenViking 服务版本、账号、用户和旧资源根。
2. 创建专用用户/API Key，并验证它无法读取旧共享资源以外的用户私有空间。
3. 生成并持久化 `instanceId`。
4. 暂停同步 Worker，避免旧路径和新路径并发写入。
5. 从 SQLite 全量写入新用户私有路径，保存 OpenViking 返回的规范 URI和内容哈希。
6. 使用新 Key、精确新 URI 执行检索验收；核对资料数、内容哈希和人物/世界范围。
7. 切换运行检索到新路径后再恢复 Worker。
8. 按 SQLite 已知的每个旧 `sourceId` 精确删除旧共享文件。除非已确认该目录只属于这一实例，否则禁止递归删除整个 `viking://resources/ren-yang`。
9. 检查并清理旧 `reason` 产生的用户记忆。资源删除会尝试清理由该 `reason` 建立的引用，但应通过当前用户的记忆目录和检索验证，不应仅凭删除成功推断全部清理完成。[S8]

需要特别处理：

- 现有同步记录中的 `remote_uri` 必须迁移，不能继续从旧共享规则盲目推导；
- 已排队的旧同步/删除任务可能仍指向旧 URI；
- 删除本地资料后同步记录可能被级联删除，因此删除任务必须携带或可稳定重建“当时的命名空间版本 + 实例 ID + sourceId”；
- 切回旧 Key 只能作为短期回滚，不能同时让两套身份持续写同一份逻辑资料；
- OpenViking 仍是可重建索引，迁移失败不得修改 SQLite 业务事实。

## 官方一手资料

- **[S1] 多租户模型（v0.4.16）**：账号、用户、Peer、共享/私有资源边界及身份模式。
  <https://github.com/volcengine/OpenViking/blob/v0.4.16/docs/en/concepts/11-multi-tenant.md#core-identity-model>
- **[S2] Viking URI（v0.4.16）**：`~`、用户资源、Peer 资源、Skill 的规范路径。
  <https://github.com/volcengine/OpenViking/blob/v0.4.16/docs/en/concepts/04-viking-uri.md#home-alias->
- **[S3] 请求上下文构造（v0.4.16 源码）**：API Key/Bearer、Account/User/Actor-Peer 请求头进入 `RequestContext`。
  <https://github.com/volcengine/OpenViking/blob/v0.4.16/openviking/server/auth/__init__.py#L54-L175>
- **[S4] API Key 身份解析（v0.4.16 源码）**：密钥解析 Account/User，忽略身份断言头，限制 ROOT 调用数据接口。
  <https://github.com/volcengine/OpenViking/blob/v0.4.16/openviking/server/auth/plugins/api_key.py#L68-L177>
- **[S5] 物理路径隔离（v0.4.16 源码）**：Viking URI 映射到 `/local/{account_id}/...`。
  <https://github.com/volcengine/OpenViking/blob/v0.4.16/openviking/storage/viking_fs/_access.py#L415-L451>
- **[S6] 默认检索与 Peer 过滤（v0.4.16 源码）**：空目标包含用户根和共享资源，Actor Peer 只收窄 Peer 集合。
  <https://github.com/volcengine/OpenViking/blob/v0.4.16/openviking/core/retrieval_targets.py#L27-L83>
- **[S7] 0.3.x → 0.4.x User/Peer 迁移说明**：`actor_peer_id`、请求头和旧 `agent_id` 的兼容语义。
  <https://github.com/volcengine/OpenViking/blob/v0.4.16/docs/en/migration/01-user-peer-model.md#compatibility-matrix>
- **[S8] Resource API（v0.4.16）**：目标路径、非空 `reason` 的记忆提取及删除时的记忆清理。
  <https://github.com/volcengine/OpenViking/blob/v0.4.16/docs/en/api/02-resources.md#2-interface-and-parameter-description>
- **[S9] Trusted 身份解析（v0.4.16 源码）**：Account/User 头、凭据校验和身份成对要求。
  <https://github.com/volcengine/OpenViking/blob/v0.4.16/openviking/server/auth/plugins/trusted.py#L82-L177>
- **[S10] Skills API（v0.4.16）**：Skill 写入当前用户的 `viking://user/{user_id}/skills`。
  <https://github.com/volcengine/OpenViking/blob/v0.4.16/docs/en/api/04-skills.md#data-storage-structure>
- **[S11] Codex Memory Plugin 0.7.7 清单**：证明 `0.7.7` 是插件版本。
  <https://github.com/volcengine/OpenViking/blob/v0.4.17/examples/codex-memory-plugin/.codex-plugin/plugin.json#L1-L5>
- **[S12] OpenViking Server v0.4.17 发布说明**：最新发布版本与当前用户 URI 兼容性变化。
  <https://github.com/volcengine/OpenViking/releases/tag/v0.4.17>
- **[S13] 四类接口的统一身份依赖（v0.4.16 源码）**：
  Add：<https://github.com/volcengine/OpenViking/blob/v0.4.16/openviking/server/routers/resources.py#L214-L297>
  Delete：<https://github.com/volcengine/OpenViking/blob/v0.4.16/openviking/server/routers/filesystem.py#L249-L288>
  Find/Search：<https://github.com/volcengine/OpenViking/blob/v0.4.16/openviking/server/routers/search.py#L289-L432>
- **[S14] 最新主分支 ACL 文档**：ACL 只适用于账号共享资源，用户资源仍按所有者私有；该能力晚于本机发布基线。
  <https://github.com/volcengine/OpenViking/blob/main/docs/en/concepts/15-acl.md#scope-and-boundaries>
- **[S15] Codex Memory Plugin 0.7.7 Peer 召回模式**：默认 broad recall 与显式 Actor 隔离模式。
  <https://github.com/volcengine/OpenViking/blob/v0.4.17/examples/codex-memory-plugin/README.md#L106-L124>
  <https://github.com/volcengine/OpenViking/blob/v0.4.17/examples/codex-memory-plugin/scripts/shared/mcp-proxy-config.mjs#L44-L65>

在线文档入口仅用于跟踪最新行为，不作为本机 `v0.4.16` 的唯一依据：

- <https://docs.openviking.ai/en/concepts/11-multi-tenant>
- <https://docs.openviking.ai/en/guides/04-authentication>
- <https://docs.openviking.ai/en/api/02-resources>
- <https://docs.openviking.ai/en/api/06-retrieval>
