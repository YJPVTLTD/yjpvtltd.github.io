// FlowOS checkout: email first (so blocked buyers are refused before any card is asked for),
// then Stripe's Billing Address and Payment Elements on a custom-UI Checkout Session.
// The Worker sets the price; this page only shows it.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const q = new URLSearchParams(location.search);
  const msg = $(".msg");
  const say = (t, kind) => { msg.textContent = t || ""; msg.className = "msg" + (kind ? " " + kind : ""); };
  const money = (cents, cur = "usd") => new Intl.NumberFormat("en-US", { style: "currency", currency: cur.toUpperCase() }).format(cents / 100);
  const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,63}$/;

  let config = null, checkout = null, actions = null, elements = [];

  // ---- price and countdown --------------------------------------------------------
  function showPrice(c) {
    document.querySelectorAll("[data-price]").forEach((el) => (el.textContent = String(c.amount / 100)));
    $('[data-v="total"]').textContent = money(c.amount, c.currency);
    $("#pay-btn span").textContent = `Pay ${money(c.amount, c.currency)}`;
    const early = c.tier === "early_20" && c.deadline;
    document.querySelectorAll("[data-early]").forEach((el) => (el.hidden = !early));
    if (early) tick(new Date(c.deadline).getTime());
  }
  function tick(end) {
    const pad = (n) => String(n).padStart(2, "0");
    const draw = () => {
      let s = Math.max(0, Math.floor((end - Date.now()) / 1000));
      if (s === 0) { location.reload(); return; } // the Worker now charges $25
      const d = Math.floor(s / 86400); s -= d * 86400;
      const h = Math.floor(s / 3600); s -= h * 3600;
      const m = Math.floor(s / 60); s -= m * 60;
      $('[data-t="d"]').textContent = d; $('[data-t="h"]').textContent = pad(h);
      $('[data-t="m"]').textContent = pad(m); $('[data-t="s"]').textContent = pad(s);
    };
    draw(); setInterval(draw, 1000);
  }

  // ---- Stripe look: the site's dark glass, rose accent and type ---------------------
  const appearance = {
    theme: "night",
    labels: "above",
    variables: {
      colorPrimary: "#f6426f",
      colorBackground: "#0d0e14",
      colorText: "#f3f3f5",
      colorTextSecondary: "#b9b9c0",
      colorTextPlaceholder: "#7d7d86",
      colorDanger: "#ff8fa8",
      colorIcon: "#b9b9c0",
      fontFamily: "VeloticSans, Arial, Helvetica, sans-serif",
      fontSizeBase: "16px",
      borderRadius: "14px",
      spacingUnit: "4px",
      focusBoxShadow: "0 0 0 3px rgba(246, 66, 111, 0.22)",
      focusOutline: "none",
    },
    rules: {
      ".Label": { color: "rgba(243, 243, 245, 0.74)", fontSize: "14px", marginBottom: "8px" },
      ".Input": { backgroundColor: "rgba(6, 6, 10, 0.55)", border: "1px solid rgba(255, 255, 255, 0.22)", boxShadow: "none", padding: "14px 16px" },
      ".Input:focus": { borderColor: "#f6426f", boxShadow: "0 0 0 3px rgba(246, 66, 111, 0.22)" },
      ".Input--invalid": { borderColor: "#ff8fa8", boxShadow: "none" },
      ".Tab": { backgroundColor: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255, 255, 255, 0.12)", boxShadow: "none" },
      ".Tab:hover": { backgroundColor: "rgba(255, 255, 255, 0.09)" },
      ".Tab--selected": { backgroundColor: "rgba(246, 66, 111, 0.12)", borderColor: "#f6426f", boxShadow: "0 0 0 1px #f6426f" },
      ".Block": { backgroundColor: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255, 255, 255, 0.12)", boxShadow: "none" },
      ".AccordionItem": { backgroundColor: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255, 255, 255, 0.12)", boxShadow: "none" },
      ".PickerItem": { backgroundColor: "rgba(6, 6, 10, 0.55)", border: "1px solid rgba(255, 255, 255, 0.22)", boxShadow: "none" },
    },
  };
  const fonts = location.protocol === "https:"
    ? [400, 500, 600].map((w) => ({ family: "VeloticSans", weight: String(w), src: `url(${location.origin}/assets/fonts/VeloticSans-${{ 400: "Regular", 500: "Medium", 600: "SemiBold" }[w]}.woff2)` }))
    : [];

  // ---- totals from the live session ------------------------------------------------
  const amt = (x) => (x == null ? null : typeof x === "string" ? x : typeof x === "number" ? money(x, config.currency) : x.amount ?? (x.minorUnitsAmount != null ? money(x.minorUnitsAmount, config.currency) : null));
  function render(session) {
    if (!session) return;
    const t = session.total || {};
    if (amt(t.total)) { $('[data-v="total"]').textContent = amt(t.total); $("#pay-btn span").textContent = `Pay ${amt(t.total)}`; }
    $("#pay-btn").disabled = !session.canConfirm;
  }

  // ---- step 1: email ---------------------------------------------------------------
  const email = $("#email");
  if (q.get("email")) email.value = q.get("email").trim().slice(0, 254);

  function setStep(n) {
    $("#step-email").hidden = n !== 1;
    $("#step-pay").hidden = n !== 2;
    $('[data-step="1"]').className = n === 1 ? "on" : "done";
    $('[data-step="2"]').className = n === 2 ? "on" : "";
  }

  $("#step-email").addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = email.value.trim();
    if (!EMAIL_RE.test(value)) { say("Enter a valid email address.", "error"); email.focus(); return; }
    const btn = e.submitter || $("#step-email .btn");
    btn.disabled = true; btn.innerHTML = '<span class="spin" aria-hidden="true"></span><span>Checking</span>';
    say("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value, ref: q.get("ref") || q.get("utm_source") || "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { say(data.error || "Checkout is unavailable right now. Try again in a minute.", "error"); return; }
      showPrice({ ...config, amount: data.amount, currency: data.currency, tier: data.tier });
      $("[data-email]").textContent = value;
      setStep(2);
      await mountStripe(data.client_secret);
    } catch (err) {
      console.error(err);
      say("That didn't go through. Check your connection and try again.", "error");
    } finally {
      btn.disabled = false; btn.innerHTML = "<span>Continue to payment</span>";
    }
  });

  $("[data-change]").addEventListener("click", () => {
    elements.forEach((el) => { try { el.destroy?.() ?? el.unmount?.(); } catch {} });
    elements = []; checkout = null; actions = null;
    $("#billing").innerHTML = $("#payment").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    $("#pay-btn").disabled = true;
    say(""); setStep(1); email.focus();
  });

  // ---- step 2: Stripe Elements -----------------------------------------------------
  async function mountStripe(clientSecret) {
    if (!window.Stripe) throw new Error("Stripe.js did not load");
    const stripe = window.Stripe(config.publishable_key);
    checkout = await stripe.initCheckout({ fetchClientSecret: async () => clientSecret, elementsOptions: { appearance, fonts } });
    // Newer Stripe.js versions return actions from loadActions(); basil exposes them on the checkout object.
    if (typeof checkout.loadActions === "function") {
      const r = await checkout.loadActions();
      if (r.type !== "success") throw new Error(r.error?.message || "Checkout could not load");
      actions = r.actions;
    } else actions = checkout;

    $("#billing").innerHTML = $("#payment").innerHTML = "";
    const billing = checkout.createBillingAddressElement();
    billing.mount("#billing");
    const payment = checkout.createPaymentElement({ layout: { type: "tabs" } });
    payment.mount("#payment");
    elements = [billing, payment];

    checkout.on("change", render);
    render(typeof actions.getSession === "function" ? actions.getSession() : checkout.session?.());
  }

  $("#pay-btn").addEventListener("click", async () => {
    if (!actions) return;
    const btn = $("#pay-btn"), label = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="spin" aria-hidden="true"></span><span>Paying</span>';
    say("");
    try {
      const r = await actions.confirm();
      if (r?.type === "error") say(r.error?.message || "The payment didn't go through.", "error");
      // On success Stripe sends the browser to /booked.
    } catch (err) {
      console.error(err);
      say("The payment didn't go through. You weren't charged. Try again.", "error");
    } finally {
      btn.innerHTML = label; btn.disabled = false;
    }
  });

  // ---- start -----------------------------------------------------------------------
  fetch("/api/pay/config").then((r) => r.json()).then((c) => {
    config = c;
    showPrice(c);
    if (!c.publishable_key) say("Payments aren't set up yet.", "error");
  }).catch(() => say("Checkout is unavailable right now. Try again in a minute.", "error"));
})();
