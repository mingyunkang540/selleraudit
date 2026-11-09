import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import { tokenHash } from './crypto.ts'
import { randomBytes } from 'node:crypto'
import { activateEmployee, changeEmployeeRole, changePassword, createEmployeeWithInitialPassword, currentIdentity, disableEmployee, inviteEmployee, listEmployees, login, logout, resetEmployeePassword, validCsrf, type Identity, type Role } from './service.ts'
import { readBusinessData } from '../business/read.ts'
import { readCatalogExtensions,readOhouseCandidates } from '../business/catalogExtensions.ts'
import { readProductPrices,confirm26pPrice } from '../business/productPrices.ts'
import { archiveInactiveOffers, archiveIssues, archiveUnmatchedOffer, mapOffer, unmapOffer, updateIssue } from '../business/write.ts'
import {applyOwnedStoreBatch} from '../business/ownedStoreBatch.ts'
import { bindOfferConfiguration, readProductConfigurations, saveProductConfiguration, type ConfigInput } from '../business/productConfigurations.ts'
import {saveProductMaster,type ProductMasterInput} from '../business/productMaster.ts'
import {readChannelCoupons,addChannelCoupon,removeChannelCoupon,updateCouponShares} from '../business/channelCoupons.ts'
import {readChannelFees,saveChannelFee} from '../business/channelFees.ts'
import {syncSalesDashboard} from '../business/salesDashboard.ts'
import {readProductSales} from '../business/productSales.ts'
import {readHistoricalSales,withHistoricalProducts,withHistoricalSales} from '../business/historicalSales.ts'
import type {CouponInput} from '../../src/features/channels/coupons.ts'
import { registerImportRoutes } from '../import/routes.ts'

const cookieName = 'selleraudit_session'
const allowedOrigins = new Set(['http://127.0.0.1:5174','http://127.0.0.1:4179'])
const allowedHosts = new Set(['127.0.0.1:5174','127.0.0.1:4179'])
class AuthorizationError extends Error {}
function body(request: FastifyRequest): Record<string, unknown> {
  return typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {}
}
function stringField(data: Record<string, unknown>, key: string, max = 1024): string {
  const value=data[key]
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid input')
  return value
}

export async function registerAuthRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const openMode=process.env.SELLERAUDIT_LOCAL_OPEN_MODE==='YES'
  const presence=new Map<string,{workspaceId:string;userId:string;seenAt:number}>()
  const prunePresence=()=>{const cutoff=Date.now()-90_000;for(const [key,value] of presence)if(value.seenAt<cutoff)presence.delete(key)}
  const openCsrf=randomBytes(32).toString('hex')
  const openIdentity=async():Promise<Identity>=>{
    const result=await pool.query<{user_id:string;workspace_id:string;email:string;display_name:string}>(`SELECT u.id AS user_id,m.workspace_id,u.email,u.display_name FROM seller_audit_local.app_users u JOIN seller_audit_local.workspace_members m ON m.user_id=u.id WHERE u.status='ACTIVE' AND m.status='ACTIVE' AND m.role='ADMIN' LIMIT 2`)
    if(result.rows.length!==1)throw new AuthorizationError('Local administrator unavailable')
    const row=result.rows[0]
    return {userId:row.user_id,workspaceId:row.workspace_id,email:row.email,displayName:row.display_name,role:'ADMIN'}
  }
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return
    if (!allowedHosts.has(request.headers.host ?? '')) return reply.code(403).send({ error:'Forbidden' })
    if (!['GET','HEAD'].includes(request.method) && !allowedOrigins.has(request.headers.origin ?? '')) return reply.code(403).send({ error:'Forbidden' })
  })
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) reply.header('Cache-Control','no-store')
    return payload
  })
  const actor = async (request: FastifyRequest, mutation: boolean, admin = false): Promise<Identity> => {
    if(openMode){
      if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.ip))throw new AuthorizationError('Loopback only')
      const csrf=request.headers['x-csrf-token']
      if(mutation && (typeof csrf!=='string'||!validCsrf({csrfHash:tokenHash(openCsrf)},csrf)))throw new AuthorizationError('Unauthorized')
      return openIdentity()
    }
    const session=request.cookies[cookieName]
    const current=session ? await currentIdentity(pool,session) : null
    const csrf=request.headers['x-csrf-token']
    if (!current || (admin && current.role!=='ADMIN') || (mutation && (typeof csrf!=='string' || !validCsrf(current,csrf)))) throw new AuthorizationError('Unauthorized')
    return current
  }
  const bad = (reply: { code: (status: number) => { send: (data: object) => unknown } }, error?: unknown) => reply.code(error instanceof AuthorizationError ? 403 : 400).send({error:'요청을 처리하지 못했습니다.'})
  const rate = { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }
  app.post('/api/auth/login',rate,async (request,reply) => {
    try {
      const data=body(request)
      const result=await login(pool,stringField(data,'email',254),stringField(data,'password'))
      if (!result) return reply.code(401).send({error:'이메일 또는 비밀번호를 확인하세요.'})
      reply.setCookie(cookieName,result.session,{httpOnly:true,sameSite:'strict',path:'/',maxAge:28800})
      return {csrf:result.csrf}
    } catch { return bad(reply) }
  })
  app.get('/api/auth/session',async (request,reply) => {
    if(openMode){
      try {const current=await actor(request,false);return {user:current,csrf:openCsrf,openMode:true,importEnabled:process.env.SELLERAUDIT_LOCAL_IMPORT_ENABLED==='YES' && Boolean(process.env.SELLERAUDIT_LOCAL_DATA_DIR)}}
      catch{return reply.code(401).send({error:'로컬 관리자 정보를 확인할 수 없습니다.'})}
    }
    const session=request.cookies[cookieName]; const current=session ? await currentIdentity(pool,session) : null
    if (!session || !current) return reply.code(401).send({error:'로그인이 필요합니다.'})
    const csrf=tokenHash(`csrf:${session}`)
    if(!validCsrf(current,csrf))return reply.code(401).send({error:'로그인이 필요합니다.'})
    return {user:{userId:current.userId,workspaceId:current.workspaceId,role:current.role,email:current.email,displayName:current.displayName},csrf,importEnabled:process.env.SELLERAUDIT_LOCAL_IMPORT_ENABLED==='YES' && Boolean(process.env.SELLERAUDIT_LOCAL_DATA_DIR)}
  })
  app.post('/api/auth/logout',async (request,reply) => {
    try { await actor(request,true); const session=request.cookies[cookieName]!;await logout(pool,session);presence.delete(tokenHash(session)); reply.clearCookie(cookieName,{path:'/'}); return {ok:true} }
    catch { return reply.code(403).send({error:'접근할 수 없습니다.'}) }
  })
  app.post('/api/auth/activate',rate,async (request,reply) => {
    try { const data=body(request); await activateEmployee(pool,stringField(data,'email',254),stringField(data,'code',43),stringField(data,'password')); return {ok:true} }
    catch (error) { return bad(reply,error) }
  })
  app.post('/api/auth/password',rate,async (request,reply) => {
    try { const current=await actor(request,true); const data=body(request); await changePassword(pool,current,stringField(data,'currentPassword'),stringField(data,'newPassword'));for(const [key,value] of presence)if(value.userId===current.userId)presence.delete(key); reply.clearCookie(cookieName,{path:'/'}); return {ok:true} }
    catch (error) { return bad(reply,error) }
  })
  app.post('/api/auth/presence',async (request,reply)=>{
    try {const current=await actor(request,true);if(!openMode){const session=request.cookies[cookieName];if(!session)throw new AuthorizationError('Unauthorized');prunePresence();presence.set(tokenHash(session),{workspaceId:current.workspaceId,userId:current.userId,seenAt:Date.now()})}return {ok:true}}
    catch{return reply.code(403).send({error:'접속 상태를 확인하지 못했습니다.'})}
  })
  app.get('/api/employees',async (request,reply) => {
    try { const current=await actor(request,false,true);const employees=await listEmployees(pool,current);prunePresence();const active=new Set([...presence.values()].filter(item=>item.workspaceId===current.workspaceId).map(item=>item.userId));return {employees:employees.map(employee=>({...employee,online:openMode?null:employee.status==='ACTIVE'&&employee.membership_status==='ACTIVE'&&active.has(employee.id as string)}))} }
    catch { return reply.code(403).send({error:'접근할 수 없습니다.'}) }
  })
  app.get('/api/data',async (request,reply) => {
    try { return await readBusinessData(pool,await actor(request,false)) }
    catch { return reply.code(403).send({error:'데이터를 불러올 수 없습니다.'}) }
  })
  app.get('/api/catalog-extensions',async (request,reply) => {
    try {return await readCatalogExtensions(pool,await actor(request,false))}
    catch{return reply.code(403).send({error:'구성 정보를 불러올 수 없습니다.'})}
  })
  app.get('/api/ohouse-candidates',async (request,reply) => {
    try {return await readOhouseCandidates(pool,await actor(request,false))}
    catch{return reply.code(400).send({error:'매칭 후보를 불러올 수 없습니다.'})}
  })
  app.get('/api/product-prices',async (request,reply) => {
    try {const current=await actor(request,false);const root=process.env.SELLERAUDIT_LOCAL_DATA_DIR;if(!root)throw new Error('Source unavailable');return await readProductPrices(pool,current,root)}
    catch{return reply.code(400).send({error:'마스터 원본 가격을 불러올 수 없습니다.'})}
  })
  app.post('/api/product-master',async (request,reply) => {
    try{return await saveProductMaster(pool,await actor(request,true),body(request) as unknown as ProductMasterInput)}
    catch{return reply.code(400).send({error:'상품 저장에 실패했습니다. 품번 중복이나 변경된 정보를 확인해 주세요.'})}
  })
  app.get('/api/product-configurations',async (request,reply) => {
    try{return await readProductConfigurations(pool,await actor(request,false))}
    catch{return reply.code(400).send({error:'상품 구성 옵션을 불러오지 못했습니다.'})}
  })
  app.get('/api/channel-coupons',async (request,reply)=>{
    try{const current=await actor(request,false),root=process.env.SELLERAUDIT_LOCAL_DATA_DIR;if(!root)throw new Error('Storage unavailable');return await readChannelCoupons(root,current)}catch{return reply.code(400).send({error:'쿠폰 정보를 불러오지 못했습니다.'})}
  })
  app.get('/api/channel-fees',async (request,reply)=>{
    try{const current=await actor(request,false),root=process.env.SELLERAUDIT_LOCAL_DATA_DIR;if(!root)throw new Error('Storage unavailable');return await readChannelFees(root,current)}catch{return reply.code(400).send({error:'채널 수수료를 불러오지 못했습니다.'})}
  })
  app.get('/api/sales-dashboard',async (request,reply)=>{
    try{const current=await actor(request,false),root=process.env.SELLERAUDIT_LOCAL_DATA_DIR;if(!root)throw new Error('Storage unavailable');return withHistoricalSales(await syncSalesDashboard(root,current),await readHistoricalSales(root,current))}catch{return reply.code(404).send({error:'저장된 매출 자료를 불러오지 못했습니다.'})}
  })
  app.get('/api/product-sales-analysis',async (request,reply)=>{
    try{const current=await actor(request,false),root=process.env.SELLERAUDIT_LOCAL_DATA_DIR;if(!root)throw new Error('Storage unavailable');return withHistoricalProducts(await readProductSales(root,current),await readHistoricalSales(root,current))}catch{return reply.code(400).send({error:'판매 분석 자료를 불러오지 못했습니다.'})}
  })
  app.post('/api/channel-fees',async (request,reply)=>{
    try{const current=await actor(request,true),root=process.env.SELLERAUDIT_LOCAL_DATA_DIR,data=body(request);if(!root)throw new Error('Storage unavailable');return await saveChannelFee(pool,root,current,stringField(data,'channelId',36),data.rate,stringField(data,'revision',64))}catch{return reply.code(400).send({error:'수수료를 저장하지 못했습니다. 수수료율과 변경된 목록을 확인해 주세요.'})}
  })
  app.post('/api/channel-coupons',async (request,reply)=>{
    try{const current=await actor(request,true),root=process.env.SELLERAUDIT_LOCAL_DATA_DIR,data=body(request);if(!root)throw new Error('Storage unavailable');return await addChannelCoupon(pool,root,current,data.coupon as CouponInput,stringField(data,'revision',64))}catch{return reply.code(400).send({error:'쿠폰을 저장하지 못했습니다. 입력값과 변경된 목록을 확인해 주세요.'})}
  })
  app.post('/api/channel-coupons/remove',async (request,reply)=>{
    try{const current=await actor(request,true),root=process.env.SELLERAUDIT_LOCAL_DATA_DIR,data=body(request);if(!root)throw new Error('Storage unavailable');return await removeChannelCoupon(root,current,stringField(data,'id',36),stringField(data,'revision',64))}catch{return reply.code(400).send({error:'쿠폰을 삭제하지 못했습니다. 목록을 새로고침해 주세요.'})}
  })
  app.post('/api/channel-coupons/shares',async (request,reply)=>{
    try{const current=await actor(request,true),root=process.env.SELLERAUDIT_LOCAL_DATA_DIR,data=body(request);if(!root)throw new Error('Storage unavailable');return await updateCouponShares(pool,root,current,stringField(data,'id',36),stringField(data,'revision',64),data.channelShare,data.companyShare)}catch{return reply.code(400).send({error:'부담 비율을 저장하지 못했습니다. 두 비율의 합과 변경된 목록을 확인해 주세요.'})}
  })
  app.post('/api/product-configurations',async (request,reply) => {
    try{return await saveProductConfiguration(pool,await actor(request,true),body(request) as unknown as ConfigInput)}
    catch{return reply.code(400).send({error:'상품 구성 옵션을 저장하지 못했습니다.'})}
  })
  app.post('/api/mapping/configuration',async (request,reply) => {
    try{const current=await actor(request,true);const data=body(request);return await bindOfferConfiguration(pool,current,stringField(data,'offerId',36),stringField(data,'configurationId',36))}
    catch{return reply.code(400).send({error:'구성 옵션을 연결하지 못했습니다.'})}
  })
  app.post('/api/product-prices/confirm-26p',async (request,reply) => {
    try {const current=await actor(request,true,true);const data=body(request);if(typeof data.cost!=='number'||data.retainSourceSalePrices!==true)throw new Error('Invalid price confirmation');return await confirm26pPrice(pool,current,data.cost,true)}
    catch{return reply.code(400).send({error:'가격 확인 내용을 저장하지 못했습니다.'})}
  })
  app.post('/api/mapping/own-store-prepared',async (request,reply) => {
    try {const current=await actor(request,true,true);return {mapped:await applyOwnedStoreBatch(pool,current)}}
    catch {return reply.code(400).send({error:'매핑 대상이 변경됐거나 일괄 연결에 실패했습니다. 새로고침 후 확인해 주세요.'})}
  })
  app.post('/api/mapping',async (request,reply) => {
    try {const current=await actor(request,true);const data=body(request);await mapOffer(pool,current,stringField(data,'offerId',36),stringField(data,'productId',36));return {ok:true}}
    catch(error){return bad(reply,error)}
  })
  app.post('/api/mapping/unmap',async (request,reply) => {
    try {const current=await actor(request,true);const data=body(request);await unmapOffer(pool,current,stringField(data,'offerId',36),stringField(data,'productId',36));return {ok:true}}
    catch(error){return bad(reply,error)}
  })
  app.post('/api/mapping/archive-unmatched',async (request,reply) => {
    try {const current=await actor(request,true);await archiveUnmatchedOffer(pool,current,stringField(body(request),'offerId',36));return {ok:true}}
    catch(error){return bad(reply,error)}
  })
  app.post('/api/mapping/archive-inactive',async (request,reply) => {
    try {const current=await actor(request,true);const ids=body(request).offerIds;if(!Array.isArray(ids)||!ids.every(id=>typeof id==='string'))throw new Error('Invalid selection');return {archived:await archiveInactiveOffers(pool,current,ids)}}
    catch(error){return bad(reply,error)}
  })
  app.post('/api/issues/archive',async (request,reply) => {
    try {const current=await actor(request,true);const ids=body(request).issueIds;if(!Array.isArray(ids)||!ids.every(id=>typeof id==='string'))throw new Error('Invalid selection');return {archived:await archiveIssues(pool,current,ids)}}
    catch {return reply.code(400).send({error:'Unable to remove issues'})}
  })
  app.post('/api/issues/:id/status',async (request,reply) => {
    try {const current=await actor(request,true);const {id}=request.params as {id:string};await updateIssue(pool,current,id,stringField(body(request),'status',32));return {ok:true}}
    catch(error){return bad(reply,error)}
  })
  app.post('/api/employees',async (request,reply) => {
    try { const current=await actor(request,true,true); const data=body(request);const input={email:stringField(data,'email',254),displayName:stringField(data,'displayName',100),role:stringField(data,'role',6) as Role};const initial=process.env.SELLERAUDIT_INITIAL_PASSWORD_HASH;if(initial){await createEmployeeWithInitialPassword(pool,current,input,initial);return {initialPassword:true}}const code=await inviteEmployee(pool,current,input);return {code} }
    catch (error) { return bad(reply,error) }
  })
  app.post('/api/employees/:id/role',async (request,reply) => {
    try { const current=await actor(request,true,true); const {id}=request.params as {id:string}; await changeEmployeeRole(pool,current,id,stringField(body(request),'role',6) as Role); return {ok:true} }
    catch (error) { return bad(reply,error) }
  })
  app.post('/api/employees/:id/disable',async (request,reply) => {
    try { const current=await actor(request,true,true); const {id}=request.params as {id:string}; await disableEmployee(pool,current,id);for(const [key,value] of presence)if(value.userId===id)presence.delete(key); return {ok:true} }
    catch (error) { return bad(reply,error) }
  })
  app.post('/api/employees/:id/reset',async (request,reply) => {
    try { const current=await actor(request,true,true); const {id}=request.params as {id:string}; const code=await resetEmployeePassword(pool,current,id);for(const [key,value] of presence)if(value.userId===id)presence.delete(key); return {code} }
    catch (error) { return bad(reply,error) }
  })
  if(process.env.SELLERAUDIT_LOCAL_IMPORT_ENABLED==='YES' && process.env.SELLERAUDIT_LOCAL_DATA_DIR) {
    await registerImportRoutes(app,pool,actor,process.env.SELLERAUDIT_LOCAL_DATA_DIR)
  }
}
