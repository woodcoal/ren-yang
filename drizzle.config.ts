import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/infrastructure/database/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: './data/app.sqlite',
  },
})
