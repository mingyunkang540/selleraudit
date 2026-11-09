import { createApp } from './app.ts'
import { createPool } from './db.ts'
import { readProductPrices } from './business/productPrices.ts'

try { process.loadEnvFile('.env.local-server') } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

let pool: ReturnType<typeof createPool> | undefined
try {
  pool = createPool()
  const app = createApp(async () => { await pool!.query('select 1') }, pool)
  app.addHook('onClose', async () => { await pool!.end() })
  await app.listen({ host: '127.0.0.1', port: 4179 })
  console.log('SellerAudit local server: http://127.0.0.1:4179')
  const dataRoot=process.env.SELLERAUDIT_LOCAL_DATA_DIR
  if(dataRoot){
    void pool.query<{id:string}>('SELECT id FROM seller_audit_local.workspaces').then(async result=>{
      for(const {id} of result.rows){const prices=await readProductPrices(pool!,{workspaceId:id,userId:'',role:'ADMIN',email:'',displayName:''},dataRoot);if(prices.sourceUnavailable||prices.syncWarning)console.warn('Master price synchronization needs attention.')}
    }).catch(()=>console.warn('Master price synchronization could not start.'))
  }
  const shutdown = async () => { await app.close() }
  process.once('SIGINT', () => { void shutdown() })
  process.once('SIGTERM', () => { void shutdown() })
  const parentPid = Number(process.env.SELLERAUDIT_LOCAL_PARENT_PID)
  if (Number.isSafeInteger(parentPid) && parentPid > 0) {
    const checkParent = setInterval(() => {
      try { process.kill(parentPid, 0) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') { clearInterval(checkParent); void shutdown() }
      }
    }, 1000)
    checkParent.unref()
  }
} catch {
  if (pool) await pool.end()
  console.error('Local server could not start. Check local database configuration.')
  process.exitCode = 1
}
