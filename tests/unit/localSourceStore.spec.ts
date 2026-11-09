import { createHash,randomUUID } from 'node:crypto'
import { mkdtemp,readFile,rm } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { expect,test } from '@playwright/test'
import { storeSource } from '../../server/import/sourceStore'

test('source bytes are verified and never overwrite an existing source',async()=>{
  const root=await mkdtemp(join(tmpdir(),'seller-source-test-'))
  const rel=relative(tmpdir(),root)
  if(!rel || rel.startsWith('..') || isAbsolute(rel) || !rel.startsWith('seller-source-test-')) throw new Error('Unexpected temporary directory')
  try {
    const workspaceId=randomUUID();const sourceId=randomUUID();const bytes=Buffer.from('synthetic workbook')
    const hash=createHash('sha256').update(bytes).digest('hex')
    const args={root,workspaceId,sourceId,expectedHash:hash,expectedBytes:bytes.length}
    expect(await storeSource({...args,stream:Readable.from(bytes)})).toEqual({hash,bytes:bytes.length})
    expect(await readFile(join(root,workspaceId,sourceId,'source.xlsx'))).toEqual(bytes)
    await expect(storeSource({...args,stream:Readable.from(bytes)})).rejects.toThrow()
    const second=randomUUID()
    await expect(storeSource({...args,sourceId:second,expectedHash:'0'.repeat(64),stream:Readable.from(bytes)})).rejects.toThrow('verification')
    await expect(readFile(join(root,workspaceId,second,'source.xlsx'))).rejects.toThrow()
    await expect(storeSource({...args,workspaceId:'../outside',stream:Readable.from(bytes)})).rejects.toThrow('Invalid')
  } finally {
    await rm(root,{recursive:true,force:true})
  }
})
