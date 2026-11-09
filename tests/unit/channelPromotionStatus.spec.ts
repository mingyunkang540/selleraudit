import {expect,test} from '@playwright/test'
import {createSeedData} from '../../src/mock'
import {channelPromotionStatus,optionPromotionStatus} from '../../src/features/channels/promotionStatus'
import type {Coupon} from '../../src/features/channels/coupons'
import type {MatrixProductPrice} from '../../src/features/channels/matrixStatus'

test('상시가와 쿠폰 적용 최종가 및 옵션별 구성을 비교한다',()=>{
 const data=createSeedData(),offer={...data.offers[0],status:'ACTIVE' as const,salePrice:10000},listing={...data.listings.find(l=>l.id===offer.listingId)!,status:'ACTIVE' as const},detail={offer,listing,channel:data.channels.find(c=>c.id===listing.channelId)!}
 const productId='product',price:MatrixProductPrice={productId,values:{normal:15000,regular:10000,basic:null,medium:null,large:null,live:8000,group:null},options:[]},configs={configurations:[],bindings:[]}
 const now=new Date('2026-11-05T03:00:00Z'),coupon:Coupon={id:'c',channelId:'channel',name:'행사',startDate:'2026-11-01',endDate:'2026-11-10',percent:10,minimum:null,maximum:null,rounding:'WON_NEAREST',productIds:null}
 expect(optionPromotionStatus(detail,productId,price,configs,true,undefined,now)).toBe('REGULAR')
 expect(optionPromotionStatus(detail,productId,price,configs,true,coupon,now)).toBe('PROMOTION')
 expect(optionPromotionStatus(detail,productId,price,configs,false,coupon,now)).toBe('UNKNOWN')
 expect(optionPromotionStatus(detail,productId,{...price,values:{...price.values!,regular:null}},configs,true,undefined,now)).toBe('UNKNOWN')
 const discounted={...detail,offer:{...offer,id:'second',salePrice:9000}}
 expect(channelPromotionStatus([detail,discounted],productId,price,configs,true,undefined,now)).toBe('MIXED')
 expect(channelPromotionStatus([detail,{...discounted,offer:{...discounted.offer,salePrice:null}}],productId,price,configs,true,undefined,now)).toBe('UNKNOWN')
 const configured={configurations:[{id:'cfg',productId,name:'구성',prices:{normal:15000,regular:12000,basic:null,medium:null,large:null,live:8000,group:null},components:[]}],bindings:[{offerId:offer.id,configurationId:'cfg'}]}
 expect(optionPromotionStatus(detail,productId,price,configured,true,undefined,now)).toBe('PROMOTION')
 expect(optionPromotionStatus(discounted,productId,price,configured,true,undefined,now)).toBe('UNKNOWN')
})
