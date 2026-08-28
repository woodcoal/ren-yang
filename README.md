# 人样

让 Agent 有记性、有分寸、有个人样。

当前完成阶段一工程基线：Nuxt 4 全栈应用、唯一管理员登录、SQLite 迁移、同进程 Worker 和系统健康页。人物、资料、生成与反馈能力尚未实现。

## 环境要求

- Node.js 24 LTS。
- pnpm 11。
- 无需单独安装 SQLite；项目使用内嵌驱动。

## 本地启动

1. 在仓库外的环境配置中设置至少 32 个字符的 `NUXT_SESSION_PASSWORD`。
2. 安装依赖：`pnpm install`。
3. 启动开发服务：`pnpm dev`。
4. 首次访问 `/setup` 创建唯一管理员。

运行数据默认保存在 `./data`，该目录不会进入 Git。可通过 `NUXT_DATA_DIRECTORY` 指向其他本地目录。

## 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 启动开发服务和同进程 Worker |
| `pnpm build` | 构建 Nitro Node Server |
| `pnpm start` | 启动已构建的生产服务 |
| `pnpm migrate` | 执行 SQLite 迁移并检查完整性 |
| `pnpm admin:reset-password` | 在本机交互式重置管理员密码并撤销旧会话 |
| `pnpm typecheck` | 执行 Nuxt 严格类型检查 |
| `pnpm test` | 执行自动化测试 |
| `pnpm check` | 依次执行类型检查、测试和生产构建 |

## 代码边界

- `server/api/` 控制器只解析请求并调用 `event.context.applicationServices`。
- `server/worker/` 只调用 Worker 应用服务。
- `server/application/` 编排用例和事务边界。
- `server/ports/` 定义数据、会话、时间和任务端口。
- `server/infrastructure/` 实现 SQLite、密码、会话和组合根。
- `shared/` 保存前后端共用 Schema 和公开类型。

产品与架构基线见 [产品决策与范围](./docs/00-产品决策与范围.md)，阶段实现记录见 [阶段一工程基线](./docs/开发记录/01-工程基线.md)。
