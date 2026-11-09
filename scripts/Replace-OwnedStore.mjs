import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import process from 'node:process'
import {log} from 'node:console'
import pg from 'pg'
import {parseOwnedStoreItems} from './owned-store-replacement-plan.mjs'
import {replaceOwnedStore} from './owned-store-replacement-transaction.mjs'

const expectedHash='44a6f2ef8db27f2183b035f7f4fb21d692eb5a2b0d2a65d94c21eb36117cc31d'
const sourcePath=resolve('sample/자사몰 기본양식.csv')
const source=await readFile(sourcePath)
const hash=createHash('sha256').update(source).digest('hex')
if(hash!==expectedHash)throw new Error('파일이 준비 당시와 달라졌습니다. 실행을 중단했습니다.')
const groups=parseOwnedStoreItems(source)
if(groups.length!==269 || groups.reduce((n,g)=>n+g.items.length,0)!==698)throw new Error('예상한 상품 또는 품목 수가 아닙니다.')
let input='';for await(const chunk of process.stdin)input+=chunk
const {password}=JSON.parse(input)
if(typeof password!=='string'||!password)throw new Error('DB 인증이 필요합니다.')
const pool=new pg.Pool({host:'127.0.0.1',port:5432,database:'selleraudit_local',user:'postgres',password,max:1,connectionTimeoutMillis:5000})
const db=await pool.connect()
try {
 const result=await replaceOwnedStore(db,groups,source,hash,resolve('../SellerAudit-data'))
 log('등록 완료: '+JSON.stringify(result))
}finally{db.release();await pool.end()}
