import ast
import collections
import datetime
import math
import openpyxl
import re
import unittest
from datetime import date
from pathlib import Path

# Load the attribution helper without executing the snapshot-building CLI.
source = Path('scripts/build_sales_snapshot.py').read_text(encoding='utf8')
tree = ast.parse(source)
helper = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'event_channels')
namespace = {'re': re, 'date': date, 'event_range': re.compile(r'(\d{1,2})/(\d{1,2})\s*[~～-]\s*(?:(\d{1,2})/)?(\d{1,2})')}
exec(compile(ast.Module(body=[helper], type_ignores=[]), '<helper>', 'exec'), namespace)
event_channels = namespace['event_channels']
raw_helper = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'raw_group_buy')
exec(compile(ast.Module(body=[raw_helper], type_ignores=[]), '<raw_helper>', 'exec'), {'defaultdict':collections.defaultdict,'datetime':datetime.datetime,'date':date,'math':math}, namespace)
raw_group_buy = namespace['raw_group_buy']

class AttributionTest(unittest.TestCase):
 def test_dates_and_channels(self):
  note='10/29~11/4\n베러심플(자사몰)\n11/19~11/26\n요정엄마(컬리)'
  self.assertEqual(event_channels(note, date(2026,11,2), ['자사몰','컬리']), {'자사몰'})
  self.assertEqual(event_channels(note, date(2026,11,20), ['자사몰','컬리']), {'컬리'})
  self.assertEqual(event_channels(note, date(2026,11,10), ['자사몰','컬리']), set())
 def test_overlap_and_unknown_remain_ambiguous(self):
  note='11/1~11/3 행사(자사몰)\n11/2~11/4 행사(컬리)'
  self.assertEqual(event_channels(note, date(2026,11,2), ['자사몰','컬리']), {'자사몰','컬리'})
  self.assertEqual(event_channels('11/1~11/3 행사', date(2026,11,2), ['자사몰']), {None})
 def test_same_month_short_range_and_separate_events(self):
  note='08/04~08/09 행사(우리의식탁)\n8/18-23 행사(자사몰)'
  self.assertEqual(event_channels(note, date(2026,8,4), ['우리의식탁','자사몰']), {'우리의식탁'})
  self.assertEqual(event_channels(note, date(2026,8,18), ['우리의식탁','자사몰']), {'자사몰'})
  self.assertEqual(event_channels(note, date(2026,8,24), ['우리의식탁','자사몰']), set())
 def test_year_boundary(self):
  self.assertEqual(event_channels('12/30~1/3 행사(자사몰)', date(2027,1,1), ['자사몰']), {'자사몰'})
 def test_raw_group_buy_uses_marked_rows_and_preserves_channels(self):
  book=openpyxl.Workbook();sheet=book.active;sheet.title='로우데이터'
  sheet.append(['주문일자','쇼핑몰명','결제금액','공동구매 여부'])
  sheet.append([datetime.datetime(2026,11,1),'자사몰',10000,'공동구매'])
  sheet.append(['2026-11-01','컬리',3000,'공동구매'])
  sheet.append(['2026-11-01','자사몰',-1000,'공동구매'])
  sheet.append(['2026-11-01','자사몰',8000,None])
  self.assertEqual(raw_group_buy(book),{'2026-11-01':{'자사몰':9000,'컬리':3000}})
 def test_invalid_marked_rows_are_not_silently_dropped(self):
  book=openpyxl.Workbook();sheet=book.active;sheet.title='로우데이터'
  sheet.append(['주문일자','쇼핑몰명','결제금액','공동구매 여부'])
  sheet.append(['2026-11-01','자사몰',None,'공동구매'])
  with self.assertRaises(ValueError):raw_group_buy(book)

if __name__ == '__main__': unittest.main()
