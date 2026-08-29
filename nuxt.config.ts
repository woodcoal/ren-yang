export default defineNuxtConfig({
  compatibilityDate: '2026-08-29',
  modules: ['@nuxt/ui', 'nuxt-auth-utils'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  typescript: {
    strict: true,
    typeCheck: true,
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
    openViking: {
      enabled: false,
      endpoint: '',
      apiKey: '',
      timeoutMs: 60_000,
    },
    session: {
      password: process.env.NUXT_SESSION_PASSWORD || '',
      maxAge: 60 * 60 * 24 * 7,
    },
    public: {
      applicationName: '人样',
    },
  },
})
