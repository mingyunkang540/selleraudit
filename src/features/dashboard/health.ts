import {getOfferDetails} from '../../lib/selectors'
import type {SellerData} from '../../types/domain'
import type {ConfigurationData} from '../products/configurationTypes'
import {matrixStatus,type MatrixProductPrice} from '../channels/matrixStatus'

export function calculateHealth(data:SellerData,local:boolean,prices:Map<string,MatrixProductPrice>,configs:ConfigurationData|null){
 const affected=new Set<string>()
 let mismatchCells=0,reviewCells=0
 for(const product of data.products){
  const details=getOfferDetails(data,product.id)
  for(const channel of data.channels){
   const related=details.filter(d=>d.channel.id===channel.id)
   if(!related.length)continue
   const status=matrixStatus(data,product,channel,local,prices,configs)
   if(status==='PRICE_MISMATCH'||status==='REVIEW'){
    if(status==='PRICE_MISMATCH')mismatchCells++;else reviewCells++
    related.forEach(d=>affected.add(d.offer.id))
   }
  }
 }
 const open=data.issues.filter(i=>i.status==='OPEN'||i.status==='IN_PROGRESS')
 const listingById=new Map(data.listings.map(l=>[l.id,l]))
 let standaloneIssues=0
 for(const issue of open){
  const matched=data.offers.filter(offer=>{
   const listing=listingById.get(offer.listingId)
   if(issue.channelId!==null&&listing?.channelId!==issue.channelId)return false
   if(issue.offerId!==null)return issue.offerId===offer.id
   if(issue.listingId!==null)return issue.listingId===offer.listingId
   return issue.productId!==null&&issue.productId===offer.masterProductId
  })
  if(matched.length)matched.forEach(offer=>affected.add(offer.id));else standaloneIssues++
 }
 const total=data.offers.length
 return {score:total?Math.max(0,Math.round((total-affected.size-standaloneIssues)/total*100)):0,total,affected:affected.size,standaloneIssues,mismatchCells,reviewCells}
}
