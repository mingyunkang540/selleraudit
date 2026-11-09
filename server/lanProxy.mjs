/* global process,URL,console,setInterval,clearInterval */
import {createServer} from 'node:https'
import {request as httpRequest} from 'node:http'
import {readFile,realpath,stat} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {resolve,extname,sep} from 'node:path'
import {isIP} from 'node:net'

const address=process.env.SELLERAUDIT_LAN_ADDRESS,port=Number(process.env.SELLERAUDIT_LAN_PORT||'5443')
const backendPort=Number(process.env.SELLERAUDIT_LAN_BACKEND_PORT||'4179')
const certPath=process.env.SELLERAUDIT_LAN_CERT,keyPath=process.env.SELLERAUDIT_LAN_KEY
if(!address||isIP(address)!==4||address.startsWith('127.')||!Number.isInteger(port)||port<1024||port>65535||!Number.isInteger(backendPort)||backendPort<1024||backendPort>65535||!certPath||!keyPath)throw new Error('LAN address, port and TLS certificate are required')
const host=`${address}:${port}`,origin=`https://${host}`,root=await realpath(resolve('dist'))
const cert=await readFile(certPath),key=await readFile(keyPath)
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'}
function protectedBackend(){return new Promise(resolve=>{const req=httpRequest({host:'127.0.0.1',port:backendPort,path:'/api/auth/session',method:'GET',headers:{host:'127.0.0.1:4179'},timeout:3000},res=>{res.resume();resolve(res.statusCode===401)});req.on('timeout',()=>req.destroy());req.on('error',()=>resolve(false));req.end()})}
if(!await protectedBackend())throw new Error('Backend must be running with login enabled')
const server=createServer({key,cert,minVersion:'TLSv1.2'},async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer')
 if(req.headers.host!==host){res.writeHead(403).end();return}
 if(req.method!=='GET'&&req.method!=='HEAD'&&req.headers.origin!==origin){res.writeHead(403).end();return}
 let pathname
 try{pathname=decodeURIComponent(new URL(req.url,origin).pathname)}catch{res.writeHead(400).end();return}
 if(pathname.startsWith('/api/')){
  if(!await protectedBackend()){res.writeHead(503,{'Content-Type':'application/json'}).end('{"error":"Login mode required"}');return}
  const headers={...req.headers,host:'127.0.0.1:4179'}
  delete headers['x-forwarded-for'];delete headers['x-forwarded-host'];delete headers['x-forwarded-proto']
  if(headers.origin)headers.origin='http://127.0.0.1:4179'
  const upstream=httpRequest({host:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers},response=>{
   const resultHeaders={...response.headers}
   if(resultHeaders['set-cookie'])resultHeaders['set-cookie']=resultHeaders['set-cookie'].map(value=>/;\s*secure\b/i.test(value)?value:`${value}; Secure`)
   res.writeHead(response.statusCode||502,resultHeaders);response.pipe(res)
  })
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end()});req.pipe(upstream);return
 }
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return}
 try{
  const path=resolve(root,`.${pathname==='/'?'/index.html':pathname}`)
  if(!path.startsWith(root+sep))throw new Error('Invalid path')
  const actual=await realpath(path)
  if(!actual.startsWith(root+sep)||!(await stat(actual)).isFile())throw new Error('Invalid file')
  res.writeHead(200,{'Content-Type':types[extname(actual).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'})
  if(req.method==='HEAD')res.end();else createReadStream(actual).pipe(res)
 }catch{res.writeHead(404).end()}
})
server.listen(port,address,()=>console.log(`SellerAudit HTTPS: ${origin}`))
const parent=Number(process.env.SELLERAUDIT_LOCAL_PARENT_PID)
if(Number.isSafeInteger(parent)&&parent>0){const timer=setInterval(()=>{try{process.kill(parent,0)}catch(error){if(error.code==='ESRCH'){clearInterval(timer);server.close()}}},1000);timer.unref()}
