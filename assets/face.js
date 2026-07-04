// VRL Face — browser face capture for VTOKU Cam.
//
// Runs MediaPipe Face Landmarker locally (webcam never leaves the browser), converts the
// 52 ARKit-style blendshapes + head pose into standard VMC OSC bundles, and publishes the
// bytes on the VRL Link room's LiveKit data channel (topic "vmc", lossy) — the exact same
// wire format the app's VMCReceiver already parses from Warudo / the VRL Bridge.
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
const roomInput = $("room"), connectBtn = $("connect"), stopBtn = $("stop"), recenterBtn = $("recenter");
const video = $("cam"), overlay = $("overlay"), statusEl = $("status");
const chipCam = $("chip-cam"), chipTrack = $("chip-track"), chipRoom = $("chip-room"), chipRate = $("chip-rate");
const optMirror = $("opt-mirror"), optPerfect = $("opt-perfect"), optHead = $("opt-head");

let landmarker = null, room = null, running = false, stopping = false;
let lastVideoTime = -1, refQuatInv = null, wantRecenter = true;
let pktCount = 0, pktWindowStart = 0, faceSeen = false, sentKeys = new Set();

roomInput.value = localStorage.getItem("vrlRoom") || "";
const setStatus = (msg, isErr) => {
  statusEl.textContent = msg;
  statusEl.classList.toggle("err", !!isErr);
};
const chip = (el, label, on) => {
  el.textContent = label;
  el.classList.toggle("on", !!on);
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

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  chip(chipCam, "camera on", true);
}

function stopCamera() {
  const s = video.srcObject;
  if (s) for (const t of s.getTracks()) t.stop();
  video.srcObject = null;
  chip(chipCam, "camera off", false);
}

async function connectRoom(roomCode) {
  setStatus("Checking room…");
  const { token, url } = await mintToken(roomCode);
  room = new Room();
  room.on(RoomEvent.Disconnected, () => {
    chip(chipRoom, "room off", false);
    if (running && !stopping) reconnectLoop(roomCode);
  });
  room.on(RoomEvent.Reconnecting, () => chip(chipRoom, "reconnecting…", false));
  room.on(RoomEvent.Reconnected, () => chip(chipRoom, "room on", true));
  setStatus("Connecting…");
  await room.connect(url, token);
  chip(chipRoom, "room on", true);
}

// The LiveKit SDK retries transient blips itself; this covers full drops (e.g. token expiry) by
// re-minting. Stops when the user hits Stop or the room genuinely ends (app disconnected → 404).
async function reconnectLoop(roomCode) {
  for (let attempt = 1; running && !stopping; attempt++) {
    setStatus(`Connection lost — reconnecting (try ${attempt})…`, true);
    await new Promise((r) => setTimeout(r, Math.min(15000, 1500 * attempt)));
    if (!running || stopping) return;
    try {
      await connectRoom(roomCode);
      setStatus("Reconnected. Tracking…");
      return;
    } catch (e) {
      if (String(e.message || e).includes("room not active")) {
        setStatus("Room ended — VRL Link disconnected in the app.", true);
        await stopAll();
        return;
      }
    }
  }
}

function drawOverlay(result) {
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const lm = result?.faceLandmarks?.[0];
  if (!lm) return;
  ctx.fillStyle = "rgba(124, 92, 255, 0.85)";
  for (const p of lm) {
    ctx.fillRect(p.x * overlay.width - 1, p.y * overlay.height - 1, 2, 2);
  }
}

function sendFrame(result) {
  if (!room || room.state !== "connected") return;
  const shapes = result?.faceBlendshapes?.[0]?.categories;
  if (!shapes) {
    // Face lost: zero out everything we were driving so the avatar relaxes instead of freezing.
    if (faceSeen) {
      faceSeen = false;
      chip(chipTrack, "no face", false);
      const zeros = [...sentKeys].map((k) => blendMsg(k, 0));
      zeros.push(oscMessage("/VMC/Ext/Blend/Apply", []));
      for (const b of packBundles(zeros)) publish(b);
    }
    return;
  }
  if (!faceSeen) { faceSeen = true; chip(chipTrack, "tracking", true); }

  const mirror = optMirror.checked;
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

  // packets/s chip (1 s window)
  const now = performance.now();
  pktCount++;
  if (now - pktWindowStart > 1000) {
    chip(chipRate, `${pktCount} fps`, pktCount > 0);
    pktCount = 0; pktWindowStart = now;
  }
}

function publish(bytes) {
  room.localParticipant.publishData(bytes, { reliable: false, topic: "vmc" }).catch(() => {});
}

function loop() {
  if (!running) return;
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    let result = null;
    try { result = landmarker.detectForVideo(video, performance.now()); } catch { /* skip frame */ }
    if (result) { drawOverlay(result); sendFrame(result); }
  }
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => loop());
  else requestAnimationFrame(loop);
}

async function startAll() {
  const roomCode = roomInput.value.trim();
  if (roomCode.length < 8) { setStatus("Enter the room secret from the app (Settings → VRL Link → Copy).", true); return; }
  localStorage.setItem("vrlRoom", roomCode);
  connectBtn.disabled = true;
  try {
    await ensureLandmarker();
    await startCamera();
    await connectRoom(roomCode);
    running = true; stopping = false;
    wantRecenter = true; sentKeys = new Set(); faceSeen = false;
    lastVideoTime = -1; pktCount = 0; pktWindowStart = performance.now();
    stopBtn.disabled = false; recenterBtn.disabled = false;
    document.body.classList.add("live");
    setStatus("Tracking. In the app set Face → Source to VMC.");
    loop();
  } catch (e) {
    setStatus(String(e.message || e), true);
    connectBtn.disabled = false;
    stopCamera();
    if (room) { try { await room.disconnect(); } catch {} room = null; }
  }
}

async function stopAll() {
  stopping = true; running = false;
  stopBtn.disabled = true; recenterBtn.disabled = true;
  if (room) {
    // Relax the avatar before leaving.
    try {
      const zeros = [...sentKeys].map((k) => blendMsg(k, 0));
      if (zeros.length && room.state === "connected") for (const b of packBundles(zeros)) publish(b);
      await new Promise((r) => setTimeout(r, 120));
      await room.disconnect();
    } catch {}
    room = null;
  }
  stopCamera();
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  chip(chipRoom, "room off", false); chip(chipTrack, "no face", false); chip(chipRate, "0 fps", false);
  document.body.classList.remove("live");
  connectBtn.disabled = false;
  if (!statusEl.classList.contains("err")) setStatus("Stopped.");
}

connectBtn.addEventListener("click", startAll);
stopBtn.addEventListener("click", () => { setStatus("Stopped."); stopAll(); });
recenterBtn.addEventListener("click", () => { wantRecenter = true; setStatus("Neutral pose recentered."); });
roomInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !connectBtn.disabled) startAll(); });
window.addEventListener("pagehide", () => { if (room) room.disconnect(); });
