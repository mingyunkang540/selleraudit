import { createPool } from './db.ts'
import { bootstrapAdmin } from './auth/service.ts'

try { process.loadEnvFile('.env.local-server') } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
let input=''
for await (const chunk of process.stdin) {
  input+=chunk.toString()
  if (input.length>4096) throw new Error('Input too large')
}
const pool=createPool()
try {
  const data: unknown=JSON.parse(input)
  if (!data || typeof data!=='object' || !('email' in data) || !('displayName' in data) || !('password' in data) || typeof data.email!=='string' || typeof data.displayName!=='string' || typeof data.password!=='string') throw new Error('Invalid input')
  await bootstrapAdmin(pool,{email:data.email,displayName:data.displayName,password:data.password})
  console.log('Local administrator initialized.')
} catch (error) {
  const safeMessages = new Set(['Invalid email', 'Invalid display name', 'Password length is invalid', 'Local installation already initialized', 'Local identity store is not empty', 'Local workspace store is not empty', 'Invalid input'])
  const message = error instanceof Error && safeMessages.has(error.message) ? error.message : 'Database connection or setup error; no administrator was created.'
  console.error(`Administrator setup failed: ${message}`)
  process.exitCode=1
} finally {await pool.end()}
