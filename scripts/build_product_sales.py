import argparse, collections, datetime, hashlib, json, math
from pathlib import Path
import openpyxl

parser=argparse.ArgumentParser()
parser.add_argument('--source',required=True)
parser.add_argument('--output',required=True)
args=parser.parse_args()
source=Path(args.source)
digest=hashlib.sha256(source.read_bytes()).hexdigest()
workbook=openpyxl.load_workbook(source,read_only=True,data_only=True)
sheet=workbook['로우데이터']
rows=sheet.iter_rows(values_only=True)
header=next(rows)
required=['주문일자','쇼핑몰명','수량','상품명(매칭)','색상(매칭)','구성구분','결제금액']
if any(field not in header for field in required): raise ValueError('Missing raw data fields')
indices=[header.index(field) for field in required]
groups=collections.defaultdict(lambda:[0,0,0,0])
skipped=collections.Counter()
for row in rows:
 if not any(value is not None for value in row[:len(header)]): continue
 values=[row[i] if i<len(row) else None for i in indices]
 day,channel,quantity,name,color,category,money=values
 if isinstance(day,datetime.datetime):day=day.date()
 elif isinstance(day,str):
  try:day=datetime.date.fromisoformat(day.strip())
  except ValueError:day=None
 if not isinstance(day,datetime.date):skipped['invalidDate']+=1;continue
 if isinstance(quantity,bool) or not isinstance(quantity,(int,float)) or not math.isfinite(quantity):skipped['invalidQuantity']+=1;continue
 def clean(value,default):
  if value is None:return default
  text=str(value).strip()
  return default if not text or text.startswith('#') else text
 category=clean(category,'매칭필요')
 if category not in ('단품','단품세트','세트구성','구성품'):category='매칭필요'
 key=(day.isoformat(),clean(channel,'채널 미확인'),category,clean(name,'상품 미확인'),clean(color,'색상 미확인'))
 if isinstance(money,str):
  try:money=float(money.strip().replace(',',''))
  except ValueError:money=None
 valid_money=not isinstance(money,bool) and isinstance(money,(int,float)) and math.isfinite(money)
 groups[key][0]+=quantity;groups[key][1]+=1
 if valid_money:groups[key][2]+=money
 else:groups[key][3]+=1;skipped['invalidAmount']+=1
workbook.close()
result={'schemaVersion':1,'parserVersion':2,'sourceSha256':digest,'sourceName':source.name,'skipped':dict(skipped),'rows':[{'date':key[0],'channel':key[1],'category':key[2],'product':key[3],'color':key[4],'quantity':value[0],'sourceRows':value[1],'amount':value[2] if value[3]==0 else None} for key,value in sorted(groups.items())]}
Path(args.output).write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf8')
