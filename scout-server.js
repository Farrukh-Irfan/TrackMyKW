/* Track My KW — server-side capture, plans and usage limits.
 * Loaded by dashboard.html AFTER the main script, so it can use its globals:
 * sb, currentUser, keywords, view, render, toast, importSnapList.
 */
(function () {
  "use strict";
  if (window.__scoutServerLoaded) return;
  window.__scoutServerLoaded = true;
  if (typeof sb === "undefined") return;

  /* ---------- billing ---------- */
  var PAYMENT_LINK = "https://buy.polar.sh/polar_cl_PG7pQOxFSow7m8HT3Vud8zQV5daEGwrOCdwGa1JCFwz";   // Polar checkout link, $9.99/month Pro
  var PORTAL_LINK  = "https://polar.sh/track-my-kw/portal";   // Polar customer portal (manage / cancel)

  var busy = false;
  var skipServerUntil = 0;
  window.__scoutBypass = false;

  function longToast(msg, ms) {
    toast(msg);
    var t = document.getElementById("toast");
    if (t) { clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("show"); }, ms || 6000); }
  }

  /* ---------- usage chip ---------- */
  var chip = document.createElement("span");
  chip.id = "limitsChip";
  chip.className = "user-chip";
  chip.style.display = "none";
  var pill = document.getElementById("modePill");
  if (pill && pill.parentNode) pill.parentNode.insertBefore(chip, pill);

  var planBtn = document.createElement("a");
  planBtn.id = "planBtn";
  planBtn.className = "ghost";
  planBtn.target = "_blank"; planBtn.rel = "noopener";
  planBtn.style.cssText = "display:none;text-decoration:none;padding:6px 12px;border-radius:8px;font-weight:600;cursor:pointer";
  if (pill && pill.parentNode) pill.parentNode.insertBefore(planBtn, pill);

  /* ---------- redeem code (free plan only) ---------- */
  var redeemWrap = document.createElement("span");
  redeemWrap.id = "redeemWrap";
  redeemWrap.style.cssText = "display:none;align-items:center;gap:6px";
  redeemWrap.innerHTML = '<a href="#" id="redeemToggle" style="font-size:13px;color:inherit;opacity:.75">Have a code?</a>' +
    '<span id="redeemBox" style="display:none;align-items:center;gap:6px">' +
    '<input id="redeemInput" type="text" placeholder="Enter code" autocomplete="off" spellcheck="false" style="width:120px;padding:6px 8px;border-radius:8px;border:1px solid var(--line,#444);background:transparent;color:inherit;text-transform:uppercase">' +
    '<button id="redeemGo" class="ghost" type="button">Apply</button></span>';
  if (pill && pill.parentNode) pill.parentNode.insertBefore(redeemWrap, planBtn);
  var rToggle = redeemWrap.querySelector("#redeemToggle"), rBox = redeemWrap.querySelector("#redeemBox"),
      rInput = redeemWrap.querySelector("#redeemInput"), rGo = redeemWrap.querySelector("#redeemGo");
  rToggle.addEventListener("click", function (e) {
    e.preventDefault();
    var open = rBox.style.display !== "none";
    rBox.style.display = open ? "none" : "inline-flex";
    if (!open) rInput.focus();
  });
  async function redeem() {
    var code = (rInput.value || "").trim();
    if (!code) return;
    rGo.disabled = true;
    try {
      var r = await sb.rpc("redeem_code", { p_code: code });
      if (r.error) {
        longToast(String(r.error.message || "Couldn't redeem that code.").replace(/^BAD_CODE:\s*/, ""));
      } else {
        rInput.value = ""; rBox.style.display = "none";
        longToast("Code applied \u2014 you're on Pro!");
        refreshLimits();
      }
    } catch (e) { longToast("Couldn't redeem that code. Try again."); }
    finally { rGo.disabled = false; }
  }
  rGo.addEventListener("click", redeem);
  rInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); redeem(); } });

  function setPlanButton(plan) {
    redeemWrap.style.display = plan === "pro" ? "none" : "inline-flex";
    if (plan === "pro") {
      if (!PORTAL_LINK) { planBtn.style.display = "none"; return; }
      planBtn.textContent = "Pro \u00b7 Manage billing"; planBtn.href = PORTAL_LINK;
    } else {
      if (!PAYMENT_LINK) { planBtn.style.display = "none"; return; }
      var u = (typeof currentUser !== "undefined" && currentUser) || {};
      planBtn.textContent = "Upgrade to Pro";
      planBtn.href = PAYMENT_LINK + (PAYMENT_LINK.indexOf("?") < 0 ? "?" : "&") +
        "reference_id=" + encodeURIComponent(u.id || "") + "&customer_email=" + encodeURIComponent(u.email || "");
      planBtn.style.background = "var(--brand)"; planBtn.style.color = "#fff";
    }
    planBtn.style.display = "";
  }

  async function refreshLimits() {
    if (typeof currentUser === "undefined" || !currentUser) { chip.style.display = "none"; planBtn.style.display = "none"; redeemWrap.style.display = "none"; return; }
    try {
      var r = await sb.rpc("get_my_limits");
      var d = r && r.data;
      if (!d) return;
      var left = Math.max(0, d.maxCapturesPerDay - d.capturesToday);
      var kwText = d.maxKeywords >= 1000 ? d.keywords + " keywords" : d.keywords + "/" + d.maxKeywords + " keywords";
      chip.textContent = kwText + " · " + left + " captures left today";
      setPlanButton(d.plan);
      chip.title = "Captures reset on a rolling 24-hour window.";
      chip.style.display = "";
    } catch (e) { /* not critical */ }
  }
  sb.auth.onAuthStateChange(function () { setTimeout(refreshLimits, 900); });
  setInterval(refreshLimits, 60000);

  /* ---------- keyword cap: don't retry forever, tell the user ---------- */
  var origRpc = sb.rpc.bind(sb);
  sb.rpc = function (name, args) {
    var p = origRpc(name, args);
    if (name !== "save_keyword") return p;
    return Promise.resolve(p).then(function (res) {
      if (res && res.error && /KEYWORD_LIMIT/.test(res.error.message || "")) {
        var nm = ((args && args.p && args.p.name) || "").toLowerCase();
        keywords = keywords.filter(function (k) { return (k.name || "").toLowerCase() !== nm; });
        if (view && view.name === "detail") view = { name: "list", kwId: null };
        render();
        longToast("Keyword limit reached — " + String(res.error.message).replace(/^KEYWORD_LIMIT:\s*/, "") + ". Delete one to add another" + (PAYMENT_LINK ? ", or upgrade to Pro." : "."));
        setTimeout(refreshLimits, 500);
        return { data: args && args.p && args.p.id, error: null };
      }
      return res;
    });
  };

  /* ---------- server capture ---------- */
  async function callCapture(keyword) {
    var out = await sb.functions.invoke("scout-capture", { body: { keyword: keyword } });
    if (!out.error) return { ok: true, data: out.data };
    var body = null, status = null;
    try { status = out.error.context && out.error.context.status; body = await out.error.context.json(); } catch (e) { /* network error */ }
    return { ok: false, status: status, body: body };
  }

  async function capture(btn, keyword) {
    if (busy) return;
    busy = true;
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = "Capturing…";
    toast("Capturing “" + keyword + "” from Target…");
    try {
      var res = await callCapture(keyword);
      if (res.ok && res.data && res.data.snapshot) {
        var input = document.getElementById("newKw");
        if (input) input.value = "";
        var ok = await importSnapList([res.data.snapshot], "from Target");
        var lim = res.data.limits || {};
        if (ok) {
          setTimeout(function () {
            longToast("Captured " + res.data.snapshot.results.length + " products (" + res.data.organic + " organic)" +
              (typeof lim.capturesLeft === "number" ? " · " + lim.capturesLeft + " captures left today" : ""), 5000);
          }, 1600);
        }
        refreshLimits();
        return;
      }
      var code = res.body && res.body.error;
      if (code === "keyword_limit") { longToast("Keyword limit reached — " + res.body.message + ". Delete one to add another" + (PAYMENT_LINK ? ", or upgrade to Pro." : ".")); return; }
      if (code === "capture_limit") { longToast("Daily capture limit reached — " + res.body.message + ". Try again tomorrow" + (PAYMENT_LINK ? ", or upgrade to Pro for 50 a day." : ".")); refreshLimits(); return; }
      if (code === "bad_keyword") { longToast(res.body.message); return; }
      if (res.status === 401) { longToast("Your session expired — please sign in again."); return; }
      longToast("Target didn't respond just now (this didn't use your daily captures). Please try again in a minute.");
    } catch (e) {
      longToast("Couldn't reach the server. Check your connection and try again.");
    } finally {
      busy = false;
      if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
    }
  }

  function currentKeywordFor(btn) {
    if (btn.id === "addKw") {
      var v = (document.getElementById("newKw") || {}).value || "";
      return v.replace(/\s+/g, " ").trim();
    }
    var kw = (typeof view !== "undefined" && view && view.kwId) ? keywords.find(function (k) { return k.id === view.kwId; }) : null;
    return kw ? kw.name : "";
  }

  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("#addKw, #snapThis") : null;
    if (!btn || window.__scoutBypass || Date.now() < skipServerUntil || typeof currentUser === "undefined" || !currentUser) return;
    var kw = currentKeywordFor(btn);
    if (!kw) return;
    e.preventDefault(); e.stopImmediatePropagation();
    capture(btn, kw);
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || !e.target || e.target.id !== "newKw" || window.__scoutBypass || Date.now() < skipServerUntil) return;
    if (typeof currentUser === "undefined" || !currentUser) return;
    var kw = currentKeywordFor(document.getElementById("addKw"));
    if (!kw) return;
    e.preventDefault(); e.stopImmediatePropagation();
    capture(document.getElementById("addKw"), kw);
  }, true);

  setTimeout(refreshLimits, 1500);
})();
