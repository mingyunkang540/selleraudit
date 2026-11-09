import {test,expect} from '@playwright/test'
import {createServer as httpServer} from 'node:http'
import {request as httpsRequest} from 'node:https'
import {networkInterfaces,tmpdir} from 'node:os'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {execFileSync,spawn} from 'node:child_process'
import {join} from 'node:path'
import type {AddressInfo} from 'node:net'

test('shared HTTPS requires login mode, blocks cross-origin requests and secures session cookies',async()=>{
 const address=Object.values(networkInterfaces()).flat().find(item=>item?.family==='IPv4'&&!item.internal)?.address
 test.skip(!address||process.platform!=='win32','A Windows LAN address and Git OpenSSL are required')
 const dir=await mkdtemp(join(tmpdir(),'seller-lan-test-')),cert=join(dir,'cert.pem'),key=join(dir,'key.pem')
 let open=false
 const backend=httpServer((req,res)=>{
  if(req.url==='/api/auth/session'&&!req.headers.cookie){res.writeHead(open?200:401).end();return}
  if(req.url==='/api/auth/login'){res.writeHead(200,{'Set-Cookie':'session=test; HttpOnly; SameSite=Strict'}).end('ok');return}
  res.writeHead(200).end('ok')
 })
 await new Promise<void>(resolve=>backend.listen(0,'127.0.0.1',resolve))
 const backendPort=(backend.address() as AddressInfo).port
 let proxy:ReturnType<typeof spawn>|undefined
 try{
  execFileSync('C:\\Program Files\\Git\\usr\\bin\\openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=SellerAudit test','-addext',`subjectAltName=IP:${address}`],{stdio:'ignore'})
  const port=25443,host=`${address}:${port}`,origin=`https://${host}`,ca=await readFile(cert)
  proxy=spawn(process.execPath,['server/lanProxy.mjs'],{cwd:process.cwd(),env:{...process.env,SELLERAUDIT_LAN_ADDRESS:address!,SELLERAUDIT_LAN_PORT:String(port),SELLERAUDIT_LAN_BACKEND_PORT:String(backendPort),SELLERAUDIT_LAN_CERT:cert,SELLERAUDIT_LAN_KEY:key,SELLERAUDIT_LOCAL_PARENT_PID:''},stdio:['ignore','pipe','pipe']})
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Proxy startup timed out')),10000);proxy!.stdout!.once('data',()=>{clearTimeout(timer);resolve()});proxy!.once('exit',()=>{clearTimeout(timer);reject(new Error('Proxy exited'))})})
  const call=(path:string,method='GET',headers:Record<string,string>={})=>new Promise<{status:number;cookie:string}>((resolve,reject)=>{const req=httpsRequest({hostname:address,port,path,method,ca,headers:{host,...headers}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode!,cookie:String(res.headers['set-cookie']||'')}))});req.on('error',reject);req.end()})
  expect((await call('/')).status).toBe(200)
  expect((await call('/api/auth/session')).status).toBe(401)
  expect((await call('/api/auth/login','POST',{origin:'https://evil.example'})).status).toBe(403)
  const login=await call('/api/auth/login','POST',{origin})
  expect(login.status).toBe(200);expect(login.cookie).toContain('Secure')
  open=true
  expect((await call('/api/auth/login','POST',{origin})).status).toBe(503)
 }finally{proxy?.kill();await new Promise<void>(resolve=>backend.close(()=>resolve()));await rm(dir,{recursive:true,force:true})}
})
