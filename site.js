// FlowOS site: one rAF loop reads the scroll position and writes CSS variables;
// the stylesheet turns them into motion. flight.js scrubs the footage, gl.js
// draws it with the glass effects.
const root = document.documentElement;
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fine = matchMedia("(pointer: fine)").matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t) => 1 - Math.pow(1 - t, 3);
const F = window.flight;
if (still) root.classList.add("still");

// ---- intro: black lifts as soon as the font and the first picture are in (cap 1.2 s) ---
const veil = document.querySelector(".veil");
if (veil) {
  const t0 = performance.now();
  const lift = () => { veil.classList.add("off"); setTimeout(() => veil.remove(), 1400); };
  const poster = new Image(); poster.src = document.querySelector('.flight video[data-leg="f1"]').poster;
  Promise.race([Promise.all([document.fonts.ready, poster.decode().catch(() => {})]), new Promise((r) => setTimeout(r, 1200))])
    .then(() => setTimeout(lift, Math.max(0, 350 - (performance.now() - t0))));
}

// ---- smooth scroll (desktop wheel only, 120Hz native touch on mobile) -----------
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || window.innerWidth < 768;
let lenis = null;
if (!still && window.Lenis && !isTouchDevice) {
  lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
  document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
    const el = document.querySelector(a.hash);
    if (!el) return;
    e.preventDefault();
    lenis.scrollTo(el, { offset: a.hash === "#top" ? 0 : -10, duration: 1.6 });
  }));
} else {
  // Native smooth scrolling on mobile
  document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
    const el = document.querySelector(a.hash);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth" });
  }));
}

// ---- words rise out of masks -----------------------------------------------------
document.querySelectorAll("[data-split]").forEach((el) => {
  let i = 0;
  const walk = (node) => [...node.childNodes].forEach((n) => {
    if (n.nodeType !== 3) return walk(n);
    const frag = document.createDocumentFragment();
    n.textContent.split(/(\s+)/).forEach((part) => {
      if (!part) return;
      if (/^\s+$/.test(part)) return frag.append(part);
      const w = document.createElement("span"); w.className = "w";
      const c = document.createElement("span"); c.className = "c"; c.textContent = part; c.style.setProperty("--i", i++);
      w.append(c); frag.append(w);
    });
    n.replaceWith(frag);
  });
  walk(el);
});
document.querySelectorAll("[data-split-soft]").forEach((el) => el.classList.add("soft"));
const reveal = new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return;
  e.target.classList.add("in");
  reveal.unobserve(e.target);
}), { rootMargin: "0px 0px -10% 0px" });
document.querySelectorAll("[data-split], [data-split-soft]").forEach((el) => { if (still || !el.closest(".hero-copy")) reveal.observe(el); });

// ---- pointer: parallax, tilt, magnets -----------------------------------------------
let mx = 0, my = 0, smx = 0, smy = 0;
if (fine && !still) {
  addEventListener("pointermove", (e) => { mx = e.clientX / innerWidth * 2 - 1; my = e.clientY / innerHeight * 2 - 1; }, { passive: true });
  document.querySelectorAll("[data-tilt]").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--rx", (((e.clientX - r.left) / r.width - 0.5) * 7).toFixed(2));
      el.style.setProperty("--ry", (((e.clientY - r.top) / r.height - 0.5) * -5).toFixed(2));
    });
    el.addEventListener("pointerleave", () => { el.style.setProperty("--rx", 0); el.style.setProperty("--ry", 0); });
  });
  document.querySelectorAll("[data-magnet]").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--tx", `${((e.clientX - r.left) / r.width - 0.5) * 10}px`);
      el.style.setProperty("--ty", `${((e.clientY - r.top) / r.height - 0.5) * 8}px`);
    });
    el.addEventListener("pointerleave", () => { el.style.setProperty("--tx", "0px"); el.style.setProperty("--ty", "0px"); });
  });
}

// ---- scene state ------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const hero = $(".hero"), heroCopy = $(".hero-copy");
const tour = $(".tour"), tourImgs = [...tour.querySelectorAll(".tour-stage img")], tourItems = [...tour.querySelectorAll(".tour-list li")];
const assemble = $("[data-assemble]"), panes = assemble.querySelector(".panes");
const keysScene = $("[data-keys]"), keys = [...keysScene.querySelectorAll(".key")], keysShot = keysScene.querySelector(".keys-shot");
const memory = $(".memory"), count = memory.querySelector("[data-count]"), cells = [...count.querySelectorAll("i")];
const tc = $("[data-tc]"), film = $("[data-film]");
const seen = [...document.querySelectorAll(".shot:not(.keys-shot):not(.card .shot), .film, .nope li")];
const cards = [...document.querySelectorAll(".stack li")];
cards.forEach((li, i) => li.style.setProperty("--n", i));
const navLinks = [...document.querySelectorAll(".nav nav a")];
const navTargets = navLinks.map((a) => (a.hash ? document.querySelector(a.hash) : null));
const bar = $(".progress");
const chapter = $(".chapter"), chapterNum = chapter.querySelector("b"), chapterName = chapter.querySelector("span");
const chapters = [...document.querySelectorAll("section[id][data-scene]")].map((s) => ({ el: s, num: s.querySelector(".eyebrow b")?.textContent || "", name: s.querySelector(".eyebrow")?.textContent.replace(/^[^A-Za-z]*[A-Za-z0-9.]+\s*/, "").trim() || s.id }));
let chapterOn = "", lastY = scrollY, vel = 0, lastStep = -1;

const pinned = (el, vh) => { const r = el.getBoundingClientRect(); return clamp(-r.top / (r.height - vh)); };

function frame() {
  const vh = innerHeight, y = scrollY;
  smx += (mx - smx) * 0.06; smy += (my - smy) * 0.06;
  root.style.setProperty("--mx", smx.toFixed(3));
  root.style.setProperty("--my", smy.toFixed(3));
  bar.style.setProperty("--doc", clamp(y / (root.scrollHeight - vh)).toFixed(4));
  F.update(y, vh);
  if (still) return requestAnimationFrame(frame);

  // scroll speed, smoothed: the lens strains and colours split with it
  vel += (clamp((y - lastY) / 60, -1, 1) - vel) * 0.12; lastY = y;
  F.state.vel = vel;

  // hero: through the wordmark (0-0.32), the claim (0.3-0.6), the real desktop rises (0.6-0.95)
  const hp = pinned(hero, vh);
  hero.style.setProperty("--p", hp.toFixed(4));
  const z = clamp(hp / 0.32);
  let mask = null, lensOn = 0;
  if (hp < 0.34) { mask = { kind: "word", scale: 1 + Math.pow(z, 3) * 60, mix: 1 - ease(clamp((z - 0.55) / 0.4)) }; }
  const h = ease(clamp((hp - 0.3) / 0.1));
  hero.style.setProperty("--h", h.toFixed(4));
  hero.style.setProperty("--hx", ease(clamp((hp - 0.56) / 0.12)).toFixed(4));
  if (h > 0.2) heroCopy.querySelectorAll("[data-split], [data-split-soft]").forEach((el) => el.classList.add("in"));
  hero.style.setProperty("--q", ease(clamp((hp - 0.6) / 0.32)).toFixed(4));

  // glass tour: six screens across the pin
  const tp = pinned(tour, vh);
  tour.style.setProperty("--e", ease(clamp(tp * 5)).toFixed(4));
  const step = Math.min(tourImgs.length - 1, Math.floor(clamp((tp - 0.04) / 0.92) * tourImgs.length));
  if (step !== lastStep) {
    tourImgs.forEach((im, i) => im.classList.toggle("on", i === step));
    tourItems.forEach((li, i) => li.classList.toggle("on", i === step));
    lastStep = step;
  }

  // the four app worlds gather into the mark
  const ap = pinned(assemble, vh);
  panes.style.setProperty("--a", ease(clamp((ap - 0.12) / 0.62)).toFixed(4));

  // Ctrl, Shift, Esc press one after another, Task Manager rises, then leaves before the next screens
  const kp = pinned(keysScene, vh);
  keys.forEach((k, i) => {
    const d = ease(clamp((kp - (0.1 + i * 0.11)) / 0.07));
    k.style.setProperty("--d", d.toFixed(3));
    k.classList.toggle("down", d > 0.5);
  });
  keysScene.style.setProperty("--q", ease(clamp((kp - 0.42) / 0.18)).toFixed(4));
  keysShot.style.setProperty("--x", ease(clamp((kp - 0.9) / 0.1)).toFixed(4));

  // 4,096 falls to 128; then the digits turn to glass with the forest flying inside them
  const mp = pinned(memory, vh);
  memory.style.setProperty("--p", mp.toFixed(4));
  const n = String(Math.round(4096 - 4095 * ease(clamp(mp * 1.7)))).padStart(4, "0");
  cells.forEach((c, i) => { const ch = n[i - (4 - n.length)] || ""; if (c.textContent !== ch) c.textContent = ch; });
  const mr = memory.getBoundingClientRect();
  if (mr.top < vh && mr.bottom > 0 && mp > 0.5) {
    const g = ease(clamp((mp - 0.6) / 0.12));
    count.classList.toggle("glass", g > 0.02);
    mask = { kind: "num", el: count, mix: g }; lensOn = g;
  } else count.classList.remove("glass");
  F.state.mask = mask; F.state.lens = lensOn;

  // things arrive as they cross the lower part of the screen
  for (const el of seen) {
    const r = el.getBoundingClientRect();
    if (r.top > vh * 1.2 || r.bottom < -vh * 0.2) continue;
    el.style.setProperty("--v", ease(clamp((vh * 0.96 - r.top) / (vh * 0.5))).toFixed(4));
  }

  // each install window dims and steps back as the next slides over it
  cards.forEach((li, i) => {
    const nx = cards[i + 1];
    const c = nx ? clamp(1 - (nx.getBoundingClientRect().top - li.getBoundingClientRect().top) / (vh * 0.85)) : 0;
    li.firstElementChild.style.setProperty("--c", c.toFixed(4));
  });

  // chapter counter: the section whose top has passed the middle of the screen
  let ch = null;
  for (const c of chapters) if (c.el.getBoundingClientRect().top < vh * 0.5) ch = c;
  const key = ch ? ch.num : "";
  if (key !== chapterOn) { chapterOn = key; root.style.setProperty("--chapter", ch ? 1 : 0); if (ch) { chapterNum.textContent = ch.num.replace(/\..*/, "").padStart(2, "0"); chapterName.textContent = ch.name; } }
  // the receipt: each claim ticks once its proof has been passed
  navLinks.forEach((a, i) => { const t = navTargets[i]; if (!t) return; const r = t.getBoundingClientRect(); a.classList.toggle("tick", r.top < vh * 0.6); a.toggleAttribute("aria-current", r.top < vh * 0.6 && r.bottom > vh * 0.6); });
  if (tc && !film.paused) { const t = film.currentTime * 2; tc.textContent = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`; }

  requestAnimationFrame(frame);
}

if (lenis) { const raf = (time) => { lenis.raf(time); requestAnimationFrame(raf); }; requestAnimationFrame(raf); }
if (still) { tourImgs[0].classList.add("on"); tourItems[0].classList.add("on"); }
requestAnimationFrame(frame);

// ---- the 128 MB footage plays while on screen ----------------------------------------
new IntersectionObserver(([e]) => {
  if (e.isIntersecting) { film.preload = "auto"; if (!still) film.play().catch(() => {}); }
  else film.pause();
}, { threshold: 0.3 }).observe(film);
if (still) film.controls = true;

// ---- the nav button steps aside while the booking button is on screen ------------------
new IntersectionObserver(([e]) => root.classList.toggle("in-wait", e.isIntersecting), { rootMargin: "-80px 0px 0px 0px" }).observe($(".book"));

// ---- zoom: any screen opens full size ----------------------------------------------
const zoom = $(".zoom"), zimg = zoom.querySelector("img");
document.addEventListener("click", (e) => {
  const img = e.target.closest("img[data-zoom]");
  if (img) { zimg.src = img.src; zoom.showModal(); lenis?.stop(); }
  else if (e.target === zoom) zoom.close();
});
zoom.addEventListener("close", () => lenis?.start());

// Early access is pay-to-book only. The /api/waitlist endpoint stays for old sign-ups,
// but the page no longer offers a free list.

// ---- paid booking (Stripe) ----------------------------------------------------------
// Route booking buttons to itemized gateway checkout
const to = new URL("checkout/", location.href);
document.querySelectorAll("[data-checkout]").forEach((a) => {
  a.href = to.href;
});

// ---- paid booking (Lemon Squeezy, behind flowos-pay="lemon") -------------------------
// The checkout link lives in <meta name="flowos-checkout">. The ref or
// utm_source of this visit rides along as custom data, so the order shows where
// the buyer came from. lemon.js opens checkout over the page; without it the
// link still opens the checkout page itself.
const checkout = $('meta[name="flowos-pay"]').content === "lemon" && $('meta[name="flowos-checkout"]').content;
if (checkout) {
  $("[data-pay-name]").textContent = "Lemon Squeezy";
  const bookMsg = $(".book-msg"), bookBtn = $(".btn-book");
  const booked = () => { bookMsg.textContent = "You're booked. Your receipt is in your inbox, and we'll email your download when early access opens."; };
  const q = new URLSearchParams(location.search);
  const url = new URL(checkout);
  url.searchParams.set("embed", "1");
  const ref = q.get("ref") || q.get("utm_source");
  if (ref) url.searchParams.set("checkout[custom][ref]", ref.slice(0, 40));
  bookBtn.href = url.href;
  bookBtn.classList.add("lemonsqueezy-button");
  if (q.has("booked")) booked();
  const lemon = document.createElement("script");
  lemon.src = "https://app.lemonsqueezy.com/js/lemon.js";
  lemon.defer = true;
  lemon.onload = () => {
    window.createLemonSqueezy?.();
    window.LemonSqueezy?.Setup({ eventHandler: (e) => { if (e.event === "Checkout.Success") booked(); } });
  };
  document.head.append(lemon);
}
