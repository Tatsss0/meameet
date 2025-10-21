/* Client: Agora Web SDK setup with token fallback */

const APP_ID = "7bd059c9b0e043c2b0f335954214327a";

const params = new URLSearchParams(window.location.search);
const CHANNEL = params.get("room") || "TechMed";
const TOKEN_PARAM = params.get("token") || null;
const TOKEN_SERVER = params.get("tokenServer") || "http://localhost:3001";

const isDoctor = (params.get("as") || "").toLowerCase() === "doctor";
const hostUidParam = params.get("hostUid") || null;
const patientUidParam = params.get("uid") || null;

const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

let localTracks = [];
let remoteUsers = {};
let localUID = null;
let isJoining = false;
let eventsBound = false;

function stableHashToUint32(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  // Ensure positive 32-bit integer
  return (hash >>> 0) % 4294967295;
}

function coerceToNumericUid(raw) {
  if (raw == null) return null;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber >= 0) return Math.floor(asNumber);
  const hashed = stableHashToUint32(String(raw));
  return hashed === 0 ? 1 : hashed; // avoid 0
}

async function getToken(channel, uid) {
  if (TOKEN_PARAM) return TOKEN_PARAM;
  if (uid == null) return null;
  try {
    const url = `${TOKEN_SERVER}/agora/token?room=${encodeURIComponent(channel)}&uid=${encodeURIComponent(uid)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`token fetch failed: ${res.status}`);
    const data = await res.json();
    return data && typeof data.token === "string" ? data.token : null;
  } catch (e) {
    console.error("Token fetch error:", e);
    return null;
  }
}

function shouldFallbackToStatic(err, attemptedToken) {
  if (!attemptedToken) return false;
  const code = err && (err.code || err.name || "");
  const msg = (err && (err.message || "")) || "";
  if (String(code).toUpperCase() === "CAN_NOT_GET_GATEWAY_SERVER") return true;
  if (/dynamic\s+use\s+static\s+key/i.test(msg)) return true;
  if (/DYNAMIC_USE_STATIC_KEY/i.test(msg)) return true;
  return false;
}

async function joinWithPossibleFallback(channel, uid) {
  const token = await getToken(channel, uid);
  try {
    localUID = await client.join(APP_ID, channel, token || null, uid ?? null);
    return;
  } catch (e) {
    console.error("Agora join failed (first attempt):", e);
    if (shouldFallbackToStatic(e, token)) {
      try {
        console.warn("Retrying join with static (no token)...");
        localUID = await client.join(APP_ID, channel, null, uid ?? null);
        return;
      } catch (e2) {
        console.error("Agora join failed (static retry):", e2);
        throw e2;
      }
    }
    throw e;
  }
}

async function ensureEventsBound() {
  if (eventsBound) return;
  client.on("user-published", handleUserJoined);
  client.on("user-left", handleUserLeft);
  eventsBound = true;
}

async function joinAndDisplayLocalStream() {
  await ensureEventsBound();

  if (isDoctor && !hostUidParam) {
    alert("Missing hostUid for doctor. Use ?hostUid=<DOCTOR_UID>");
    return;
  }

  const desiredRaw = isDoctor ? hostUidParam : patientUidParam;
  const desiredUid = coerceToNumericUid(desiredRaw) ?? coerceToNumericUid(String(Math.floor(Math.random() * 1e9)));

  try {
    await joinWithPossibleFallback(CHANNEL, desiredUid);
  } catch (e) {
    console.error("Agora join ultimately failed:", e);
    alert(`Join failed: ${e.code || ""} ${e.message || e}`);
    return;
  }

  try {
    localTracks = await AgoraRTC.createMicrophoneAndCameraTracks();
  } catch (e) {
    console.error("Failed to create local tracks:", e);
    alert("Could not access microphone/camera.");
    return;
  }

  const containerHtml = `
    <div class="video-container" id="user-container-${localUID}">
      <div class="video-player" id="user-${localUID}"></div>
    </div>`;
  const streamRoot = document.getElementById("video-streams");
  if (streamRoot) streamRoot.insertAdjacentHTML("beforeend", containerHtml);

  localTracks[1].play(`user-${localUID}`);
  await client.publish([localTracks[0], localTracks[1]]);
}

async function joinStream() {
  if (isJoining) return;
  isJoining = true;
  try {
    await joinAndDisplayLocalStream();
    const joinBtn = document.getElementById("join-btn");
    const controls = document.getElementById("stream-controls");
    if (joinBtn) joinBtn.style.display = "none";
    if (controls) controls.style.display = "flex";
  } finally {
    isJoining = false;
  }
}

async function handleUserJoined(user, mediaType) {
  remoteUsers[user.uid] = user;
  await client.subscribe(user, mediaType);

  if (mediaType === "video") {
    let player = document.getElementById(`user-container-${user.uid}`);
    if (player) player.remove();
    const html = `
      <div class="video-container" id="user-container-${user.uid}">
        <div class="video-player" id="user-${user.uid}"></div>
      </div>`;
    const streamRoot = document.getElementById("video-streams");
    if (streamRoot) streamRoot.insertAdjacentHTML("beforeend", html);
    user.videoTrack.play(`user-${user.uid}`);
  }

  if (mediaType === "audio") user.audioTrack.play();
}

async function handleUserLeft(user) {
  delete remoteUsers[user.uid];
  const el = document.getElementById(`user-container-${user.uid}`);
  if (el) el.remove();
}

async function leaveAndRemoveLocalStream() {
  try {
    for (let i = 0; i < localTracks.length; i++) {
      try { localTracks[i].stop(); } catch {}
      try { localTracks[i].close(); } catch {}
    }
  } finally {
    localTracks = [];
  }

  try {
    await client.leave();
  } catch (e) {
    console.warn("Leave error (ignored):", e);
  }

  const joinBtn = document.getElementById("join-btn");
  const controls = document.getElementById("stream-controls");
  const streamRoot = document.getElementById("video-streams");
  if (joinBtn) joinBtn.style.display = "block";
  if (controls) controls.style.display = "none";
  if (streamRoot) streamRoot.innerHTML = "";
  localUID = null;
}

async function toggleMic(e) {
  if (!localTracks[0]) return;
  if (localTracks[0].muted) {
    await localTracks[0].setMuted(false);
    if (e && e.target) {
      e.target.innerText = "Mic on";
      e.target.style.backgroundColor = "cadetblue";
    }
  } else {
    await localTracks[0].setMuted(true);
    if (e && e.target) {
      e.target.innerText = "Mic off";
      e.target.style.backgroundColor = "#EE4B2B";
    }
  }
}

async function toggleCamera(e) {
  if (!localTracks[1]) return;
  if (localTracks[1].muted) {
    await localTracks[1].setMuted(false);
    if (e && e.target) {
      e.target.innerText = "Camera on";
      e.target.style.backgroundColor = "cadetblue";
    }
  } else {
    await localTracks[1].setMuted(true);
    if (e && e.target) {
      e.target.innerText = "Camera off";
      e.target.style.backgroundColor = "#EE4B2B";
    }
  }
}

const joinBtnEl = document.getElementById("join-btn");
const leaveBtnEl = document.getElementById("leave-btn");
const micBtnEl = document.getElementById("mic-btn");
const camBtnEl = document.getElementById("camera-btn");
if (joinBtnEl) joinBtnEl.addEventListener("click", joinStream);
if (leaveBtnEl) leaveBtnEl.addEventListener("click", leaveAndRemoveLocalStream);
if (micBtnEl) micBtnEl.addEventListener("click", toggleMic);
if (camBtnEl) camBtnEl.addEventListener("click", toggleCamera);
