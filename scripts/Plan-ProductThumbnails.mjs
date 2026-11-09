/* global fetch,console,process */
import {readdir,mkdir,copyFile,writeFile} from 'node:fs/promises'
import {join,relative,parse} from 'node:path'
const root=join(process.cwd(),'..','SellerAudit-data','썸네일')
const files=[]
async function walk(dir){for(const ent of await readdir(dir,{withFileTypes:true})){const path=join(dir,ent.name);if(ent.isDirectory()&&!ent.isSymbolicLink())await walk(path);else if(ent.isFile()&&/\.(jpe?g|png)$/i.test(ent.name))files.push(path)}}
await walk(root)
const normalize=s=>s.normalize('NFC').toLowerCase().replace(/\([^)]*\d+\s*ml\)/gi,'').replace(/\s*\d+\s*ml/gi,'').replace(/(?:^|[_\s-])[lgp](?=$|[_\s-])/gi,'').replace(/(\d+개)세트$/,'$1').replace(/[\s_-]/g,'')
const candidates=new Map()
for(const file of files){const stem=parse(file).name;if(/\(구\)|견출지|색상랜덤/.test(stem))continue;const key=normalize(stem);if(!candidates.has(key))candidates.set(key,[]);candidates.get(key).push(file)}
const response=await fetch('http://127.0.0.1:4179/api/data');if(!response.ok)throw Error('Product data unavailable')
const data=await response.json(),matches=[]
for(const product of data.products){
 const paths=candidates.get(normalize(product.productName))??[]
 if(!paths.length)continue
 const lavender=paths.filter(p=>/(?:^|[_\s-])L(?:\.|[_\s-])/i.test(parse(p).base)||p.includes('라벤더'))
 const choices=lavender.length?lavender:paths
 if(choices.length!==1)continue
 matches.push({id:product.id,name:product.productName,code:product.sabangnetCode,file:relative(root,choices[0])})
}
if(process.argv.includes('--apply')){
 const destination=join(process.cwd(),'public','product-thumbnails')
 await mkdir(destination,{recursive:true})
 const manifest={}
 for(const match of matches){
  const source=join(root,match.file),extension=parse(source).ext.toLowerCase().replace('.jpeg','.jpg')
  const filename=`${match.id}${extension}`
  await copyFile(source,join(destination,filename));manifest[match.id]=`/product-thumbnails/${filename}`
 }
 await writeFile(join(process.cwd(),'src','features','products','productThumbnailManifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8')
}
console.log(JSON.stringify({files:files.length,count:matches.length,matches},null,2))
