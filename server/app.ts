import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import type { Pool } from 'pg'
import { registerAuthRoutes } from './auth/routes.ts'

export function createApp(checkDatabase: () => Promise<void>, pool?: Pool) {
  const app = Fastify({ logger: false })
  if (pool) {
    void app.register(cookie)
    void app.register(rateLimit, { global: false })
    void app.register(async instance => { await registerAuthRoutes(instance,pool) })
  }
  app.get('/api/health', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try {
      await checkDatabase()
      return { status: 'ok' }
    } catch {
      return reply.code(503).send({ status: 'unavailable' })
    }
  })
  return app
}
