import {test,expect} from '@playwright/test'
import {createSeedData} from '../../src/mock'
import {channelProductExportRows} from '../../src/features/channels/buildChannelProductWorkbook'
import type {MatrixProductPrice} from '../../src/features/channels/matrixStatus'

test('기준 상품 행사가를 내보내고 구분할 수 없는 옵션 가격은 비워 둔다',()=>{
 const data=createSeedData(),product=data.products[0],channel=data.channels[0]
 const listing={...data.listings[0],channelId:channel.id},offer={...data.offers[0],listingId:listing.id,masterProductId:product.id}
 data.products=[product];data.channels=[channel];data.listings=[listing];data.offers=[offer];data.listingIdsWithoutOffers=[]
 const value={normal:10000,regular:9000,basic:8000,medium:7000,large:6000,live:5000,group:null}
 const prices=new Map<string,MatrixProductPrice>([[product.id,{productId:product.id,values:value,options:[]}]])
 const now=new Date('2026-11-05T00:00:00Z')
 expect(channelProductExportRows(data,channel.id,{configurations:[],bindings:[]},[],now,prices)[1].slice(18,22)).toEqual([8000,7000,6000,5000])
 expect(channelProductExportRows(data,channel.id,null,[],now,prices)[1].slice(18,22)).toEqual([null,null,null,null])
 prices.set(product.id,{productId:product.id,values:value,options:[{name:'선택 필요',values:value}]})
 expect(channelProductExportRows(data,channel.id,{configurations:[],bindings:[]},[],now,prices)[1].slice(18,22)).toEqual([null,null,null,null])
})
