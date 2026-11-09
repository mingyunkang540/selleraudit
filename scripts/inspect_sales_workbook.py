from pathlib import Path
import json
import openpyxl

path=Path.home()/'Desktop'/'★2026년 땡스소윤 매출 데이터.xlsx'
book=openpyxl.load_workbook(path,read_only=True,data_only=True)
print(json.dumps({'sheets':book.sheetnames},ensure_ascii=False))
for sheet in book:
    rows=[]
    for index,row in enumerate(sheet.iter_rows(min_row=1,max_row=12,max_col=min(sheet.max_column or 1,25),values_only=True),1):
        values=[{'col':i+1,'v':str(v)[:150]} for i,v in enumerate(row) if v is not None]
        if values: rows.append({'row':index,'cells':values})
    print(json.dumps({'sheet':sheet.title,'rows':sheet.max_row,'cols':sheet.max_column,'preview':rows},ensure_ascii=False))
book.close()
