import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Layout, type WorkspaceAccess } from './components/Layout'
import { EmptyState, PageHeader } from './components/ui'
import { Icon } from './components/Icon'
import { Dashboard } from './features/dashboard/Dashboard'
import { SalesDashboard } from './features/sales/SalesDashboard'
import { ProductSalesAnalysis } from './features/sales/ProductSalesAnalysis'
import { ProductDetail, ProductMaster } from './features/products'
import { SkuMaster } from './features/skus'
import { ChannelMatrix } from './features/channels'
import { MappingCenter } from './features/mapping'
import { AuditCenter } from './features/audit'
import { MasterImport } from './features/import/MasterImport'
import { Login } from './features/auth/Login'
import { LocalAuth, type LocalSession } from './features/auth/LocalAuth'
import { Settings } from './pages/Settings'
import { useRoute } from './hooks/useRoute'
import { getDataSourceConfig, getSupabaseClient } from './lib/supabase'
import { canWrite, loadActiveWorkspaces, type ActiveWorkspace } from './services/auth'
import { createMockRepository } from './services/mockRepository'
import { createSupabaseRepository } from './services/supabaseRepository'
import { createImportPersistence, type ImportPersistence } from './services/importPersistence'
import { createLocalImportPersistence } from './services/localImportPersistence'
import type { SellerRepository } from './services/repository'
import type { IssueStatus, SellerData } from './types/domain'
import type {ConfigurationData,ConfigurationPrices} from './features/products/configurationTypes'
import type {ProductEditInput} from './features/products/ProductEditor'

const selectedWorkspaceKey = (userId: string) => `seller-audit:selected-workspace:${userId}`

function LoadingState({ message }: { message: string }) {
  return <div className="app-loading" role="status"><span className="loading-logo"><Icon name="layers" size={28} /></span><h1>SellerAudit</h1><p>{message}</p><span className="loading-bar" /></div>
}

function ErrorState({ message, retry, loading, hint, onLogout }: { message: string; retry?: () => void; loading?: boolean; hint?: string; onLogout?: () => void }) {
  return <div className="app-error"><Icon name="alert" size={36} /><h1>데이터를 불러오지 못했습니다</h1><p role="alert">{message}</p>{hint && <p className="muted">{hint}</p>}{retry && <button className="button button-primary" disabled={loading} onClick={retry}><Icon name="refresh" size={16} />{loading ? '확인 중…' : '다시 시도'}</button>}{onLogout && <button className="button" onClick={onLogout}>로그아웃</button>}</div>
}

function WorkspaceView({ data, repository, onData, access, importPersistence, readOnly = false }: {
  data: SellerData
  repository: SellerRepository
  onData: (data: SellerData) => void
  access?: WorkspaceAccess
  importPersistence?: ImportPersistence
  readOnly?: boolean
}) {
  const route = useRoute()
  const [configurations,setConfigurations]=useState<ConfigurationData|null>(null)
  const [configurationError,setConfigurationError]=useState(false)
  const local=access?.mode==='local'
  const refreshConfigurations=useCallback(async()=>{const response=await fetch('/api/product-configurations',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('상품 구성 옵션을 불러오지 못했습니다.');setConfigurations(await response.json() as ConfigurationData);setConfigurationError(false)},[])
  useEffect(()=>{if(!local)return;void Promise.resolve().then(refreshConfigurations).catch(()=>setConfigurationError(true))},[local,refreshConfigurations])
  const configurationWrite=async(path:string,body:object)=>{const sessionResponse=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});if(!sessionResponse.ok)throw new Error('세션을 확인하지 못했습니다.');const session=await sessionResponse.json() as {csrf:string};const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify(body)});if(!response.ok)throw new Error('저장하지 못했습니다. 입력값과 권한을 확인해 주세요.');await refreshConfigurations()}
  const path = route.split('?')[0]
  const editable = (!access || canWrite(access.role)) && !readOnly
  const onMap = async (offerId: string, productId: string) => {
    if (!editable) throw new Error('이 작업을 수행할 권한이 없습니다.')
    onData(await repository.mapOffer(offerId, productId))
    if(local)await refreshConfigurations()
  }
  const onUpdateIssue = async (issueId: string, status: IssueStatus) => {
    if (!editable) throw new Error('이 작업을 수행할 권한이 없습니다.')
    onData(await repository.updateIssueStatus(issueId, status))
  }
  const onArchiveOffer=local&&editable?async(offerId:string)=>{const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('세션을 확인할 수 없습니다.');const session=await response.json() as {csrf:string};const result=await fetch('/api/mapping/archive-unmatched',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify({offerId})});if(!result.ok)throw new Error('품목이 변경되었거나 삭제하지 못했습니다. 새로고침 후 확인해 주세요.');onData(await repository.load())}:undefined
  let page
  if (path === '/dashboard' || path === '/') page = <Dashboard data={data} local={local} configurationData={configurations} configurationError={configurationError} />
  else if (path === '/sales') page = <SalesDashboard local={local} />
  else if (path === '/product-sales') page = <ProductSalesAnalysis local={local} />
  else if (path === '/products') page = <ProductMaster data={data} local={local} readOnly={!editable} onSaveProduct={local&&editable?async (input:ProductEditInput)=>{const s=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});if(!s.ok)throw new Error('세션을 확인하지 못했습니다.');const session=await s.json() as {csrf:string};const response=await fetch('/api/product-master',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify(input)});if(!response.ok)throw new Error('상품을 저장하지 못했습니다. 품번 중복 여부를 확인하고 새로고침해 주세요.');onData(await repository.load())}:undefined} />
  else if (path.startsWith('/products/')) page = <ProductDetail key={path} data={data} productId={path.slice('/products/'.length)} local={local} readOnly={!editable} configurations={configurations?.configurations??[]} configurationData={configurations} configurationError={configurationError} onSaveConfiguration={async (input:{id?:string;productId:string;name:string;prices:ConfigurationPrices;components:{skuId:string;quantity:number}[]})=>configurationWrite('/api/product-configurations',input)} />
  else if (path === '/skus') page = <SkuMaster data={data} />
  else if (path === '/channels') page = <ChannelMatrix data={data} local={local} configurationData={configurations} configurationError={configurationError} onBindConfiguration={editable&&local?async(offerId,configurationId)=>{await configurationWrite('/api/mapping/configuration',{offerId,configurationId});onData(await repository.load())}:undefined} onUnmap={local && editable ? async (offerId, productId) => { const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'}); if(!response.ok)throw new Error('세션을 확인할 수 없습니다.'); const session=await response.json() as {csrf:string}; const result=await fetch('/api/mapping/unmap',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify({offerId,productId})}); if(!result.ok)throw new Error('매핑 해제에 실패했습니다. 다시 확인해 주세요.'); await refreshConfigurations();onData(await repository.load()) } : undefined} />
  else if (path === '/mapping') page = <MappingCenter data={data} onMap={onMap} onArchiveOffer={onArchiveOffer} configurations={configurations?.configurations??[]} configurationAvailable={!local||(!configurationError&&configurations!==null)} onMapConfiguration={local&&editable?async(offerId,configurationId)=>{await configurationWrite('/api/mapping/configuration',{offerId,configurationId});onData(await repository.load())}:undefined} readOnly={!editable} showDemoRecommendations={!access} local={local} onArchive={local && editable ? async (offerIds) => {const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('세션을 확인할 수 없습니다.');const session=await response.json() as {csrf:string};const result=await fetch('/api/mapping/archive-inactive',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify({offerIds})});if(!result.ok)throw new Error('옵션의 상태가 변경되었거나 삭제에 실패했습니다. 새로고침 후 다시 확인해 주세요.');onData(await repository.load())} : undefined} />
  else if (path === '/audit') page = <AuditCenter key={route} data={data} onUpdateIssue={onUpdateIssue} readOnly={!editable} onDeleteIssues={local&&editable?async(issueIds)=>{const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('세션을 확인할 수 없습니다.');const session=await response.json() as {csrf:string};const result=await fetch('/api/issues/archive',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify({issueIds})});if(!result.ok)throw new Error('이슈를 삭제하지 못했습니다. 새로고침 후 다시 확인해 주세요.');onData(await repository.load())}:undefined} />
  else if (path === '/import/master' && access?.mode === 'local' && !importPersistence) page = <><PageHeader title="준비 중입니다" description="로컬 Master Import 기능을 준비하고 있습니다." /></>
  else if (path === '/import/master' && editable) page = <MasterImport persistence={importPersistence} role={access?.role === 'EDITOR' ? 'EDITOR' : 'ADMIN'} localPolicy={access?.mode === 'local'} onMasterApplied={access?.onRefresh} />
  else if (path === '/import/master') page = <><PageHeader title="접근할 수 없습니다" description="이 워크스페이스에서는 데이터 가져오기를 실행할 수 없습니다." /><div className="panel"><EmptyState title="읽기 전용 계정입니다" /></div></>
  else if (path === '/settings/channels' || path === '/settings/workspace') page = <Settings data={data} section={path.split('/')[2]} mode={access?.mode ?? 'mock'} />
  else page = <><PageHeader title="페이지를 찾을 수 없습니다" description="주소를 확인하거나 대시보드로 이동해 주세요." /><div className="panel"><EmptyState title="요청한 페이지가 없습니다" action={<a className="button button-primary" href="#/dashboard">대시보드로 이동</a>} /></div></>
  return <Layout data={data} route={route} access={access}>{page}</Layout>
}

function LocalWorkspace({session,onBack}:{session:LocalSession;onBack:()=>void}) {
  const [data,setData]=useState<SellerData|null>(null)
  const [error,setError]=useState(false)
  const importPersistence=useMemo(()=>session.importEnabled?createLocalImportPersistence(session.user.workspaceId,session.csrf):undefined,[session.importEnabled,session.user.workspaceId,session.csrf])
  const refresh=useCallback(async()=>{
    try { const response=await fetch('/api/data',{cache:'no-store',credentials:'same-origin'});if(!response.ok)throw new Error('unavailable');setData(await response.json() as SellerData);setError(false) }
    catch {setError(true)}
  },[])
  useEffect(()=>{void Promise.resolve().then(refresh)},[refresh])
  if(error)return <ErrorState message="로컬 데이터를 불러오지 못했습니다." retry={()=>void refresh()} onLogout={onBack}/>
  if(!data)return <LoadingState message="로컬 상품 데이터를 불러오고 있습니다…" />
  const load=async():Promise<SellerData>=>{
    const response=await fetch('/api/data',{cache:'no-store',credentials:'same-origin'})
    if(!response.ok)throw new Error('로컬 데이터를 불러오지 못했습니다.')
    return response.json() as Promise<SellerData>
  }
  const write=async(path:string,body:object):Promise<SellerData>=>{
    const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify(body)})
    if(!response.ok)throw new Error('변경하지 못했습니다. 현재 권한과 데이터를 확인해 주세요.')
    return load()
  }
  const repository:SellerRepository={load,mapOffer:(offerId,productId)=>write('/api/mapping',{offerId,productId}),updateIssueStatus:(id,status)=>write(`/api/issues/${encodeURIComponent(id)}/status`,{status})}
  const access:WorkspaceAccess={mode:'local',role:session.user.role,email:session.user.email,workspaces:[{id:session.user.workspaceId,name:data.workspace.name,role:session.user.role}],selectedWorkspaceId:session.user.workspaceId,onWorkspaceChange:()=>{},onLogout:onBack,onRefresh:()=>void refresh()}
  return <WorkspaceView data={data} repository={repository} onData={setData} access={access} importPersistence={importPersistence} />
}

function MockApp() {
  const [data, setData] = useState<SellerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const repository: SellerRepository = {
    load: () => createMockRepository().load(),
    mapOffer: (offerId, productId) => createMockRepository().mapOffer(offerId, productId),
    updateIssueStatus: (issueId, status) => createMockRepository().updateIssueStatus(issueId, status),
  }
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setData(await createMockRepository().load()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '데이터를 불러오지 못했습니다.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    let active = true
    Promise.resolve().then(() => createMockRepository().load()).then(next => { if (active) { setData(next); setLoading(false) } }).catch(cause => { if (active) { setError(cause instanceof Error ? cause.message : '데이터를 불러오지 못했습니다.'); setLoading(false) } })
    const onStorage = (event: StorageEvent) => { if (event.key?.startsWith('seller-audit:') || event.key === null) void refresh() }
    window.addEventListener('storage', onStorage)
    return () => { active = false; window.removeEventListener('storage', onStorage) }
  }, [refresh])
  if (loading && !data) return <LoadingState message="상품 데이터를 불러오고 있습니다…" />
  if (error || !data) return <ErrorState message={error ?? '저장된 데이터를 확인해 주세요.'} hint="브라우저 저장소 사용 여부를 확인해 주세요. 기존 데이터는 자동으로 삭제하지 않습니다." retry={() => void refresh()} loading={loading} />
  return <WorkspaceView data={data} repository={repository} onData={setData} />
}

type RemoteState =
  | { phase: 'loading' }
  | { phase: 'signed-out' }
  | { phase: 'no-workspace' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; userId: string; email: string | null; workspaces: ActiveWorkspace[]; current: ActiveWorkspace; repository: SellerRepository; importPersistence: ImportPersistence; data: SellerData }

function SupabaseApp() {
  const supabase = getSupabaseClient()
  const [state, setState] = useState<RemoteState>({ phase: 'loading' })
  const [loginLoading, setLoginLoading] = useState(false)
  const requestId = useRef(0)
  const invalidate = useCallback(() => { requestId.current += 1 }, [])

  const bootstrap = useCallback(async (preferredWorkspaceId?: string) => {
    const currentRequest = ++requestId.current
    setState({ phase: 'loading' })
    try {
      const sessionResult = await supabase.auth.getSession()
      if (sessionResult.error) throw new Error('로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.')
      if (!sessionResult.data.session) {
        if (currentRequest === requestId.current) setState({ phase: 'signed-out' })
        return
      }
      const userResult = await supabase.auth.getUser()
      if (userResult.error || !userResult.data.user) throw new Error('로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.')
      const user = userResult.data.user
      const workspaces = await loadActiveWorkspaces(supabase, user.id)
      if (currentRequest !== requestId.current) return
      if (workspaces.length === 0) {
        setState({ phase: 'no-workspace' })
        return
      }
      let savedId: string | null = null
      try { savedId = window.localStorage.getItem(selectedWorkspaceKey(user.id)) } catch { /* Optional preference only. */ }
      const current = workspaces.find(item => item.id === preferredWorkspaceId) ?? workspaces.find(item => item.id === savedId) ?? workspaces[0]
      const repository = createSupabaseRepository({ supabase, workspaceId: current.id })
      const importPersistence = createImportPersistence({ supabase, workspaceId: current.id })
      const data = await repository.load()
      if (currentRequest !== requestId.current) return
      try { window.localStorage.setItem(selectedWorkspaceKey(user.id), current.id) } catch { /* Optional preference only. */ }
      setState({ phase: 'ready', userId: user.id, email: user.email ?? null, workspaces, current, repository, importPersistence, data })
    } catch (cause) {
      if (currentRequest === requestId.current) setState({ phase: 'error', message: cause instanceof Error ? cause.message : '데이터를 불러오지 못했습니다.' })
    }
  }, [supabase])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        ++requestId.current
        setState({ phase: 'signed-out' })
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        // Supabase requests must not be awaited inside the auth callback's lock.
        setTimeout(() => void bootstrap(), 0)
      }
    })
    const initialCheck = setTimeout(() => void bootstrap(), 0)
    return () => { clearTimeout(initialCheck); invalidate(); subscription.unsubscribe() }
  }, [bootstrap, invalidate, supabase])

  const login = async (email: string, password: string) => {
    setLoginLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw new Error('이메일 또는 비밀번호를 확인하세요.')
      await bootstrap()
    } finally { setLoginLoading(false) }
  }
  const logout = async () => {
    ++requestId.current
    setState({ phase: 'signed-out' })
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) setState({ phase: 'error', message: '로그아웃하지 못했습니다. 다시 시도해 주세요.' })
  }

  if (state.phase === 'loading') return <LoadingState message="로그인과 워크스페이스 권한을 확인하고 있습니다…" />
  if (state.phase === 'signed-out') return <Login onLogin={login} loading={loginLoading} />
  if (state.phase === 'no-workspace') return <div className="app-error"><Icon name="shield" size={36} /><h1>접근 가능한 워크스페이스가 없습니다</h1><p>관리자에게 문의하세요.</p><button className="button button-primary" onClick={() => void logout()}>로그아웃</button></div>
  if (state.phase === 'error') return <ErrorState message={state.message} hint="Supabase 개발 환경과 현재 접근 권한을 확인해 주세요." retry={() => void bootstrap()} onLogout={() => void logout()} />

  const active = state
  const access: WorkspaceAccess = {
    mode: 'supabase', role: active.current.role, email: active.email,
    workspaces: active.workspaces, selectedWorkspaceId: active.current.id,
    onWorkspaceChange: (id) => void bootstrap(id), onLogout: () => void logout(), onRefresh: () => void bootstrap(active.current.id),
  }
  return <WorkspaceView key={`${active.userId}:${active.current.id}`} data={active.data} repository={active.repository}
    onData={(next) => setState(current => current.phase === 'ready' && current.repository === active.repository ? { ...current, data: next } : current)}
    access={access} importPersistence={active.importPersistence} />
}

function readConfiguration(): { mode: 'mock' | 'supabase' | 'local-server'; error: null } | { mode: null; error: string } {
  try {
    const config = getDataSourceConfig()
    return { mode: config.mode, error: null }
  } catch (cause) {
    return { mode: null, error: cause instanceof Error ? cause.message : '환경 설정을 확인해 주세요.' }
  }
}

export default function App() {
  const config = readConfiguration()
  if (config.error) return <ErrorState message={config.error} />
  if (config.mode === 'mock') return <MockApp />
  if (config.mode === 'local-server') return <LocalAuth renderWorkspace={(session,onBack)=><LocalWorkspace session={session} onBack={onBack}/>} />
  return <SupabaseApp />
}
