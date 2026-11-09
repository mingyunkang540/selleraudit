import {applyCoupon,type CouponSelection} from './coupons.ts'
export type ChannelFee={channelId:string;rate:number}
export function validFeeRate(rate:unknown):rate is number{
 return typeof rate==='number'&&Number.isFinite(rate)&&rate>=0&&rate<=100&&Math.abs(rate*100-Math.round(rate*100))<1e-8
}
export function calculateChannelFee(sale:number|null,rate:number|null,coupon:CouponSelection,productId:string,now=new Date()):number|null{
 if(sale===null||rate===null||!validFeeRate(rate))return null
 const customerPrice=applyCoupon(sale,coupon,productId,now)??sale
 return Math.round(customerPrice*rate/100)
}
