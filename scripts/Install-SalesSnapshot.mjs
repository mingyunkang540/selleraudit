/* global fetch,console,process */
import {readFile,writeFile,mkdir,realpath,copyFile} from 'node:fs/promises'
import {constants} from 'node:fs'
import {createHash} from 'node:crypto'
import {join,resolve} from 'node:path'
import {homedir} from 'node:os'
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const sessionResponse=await fetch('http://127.0.0.1:4179/api/auth/session')
if(!sessionResponse.ok)throw Error('Session unavailable')
const session=await sessionResponse.json();if(!session.openMode||session.user?.role!=='ADMIN'||!/^[0-9a-f-]{36}$/i.test(session.user.workspaceId))throw Error('Administrator unavailable')
const root=await realpath(resolve('../SellerAudit-data')),workspace=join(root,session.user.workspaceId),actual=await realpath(workspace)
if(process.platform==='win32'?actual.toLowerCase()!==workspace.toLowerCase():actual!==workspace)throw Error('Invalid workspace')
const stage=await readFile('../outputs/sales-snapshot-staging.json'),snapshot=JSON.parse(stage),source=join(homedir(),'Desktop','★2026년 땡스소윤 매출 데이터.xlsx'),bytes=await readFile(source)
if(snapshot.schemaVersion!==1||snapshot.asOf!=='2026-11-02'||sha(bytes)!==snapshot.sourceSha256)throw Error('Source or snapshot changed')
const sources=join(actual,'sales-sources');await mkdir(sources,{recursive:true});if((await realpath(sources)).toLowerCase()!==sources.toLowerCase())throw Error('Invalid sources directory')
const copy=join(sources,`${snapshot.sourceSha256}.xlsx`)
try{await copyFile(source,copy,constants.COPYFILE_EXCL)}catch(e){if(e.code!=='EEXIST'||sha(await readFile(copy))!==snapshot.sourceSha256)throw e}
if(sha(await readFile(copy))!==snapshot.sourceSha256)throw Error('Source copy mismatch')
const destination=join(actual,'sales-dashboard.json')
try{await writeFile(destination,stage,{flag:'wx'})}catch(e){if(e.code!=='EEXIST'||sha(await readFile(destination))!==sha(stage))throw e}
console.log(JSON.stringify({status:'installed',days:snapshot.days.length,asOf:snapshot.asOf,warnings:snapshot.warnings.length}))
