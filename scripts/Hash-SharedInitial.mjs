import process from 'node:process'
import {hashPassword} from '../server/auth/crypto.ts'
let input='';for await(const chunk of process.stdin)input+=chunk
const {password}=JSON.parse(input)
if(typeof password!=='string')throw new Error('Invalid password')
process.stdout.write(await hashPassword(password))
