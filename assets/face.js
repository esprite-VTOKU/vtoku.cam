// VRL Link web sender — browser motion capture for VTOKU Cam.
//
// Tracks face + upper body + hands locally (MediaPipe Holistic + Kalidokit solvers), converts
// the result into standard VMC OSC bundles, and publishes the bytes on the VRL Link room's
// LiveKit data channel (topic "vmc", lossy) — the exact wire format the app's VMCReceiver
// already parses. The room grant is data-only for publishing (canPublish=false), so this page
// PHYSICALLY cannot send the webcam video; it subscribes to the phone's return "program" feed
// and shows it as the main stage view (the self preview becomes a corner PiP).
//
// Hips are never sent, so the avatar stays planted on its stage (same rule as the app's own
// body capture). One "Tracking" switch pauses everything; blends and bones relax on pause.
//
// Token: POST https://vrl-token.fly.dev/face-token { room } → { token, url }.

import { FilesetResolver, HolisticLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs";
import { Room, RoomEvent } from "https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.esm.min.mjs";

const qs = new URLSearchParams(location.search);
const TOKEN_URL = qs.get("token") || "https://vrl-token.fly.dev/face-token";
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const HOLISTIC_MODEL = "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task";
const KALIDOKIT_URL = "https://cdn.jsdelivr.net/npm/kalidokit@1.1.5/dist/kalidokit.es.js";
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
const boneMsg = (name, q) => oscMessage("/VMC/Ext/Bone/Pos", [
  { t: "s", v: name }, { t: "f", v: 0 }, { t: "f", v: 0 }, { t: "f", v: 0 },
  { t: "f", v: q[0] }, { t: "f", v: q[1] }, { t: "f", v: q[2] }, { t: "f", v: q[3] },
]);

// ── quaternion helpers (arrays [x,y,z,w]) ──────────────────────────────────────────────────
// three.js-style XYZ-order Euler (radians) → quaternion.
function quatFromEuler(x, y, z) {
  const c1 = Math.cos(x / 2), s1 = Math.sin(x / 2);
  const c2 = Math.cos(y / 2), s2 = Math.sin(y / 2);
  const c3 = Math.cos(z / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
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
// Right-handed (MediaPipe/three) → Unity left-handed: flip Z. If a rotation runs the wrong
// way on device, this pair of helpers is the one place to tune signs.
const toUnity = (q) => [-q[0], -q[1], q[2], q[3]];
const mirrorQ = (q) => [q[0], -q[1], -q[2], q[3]];   // mirror across the vertical axis

// ── blendshape mapping ──────────────────────────────────────────────────────────────────────
// MediaPipe emits the ARKit 52 by name (eyeBlinkLeft, jawOpen, …) — perfect-sync passthrough,
// always on (product decision 2026-07-04; rigs are expected to carry the ARKit morphs).
const MIRROR_SWAP = /Left|Right/;
const mirrorName = (n) => n.replace(MIRROR_SWAP, (m) => (m === "Left" ? "Right" : "Left"));

// ── UI ──────────────────────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const stage = $("stage"), video = $("cam"), overlay = $("overlay"), returnEl = $("return");
const joinForm = $("join-form"), roomInput = $("room"), joinBtn = $("join"), statusEl = $("status");
const btnCam = $("btn-cam"), btnMic = $("btn-mic"), btnFace = $("btn-face"), btnBody = $("btn-body"), btnRecenter = $("btn-recenter");
const btnGear = $("btn-gear"), btnLeave = $("btn-leave"), menu = $("menu");
const chipRoom = $("chip-room"), chipTrack = $("chip-track"), chipRate = $("chip-rate"), chipHint = $("chip-hint");
const optMirror = $("opt-mirror"), optBlind = $("opt-blind");
const roomEye = $("room-eye"), obsBox = $("obs"), obsUrl = $("obs-url"), obsCopy = $("obs-copy"), obsI = $("obs-i"), obsHint = $("obs-hint");
const faceOn = () => btnFace.getAttribute("aria-pressed") === "true";
const bodyOn = () => btnBody.getAttribute("aria-pressed") === "true";

let holo = null, Kalidokit = null, trackersLoading = null;
let room = null, remoteAudioEls = [];
let camOn = false, joined = false, leaving = false, micOn = false, micBusy = false;
// Tracker health: surface failures instead of dying silently, and retry on CPU once if the
// GPU delegate keeps throwing (some browsers init GPU fine but fail per-frame).
let detectFails = 0, lastGoodDetect = 0, lastErrMsg = "", cpuFallbackTried = false, reinitBusy = false, stalled = false;
let lastVideoTime = -1, refQuatInv = null, wantRecenter = true;
let pktCount = 0, pktWindowStart = 0, faceSeen = false;
let sentKeys = new Set(), sentBones = new Set();
let hintTimer = 0;
let lastTrackTime = 0, faceRelaxed = false;   // debounce face-neutralize on brief tracking blips

roomInput.value = localStorage.getItem("vrlRoom") || "";
// Pre-join messages land in the dialog; once it hides, they surface as an overlay chip.
function setStatus(msg, isErr) {
  if (joined) {
    chipHint.textContent = msg;
    chipHint.hidden = !msg;
    chipHint.classList.toggle("warn", !!isErr);
    clearTimeout(hintTimer);
    if (msg && !isErr) hintTimer = setTimeout(() => { chipHint.hidden = true; }, 8000);
  } else {
    statusEl.textContent = msg;
    statusEl.classList.toggle("err", !!isErr);
  }
}
// Show only the memorable prefix of the secret on the overlay — the full code stays private
// even if the tab is on stream.
const maskRoom = (r) => {
  const cut = r.search(/[-_ .:]/);
  return cut > 0 ? r.slice(0, cut + 1) + "…" : r.slice(0, 4) + "…";
};

// The OBS browser-source URL is valid as soon as there's a key (the source retries until the room
// goes live), so surface the field pre-join — not only after connecting.
function refreshObs() {
  const key = roomInput.value.trim();
  if (key.length >= 8) {
    obsUrl.value = `${location.origin}${location.pathname}#watch=${encodeURIComponent(key)}`;
    obsBox.hidden = false;
  } else {
    obsBox.hidden = true;
  }
}

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

// ── tracker (holistic model + kalidokit solvers, loaded once) ───────────────────────────────
function ensureTrackers() {
  if (!trackersLoading) {
    trackersLoading = (async () => {
      setStatus("Loading tracker…");
      const mod = await import(KALIDOKIT_URL);
      Kalidokit = mod.default ?? mod;
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: HOLISTIC_MODEL, delegate },
        runningMode: "VIDEO",
        outputFaceBlendshapes: true,
      });
      try { holo = await HolisticLandmarker.createFromOptions(fileset, opts("GPU")); }
      catch { holo = await HolisticLandmarker.createFromOptions(fileset, opts("CPU")); }
      setStatus("");
    })();
    trackersLoading.catch(() => { trackersLoading = null; });   // allow retry after a failed load
  }
  return trackersLoading;
}

// ── camera on/off (independent of the room, like any call app) ─────────────────────────────
async function cameraOn() {
  await ensureTrackers();
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
  detectFails = 0; lastGoodDetect = performance.now(); stalled = false;
  stage.classList.add("cam");
  btnCam.classList.remove("is-off");
  btnRecenter.disabled = false;
  chipTrack.hidden = false; chipTrack.textContent = "no face";
  setStatus("");
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
  neutralizeFace();   // camera muted mid-call → face neutral; body idles app-side. Stay in the room.
}

// Shape the stage to the return feed so a portrait (9:16) program isn't cropped into the
// default 16:9 box. Skipped in OBS watch mode (fixed full-viewport, contain handles it).
function fitReturnAspect() {
  if (document.body.classList.contains("watch")) return;
  const w = returnEl.videoWidth, h = returnEl.videoHeight;
  if (!w || !h) return;
  stage.style.aspectRatio = `${w} / ${h}`;
  stage.classList.toggle("portrait-feed", h > w);
}
function clearReturnAspect() {
  stage.style.aspectRatio = "";
  stage.classList.remove("portrait-feed");
}

// ── room join/leave ─────────────────────────────────────────────────────────────────────────
function attachTrack(track) {
  if (track.kind === "video") {
    track.attach(returnEl);
    stage.classList.add("return");
    returnEl.addEventListener("resize", fitReturnAspect);   // intrinsic size arrives async
    fitReturnAspect();
  } else if (track.kind === "audio") {
    const el = track.attach();          // hear the operator (return feed audio)
    remoteAudioEls.push(el);
    document.body.appendChild(el);
  }
}
function detachAll() {
  stage.classList.remove("return");
  returnEl.removeEventListener("resize", fitReturnAspect);
  clearReturnAspect();
  for (const el of remoteAudioEls) el.remove();
  remoteAudioEls = [];
}

async function connectRoom(roomCode) {
  setStatus("Checking room…");
  const { token, url } = await mintToken(roomCode);
  room = new Room();
  room.on(RoomEvent.TrackSubscribed, (track) => attachTrack(track));
  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    if (track.kind === "video") { stage.classList.remove("return"); clearReturnAspect(); }
    track.detach();
  });
  room.on(RoomEvent.Disconnected, () => {
    detachAll();
    if (joined && !leaving) reconnectLoop(roomCode);
  });
  room.on(RoomEvent.Reconnecting, () => setStatus("Reconnecting…"));
  room.on(RoomEvent.Reconnected, () => setStatus(""));
  setStatus("Connecting…");
  await room.connect(url, token);
}

async function join() {
  const roomCode = roomInput.value.trim();
  if (roomCode.length < 8) { setStatus("Paste the room key from the app.", true); return; }
  localStorage.setItem("vrlRoom", roomCode);
  joinBtn.disabled = true;
  try {
    if (!camOn) await cameraOn();
    await connectRoom(roomCode);
    joined = true; leaving = false;
    sentKeys = new Set(); sentBones = new Set();
    pktCount = 0; pktWindowStart = performance.now();
    stage.classList.add("live");
    chipRoom.hidden = false; chipRoom.textContent = maskRoom(roomCode);
    chipRate.hidden = false; chipRate.textContent = "0 fps";
    btnLeave.hidden = false; btnMic.disabled = false;
    refreshObs();
    setStatus("In the app, set Face Source to VMC.");
  } catch (e) {
    joined = false;
    setStatus(String(e.message || e), true);
    if (room) { try { await room.disconnect(); } catch {} room = null; }
  }
  joinBtn.disabled = false;
}

async function leave(message) {
  leaving = true;
  if (room) {
    try {
      if (room.state === "connected") { neutralizeFace(); await new Promise((r) => setTimeout(r, 120)); }
      await room.disconnect();
    } catch {}
    room = null;
  }
  joined = false;
  detachAll();
  stage.classList.remove("live");
  chipRoom.hidden = true; chipRate.hidden = true; chipHint.hidden = true;
  btnLeave.hidden = true;   // OBS field stays as long as a key is present (refreshObs)
  micOn = false; btnMic.disabled = true; btnMic.classList.add("is-off");
  setStatus(message || "");
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
      setStatus("");
      return;
    } catch (e) {
      if (String(e.message || e).includes("room not active")) {
        await leave("Room ended — VRL Link disconnected in the app.");
        return;
      }
    }
  }
}

// ── per-frame draw: cyberpunk glow mesh ─────────────────────────────────────────────────────
// Neon wireframe over the (optionally hidden) camera. Additive compositing ('lighter') makes
// overlapping strokes bloom; one batched stroke per group keeps the shadowBlur cost to a few
// calls/frame. Face uses the contour connection set (crisp, ~130 lines) plus a sparse vertex
// field for the "tracked mesh" look; pose + hands use their skeleton connection sets.
function strokeConnections(ctx, lms, connections, color, width, blur, gate) {
  if (!connections || !connections.length) return;   // static conn-set missing in this build
  const W = overlay.width, H = overlay.height;
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round";
  ctx.shadowColor = color; ctx.shadowBlur = blur;
  ctx.beginPath();
  for (const c of connections) {
    const a = lms[c.start], b = lms[c.end];
    if (!a || !b || (a.visibility ?? 1) < gate || (b.visibility ?? 1) < gate) continue;
    ctx.moveTo(a.x * W, a.y * H); ctx.lineTo(b.x * W, b.y * H);
  }
  ctx.stroke();
}
function fillPoints(ctx, lms, color, r, blur, gate) {
  const W = overlay.width, H = overlay.height;
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = blur;
  ctx.beginPath();
  for (const p of lms) {
    if ((p.visibility ?? 1) < gate) continue;
    ctx.moveTo(p.x * W + r, p.y * H);
    ctx.arc(p.x * W, p.y * H, r, 0, Math.PI * 2);
  }
  ctx.fill();
}
const CYAN = "rgba(64, 224, 255, 0.85)";
const MAGENTA = "rgba(255, 90, 200, 0.9)";
const LIME = "rgba(150, 255, 130, 0.9)";
function drawOverlay(result) {
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (faceOn() && result.faceLandmarks?.[0]) {
    const f = result.faceLandmarks[0];
    strokeConnections(ctx, f, HolisticLandmarker.FACE_LANDMARKS_TESSELATION, "rgba(64, 224, 255, 0.16)", 0.5, 0, 0);
    strokeConnections(ctx, f, HolisticLandmarker.FACE_LANDMARKS_CONTOURS, CYAN, 1.4, 8, 0);
    fillPoints(ctx, f, "rgba(180, 245, 255, 0.9)", 1.1, 6, 0);
  }
  if (bodyOn()) {
    if (result.poseLandmarks?.[0]) {
      strokeConnections(ctx, result.poseLandmarks[0], HolisticLandmarker.POSE_CONNECTIONS, MAGENTA, 3, 12, 0.5);
      fillPoints(ctx, result.poseLandmarks[0], MAGENTA, 3, 10, 0.5);
    }
    for (const side of ["leftHandLandmarks", "rightHandLandmarks"]) {
      if (result[side]?.[0]) {
        strokeConnections(ctx, result[side][0], HolisticLandmarker.HAND_CONNECTIONS, LIME, 2, 9, 0);
        fillPoints(ctx, result[side][0], LIME, 2, 7, 0);
      }
    }
  }
  ctx.restore();
  ctx.shadowBlur = 0;
}

// Zero the expression blends we've driven, once, so the face returns to neutral. NEVER touches
// bones: identity bone rotations = the rig's bind pose (a T/A-pose), so sending them on a dropout
// is exactly what made the avatar snap to a T-pose. The app relaxes the BODY on its own — when our
// bone packets stop arriving it falls back to the local idle/dance after ~0.5s (VMCReceiver.bodyLive),
// holding the last real pose in between instead of flashing the bind pose.
function neutralizeFace() {
  if (!room || room.state !== "connected" || !sentKeys.size) return;
  const msgs = [...sentKeys].map((k) => blendMsg(k, 0));
  msgs.push(oscMessage("/VMC/Ext/Blend/Apply", []));
  for (const b of packBundles(msgs)) publish(b);
}

// Kalidokit gives XYZ Euler rigs (three.js convention); convert to a mirrored/unmirrored
// Unity-space VMC bone message. `amp` tames or boosts a chain if it overshoots on device.
// Non-finite eulers are dropped — Kalidokit emits NaN on degenerate landmarks, and one NaN
// quaternion freezes the bone on the receiving end.
function pushBone(messages, mirror, name, e, amp = 1) {
  if (!e || !Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.z)) return;
  let q = toUnity(quatFromEuler(e.x * amp, e.y * amp, e.z * amp));
  let n = name;
  if (mirror) { n = mirrorName(name); q = mirrorQ(q); }
  sentBones.add(n);
  messages.push(boneMsg(n, q));
}
function sendFrame(result) {
  if (!joined || !room || room.state !== "connected") return;
  const fOn = faceOn(), bOn = bodyOn();
  const shapes = fOn ? result.faceBlendshapes?.[0]?.categories : null;
  const hasFace = fOn && !!result.faceLandmarks?.[0];
  const hasPose = bOn && !!result.poseLandmarks?.[0];
  if (!hasFace && !hasPose) {
    if (faceSeen) { faceSeen = false; chipTrack.textContent = "no face"; chipTrack.classList.add("warn"); }
    // Only neutralize after a SUSTAINED loss (~0.5s). A one-frame blip (motion blur, quick turn)
    // holds the last expression + pose instead of flashing neutral — that flicker was interrupting
    // both the face and the body. The body relaxes on its own app-side (we just stop sending bones).
    if (!faceRelaxed && performance.now() - lastTrackTime > 500) { neutralizeFace(); faceRelaxed = true; }
    return;
  }
  faceRelaxed = false; lastTrackTime = performance.now();
  if (!faceSeen) { faceSeen = true; chipTrack.textContent = "tracking"; chipTrack.classList.remove("warn"); }

  const mirror = optMirror.checked;
  const messages = [];

  // Head (Kalidokit face solve over the holistic landmarks).
  if (hasFace) try {
    const f = Kalidokit.Face.solve(result.faceLandmarks[0], { runtime: "mediapipe", video });
    if (f?.head) {
      let headQ = toUnity(quatFromEuler(f.head.x, f.head.y, f.head.z));
      if (wantRecenter) { refQuatInv = qConj(headQ); wantRecenter = false; }
      if (refQuatInv) headQ = qMul(refQuatInv, headQ);
      if (mirror) headQ = mirrorQ(headQ);
      sentBones.add("Head");
      messages.push(boneMsg("Head", headQ));
    }
  } catch { /* face solve can fail on partial landmarks */ }

  // Upper body + hands.
  if (bOn) try {
    if (result.poseWorldLandmarks?.[0] && result.poseLandmarks?.[0]) {
      const rig = Kalidokit.Pose.solve(result.poseWorldLandmarks[0], result.poseLandmarks[0],
                                       { runtime: "mediapipe", video });
      if (rig) {
        pushBone(messages, mirror, "Spine", rig.Spine, 0.6);
        pushBone(messages, mirror, "LeftUpperArm", rig.LeftUpperArm);
        pushBone(messages, mirror, "LeftLowerArm", rig.LeftLowerArm);
        pushBone(messages, mirror, "RightUpperArm", rig.RightUpperArm);
        pushBone(messages, mirror, "RightLowerArm", rig.RightLowerArm);
        // Wrist fallback from pose; overwritten below when the hand solver has real data.
        if (!result.leftHandLandmarks?.[0]) pushBone(messages, mirror, "LeftHand", rig.LeftHand);
        if (!result.rightHandLandmarks?.[0]) pushBone(messages, mirror, "RightHand", rig.RightHand);
      }
    }
    // On a pose/hand dropout we simply STOP sending those bones (no identity/rest — that snapped
    // the rig to its bind pose). The app holds the last real pose, then eases to idle if the gap
    // outlasts its body-liveness window.
    for (const side of ["Left", "Right"]) {
      const lms = result[`${side.toLowerCase()}HandLandmarks`]?.[0];
      if (!lms) continue;
      const hand = Kalidokit.Hand.solve(lms, side);
      if (!hand) continue;
      for (const [key, e] of Object.entries(hand)) {
        const bone = key === `${side}Wrist` ? `${side}Hand` : key;   // VMC/Unity wrist name
        pushBone(messages, mirror, bone, e);
      }
    }
  } catch { /* solver hiccup — skip body this frame, face still sends */ }

  // Blendshapes — ARKit 52 passthrough (perfect sync), always.
  if (shapes) {
    for (const c of shapes) {
      if (c.categoryName === "_neutral") continue;
      const n = mirror ? mirrorName(c.categoryName) : c.categoryName;
      sentKeys.add(n);
      messages.push(blendMsg(n, c.score));
    }
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

// One-shot rebuild of the landmarker on CPU when the GPU delegate keeps failing per frame.
async function fallbackToCpu() {
  if (cpuFallbackTried || reinitBusy) return;
  cpuFallbackTried = true; reinitBusy = true;
  try {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    holo = await HolisticLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HOLISTIC_MODEL, delegate: "CPU" },
      runningMode: "VIDEO", outputFaceBlendshapes: true,
    });
    detectFails = 0;
    setStatus("Tracker restarted on CPU.");
  } catch (e) { console.error("[vrl] CPU fallback failed:", e); }
  reinitBusy = false;
}

function loop() {
  if (!camOn) return;
  if ((faceOn() || bodyOn()) && holo && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    let result = null;
    try { result = holo.detectForVideo(video, performance.now()); } catch (e) {
      detectFails++;
      lastErrMsg = String(e?.message || e);
      if (detectFails === 1 || detectFails % 120 === 0) console.error("[vrl] tracker frame failed:", e);
      if (detectFails >= 20) fallbackToCpu();
    }
    // Watchdog: nothing usable for 6 s while the camera runs → say so instead of a silent "no face".
    const now = performance.now();
    if (result) { detectFails = 0; lastGoodDetect = now; if (stalled) { stalled = false; setStatus(""); } }
    else if (!stalled && now - lastGoodDetect > 6000) {
      stalled = true;
      chipTrack.textContent = "tracker stalled"; chipTrack.classList.add("warn");
      setStatus(`Tracker not responding${lastErrMsg ? " — " + lastErrMsg : ""}. Try toggling the camera.`, true);
    }
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
joinForm.addEventListener("submit", (e) => { e.preventDefault(); if (!joinBtn.disabled) join(); });
btnLeave.addEventListener("click", () => leave());
btnCam.addEventListener("click", async () => {
  if (camOn) { cameraOff(); setStatus(joined ? "Camera off — still in the room." : ""); return; }
  try { await cameraOn(); } catch (e) { setStatus(String(e.message || e), true); }
});
// Face / body bar toggles: turning one off relaxes just its parts; both off pauses detection.
function toggleBar(btn) {
  const on = btn.getAttribute("aria-pressed") !== "true";
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  if (!faceOn() && !bodyOn()) {
    overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
    if (camOn) chipTrack.textContent = "paused";
  } else if (camOn) {
    chipTrack.textContent = "no face"; faceSeen = false;
  }
  return on;
}
btnFace.addEventListener("click", () => {
  if (!toggleBar(btnFace)) neutralizeFace();   // face off → expression neutral (no bone identity)
  // body off → just stop sending body bones; the app eases to idle via its liveness window.
});
btnBody.addEventListener("click", () => toggleBar(btnBody));
btnMic.addEventListener("click", async () => {
  if (!joined || !room || micBusy) return;
  micBusy = true;
  const want = !micOn;
  try {
    await room.localParticipant.setMicrophoneEnabled(want);   // grant allows microphone ONLY, never camera
    micOn = want;
    btnMic.classList.toggle("is-off", !micOn);
    setStatus(micOn ? "Mic live — the operator can hear you." : "");
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
  micBusy = false;
});
btnRecenter.addEventListener("click", () => { wantRecenter = true; setStatus("Head pose recentered."); });
btnGear.addEventListener("click", (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
  btnGear.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
});
menu.addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => {
  if (!menu.hidden) { menu.hidden = true; btnGear.setAttribute("aria-expanded", "false"); }
});
optBlind.addEventListener("change", () => stage.classList.toggle("blind", optBlind.checked));

// Room key is masked (type=password) by default; the eye reveals it.
roomEye.addEventListener("click", () => {
  const show = roomInput.type === "password";
  roomInput.type = show ? "text" : "password";
  roomEye.classList.toggle("off", !show);
  roomEye.title = show ? "Hide key" : "Show key";
});

// OBS URL field: copy + collapsible how-to.
obsCopy.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(obsUrl.value); obsCopy.textContent = "Copied"; }
  catch { obsUrl.select(); }
  setTimeout(() => { obsCopy.textContent = "Copy"; }, 1500);
});
obsI.addEventListener("click", () => { obsHint.hidden = !obsHint.hidden; });
roomInput.addEventListener("input", refreshObs);
refreshObs();   // show it now if a key is already prefilled (returning user)

window.addEventListener("pagehide", () => { if (room) room.disconnect(); });

// ── one-tap join from the app's Share link (#join=<roomkey>) ────────────────────────────────
// Prefill + auto-start. If the browser needs a user gesture for the camera, join() surfaces the
// error and the (already-prefilled) dialog stays up so a tap finishes it.
const joinKey = new URLSearchParams(location.hash.slice(1)).get("join");
if (joinKey && joinKey.length >= 8) {
  roomInput.value = joinKey;
  join();
}

// ── OBS browser-source view (#watch=<roomkey>) ─────────────────────────────────────────────
// Subscribe-only: no camera, no tracking, no publishing of any kind (the watch token can't).
// Retries forever — OBS scenes load long before the phone connects, and must survive drops.
async function startWatch(key) {
  document.body.classList.add("watch");
  for (;;) {
    try {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ room: key, mode: "watch" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || res.status);
      const r = new Room();
      room = r;
      r.on(RoomEvent.TrackSubscribed, (track) => attachTrack(track));
      r.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === "video") stage.classList.remove("return");
        track.detach();
      });
      await r.connect(body.url, body.token);
      await new Promise((resolve) => r.once(RoomEvent.Disconnected, resolve));   // hold until drop
      detachAll();
      room = null;
    } catch { /* room offline — retry quietly */ }
    await new Promise((r2) => setTimeout(r2, 5000));
  }
}
const watchKey = new URLSearchParams(location.hash.slice(1)).get("watch");
if (watchKey && watchKey.length >= 8) startWatch(watchKey);
