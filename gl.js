// The flight, drawn in WebGL. flight.js decides which legs are on screen and
// how far they blend (window.flight.state); site.js says which glyphs are
// windows right now. This file draws:
//   - the footage, with fog where one leg hands to the next
//   - glass glyphs: the wordmark, the 128 and the $20 are windows with the
//     flight moving inside them (the hero zooms through the wordmark)
//   - a liquid glass lens on the pointer that bends the footage, only where a
//     scene asks for it (inside the glass glyphs)
//   - colour split and a slight bend that grow with scroll speed
// Without WebGL the plain <video> layers stay visible instead.
(() => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.querySelector(".flight canvas");
  const gl = canvas && canvas.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false });
  if (!gl || still) return;
  document.documentElement.classList.add("gl");

  const vs = `attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0., 1.); }`;
  const fs = `
precision highp float;
varying vec2 v;
uniform sampler2D uA, uB, uMask;
uniform vec2 uRes, uMouse, uOrigin;
uniform vec4 uMaskRect;
uniform float uAspA, uAspB, uBlend, uMist, uDim, uTime, uLens, uVel, uMaskMix, uMaskScale, uMaskMode, uGrade;

vec2 cover(vec2 uv, float ta) {
  float sa = uRes.x / uRes.y;
  vec2 s = sa > ta ? vec2(1., ta / sa) : vec2(sa / ta, 1.);
  return (uv - .5) * s + .5;
}
vec3 scene(vec2 uv) {
  uv = clamp(uv, .001, .999);
  vec3 a = texture2D(uA, cover(uv, uAspA)).rgb;
  vec3 b = texture2D(uB, cover(uv, uAspB)).rgb;
  return mix(a, b, uBlend);
}
float mask(vec2 uv) {
  vec2 mu = (uv - uOrigin) / uMaskScale + uOrigin;
  vec2 ru = (mu - uMaskRect.xy) / uMaskRect.zw;
  if (ru.x <= 0. || ru.x >= 1. || ru.y <= 0. || ru.y >= 1.) return 0.;
  return texture2D(uMask, ru).r;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= .5; } return s; }

void main() {
  vec2 uv = v;
  float asp = uRes.x / uRes.y;
  float m = uMaskMix > 0. ? mask(v) : 0.;
  // the glyph's edge, lit like the edge of a pane of glass
  float edge = 0.;
  if (uMaskMix > 0.) {
    vec2 px = 1.6 / uRes;
    edge = clamp(abs(mask(v + vec2(px.x, 0.)) - mask(v - vec2(px.x, 0.))) + abs(mask(v + vec2(0., px.y)) - mask(v - vec2(0., px.y))), 0., 1.);
  }

  // scroll speed bends the frame a little, like a lens under strain
  uv.y += sin(uv.x * 3.14159) * uVel * .016;

  // liquid glass lens: a dome of glass on the footage; in glass glyphs it only
  // bends what is inside the glyph
  vec2 d = (uv - uMouse) * vec2(asp, 1.);
  float r = .14 * uLens;
  float dist = length(d);
  float inside = r > 0. ? 1. - smoothstep(r - .003, r, dist) : 0.;
  float h = sqrt(max(0., 1. - pow(dist / max(r, 1e-4), 2.)));
  float where = mix(1., m, step(.5, uMaskMode));
  vec2 bend = -d / vec2(asp, 1.) * (1. - h) * .5 * inside * where;
  float split = (.0012 + (1. - h) * .005) * inside * where + abs(uVel) * .005;

  vec2 q = uv + bend;
  vec3 col;
  col.r = scene(q + vec2(split, 0.)).r;
  col.g = scene(q).g;
  col.b = scene(q - vec2(split, 0.)).b;
  vec3 raw = col;
  // inside glass digits the world is seen closer, so the window reads without the pointer
  vec3 rawZ = uMaskMode > .5 ? scene((q - .5) / 1.35 + .5) : raw;

  // glass rim and a soft highlight on the dome
  float rim = smoothstep(r - .014, r - .002, dist) * inside * where;
  col += rim * .2;
  float spec = smoothstep(.05, 0., length(d - vec2(-.35, .4) * r)) * inside * where;
  col += spec * .3;

  // fog rolls through the seams between legs
  float n = fbm(uv * vec2(2.2, 3.) + vec2(uTime * .035, uTime * .01));
  float fog = clamp(uMist * (.45 + n * 1.1), 0., 1.);
  col = mix(col, vec3(.88, .9, .94), fog);

  col *= 1. - uDim;
  col = mix(col, vec3(dot(col, vec3(.3, .59, .11))), uGrade * .35) * (1. - uGrade * .14);
  float vig = smoothstep(1.35, .4, length((v - .5) * vec2(asp * .8, 1.)));
  col *= mix(.78, 1., vig);
  col += (hash(v * uRes + uTime) - .5) * .028;

  // mode 0: the wordmark is the only window onto the flight
  // mode 1: the glyph is an inlay of clear, undimmed footage in the page
  vec3 knock = mix(col * .26, raw * 1.35 + .04, m) + edge * .7;
  vec3 inlay = mix(col, rawZ * 2.3 + .16 + rim * .2 + spec * .3, m) + edge * .9 * vec3(1., .96, .94);
  col = mix(col, mix(knock, inlay, step(.5, uMaskMode)), uMaskMix);

  gl_FragColor = vec4(col, 1.);
}`;

  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  ["uA", "uB", "uMask", "uRes", "uMouse", "uOrigin", "uMaskRect", "uAspA", "uAspB", "uBlend", "uMist", "uDim", "uTime", "uLens", "uVel", "uMaskMix", "uMaskScale", "uMaskMode", "uGrade"].forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));

  const tex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([6, 6, 10, 255]));
    return t;
  };
  const tA = tex(), tB = tex(), tM = tex();
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  // ---- glass glyphs ----------------------------------------------------------
  // The mask canvas holds one string in white on black. For the wordmark it
  // covers the viewport; for a numeral it covers that element's box, drawn
  // with the same font, size and tracking, so the window sits exactly on the
  // page's own glyphs (which site.js makes transparent).
  const mc = document.createElement("canvas");
  const origin = [0.5, 0.5];
  const rect = { x: 0, y: 0, w: 1, h: 1 };
  let maskKey = "";
  const ASC = 0.9408, DESC = 0.2476; // VeloticSans ascent/descent as a fraction of the em
  function drawWordmark() {
    const w = Math.min(innerWidth, 2048), h = Math.round(w * innerHeight / innerWidth);
    mc.width = w; mc.height = h;
    const c = mc.getContext("2d");
    c.fillStyle = "#000"; c.fillRect(0, 0, w, h);
    const size = Math.min(w * (w < h ? 0.3 : 0.235), h * 0.42);
    c.font = `700 ${size}px VeloticSans, system-ui, sans-serif`;
    c.textBaseline = "alphabetic"; c.fillStyle = "#fff";
    if ("letterSpacing" in c) c.letterSpacing = `${-size * 0.045}px`;
    const word = "SWARNIX";
    const x = (w - c.measureText(word).width) / 2, y = h * (w < h ? 0.42 : 0.46) + size * 0.36;
    c.fillText(word, x, y);
    // the zoom dives through the stem of the F
    origin[0] = 0.5;
    origin[1] = 1 - (y - size * 0.36) / h;
    Object.assign(rect, { x: 0, y: 0, w: 1, h: 1 });
  }
  function drawGlyph(spec) {
    // spec: { text, size (px), tracking (px), weight, box: DOMRect }
    const pad = Math.ceil(spec.size * 0.12);
    const w = Math.ceil(spec.box.width + pad * 2), h = Math.ceil(spec.box.height + pad * 2);
    mc.width = w; mc.height = h;
    const c = mc.getContext("2d");
    c.fillStyle = "#000"; c.fillRect(0, 0, w, h);
    c.font = `${spec.weight} ${spec.size}px VeloticSans, system-ui, sans-serif`;
    c.textBaseline = "alphabetic"; c.fillStyle = "#fff";
    const base = pad + spec.box.height * (ASC / (ASC + DESC));
    if (spec.cells) {
      // counting numerals sit in fixed cells (VeloticSans has no tabular figures)
      const cw = spec.size * spec.cells;
      c.textAlign = "center";
      [...spec.text].forEach((ch, i) => c.fillText(ch, pad + (i + 0.5) * cw, base));
    } else {
      if ("letterSpacing" in c) c.letterSpacing = `${spec.tracking}px`;
      c.fillText(spec.text, pad, base);
    }
    origin[0] = 0.5; origin[1] = 0.5;
  }
  const place = (box, size) => {
    const pad = Math.ceil(size * 0.12);
    Object.assign(rect, { x: (box.left - pad) / innerWidth, y: 1 - (box.bottom + pad) / innerHeight, w: mc.width / innerWidth, h: mc.height / innerHeight });
  };
  function updateMask(mask) {
    if (!mask || !mask.kind) { maskKey = ""; return; }
    if (mask.kind === "word") {
      const key = `word:${innerWidth}x${innerHeight}`;
      if (key === maskKey) return;
      drawWordmark(); maskKey = key;
    } else {
      const el = mask.el;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      const key = `${mask.kind}:${el.textContent}:${size.toFixed(1)}:${box.width.toFixed(0)}`;
      // the box moves with scroll; the glyphs are redrawn only when they change
      if (key === maskKey) { place(box, size); return; }
      drawGlyph({ text: el.textContent, size, weight: cs.fontWeight, tracking: parseFloat(cs.letterSpacing) || 0, box, cells: parseFloat(el.dataset.cells) || 0 });
      place(box, size);
      maskKey = key;
    }
    gl.bindTexture(gl.TEXTURE_2D, tM);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mc);
  }

  let W = 0, H = 0;
  const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || innerWidth < 768;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, isTouchDevice ? 1.0 : (innerWidth < 700 ? 1.25 : 1.25));
    W = Math.round(innerWidth * dpr); H = Math.round(innerHeight * dpr);
    canvas.width = W; canvas.height = H;
    gl.viewport(0, 0, W, H);
    maskKey = "";
  }
  resize();
  addEventListener("resize", resize);
  document.fonts?.ready.then(() => (maskKey = ""));

  const fine = matchMedia("(pointer: fine)").matches;
  let mx = 0.5, my = 0.5, tx = 0.5, ty = 0.5, lens = 0, lensT = 0;
  if (fine) {
    addEventListener("pointermove", (e) => { tx = e.clientX / innerWidth; ty = 1 - e.clientY / innerHeight; lensT = 1; }, { passive: true });
    document.addEventListener("pointerleave", () => (lensT = 0));
    addEventListener("blur", () => (lensT = 0));
  }

  // until a leg's video can show a frame, its poster stands in for it
  const posters = new Map();
  const poster = (video) => {
    if (!posters.has(video)) { const im = new Image(); im.src = video.poster; posters.set(video, im); }
    const im = posters.get(video);
    return im.complete && im.naturalWidth ? im : null;
  };
  document.querySelectorAll(".flight video").forEach(poster);
  const source = (video, slotLeg) => {
    if (video.readyState >= 2 && !video.seeking) return video;
    return slotLeg === video.dataset.leg ? null : poster(video);
  };
  let legA = "", legB = "";
  const upload = (t, src) => { gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); };
  const portraitClip = matchMedia("(max-aspect-ratio: 1/1)").matches;
  const asp = (video) => (video && video.videoWidth ? video.videoWidth / video.videoHeight : portraitClip ? 9 / 16 : 16 / 9);
  let keyA = "", keyB = "";
  const key = (src) => (src instanceof HTMLVideoElement ? src.dataset.leg + src.currentTime : src.src);

  // if frames take too long while scrolling, hand the page to the plain <video> layers
  let lastNow = 0; const slow = [];
  function bail() { document.documentElement.classList.remove("gl"); bailed = true; }
  let bailed = false;
  let lastDrawTime = 0;
  function draw(now) {
    if (bailed) return;
    if (isTouchDevice && now - lastDrawTime < 24) {
      requestAnimationFrame(draw);
      return;
    }
    lastDrawTime = now;
    const s0 = (window.flight && window.flight.state) || {};
    if (lastNow && Math.abs(s0.vel || 0) > 0.05) { slow.push(now - lastNow); if (slow.length >= 90) { const m = slow.slice().sort((a, b) => a - b)[45]; if (m > 40) return bail(); slow.length = 0; } }
    lastNow = now;
    if (!document.hidden) {
      const s = (window.flight && window.flight.state) || {};
      const mask = s.mask || null;
      updateMask(mask);
      mx += (tx - mx) * 0.14; my += (ty - my) * 0.14; lens += (lensT * (s.lens ?? 0) - lens) * 0.08;
      const srcA = s.a && source(s.a, legA), srcB = s.b && s.blend > 0 && source(s.b, legB);
      if (srcA && key(srcA) !== keyA) { upload(tA, srcA); keyA = key(srcA); legA = s.a.dataset.leg; }
      if (srcB && key(srcB) !== keyB) { upload(tB, srcB); keyB = key(srcB); legB = s.b.dataset.leg; }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tA); gl.uniform1i(U.uA, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tB); gl.uniform1i(U.uB, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tM); gl.uniform1i(U.uMask, 2);
      gl.uniform2f(U.uRes, W, H);
      gl.uniform2f(U.uMouse, mx, my);
      gl.uniform2f(U.uOrigin, origin[0], origin[1]);
      gl.uniform4f(U.uMaskRect, rect.x, rect.y, rect.w, rect.h);
      gl.uniform1f(U.uAspA, asp(s.a));
      gl.uniform1f(U.uAspB, asp(s.b));
      gl.uniform1f(U.uBlend, s.blend || 0);
      gl.uniform1f(U.uMist, s.mist || 0);
      gl.uniform1f(U.uDim, s.dim || 0);
      gl.uniform1f(U.uTime, now / 1000);
      gl.uniform1f(U.uLens, lens);
      gl.uniform1f(U.uVel, s.vel || 0);
      gl.uniform1f(U.uMaskMix, mask ? mask.mix || 0 : 0);
      gl.uniform1f(U.uMaskScale, (mask && mask.scale) || 1);
      gl.uniform1f(U.uMaskMode, mask && mask.kind !== "word" ? 1 : 0);
      gl.uniform1f(U.uGrade, s.grade || 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    requestAnimationFrame(draw);
  }
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); document.documentElement.classList.remove("gl"); });
  requestAnimationFrame(draw);
})();
