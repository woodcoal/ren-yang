# 人样

让 Agent 有记性、有分寸、有个人样。

人样是单人本地运行的 AI 人物模拟、兴趣判断与结构化图文创作工作台。它以可版本化的灵魂、成长提示词和人物记忆提示词构成人物心智，长期变化通过可审计的发布流程生效，并保留模型、参数、提示词、证据和任务结果快照。

## 核心能力

- 管理世界、人物、参考资料及其启停和关联关系。
- 版本化管理世界与人物灵魂，分别提炼世界成长、人物成长和人物记忆。
- 配置多个 OpenAI-compatible 接口、文本或图片模型，以及代码内固定的 AI 算法步骤。
- 执行结构化兴趣判断和图文生成，按块确认、重试、锁定并导出 HTML、Markdown、Txt。
- 将反馈、成长素材和处理记录纳入可审计的人工发布闭环。
- 使用 SQLite FTS5 检索；可选接入 OpenViking，提供隔离的语义检索和异步上下文投影。
- 提供任务恢复、审计、资源限制、一致性备份与停机恢复。

SQLite 始终是唯一业务事实源。OpenViking 不可用时，管理与生成主流程仍可使用本地 FTS5。

## 技术栈

- Node.js 24 LTS、pnpm 11
- Nuxt 4、Vue 3、Nuxt UI 4、TypeScript
- Nitro Node Server、Zod、nuxt-auth-utils
- Drizzle ORM、better-sqlite3、SQLite FTS5
- Vitest、Nuxt Test Utils、Playwright

项目不需要单独安装 SQLite，也不提供 Docker 或桌面应用部署方式。

## 快速开始

1. 安装 Node.js 24 和 pnpm 11。
2. 安装依赖：

   ```bash
   pnpm install --frozen-lockfile
   ```

3. 复制 `.env.example` 为本机忽略的 `.env`，至少设置一个长度不小于 32 个字符的随机 `NUXT_SESSION_PASSWORD`。
4. 启动开发服务：

   ```bash
   pnpm dev
   ```

5. 访问 `http://127.0.0.1:3001/setup`，创建唯一管理员。
6. 登录后依次配置“AI 模型”“AI 算法”和“AI 设置”。如需语义检索，再到系统中心配置 OpenViking 服务地址和 ADMIN API Key。

默认运行数据位于 `./data`，不会进入 Git。可通过 `NUXT_DATA_DIRECTORY` 指向其他目录。

## 环境变量

| 变量 | 必需 | 默认值 | 用途 |
|---|---:|---|---|
| `NUXT_SESSION_PASSWORD` | 是 | 无 | 会话主密钥，并派生用于加密数据库中的 AI API Key 和人物凭据；存在密文时不得直接更换 |
| `NODE_ENV` | 生产必需 | `development` | 生产环境设为 `production`，并通过 HTTPS 使用 Secure Cookie |
| `NUXT_DATA_DIRECTORY` | 否 | `./data` | SQLite、资料、产物和日志目录 |
| `HOST` | 否 | `127.0.0.1` | 开发服务监听地址 |
| `PORT` | 否 | `3001` | 开发服务监听端口 |
| `NUXT_FEEDBACK_AUTO_PUBLISH_LOW_RISK` | 否 | `false` | 仅在固定评测全部通过时允许低风险人物修订自动发布 |
| `NUXT_LIMITS_REQUEST_BODY_BYTES` | 否 | `2200000` | HTTP 请求正文上限，单位为字节 |
| `NUXT_LIMITS_MINIMUM_FREE_DISK_BYTES` | 否 | `104857600` | 文件写入后要求保留的最小磁盘空间 |
| `NUXT_LOGGING_MAXIMUM_FILE_BYTES` | 否 | `5242880` | 单个 JSON Lines 日志文件轮转阈值 |
| `NUXT_LOGGING_RETENTION_DAYS` | 否 | `14` | 轮转日志保留天数 |

生产构建使用无密钥的 `.env.build`，不会读取本地 `.env`。启动 `.output` 时从进程环境注入运行参数；数据库中的密文仍必须使用创建时的 `NUXT_SESSION_PASSWORD` 解密。

## 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 启动开发服务和同进程 Worker |
| `pnpm build` | 构建 Nitro Node Server |
| `pnpm start` | 启动已构建的生产服务 |
| `pnpm migrate` | 执行 SQLite 迁移并检查完整性 |
| `pnpm admin:reset-password` | 在本机交互式重置管理员密码并撤销旧会话 |
| `pnpm backup` | 在线创建数据库与引用文件的一致性备份 |
| `pnpm restore:validate -- <备份目录>` | 只读验证备份清单、哈希和数据库 |
| `pnpm restore -- <备份目录>` | 在停机后恢复备份，并保留恢复前回退目录 |
| `pnpm typecheck` | 执行 Nuxt 严格类型检查 |
| `pnpm test` | 执行单元、集成、架构和组件测试 |
| `pnpm test:watch` | 以监听模式运行 Vitest |
| `pnpm test:e2e` | 构建隔离生产服务并执行 Chromium 核心流程 |
| `pnpm check` | 依次执行类型检查、全量测试和生产构建 |

首次执行浏览器测试前运行：

```bash
pnpm exec playwright install chromium
```

## 代码结构

```text
app/                    页面、组件、组合式函数和客户端中间件
server/api/             HTTP 薄控制器
server/application/     用例编排、事务和任务协调
server/domain/          无 I/O 的领域规则与 AI 算法
server/ports/           数据、模型、上下文、文件和时间端口
server/infrastructure/  SQLite、认证、模型、OpenViking 和文件适配器
server/worker/          同进程持久任务领取与生命周期
shared/                 前后端共享 Zod Schema 和公开类型
drizzle/                SQLite 迁移
tests/                  单元、集成、架构、组件和端到端测试
docs/                   产品、架构、运维、UX 与开发记录
```

依赖方向为“表现层 → 应用层 → 领域层 → 端口 → 基础设施层”。控制器和 Worker 只调用应用服务；页面不直接访问数据库、文件、模型或 OpenViking。

## 数据与安全

- 不要提交 `.env`、`data/`、日志、测试报告或生产备份。
- 浏览器只能获知密钥是否已配置，服务端不得返回 API Key 明文。
- 备份包含数据库密文但不包含会话主密钥；恢复时必须提供原主密钥。
- 生产环境设置 `NODE_ENV=production`，仅监听回环地址，并通过 HTTPS 反向代理公开服务。
- 开启低风险自动发布不绕过固定评测；默认保持关闭。

## 文档入口

- [领域语言](./CONTEXT.md)
- [产品决策与范围](./docs/00-产品决策与范围.md)
- [系统架构与分层约束](./docs/02-系统架构与分层约束.md)
- [测试与验收方案](./docs/08-测试与验收方案.md)
- [部署、备份与安全](./docs/09-部署备份与安全.md)
- [生产部署与运维](./docs/11-生产部署与运维.md)
- [统一心智模型与迭代设计](./docs/15-统一心智模型与迭代开发设计.md)
- [项目代理规范](./AGENTS.md)

## 许可证

本项目依据 [GNU Affero General Public License v3.0](./LICENSE) 发布。
