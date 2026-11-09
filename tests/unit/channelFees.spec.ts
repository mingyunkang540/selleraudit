import {mkdtemp,mkdir,unlink,rmdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {Pool} from 'pg'
import {expect,test} from '@playwright/test'
import {calculateChannelFee,validFeeRate} from '../../src/features/channels/channelFees'
import {expectedMargin} from '../../src/features/channels/margin'
import type {Coupon} from '../../src/features/channels/coupons'
import {readChannelFees,saveChannelFee} from '../../server/business/channelFees'
import type {Identity} from '../../server/auth/service'

test('fee uses the customer price after an eligible coupon and is rounded to one won',()=>{
 const coupon:Coupon={id:'1',channelId:'2',name:'행사',startDate:'2026-10-26',endDate:'2026-11-08',percent:10,minimum:null,maximum:null,rounding:'WON_NEAREST',productIds:null,channelShare:50,companyShare:50}
 const now=new Date('2026-11-03T00:00:00Z')
 expect(calculateChannelFee(10000,10,coupon,'p',now)).toBe(900)
 expect(expectedMargin(10000,6000,500,900)).toBe(2600)
 expect(calculateChannelFee(12345,10,coupon,'p',now)).toBe(1111)
 expect(calculateChannelFee(10000,10,coupon,'p',new Date('2026-11-09T00:00:00Z'))).toBe(1000)
 expect(calculateChannelFee(10000,0,coupon,'p',now)).toBe(0)
 expect(calculateChannelFee(10000,null,coupon,'p',now)).toBeNull()
 expect(calculateChannelFee(null,10,coupon,'p',now)).toBeNull()
 expect(validFeeRate(2.35)).toBe(true);expect(validFeeRate(2.345)).toBe(false);expect(validFeeRate(101)).toBe(false)
})
test('channel rates are stored with stale write protection and can be cleared',async()=>{
 const root=await mkdtemp(join(tmpdir(),'channel-fees-')),workspaceId='11111111-1111-4111-8111-111111111111',channelId='22222222-2222-4222-8222-222222222222'
 const actor={workspaceId,userId:'33333333-3333-4333-8333-333333333333',role:'ADMIN'} as Identity
 const pool={query:async()=>({rowCount:1})} as unknown as Pool
 try{
  await mkdir(join(root,workspaceId))
  const initial=await readChannelFees(root,actor)
  await saveChannelFee(pool,root,actor,channelId,0,initial.revision)
  await expect(saveChannelFee(pool,root,actor,channelId,10,initial.revision)).rejects.toThrow('Data changed')
  const next=await readChannelFees(root,actor);expect(next.fees).toEqual([{channelId,rate:0}])
  await expect(saveChannelFee(pool,root,actor,channelId,101,next.revision)).rejects.toThrow()
  await saveChannelFee(pool,root,actor,channelId,3.25,next.revision)
  const current=await readChannelFees(root,actor);expect(current.fees[0].rate).toBe(3.25)
  await saveChannelFee(pool,root,actor,channelId,null,current.revision)
  expect((await readChannelFees(root,actor)).fees).toHaveLength(0)
 }finally{await unlink(join(root,workspaceId,'channel-fees.json')).catch(()=>{});await rmdir(join(root,workspaceId));await rmdir(root)}
})
