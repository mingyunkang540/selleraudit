import json,openpyxl
from datetime import datetime,date
from pathlib import Path
path=Path.home()/'Desktop'/'★2026년 땡스소윤 매출 데이터.xlsx'
book=openpyxl.load_workbook(path,read_only=True,data_only=True)
formulas=openpyxl.load_workbook(path,read_only=True,data_only=False)
for sh in book.worksheets[1:12]:
 header=None
 for row in sh.iter_rows(min_row=1,max_row=12,values_only=True):
  if '구분' in row and '합계' in row:header=list(row);break
 if not header: print(json.dumps({'sheet':sh.title,'error':'header'},ensure_ascii=False));continue
 di=header.index('구분');ti=header.index('합계');days=[];summary=None
 for row in sh.iter_rows(values_only=True):
  marker=row[di] if di<len(row) else None
  if marker=='2026년 매출':summary=row[ti]
  if isinstance(marker,(datetime,date)) and marker.year==2026:
   days.append({'date':marker.isoformat()[:10],'total':row[ti] if ti<len(row) else None})
 real=[d for d in days if isinstance(d['total'],(int,float)) and d['total']!=0]
 print(json.dumps({'sheet':sh.title,'dateCol':di+1,'totalCol':ti+1,'headers':[{'c':i+1,'v':v} for i,v in enumerate(header) if v is not None],'summary':summary,'sumDaily':sum(d['total'] for d in days if isinstance(d['total'],(int,float))),'nonzeroDays':len(real),'last':real[-1] if real else None},ensure_ascii=False))
 if sh==book.worksheets[1]:
  f=formulas[sh.title];print(json.dumps({'monthFormulaB11':f['B11'].value,'dailyFormulaB16':f['B16'].value,'dailyFormulaW16':f['W16'].value,'dailyFormulaX16':f['X16'].value},ensure_ascii=False))
book.close();formulas.close()
