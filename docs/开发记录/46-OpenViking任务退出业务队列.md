# OpenViking 任务退出业务队列

日期：2026-09-02

## 调整结果

- `task_jobs` 只保存兴趣判断、图文生成、成长和记忆等业务任务；任务页、顶部与侧栏数量均不再包含 OpenViking。
- 新增 `openviking_sync_outbox`，仅保存 SQLite 业务事实尚未成功送达 OpenViking 的最小同步意图。OpenViking Worker 与业务 Worker 继续使用独立异步循环。
- 同步意图成功、不可重试或十次尝试耗尽后立即删除，不形成本地历史。投影失败状态仍由 `context_sync_records` 保留，便于自动或人工恢复。
- 系统记录页直接合并读取 `default` 和当前受管世界 User 的 OpenViking `/api/v1/tasks` 官方日志，不复制远端结果、Token 用量或凭据。
- 删除 OpenViking 业务历史类型、本地同步日志分页接口、历史清理接口和管理页清理入口。

## 迁移行为

`0015_openviking_sync_outbox` 把旧 `task_jobs` 中仍在排队或运行的 OpenViking 项转换为待送达意图，并删除该表中全部 OpenViking 活动项与终态历史。重复启动不会重复迁移或产生额外意图。

## 验收标准

- 新建 OpenViking 同步意图不写入 `task_jobs`，两个 Worker 互不占用。
- 业务任务统计、历史筛选与页面无 OpenViking 记录或清理入口。
- 官方任务日志按更新时间合并排序，错误中的资源路径和常见凭据必须脱敏。
- 空库、既有数据库升级、重复启动、备份恢复与核心浏览器闭环通过项目门禁。

## 验证结果

- `pnpm check` 通过：69 个测试文件、401 项测试全部通过，类型检查与生产构建成功。
- `pnpm test:e2e` 通过：Chromium 下 4 项核心浏览器闭环全部通过。
