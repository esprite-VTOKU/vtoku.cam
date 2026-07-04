// VRL Face — browser face capture for VTOKU Cam.
//
// Runs MediaPipe Face Landmarker locally (webcam never leaves the browser), converts the
// 52 ARKit-style blendshapes + head pose into standard VMC OSC bundles, and publishes the
// bytes on the VRL Link room's LiveKit data channel (topic "vmc", lossy) — the exact same
// wire format the app's VMCReceiver already parses from Warudo / the VRL Bridge.
//
// UI is a small video-call state machine: camera on/off (lobby preview) and joined/left.
// Camera can run without a room (preview + tracking overlay); joining starts sending.
//
// Token: POST https://vrl-token.fly.dev/face-token { room } → { token, url }. The mint is
// data-publish only (no tracks in or out) and requires the room to be live in the app.

import { FilesetResolver, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs";
import { Room, RoomEvent } from "https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.esm.min.mjs";

const qs = new URLSearchParams(location.search);
const TOKEN_URL = qs.get("token") || "https://vrl-token.fly.dev/face-token";
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const MAX_PACKET = 1200;   // stay under one MTU per lossy data packet — VMCReceiver parses each independently

// ── tiny OSC 1.0 encoder (matches the app's VMCReceiver byte-for-byte) ─────────────────────
function oscString(s) {
  const raw = new TextEncoder().encode(s);
  const padded = (raw.length + 1 + 3) & ~3;        // include NUL, round up to /4
  const b = new Uint8Array(padded);                 // zero-filled → NUL pad
  b.set(raw, 0);
  return b;
}
// args: array of { t: 'f'|'s', v }
function oscMessage(address, args) {
  const parts = [oscString(address)];
  let tags = ",";
  for (const a of args) tags += a.t;
  parts.push(oscString(tags));
  for (const a of args) {
    if (a.t === "f") {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setFloat32(0, a.v, false);   // big-endian
      parts.push(b);
    } else {
      parts.push(oscString(a.v));
    }
  }
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
// "#bundle\0" + immediate timetag + [int32 size][element]…
function oscBundle(messages) {
  let len = 16;
  for (const m of messages) len += 4 + m.length;
  const out = new Uint8Array(len);
  out.set(oscString("#bundle"), 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(8, 0, false); dv.setUint32(12, 1, false);   // timetag "immediately"
  let o = 16;
  for (const m of messages) {
    dv.setInt32(o, m.length, false); o += 4;
    out.set(m, o); o += m.length;
  }
  return out;
}
// Pack messages into bundles that each fit one lossy packet.
function packBundles(messages) {
  const bundles = [];
  let batch = [], size = 16;
  for (const m of messages) {
    if (batch.length && size + 4 + m.length > MAX_PACKET) { bundles.push(oscBundle(batch)); batch = []; size = 16; }
    batch.push(m); size += 4 + m.length;
  }
  if (batch.length) bundles.push(oscBundle(batch));
  return bundles;
}

const blendMsg = (name, v) => oscMessage("/VMC/Ext/Blend/Val", [{ t: "s", v: name }, { t: "f", v }]);
const headMsg = (q) => oscMessage("/VMC/Ext/Bone/Pos", [
  { t: "s", v: "Head" }, { t: "f", v: 0 }, { t: "f", v: 0 }, { t: "f", v: 0 },
  { t: "f", v: q[0] }, { t: "f", v: q[1] }, { t: "f", v: q[2] }, { t: "f", v: q[3] },
]);

// ── quaternion helpers (arrays [x,y,z,w]) ──────────────────────────────────────────────────
function quatFromMatrix(m) {   // m: column-major 4x4 (MediaPipe facialTransformationMatrix)
  const m00 = m[0], m01 = m[4], m02 = m[8];
  const m10 = m[1], m11 = m[5], m12 = m[9];
  const m20 = m[2], m21 = m[6], m22 = m[10];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4;
  }
  return [x, y, z, w];
}
const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
function qMul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

// ── blendshape mapping ──────────────────────────────────────────────────────────────────────
// MediaPipe emits the ARKit 52 by name (eyeBlinkLeft, jawOpen, …). Two send modes:
//  standard — derive the VRM0 presets every avatar answers to (A/I/U/O, Blink_L/R, Look*)
//  perfect sync — pass the ARKit names straight through (rigs with perfect-sync morphs)
const MIRROR_SWAP = /Left|Right/;
const mirrorName = (n) => n.replace(MIRROR_SWAP, (m) => (m === "Left" ? "Right" : "Left"));

function standardBlends(b) {
  const g = (k) => b[k] || 0;
  const lookH = (g("eyeLookOutRight") + g("eyeLookInLeft")) / 2 - (g("eyeLookOutLeft") + g("eyeLookInRight")) / 2;
  const lookV = (g("eyeLookUpLeft") + g("eyeLookUpRight")) / 2 - (g("eyeLookDownLeft") + g("eyeLookDownRight")) / 2;
  return {
    A: Math.min(1, g("jawOpen") * 1.2),
    I: Math.min(1, (g("mouthStretchLeft") + g("mouthStretchRight")) / 2),
    U: Math.min(1, g("mouthPucker")),
    O: Math.min(1, g("mouthFunnel")),
    Blink_L: g("eyeBlinkLeft"),
    Blink_R: g("eyeBlinkRight"),
    LookRight: Math.max(0, Math.min(1, lookH)),
    LookLeft: Math.max(0, Math.min(1, -lookH)),
    LookUp: Math.max(0, Math.min(1, lookV)),
    LookDown: Math.max(0, Math.min(1, -lookV)),
  };
}

// ── UI ──────────────────────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const stage = $("stage"), video = $("cam"), overlay = $("overlay"), statusEl = $("status");
const roomInput = $("room"), joinBtn = $("join");
const joinForm = $("join-form"), sessionInfo = $("session-info"), sessionRoom = $("session-room");
const btnCam = $("btn-cam"), btnMirror = $("btn-mirror"), btnRecenter = $("btn-recenter"), btnLeave = $("btn-leave");
const chipRoom = $("chip-room"), chipTrack = $("chip-track"), chipRate = $("chip-rate");
const optHead = $("opt-head"), optPerfect = $("opt-perfect");

let landmarker = null, room = null;
let camOn = false, joined = false, leaving = false;
let lastVideoTime = -1, refQuatInv = null, wantRecenter = true;
let pktCount = 0, pktWindowStart = 0, faceSeen = false, sentKeys = new Set();

roomInput.value = localStorage.getItem("vrlRoom") || "";
const setStatus = (msg, isErr) => {
  statusEl.textContent = msg;
  statusEl.classList.toggle("err", !!isErr);
};
const mirrored = () => btnMirror.getAttribute("aria-pressed") === "true";
// Show only the memorable prefix of the secret on the overlay — the full code stays private
// even if the tab is on stream.
const maskRoom = (r) => {
  const cut = r.search(/[-_ .:]/);
  return cut > 0 ? r.slice(0, cut + 1) + "…" : r.slice(0, 4) + "…";
};

async function mintToken(roomCode) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ room: roomCode }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `token service error (${res.status})`);
  return body;   // { token, url }
}

async function ensureLandmarker() {
  if (landmarker) return;
  setStatus("Loading face tracker…");
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
  try {
    landmarker = await FaceLandmarker.createFromOptions(fileset, opts("GPU"));
  } catch {
    landmarker = await FaceLandmarker.createFromOptions(fileset, opts("CPU"));
  }
}

// ── camera on/off (independent of the room, like any call app) ─────────────────────────────
async function cameraOn() {
  await ensureLandmarker();
  setStatus("Starting camera…");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  camOn = true;
  lastVideoTime = -1; wantRecenter = true; faceSeen = false;
  stage.classList.add("cam");
  btnCam.classList.remove("is-off");
  btnRecenter.disabled = false;
  chipTrack.hidden = false; chipTrack.textContent = "no face";
  setStatus(joined ? "Tracking." : "Camera preview only — join a room to send.");
  loop();
}

function cameraOff() {
  camOn = false;
  const s = video.srcObject;
  if (s) for (const t of s.getTracks()) t.stop();
  video.srcObject = null;
  overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
  stage.classList.remove("cam");
  btnCam.classList.add("is-off");
  btnRecenter.disabled = true;
  chipTrack.hidden = true; chipRate.hidden = true;
  if (joined) zeroBlends();   // camera muted mid-call → relax the avatar, stay in the room
}

// ── room join/leave ─────────────────────────────────────────────────────────────────────────
async function connectRoom(roomCode) {
  setStatus("Checking room…");
  const { token, url } = await mintToken(roomCode);
  room = new Room();
  room.on(RoomEvent.Disconnected, () => {
    if (joined && !leaving) reconnectLoop(roomCode);
  });
  room.on(RoomEvent.Reconnecting, () => setStatus("Connection blip — recovering…"));
  room.on(RoomEvent.Reconnected, () => setStatus("Tracking."));
  setStatus("Connecting…");
  await room.connect(url, token);
}

async function join() {
  const roomCode = roomInput.value.trim();
  if (roomCode.length < 8) { setStatus("Enter the room secret from the app (Settings → VRL Link → Copy).", true); return; }
  localStorage.setItem("vrlRoom", roomCode);
  joinBtn.disabled = true;
  try {
    if (!camOn) await cameraOn();
    await connectRoom(roomCode);
    joined = true; leaving = false;
    sentKeys = new Set(); pktCount = 0; pktWindowStart = performance.now();
    joinForm.hidden = true; sessionInfo.hidden = false;
    sessionRoom.textContent = maskRoom(roomCode);
    chipRoom.hidden = false; chipRoom.textContent = maskRoom(roomCode);
    chipRate.hidden = false; chipRate.textContent = "0 fps";
    btnLeave.hidden = false;
    setStatus("Tracking. In the app set Face → Source to VMC.");
  } catch (e) {
    setStatus(String(e.message || e), true);
    if (room) { try { await room.disconnect(); } catch {} room = null; }
    joinBtn.disabled = false;
  }
}

async function leave(message) {
  leaving = true; joined = false;
  if (room) {
    try {
      if (room.state === "connected") { zeroBlends(); await new Promise((r) => setTimeout(r, 120)); }
      await room.disconnect();
    } catch {}
    room = null;
  }
  joinForm.hidden = false; sessionInfo.hidden = true;
  chipRoom.hidden = true; chipRate.hidden = true;
  btnLeave.hidden = true;
  joinBtn.disabled = false;
  setStatus(message || "Left the room. Camera preview stays local.");
}

// The LiveKit SDK retries transient blips itself; this covers full drops (e.g. token expiry) by
// re-minting. Stops when the user leaves or the room genuinely ends (app disconnected → 404).
async function reconnectLoop(roomCode) {
  for (let attempt = 1; joined && !leaving; attempt++) {
    setStatus(`Connection lost — reconnecting (try ${attempt})…`, true);
    await new Promise((r) => setTimeout(r, Math.min(15000, 1500 * attempt)));
    if (!joined || leaving) return;
    try {
      await connectRoom(roomCode);
      setStatus("Reconnected. Tracking.");
      return;
    } catch (e) {
      if (String(e.message || e).includes("room not active")) {
        await leave("Room ended — VRL Link disconnected in the app.");
        return;
      }
    }
  }
}

// ── per-frame: draw, map, send ──────────────────────────────────────────────────────────────
function drawOverlay(result) {
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const lm = result?.faceLandmarks?.[0];
  if (!lm) return;
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  for (const p of lm) {
    ctx.fillRect(p.x * overlay.width - 1, p.y * overlay.height - 1, 2, 2);
  }
}

function zeroBlends() {
  if (!room || room.state !== "connected" || !sentKeys.size) return;
  const zeros = [...sentKeys].map((k) => blendMsg(k, 0));
  zeros.push(oscMessage("/VMC/Ext/Blend/Apply", []));
  for (const b of packBundles(zeros)) publish(b);
}

function sendFrame(result) {
  if (!joined || !room || room.state !== "connected") return;
  const shapes = result?.faceBlendshapes?.[0]?.categories;
  if (!shapes) {
    if (faceSeen) { faceSeen = false; chipTrack.textContent = "no face"; chipTrack.classList.add("warn"); zeroBlends(); }
    return;
  }
  if (!faceSeen) { faceSeen = true; chipTrack.textContent = "tracking"; chipTrack.classList.remove("warn"); }

  const mirror = mirrored();
  const b = {};
  for (const c of shapes) b[c.categoryName] = c.score;

  const messages = [];

  if (optHead.checked) {
    const m = result.facialTransformationMatrixes?.[0]?.data;
    if (m) {
      // MediaPipe head pose (right-handed, camera-facing) → Unity (left-handed): flip Z.
      let q = quatFromMatrix(m);
      q = [-q[0], -q[1], q[2], q[3]];
      if (wantRecenter) { refQuatInv = qConj(q); wantRecenter = false; }
      if (refQuatInv) q = qMul(refQuatInv, q);          // rotation relative to the neutral pose
      if (mirror) q = [q[0], -q[1], -q[2], q[3]];       // mirror across the vertical axis
      messages.push(headMsg(q));
    }
  }

  const emit = (name, v) => {
    const n = mirror ? mirrorName(name) : name;
    sentKeys.add(n);
    messages.push(blendMsg(n, v));
  };

  if (optPerfect.checked) {
    for (const c of shapes) {
      if (c.categoryName === "_neutral") continue;
      emit(c.categoryName, c.score);
    }
  } else {
    for (const [name, v] of Object.entries(standardBlends(b))) emit(name, v);
  }
  messages.push(oscMessage("/VMC/Ext/Blend/Apply", []));

  for (const bundle of packBundles(messages)) publish(bundle);

  // frames-sent/s chip (1 s window)
  const now = performance.now();
  pktCount++;
  if (now - pktWindowStart > 1000) {
    chipRate.textContent = `${pktCount} fps`;
    pktCount = 0; pktWindowStart = now;
  }
}

function publish(bytes) {
  room.localParticipant.publishData(bytes, { reliable: false, topic: "vmc" }).catch(() => {});
}

function loop() {
  if (!camOn) return;
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    let result = null;
    try { result = landmarker.detectForVideo(video, performance.now()); } catch { /* skip frame */ }
    if (result) {
      drawOverlay(result);
      if (!joined) {   // lobby: still show the tracking state on the preview
        const has = !!result.faceLandmarks?.[0];
        if (has !== faceSeen) {
          faceSeen = has;
          chipTrack.textContent = has ? "tracking" : "no face";
          chipTrack.classList.toggle("warn", !has);
        }
      }
      sendFrame(result);
    }
  }
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => loop());
  else requestAnimationFrame(loop);
}

// ── wiring ──────────────────────────────────────────────────────────────────────────────────
btnCam.addEventListener("click", async () => {
  if (camOn) { cameraOff(); setStatus(joined ? "Camera off — still in the room." : "Camera off."); return; }
  try { await cameraOn(); } catch (e) { setStatus(String(e.message || e), true); }
});
btnMirror.addEventListener("click", () => {
  btnMirror.setAttribute("aria-pressed", mirrored() ? "false" : "true");
});
btnRecenter.addEventListener("click", () => { wantRecenter = true; setStatus("Neutral head pose recentered."); });
btnLeave.addEventListener("click", () => leave());
joinBtn.addEventListener("click", join);
roomInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !joinBtn.disabled) join(); });
window.addEventListener("pagehide", () => { if (room) room.disconnect(); });
