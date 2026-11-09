import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Login } from './Login'

type Role = 'ADMIN' | 'EDITOR' | 'VIEWER'
type User = {userId:string; workspaceId:string; role:Role; email:string; displayName:string}
type Employee = {id:string; email:string; display_name:string; status:string; role:Role; membership_status:string;online?:boolean|null}
export type LocalSession = {user:User; csrf:string; importEnabled:boolean; openMode?:boolean}

async function api<T>(path:string, method='GET', data?:object, csrf?:string):Promise<T> {
  const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:{...(data?{'Content-Type':'application/json'}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},...(data?{body:JSON.stringify(data)}:{})})
  if (!response.ok) throw new Error('요청을 처리하지 못했습니다. 입력 내용과 권한을 확인해 주세요.')
  return response.json() as Promise<T>
}

export function LocalAuth({renderWorkspace}:{renderWorkspace:(session:LocalSession,onBack:()=>void)=>ReactNode}) {
  const [session,setSession]=useState<LocalSession|null>(null)
  const [showWorkspace,setShowWorkspace]=useState(false)
  const [loading,setLoading]=useState(true)
  const [serverError,setServerError]=useState(false)
  const [activate,setActivate]=useState(false)
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [code,setCode]=useState('')
  const [name,setName]=useState(''); const [role,setRole]=useState<Role>('VIEWER')
  const [employees,setEmployees]=useState<Employee[]>([]); const [message,setMessage]=useState(''); const [oneTimeCode,setOneTimeCode]=useState('')
  const [currentPassword,setCurrentPassword]=useState(''); const [newPassword,setNewPassword]=useState('')
  const refresh=useCallback(async()=>{
    try {
      const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'})
      if(response.status===401){setSession(null);setServerError(false);return}
      if(!response.ok)throw new Error('server')
      const current=await response.json() as LocalSession
      setSession(current);if(current.openMode)setShowWorkspace(true);setServerError(false)
    } catch {setServerError(true)} finally {setLoading(false)}
  },[])
  useEffect(()=>{void Promise.resolve().then(refresh)},[refresh])
  const loadEmployees=useCallback(async()=>{
    if(session?.user.role!=='ADMIN')return
    try {setEmployees((await api<{employees:Employee[]}>('/api/employees')).employees)} catch {setMessage('직원 목록을 불러오지 못했습니다.')}
  },[session?.user.role])
  useEffect(()=>{void Promise.resolve().then(loadEmployees)},[loadEmployees])
  useEffect(()=>{
    if(!session||session.openMode)return
    let stopped=false
    const pulse=async()=>{try{await api('/api/auth/presence','POST',{},session.csrf);if(!stopped&&!showWorkspace&&session.user.role==='ADMIN')await loadEmployees()}catch{if(!stopped&&!showWorkspace&&session.user.role==='ADMIN')setMessage('접속 상태를 갱신하지 못했습니다.')} }
    void pulse();const timer=window.setInterval(()=>void pulse(),30_000)
    return()=>{stopped=true;window.clearInterval(timer)}
  },[session,showWorkspace,loadEmployees])
  const submitActivation=async(event:FormEvent)=>{
    event.preventDefault(); setMessage('')
    try {await api('/api/auth/activate','POST',{email,code,password}); setPassword('');setCode('');setActivate(false);setMessage('비밀번호가 설정되었습니다. 로그인해 주세요.')}
    catch {setMessage('활성화하지 못했습니다. 이메일과 코드를 확인해 주세요.')}
  }
  const create=async(event:FormEvent)=>{
    event.preventDefault();setMessage('');setOneTimeCode('')
    try {const result=await api<{code?:string;initialPassword?:boolean}>('/api/employees','POST',{email,displayName:name,role},session!.csrf);setOneTimeCode(result.code??'');if(result.initialPassword)setMessage('계정을 만들었습니다. 공통 초기 비밀번호로 로그인할 수 있습니다.');setName('');setEmail('');await loadEmployees()}
    catch {setMessage('계정을 만들지 못했습니다. 이메일 중복이나 권한을 확인해 주세요.')}
  }
  const action=async(id:string,what:'role'|'disable'|'reset',next?:Role)=>{
    setMessage('');setOneTimeCode('')
    try {const result=await api<{code?:string}>(`/api/employees/${encodeURIComponent(id)}/${what}`,'POST',next?{role:next}:{},session!.csrf); if(result.code)setOneTimeCode(result.code);await loadEmployees()}
    catch {setMessage('변경하지 못했습니다. 마지막 관리자 보호 및 현재 권한을 확인해 주세요.')}
  }
  const changePassword=async(event:FormEvent)=>{
    event.preventDefault();setMessage('')
    try {await api('/api/auth/password','POST',{currentPassword,newPassword},session!.csrf);setCurrentPassword('');setNewPassword('');setSession(null);setMessage('비밀번호가 변경되었습니다. 다시 로그인해 주세요.')}
    catch {setMessage('비밀번호를 변경하지 못했습니다.')}
  }
  if(loading)return <main className="app-loading"><h1>로컬 로그인 확인 중</h1></main>
  if(serverError)return <main className="app-error"><h1>로컬 서버에 연결할 수 없습니다</h1><button type="button" onClick={()=>void refresh()}>다시 시도</button></main>
  if(!session)return <>
    {!activate ? <Login onLogin={async (loginEmail,loginPassword)=>{await api('/api/auth/login','POST',{email:loginEmail,password:loginPassword});await refresh()}} footer={<>{message&&<p className="login-message" role="status">{message}</p>}<button className="login-switch" type="button" onClick={()=>{setActivate(true);setMessage('')}}>활성화 코드로 계정 설정</button></>} /> :
      <main className="login-page"><section className="login-card"><div className="login-brand"><span className="login-brand-mark">S</span><span>Seller<span>Audit</span></span></div><div className="login-heading"><h1>계정 활성화</h1><p>받은 활성화 코드로 비밀번호를 설정해 주세요.</p></div><form className="login-form" onSubmit={event=>void submitActivation(event)}>
        <label className="activation-field">회사 이메일<input type="email" value={email} onChange={event=>setEmail(event.target.value)} autoComplete="email" required /></label>
        <label className="activation-field">일회용 활성화 코드<input value={code} onChange={event=>setCode(event.target.value)} autoComplete="off" required /></label>
        <label className="activation-field">새 비밀번호 (10자 이상)<input type="password" minLength={10} value={password} onChange={event=>setPassword(event.target.value)} autoComplete="new-password" required /></label>
        {message&&<p className="login-error" role="alert">{message}</p>}<button className="login-submit">비밀번호 설정</button></form><button className="login-switch" type="button" onClick={()=>{setActivate(false);setMessage('')}}>로그인으로 돌아가기</button></section></main>}
  </>
  if(showWorkspace)return <>{renderWorkspace(session,()=>setShowWorkspace(false))}</>
  return <main className="account-page"><header className="account-header"><div><span className="account-brand">SellerAudit</span><h1>계정 관리</h1><p>{session.user.displayName} · {session.user.role}</p></div><div className="account-header-actions"><button className="button button-primary" type="button" onClick={()=>setShowWorkspace(true)}>상품 조회 화면 열기</button>
    {!session.openMode && <button className="button" type="button" onClick={()=>void api('/api/auth/logout','POST',{},session.csrf).then(()=>{setSession(null);setEmployees([]);setOneTimeCode('')}).catch(()=>setMessage('로그아웃하지 못했습니다.'))}>로그아웃</button>}</div></header>
    {message&&<p className="account-message" role="status">{message}</p>}
    {!session.openMode && <section className="panel account-section"><h2>비밀번호 변경</h2><form className="account-form" onSubmit={event=>void changePassword(event)}><label>현재 비밀번호<input type="password" value={currentPassword} autoComplete="current-password" onChange={event=>setCurrentPassword(event.target.value)} required /></label><label>새 비밀번호 (10자 이상)<input type="password" minLength={10} value={newPassword} autoComplete="new-password" onChange={event=>setNewPassword(event.target.value)} required /></label><button className="button">변경</button></form></section>}
    {session.user.role==='ADMIN'&&<section className="panel account-section"><h2>직원 관리</h2><form className="account-form" onSubmit={event=>void create(event)}>
      <label>회사 이메일 <input type="email" value={email} onChange={event=>setEmail(event.target.value)} required /></label>{' '}
      <label>이름 <input value={name} onChange={event=>setName(event.target.value)} required /></label>{' '}
      <label>역할 <select value={role} onChange={event=>setRole(event.target.value as Role)}><option>VIEWER</option><option>EDITOR</option><option>ADMIN</option></select></label>{' '}<button className="button button-primary">계정 생성</button>
    </form>{oneTimeCode&&<p role="status">일회용 코드: <strong>{oneTimeCode}</strong> — 안전하게 직원에게 전달하세요. 화면을 닫으면 다시 볼 수 없습니다.</p>}
      <p>접속 상태는 최근 90초 이내 SellerAudit 화면에서 신호가 확인된 경우 ‘접속 중’으로 표시하며, 약 30초마다 갱신됩니다. 브라우저 절전 또는 네트워크 상태에 따라 늦어질 수 있습니다.</p>
      <div className="table-scroll"><table className="data-table account-table"><thead><tr><th>이름</th><th>이메일</th><th>계정 상태</th><th>접속 상태</th><th>역할</th><th>관리</th></tr></thead><tbody>{employees.map(employee=><tr key={employee.id}><td>{employee.display_name}</td><td>{employee.email}</td><td>{employee.status}</td><td>{employee.online===true?'접속 중':employee.online===false?'접속 확인 안 됨':'확인 불가'}</td><td><select aria-label={`${employee.display_name} 역할`} value={employee.role} onChange={event=>void action(employee.id,'role',event.target.value as Role)}><option>VIEWER</option><option>EDITOR</option><option>ADMIN</option></select></td><td><button className="button button-small" type="button" onClick={()=>void action(employee.id,'reset')}>활성화 코드 재발급</button>{' '}<button className="button button-small" type="button" onClick={()=>void action(employee.id,'disable')}>비활성화</button></td></tr>)}</tbody></table></div></section>}
  </main>
}
