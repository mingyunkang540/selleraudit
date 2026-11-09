import {expect,test} from '@playwright/test'
import {createSeedData} from '../../src/mock'
import {calculateHealth} from '../../src/features/dashboard/health'
import type {MatrixProductPrice} from '../../src/features/channels/matrixStatus'

test('health includes matrix price and review states without double-counting an option',()=>{
 const data=createSeedData(),product=data.products[0],channel=data.channels[0],listing={...data.listings[0],channelId:channel.id,status:'ACTIVE' as const}
 const first={...data.offers[0],id:'offer-one',listingId:listing.id,masterProductId:product.id,status:'ACTIVE' as const,salePrice:120}
 const second={...first,id:'offer-two',salePrice:90}
 data.products=[product];data.channels=[channel];data.listings=[listing];data.offers=[first,second];data.issues=[]
 const prices=new Map<string,MatrixProductPrice>([[product.id,{productId:product.id,values:{normal:100,regular:90,basic:80,medium:80,large:80,live:70,group:null},options:[]}]])
 const configs={configurations:[],bindings:[]}
 const baseline=calculateHealth(data,true,prices,configs)
 expect(baseline).toMatchObject({score:0,affected:2,mismatchCells:1,reviewCells:0})
 const issue={...createSeedData().issues[0],status:'OPEN' as const,offerId:first.id,listingId:listing.id,channelId:channel.id,productId:product.id,issueType:'PRICE_MISMATCH' as const}
 data.issues=[issue]
 expect(calculateHealth(data,true,prices,configs)).toMatchObject({score:0,affected:2,standaloneIssues:0})
 data.issues=[];first.salePrice=90
 prices.get(product.id)!.values!.live=null
 expect(calculateHealth(data,true,prices,configs)).toMatchObject({score:0,affected:2,mismatchCells:0,reviewCells:1})
 prices.get(product.id)!.values!.live=70
 expect(calculateHealth(data,true,prices,configs)).toMatchObject({score:100,affected:0,reviewCells:0})
 data.issues=[{...issue,offerId:'unrelated',listingId:null,channelId:null,productId:null}]
 expect(calculateHealth(data,true,prices,configs)).toMatchObject({score:50,affected:0,standaloneIssues:1})
})
