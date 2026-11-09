import {createHash,randomUUID} from 'node:crypto'
import {readFile,realpath,writeFile,rename,unlink} from 'node:fs/promises'
import {join} from 'node:path'
import type {Pool} from 'pg'
import type {Identity} from '../auth/service.ts'
import {validFeeRate,type ChannelFee} from '../../src/features/channels/channelFees.ts'

const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
let pending:Promise<unknown>=Promise.resolve()
function exclusive<T>(fn:()=>Promise<T>):Promise<T>{const next=pending.then(fn,fn);pending=next.catch(()=>{});return next}
async function load(root:string,actor:Identity){
 if(!uuid(actor.workspaceId))throw new Error('Invalid workspace')
 const base=await realpath(root),dir=join(base,actor.workspaceId),actual=await realpath(dir)
 if(process.platform==='win32'?actual.toLowerCase()!==dir.toLowerCase():actual!==dir)throw new Error('Invalid directory')
 const path=join(actual,'channel-fees.json');let text='[]'
 try{text=await readFile(path,'utf8')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 const fees:unknown=JSON.parse(text)
 if(!Array.isArray(fees)||fees.some(item=>!item||!uuid(item.channelId)||!validFeeRate(item.rate))||new Set(fees.map(item=>item.channelId)).size!==fees.length)throw new Error('Invalid fee data')
 return {path,fees:fees as ChannelFee[],revision:createHash('sha256').update(text).digest('hex')}
}
export async function readChannelFees(root:string,actor:Identity){const {fees,revision}=await load(root,actor);return {fees,revision}}
export async function saveChannelFee(pool:Pool,root:string,actor:Identity,channelId:string,rate:unknown,revision:string){
 if((actor.role!=='ADMIN'&&actor.role!=='EDITOR')||!uuid(channelId)||(rate!==null&&!validFeeRate(rate)))throw new Error('Invalid fee')
 return exclusive(async()=>{
  const member=await pool.query("SELECT 1 FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role IN ('ADMIN','EDITOR') AND m.status='ACTIVE' AND u.status='ACTIVE'",[actor.workspaceId,actor.userId]);if(member.rowCount!==1)throw new Error('Not authorized')
  const channel=await pool.query('SELECT 1 FROM seller_audit_local.channels WHERE workspace_id=$1 AND id=$2',[actor.workspaceId,channelId]);if(channel.rowCount!==1)throw new Error('Invalid channel')
  const existing=await load(root,actor);if(existing.revision!==revision)throw new Error('Data changed')
  const next=existing.fees.filter(fee=>fee.channelId!==channelId);if(rate!==null)next.push({channelId,rate:rate as number})
  const temp=`${existing.path}.${randomUUID()}.tmp`
  try{await writeFile(temp,JSON.stringify(next,null,2)+'\n',{flag:'wx'});await rename(temp,existing.path)}finally{await unlink(temp).catch(()=>{})}
  return {ok:true}
 })
}
