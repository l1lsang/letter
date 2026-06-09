import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import type { User } from 'firebase/auth'
import './App.css'
import { auth, isFirebaseConfigured } from './firebase'

type LetterLink = {
  label: string
  url: string
}

type LetterContent = {
  title: string
  dateLabel: string
  salutation: string
  body: string
  signature: string
  links: LetterLink[]
  updatedAt?: string
}

type AuthMode = 'login' | 'signup'

const defaultLetter: LetterContent = {
  title: '마음을 전하는 편지',
  dateLabel: '2026. 06. 09',
  salutation: '안녕하세요,',
  body:
    '이 공간은 중요한 소식과 따뜻한 메시지를 편지처럼 전하기 위해 준비했습니다.\n\n관리자는 로그인 후 문구와 하단 링크를 바로 수정할 수 있습니다.',
  signature: '늘 응원하는 마음으로',
  links: [
    {
      label: 'YouTube 영상 보기',
      url: 'https://www.youtube.com/',
    },
  ],
}

const emptyLink: LetterLink = {
  label: '',
  url: '',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readText(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : fallback
}

function normalizeLinks(value: unknown): LetterLink[] {
  if (!Array.isArray(value)) {
    return defaultLetter.links
  }

  const links = value
    .filter(isRecord)
    .map((link) => ({
      label: readText(link.label, '링크 열기'),
      url: readText(link.url, ''),
    }))
    .filter((link) => link.url.length > 0)

  return links.length > 0 ? links : defaultLetter.links
}

function normalizeLetter(value: unknown): LetterContent {
  if (!isRecord(value)) {
    return defaultLetter
  }

  return {
    title: readText(value.title, defaultLetter.title),
    dateLabel: readText(value.dateLabel, defaultLetter.dateLabel),
    salutation: readText(value.salutation, defaultLetter.salutation),
    body: readText(value.body, defaultLetter.body),
    signature: readText(value.signature, defaultLetter.signature),
    links: normalizeLinks(value.links),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
  }
}

function getLinkHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'link'
  }
}

function getLinkBadge(url: string) {
  return /youtu\.be|youtube\.com/i.test(url) ? 'VIDEO' : 'LINK'
}

function App() {
  const [letter, setLetter] = useState<LetterContent>(defaultLetter)
  const [draft, setDraft] = useState<LetterContent>(defaultLetter)
  const [user, setUser] = useState<User | null>(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [signupPasswordConfirm, setSignupPasswordConfirm] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isCreatingAccount, setIsCreatingAccount] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const paragraphs = useMemo(
    () =>
      letter.body
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean),
    [letter.body],
  )

  useEffect(() => {
    let ignore = false

    async function loadLetter() {
      try {
        const response = await fetch('/api/letter', {
          headers: { Accept: 'application/json' },
        })

        if (!response.ok) {
          throw new Error('Letter API request failed')
        }

        const contentType = response.headers.get('content-type') || ''
        if (!contentType.includes('application/json')) {
          throw new Error('Letter API response is not JSON')
        }

        const nextLetter = normalizeLetter(await response.json())

        if (!ignore) {
          setLetter(nextLetter)
          setDraft(nextLetter)
        }
      } catch {
        if (!ignore) {
          setStatusMessage('Firebase 연결 전까지 기본 편지지를 표시합니다.')
        }
      } finally {
        if (!ignore) {
          setIsLoading(false)
        }
      }
    }

    loadLetter()

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    if (!auth) {
      return undefined
    }

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      if (nextUser) {
        setStatusMessage('')
      }
    })
  }, [])

  function toggleAdminPanel() {
    if (!adminOpen) {
      setDraft(letter)
    }

    setAdminOpen((current) => !current)
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!auth) {
      setStatusMessage('Firebase 클라이언트 환경변수를 먼저 설정해주세요.')
      return
    }

    setIsSigningIn(true)
    setStatusMessage('')

    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPassword)
      setLoginPassword('')
      setDraft(letter)
    } catch {
      setStatusMessage('관리자 로그인 정보를 확인해주세요.')
    } finally {
      setIsSigningIn(false)
    }
  }

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!auth) {
      setStatusMessage('Firebase 클라이언트 환경변수를 먼저 설정해주세요.')
      return
    }

    if (loginPassword !== signupPasswordConfirm) {
      setStatusMessage('비밀번호가 서로 다릅니다.')
      return
    }

    setIsCreatingAccount(true)
    setStatusMessage('')

    try {
      await createUserWithEmailAndPassword(auth, loginEmail, loginPassword)
      setLoginPassword('')
      setSignupPasswordConfirm('')
      setDraft(letter)
      setStatusMessage('회원가입이 완료되었습니다.')
    } catch {
      setStatusMessage('회원가입 정보를 확인해주세요.')
    } finally {
      setIsCreatingAccount(false)
    }
  }

  async function handleLogout() {
    if (!auth) {
      return
    }

    await signOut(auth)
    setStatusMessage('')
  }

  function updateDraft<K extends keyof LetterContent>(
    key: K,
    value: LetterContent[K],
  ) {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function updateLink(index: number, key: keyof LetterLink, value: string) {
    setDraft((current) => ({
      ...current,
      links: current.links.map((link, linkIndex) =>
        linkIndex === index ? { ...link, [key]: value } : link,
      ),
    }))
  }

  function addLink() {
    setDraft((current) => ({
      ...current,
      links: [...current.links, emptyLink],
    }))
  }

  function removeLink(index: number) {
    setDraft((current) => ({
      ...current,
      links: current.links.filter((_, linkIndex) => linkIndex !== index),
    }))
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!user) {
      setStatusMessage('관리자 로그인이 필요합니다.')
      return
    }

    setIsSaving(true)
    setStatusMessage('')

    try {
      const idToken = await user.getIdToken()
      const response = await fetch('/api/letter', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(draft),
      })

      if (!response.ok) {
        const result = await response.json().catch(() => null)
        const message =
          isRecord(result) && typeof result.error === 'string'
            ? result.error
            : '저장에 실패했습니다.'
        throw new Error(message)
      }

      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        throw new Error('Vercel API가 연결된 환경에서 저장해주세요.')
      }

      const savedLetter = normalizeLetter(await response.json())
      setLetter(savedLetter)
      setDraft(savedLetter)
      setStatusMessage('저장되었습니다.')
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : '저장에 실패했습니다.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className={adminOpen ? 'page-shell with-admin' : 'page-shell'}>
      <section className="letter-stage" aria-labelledby="letter-title">
        <div className="top-bar">
          <div>
            <p className="eyebrow">Letter Studio</p>
            <p className="top-status">
              {isLoading ? '불러오는 중' : letter.updatedAt ? '동기화됨' : '기본 문서'}
            </p>
          </div>
          <button type="button" className="admin-toggle" onClick={toggleAdminPanel}>
            {adminOpen ? '닫기' : '관리자'}
          </button>
        </div>

        <article className="letter-paper">
          <div className="paper-corner" aria-hidden="true" />
          <header className="letter-header">
            <span>{letter.dateLabel}</span>
            <span>private note</span>
          </header>

          <div className="letter-content">
            <p className="salutation">{letter.salutation}</p>
            <h1 id="letter-title">{letter.title}</h1>
            <div className="letter-body">
              {paragraphs.map((paragraph, index) => (
                <p key={`${paragraph}-${index}`}>{paragraph}</p>
              ))}
            </div>
            <p className="signature">{letter.signature}</p>
          </div>

          <footer className="letter-links" aria-label="관련 링크">
            <p>함께 보기</p>
            <div className="link-list">
              {letter.links.map((link) => (
                <a
                  className="letter-link"
                  href={link.url}
                  key={`${link.label}-${link.url}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="link-badge">{getLinkBadge(link.url)}</span>
                  <span>
                    <strong>{link.label}</strong>
                    <small>{getLinkHost(link.url)}</small>
                  </span>
                </a>
              ))}
            </div>
          </footer>
        </article>
      </section>

      {adminOpen ? (
        <aside className="admin-panel" aria-label="관리자 편집">
          <div className="admin-heading">
            <p className="eyebrow">Admin</p>
            <h2>편지지 편집</h2>
          </div>

          {!user ? (
            <>
              <div className="auth-tabs" role="tablist" aria-label="인증 방식">
                <button
                  aria-selected={authMode === 'login'}
                  onClick={() => {
                    setAuthMode('login')
                    setStatusMessage('')
                  }}
                  role="tab"
                  type="button"
                >
                  로그인
                </button>
                <button
                  aria-selected={authMode === 'signup'}
                  onClick={() => {
                    setAuthMode('signup')
                    setStatusMessage('')
                  }}
                  role="tab"
                  type="button"
                >
                  회원가입
                </button>
              </div>

              <form
                className="admin-form"
                onSubmit={authMode === 'login' ? handleLogin : handleSignup}
              >
                <label>
                  이메일
                  <input
                    autoComplete="email"
                    disabled={
                      !isFirebaseConfigured || isSigningIn || isCreatingAccount
                    }
                    onChange={(event) => setLoginEmail(event.target.value)}
                    required
                    type="email"
                    value={loginEmail}
                  />
                </label>
                <label>
                  비밀번호
                  <input
                    autoComplete={
                      authMode === 'login' ? 'current-password' : 'new-password'
                    }
                    disabled={
                      !isFirebaseConfigured || isSigningIn || isCreatingAccount
                    }
                    minLength={6}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    required
                    type="password"
                    value={loginPassword}
                  />
                </label>

                {authMode === 'signup' ? (
                  <label>
                    비밀번호 확인
                    <input
                      autoComplete="new-password"
                      disabled={!isFirebaseConfigured || isCreatingAccount}
                      minLength={6}
                      onChange={(event) =>
                        setSignupPasswordConfirm(event.target.value)
                      }
                      required
                      type="password"
                      value={signupPasswordConfirm}
                    />
                  </label>
                ) : null}

                <button
                  className="primary-action"
                  disabled={
                    !isFirebaseConfigured || isSigningIn || isCreatingAccount
                  }
                  type="submit"
                >
                  {authMode === 'login'
                    ? isSigningIn
                      ? '로그인 중'
                      : '로그인'
                    : isCreatingAccount
                      ? '가입 중'
                      : '회원가입'}
                </button>
              </form>
            </>
          ) : (
            <form className="admin-form" onSubmit={handleSave}>
              <label>
                날짜
                <input
                  onChange={(event) =>
                    updateDraft('dateLabel', event.target.value)
                  }
                  required
                  value={draft.dateLabel}
                />
              </label>
              <label>
                제목
                <input
                  onChange={(event) => updateDraft('title', event.target.value)}
                  required
                  value={draft.title}
                />
              </label>
              <label>
                첫 인사
                <input
                  onChange={(event) =>
                    updateDraft('salutation', event.target.value)
                  }
                  required
                  value={draft.salutation}
                />
              </label>
              <label>
                본문
                <textarea
                  onChange={(event) => updateDraft('body', event.target.value)}
                  required
                  rows={10}
                  value={draft.body}
                />
              </label>
              <label>
                서명
                <input
                  onChange={(event) =>
                    updateDraft('signature', event.target.value)
                  }
                  required
                  value={draft.signature}
                />
              </label>

              <div className="link-editor">
                <div className="section-title">
                  <h3>하단 링크</h3>
                  <button
                    disabled={draft.links.length >= 6}
                    onClick={addLink}
                    type="button"
                  >
                    추가
                  </button>
                </div>

                {draft.links.map((link, index) => (
                  <div className="link-row" key={`draft-link-${index}`}>
                    <input
                      aria-label="링크 이름"
                      onChange={(event) =>
                        updateLink(index, 'label', event.target.value)
                      }
                      placeholder="링크 이름"
                      value={link.label}
                    />
                    <input
                      aria-label="링크 주소"
                      onChange={(event) =>
                        updateLink(index, 'url', event.target.value)
                      }
                      placeholder="https://"
                      type="url"
                      value={link.url}
                    />
                    <button onClick={() => removeLink(index)} type="button">
                      삭제
                    </button>
                  </div>
                ))}
              </div>

              <div className="admin-actions">
                <button
                  className="secondary-action"
                  onClick={handleLogout}
                  type="button"
                >
                  로그아웃
                </button>
                <button className="primary-action" disabled={isSaving} type="submit">
                  {isSaving ? '저장 중' : '저장'}
                </button>
              </div>
            </form>
          )}

          {statusMessage ? <p className="status-message">{statusMessage}</p> : null}
        </aside>
      ) : null}
    </main>
  )
}

export default App
