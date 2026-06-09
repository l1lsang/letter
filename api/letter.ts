import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

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
  updatedAt: string
}

type VercelRequest = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type VercelResponse = {
  setHeader(name: string, value: string): void
  status(code: number): VercelResponse
  json(body: unknown): void
  end(): void
}

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
  updatedAt: '',
}

function readEnv(name: string) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is not configured`)
  }

  return value
}

function getFirebaseApp() {
  const existingApp = getApps()[0]

  if (existingApp) {
    return existingApp
  }

  return initializeApp({
    credential: cert({
      projectId: readEnv('FIREBASE_PROJECT_ID'),
      clientEmail: readEnv('FIREBASE_CLIENT_EMAIL'),
      privateKey: readEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
  })
}

function getLetterRef() {
  const collectionName = process.env.FIREBASE_LETTER_COLLECTION || 'letters'
  const documentId = process.env.FIREBASE_LETTER_DOCUMENT_ID || 'main'

  return getFirestore(getFirebaseApp()).collection(collectionName).doc(documentId)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : fallback
}

function sanitizeUrl(value: unknown) {
  if (typeof value !== 'string') {
    return ''
  }

  try {
    const url = new URL(value.trim())
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''
  } catch {
    return ''
  }
}

function sanitizeLinks(value: unknown) {
  if (!Array.isArray(value)) {
    return defaultLetter.links
  }

  const links = value
    .filter(isRecord)
    .slice(0, 6)
    .map((link) => ({
      label: sanitizeText(link.label, '링크 열기', 40),
      url: sanitizeUrl(link.url),
    }))
    .filter((link) => link.url.length > 0)

  return links.length > 0 ? links : defaultLetter.links
}

function readUpdatedAt(value: unknown, fallback: string) {
  if (isRecord(value) && typeof value.updatedAt === 'string') {
    return value.updatedAt
  }

  return fallback
}

function sanitizeLetter(
  value: unknown,
  updatedAt = new Date().toISOString(),
): LetterContent {
  if (!isRecord(value)) {
    return {
      ...defaultLetter,
      updatedAt,
    }
  }

  return {
    title: sanitizeText(value.title, defaultLetter.title, 80),
    dateLabel: sanitizeText(value.dateLabel, defaultLetter.dateLabel, 40),
    salutation: sanitizeText(value.salutation, defaultLetter.salutation, 80),
    body: sanitizeText(value.body, defaultLetter.body, 5000),
    signature: sanitizeText(value.signature, defaultLetter.signature, 80),
    links: sanitizeLinks(value.links),
    updatedAt,
  }
}

function parseBody(body: unknown) {
  if (typeof body === 'string') {
    return JSON.parse(body) as unknown
  }

  return body
}

function getAuthorizationHeader(req: VercelRequest) {
  const header = req.headers.authorization || req.headers.Authorization
  return Array.isArray(header) ? header[0] : header
}

async function verifyAdmin(req: VercelRequest) {
  const authorization = getAuthorizationHeader(req)

  if (!authorization?.startsWith('Bearer ')) {
    throw new Error('관리자 로그인이 필요합니다.')
  }

  const token = authorization.replace('Bearer ', '').trim()
  const decodedToken = await getAuth(getFirebaseApp()).verifyIdToken(token)
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  const tokenEmail = decodedToken.email?.toLowerCase()
  const hasAdminClaim = decodedToken.admin === true
  const hasAdminEmail = tokenEmail ? adminEmails.includes(tokenEmail) : false

  if (!hasAdminClaim && !hasAdminEmail) {
    throw new Error('관리자 권한이 없습니다.')
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  try {
    if (req.method === 'GET') {
      const snapshot = await getLetterRef().get()

      if (!snapshot.exists) {
        res.status(200).json(defaultLetter)
        return
      }

      const data = snapshot.data()
      res.status(200).json(sanitizeLetter(data, readUpdatedAt(data, '')))
      return
    }

    if (req.method === 'POST') {
      await verifyAdmin(req)

      const letter = sanitizeLetter(parseBody(req.body))
      await getLetterRef().set(letter, { merge: true })

      res.status(200).json(letter)
      return
    }

    res.setHeader('Allow', 'GET, POST, OPTIONS')
    res.status(405).json({ error: '허용되지 않은 요청입니다.' })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'

    res.status(500).json({ error: message })
  }
}
