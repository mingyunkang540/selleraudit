import argparse,hashlib,json,re,math
from collections import defaultdict
from datetime import date,datetime
from pathlib import Path
import openpyxl
from openpyxl.utils.cell import column_index_from_string

parser=argparse.ArgumentParser()
parser.add_argument('--source',required=True)
parser.add_argument('--workspace',required=True)
parser.add_argument('--as-of',required=True,help='ISO date or auto')
parser.add_argument('--output',required=True)
args=parser.parse_args()
source=Path(args.source)
digest=hashlib.sha256(source.read_bytes()).hexdigest()
values=openpyxl.load_workbook(source,read_only=True,data_only=True)
formulas=openpyxl.load_workbook(source,read_only=True,data_only=False)
if args.as_of=='auto':
 candidates=[]
 for name in values.sheetnames:
  if not re.fullmatch(r'\d{2}년\d{1,2}월 매출',name):continue
  rows=values[name].iter_rows(values_only=True)
  header=None
  for row in rows:
   if '구분' in row and '합계' in row:header=row;break
  if header is None:continue
  date_col=header.index('구분');total_col=header.index('합계')
  for row in rows:
   mark=row[date_col] if len(row)>date_col else None
   day=mark.date() if isinstance(mark,datetime) else mark
   total=row[total_col] if len(row)>total_col else None
   if isinstance(day,date) and day<=date.today() and isinstance(total,(int,float)) and not isinstance(total,bool) and total!=0:candidates.append(day)
 if not candidates:raise ValueError('No dated sales found')
 asof=max(candidates)
else:asof=date.fromisoformat(args.as_of)
# Only explicitly tagged, dated events can be assigned to a channel.
event_range=re.compile(r'(\d{1,2})/(\d{1,2})\s*[~～-]\s*(?:(\d{1,2})/)?(\d{1,2})')
def event_channels(note,day,channel_names):
 if not isinstance(note,str):return set()
 matches=list(event_range.finditer(note)); active=set()
 for index,match in enumerate(matches):
  text=note[match.end():matches[index+1].start() if index+1<len(matches) else len(note)]
  tags=re.findall(r'\(([^()]*)\)',text)
  names={name for tag in tags for name in channel_names if tag.strip()==name}
  for year in (day.year-1,day.year,day.year+1):
   try:
    end_month=int(match[3] or match[1]);start=date(year,int(match[1]),int(match[2]));end=date(year+(end_month<int(match[1])),end_month,int(match[4]))
   except ValueError:continue
   if start<=day<=end:
    active.add(next(iter(names)) if len(names)==1 else None)
 return active

def raw_group_buy(workbook):
 if '로우데이터' not in workbook:return {}
 rows=workbook['로우데이터'].iter_rows(values_only=True)
 header=next(rows,None)
 if not header or '공동구매 여부' not in header:return {}
 required=['주문일자','쇼핑몰명','결제금액','공동구매 여부']
 if any(header.count(name)!=1 for name in required):raise ValueError('Invalid raw group-buy headers')
 indices=[header.index(name) for name in required]
 grouped=defaultdict(lambda:defaultdict(float))
 for row in rows:
  day,channel,amount,marker=[row[i] if i<len(row) else None for i in indices]
  if marker is None or not str(marker).strip():continue
  if str(marker).strip()!='공동구매':raise ValueError('Unknown group-buy marker')
  if isinstance(day,datetime):day=day.date()
  elif isinstance(day,str):
   try:day=date.fromisoformat(day.strip()[:10])
   except ValueError:raise ValueError('Invalid group-buy date')
  if not isinstance(day,date) or not isinstance(channel,str) or not channel.strip():raise ValueError('Missing group-buy date or channel')
  if isinstance(amount,str):
   try:amount=float(amount.strip().replace(',',''))
   except ValueError:raise ValueError('Invalid group-buy amount')
  if isinstance(amount,bool) or not isinstance(amount,(int,float)) or not math.isfinite(amount):raise ValueError('Invalid group-buy amount')
  grouped[day.isoformat()][channel.strip()]+=amount
 return dict(grouped)

days=[];warnings=[];month_data=[]
raw_groups=raw_group_buy(values)
sheet_specs=[]
for name in values.sheetnames:
 match=re.fullmatch(r'(\d{2})년(\d{1,2})월 매출',name)
 if match:
  year=2000+int(match.group(1));month=int(match.group(2))
  if 1<=month<=12 and (year,month)<=(asof.year,asof.month):sheet_specs.append((year,month,name))
sheet_specs.sort()
for year,month,name in sheet_specs:
 sheet=values[name];fsh=formulas[name]
 cached=list(sheet.iter_rows(values_only=True));formula=list(fsh.iter_rows(values_only=True))
 header_index=next((i for i,row in enumerate(cached[:15]) if '구분' in row and '합계' in row),None)
 if header_index is None:raise ValueError(f'Header missing: {name}')
 header=cached[header_index];date_col=header.index('구분');total_col=header.index('합계')
 month_days=[];summary=None
 for index,row in enumerate(cached):
  mark=row[date_col] if len(row)>date_col else None
  if mark==f'{year}년 매출':summary=row[total_col]
  day=mark.date() if isinstance(mark,datetime) else mark
  if not isinstance(day,date) or day.year!=year or day.month!=month or day>asof:continue
  expression=formula[index][total_col] if total_col<len(formula[index]) else None
  match=re.fullmatch(r'=SUM\(([A-Z]+)\d+:([A-Z]+)\d+\)',str(expression),re.I)
  if not match:raise ValueError(f'Unsupported total formula: {name} row {index+1}')
  first,last=(column_index_from_string(x)-1 for x in match.groups())
  channels={}
  for col in range(first,last+1):
   label=header[col] if col<len(header) else None
   if not isinstance(label,str) or not label.strip():raise ValueError(f'Missing channel header: {name} {col+1}')
   if label.strip() in channels:raise ValueError(f'Duplicate channel: {name}')
   value=row[col] if col<len(row) else None
   if value is not None and (isinstance(value,bool) or not isinstance(value,(int,float))):raise ValueError(f'Invalid channel value: {name} row {index+1}')
   channels[label.strip()]=value
  total=row[total_col]
  if isinstance(total,bool) or not isinstance(total,(int,float)):raise ValueError(f'Missing cached daily total: {name} row {index+1}')
  computed=sum(v for v in channels.values() if v is not None)
  if abs(computed-total)>0.01:warnings.append({'type':'DAILY_MISMATCH','sheet':name,'row':index+1,'date':day.isoformat(),'cached':total,'calculated':computed})
  group_labels=['땡스공구','그 외 공구']
  group_indices=[i for i,label in enumerate(header) if isinstance(label,str) and label.strip() in group_labels]
  if len(group_indices)!=len(set(header[i].strip() for i in group_indices)):raise ValueError(f'Duplicate group-buy header: {name}')
  group_values=[];group_channels={};attribution_valid=True
  for col in group_indices:
   value=row[col] if col<len(row) else None
   if value is not None and (isinstance(value,bool) or not isinstance(value,(int,float))):raise ValueError(f'Invalid group-buy value: {name} row {index+1}')
   group_values.append(value or 0)
   if value:
    note=cached[14][col] if len(cached)>14 and col<len(cached[14]) else None
    active=event_channels(note,day,channels.keys())
    if len(active)!=1 or None in active:attribution_valid=False
    else:
     channel=next(iter(active));group_channels[channel]=group_channels.get(channel,0)+value
  # Blank cells are unrecorded entries; an absent column is tracked separately.
  group_buy=sum(group_values) if group_indices and all(not first<=i<=last for i in group_indices) else None
  if group_buy is None or any(amount<0 or not isinstance(channels.get(channel),(int,float)) or amount>channels[channel] for channel,amount in group_channels.items()):attribution_valid=False
  partial=len(group_indices)<len(group_labels)
  raw=raw_groups.get(day.isoformat())
  if raw is not None:
   raw_total=sum(raw.values())
   if group_buy is not None and abs(raw_total-group_buy)>0.01:
    warnings.append({'type':'GROUP_BUY_SOURCE_MISMATCH','date':day.isoformat(),'sheet':name,'raw':raw_total,'monthly':group_buy})
    partial=True
   group_buy=raw_total
   attribution_valid=all(isinstance(channels.get(channel),(int,float)) and not isinstance(channels.get(channel),bool) and amount>=0 and amount<=channels[channel] for channel,amount in raw.items())
   if raw_total<0 or raw_total>total:
    warnings.append({'type':'INVALID_RAW_GROUP_BUY','date':day.isoformat(),'sheet':name})
    group_buy=None;attribution_valid=False
   group_channels=dict(raw)
  month_days.append({'date':day.isoformat(),'total':total,'channels':channels,'sourceRow':index+1,'groupBuy':group_buy,'groupBuyPartial':partial,'groupBuyChannels':group_channels if attribution_valid else None})
 month_days.sort(key=lambda x:x['date']);days.extend(month_days)
 actual=sum(d['total'] for d in month_days)
 if isinstance(summary,(int,float)) and abs(summary-actual)>0.01:warnings.append({'type':'MONTH_SUMMARY_MISMATCH','sheet':name,'cached':summary,'calculated':actual})
 month_data.append({'month':f'{year}-{month:02d}','sourceSheet':name,'summaryCached':summary,'dailyTotal':actual,'days':len(month_days)})
days.sort(key=lambda x:x['date'])
if not days or len({d['date'] for d in days})!=len(days) or days[-1]['date']!=asof.isoformat():raise ValueError('Date coverage unavailable or duplicate')
result={'schemaVersion':1,'parserVersion':4,'sourceName':source.name,'sourceSha256':digest,'asOf':asof.isoformat(),'days':days,'months':month_data,'warnings':warnings}
values.close();formulas.close()
Path(args.output).write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf8')
print(json.dumps({'asOf':args.as_of,'days':len(days),'months':len(month_data),'warnings':warnings,'sourceSha256':digest,'total':sum(d['total'] for d in days)},ensure_ascii=False))
