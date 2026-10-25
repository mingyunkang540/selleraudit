/* global process */
import { spawn } from 'node:child_process'

const child = spawn(process.execPath, [
  './node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4181', '--strictPort',
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DATA_SOURCE: 'supabase',
    VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only',
  },
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', code => process.exit(code ?? 0))
