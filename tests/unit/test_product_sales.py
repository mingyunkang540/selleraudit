import datetime,json,subprocess,sys,tempfile,unittest
from pathlib import Path
import openpyxl

class ProductSalesTest(unittest.TestCase):
 def test_source_rows_are_grouped_without_losing_unknowns_or_returns(self):
  with tempfile.TemporaryDirectory() as directory:
   source=Path(directory)/'source.xlsx';output=Path(directory)/'output.json'
   book=openpyxl.Workbook();sheet=book.active;sheet.title='로우데이터'
   sheet.append(['주문일자','쇼핑몰명','수량','상품명(매칭)','색상(매칭)','구성구분','결제금액'])
   sheet.append([datetime.datetime(2026,1,1),'자사몰',3,'5호','라벤더','단품',30000])
   sheet.append(['2026-01-01','자사몰',-1,'5호','라벤더','단품',-10000])
   sheet.append(['2026-01-02','오늘의집',2,None,None,'매칭필요',20000])
   sheet.append(['invalid','자사몰',1,'5호','핑크','단품'])
   sheet.append(['2026-01-02','자사몰','오류','5호','핑크','단품'])
   book.save(source)
   subprocess.run([sys.executable,'scripts/build_product_sales.py','--source',str(source),'--output',str(output)],check=True)
   result=json.loads(output.read_text(encoding='utf8'))
   self.assertEqual(result['skipped'],{'invalidDate':1,'invalidQuantity':1})
   self.assertEqual(result['rows'][0]['quantity'],2)
   self.assertEqual(result['rows'][0]['amount'],20000)
   self.assertEqual(result['rows'][0]['sourceRows'],2)
   self.assertEqual(result['rows'][1]['category'],'매칭필요')
   self.assertEqual(result['rows'][1]['product'],'상품 미확인')

if __name__=='__main__':unittest.main()
