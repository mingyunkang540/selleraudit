import {useState} from 'react'
import type {SellerData} from '../../types/domain'
import type {ConfigurationData} from '../products/configurationTypes'
import type {Coupon} from './coupons'
import type {MatrixProductPrice} from './matrixStatus'
import {downloadChannelProductExcel} from './buildChannelProductWorkbook'

export function ChannelProductExport({data,configurationData,coupons,now,loading,prices}:{data:SellerData;configurationData:ConfigurationData|null;coupons:Coupon[]|null;now:Date;loading:boolean;prices:Map<string,MatrixProductPrice>}){
 const [channelId,setChannelId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const download=async()=>{setError('');setBusy(true);try{await downloadChannelProductExcel(data,channelId,configurationData,coupons,now,prices)}catch(cause){setError(cause instanceof Error?cause.message:'엑셀 파일을 만들지 못했습니다.')}finally{setBusy(false)}}
 return <section className="panel channel-product-export"><div><strong>쇼핑몰 상품 목록 다운로드</strong><p>선택한 쇼핑몰의 저장된 상품·옵션 전체를 내려받습니다. 미매칭과 미사용 옵션도 포함하며 화면 검색·상태 필터는 적용되지 않습니다. 확인되지 않은 행사가와 구성별 가격은 빈칸으로 표시합니다.{loading&&' 쿠폰·구성·가격 정보를 불러오는 중입니다.'}</p></div><label>다운로드할 쇼핑몰<select value={channelId} onChange={event=>setChannelId(event.target.value)}><option value="">쇼핑몰 선택</option>{data.channels.map(channel=><option key={channel.id} value={channel.id}>{channel.channelName}</option>)}</select></label><button type="button" className="button button-primary" disabled={busy||loading||!channelId} onClick={()=>void download()}>{busy?'파일 만드는 중…':'상품 목록 엑셀 다운로드'}</button>{error&&<p className="channel-product-export-error" role="alert">{error}</p>}</section>
}
