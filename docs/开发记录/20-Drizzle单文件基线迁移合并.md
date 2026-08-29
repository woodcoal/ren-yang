# Drizzle 单文件基线迁移合并

日期：2026-08-30

## 目标

将开发期间形成的 13 个 SQLite 迁移脚本合并为一个可直接建立当前最终 Schema 的基线迁移，降低新安装、审查和维护成本。

## 决策边界

- 采用真正的 Drizzle 基线压缩，不额外保留一套部署 SQL。
- 本次已明确允许清空全部业务数据，且压缩前数据库没有业务数据，因此不保留从已删除开发迁移原地升级的路径。
- 唯一管理员账号及全部凭据字段必须保持不变。
- 从新基线开始恢复“已发布迁移不可修改”的规则；后续结构变化新增迁移。
- 再次压缩必须先确认没有需要原地升级的部署，并取得明确的全量重建授权。

## 合并方式

没有机械串联旧 SQL。旧迁移包含已删除表、临时表搬迁、回填和中间状态，直接拼接会增加执行时间并保留无意义历史。

本次处理顺序：

1. 由当前 `server/infrastructure/database/schema.ts` 生成最终 38 张普通表及其索引、约束和外键。
2. 从压缩前的最终 SQLite Schema 提取 Drizzle 无法表达的 2 张 FTS5 虚拟表和 12 个触发器。
3. 将上述 14 个自定义对象追加到基线，并使用 Drizzle statement breakpoint 保证触发器内部 SQL 不被错误拆分。
4. 生成唯一快照和只有一条记录的 journal。
5. 在独立临时目录执行基线，并与压缩前数据库逐项比较对象名、字段定义、外键、索引和触发器。

最终迁移目录：

```text
drizzle/
├── 0000_baseline.sql
└── meta/
    ├── 0000_snapshot.json
    └── _journal.json
```

`worlds.active_soul_version_id` 和 `personas.active_soul_version_id` 原来由后续迁移追加，因此压缩前位于物理列末尾。新基线按当前 Schema 声明顺序创建字段；字段类型、可空性、约束和业务语义不变。

## 数据库重建

现有数据库保存的是旧 13 条迁移哈希，不能直接运行新基线。采用与方案 A 相同的原子替换方式：

1. 使用单文件基线建立临时空库。
2. 在内存中逐字段复制唯一管理员，不输出密码哈希。
3. 验证单迁移哈希、业务表为空、自定义对象数量、完整性和外键。
4. 原子替换数据库；失败时恢复旧库。
5. 替换后再次验证管理员和数据库状态，再删除旧库。

最终结果：

| 检查项 | 结果 |
| --- | --- |
| SQL 迁移文件 | 1 个：`drizzle/0000_baseline.sql` |
| Drizzle 快照 | 1 个 |
| journal 记录 | 1 条 |
| 普通业务表 | 38 张 |
| FTS5 虚拟表 | 2 张：`source_chunks_fts`、`learning_fts` |
| 自定义触发器 | 12 个 |
| 管理员 | 1 条，全部凭据字段与替换前一致 |
| 业务数据 | 0 条 |
| SQLite 完整性 | `integrity_check = ok` |
| 外键完整性 | `foreign_key_check` 返回 0 条错误 |

## 测试调整

原集成测试会从仓库复制前四个旧迁移，验证后续清空升级。旧迁移已被正式删除后，该测试不再代表受支持路径，调整为验证：

- 空目录只执行一条基线迁移；
- 最终核心表存在；
- 2 张 FTS5 表和 12 个触发器名称精确一致；
- WAL、外键和完整性检查正常。

## 验证记录

```text
pnpm migrate
通过；重复执行后仍只有 1 条迁移记录。

pnpm exec drizzle-kit check
通过；当前 Schema、快照和 journal 一致。

pnpm exec vitest run tests/integration/sqlite-database.test.ts tests/integration/context-reindex.test.ts tests/integration/backup-restore.test.ts tests/integration/learning-management.test.ts tests/integration/analysis-iteration.test.ts
5 个测试文件通过，30 项测试通过。

pnpm test
33 个测试文件通过，155 项测试通过。

pnpm exec tsc -p .nuxt/tsconfig.json --noEmit
通过。

pnpm run build
通过；仅有第三方 Rollup 注释位置警告。

生产构建运行态烟雾验证
`GET /api/v1/setup/status` 返回 `setupRequired=false`，登录页返回 HTTP 200，正常停机后实例锁已释放。
```
