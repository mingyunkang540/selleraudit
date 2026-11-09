import {useEffect,useMemo,useRef,useState} from 'react'
import {EmptyState,PageHeader} from '../../components/ui'
import {downloadProductSalesExcel} from './buildProductSalesWorkbook'
import './product-sales.css'

type SaleRow={date:string;channel:string;category:string;product:string;color:string;quantity:number;sourceRows:number;amount?:number|null}
type Snapshot={sourceName:string;rows:SaleRow[];skipped:Record<string,number>;syncStatus:string}
const categories=['단품','단품세트','세트구성','구성품','구분 미입력']
const count=(value:number)=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(value)
const percent=(value:number,total:number)=>total>0?`${(value/total*100).toFixed(1)}%`:'—'
function summarize(rows:SaleRow[],field:'product'|'color'|'category'){
 const map=new Map<string,{quantity:number;amount:number|null}>()
 for(const row of rows){const label=row[field],previous=map.get(label)??{quantity:0,amount:0};map.set(label,{quantity:previous.quantity+row.quantity,amount:previous.amount===null||typeof row.amount!=='number'||!Number.isFinite(row.amount)?null:previous.amount+row.amount})}
 return [...map].map(([name,value])=>({name,...value})).sort((a,b)=>b.quantity-a.quantity||a.name.localeCompare(b.name,'ko-KR'))
}
export function ProductSalesAnalysis({local}:{local:boolean}){
 const [exportBusy,setExportBusy]=useState(false),[exportError,setExportError]=useState('')
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[failed,setFailed]=useState(false),[start,setStart]=useState(''),[end,setEnd]=useState(''),[channel,setChannel]=useState('ALL'),[category,setCategory]=useState('ALL'),[query,setQuery]=useState(''),[selectedProduct,setSelectedProduct]=useState<string|null>(null)
 const latestDate=useRef('')
 useEffect(()=>{if(!local)return;const controller=new AbortController();let busy=false
  const load=async()=>{if(busy)return;busy=true;try{const response=await fetch('/api/product-sales-analysis',{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('unavailable');const value=await response.json() as Snapshot;const oldLatest=latestDate.current;latestDate.current=value.rows.at(-1)?.date??'';setSnapshot(value);setStart(old=>old||value.rows[0]?.date||'');setEnd(old=>!old||old===oldLatest?latestDate.current:old);setFailed(false)}catch{if(!controller.signal.aborted)setFailed(true)}finally{busy=false}}
  void load();const timer=window.setInterval(()=>void load(),60000);return()=>{controller.abort();window.clearInterval(timer)}
 },[local])
 const channels=useMemo(()=>snapshot?[...new Set(snapshot.rows.filter(row=>row.category!=='매칭필요').map(row=>row.channel))].sort((a,b)=>a.localeCompare(b,'ko-KR')):[],[snapshot])
 const rows=useMemo(()=>snapshot?.rows.filter(row=>row.category!=='매칭필요'&&row.date>=start&&row.date<=end&&(channel==='ALL'||row.channel===channel)&&(category==='ALL'||row.category===category))??[],[snapshot,start,end,channel,category])
 const total=rows.reduce((sum,row)=>sum+row.quantity,0),products=useMemo(()=>summarize(rows,'product'),[rows])
 const activeProduct=selectedProduct&&products.some(row=>row.name===selectedProduct)?selectedProduct:null
 const colorRows=rows.filter(row=>(!activeProduct||row.product===activeProduct)&&!['','-','0','색상 없음','색상 미확인','색상 없음/미확인'].includes(row.color.trim())),colorTotal=colorRows.reduce((sum,row)=>sum+row.quantity,0),colors=summarize(colorRows,'color')
 const visibleProducts=products.filter(row=>row.name.toLocaleLowerCase('ko-KR').includes(query.trim().toLocaleLowerCase('ko-KR')))
 const categorySummary=summarize(rows,'category'),categoryRows=categories.map(name=>categorySummary.find(row=>row.name===name)??{name,quantity:0,amount:0})
 async function download(){
  if(!snapshot)return
  setExportBusy(true);setExportError('')
  try{await downloadProductSalesExcel({start,end,channel,category,query,selectedProduct:activeProduct,sourceName:snapshot.sourceName,stale:failed||snapshot.syncStatus==='error',total,colorTotal,categories:categoryRows,products:visibleProducts,colors})}
  catch{setExportError('엑셀 파일을 만들지 못했습니다. 다시 시도해 주세요.')}
  finally{setExportBusy(false)}
 }
 if(!local)return <><PageHeader title="상품 판매 분석" /><div className="panel"><EmptyState title="로컬 판매 자료가 필요합니다" /></div></>
 if(failed&&!snapshot)return <><PageHeader title="상품 판매 분석" /><div className="error-banner" role="alert">판매 로우데이터를 불러오지 못했습니다. 공유 서버와 원본 엑셀을 확인해 주세요. <button className="button button-small" onClick={()=>window.location.reload()}>다시 불러오기</button></div></>
 if(!snapshot)return <><PageHeader title="상품 판매 분석" /><div className="panel product-sales-loading" role="status">판매 로우데이터를 분석하고 있습니다. 처음에는 시간이 걸릴 수 있습니다.</div></>
 return <div className="product-sales"><PageHeader title="상품 판매 분석" description="판매 수량과 비중을 상품 구분과 색상별로 확인합니다." />
  <p className="product-sales-source">기준 파일: {snapshot.sourceName} · 로우데이터 시트 · {snapshot.rows[0]?.date} ~ {snapshot.rows.at(-1)?.date}</p>
  {(failed||snapshot.syncStatus==='error')&&<div className="error-banner" role="alert">원본을 갱신하지 못해 마지막으로 분석한 자료를 표시합니다.</div>}
  <section className="panel product-sales-filters"><label>시작일<input type="date" value={start} max={end} onChange={e=>setStart(e.target.value)} /></label><label>종료일<input type="date" value={end} min={start} onChange={e=>setEnd(e.target.value)} /></label><label>판매 채널<select value={channel} onChange={e=>setChannel(e.target.value)}><option value="ALL">전체 채널</option>{channels.map(name=><option key={name}>{name}</option>)}</select></label><label>상품 구분<select value={category} onChange={e=>setCategory(e.target.value)}><option value="ALL">전체 구분</option>{categories.map(name=><option key={name}>{name}</option>)}</select></label><button type="button" className="button button-primary" disabled={exportBusy||!start||!end} onClick={()=>void download()}>{exportBusy?'엑셀 생성 중…':'엑셀 다운로드'}</button></section>
  {exportError&&<div className="error-banner" role="alert">{exportError}</div>}
  <p className="product-sales-explainer">‘매칭필요’ 항목은 판매량과 비중 집계에서 제외합니다. 2024·2025년은 가져온 월별 파일 기준이며 파일 변경 시 다시 가져와야 합니다. 2024년 1~11월은 원본에 구성구분이 없어 ‘구분 미입력’으로 표시합니다. 판매량은 원본 수량의 합계이며 상품별 비중은 선택한 조건의 전체 판매량을 기준으로 합니다. 색상별 판매량과 비중은 색상이 확인된 상품만 기준으로 합니다. 색상과 상품 구분은 엑셀의 매칭 결과를 그대로 사용하며, 혼합 색상은 별도로 표시합니다. 반품 등 음수 수량은 원본 그대로 반영합니다.</p>
  {((snapshot.skipped.invalidDate??0)+(snapshot.skipped.invalidQuantity??0)>0)&&<p className="product-sales-warning">날짜 또는 수량을 확인할 수 없는 원본 {count((snapshot.skipped.invalidDate??0)+(snapshot.skipped.invalidQuantity??0))}행은 집계에서 제외했습니다.</p>}
  <div className="product-sales-kpis"><div className="panel"><span>선택 조건 판매량</span><strong>{count(total)}개</strong></div><div className="panel"><span>상품 종류</span><strong>{count(products.length)}개</strong></div><div className="panel"><span>원본 행</span><strong>{count(rows.reduce((n,row)=>n+row.sourceRows,0))}행</strong></div></div>
  <section className="panel product-sales-categories"><h2>상품 구분별 판매량</h2><div>{categoryRows.map(({name,quantity})=><button type="button" key={name} aria-pressed={category===name} onClick={()=>setCategory(category===name?'ALL':name)}><span>{name}</span><strong>{count(quantity)}개</strong><small>{percent(quantity,total)}</small></button>)}</div></section>
  <div className="product-sales-panels"><section className="panel product-sales-table"><div className="product-sales-heading"><div><h2>상품별 판매량</h2><p>상품명을 선택하면 해당 상품의 색상별 판매를 확인합니다.</p></div><input aria-label="상품 검색" placeholder="상품명 검색" value={query} onChange={e=>setQuery(e.target.value)} /></div><div className="product-sales-scroll"><table><thead><tr><th>상품명</th><th>판매량</th><th>판매 비중</th></tr></thead><tbody>{visibleProducts.map(row=><tr key={row.name}><td><button type="button" className="product-sales-name" aria-pressed={activeProduct===row.name} onClick={()=>setSelectedProduct(activeProduct===row.name?null:row.name)}>{row.name}</button></td><td>{count(row.quantity)}개</td><td>{percent(row.quantity,total)}</td></tr>)}</tbody></table>{!visibleProducts.length&&<p className="product-sales-empty">표시할 상품이 없습니다.</p>}</div></section>
   <section className="panel product-sales-table"><div className="product-sales-heading"><div><h2>색상별 판매량</h2><p>{activeProduct?`${activeProduct} 기준`:'선택 조건 전체 상품 기준'}</p></div>{activeProduct&&<button className="button button-small" onClick={()=>setSelectedProduct(null)}>상품 선택 해제</button>}</div><div className="product-sales-scroll"><table><thead><tr><th>색상</th><th>판매량</th><th>판매 비중</th></tr></thead><tbody>{colors.map(row=><tr key={row.name}><td>{row.name}</td><td>{count(row.quantity)}개</td><td>{percent(row.quantity,colorTotal)}</td></tr>)}</tbody></table>{!colors.length&&<p className="product-sales-empty">표시할 색상이 없습니다.</p>}</div></section></div>
 </div>
}
