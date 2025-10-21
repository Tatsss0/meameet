import express from 'express';
import cors from 'cors';
import pkg from 'agora-access-token';
const { RtcTokenBuilder, RtcRole } = pkg;

const app = express();
app.use(cors()); // relax for dev; restrict origins in production

const APP_ID = process.env.AGORA_APP_ID;
const APP_CERT = process.env.AGORA_APP_CERT;

app.get('/agora/token', (req, res) => {
  try {
    const channel = req.query.room;
    const userAccount = req.query.uid; // doctor's Firebase UID or any string userAccount

    if (!channel || !userAccount) {
      return res.status(400).json({ error: 'room and uid required' });
    }
    if (!APP_ID || !APP_CERT) {
      return res.status(500).json({ error: 'server env not set' });
    }

    const expireTs = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour

    const token = RtcTokenBuilder.buildTokenWithAccount(
      APP_ID,
      APP_CERT,
      channel,
      userAccount,
      RtcRole.PUBLISHER,
      expireTs
    );

    res.json({ token });
  } catch (e) {
    console.error('Token build failed:', e);
    res.status(500).json({ error: 'token generation failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Token server listening on :${PORT}`);
});
