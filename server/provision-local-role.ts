import { createPool } from './db.ts'

let input = ''
for await (const chunk of process.stdin) {
  input += chunk.toString()
  if (input.length > 4096) throw new Error('Input too large')
}
const pool = createPool()
try {
  const data: unknown = JSON.parse(input)
  if (!data || typeof data !== 'object' || !('password' in data) || typeof data.password !== 'string' || data.password.length < 10 || Buffer.byteLength(data.password, 'utf8') > 1024) throw new Error('Invalid role password')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query("SELECT 1 FROM pg_roles WHERE rolname='selleraudit_app'")
    if (existing.rowCount) throw new Error('Role already exists')
    const literal = await client.query<{ value: string }>('SELECT quote_literal($1::text) AS value', [data.password])
    await client.query(`CREATE ROLE selleraudit_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD ${literal.rows[0].value}`)
    await client.query('GRANT CONNECT ON DATABASE selleraudit_local TO selleraudit_app')
    await client.query('GRANT USAGE ON SCHEMA seller_audit_local TO selleraudit_app')
    await client.query('GRANT SELECT ON ALL TABLES IN SCHEMA seller_audit_local TO selleraudit_app')
    await client.query(`GRANT INSERT, UPDATE ON seller_audit_local.app_users, seller_audit_local.workspace_members,
      seller_audit_local.user_sessions, seller_audit_local.setup_tokens, seller_audit_local.import_source_files,
      seller_audit_local.import_batches, seller_audit_local.raw_import_rows, seller_audit_local.import_candidates,
      seller_audit_local.import_validation_issues, seller_audit_local.activity_logs, seller_audit_local.products,
      seller_audit_local.skus, seller_audit_local.product_components, seller_audit_local.channels, seller_audit_local.channel_listings, seller_audit_local.channel_offers,
      seller_audit_local.audit_issues, seller_audit_local.aliases, seller_audit_local.unlisted_bundles,
      seller_audit_local.unlisted_bundle_components, seller_audit_local.market_collections,
      seller_audit_local.market_collection_options, seller_audit_local.sku_assembly_components,
      seller_audit_local.product_channel_variants, seller_audit_local.product_channel_variant_components TO selleraudit_app`)
    await client.query('GRANT DELETE ON seller_audit_local.aliases TO selleraudit_app')
    await client.query('GRANT SELECT, INSERT, UPDATE ON seller_audit_local.product_configurations, seller_audit_local.product_configuration_components, seller_audit_local.offer_configurations TO selleraudit_app')
    await client.query('GRANT DELETE ON seller_audit_local.product_configuration_components, seller_audit_local.offer_configurations TO selleraudit_app')
    await client.query('GRANT SELECT, INSERT, UPDATE ON seller_audit_local.product_manual_prices TO selleraudit_app')
    await client.query('GRANT DELETE ON seller_audit_local.product_components TO selleraudit_app')
    await client.query('GRANT UPDATE ON seller_audit_local.workspaces TO selleraudit_app')
    await client.query('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA seller_audit_local TO selleraudit_app')
    await client.query('COMMIT')
    console.log('Local application database role created.')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
} catch (error) {
  const allowed = ['Invalid role password', 'Role already exists']
  console.error(`Local role setup failed: ${error instanceof Error && allowed.includes(error.message) ? error.message : 'Database connection or permissions error.'}`)
  process.exitCode = 1
} finally { await pool.end() }
