# 人样

让 Agent 有记性、有分寸、有个人样。

MVP 已完成阶段七最终验收：人物、世界与资料管理，真实文本兴趣判断，真实结构化图文生成与三格式导出，可审查的反馈迭代、可选 OpenViking 资料检索、一致性备份、停机恢复、资源限制、轮转日志、关键审计和单机生产部署基线均已验证。SQLite 始终保存全部业务事实。

## 环境要求

- Node.js 24 LTS。
- pnpm 11。
- 无需单独安装 SQLite；项目使用内嵌驱动。

## 本地启动

1. 在仓库外的环境配置中设置至少 32 个字符的 `NUXT_SESSION_PASSWORD`。
2. 配置文本模型：`NUXT_TEXT_MODEL_ENDPOINT` 填写 OpenAI-compatible API 根地址（通常以 `/v1` 结尾，程序自动补全 `/chat/completions`），再设置 `NUXT_TEXT_MODEL_API_KEY`、`NUXT_TEXT_MODEL_MODEL`；完整接口地址同样兼容。
3. 如需图片块，`NUXT_IMAGE_MODEL_ENDPOINT` 填写 API 根地址（程序自动补全 `/images/generations`），再配置 `NUXT_IMAGE_MODEL_API_KEY`、`NUXT_IMAGE_MODEL_MODEL`；不配置时纯文本路径保持可用。
4. 如需语义上下文，设置 `NUXT_OPEN_VIKING_ENABLED=true`、`NUXT_OPEN_VIKING_ENDPOINT` 和可选的 `NUXT_OPEN_VIKING_API_KEY`；关闭时使用 SQLite FTS5。
5. 低风险人物修订默认仍需人工发布；只有明确设置 `NUXT_FEEDBACK_AUTO_PUBLISH_LOW_RISK=true` 且全部评测通过时才允许自动发布。
6. 设置监听地址和端口：`HOST=127.0.0.1`、`PORT=3001`；端口可改为任意未占用端口。
7. 安装依赖：`pnpm install`。
8. 启动开发服务：`pnpm dev`。
9. 首次访问 `/setup` 创建唯一管理员。

运行数据默认保存在 `./data`，该目录不会进入 Git。可通过 `NUXT_DATA_DIRECTORY` 指向其他本地目录。
开发服务允许 HTTP 远程联调；生产环境必须设置 `NODE_ENV=production` 并通过 HTTPS 访问，以启用 Secure 会话 Cookie。

## 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 启动开发服务和同进程 Worker |
| `pnpm build` | 使用无密钥 `.env.build` 构建 Nitro Node Server，不读取本地 `.env` |
| `pnpm start` | 启动已构建的生产服务 |
| `pnpm migrate` | 执行 SQLite 迁移并检查完整性 |
| `pnpm admin:reset-password` | 在本机交互式重置管理员密码并撤销旧会话 |
| `pnpm backup` | 在线创建 SQLite 与引用文件一致性备份 |
| `pnpm restore:validate -- <目录>` | 只读验证备份清单、哈希和数据库，不修改当前数据 |
| `pnpm restore -- <目录>` | 应用停机后恢复备份并保留恢复前回退目录 |
| `pnpm typecheck` | 执行 Nuxt 严格类型检查 |
| `pnpm test` | 执行自动化测试 |
| `pnpm exec playwright install chromium` | 首次安装浏览器测试所需 Chromium |
| `pnpm test:e2e` | 构建并启动隔离生产服务，执行核心 Playwright 流程 |
| `pnpm acceptance:preflight` | 离线校验真实文本/图片模型验收配置，只输出非敏感摘要 |
| `pnpm check` | 依次执行类型检查、测试和生产构建 |

生产构建不会读取本地 `.env`。运行 `.output` 时，文本、图片、OpenViking 和会话等 `NUXT_*` 配置必须由启动进程的系统环境或仓库外环境文件注入。

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
- [阶段五：反馈、评测、版本与 OpenViking](./docs/开发记录/05-反馈评测版本与OpenViking.md)
- [阶段六：备份恢复、限制与生产加固](./docs/开发记录/06-备份恢复限制与生产加固.md)
- [阶段七：MVP 总体验收](./docs/开发记录/07-MVP总体验收.md)

生产安装、systemd、HTTPS 反向代理、升级和恢复操作见 [生产部署与运维](./docs/11-生产部署与运维.md)。
