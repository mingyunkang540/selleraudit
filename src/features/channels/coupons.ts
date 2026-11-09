export type Coupon={id:string;channelId:string;name:string;startDate:string;endDate:string;discountType?:'PERCENT'|'FIXED';fixedAmount?:number;percent:number;minimum:number|null;maximum:number|null;rounding:'WON_NEAREST'|'TEN_FLOOR';productIds:string[]|null;channelShare?:number;companyShare?:number}
export type CouponInput=Omit<Coupon,'id'|'channelShare'|'companyShare'>&{channelShare:number;companyShare:number}
export type CouponSelection=Coupon|Coupon[]|undefined
export function validShares(channel:unknown,company:unknown):channel is number{
 if(typeof channel!=='number'||typeof company!=='number'||!Number.isFinite(channel)||!Number.isFinite(company)||channel<0||company<0||channel>100||company>100)return false
 return Math.abs(channel*100-Math.round(channel*100))<1e-8&&Math.abs(company*100-Math.round(company*100))<1e-8&&Math.round(channel*100)+Math.round(company*100)===10000
}
export function koreaDate(now:Date=new Date()):string{
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now)
 const get=(type:string)=>parts.find(part=>part.type===type)?.value??''
 return `${get('year')}-${get('month')}-${get('day')}`
}
export function applyCouponStack(price:number|null,selection:CouponSelection,productId:string,now=new Date()){
 if(price===null||!selection)return null
 const today=koreaDate(now)
 const coupons=(Array.isArray(selection)?selection:[selection]).filter(c=>today>=c.startDate&&today<=c.endDate&&(!c.productIds||c.productIds.includes(productId))&&(c.minimum===null||price>=c.minimum))
 if(!coupons.length)return null
 const ordered=[...coupons.filter(c=>c.discountType!=='FIXED'),...coupons.filter(c=>c.discountType==='FIXED')]
 let finalPrice=price,companyCost:number|null=0
 const applied=ordered.map(coupon=>{
  const before=finalPrice,raw=coupon.discountType==='FIXED'?coupon.fixedAmount??0:before*coupon.percent/100
  const rounded=coupon.discountType==='FIXED'?raw:coupon.rounding==='TEN_FLOOR'?Math.floor(raw/10)*10:Math.round(raw)
  const discount=Math.min(before,rounded,coupon.maximum??Infinity)
  finalPrice-=discount
  if(discount>0){if(!validShares(coupon.channelShare,coupon.companyShare))companyCost=null;else if(companyCost!==null)companyCost+=Math.round(discount*coupon.companyShare!/100)}
  return {coupon,discount,finalPrice}
 })
 return {finalPrice,companyCost,applied}
}
export function applyCoupon(price:number|null,selection:CouponSelection,productId:string,now=new Date()):number|null{
 return applyCouponStack(price,selection,productId,now)?.finalPrice??null
}
export function companyCouponCost(price:number|null,selection:CouponSelection,productId:string,now=new Date()):number|null{
 if(price===null)return null
 const result=applyCouponStack(price,selection,productId,now)
 return result===null?0:result.companyCost
}
