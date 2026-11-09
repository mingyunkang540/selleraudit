import {useState} from 'react'
import type {Channel} from '../../types/domain'
import {validFeeRate,type ChannelFee} from './channelFees'
import './coupons.css'

export function ChannelFees({channels,fees,revision,onChange,editable}:{channels:Channel[];fees:ChannelFee[];revision:string;onChange:()=>Promise<void>;editable:boolean}){
 return <section className="panel coupon-panel"><details><summary>채널 수수료 관리</summary><p className="muted">채널별 수수료율을 직접 입력합니다. 쿠폰 적용 후 고객 결제 예상가에 수수료율을 곱하고 1원 단위로 반올림합니다. 수수료가 없으면 0%를 입력하세요.</p><div className="channel-fee-list">{channels.map(channel=><FeeEditor key={channel.id} channel={channel} fee={fees.find(f=>f.channelId===channel.id)} revision={revision} onChange={onChange} editable={editable} />)}</div></details></section>
}
function FeeEditor({channel,fee,revision,onChange,editable}:{channel:Channel;fee?:ChannelFee;revision:string;onChange:()=>Promise<void>;editable:boolean}){
 const [value,setValue]=useState(fee?.rate.toString()??'0'),[busy,setBusy]=useState(false),[error,setError]=useState('')
 async function save(rate:number|null){setError('');setBusy(true);try{
  const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('세션을 확인하지 못했습니다.');const session=await response.json() as {csrf:string}
  const result=await fetch('/api/channel-fees',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify({channelId:channel.id,rate,revision})});if(!result.ok){const body=await result.json() as {error?:string};throw new Error(body.error??'저장하지 못했습니다.')}
  await onChange();if(rate===null)setValue('0')
 }catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다.')}finally{setBusy(false)}}
 return <div className="channel-fee-row"><strong>{channel.channelName}</strong><span>{fee?`현재 ${fee.rate}%`:'기본 0%'}</span>{editable&&<><label>수수료율 (%)<input aria-label={`${channel.channelName} 수수료율`} type="number" min="0" max="100" step="0.01" value={value} onChange={e=>setValue(e.target.value)} placeholder="0" /></label><button type="button" className="button button-small" disabled={busy} onClick={()=>{if(value===''||!validFeeRate(Number(value))){setError('0~100%의 수수료율을 소수점 둘째 자리까지 입력해 주세요.');return}void save(Number(value))}}>저장</button>{fee&&<button type="button" className="button button-small" disabled={busy} onClick={()=>void save(null)}>기본 0%로 변경</button>}</>}{error&&<span role="alert" className="error-banner">{error}</span>}</div>
}
