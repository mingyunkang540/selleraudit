import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import { expect, test } from '@playwright/test'
import { createApp } from '../../server/app'
import { bootstrapAdmin } from '../../server/auth/service'
import {hashPassword} from '../../server/auth/crypto'

test('local HTTP authorization rejects cross-origin, missing CSRF and non-admin mutations', async () => {
  const db=new PGlite()
  try {
    await db.exec('CREATE SCHEMA seller_audit_local')
    for (const name of ['0001_foundation.sql','0002_local_business_tables.sql','0003_local_identity.sql']) await db.exec(await readFile(new URL(`../../server/migrations/${name}`,import.meta.url),'utf8'))
    const pool={query:(sql:string,params?:unknown[])=>db.query(sql,params),connect:async()=>({query:(sql:string,params?:unknown[])=>db.query(sql,params),release:()=>{}})} as unknown as Pool
    await bootstrapAdmin(pool,{email:'admin@example.com',displayName:'Admin',password:'test admin password'})
    const app=createApp(async()=>{},pool)
    try {
      const good={host:'127.0.0.1:5174',origin:'http://127.0.0.1:5174'}
      const evil=await app.inject({method:'POST',url:'/api/auth/login',headers:{...good,origin:'http://evil.example'},payload:{email:'admin@example.com',password:'test admin password'}})
      expect(evil.statusCode).toBe(403)
      const signed=await app.inject({method:'POST',url:'/api/auth/login',headers:good,payload:{email:'admin@example.com',password:'test admin password'}})
      expect(signed.statusCode).toBe(200)
      expect(signed.headers['set-cookie']).toContain('HttpOnly')
      const cookie=signed.headers['set-cookie']!.toString().split(';')[0]
      const session=await app.inject({method:'GET',url:'/api/auth/session',headers:{host:good.host,cookie}})
      expect(session.statusCode).toBe(200)
      const csrf=session.json().csrf as string
      const secondTab=await app.inject({method:'GET',url:'/api/auth/session',headers:{host:good.host,cookie}})
      expect(secondTab.json().csrf).toBe(csrf)
      const payload={email:'editor@example.com',displayName:'Editor',role:'EDITOR'}
      expect((await app.inject({method:'POST',url:'/api/employees',headers:{...good,cookie},payload})).statusCode).toBe(403)
      const invited=await app.inject({method:'POST',url:'/api/employees',headers:{...good,cookie,'x-csrf-token':csrf},payload})
      expect(invited.statusCode).toBe(200)
      const activated=await app.inject({method:'POST',url:'/api/auth/activate',headers:good,payload:{email:payload.email,code:invited.json().code,password:'test editor password'}})
      expect(activated.statusCode).toBe(200)
      const editorLogin=await app.inject({method:'POST',url:'/api/auth/login',headers:good,payload:{email:payload.email,password:'test editor password'}})
      const editorCookie=editorLogin.headers['set-cookie']!.toString().split(';')[0]
      const editorSession=await app.inject({method:'GET',url:'/api/auth/session',headers:{host:good.host,cookie:editorCookie}})
      expect((await app.inject({method:'POST',url:'/api/auth/presence',headers:{...good,cookie:editorCookie}})).statusCode).toBe(403)
      expect((await app.inject({method:'POST',url:'/api/auth/presence',headers:{...good,cookie:editorCookie,'x-csrf-token':editorSession.json().csrf},payload:{}})).statusCode).toBe(200)
      expect((await app.inject({method:'GET',url:'/api/employees',headers:{host:good.host,cookie:editorCookie}})).statusCode).toBe(403)
      const onlineList=await app.inject({method:'GET',url:'/api/employees',headers:{host:good.host,cookie}})
      expect(onlineList.json().employees.find((item:{email:string})=>item.email===payload.email).online).toBe(true)
      expect((await app.inject({method:'POST',url:'/api/auth/logout',headers:{...good,cookie:editorCookie,'x-csrf-token':editorSession.json().csrf},payload:{}})).statusCode).toBe(200)
      const offlineList=await app.inject({method:'GET',url:'/api/employees',headers:{host:good.host,cookie}})
      expect(offlineList.json().employees.find((item:{email:string})=>item.email===payload.email).online).toBe(false)
      expect((await app.inject({method:'POST',url:'/api/employees',headers:{...good,cookie:editorCookie,'x-csrf-token':editorSession.json().csrf},payload})).statusCode).toBe(403)
      process.env.SELLERAUDIT_INITIAL_PASSWORD_HASH=await hashPassword('temporary-password')
      try {
        const created=await app.inject({method:'POST',url:'/api/employees',headers:{...good,cookie,'x-csrf-token':csrf},payload:{email:'initial@example.com',displayName:'Initial',role:'EDITOR'}})
        expect(created.statusCode).toBe(200);expect(created.json()).toEqual({initialPassword:true})
        const initial=await app.inject({method:'POST',url:'/api/auth/login',headers:good,payload:{email:'initial@example.com',password:'temporary-password'}})
        expect(initial.statusCode).toBe(200)
      }finally{delete process.env.SELLERAUDIT_INITIAL_PASSWORD_HASH}
    } finally {await app.close()}
  } finally {await db.close()}
})

test('local open mode supplies an administrator session while retaining origin and CSRF checks',async()=>{
  const db=new PGlite()
  try {
    await db.exec('CREATE SCHEMA seller_audit_local')
    for(const name of ['0001_foundation.sql','0002_local_business_tables.sql','0003_local_identity.sql'])await db.exec(await readFile(new URL(`../../server/migrations/${name}`,import.meta.url),'utf8'))
    const pool={query:(sql:string,params?:unknown[])=>db.query(sql,params),connect:async()=>({query:(sql:string,params?:unknown[])=>db.query(sql,params),release:()=>{}})} as unknown as Pool
    await bootstrapAdmin(pool,{email:'admin@example.com',displayName:'Admin',password:'test admin password'})
    process.env.SELLERAUDIT_LOCAL_OPEN_MODE='YES'
    const app=createApp(async()=>{},pool)
    try {
      const headers={host:'127.0.0.1:5174',origin:'http://127.0.0.1:5174'}
      const session=await app.inject({method:'GET',url:'/api/auth/session',headers})
      expect(session.statusCode).toBe(200);expect(session.json()).toMatchObject({openMode:true,user:{role:'ADMIN',email:'admin@example.com'}})
      const payload={email:'editor@example.com',displayName:'Editor',role:'EDITOR'}
      expect((await app.inject({method:'POST',url:'/api/employees',headers,payload})).statusCode).toBe(403)
      expect((await app.inject({method:'POST',url:'/api/employees',headers:{...headers,origin:'http://evil.example','x-csrf-token':session.json().csrf},payload})).statusCode).toBe(403)
      expect((await app.inject({method:'POST',url:'/api/employees',headers:{...headers,'x-csrf-token':session.json().csrf},payload})).statusCode).toBe(200)
      expect((await app.inject({method:'GET',url:'/api/auth/session',headers:{host:'evil.example'}})).statusCode).toBe(403)
    }finally{await app.close()}
  }finally{delete process.env.SELLERAUDIT_LOCAL_OPEN_MODE;await db.close()}
})
