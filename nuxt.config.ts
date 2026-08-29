export default defineNuxtConfig({
  compatibilityDate: '2026-08-29',
  modules: ['@nuxt/ui', 'nuxt-auth-utils'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  // 开发服务默认仅监听本机 3001 端口；HOST 和 PORT 环境变量的优先级更高。
  devServer: {
    host: '127.0.0.1',
    port: 3001,
  },
  typescript: {
    strict: true,
    typeCheck: false,
  },
  nitro: {
    preset: 'node-server',
  },
  runtimeConfig: {
    dataDirectory: './data',
    textModel: {
      endpoint: '',
      apiKey: '',
      model: '',
    },
    imageModel: {
      endpoint: '',
      apiKey: '',
      model: '',
    },
    feedback: {
      autoPublishLowRisk: false,
    },
    limits: {
      requestBodyBytes: 2_200_000,
      minimumFreeDiskBytes: 100 * 1024 * 1024,
    },
    logging: {
      maximumFileBytes: 5 * 1024 * 1024,
      retentionDays: 14,
    },
    openViking: {
      enabled: false,
      endpoint: '',
      apiKey: '',
      timeoutMs: 60_000,
    },
    session: {
      // 会话密钥仅在服务启动时由 NUXT_SESSION_PASSWORD 覆盖，禁止在构建期读取并固化。
      password: '',
      maxAge: 60 * 60 * 24 * 7,
      cookie: {
        // 开发环境允许通过 HTTP 进行远程联调；生产环境始终要求 HTTPS 回传会话 Cookie。
        secure: process.env.NODE_ENV === 'production',
      },
    },
    public: {
      applicationName: '人样',
    },
  },
})
