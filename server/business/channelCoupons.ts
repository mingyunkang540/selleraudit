import {createHash,randomUUID} from 'node:crypto'
import {readFile,realpath,writeFile,rename,unlink} from 'node:fs/promises'
import {join} from 'node:path'
import type {Pool} from 'pg'
import type {Identity} from '../auth/service.ts'
import type {Coupon,CouponInput} from '../../src/features/channels/coupons.ts'
import {validShares} from '../../src/features/channels/coupons.ts'

const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const day=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(`${v}T00:00:00Z`))&&new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v
const amount=(v:unknown)=>v===null||typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=999999999999
let pending:Promise<unknown>=Promise.resolve()
function exclusive<T>(fn:()=>Promise<T>):Promise<T>{const result=pending.then(fn,fn);pending=result.catch(()=>{});return result}
async function pathFor(root:string,actor:Identity){
 if(!uuid(actor.workspaceId))throw new Error('Invalid workspace')
 const base=await realpath(root),dir=join(base,actor.workspaceId),resolved=await realpath(dir)
 if(process.platform==='win32'?resolved.toLowerCase()!==dir.toLowerCase():resolved!==dir)throw new Error('Invalid directory')
 return join(resolved,'channel-coupons.json')
}
async function load(root:string,actor:Identity){
 const path=await pathFor(root,actor);let text='[]'
 try{text=await readFile(path,'utf8')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
 const coupons:unknown=JSON.parse(text);if(!Array.isArray(coupons))throw new Error('Invalid coupon data')
 return {path,coupons:coupons as Coupon[],revision:createHash('sha256').update(text).digest('hex')}
}
export async function readChannelCoupons(root:string,actor:Identity){const {coupons,revision}=await load(root,actor);return {coupons,revision}}
export async function addChannelCoupon(pool:Pool,root:string,actor:Identity,input:CouponInput,revision:string){
 if(actor.role!=='ADMIN'&&actor.role!=='EDITOR')throw new Error('Not authorized')
 if(!input||!uuid(input.channelId)||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>100||!day(input.startDate)||!day(input.endDate)||input.endDate<input.startDate||!(input.discountType===undefined||input.discountType==='PERCENT'||input.discountType==='FIXED')||(input.discountType==='FIXED'?(typeof input.fixedAmount!=='number'||!Number.isSafeInteger(input.fixedAmount)||input.fixedAmount<1||input.fixedAmount>999999999999||input.percent!==0||input.maximum!==null):(!Number.isInteger(input.percent)||input.percent<1||input.percent>100||input.fixedAmount!==undefined))||!amount(input.minimum)||!amount(input.maximum)||!validShares(input.channelShare,input.companyShare)||!['WON_NEAREST','TEN_FLOOR'].includes(input.rounding)||!(input.productIds===null||Array.isArray(input.productIds)&&input.productIds.length>0&&input.productIds.length<=500&&input.productIds.every(uuid)&&new Set(input.productIds).size===input.productIds.length))throw new Error('Invalid coupon')
 return exclusive(async()=>{
  const member=await pool.query("SELECT 1 FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role IN ('ADMIN','EDITOR') AND m.status='ACTIVE' AND u.status='ACTIVE'",[actor.workspaceId,actor.userId]);if(member.rowCount!==1)throw new Error('Not authorized')
  const channel=await pool.query('SELECT 1 FROM seller_audit_local.channels WHERE workspace_id=$1 AND id=$2',[actor.workspaceId,input.channelId]);if(channel.rowCount!==1)throw new Error('Invalid channel')
  if(input.productIds){const products=await pool.query('SELECT id FROM seller_audit_local.products WHERE workspace_id=$1 AND id=ANY($2::uuid[])',[actor.workspaceId,input.productIds]);if(products.rowCount!==input.productIds.length)throw new Error('Invalid products')}
  const existing=await load(root,actor);if(existing.revision!==revision)throw new Error('Data changed')
  const coupon:Coupon={...input,name:input.name.trim(),id:randomUUID()},text=JSON.stringify([...existing.coupons,coupon],null,2)+'\n',tmp=`${existing.path}.${randomUUID()}.tmp`
  try{await writeFile(tmp,text,{flag:'wx'});await rename(tmp,existing.path)}finally{await unlink(tmp).catch(()=>{})}
  return {coupon}
 })
}
export async function updateCouponShares(pool:Pool,root:string,actor:Identity,id:string,revision:string,channelShare:unknown,companyShare:unknown){
 if((actor.role!=='ADMIN'&&actor.role!=='EDITOR')||!uuid(id)||!validShares(channelShare,companyShare))throw new Error('Invalid allocation')
 return exclusive(async()=>{
  const member=await pool.query("SELECT 1 FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role IN ('ADMIN','EDITOR') AND m.status='ACTIVE' AND u.status='ACTIVE'",[actor.workspaceId,actor.userId]);if(member.rowCount!==1)throw new Error('Not authorized')
  const existing=await load(root,actor);if(existing.revision!==revision)throw new Error('Data changed')
  const index=existing.coupons.findIndex(c=>c.id===id);if(index<0)throw new Error('Not found')
  existing.coupons[index]={...existing.coupons[index],channelShare,companyShare:companyShare as number}
  const tmp=`${existing.path}.${randomUUID()}.tmp`;try{await writeFile(tmp,JSON.stringify(existing.coupons,null,2)+'\n',{flag:'wx'});await rename(tmp,existing.path)}finally{await unlink(tmp).catch(()=>{})};return {ok:true}
 })
}
export async function removeChannelCoupon(root:string,actor:Identity,id:string,revision:string){
 if(actor.role!=='ADMIN'&&actor.role!=='EDITOR'||!uuid(id))throw new Error('Not authorized')
 return exclusive(async()=>{const existing=await load(root,actor);if(existing.revision!==revision)throw new Error('Data changed');const next=existing.coupons.filter(c=>c.id!==id);if(next.length===existing.coupons.length)throw new Error('Not found');const tmp=`${existing.path}.${randomUUID()}.tmp`;try{await writeFile(tmp,JSON.stringify(next,null,2)+'\n',{flag:'wx'});await rename(tmp,existing.path)}finally{await unlink(tmp).catch(()=>{})};return {ok:true}})
}
