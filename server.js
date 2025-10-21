import express from 'express'
import cors from 'cors'
import pkg from 'agora-access-token'
const { RtcTokenBuilder, RtcRole } = pkg

const app = express()

// CORS: allow production origin + local dev by default. Override via CORS_ORIGINS env (comma-separated)
const DEFAULT_ORIGINS = [
  'https://t-echmed.web.app',
  'http://localhost:5173',
  'http://localhost:3000'
]
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || DEFAULT_ORIGINS.join(','))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true) // allow curl/postman/no-origin
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    return callback(new Error('Not allowed by CORS'))
  }
}))

const APP_ID = process.env.AGORA_APP_ID
const APP_CERT = process.env.AGORA_APP_CERT || process.env.AGORA_APP_CERTIFICATE

app.get('/health', (_req, res) => res.send('ok'))

// GET /agora/token?room=<channel>&uid=<numericUid> OR &account=<stringUid>&ttl=<seconds>
app.get('/agora/token', (req, res) => {
  try {
    const channel = String(req.query.room || '').trim()
    const uidParam = req.query.uid
    const accountParam = req.query.account

    if (!APP_ID || !APP_CERT) {
      return res.status(500).json({ error: 'server env not set', detail: 'Missing AGORA_APP_ID or AGORA_APP_CERT(_IFICATE)' })
    }
    if (!channel) {
      return res.status(400).json({ error: 'Missing room' })
    }

    // TTL in seconds, default 1 hour
    const ttlSecRaw = Number(req.query.ttl)
    const ttlSec = Number.isFinite(ttlSecRaw) && ttlSecRaw > 0 ? Math.min(ttlSecRaw, 24 * 60 * 60) : 60 * 60
    const privilegeExpiredTs = Math.floor(Date.now() / 1000) + ttlSec

    const role = RtcRole.PUBLISHER

    let token
    let uidType
    let uidUsed

    if (typeof accountParam === 'string' && accountParam.trim()) {
      uidType = 'account'
      uidUsed = String(accountParam)
      token = (RtcTokenBuilder.buildTokenWithAccount
        ? RtcTokenBuilder.buildTokenWithAccount(APP_ID, APP_CERT, channel, uidUsed, role, privilegeExpiredTs)
        : RtcTokenBuilder.buildWithAccount(APP_ID, APP_CERT, channel, uidUsed, role, privilegeExpiredTs))
    } else if (typeof uidParam !== 'undefined') {
      // if uid is present but not numeric, fall back to account token
      const n = parseInt(String(uidParam), 10)
      if (Number.isFinite(n)) {
        uidType = 'uid'
        uidUsed = n
        token = (RtcTokenBuilder.buildTokenWithUid
          ? RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERT, channel, n, role, privilegeExpiredTs)
          : RtcTokenBuilder.buildWithUid(APP_ID, APP_CERT, channel, n, role, privilegeExpiredTs))
      } else {
        uidType = 'account'
        uidUsed = String(uidParam)
        token = (RtcTokenBuilder.buildTokenWithAccount
          ? RtcTokenBuilder.buildTokenWithAccount(APP_ID, APP_CERT, channel, uidUsed, role, privilegeExpiredTs)
          : RtcTokenBuilder.buildWithAccount(APP_ID, APP_CERT, channel, uidUsed, role, privilegeExpiredTs))
      }
    } else {
      return res.status(400).json({ error: 'Missing uid/account', detail: 'Provide ?uid=<number> or ?account=<string>' })
    }

    return res.json({ token, room: channel, uidType, uid: uidUsed, ttl: ttlSec })
  } catch (e) {
    console.error('Token build failed:', e)
    return res.status(500).json({ error: 'token generation failed', detail: String(e?.message || e) })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Token server listening on :${PORT}`)
})
