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
const stage = $("stage"), video = $("cam"), overlay = $("overlay"), returnEl = $("return");
const joinForm = $("join-form"), roomInput = $("room"), joinBtn = $("join"), statusEl = $("status");
const btnCam = $("btn-cam"), btnRecenter = $("btn-recenter");
const btnGear = $("btn-gear"), btnLeave = $("btn-leave"), menu = $("menu");
const chipRoom = $("chip-room"), chipTrack = $("chip-track"), chipRate = $("chip-rate"), chipHint = $("chip-hint");
const optTrack = $("opt-track"), optMirror = $("opt-mirror"), optBlind = $("opt-blind"), optPerfect = $("opt-perfect");

let holo = null, Kalidokit = null, trackersLoading = null;
let room = null, remoteAudioEls = [];
let camOn = false, joined = false, leaving = false;
let lastVideoTime = -1, refQuatInv = null, wantRecenter = true;
let pktCount = 0, pktWindowStart = 0, faceSeen = false;
let sentKeys = new Set(), sentBones = new Set();
const partSeen = { pose: false, Left: false, Right: false };   // for rest-on-dropout
let hintTimer = 0;

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
  relaxAvatar();   // camera muted mid-call → relax the avatar, stay in the room
}

// ── room join/leave ─────────────────────────────────────────────────────────────────────────
function attachTrack(track) {
  if (track.kind === "video") {
    track.attach(returnEl);
    stage.classList.add("return");
  } else if (track.kind === "audio") {
    const el = track.attach();          // hear the operator (return feed audio)
    remoteAudioEls.push(el);
    document.body.appendChild(el);
  }
}
function detachAll() {
  stage.classList.remove("return");
  for (const el of remoteAudioEls) el.remove();
  remoteAudioEls = [];
}

async function connectRoom(roomCode) {
  setStatus("Checking room…");
  const { token, url } = await mintToken(roomCode);
  room = new Room();
  room.on(RoomEvent.TrackSubscribed, (track) => attachTrack(track));
  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    if (track.kind === "video") stage.classList.remove("return");
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
    btnLeave.hidden = false;
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
      if (room.state === "connected") { relaxAvatar(); await new Promise((r) => setTimeout(r, 120)); }
      await room.disconnect();
    } catch {}
    room = null;
  }
  joined = false;
  detachAll();
  stage.classList.remove("live");
  chipRoom.hidden = true; chipRate.hidden = true; chipHint.hidden = true;
  btnLeave.hidden = true;
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

// ── per-frame: draw, solve, send ────────────────────────────────────────────────────────────
function drawDots(ctx, points, size) {
  for (const p of points) {
    ctx.fillRect(p.x * overlay.width - size / 2, p.y * overlay.height - size / 2, size, size);
  }
}
function drawOverlay(result) {
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  if (result.faceLandmarks?.[0]) drawDots(ctx, result.faceLandmarks[0], 2);
  if (result.poseLandmarks?.[0]) { ctx.fillStyle = "rgba(160, 210, 255, 0.8)"; drawDots(ctx, result.poseLandmarks[0], 5); }
  if (result.leftHandLandmarks?.[0]) drawDots(ctx, result.leftHandLandmarks[0], 4);
  if (result.rightHandLandmarks?.[0]) drawDots(ctx, result.rightHandLandmarks[0], 4);
}

// Zero every blend and rest every bone we've driven, so the avatar relaxes instead of freezing.
function relaxAvatar() {
  if (!room || room.state !== "connected") return;
  const msgs = [...sentKeys].map((k) => blendMsg(k, 0));
  for (const b of sentBones) msgs.push(boneMsg(b, [0, 0, 0, 1]));
  if (!msgs.length) return;
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
// Send rest (identity) for the already-driven bones matching a prefix — so a hand or arm that
// drops out of frame relaxes instead of freezing in its last pose.
function restBones(messages, prefix) {
  for (const b of sentBones) if (b.startsWith(prefix)) messages.push(boneMsg(b, [0, 0, 0, 1]));
}

function sendFrame(result) {
  if (!joined || !room || room.state !== "connected") return;
  const shapes = result.faceBlendshapes?.[0]?.categories;
  const hasFace = !!result.faceLandmarks?.[0];
  if (!hasFace) {
    if (faceSeen) { faceSeen = false; chipTrack.textContent = "no face"; chipTrack.classList.add("warn"); relaxAvatar(); }
    return;
  }
  if (!faceSeen) { faceSeen = true; chipTrack.textContent = "tracking"; chipTrack.classList.remove("warn"); }

  const mirror = optMirror.checked;
  const messages = [];

  // Head (Kalidokit face solve over the holistic landmarks).
  try {
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
  try {
    if (result.poseWorldLandmarks?.[0] && result.poseLandmarks?.[0]) {
      partSeen.pose = true;
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
    } else if (partSeen.pose) {
      partSeen.pose = false;
      restBones(messages, "Spine");
      restBones(messages, "LeftUpperArm"); restBones(messages, "LeftLowerArm");
      restBones(messages, "RightUpperArm"); restBones(messages, "RightLowerArm");
    }
    for (const side of ["Left", "Right"]) {
      const lms = result[`${side.toLowerCase()}HandLandmarks`]?.[0];
      if (!lms) {
        // Hand left the frame → relax its wrist + fingers once instead of freezing mid-gesture.
        // (`sentBones` names are post-mirror, so the prefix check uses the mirrored side too.)
        const s = mirror ? mirrorName(side) : side;
        if (partSeen[side]) {
          partSeen[side] = false;
          restBones(messages, `${s}Hand`);
          for (const finger of ["Thumb", "Index", "Middle", "Ring", "Little"]) restBones(messages, s + finger);
        }
        continue;
      }
      partSeen[side] = true;
      const hand = Kalidokit.Hand.solve(lms, side);
      if (!hand) continue;
      for (const [key, e] of Object.entries(hand)) {
        const bone = key === `${side}Wrist` ? `${side}Hand` : key;   // VMC/Unity wrist name
        pushBone(messages, mirror, bone, e);
      }
    }
  } catch { /* solver hiccup — skip body this frame, face still sends */ }

  // Blendshapes.
  if (shapes) {
    const b = {};
    for (const c of shapes) b[c.categoryName] = c.score;
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
  if (optTrack.checked && holo && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    let result = null;
    try { result = holo.detectForVideo(video, performance.now()); } catch { /* skip frame */ }
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
optTrack.addEventListener("change", () => {
  if (!optTrack.checked) {
    overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
    if (camOn) chipTrack.textContent = "paused";
    relaxAvatar();
  } else if (camOn) {
    chipTrack.textContent = "no face"; faceSeen = false;
  }
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
window.addEventListener("pagehide", () => { if (room) room.disconnect(); });
