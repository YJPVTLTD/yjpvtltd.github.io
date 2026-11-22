// The flight: seven drone legs behind the page, scrubbed by scroll.
//
// Each <video data-leg> is fetched whole (with progress) and played from
// memory, so seeking is instant and never depends on byte-range requests. The
// first leg has a small "lite" file that plays until the full one arrives.
// Consecutive sections that share a data-leg form one span; scroll through a
// span moves that leg's playhead from start to end, and near the end the next
// leg blends in through fog (or darkness, going into the night).
//
// Exposes window.flight = { state, progress(leg), ready(leg), update(y, vh) }.
(() => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const portrait = matchMedia("(max-aspect-ratio: 1/1)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const legs = new Map([...document.querySelectorAll(".flight video")].map((v) => [v.dataset.leg, v]));
  const progress = new Map(); // leg -> 0..1 of the full file
  const state = { a: null, b: null, blend: 0, mist: 0, dim: 0.1, vel: 0, lens: 1, maskMix: 0, maskScale: 1, night: 0, grade: 0 };
  legs.forEach((v, k) => { v.poster = `assets/flight/${k}${portrait ? "-m" : ""}.webp`; });

  async function fetchBlob(url, onProgress, tries = 3) {
    for (let i = 1; ; i++) {
      try { return await fetchOnce(url, onProgress); }
      catch (e) { if (i >= tries) throw e; await new Promise((r) => setTimeout(r, 1200 * i)); }
    }
  }
  async function fetchOnce(url, onProgress) {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(url);
    const total = +res.headers.get("Content-Length") || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (total) onProgress(got / total);
    }
    onProgress(1);
    return new Blob(chunks, { type: "video/mp4" });
  }

  const attach = (v, blob) => new Promise((resolve) => {
    const t = v.currentTime;
    v.addEventListener("loadeddata", () => { if (t) v.currentTime = t; resolve(); }, { once: true });
    v.preload = "auto";
    v.src = URL.createObjectURL(blob);
  });

  const loading = new Set();
  let inflight = 0;
  async function load(v) {
    if (!v || loading.has(v)) return;
    loading.add(v);
    if (v.dataset.leg !== "f1") inflight++;
    const leg = v.dataset.leg;
    const name = `assets/flight/${leg}${portrait ? "-m" : ""}.mp4`;
    try {
      if (leg === "f1") {
        // the hero plays a small version within a second or two, then upgrades
        // once nothing else is loading and the hero is what the visitor sees
        await attach(v, await fetchBlob(`assets/flight/f1${portrait ? "-m" : ""}-lite.mp4`, (p) => progress.set("f1-lite", p)));
        progress.set("f1", Math.max(progress.get("f1") || 0, 0.001));
        await new Promise((r) => { const tick = () => (state.a === v && inflight === 0 ? r() : setTimeout(tick, 250)); tick(); });
        await attach(v, await fetchBlob(name, (p) => progress.set("f1", p)));
      } else {
        await attach(v, await fetchBlob(name, (p) => progress.set(leg, p)));
      }
    } catch {
      v.preload = "auto"; v.src = name; progress.set(leg, 1);
    } finally {
      if (leg !== "f1") inflight--;
    }
  }

  let spans = [];
  function measure() {
    spans = [];
    document.querySelectorAll("[data-leg]:not(video)").forEach((s) => {
      const top = s.offsetTop, bottom = top + s.offsetHeight, leg = s.dataset.leg;
      const last = spans[spans.length - 1];
      if (last && last.leg === leg) last.bottom = bottom;
      else spans.push({ leg, top, bottom });
    });
  }
  addEventListener("resize", measure);
  addEventListener("load", measure);
  measure();

  const play = new Map(); // leg -> eased playhead 0..1
  function update(y, vh) {
    if (!spans.length) return;
    const at = y + vh * 0.5;
    let i = spans.findIndex((s) => at < s.bottom);
    if (i < 0) i = spans.length - 1;
    const s = spans[i];
    const t = clamp((at - s.top) / (s.bottom - s.top));
    const next = spans[i + 1];
    const blend = next ? clamp((t - 0.86) / 0.14) : 0;
    const night = next && next.leg === "f7" ? 1 : 0;
    legs.forEach((v, k) => {
      let target = null;
      if (k === s.leg) target = t;
      if (next && k === next.leg && blend > 0) target = 0;
      v.style.opacity = k === s.leg ? 1 : (next && k === next.leg ? blend : 0);
      v.style.zIndex = k === s.leg ? 0 : 1;
      if (target === null) return;
      load(v);
      if (still) return;
      const cur = play.has(k) ? play.get(k) : target;
      const eased = cur + (target - cur) * 0.22;
      play.set(k, eased);
      const d = v.duration;
      const isMobile = ('ontouchstart' in window) || window.innerWidth < 768;
      const now = performance.now();
      const lastSeek = v._lastSeek || 0;
      const minInterval = isMobile ? 80 : 30;
      const deltaThreshold = isMobile ? 0.05 : 0.016;
      if (d && !v.seeking && (now - lastSeek > minInterval)) {
        const want = clamp(eased, 0, 0.999) * d;
        if (Math.abs(v.currentTime - want) > deltaThreshold) {
          v.currentTime = want;
          v._lastSeek = now;
        }
      }
    });
    if (next && ((progress.get(s.leg) || 0) >= 1 || t > 0.4)) load(legs.get(next.leg));
    const pulse = Math.sin(blend * Math.PI);
    Object.assign(state, {
      a: legs.get(s.leg), b: next ? legs.get(next.leg) : null, blend, night,
      grade: s.leg === "f7" ? 1 : night ? blend : 0,
      mist: night ? 0 : pulse * 0.95, dim: 0.1 + (night ? pulse * 0.8 : 0),
    });
    // the plain <video> layers (no WebGL) get fog and darkness from CSS
    document.documentElement.style.setProperty("--mist", (night ? 0 : pulse * 0.8).toFixed(3));
    document.documentElement.style.setProperty("--dim", (0.14 + (night ? pulse * 0.7 : 0)).toFixed(3));
  }

  window.flight = {
    state, legs, update, measure,
    progress: (leg) => progress.get(leg) || 0,
    ready: (leg) => { const v = legs.get(leg); return !!v && v.readyState >= 2; },
    load: (leg) => load(legs.get(leg)),
  };
  load(legs.get("f1"));
})();
