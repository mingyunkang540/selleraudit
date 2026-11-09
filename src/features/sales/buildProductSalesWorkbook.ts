type SummaryRow={name:string;quantity:number;amount:number|null}
type ExportData={start:string;end:string;channel:string;category:string;query:string;selectedProduct:string|null;sourceName:string;stale:boolean;total:number;colorTotal:number;categories:SummaryRow[];products:SummaryRow[];colors:SummaryRow[]}

export async function downloadProductSalesExcel(data:ExportData){
 const XLSX=await import('xlsx')
 const workbook=XLSX.utils.book_new()
 const conditions=XLSX.utils.aoa_to_sheet([
  ['항목','내용'],['기준 파일',data.sourceName],['시작일',data.start],['종료일',data.end],
  ['채널',data.channel==='ALL'?'전체 채널':data.channel],['상품 구분',data.category==='ALL'?'전체 구분':data.category],
  ['상품 검색어',data.query.trim()||'전체'],['색상 집계 선택 상품',data.selectedProduct||'전체 상품'],
  ['선택 조건 판매량',data.total],['색상 확인 판매량',data.colorTotal],
  ['데이터 상태',data.stale?'원본 갱신 실패: 마지막으로 불러온 자료':'현재 불러온 자료'],
  ['집계 안내','매칭필요 항목은 전체 집계에서 제외합니다. 색상 없음·미확인 항목은 색상별 집계에서만 제외합니다.'],
  ['검색 안내','상품 검색어는 상품별 목록에만 적용되며 판매 비중의 분모와 색상별 집계에는 적용되지 않습니다.'],
  ['선택 안내','선택한 상품은 색상별 집계에만 적용됩니다. 판매량에는 반품 등 음수 수량이 포함됩니다.'],
  ['매출 안내','매출액은 원본 로우데이터의 결제금액 합계입니다. 금액을 확인할 수 없는 행이 포함된 경우 확인 필요로 표시합니다.'],
 ])
 conditions['!cols']=[{wch:25},{wch:100}]
 XLSX.utils.book_append_sheet(workbook,conditions,'조회 조건')
 const addSummary=(sheetName:string,heading:string,rows:SummaryRow[],denominator:number)=>{
  const sheet=XLSX.utils.aoa_to_sheet([[heading,'판매량','판매 비중','매출액 (원)'],...rows.map(row=>[row.name,row.quantity,denominator>0?row.quantity/denominator:'—',row.amount??'확인 필요'])])
  sheet['!cols']=[{wch:48},{wch:18},{wch:18},{wch:20}]
  rows.forEach((_,index)=>{const number=sheet[`B${index+2}`],share=sheet[`C${index+2}`],amount=sheet[`D${index+2}`];if(number)number.z='#,##0.##';if(share&&share.t==='n')share.z='0.0%';if(amount&&amount.t==='n')amount.z='#,##0.##'})
  if(rows.length)sheet['!autofilter']={ref:`A1:D${rows.length+1}`}
  XLSX.utils.book_append_sheet(workbook,sheet,sheetName)
 }
 addSummary('상품 구분별','상품 구분',data.categories,data.total)
 addSummary('상품별 판매량','상품명',data.products,data.total)
 addSummary('색상별 판매량','색상',data.colors,data.colorTotal)
 XLSX.writeFile(workbook,`상품판매분석_${data.start}_${data.end}.xlsx`)
}
