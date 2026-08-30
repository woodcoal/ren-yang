# 方案 A 业务数据清空与 OpenViking 重建

日期：2026-08-30

> 后续状态：本记录中的 13 条开发迁移已按用户要求压缩为单文件基线，当前状态见《20-Drizzle单文件基线迁移合并》。本记录继续保留压缩前的执行证据。

> OpenViking 后续状态：本文记录的是旧共享投影清理结果。当前 ADMIN Key 管理世界 User、User Key 访问业务数据的方案见《31-OpenViking-API-Key多User隔离》；远端身份与重建规则以新记录为准。

## 目标

按用户确认的方案 A 删除全部现有业务数据，在保留唯一管理员账号及原凭据的前提下，以当前迁移重新建立 SQLite，并清理 OpenViking 中可确认属于“人样”的旧投影。

## 执行边界

- SQLite 仍是唯一业务事实源。
- 保留 `administrators` 中唯一管理员的全部字段，不读取或输出明文密码。
- 保留 Drizzle 迁移历史，并应用至 `0012_steep_umar.sql`。
- 删除世界、人物、资料、生成、反馈、学习、同步任务、审计事件及全文索引中的全部业务数据。
- 清理本地业务日志和已经确认失效的应用实例锁。
- OpenViking 只删除专用账号中明确属于“人样”的资源和 `ren-yang-*` Session，不扩大到未知 URI。

## SQLite 重建

没有在旧数据库中逐表执行无外键保护的删除，而是采用以下原子流程：

1. 在独立临时数据目录执行全部 Drizzle 迁移，生成空数据库。
2. 从旧库读取唯一管理员行，在内存中复制到新库，不输出凭据字段。
3. 验证管理员逐字段一致、最后迁移哈希一致、业务表为空、旧表不存在、数据库完整且无外键错误。
4. 将旧库移入同一文件系统的临时路径，原子替换为新库；替换后再次验证。
5. 验证成功后删除旧库、临时库文件、业务日志和陈旧实例锁。

最终结果：

| 检查项 | 结果 |
| --- | --- |
| 管理员 | 1 条，账号、密码哈希、凭据版本和时间字段与重建前完全一致 |
| Drizzle 迁移 | 13 条，最后一条为 `0012_steep_umar.sql` |
| 逻辑业务表 | 39 张，数据均为 0 |
| 已废弃表 | `candidate_memories`、`evaluation_results`、`evaluation_runs`、`persona_growth_records`、`persona_memories`、`revision_proposals` 均不存在 |
| SQLite 完整性 | `integrity_check = ok` |
| 外键完整性 | `foreign_key_check` 返回 0 条错误 |

管理员没有明文密码可用于自动发起真实登录请求。本次通过重建前后凭据字段逐字节一致，以及认证集成测试通过，确认原登录凭据未被修改。

## OpenViking 清理

清理前只读核对到：

- `viking://user/default/resources/ren-yang` 下有 1 个旧资源；
- 有 3 个 `ren-yang-run-*` Session；
- Peer、用户记忆和账号共享资源均为空。

只对上述 1 个资源目录和 3 个带受控前缀的 Session 执行删除。清理后复核结果：

| 检查项 | 结果 |
| --- | --- |
| OpenViking 健康状态 | 健康，服务端 `v0.4.16` |
| “人样”资源目录 | HTTP 404，0 条资源 |
| “人样”Session | 0 条 |
| Peer | 0 条 |
| 用户记忆 | 0 条 |

SQLite 当前没有待投影业务事实，因此本次重建后的正确远端状态就是空投影；后续新增世界、人物和资料后再按 SQLite 事实异步建立投影。

## 配置限制

当前 OpenViking 服务返回 `auth_mode=api_key`，账号为专用 `ren-yang`，用户为 `default`。现有应用为确保世界 User、人物 Peer 的隔离，明确要求 OpenViking 使用 `trusted` 模式；因此：

- 数据清理和空投影重建已经完成；
- 当前环境虽然配置为启用 OpenViking，但应用健康门禁会拒绝把 `api_key` 模式用于隔离检索和重建；
- 在服务端切换为 `trusted` 模式前，不能把 OpenViking 标记为可实际使用的世界/User 隔离能力；
- 不能通过放宽应用门禁规避该限制，否则世界请求头会被 `api_key` 模式忽略并产生串台风险。

## 验证记录

```text
pnpm migrate
通过；重复执行未产生额外迁移或数据。

pnpm exec drizzle-kit check
通过；Schema 与迁移元数据一致。

pnpm test
33 个测试文件通过，156 项测试通过。

pnpm exec tsc -p .nuxt/tsconfig.json --noEmit
通过。

pnpm run build
通过；仅有第三方 Rollup 注释位置警告。

生产构建运行态烟雾验证
`GET /api/v1/setup/status` 返回 `setupRequired=false`，登录页返回 HTTP 200，正常停机后实例锁已释放。
```
