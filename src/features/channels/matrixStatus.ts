import {getCellStatus,getOfferDetails} from '../../lib/selectors'
import type {CellStatus,Channel,Product,SellerData} from '../../types/domain'
import type {ConfigurationData} from '../products/configurationTypes'
import {priceStatus} from './priceStatus'

export type MatrixPriceValues=Record<'normal'|'regular'|'basic'|'medium'|'large'|'live'|'group',number|null>&{cost?:number|null}
export type MatrixProductPrice={productId:string;values:MatrixPriceValues|null;options:{name:string;values:MatrixPriceValues}[]}
export function matrixStatus(data:SellerData,product:Product,channel:Channel,local:boolean,prices:Map<string,MatrixProductPrice>,configurationData:ConfigurationData|null):CellStatus{
 const base=getCellStatus(data,product.id,channel.id)
 if(!local||base==='MISSING')return base
 const active=getOfferDetails(data,product.id).filter(d=>d.channel.id===channel.id&&d.offer.status==='ACTIVE'&&d.listing.status==='ACTIVE')
 if(!active.length)return base==='PRICE_MISMATCH'?base:'REVIEW'
 if(!configurationData)return base==='PRICE_MISMATCH'?base:'REVIEW'
 const configs=configurationData.configurations.filter(c=>c.productId===product.id)
 const price=prices.get(product.id),values=price?.options.length?null:price?.values
 const statuses=active.map(d=>{const binding=configurationData.bindings.find(b=>b.offerId===d.offer.id);const selected=configs.find(c=>c.id===binding?.configurationId);return configs.length?selected?priceStatus(d.offer.salePrice,selected.prices.normal,selected.prices.live):'REVIEW':priceStatus(d.offer.salePrice,values?.normal??null,values?.live??null)})
 if(base==='PRICE_MISMATCH'||statuses.includes('PRICE_MISMATCH'))return 'PRICE_MISMATCH'
 if(base==='REVIEW'||statuses.includes('REVIEW'))return 'REVIEW'
 return 'NORMAL'
}
