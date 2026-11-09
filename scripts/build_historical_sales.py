import argparse,collections,datetime,hashlib,json,math,re
from pathlib import Path
import openpyxl

parser=argparse.ArgumentParser()
parser.add_argument('--source-dir',required=True)
parser.add_argument('--output',required=True)
args=parser.parse_args()
root=Path(args.source_dir)
files={}
for path in root.rglob('*.xlsx'):
 match=re.search(r'(24|25)년\s*(\d{2})월',path.name)
 if not match or path.name.startswith('~$'):continue
 key=(2000+int(match[1]),int(match[2]))
 if key in files:raise ValueError(f'Duplicate monthly file: {key}')
 files[key]=path
expected={(year,month) for year in (2024,2025) for month in range(1,13)}
if set(files)!=expected:raise ValueError(f'Missing or unexpected months: {sorted(expected-set(files))} {sorted(set(files)-expected)}')
products=collections.defaultdict(lambda:[0,0,0])
days=collections.defaultdict(lambda:collections.defaultdict(float))
reports=[]
for (year,month),path in sorted(files.items()):
 before=path.stat();digest=hashlib.sha256(path.read_bytes()).hexdigest()
 workbook=openpyxl.load_workbook(path,read_only=True,data_only=True)
 if '로우데이터' not in workbook:raise ValueError(f'Missing raw sheet: {path.name}')
 rows=workbook['로우데이터'].iter_rows(values_only=True);header=next(rows)
 required=['주문일자','쇼핑몰명','수량','결제금액','상품명(매칭)','색상(매칭)']
 if any(field not in header for field in required):raise ValueError(f'Missing columns: {path.name}')
 idx={field:header.index(field) for field in required}
 category_index=header.index('구성구분') if '구성구분' in header else None
 row_count=0;qty_sum=0;money_sum=0;text_amounts=0
 for row in rows:
  if not any(v is not None for v in row[:len(header)]):continue
  def get(field):
   index=idx[field]
   return row[index] if index<len(row) else None
  day=get('주문일자');quantity=get('수량');money=get('결제금액')
  if isinstance(day,datetime.datetime):day=day.date()
  elif isinstance(day,str):
   try:day=datetime.date.fromisoformat(day.strip()[:10])
   except ValueError:day=None
  if not isinstance(day,datetime.date) or (day.year,day.month)!=(year,month):raise ValueError(f'Invalid or out-of-month date: {path.name}')
  if isinstance(quantity,bool) or not isinstance(quantity,(int,float)) or not math.isfinite(quantity):raise ValueError(f'Invalid quantity: {path.name}')
  if isinstance(money,str):
   text=money.strip().replace(',','')
   if not re.fullmatch(r'[+-]?\d+(?:\.\d+)?',text):raise ValueError(f'Invalid amount: {path.name}')
   money=float(text);text_amounts+=1
  if isinstance(money,bool) or not isinstance(money,(int,float)) or not math.isfinite(money):raise ValueError(f'Invalid amount: {path.name}')
  def clean(value,default):
   if value is None:return default
   text=str(value).strip()
   return default if not text or text.startswith('#') else text
  channel=clean(get('쇼핑몰명'),'채널 미확인');name=clean(get('상품명(매칭)'),'상품 미확인');color=clean(get('색상(매칭)'),'색상 미확인')
  category='구분 미입력' if category_index is None else clean(row[category_index] if category_index<len(row) else None,'매칭필요')
  if category not in ('단품','단품세트','세트구성','구성품','구분 미입력'):category='매칭필요'
  key=(day.isoformat(),channel,category,name,color);products[key][0]+=quantity;products[key][1]+=1;products[key][2]+=money
  days[day.isoformat()][channel]+=money;row_count+=1;qty_sum+=quantity;money_sum+=money
 workbook.close();after=path.stat()
 if before.st_size!=after.st_size or before.st_mtime_ns!=after.st_mtime_ns or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:raise ValueError(f'Source changed: {path.name}')
 reports.append({'month':f'{year}-{month:02d}','file':path.name,'sha256':digest,'rows':row_count,'quantity':qty_sum,'amount':money_sum,'numericTextAmounts':text_amounts,'categoryAvailable':category_index is not None})
sales=[{'date':date,'total':sum(channels.values()),'channels':dict(channels),'sourceRow':0,'groupBuy':None,'groupBuyPartial':True} for date,channels in sorted(days.items())]
product_rows=[{'date':key[0],'channel':key[1],'category':key[2],'product':key[3],'color':key[4],'quantity':value[0],'sourceRows':value[1],'amount':value[2]} for key,value in sorted(products.items())]
result={'schemaVersion':1,'source':'2024·2025 월별 로우데이터','files':reports,'days':sales,'productRows':product_rows}
Path(args.output).write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf8')
print(json.dumps({'files':len(reports),'sourceRows':sum(x['rows'] for x in reports),'productGroups':len(product_rows),'days':len(sales),'numericTextAmounts':sum(x['numericTextAmounts'] for x in reports)},ensure_ascii=True))
