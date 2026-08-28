# 人样

让 Agent 有记性、有分寸、有个人样。

当前完成阶段四：已具备人物、世界与资料管理，文本兴趣判断，结构化图文生成，块尝试选择、锁定和重试，以及 HTML、Markdown、Txt 同源预览与导出。反馈迭代、评测和可选 OpenViking 将在后续阶段实现。

## 环境要求

- Node.js 24 LTS。
- pnpm 11。
- 无需单独安装 SQLite；项目使用内嵌驱动。

## 本地启动

1. 在仓库外的环境配置中设置至少 32 个字符的 `NUXT_SESSION_PASSWORD`。
2. 配置文本模型：`NUXT_TEXT_MODEL_ENDPOINT`、`NUXT_TEXT_MODEL_API_KEY`、`NUXT_TEXT_MODEL_MODEL`。
3. 如需图片块，再配置：`NUXT_IMAGE_MODEL_ENDPOINT`、`NUXT_IMAGE_MODEL_API_KEY`、`NUXT_IMAGE_MODEL_MODEL`；不配置时纯文本路径保持可用。
4. 安装依赖：`pnpm install`。
5. 启动开发服务：`pnpm dev`。
6. 首次访问 `/setup` 创建唯一管理员。

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
- `server/application/` 编排用例；原子数据事务由仓储端口实现。
- `server/ports/` 定义数据、会话、时间和任务端口。
- `server/infrastructure/` 实现 SQLite、密码、会话和组合根。
- `shared/` 保存前后端共用 Schema 和公开类型。

产品与架构基线见 [产品决策与范围](./docs/00-产品决策与范围.md)。阶段实现记录：

- [阶段一：工程基线](./docs/开发记录/01-工程基线.md)
- [阶段二：人物、世界与资料](./docs/开发记录/02-人物世界与资料.md)
- [阶段三：文本生成与兴趣判断](./docs/开发记录/03-文本生成与兴趣判断.md)
- [阶段四：图片、图文块与三格式导出](./docs/开发记录/04-图片图文块与导出.md)
