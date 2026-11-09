import type {OfferDetail} from '../../types/domain'
import type {ConfigurationData} from '../products/configurationTypes'
import type {MatrixProductPrice} from './matrixStatus'
import {applyCoupon,type CouponSelection} from './coupons'

export type PromotionStatus='REGULAR'|'PROMOTION'|'MIXED'|'UNKNOWN'
export const promotionLabel:Record<PromotionStatus,string>={REGULAR:'상시',PROMOTION:'행사중',MIXED:'혼합',UNKNOWN:'확인 필요'}

export function optionPromotionStatus(detail:OfferDetail,productId:string,price:MatrixProductPrice|undefined,configurationData:ConfigurationData|null,couponReady:boolean,coupon:CouponSelection,now:Date):PromotionStatus {
 if(detail.offer.status!=='ACTIVE'||detail.listing.status!=='ACTIVE'||!configurationData||!couponReady||detail.offer.salePrice===null)return 'UNKNOWN'
 const configs=configurationData.configurations.filter(config=>config.productId===productId)
 const binding=configurationData.bindings.find(item=>item.offerId===detail.offer.id)
 const config=configs.find(item=>item.id===binding?.configurationId)
 const regular=configs.length?config?.prices.regular:price?.options.length?null:price?.values?.regular
 if(regular===null||regular===undefined||!Number.isFinite(regular))return 'UNKNOWN'
 const final=applyCoupon(detail.offer.salePrice,coupon,productId,now)??detail.offer.salePrice
 return final<regular?'PROMOTION':'REGULAR'
}
export function channelPromotionStatus(details:OfferDetail[],productId:string,price:MatrixProductPrice|undefined,configurationData:ConfigurationData|null,couponReady:boolean,coupon:CouponSelection,now:Date):PromotionStatus|null {
 const active=details.filter(item=>item.offer.status==='ACTIVE'&&item.listing.status==='ACTIVE')
 if(!active.length)return null
 const statuses=active.map(item=>optionPromotionStatus(item,productId,price,configurationData,couponReady,coupon,now))
 if(statuses.includes('UNKNOWN'))return 'UNKNOWN'
 return statuses.includes('PROMOTION')&&statuses.includes('REGULAR')?'MIXED':statuses[0]
}
