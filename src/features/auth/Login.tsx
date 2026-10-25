import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import './auth.css'

export interface LoginProps {
  onLogin: (email: string, password: string) => Promise<void>
  loading?: boolean
  error?: string | null
}

export function Login({ onLogin, loading = false, error = null }: LoginProps) {
  const emailId = useId()
  const passwordId = useId()
  const errorId = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const busy = loading || submitting
  const displayedError = error ?? submitError

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      await onLogin(email.trim(), password)
    } catch (cause) {
      setSubmitError(cause instanceof Error && cause.message
        ? cause.message
        : '로그인 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand" aria-label="SellerAudit">
          <span className="login-brand-mark" aria-hidden="true">S</span>
          <span>Seller<span>Audit</span></span>
        </div>

        <div className="login-heading">
          <p className="login-eyebrow">INTERNAL PILOT</p>
          <h1 id="login-title">SellerAudit 로그인</h1>
          <p>승인된 사내 계정으로 로그인해 주세요.</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit} aria-busy={busy}>
          <div className="login-field">
            <label htmlFor={emailId}>이메일</label>
            <input
              id={emailId}
              name="email"
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              autoComplete="email"
              inputMode="email"
              placeholder="name@company.com"
              required
              disabled={busy}
              aria-describedby={displayedError ? errorId : undefined}
            />
          </div>

          <div className="login-field">
            <label htmlFor={passwordId}>비밀번호</label>
            <input
              id={passwordId}
              name="password"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="비밀번호를 입력하세요"
              required
              disabled={busy}
              aria-describedby={displayedError ? errorId : undefined}
            />
          </div>

          {displayedError && <p className="login-error" id={errorId} role="alert">{displayedError}</p>}

          <button className="login-submit" type="submit" disabled={busy}>
            {busy && <span className="login-spinner" aria-hidden="true" />}
            {busy ? '로그인 중…' : '로그인'}
          </button>
        </form>

        <p className="login-support">계정 또는 접근 권한은 SellerAudit 관리자에게 문의해 주세요.</p>
      </section>
    </main>
  )
}

export default Login
