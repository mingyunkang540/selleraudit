import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { link, lstat, mkdir, realpath, unlink } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'

const maxBytes=50*1024*1024
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
async function safeDirectory(path:string,root:string):Promise<void> {
  await mkdir(path,{recursive:true})
  const stat=await lstat(path)
  if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Invalid storage directory')
  const actual=await realpath(path)
  if(actual!==root && !actual.startsWith(root+sep))throw new Error('Storage path escapes root')
}

export async function storeSource(input:{root:string;workspaceId:string;sourceId:string;stream:Readable;expectedHash:string;expectedBytes:number}):Promise<{hash:string;bytes:number}> {
  if(!uuid.test(input.workspaceId)||!uuid.test(input.sourceId)||!/^[a-f0-9]{64}$/.test(input.expectedHash)||!Number.isSafeInteger(input.expectedBytes)||input.expectedBytes<1||input.expectedBytes>maxBytes) throw new Error('Invalid source metadata')
  await mkdir(resolve(input.root),{recursive:true})
  const rootStat=await lstat(resolve(input.root))
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new Error('Invalid storage root')
  const root=await realpath(resolve(input.root))
  const workspace=join(root,input.workspaceId); const source=join(workspace,input.sourceId)
  await safeDirectory(workspace,root); await safeDirectory(source,root)
  const tmp=join(source,`.${randomUUID()}.part`); const dest=join(source,'source.xlsx')
  const digest=createHash('sha256');let bytes=0
  const inspect=new Transform({transform(chunk:Buffer,_encoding,callback){
    bytes+=chunk.length
    if(bytes>maxBytes){callback(new Error('Source too large'));return}
    digest.update(chunk);callback(null,chunk)
  }})
  try {
    await pipeline(input.stream,inspect,createWriteStream(tmp,{flags:'wx',mode:0o600}))
    const hash=digest.digest('hex')
    if(bytes!==input.expectedBytes||hash!==input.expectedHash)throw new Error('Source verification failed')
    await link(tmp,dest)
    return {hash,bytes}
  } finally {await unlink(tmp).catch(()=>{})}
}
