import type {ChannelOffer,SellerData} from '../../types/domain'
import type {ConfigurationData} from '../products/configurationTypes'
import {applyCoupon,koreaDate,type Coupon} from './coupons'
import type {MatrixProductPrice} from './matrixStatus'

type Cell=string|number|null
const headers=['쇼핑몰','채널 상품번호','채널 상품명','채널 상품 상태','옵션번호','옵션명','옵션 상태','판매자 코드','채널 정상가','채널 판매가','쿠폰 적용 후 예상가','쿠폰 계산 상태','매핑 상태','사방넷 품번','상품 마스터명','연결된 구성','구성 SKU','최근 동기화','기본 행사가','중형 행사가','대형 행사가','원데이/라이브 행사가']
const status={ACTIVE:'사용',INACTIVE:'미사용',DRAFT:'임시'} as const

export function channelProductExportRows(data:SellerData,channelId:string,configurationData:ConfigurationData|null,coupons:Coupon[]|null,now:Date,prices:Map<string,MatrixProductPrice>){
 const channel=data.channels.find(item=>item.id===channelId)
 if(!channel)throw new Error('다운로드할 쇼핑몰을 선택해 주세요.')
 const products=new Map(data.products.map(item=>[item.id,item])),skus=new Map(data.skus.map(item=>[item.id,item]))
 const offersByListing=new Map<string,ChannelOffer[]>()
 for(const offer of data.offers){const offers=offersByListing.get(offer.listingId)??[];offers.push(offer);offersByListing.set(offer.listingId,offers)}
 const knownMissing=data.listingIdsWithoutOffers?new Set(data.listingIdsWithoutOffers):null
 const activeCoupons=coupons?.filter(c=>c.channelId===channelId&&koreaDate(now)>=c.startDate&&koreaDate(now)<=c.endDate)
 const rows:Cell[][]=[headers]
 for(const listing of data.listings.filter(item=>item.channelId===channelId)){
  const offers=offersByListing.get(listing.id)??[]
  if(!offers.length){if(knownMissing&&!knownMissing.has(listing.id))continue;rows.push([channel.channelName,listing.channelProductId,listing.productName,status[listing.status],'','', '정보 없음','',null,null,null,'옵션 정보 없음','옵션 정보 없음','','','','',listing.lastSyncedAt??'']);continue}
  for(const offer of offers){
   const product=offer.masterProductId?products.get(offer.masterProductId):undefined
   const options=product?configurationData?.configurations.filter(item=>item.productId===product.id)??[]:[]
   const binding=configurationData?.bindings.find(item=>item.offerId===offer.id)
   const selected=options.find(item=>item.id===binding?.configurationId)
   const productPrice=product?prices.get(product.id):undefined
   const eventPrices=!configurationData?null:selected?selected.prices:options.length||productPrice?.options.length?null:productPrice?.values
   const components=!configurationData?null:selected?selected.components:options.length?null:product?data.components.filter(item=>item.productId===product.id):null
   const composition=components?.map(item=>`${skus.get(item.skuId)?.skuCode??'SKU 확인 필요'} × ${item.quantity}`).join(', ')??''
   const couponApplicable=product&&offer.status==='ACTIVE'&&listing.status==='ACTIVE'&&coupons!==null
   const couponPrice=couponApplicable?applyCoupon(offer.salePrice,activeCoupons,product.id,now):null
   const couponState=coupons===null?'쿠폰 정보 확인 필요':!product?'매핑 필요':offer.status!=='ACTIVE'||listing.status!=='ACTIVE'?'사용 안 함':offer.salePrice===null?'판매가 확인 필요':couponPrice===null?'미적용':'적용'
   rows.push([channel.channelName,listing.channelProductId,listing.productName,status[listing.status],offer.channelOptionId,offer.optionName??'단일 옵션',status[offer.status],offer.sellerCode??'',offer.normalPrice,offer.salePrice,couponPrice,couponState,product?'매핑됨':'미매칭',product?.sabangnetCode??'',product?.productName??'',selected?.name??(product&&(!configurationData||options.length)?'구성 확인 필요':''),composition,listing.lastSyncedAt??'',eventPrices?.basic??null,eventPrices?.medium??null,eventPrices?.large??null,eventPrices?.live??null])
  }
 }
 return rows
}

export async function downloadChannelProductExcel(data:SellerData,channelId:string,configurationData:ConfigurationData|null,coupons:Coupon[]|null,now:Date,prices:Map<string,MatrixProductPrice>){
 const rows=channelProductExportRows(data,channelId,configurationData,coupons,now,prices)
 if(rows.length===1)throw new Error('선택한 쇼핑몰에 저장된 상품이나 옵션이 없습니다.')
 const XLSX=await import('xlsx'),sheet=XLSX.utils.aoa_to_sheet(rows)
 sheet['!cols']=[{wch:18},{wch:22},{wch:48},{wch:15},{wch:24},{wch:36},{wch:15},{wch:18},{wch:16},{wch:16},{wch:22},{wch:22},{wch:18},{wch:18},{wch:40},{wch:24},{wch:48},{wch:26},{wch:18},{wch:18},{wch:18},{wch:24}]
 sheet['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length-1,c:headers.length-1}})}
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'상품 옵션 목록')
 const name=String(rows[1][0]).replace(/[\\/:*?"<>|]/g,'_')
 XLSX.writeFile(book,`채널상품_${name}_${koreaDate(now)}.xlsx`,{compression:true})
}
