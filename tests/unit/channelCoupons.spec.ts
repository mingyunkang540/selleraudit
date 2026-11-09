import {mkdtemp,mkdir,unlink,rmdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {Pool} from 'pg'
import {expect,test} from '@playwright/test'
import {applyCoupon,companyCouponCost,validShares,type Coupon} from '../../src/features/channels/coupons'
import {addChannelCoupon,readChannelCoupons,removeChannelCoupon,updateCouponShares} from '../../server/business/channelCoupons'
import type {Identity} from '../../server/auth/service'

test('coupon uses Seoul dates, scope, minimum, maximum and rounding',()=>{
 const coupon:Coupon={id:'1',channelId:'2',name:'행사',startDate:'2026-10-26',endDate:'2026-11-08',percent:10,minimum:10000,maximum:2000,rounding:'WON_NEAREST',productIds:['product']}
 expect(applyCoupon(12345,coupon,'product',new Date('2026-11-02T15:00:00Z'))).toBe(11110)
 expect(applyCoupon(30000,coupon,'product',new Date('2026-11-08T14:59:59Z'))).toBe(28000)
 expect(applyCoupon(30000,coupon,'product',new Date('2026-11-08T15:00:00Z'))).toBeNull()
 expect(applyCoupon(9000,coupon,'product',new Date('2026-11-03T00:00:00Z'))).toBeNull()
 expect(applyCoupon(12345,coupon,'another',new Date('2026-11-03T00:00:00Z'))).toBeNull()
 expect(applyCoupon(null,coupon,'product',new Date('2026-11-03T00:00:00Z'))).toBeNull()
 expect(applyCoupon(12345,{...coupon,rounding:'TEN_FLOOR'},'product',new Date('2026-11-03T00:00:00Z'))).toBe(11115)
 expect(companyCouponCost(12345,{...coupon,channelShare:50,companyShare:50},'product',new Date('2026-11-03T00:00:00Z'))).toBe(618)
 expect(companyCouponCost(12345,{...coupon,channelShare:100,companyShare:0},'product',new Date('2026-11-03T00:00:00Z'))).toBe(0)
 expect(companyCouponCost(12345,coupon,'product',new Date('2026-11-03T00:00:00Z'))).toBeNull()
 expect(companyCouponCost(12345,coupon,'another',new Date('2026-11-03T00:00:00Z'))).toBe(0)
 expect(validShares(33.33,66.67)).toBe(true);expect(validShares(50,40)).toBe(false)
 const fixed:Coupon={...coupon,discountType:'FIXED',fixedAmount:1500,percent:0,maximum:null,rounding:'TEN_FLOOR',channelShare:25,companyShare:75}
 expect(applyCoupon(12345,fixed,'product',new Date('2026-11-03T00:00:00Z'))).toBe(10845)
 expect(companyCouponCost(12345,fixed,'product',new Date('2026-11-03T00:00:00Z'))).toBe(1125)
 expect(applyCoupon(1000,{...fixed,minimum:null},'product',new Date('2026-11-03T00:00:00Z'))).toBe(0)
 expect(applyCoupon(9000,fixed,'product',new Date('2026-11-03T00:00:00Z'))).toBeNull()
 const now=new Date('2026-11-03T00:00:00Z'),percentCoupon={...coupon,channelShare:100,companyShare:0},fixedCoupon={...fixed,minimum:null,companyShare:100,channelShare:0}
 expect(applyCoupon(12345,[fixedCoupon,percentCoupon],'product',now)).toBe(9610)
 expect(companyCouponCost(12345,[fixedCoupon,percentCoupon],'product',now)).toBe(1500)
 expect(applyCoupon(12345,[percentCoupon,{...fixedCoupon,minimum:12000}],'product',now)).toBe(9610)
 expect(applyCoupon(12345,[{...fixedCoupon,fixedAmount:20000},percentCoupon],'product',now)).toBe(0)
 expect(companyCouponCost(12345,[percentCoupon,{...fixedCoupon,companyShare:undefined}],'product',now)).toBeNull()
})
test('coupon storage rejects stale writes and accepts overlapping events',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coupon-test-')),workspaceId='11111111-1111-4111-8111-111111111111',channelId='22222222-2222-4222-8222-222222222222'
 const actor={workspaceId,userId:'33333333-3333-4333-8333-333333333333',role:'ADMIN'} as Identity
 const pool={query:async()=>({rowCount:1})} as unknown as Pool
 try{
  await mkdir(join(root,workspaceId))
  const before=await readChannelCoupons(root,actor)
  const input={channelId,name:'할인',startDate:'2026-10-26',endDate:'2026-11-08',percent:10,minimum:null,maximum:null,rounding:'WON_NEAREST' as const,productIds:null,channelShare:50,companyShare:50}
  const first=await addChannelCoupon(pool,root,actor,input,before.revision)
  await expect(addChannelCoupon(pool,root,actor,input,before.revision)).rejects.toThrow('Data changed')
  const after=await readChannelCoupons(root,actor)
  const second=await addChannelCoupon(pool,root,actor,{...input,name:'중복 쿠폰'},after.revision)
  const withOverlap=await readChannelCoupons(root,actor);expect(withOverlap.coupons).toHaveLength(2)
  await expect(updateCouponShares(pool,root,actor,first.coupon.id,withOverlap.revision,10,20)).rejects.toThrow()
  await updateCouponShares(pool,root,actor,first.coupon.id,withOverlap.revision,25,75)
  const updated=await readChannelCoupons(root,actor);expect(updated.coupons[0]).toMatchObject({channelShare:25,companyShare:75})
  await removeChannelCoupon(root,actor,first.coupon.id,updated.revision)
  const remaining=await readChannelCoupons(root,actor);expect(remaining.coupons).toHaveLength(1)
  await removeChannelCoupon(root,actor,second.coupon.id,remaining.revision)
  const empty=await readChannelCoupons(root,actor);expect(empty.coupons).toHaveLength(0)
  const fixed={...input,discountType:'FIXED' as const,fixedAmount:1500,percent:0}
  await expect(addChannelCoupon(pool,root,actor,{...fixed,fixedAmount:0},empty.revision)).rejects.toThrow('Invalid coupon')
  const saved=await addChannelCoupon(pool,root,actor,fixed,empty.revision)
  const stored=await readChannelCoupons(root,actor);expect(stored.coupons[0]).toMatchObject({discountType:'FIXED',fixedAmount:1500,percent:0})
  await removeChannelCoupon(root,actor,saved.coupon.id,stored.revision)
 }finally{await unlink(join(root,workspaceId,'channel-coupons.json')).catch(()=>{});await rmdir(join(root,workspaceId));await rmdir(root)}
})
