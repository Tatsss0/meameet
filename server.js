import express from "express";
import cors from "cors";
import pkg from "agora-access-token";
const { RtcTokenBuilder, RtcRole } = pkg;

const app = express();
app.use(cors());

const APP_ID = process.env.AGORA_APP_ID || process.env.APP_ID;
const APP_CERT = process.env.AGORA_APP_CERT || process.env.APP_CERT;

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

app.get("/agora/token", (req, res) => {
  try {
    const channel = req.query.room;
    const uidParam = req.query.uid;
    const roleParam = String(req.query.role || "publisher").toLowerCase();
    const role = roleParam === "subscriber" ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;

    if (!channel) {
      return res.status(400).json({ error: "room required" });
    }

    // If certificate is not provided, operate in static (no-token) mode.
    if (!APP_ID) {
      return res.status(500).json({ error: "server env not set (AGORA_APP_ID)" });
    }

    if (!APP_CERT) {
      return res.json({ token: null, mode: "static" });
    }

    const ttlSeconds = Number(req.query.ttl || 3600);
    const expireTs = Math.floor(Date.now() / 1000) + (Number.isFinite(ttlSeconds) ? ttlSeconds : 3600);

    if (!uidParam) {
      // Client may re-try join with uid null; just return null token in that case
      return res.json({ token: null, mode: "dynamic" });
    }

    const num = Number(uidParam);
    const isNumeric = Number.isFinite(num) && num >= 0;

    const token = isNumeric
      ? RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERT, channel, Math.floor(num), role, expireTs)
      : RtcTokenBuilder.buildTokenWithAccount(APP_ID, APP_CERT, channel, String(uidParam), role, expireTs);

    res.json({ token, mode: "dynamic" });
  } catch (e) {
    console.error("Token build failed:", e);
    res.status(500).json({ error: "token generation failed" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Token server listening on :${PORT}`);
});
