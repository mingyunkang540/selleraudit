import openpyxl,json
from pathlib import Path
book=openpyxl.load_workbook(Path.home()/'Desktop'/'★2026년 땡스소윤 매출 데이터.xlsx',read_only=True,data_only=True)
print(json.dumps({'sheets':book.sheetnames},ensure_ascii=False))
for sheet in [book.worksheets[1],book.worksheets[2],book.worksheets[-3]]:
    print(json.dumps({'sheet':sheet.title,'dimensions':[sheet.max_row,sheet.max_column]},ensure_ascii=False))
    if sheet.max_row>1000:continue
    for n,row in enumerate(sheet.iter_rows(values_only=True),1):
        values=[{'c':i+1,'v':str(x)[:90]} for i,x in enumerate(row) if x is not None and (i<5 or i>28)]
        if values:print(json.dumps({'row':n,'cells':values},ensure_ascii=False))
book.close()
