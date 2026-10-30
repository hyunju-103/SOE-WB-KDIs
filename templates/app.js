(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  let CFG = null, DATA = null;
  try { CFG = JSON.parse($("#app-config").textContent); DATA = JSON.parse($("#app-data").textContent); } catch (e) { /* handled below */ }
  if (!CFG || !CFG.ZEM_COEFFICIENTS || !DATA || !DATA.meta || typeof SOEEngine === "undefined") {
    const p = document.createElement("p"); p.className = "load-error";
    p.textContent = "No tool data found. Generate this page with report.py or the Report page of the SOE Fiscal Risk Tool.";
    $("#wrap").prepend(p); return;
  }
  const E = SOEEngine.create(CFG);
  const M = DATA.meta;
  const NUMCOLS = new Set(CFG.ALL_NUMERIC_COLUMNS || CFG.NUMERIC_COLUMNS);
  let framed = true;
  try { framed = window.self !== window.top; } catch (e) { framed = true; }
  const canDownload = !framed || !!M.allow_download;

  /* =====================================================================
     helpers
     ===================================================================== */
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat(3)) if (c !== null && c !== undefined && c !== false) e.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
    return e;
  }
  /** replaceChildren without empty slots (the DOM would turn null into the text "null") */
  const put = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const txt = (parent, x, y, s, cls, anchor = "start", size = 12, weight) => {
    const t = svgEl("text", { x, y, class: cls, "text-anchor": anchor, "font-size": size, "dominant-baseline": "middle" }, parent);
    if (weight) t.setAttribute("font-weight", weight);
    t.textContent = s; return t;
  };
  const ok = E.isNum;
  const fmt = (v, d = 1) => (!ok(v) ? "—" : (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace("-", "−"));
  const sgn = (v, d = 2) => (!ok(v) ? "—" : (v > 0 ? "+" : "") + fmt(v, d));
  const pct = (v, d = 1) => (!ok(v) ? "—" : fmt(v * 100, d) + "%");
  const pctAuto = (v) => (!ok(v) ? "—" : pct(v, Math.abs(v) >= 1 ? 0 : Math.abs(v) >= 0.1 ? 1 : 2));
  const pctS = (v) => (!ok(v) ? "—" : v !== 0 && Math.abs(v) < 0.00005 ? (v < 0 ? "> −0.01%" : "< 0.01%") : pct(v, 2));
  const pl = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const uniq = (a) => [...new Set(a)];
  const sum = (a) => a.reduce((s, v) => s + (ok(v) ? v : 0), 0);
  const mean = (a) => { const v = a.filter(ok); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
  const last = (a) => a[a.length - 1];
  let SC = 1, CUR = "";
  function money(v, withCur = false) {
    if (!ok(v)) return "—";
    const x = v * SC, a = Math.abs(x);
    let s;
    if (a >= 1e12) s = fmt(x / 1e12, 2) + " tn"; else if (a >= 1e9) s = fmt(x / 1e9, 1) + " bn"; else if (a >= 1e6) s = fmt(x / 1e6, 1) + " m";
    else s = Math.round(x).toLocaleString("en-US").replace("-", "−");
    return withCur && CUR ? s + " " + CUR : s;
  }
  function moneyTick(t, step) {
    const a = Math.abs(step * SC), x = t * SC;
    const u = a >= 1e12 ? [1e12, " tn"] : a >= 1e9 ? [1e9, " bn"] : a >= 1e6 ? [1e6, " m"] : [1, ""];
    const d = Number.isInteger(+((step * SC) / u[0]).toFixed(6)) ? 0 : 1;
    return t === 0 ? "0" : fmt(x / u[0], d) + u[1];
  }
  const GLYPH = { ok: "●", watch: "▲", alert: "■" };
  const STLABEL = { ok: "Good", watch: "Watch", alert: "Alert" };
  const ZLABEL = { ok: "Safe", watch: "Grey zone", alert: "Distress" };
  const ZK = { Distress: "alert", Grey: "watch", Safe: "ok" };
  const RAG = { Red: "alert", Amber: "watch", Green: "ok" };
  const zk = (zone) => ZK[zone] || "none";
  const ZORDER = ["Distress", "Grey", "Safe"];
  function stChip(k, label) {
    return el("span", { class: "st " + k }, GLYPH[k] ? el("i", { "aria-hidden": "true" }, GLYPH[k]) : null, label || STLABEL[k] || "—");
  }
  const zoneChip = (zone) => stChip(zk(zone), ZLABEL[zk(zone)] || zone);
  const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
  function nice(lo, hi, n = 5) {
    if (!ok(lo) || !ok(hi)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-12) { hi = lo + (Math.abs(lo) || 1) * 0.5; lo = lo - (Math.abs(lo) || 1) * 0.5; }
    n = Math.max(2, n);
    const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw));
    let step = mag * 10;
    for (const m of [1, 2, 2.5, 5, 10, 20]) { const s0 = m * mag; if (Math.ceil(hi / s0 - 1e-9) - Math.floor(lo / s0 + 1e-9) <= n + 1) { step = s0; break; } }
    const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
    const ticks = [];
    for (let t = a; t <= b + step / 2; t += step) ticks.push(Math.abs(t) < step / 1e6 ? 0 : +t.toFixed(10));
    return { lo: a, hi: b, ticks, step };
  }
  const tickLab = (t, step) => (step >= 1 ? fmt(t, 0) : fmt(t, step >= 0.1 ? 1 : 2));
  function barPath(x0, x1, y, h, r = 3) {
    const w = Math.abs(x1 - x0); r = Math.min(r, w, h / 2);
    if (x1 >= x0) return `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`;
    return `M${x0},${y}H${x1 + r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 + r},${y + h}H${x0}Z`;
  }
  function vbar(x, y0, y1, w, r = 3) {
    const h = Math.abs(y0 - y1); r = Math.min(r, h, w / 2);
    if (y1 <= y0) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
    return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
  }
  function boldText(parent, text) {
    String(text).split("**").forEach((part, i) => { if (part) parent.appendChild(i % 2 ? el("b", {}, part) : document.createTextNode(part)); });
    return parent;
  }
  function toCSV(head, rows) {
    const q = (v) => { const s = v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v)) ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [head.map(q).join(","), ...rows.map((r) => r.map(q).join(","))].join("\n") + "\n";
  }
  function download(name, text, type = "text/csv") {
    // text: a string, or bytes (Uint8Array) for binary files such as the training workbook
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = el("a", { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const b64Bytes = (b64) => { const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
  const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  /** "Copy data" (+ "Download CSV" when the page runs on its own, outside a viewer frame) */
  function dataButtons(getCSV, name, what = "data") {
    const box = el("div", { class: "btn-row" });
    const cl = what === "data" ? "Copy data" : "Copy " + what;
    const copy = el("button", { class: "btn-ghost", type: "button" }, cl);
    copy.addEventListener("click", async () => {
      const text = getCSV();
      try { await navigator.clipboard.writeText(text); copy.textContent = "Copied"; setTimeout(() => (copy.textContent = cl), 1500); }
      catch (e) {
        const ta = el("textarea", { rows: "6", style: "width:100%;font:12px monospace", "aria-label": "Data as CSV" }); ta.value = text;
        box.appendChild(ta); ta.focus(); ta.select(); copy.textContent = "Select and copy";
      }
    });
    box.appendChild(copy);
    if (canDownload) box.appendChild(el("button", { class: "btn-ghost", type: "button", onclick: () => download(name, getCSV()) }, what === "data" ? "⬇ Download CSV" : `⬇ ${what[0].toUpperCase() + what.slice(1)} (CSV)`));
    return box;
  }

  /* ---------- tooltip ---------- */
  const tip = $("#tip");
  function showTip(evt, title, rows) {
    tip.replaceChildren(el("div", { class: "tip-title" }, title));
    for (const [val, lab] of rows || []) tip.appendChild(el("div", { class: "tip-row" }, val ? el("strong", {}, val) : null, lab ? el("span", {}, lab) : null));
    tip.hidden = false;
    let x, y;
    if (evt && evt.clientX != null && evt.type !== "focus") { x = evt.clientX; y = evt.clientY; } else { const b = evt.target.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top; }
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = x + 14, top = y - th - 10;
    if (left + tw > window.innerWidth - 8) left = x - tw - 14;
    if (left < 8) left = 8;
    if (top < 8) top = y + 16;
    tip.style.left = left + "px"; tip.style.top = top + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  function bindTip(node, title, rows) {
    const r = () => (typeof rows === "function" ? rows() : rows);
    node.addEventListener("pointermove", (e) => showTip(e, title, r()));
    node.addEventListener("pointerleave", hideTip);
    node.addEventListener("focus", (e) => showTip(e, title, r()));
    node.addEventListener("blur", hideTip);
  }
  function info(text) { const i = el("i", { class: "info", tabindex: "0", role: "img", "aria-label": text }, "i"); bindTip(i, text, []); return i; }

  /* ---------- controls ---------- */
  let uid = 0;
  const nid = (p) => `${p}-${++uid}`;
  function fSelect(label, options, value, onChange, opt = {}) {
    const id = opt.id || nid("sel");
    const s = el("select", { id });
    options.forEach((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; const op = el("option", { value: String(v) }, l); if (String(v) === String(value)) op.selected = true; s.appendChild(op); });
    s.addEventListener("change", () => onChange(opt.num ? Number(s.value) : s.value));
    return el("div", { class: "fld" }, label ? el("label", { for: id }, el("span", {}, label, opt.info ? info(opt.info) : null)) : null, s);
  }
  function fSlider(label, o, onInput) {
    const id = o.id || nid("rng");
    const out = el("output", { for: id }, o.fmt(o.value));
    const r = el("input", { type: "range", id, min: o.min, max: o.max, step: o.step, value: o.value });
    r.addEventListener("input", () => { const v = Number(r.value); out.textContent = o.fmt(v); onInput(v); });
    return el("div", { class: "fld" }, el("label", { for: id }, el("span", {}, label, o.info ? info(o.info) : null), out), r, o.help ? el("small", {}, o.help) : null);
  }
  function seg(options, value, onChange, label) {
    const box = el("div", { class: "seg", role: "group", "aria-label": label || "View" });
    options.forEach(([v, l]) => {
      const b = el("button", { type: "button", "aria-pressed": String(v === value) }, l);
      b.addEventListener("click", () => { box.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); onChange(v); });
      box.appendChild(b);
    });
    return box;
  }
  function chipsMulti(options, set, onChange, label) {
    const box = el("div", { class: "chips", role: "group", "aria-label": label || "" });
    if (label) box.appendChild(el("span", { class: "chips-label" }, label));
    options.forEach(([v, l]) => {
      const b = el("button", { class: "chip", type: "button", "aria-pressed": String(set.has(v)) }, l);
      b.addEventListener("click", () => {
        if (set.has(v)) { if (set.size > 1) set.delete(v); } else set.add(v);
        box.querySelectorAll(".chip").forEach((x, i) => x.setAttribute("aria-pressed", String(set.has(options[i][0]))));
        onChange();
      });
      box.appendChild(b);
    });
    return box;
  }
  /** From–to year selects (replace the one-chip-per-year control, which does not scale to 20 years) */
  function yearRangeCtl(years, from, to, onChange, label = "Years") {
    const mk = (val, which) => {
      const s = el("select", { "aria-label": `${label}: ${which}` });
      years.forEach((y) => s.appendChild(el("option", { value: String(y), selected: y === val ? true : null }, String(y))));
      return s;
    };
    const a = mk(from, "from"), b = mk(to, "to");
    const fire = (src) => {
      let f = Number(a.value), t = Number(b.value);
      if (f > t) { if (src === a) t = f; else f = t; a.value = String(f); b.value = String(t); }
      onChange(f, t);
    };
    a.addEventListener("change", () => fire(a)); b.addEventListener("change", () => fire(b));
    return el("div", { class: "fld" }, el("span", { class: "lbl" }, label), el("div", { class: "range-sel" }, a, el("span", { class: "muted" }, "to"), b));
  }
  /** long lists show the first LIMIT rows (the weakest or largest) until the reader asks for all */
  const LIMIT = 12;
  function moreToggle(n, expanded, onToggle, less = `Show the ${LIMIT} weakest only`, what = "SOEs") {
    if (n <= LIMIT) return null;
    return el("button", { class: "btn-ghost more", type: "button", "aria-expanded": String(expanded), onclick: () => onToggle(!expanded) }, expanded ? less : `Show all ${n} ${what}`);
  }
  const clipRows = (rows, expanded) => (expanded ? rows : rows.slice(0, LIMIT));
  function card(title, sub, tools, cls = "") {
    const body = el("div");
    const head = title ? el("div", { class: "card-head" }, el("div", {}, el("h3", {}, title), sub ? el("p", { class: "sub" }, sub) : null), tools ? el("div", { class: "card-tools" }, tools) : null) : null;
    const root = el("div", { class: "card " + cls }, head, body);
    return { root, body, head };
  }
  function pageHead(eyebrow, title, text, tools) {
    return el("div", { class: "page-head" }, el("div", {}, el("div", { class: "eyebrow" }, eyebrow), el("h2", {}, title), el("p", {}, text)), tools || null);
  }
  function tile(label, status, statusLabel, value, small, sub) {
    // the box takes a light, see-through wash of its status colour (neutral blue when it has no status)
    return el("div", { class: "card tile t-" + (status && status !== "none" ? status : "neutral") },
      el("div", { class: "tile-top" }, el("span", { class: "tile-label" }, label), status ? stChip(status, statusLabel) : null),
      el("div", { class: "tile-value" }, value, small ? el("small", {}, small) : null),
      el("div", { class: "tile-sub" }, sub || ""));
  }
  /** the row of key figures at the top of every tab (filled by each page's render) */
  const statStrip = () => el("div", { class: "statstrip", role: "region", "aria-label": "Key figures" });
  const median = (a) => E.quantile(a.filter(ok), 0.5);
  const cntChip = (n, bad = "alert") => (n ? [bad, STLABEL[bad]] : ["ok", STLABEL.ok]);
  function countTile(label, n, of, sub, bad = "alert") { const [k, l] = cntChip(n, bad); return tile(label, k, l, String(n), `of ${of}`, sub); }
  function nameCell(name, sector) { return el("td", { class: "name" }, el("span", { class: "nm" }, name), el("span", { class: "sec" }, sector)); }
  function statusCell(k, value, sub, cls = "") {
    return el("td", { class: (k || "na") + " " + cls }, el("span", { class: "cell" }, el("span", { class: "v" }, GLYPH[k] ? el("i", { "aria-hidden": "true" }, GLYPH[k]) : null, value), sub ? el("span", { class: "d" }, sub) : null));
  }
  function simpleTable(head, rows, opt = {}) {
    const t = el("table", { class: opt.cls || "" });
    t.appendChild(el("thead", {}, el("tr", {}, head.map((h, i) => el("th", { class: opt.right && opt.right(i) ? "r" : "" }, h)))));
    t.appendChild(el("tbody", {}, rows.map((r) => el("tr", {}, r.map((c, i) => (c instanceof Node && c.tagName === "TD" ? c : el("td", { class: opt.right && opt.right(i) ? "r" : "" }, c)))))));
    if (opt.foot) t.appendChild(el("tfoot", {}, el("tr", {}, opt.foot.map((c, i) => el("td", { class: opt.right && opt.right(i) ? "r" : "" }, c)))));
    return el("div", { class: "tbl-wrap" + (opt.tall ? " tall" : "") }, t);
  }
  function zoneBar(counts, n) {
    const bar = el("div", { class: "zonebar", role: "img", "aria-label": `Safe ${counts.Safe}, grey zone ${counts.Grey}, distress ${counts.Distress}` });
    [["Safe", "var(--good)"], ["Grey", "var(--warn)"], ["Distress", "var(--crit)"]].forEach(([z, col]) => { if (counts[z]) bar.appendChild(el("div", { style: `width:${(counts[z] / n) * 100}%;background:${col}` })); });
    const lg = el("div", { class: "zonelegend" });
    [["ok", "Safe"], ["watch", "Grey"], ["alert", "Distress"]].forEach(([k, z]) => lg.appendChild(el("span", {}, stChip(k, ZLABEL[k]), el("b", { class: "num" }, String(counts[z])), ` (${n ? Math.round((counts[z] / n) * 100) : 0}%)`)));
    return [bar, lg];
  }
  function zoneCounts(rows) { const c = { Distress: 0, Grey: 0, Safe: 0 }; rows.forEach((r) => { if (r.Zone in c) c[r.Zone]++; }); return c; }
  function tracks(labels, values) {
    const box = el("div", { class: "contrib" });
    const m = Math.max(0.25, ...values.filter(ok).map(Math.abs));
    values.forEach((v, i) => {
      const tr = el("div", { class: "track" });
      if (ok(v)) tr.appendChild(el("span", { class: v >= 0 ? "pos" : "neg", style: `width:${(Math.abs(v) / m) * 50}%` }));
      box.appendChild(el("div", { class: "contrib-row" }, el("span", { class: "lbl" }, labels[i]), tr, el("span", { class: "val" }, sgn(v, 2))));
    });
    return box;
  }
  function summaryBox(text, tag = "Automated summary — generated from the data on screen, not written by a person") {
    return boldText(el("div", { class: "summary" }, el("span", { class: "tag" }, tag)), text);
  }
  function legendItem(svg, label) { const s = el("span"); s.innerHTML = svg; s.appendChild(document.createTextNode(label)); return s; }
  const LG = {
    base: '<svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" class="ln-base"/></svg>',
    str: '<svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" class="ln-str"/></svg>',
    act: '<svg width="14" height="12" aria-hidden="true"><rect x="0" y="4" width="14" height="5" class="act-band"/></svg>',
    grey: '<svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" class="z-warn"/></svg>',
    dist: '<svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" class="z-crit"/></svg>',
    thrC: '<svg width="20" height="10" aria-hidden="true"><line x1="1" y1="5" x2="19" y2="5" class="thr-crit"/></svg>',
    thrW: '<svg width="20" height="10" aria-hidden="true"><line x1="1" y1="5" x2="19" y2="5" class="thr-warn"/></svg>',
    thrG: '<svg width="20" height="10" aria-hidden="true"><line x1="1" y1="5" x2="19" y2="5" class="thr-good"/></svg>',
    hl: '<svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" class="dot-hl"/></svg>',
    ref: '<svg width="20" height="10" aria-hidden="true"><line x1="1" y1="5" x2="19" y2="5" class="ref-l"/></svg>',
    bar: '<svg width="12" height="12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="2" style="fill:var(--accent)"/></svg>',
    barHl: '<svg width="12" height="12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="2" style="fill:var(--heading)"/></svg>',
    max: '<svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" class="dot-max"/></svg>',
    prev: '<svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" class="dot-prev"/></svg>',
    now: '<svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" class="dot-now"/></svg>',
    outer: '<svg width="14" height="12" aria-hidden="true"><rect width="14" height="12" class="band-outer"/></svg>',
    inner: '<svg width="14" height="12" aria-hidden="true"><rect width="14" height="12" class="band-inner"/></svg>',
    med: '<svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" class="ln-med"/></svg>',
  };
  const legendRow = (items, cls = "top") => el("div", { class: "legend-row " + cls }, items);

  /* =====================================================================
     charts
     ===================================================================== */
  const widthOf = (box) => Math.max(260, Math.round(box.clientWidth || box.getBoundingClientRect().width || 600));
  function shadeZones(svg, sc, xy, horizontal, x0, x1) {
    const c0 = Math.max(sc.lo, Math.min(sc.hi, CFG.Z_DISTRESS_CUTOFF)), c1 = Math.max(sc.lo, Math.min(sc.hi, CFG.Z_SAFE_CUTOFF));
    if (horizontal) {
      if (c0 > sc.lo) svgEl("rect", { x: xy(sc.lo), y: x0, width: xy(c0) - xy(sc.lo), height: x1 - x0, class: "z-crit" }, svg);
      if (c1 > c0) svgEl("rect", { x: xy(c0), y: x0, width: xy(c1) - xy(c0), height: x1 - x0, class: "z-warn" }, svg);
    } else {
      if (c0 > sc.lo) svgEl("rect", { x: x0, y: xy(c0), width: x1 - x0, height: xy(sc.lo) - xy(c0), class: "z-crit" }, svg);
      if (c1 > c0) svgEl("rect", { x: x0, y: xy(c1), width: x1 - x0, height: xy(c0) - xy(c1), class: "z-warn" }, svg);
    }
    return [c0, c1];
  }
  /** horizontal bars: rows {label, sub, s, v, lab, cls, tipTitle, tip} */
  function hbars(box, rows, opt = {}) {
    const W = widthOf(box), narrow = W < 520;
    // narrow cards: size the label column to the longest name (up to ~40% of the width) instead of a fixed 76px
    // (the grey sub-line, e.g. "CCC+ · PD 16.3%", counts too, so it is not cut short)
    const maxLen = Math.max(4, ...rows.map((r) => Math.max(String(r.label).length, r.sub ? String(r.sub).length * (6.2 / 7.4) : 0)));
    const L = narrow ? Math.max(64, Math.min(Math.round(W * 0.42), Math.round(maxLen * 7.4) + 8)) : opt.L || 164, R = narrow ? 72 : opt.R || 104, T = opt.shade ? 20 : 6, B = 28, rowH = opt.rowH || 38, bh = 14;
    const nName = narrow ? Math.max(6, Math.floor((L - 8) / 7.4)) : 24, nSub = narrow ? Math.max(6, Math.floor((L - 6) / 6.2)) : 26;
    const vals = rows.map((r) => r.v).filter(ok);
    const sc = nice(Math.min(0, opt.min ?? 0, ...vals), Math.max(0, opt.max ?? 0, ...vals), Math.min(opt.nTicks || 6, Math.max(2, Math.floor((W - L - R) / 62))));
    const x = lin(sc.lo, sc.hi, L, W - R);
    const H = T + rows.length * rowH + B, pb = T + rows.length * rowH;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    if (opt.shade) {
      const [c0, c1] = shadeZones(svg, sc, x, true, T, pb);
      if (c0 > sc.lo && x(c0) - x(sc.lo) > 50) txt(svg, x(sc.lo) + 4, T - 10, "Distress", "t-muted z-lab");
      if (x(c1) - x(c0) > 44) txt(svg, (x(c0) + x(c1)) / 2, T - 10, "Grey", "t-muted z-lab", "middle");
      if (sc.hi > c1 && x(sc.hi) - x(c1) > 80) txt(svg, x(sc.hi), T - 10, "Safe →", "t-muted z-lab", "end");
    }
    for (const t of sc.ticks) {
      if (t !== 0) svgEl("line", { x1: x(t), x2: x(t), y1: T, y2: pb, class: "grid-l" }, svg);
      txt(svg, x(t), pb + 16, opt.tick ? opt.tick(t, sc.step) : tickLab(t, sc.step), "t-muted num", "middle", 11);
    }
    rows.forEach((d, i) => {
      const y = T + i * rowH, cy = y + rowH / 2;
      const g = svgEl("g", { class: "row" }, svg);
      if (d.s) g.setAttribute("data-s", d.s);
      if (d.sub) { txt(g, 0, cy - 7, clip(d.label, narrow ? nName : 22), "t-head", "start", 12.5, 700); txt(g, 0, cy + 9, clip(d.sub, nSub), "t-muted", "start", 11); }
      else txt(g, 0, cy, clip(d.label, nName), "t-head", "start", 12.5, 700);
      if (ok(d.v)) {
        svgEl("path", { d: barPath(x(0), x(d.v), cy - bh / 2, bh), class: d.cls || "bar" + (d.v < 0 ? " neg" : "") }, g);
        const room = x(d.v) - L;
        if (d.v >= 0) txt(g, x(d.v) + 6, cy, d.lab, "t-ink num", "start", 12, 600);
        else if (room > 7.5 * d.lab.length) txt(g, x(d.v) - 6, cy, d.lab, "t-ink num", "end", 12, 600);
        else txt(g, x(0) + 6, cy, d.lab, "t-ink num", "start", 12, 600);
      } else txt(g, x(0) + 6, cy, "no data", "t-muted", "start", 11.5);
      const hit = svgEl("rect", { x: 0, y, width: W, height: rowH, class: "hit", tabindex: 0, "aria-label": `${d.label} ${d.lab || ""}` }, g);
      bindTip(hit, d.tipTitle || d.label, d.tip || [[d.lab, ""]]);
    });
    svgEl("line", { x1: x(0), x2: x(0), y1: T, y2: pb, class: "zero-l" }, svg);
    box.replaceChildren(svg);
  }
  /** vertical columns by category (years); hl = highlighted index */
  function cols(box, cats, vals, opt = {}) {
    const W = widthOf(box), L = 46, R = 8, T = 20, B = 26, H = opt.h || 200;
    const v = vals.filter(ok);
    const sc = nice(Math.min(0, ...v), Math.max(0, ...v), 4);
    const y = lin(sc.lo, sc.hi, H - B, T);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    for (const t of sc.ticks) { svgEl("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), class: t === 0 ? "zero-l" : "grid-l" }, svg); txt(svg, L - 6, y(t), opt.tick ? opt.tick(t, sc.step) : tickLab(t, sc.step), "t-muted num", "end", 10.5); }
    const n = cats.length, band = (W - L - R) / n, bw = Math.min(26, band * 0.62);
    const lstep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 40))));
    cats.forEach((c, i) => {
      const x0 = L + band * i + (band - bw) / 2, val = vals[i];
      const g = svgEl("g", { class: "row" }, svg);
      if (ok(val)) {
        svgEl("path", { d: vbar(x0, y(0), y(val), bw), class: i === opt.hl ? "bar" : "bar hl" }, g);
        if (i === opt.hl) txt(g, x0 + bw / 2, val >= 0 ? y(val) - 9 : y(val) + 10, opt.fmt(val), "t-ink num", "middle", 11, 700);
      }
      if (i % lstep === 0 || i === n - 1) txt(g, x0 + bw / 2, H - B + 14, String(c), "t-muted num", "middle", 10.5);
      const hit = svgEl("rect", { x: L + band * i, y: T, width: band, height: H - B - T, class: "hit", tabindex: 0, "aria-label": `${c}: ${opt.fmt(val)}` }, g);
      bindTip(hit, `${opt.title || ""} · ${c}`, [[opt.fmt(val), opt.unitLabel || ""]]);
    });
    box.replaceChildren(svg);
  }
  /** Smooth path through points [[x, y], ...] (x increasing or decreasing): a cardinal spline drawn as cubic
   *  Bézier segments. It passes through every data point with no corners; the tangent at each point follows the
   *  neighbouring points (SMOOTH_TENSION × the Catmull-Rom tangent), and the ends are natural. Between two
   *  points the curve is for reading the trend only — the values are the ones at the points. */
  const SMOOTH_TENSION = CFG.LINE_SMOOTH_TENSION ?? 0.75;
  function smoothPath(pts, move = true) {
    const n = pts.length;
    if (!n) return "";
    const P = (p) => `${+p[0].toFixed(2)},${+p[1].toFixed(2)}`;
    if (n === 1) return (move ? "M" : "L") + P(pts[0]);
    if (n === 2) return (move ? "M" : "L") + P(pts[0]) + "L" + P(pts[1]);
    const h = [], m = [];
    for (let i = 0; i < n - 1; i++) { h[i] = pts[i + 1][0] - pts[i][0]; m[i] = h[i] ? (pts[i + 1][1] - pts[i][1]) / h[i] : 0; }
    const t = new Array(n);
    for (let i = 1; i < n - 1; i++) { const dx = pts[i + 1][0] - pts[i - 1][0]; t[i] = dx ? SMOOTH_TENSION * (pts[i + 1][1] - pts[i - 1][1]) / dx : 0; }
    t[0] = (3 * m[0] - t[1]) / 2;
    t[n - 1] = (3 * m[n - 2] - t[n - 2]) / 2;
    let d = (move ? "M" : "L") + P(pts[0]);
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], k = h[i] / 3;
      d += `C${P([x0 + k, y0 + k * t[i]])} ${P([x1 - k, y1 - k * t[i + 1]])} ${P([x1, y1])}`;
    }
    return d;
  }
  /** line chart over index positions; series {vals, cls, dot, label}; opt {zones, hlines, band, active, yFmt, h, xLab, tip, endLabel} */
  function lines(box, xs, series, opt = {}) {
    const W = widthOf(box), L = opt.L || 50, R = opt.R || 48, T = 12, B = 32, H = opt.h || Math.round(Math.min(300, Math.max(210, W * 0.46)));
    let vals = series.flatMap((s) => s.vals).filter(ok);
    (opt.band || []).forEach((b) => { vals = vals.concat(b.lo.filter(ok), b.hi.filter(ok)); });
    (opt.hlines || []).forEach((h) => { if (h.include) vals.push(h.y); });
    let lo = Math.min(...vals), hi = Math.max(...vals);
    // a nearly flat series gets a small band around it instead of a magnified wiggle
    const mag = Math.max(Math.abs(lo), Math.abs(hi));
    if (hi - lo < mag * 0.04) { const mid = (hi + lo) / 2, h = Math.max(mag * 0.04, 1e-9); lo = mid - h; hi = mid + h; }
    if (opt.zones) { lo = Math.min(lo, CFG.Z_DISTRESS_CUTOFF - 0.3); hi = Math.max(hi, CFG.Z_SAFE_CUTOFF + 0.3); }
    if (opt.zeroFloor) lo = Math.min(0, lo);
    const pad = (hi - lo || 1) * 0.06; lo -= opt.zeroFloor && lo >= 0 ? 0 : pad; hi += pad;
    const sc = nice(lo, hi, Math.max(3, Math.min(6, Math.floor((H - T - B) / 34))));
    const n = xs.length;
    const x = n > 1 ? lin(0, n - 1, L + 10, W - R) : () => (L + W - R) / 2, y = lin(sc.lo, sc.hi, H - B, T);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    if (opt.zones) shadeZones(svg, sc, y, false, L, W - R);
    for (const t of sc.ticks) { svgEl("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), class: t === 0 ? "zero-l" : "grid-l" }, svg); txt(svg, L - 6, y(t), opt.yFmt ? opt.yFmt(t, sc.step) : tickLab(t, sc.step), "t-muted num", "end", 11); }
    (opt.hlines || []).forEach((h) => { if (h.y >= sc.lo && h.y <= sc.hi) { svgEl("line", { x1: L, x2: W - R, y1: y(h.y), y2: y(h.y), class: h.cls }, svg); if (h.label) txt(svg, W - R + 4, y(h.y), h.label, "t-muted", "start", 10.5, 600); } });
    if (opt.active && n > 1) svgEl("rect", { x: x(opt.active[0] - 0.5), y: H - B + 1, width: x(Math.min(opt.active[1] + 0.5, n - 1)) - x(opt.active[0] - 0.5), height: 5, class: "act-band" }, svg);
    // label every step-th point counting back from the last one, so the latest year is always labelled and never crowded
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 44))));
    // the first year too, when it is not too close to the next label
    xs.forEach((xv, i) => { if ((n - 1 - i) % step === 0 || (i === 0 && (n - 1) % step >= step * 0.6)) txt(svg, x(i), H - B + 20, opt.xLab ? opt.xLab(i) : String(xv), "t-muted num", "middle", 11); });
    (opt.band || []).forEach((b) => {
      const idx = b.hi.map((v, i) => i).filter((i) => ok(b.hi[i]) && ok(b.lo[i])); // skip years where a band edge is missing
      if (idx.length < 2) return;
      const top = idx.map((i) => [x(i), y(b.hi[i])]), bottom = idx.slice().reverse().map((i) => [x(i), y(b.lo[i])]);
      svgEl("path", { d: smoothPath(top) + smoothPath(bottom, false) + "Z", class: b.cls }, svg);
    });
    const dense = n > (opt.maxDots || 15); // long series: dot the latest point only
    series.forEach((s) => {
      // smooth curve through the points; a missing value breaks the line instead of bridging it
      const segs = []; let cur = [];
      s.vals.forEach((v, i) => { if (ok(v)) cur.push([x(i), y(v)]); else if (cur.length) { segs.push(cur); cur = []; } });
      if (cur.length) segs.push(cur);
      const d = segs.map((sg) => smoothPath(sg)).join("");
      if (d) svgEl("path", { d, class: s.cls }, svg);
      let lastOk = -1; s.vals.forEach((v, i) => { if (ok(v)) lastOk = i; });
      if (s.dot) s.vals.forEach((v, i) => {
        const isolated = !ok(s.vals[i - 1]) && !ok(s.vals[i + 1]); // no line reaches it, so it needs a dot
        if (!ok(v) || (s.skipFirstDot && i === 0) || (dense && i !== lastOk && !isolated)) return;
        const c = s.lastDot && i === lastOk ? s.lastDot : s.dot;
        svgEl("circle", { cx: x(i), cy: y(v), r: c === "prev" ? 4 : c === "now" && s.lastDot ? 5 : 4.5, class: "dot-" + c }, svg);
      });
    });
    if (opt.endLabel) {
      const s = series[opt.endLabel.series];
      let j = s.vals.length - 1; while (j >= 0 && !ok(s.vals[j])) j--;
      if (j >= 0) txt(svg, x(j) + 9, y(s.vals[j]), opt.endLabel.fmt(s.vals[j]), "t-ink num", j === n - 1 ? "start" : "start", 12, 700);
    }
    if (opt.naMarks) series[0].vals.forEach((v, i) => { if (!ok(v)) txt(svg, x(i), H - B - 8, "n/a", "t-muted", "middle", 10, 600); });

    const xh = svgEl("line", { x1: 0, x2: 0, y1: T, y2: H - B, class: "xhair", visibility: "hidden" }, svg);
    const bw = (W - R - L) / Math.max(1, n);
    xs.forEach((xv, i) => {
      const hit = svgEl("rect", { x: x(i) - bw / 2, y: T, width: bw, height: H - B - T, class: "hit", tabindex: 0, "aria-label": String(xv) }, svg);
      const rows = () => (opt.tip ? opt.tip(i) : series.map((s) => [opt.yFmt ? opt.yFmt(s.vals[i], 0.01) : fmt(s.vals[i], 2), s.label || ""]));
      const title = () => (opt.tipTitle ? opt.tipTitle(i) : String(xv));
      hit.addEventListener("pointermove", (ev) => { xh.setAttribute("x1", x(i)); xh.setAttribute("x2", x(i)); xh.setAttribute("visibility", "visible"); showTip(ev, title(), rows()); });
      hit.addEventListener("pointerleave", () => { xh.setAttribute("visibility", "hidden"); hideTip(); });
      hit.addEventListener("focus", (ev) => showTip(ev, title(), rows()));
      hit.addEventListener("blur", hideTip);
    });
    box.replaceChildren(svg);
  }
  function histogram(box, values, opt = {}) {
    const W = widthOf(box), L = 46, R = 14, T = 16, B = 30, H = opt.h || 230;
    const v = values.filter(ok);
    if (!v.length) { box.replaceChildren(el("p", { class: "note" }, "No finite values to plot.")); return; }
    let lo = Math.min(...v), hi = Math.max(...v);
    if (hi - lo < 1e-12) { lo -= 0.5 * (Math.abs(lo) || 1); hi += 0.5 * (Math.abs(hi) || 1); }
    const nb = opt.bins || 40, w = (hi - lo) / nb, counts = new Array(nb).fill(0);
    v.forEach((a) => { counts[Math.min(nb - 1, Math.floor((a - lo) / w))]++; });
    const xs = nice(lo, hi, Math.max(3, Math.min(6, Math.floor((W - L - R) / 80)))), x = lin(xs.lo, xs.hi, L, W - R);
    const ys = nice(0, Math.max(...counts), 4), y = lin(0, ys.hi, H - B, T);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    if (opt.zones) shadeZones(svg, xs, x, true, T, H - B);
    for (const t of ys.ticks) { svgEl("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), class: t === 0 ? "axis-l" : "grid-l" }, svg); txt(svg, L - 6, y(t), fmt(t, 0), "t-muted num", "end", 11); }
    for (const t of xs.ticks) txt(svg, x(t), H - B + 16, opt.xFmt ? opt.xFmt(t, xs.step) : tickLab(t, xs.step), "t-muted num", "middle", 11);
    counts.forEach((c, i) => {
      const a = lo + i * w, b = a + w, x0 = x(a) + 1, x1 = x(b) - 1;
      const g = svgEl("g", { class: "row" }, svg);
      if (c) svgEl("path", { d: vbar(x0, y(0), y(c), Math.max(1, x1 - x0), 2), class: "bar" }, g);
      const hit = svgEl("rect", { x: x(a), y: T, width: Math.max(1, x(b) - x(a)), height: H - B - T, class: "hit" }, g);
      bindTip(hit, `${opt.xFmt ? opt.xFmt(a, w) : fmt(a, 2)} to ${opt.xFmt ? opt.xFmt(b, w) : fmt(b, 2)}`, [[String(c), "simulations"]]);
    });
    (opt.vlines || []).forEach((l) => { if (l.x >= xs.lo && l.x <= xs.hi) { svgEl("line", { x1: x(l.x), x2: x(l.x), y1: T, y2: H - B, class: l.cls }, svg); if (l.label) txt(svg, Math.min(W - R - 2, x(l.x) + 4), T + 2, l.label, "t-ink2", x(l.x) > W - 140 ? "end" : "start", 10.5, 600); } });
    box.replaceChildren(svg);
  }

  /* =====================================================================
     state + data
     ===================================================================== */
  const S = { tab: "home", sectorSel: new Set(), built: {} };
  const DATASETS = DATA.datasets || {};
  // report.py packs each dataset as {cols, data}; unpack to one object per row
  const unpackRows = (d) => d.data.map((r) => Object.fromEntries(d.cols.map((c, i) => [c, r[i]])));
  for (const k in DATASETS) { const d = DATASETS[k]; if (!d.rows && d.cols) d.rows = unpackRows(d); }
  // the opening data may be one of the built-in datasets ("report" with alias): share its rows and sheets
  for (const k in DATASETS) { const d = DATASETS[k], a = d.alias && DATASETS[d.alias]; if (a) { d.rows = a.rows; d.extras = a.extras; } }
  const DOWNLOADS = DATA.downloads || {};
  /** a built-in dataset's supplementary sheets (the training data carries Grants_detail, Source_lines,
   *  Validation and Definitions), joined the same way as the sheets of an uploaded workbook */
  function builtinExtras(key, rows) {
    const ex = DATASETS[key] && DATASETS[key].extras;
    if (!ex) return null;
    const sheet = (n) => (ex[n] ? unpackRows(ex[n]) : []);
    const extra = { sheets: Object.keys(ex), grants: sheet("Grants_detail"), sourceLines: sheet("Source_lines"), validation: sheet("Validation"), checks: sheet("Checks"), definitions: sheet("Definitions") };
    return mergeSupportUpload(rows, extra).meta;
  }
  const coerceRows = (rows) => rows.map((r) => {
    const o = {};
    for (const k in r) {
      if (NUMCOLS.has(k)) o[k] = k === "Year" ? E.parseYear(r[k]) : E.parseNumber(r[k]); // spreadsheet formats: 1,234 · (1,234) · 35% · FY2023
      else o[k] = r[k] === null || r[k] === undefined ? "" : String(r[k]);
    }
    return o;
  }).filter((r) => r.Entity && ok(r.Year)).map((r) => Object.assign(r, {
    Year: Math.trunc(r.Year),
    Sector: /^(utility|utilities|electricity utility)$/i.test(String(r.Sector || "").trim()) ? "Power / Utilities" : (r.Sector || "Other")
  }));
  function unitScale(u) { return E.unitScale(u); }

  function loadDataset(rows, label, example, key) {
    const hz = E.harmonizeUnits(coerceRows(rows)); // one scale for every amount, so portfolio sums add up
    S.rows = hz.rows;
    if (key === "upload" && hz.note) S.uploadNote = (S.uploadNote ? S.uploadNote + " " : "") + hz.note;
    S.en = E.enrich(S.rows);
    S.label = label; S.example = !!example; S.key = key;
    if (key !== "upload") {
      S.mapping = null; S.uploadNote = null; S.uploadExtras = builtinExtras(key, S.rows);
      // Clear supplemental elements cached inside other tabs when switching
      // back to built-in data. They must never remain visible after reset.
      document.querySelectorAll(".upload-support-card").forEach((node) => node.remove());
    }
    CUR = (S.rows.find((r) => r.Currency) || {}).Currency || "";
    SC = unitScale((S.rows.find((r) => r.Units) || {}).Units);
    S.sectors = uniq(S.en.map((r) => r.Sector)).sort();
    S.sectorSel = new Set(S.sectors);
    S.years = uniq(S.en.map((r) => r.Year)).sort((a, b) => a - b);
    S.names = uniq(S.en.map((r) => r.Entity)).sort();
    S.gdp = key === "report" && M.gdp ? M.gdp : null;
    // GDP lookup: nothing is looked up until a country is chosen (or the data carry a Country column)
    S.gdpSrc = S.gdp ? { kind: "manual" } : null;
    S.gdpInputUnit = S.gdpInputUnit || "billion";
    S.gdpCountry = "";
    S.gdpSeries = null; // set from the statements' currency: US dollars when they are in USD, else local currency
    S.gdpYear = null;
    S.growth = M.gdp_growth ?? CFG.DEFAULT_GDP_GROWTH;
    S.volCache = {};
    initPageState();
    S.built = {};
    renderMeta(); renderFilterbar();
    showTab(S.tab, true);
  }
  const allRows = () => S.en;
  const F = () => S.en.filter((r) => S.sectorSel.has(r.Sector));
  const latestOf = (rows) => E.latestPerEntity(rows);
  function volFor(ent, sector) {
    if (!(ent in S.volCache)) S.volCache[ent] = E.revenueVolatility(S.en, ent);
    const v = S.volCache[ent];
    return ok(v) ? [v, false] : [CFG.SECTOR_REVENUE_VOLATILITY[sector] ?? CFG.SECTOR_REVENUE_VOLATILITY.Other, true];
  }
  const MAGS = ["fuel_shock_pct", "fx_shock_pct", "rate_shock_bps", "revenue_shock_std_devs", "refinancing_spread_bps", "arrears_pct_of_revenue", "tariff_increase_pct", "fuel_shock_path"];
  const POLICY_KEYS = Object.keys(CFG.DEFAULT_CASH_SETTINGS || {}); // cash and financing settings, carried with the exposures
  // fuel_shock_path is a list: the zero value is a frozen [], so always assign a new array, never push into it
  const ZERO_MAG = Object.fromEntries(MAGS.map((k) => [k, k === "fuel_shock_path" ? Object.freeze([]) : 0]));
  const STD_MAG = Object.fromEntries(MAGS.map((k) => [k, CFG.DEFAULT_SHOCK_PARAMS[k]]));
  const fuelShare = (sector) => CFG.SECTOR_FUEL_COST_SHARE[sector] ?? CFG.SECTOR_FUEL_COST_SHARE.Other;
  /** bottom-up exposures of one SOE-year as plain values (calculations.soe_exposures) */
  const expoFor = (row) => Object.fromEntries(Object.entries(E.soeExposures(row)).map(([k, v]) => [k, v[0]]));
  /** full parameter set for one SOE, as the Shock Scenarios page builds it from its sliders */
  function paramsFor(row, mags, expo, D, H) {
    const p = Object.assign({}, CFG.DEFAULT_SHOCK_PARAMS, expo, mags);
    p.fuel_cost_share = expo.fuel_cost_share ?? fuelShare(row.Sector);
    p.revenue_sigma = volFor(row.Entity, row.Sector)[0];
    p.revenue_shock_pct = p.revenue_shock_std_devs * p.revenue_sigma;
    p.shock_duration_years = Math.min(D, H);
    return p;
  }
  /** every SOE's latest year under the same shock magnitudes; expoFn(row) gives each SOE's exposures */
  function stressAll(rows, mags, expoFn, D, H, lgd, gdp, growth, ead = 1) {
    const gs = gdp ? E.gdpPath(gdp, growth, H) : null;
    return latestOf(rows).map((r) => {
      const ex = expoFn(r);
      const p0 = paramsFor(r, ZERO_MAG, ex, D, H);
      const base = E.costPath(E.runScenario(r, p0, H), lgd, gs, ead, p0);
      const pp = paramsFor(r, mags, ex, D, H);
      const str = E.costPath(E.runScenario(r, pp, H), lgd, gs, ead, pp);
      const drop = str.slice(1).some((s, i) => ZORDER.indexOf(s.Zone) < ZORDER.indexOf(base[i + 1].Zone));
      return { row: r, base, str, drop, desc: E.describeShocks(pp), params: pp };
    });
  }
  /** the standard stress with each SOE's own exposures — used by Home and Early Warning */
  const standardStress = (rows, mags = STD_MAG) => stressAll(rows, mags, expoFor, CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years, CFG.MC_HORIZON_YEARS, S.efc.lgd, S.gdp, S.growth, S.efc.ead);

  function initPageState() {
    const yrs = S.years, lastY = last(yrs);
    const firstName = S.names[0];
    const efcAll = latestOf(S.en).map((r) => [r.Entity, E.efcRow(r, M.lgd_pct).EFC]).sort((a, b) => (b[1] || 0) - (a[1] || 0));
    S.kpi = { view: "trend", from: yrs[0], to: lastY, soe: firstName, trend: {}, cmp: {}, period: "recent", year: lastY, avgFrom: yrs[0], avgTo: lastY, scCat: "headline", all: false };
    S.alt = { view: "components", soe: firstName, from: yrs[0], to: lastY, period: "recent", year: lastY, avgFrom: yrs[0], avgTo: lastY, all: false };
    S.efc = { year: lastY, mode: "single", lgd: M.lgd_pct ?? CFG.LGD_SLIDER_DEFAULT, per: {}, sens: efcAll.length ? efcAll[0][0] : firstName, basis: "total_liabilities", ead: CFG.EAD_SHARE_DEFAULT, all: false };
    const shockSoe = firstName;
    S.sh = {
      soe: shockSoe, year: null, mags: Object.assign({}, ZERO_MAG), expo: null, expoSrc: {}, expoFor: null,
      H: 3, D: 2, lgd: M.lgd_pct ?? CFG.LGD_SLIDER_DEFAULT, ead: CFG.EAD_SHARE_DEFAULT, view: "single", mode: "none", stype: "fuel", open: {},
      mc: { n: CFG.MC_DEFAULT_SIMULATIONS, fsd: CFG.MC_DEFAULT_FUEL_STD, xsd: CFG.MC_DEFAULT_FX_STD, rsd: CFG.MC_DEFAULT_RATE_STD_BPS, vsd: CFG.MC_DEFAULT_REVENUE_STD_SD,
        corr: Object.assign({}, CFG.MC_DEFAULT_CORRELATIONS, { "fuel|fx": CFG.MC_DEFAULT_CORRELATION }) },
    };
    S.asm = { status: new Set(Object.keys(CFG.PARAMETER_STATUS_LABELS)), group: "all" };
    S.gre = { sov: "BB", outlook: "Stable", role: {}, link: {}, sel: firstName };
    S.ew = { tl: null, cat: "all", sel: null };
    S.how = { soe: null, shock: (S.how && S.how.shock) || "fuel", stop: (S.how && S.how.stop) || "accounts" };
  }

  /* ---------- band + filter bar ---------- */
  function renderMeta() {
    const box = $("#meta"); box.replaceChildren();
    const add = (a, b) => box.appendChild(el("span", {}, a + " ", el("b", {}, b)));
    add("Portfolio", `${pl(S.names.length, "SOE")} · ${pl(S.sectors.length, "sector")}`);
    add("Statements", S.years.length > 1 ? `${S.years[0]}–${last(S.years)}` : String(S.years[0] ?? "—"));
    if (CUR) add("Currency", CUR + (SC !== 1 ? ` (${(S.rows.find((r) => r.Units) || {}).Units})` : ""));
    if (S.example) box.appendChild(el("span", { class: "example-flag" }, "▲ " + S.label));
    $("#appTitle").textContent = M.title;
  }
  function renderFilterbar() {
    const box = $("#sectorChips"); box.replaceChildren();
    const all = el("button", { class: "chip", type: "button", "aria-pressed": String(S.sectorSel.size === S.sectors.length) }, "All");
    all.addEventListener("click", () => { S.sectorSel = new Set(S.sectors); sectorChanged(); });
    box.appendChild(all);
    S.sectors.forEach((s) => {
      const b = el("button", { class: "chip", type: "button", "aria-pressed": String(S.sectorSel.has(s) && S.sectorSel.size !== S.sectors.length) }, s);
      b.addEventListener("click", () => {
        if (S.sectorSel.size === S.sectors.length) S.sectorSel = new Set([s]);
        else if (S.sectorSel.has(s)) { S.sectorSel.delete(s); if (!S.sectorSel.size) S.sectorSel = new Set(S.sectors); }
        else S.sectorSel.add(s);
        sectorChanged();
      });
      box.appendChild(b);
    });
    const yrs = uniq(F().map((r) => r.Year)).sort((a, b) => a - b);
    $("#asof").replaceChildren("Data as of ", el("b", {}, yrs.length > 1 ? `${yrs[0]}–${last(yrs)}` : String(yrs[0] ?? "—")), ` · ${pl(uniq(F().map((r) => r.Entity)).length, "SOE")} shown`);
  }
  function sectorChanged() { renderFilterbar(); S.built = {}; showTab(S.tab, true); }

  /* ---------- tabs ---------- */
  const FILTER_TABS = new Set(["kpi", "altman", "efc", "warning"]);
  const pages = {};
  function showTab(id, force) {
    if (!pages[id]) id = "home";
    S.tab = id;
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === id)));
    // Government Support and Technical notes are off the tab bar; their tab shows only while one of them is open
    document.querySelectorAll("#tabs li.tab-hidden").forEach((li) => { li.hidden = li.querySelector("button").dataset.tab !== id; });
    document.querySelectorAll("main .page").forEach((p) => { p.hidden = p.id !== id; });
    $("#filterbar").hidden = !FILTER_TABS.has(id);
    const root = document.getElementById(id);
    document.body.dataset.tab = id;
    if (!S.built[id] || force) { pages[id].build(root); S.built[id] = true; }
    else root.querySelectorAll(".gdp-control").forEach((b) => b._sync && b._sync()); // GDP is shared by the EFC and Shock tabs
    pages[id].render();
    // every tab links to the part of the How it works guide that explains it
    if (HW_GUIDE[id]) {
      const ph = root.querySelector(".page-head > div:first-child");
      if (ph && !ph.querySelector(".hw-guide")) ph.appendChild(el("a", { class: "hw-guide", href: "#view-how", onclick: (e) => { e.preventDefault(); goHow(HW_GUIDE[id]); } }, "New to this tab? How to read it →"));
    }
    // "#view-<tab>" deep-links a tab; the token matches no element id, so the browser never jumps the page to it
    try { history.replaceState(null, "", "#view-" + id); } catch (e) { /* hash is optional */ }
  }
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => { showTab(b.dataset.tab); window.scrollTo({ top: 0 }); }));
  const bandUp = document.getElementById("bandUpload");
  if (bandUp) bandUp.addEventListener("click", () => {
    showTab("home"); window.scrollTo({ top: 0 });
    const c = document.getElementById("uploadCard");
    if (c) { c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash"); const z = document.getElementById("upload"); if (z) z.focus(); }
  });
  function rebuild() { const root = document.getElementById(S.tab); pages[S.tab].build(root); pages[S.tab].render(); }

  /* =====================================================================
     HOME
     ===================================================================== */
  // the SOE fiscal-risk toolkit as agreed on 2026-10-26: one early-warning framework (country analysis and
  // monitoring are the same thing, not a separate "global" tool), hidden subsidies, the energy model, PSO last
  const MODULES = [
    ["Early Warning Framework & Monitoring", "This tool", "ok", "Screens a country's SOEs from their yearly accounts: health ratios, distress score, expected fiscal cost, shocks and trigger rules. Monitoring means running it again each year with new accounts."],
    ["Hidden Subsidies", "In progress", "watch", "Support the State gives SOEs that does not show in the budget, such as cheap loans, guarantees and unpaid taxes. Method drafted and applied to one country; the tool comes next."],
    ["Energy Sector Fiscal Risk", "Model exists", "watch", "The deep dive for power utilities this screen flags: tariffs, cost recovery, subsidies and the whole sector, including independent power producers. Built for Ghana, being generalised."],
    ["PSO Analysis", "Later", "none", "Whether the compensation for public service obligations is adequate or rewards inefficiency. Needs counterfactual data; to be developed after the hidden-subsidies work."],
  ];
  const byYearAsc = (rows) => rows.slice().sort((a, b) => a.Year - b.Year);
  const pct0 = (v) => fmt(v * 100, 0) + "%";
  const go = (id, label) => el("a", { href: "#view-" + id, onclick: (e) => { e.preventDefault(); showTab(id); window.scrollTo({ top: 0 }); } }, label);
  /** snake_case template headers in statement order (schema.template_frame) and the variable dictionary */
  const SCHEMA_VARS = () => (CFG.SCHEMA ? CFG.SCHEMA.variables.slice().sort((a, b) => CFG.SCHEMA.statements.indexOf(a.statement) - CFG.SCHEMA.statements.indexOf(b.statement)) : []);
  const templateCSV = () => SCHEMA_VARS().map((v) => v.key).join(",") + "\n";
  const dictionaryCSV = () => toCSV(["key", "label", "statement", "kind", "required", "used by", "tool column", "also recognised as"],
    SCHEMA_VARS().map((v) => [v.key, v.label, v.statement, v.kind, v.required ? "yes" : "", v.used_by, v.column, v.synonyms.join("; ")]));
  function mappingDetails(mp) {
    const renamed = mp.report.filter((r) => r["Mapped to"] && r["Mapped to"] !== r["Uploaded column"]);
    const review = mp.report.filter((r) => r.Confidence === "LOW" || r.Method === "unmatched" || r.Method === "duplicate");
    const conf = (c, m) => (c === "HIGH" ? stChip("ok", "High") : c === "MEDIUM" ? stChip("none", "Medium") : c === "LOW" ? stChip("watch", "Low · check") : stChip("none", m === "duplicate" ? "Duplicate" : "Not used"));
    return el("details", { class: "plain", open: review.length ? true : null },
      el("summary", {}, `Column mapping — ${renamed.length} renamed to the standard schema, ${review.length} to review`),
      simpleTable(["Uploaded column", "Mapped to", "Schema key", "Method", "Confidence"], mp.report.map((r) => [r["Uploaded column"], r["Mapped to"] || "—", r["Schema key"] || "—", r.Method, el("td", {}, conf(r.Confidence, r.Method))]), { cls: "compact", tall: mp.report.length > 14 }),
      el("p", { class: "note" }, "High = exact name, Medium = known synonym, Low = close spelling (check it). Unmatched and duplicate columns are kept but not used."));
  }

  /* DESIGN-INTEGRATED METHODOLOGY — HTML, not a flat screenshot */
  function modelJourney(compact=false) {
    const steps = [
      ["01", "SOE financial data", "Financial statements · exposures · government support", "data"],
      ["02", "Economic shocks", "Fuel · FX · interest rates · revenue", "shock"],
      ["03", "Cash-flow waterfall", "Cash gap · financing · arrears · new balance sheet", "cash"],
      ["04", "Continuous PD", "Altman Z-EM → rating-anchored probability", "pd"],
      ["05", "Expected fiscal cost", "EFC = PD × EAD × LGD", "efc"],
      ["06", "Monte Carlo", "Correlated draws → median · P95 · distress share", "mc"]
    ];
    return el("section", {class:"journey-section"+(compact?" journey-compact":""), "aria-label":"Model calculation framework"},
      el("div",{class:"journey-heading"},
        el("div",{},el("span",{class:"journey-kicker"},"MODEL FRAMEWORK"),el("h3",{},"From economic shocks to expected fiscal risk")),
        el("span",{class:"journey-formula"},"Continuous PD  ·  EFC-only simulation")),
      el("div",{class:"journey-steps"},steps.map(([n,name,desc,kind])=>
        el("div",{class:"journey-step journey-"+kind},
          el("div",{class:"journey-step-head"},el("span",{class:"journey-number"},n),el("b",{},name)),
          el("p",{},desc)))));
  }
  function modelNotes() {
    const panels=[
      ["Main assumptions","assume",[
        "Economic shocks follow user-set distributions and correlations.",
        "Monte Carlo PD is a smooth curve through the 20 rating-band PDs, as a function of projected Altman Z-EM; deterministic tabs use the rating band PD.",
        "EAD and LGD are explicit user-controlled exposure and loss assumptions."
      ]],
      ["Key limitations","limits",[
        "PDs come from an illustrative rating table, not observed SOE defaults.",
        "The 20 reference PDs are an illustrative table; CCC+ and CCC share one PD, so the curve is flat between their centres.",
        "P95 summarizes expected costs under shock paths, not realized state payouts."
      ]],
      ["How to interpret","message",[
        "Follow the chain: shock → cash gap → financial condition → PD → EFC.",
        "Compare the single-logistic sensitivity on identical shock draws.",
        "Use outputs for scenario analysis and fiscal-risk discussion."
      ]]
    ];
    return el("section",{class:"journey-notes","aria-label":"Assumptions and limitations"},
      panels.map(([heading,kind,parts])=>el("article",{class:"journey-notebox journey-notebox-"+kind},
        el("h3",{},heading),el("ul",{},parts.map(x=>el("li",{},x))))));
  }

  /** plain-language limits (Home and How it works), from the explainer's recap */
  function notThis() {
    return el("section", { class: "card not-this", "aria-label": "What the tool is not" },
      el("h3", {}, "What the tool is not"),
      el("ul", {},
        el("li", {}, el("b", {}, "Not a budget forecast. "), "It is a first screen that tells you where to look closer. Results are projections from a model."),
        el("li", {}, el("b", {}, "Not an agency rating. "), "The rating is read off the accounts alone, not given by S&P, Moody's or Fitch."),
        el("li", {}, el("b", {}, "Not observed default history. "), "The chance of distress for each rating step is a starting assumption set by the team."),
        el("li", {}, el("b", {}, "Not fixed. "), "The share the government would bear (LGD), the exposure (EAD) and the shock exposures are assumptions you can change."),
        el("li", {}, el("b", {}, "Not about banks. "), "State banks and other financial SOEs need a different framework.")));
  }
  /** the order to use the tool in, as clickable steps (Home) */
  const WORKFLOW = [
    ["home", "Load data", "Your SOEs' yearly accounts, or a built-in example"],
    ["how", "How it works", "Read once: from accounts to fiscal cost, and how a shock travels"],
    ["kpi", "Check health", "KPI Dashboard and Distress Indicator: which SOEs are weak, and why"],
    ["efc", "Expected fiscal cost", "What each SOE could cost the budget: PD × EAD × LGD"],
    ["warning", "Act early", "Trigger rules and the follow-up each signal calls for"],
    ["shock", "Test shocks", "What could make it worse: fuel, exchange rate, interest rates, revenue, arrears"],
  ];
  function workflow() {
    return el("ol", { class: "flow", "aria-label": "How to use the tool" }, WORKFLOW.map(([id, t, d], i) =>
      el("li", {}, el("a", { href: "#view-" + id, onclick: (e) => { e.preventDefault(); showTab(id); window.scrollTo({ top: 0 }); } },
        el("span", { class: "flow-n num" }, String(i + 1)), el("b", {}, t), el("span", {}, d)))));
  }
  /** what the tool covers and what it does not (financial SOEs, several countries, sector-wide energy, PSO) */
  function scopeCard() {
    const c = card("What the tool covers", "Read this before presenting results", null, "top");
    c.body.append(el("div", { class: "scope-grid" },
      el("div", { class: "scope-in" }, el("h4", {}, "Covered"), el("ul", {},
        el("li", {}, el("b", {}, "Non-financial SOEs: "), "power, water, transport, telecoms, farming, industry and other companies that sell goods or services."),
        el("li", {}, el("b", {}, "One country, several SOEs: "), "a first screen of a country's portfolio from each SOE's yearly accounts."),
        el("li", {}, el("b", {}, "Triage, not a forecast: "), "which SOEs to look at first, what they could cost, and what could make it worse. Results are projections from a model."))),
      el("div", { class: "scope-out" }, el("h4", {}, "Not covered here"), el("ul", {},
        el("li", {}, el("b", {}, "Financial-sector SOEs "), "(state banks, insurers, development banks). See the question below."),
        el("li", {}, el("b", {}, "Cross-country benchmarking. "), "The tool works on one country at a time for now."),
        el("li", {}, el("b", {}, "The whole power sector "), "(independent power producers, distributors). A utility flagged here goes to the energy-sector model for a deep dive."),
        el("li", {}, el("b", {}, "Whether public-service compensation is adequate. "), "The tool takes transfers as they are; that question belongs to the PSO work.")))),
      el("details", { class: "plain" }, el("summary", {}, "Why are state banks and other financial SOEs not included?"),
        el("p", { class: "note" }, "A bank is built differently from other companies: what it owns (its loans) is what other people owe. Its health is judged on capital, asset quality and liquidity rules, not on the ratios used here, and its risks spread through the financial system (deposit runs, contagion between banks). Assessing it needs a separate framework and stress tests, usually done by financial-sector specialists. This tool is designed for non-financial SOEs. Government backing of bank lending to SOEs (for example a letter of comfort) is a link worth noting, but it is not modelled here.")));
    return c.root;
  }
  /** the longer Home material from the 2026-10-26 meeting: load data, data quality, how to use the tool, scope, toolkit */
  pages.about = {
    build(root) {
      const H = {};
      this.H = H;
      H.upload = el("div", { class: "card top upload-card stacked" });
      H.more = el("div", { class: "card upl-more-card" });
      H.dq = card("Data quality and provenance", "Where the numbers come from, as far as the file says", null, "top");
      H.about = card("The tabs at a glance", null, null);
      const mods = el("div", { class: "modules four" }, MODULES.map(([name, status, k, text]) => el("div", { class: "module" + (k === "ok" ? " on" : "") },
        el("div", { class: "tile-top" }, el("span", { class: "module-name" }, name), stChip(k, status)), el("p", {}, text))));
      root.replaceChildren(
        pageHead("ABOUT THE TOOL", "About the tool and your data",
          "When a state-owned enterprise (SOE) cannot pay its debts, the budget usually pays. This tool estimates how much that could cost, shows which SOEs to look at first, and tests what could make it worse. It is a first screen, built from each SOE's yearly accounts.",
          el("button", { class: "btn", type: "button", onclick: () => { showTab("home"); window.scrollTo({ top: 0 }); } }, "Back to the start screen")),
        el("div", { class: "grid home-top" }, el("div", { class: "s6" }, H.upload), el("div", { class: "s6" }, H.dq.root)),
        H.more,
        el("h3", { class: "sec-label" }, "How to use it"), workflow(),
        el("div", { class: "grid", style: "margin-top:16px" }, el("div", { class: "s7" }, scopeCard()), el("div", { class: "s5" }, H.about.root)),
        el("h3", { class: "sec-label" }, "The SOE fiscal-risk toolkit, and where this tool sits"), mods,
        el("p", { class: "note" }, "How they connect: this early-warning screen stays general and flags SOEs in trouble; a power utility it flags goes to the energy-sector model for a deep dive, which also covers the rest of the sector. Hidden subsidies and PSO analysis look at what the State already gives each SOE."),
        notThis(),
        el("details", { class: "plain analyst-fold" }, el("summary", {}, "For analysts: main assumptions and limitations"), modelNotes()),
      );
      this.buildUpload(H.upload);
      this.buildQuality(H.dq.body);
      this.buildAbout(H.about.body);
    },
    /** top of About: load a file, or switch to one of the built-in datasets */
    buildUpload(box) {
      const msg = el("div");
      const input = el("input", { type: "file", id: "upload-about", accept: ".csv,.xlsx,.xls,.txt", class: "sr-file" });
      const pick = el("label", { class: "btn primary", for: "upload-about" }, "Choose a file");
      const dz = el("div", { class: "dropzone big" },
        el("div", { class: "dz-icon", "aria-hidden": "true" }, "⬆"),
        el("div", { class: "dz-text" }, el("b", {}, "Drop a CSV or Excel file here"), el("span", { class: "muted" }, " or "), pick, input),
        el("small", { class: "muted" }, "One row per SOE-year. Column names are matched to the standard schema, numbers such as 1,234 · (1,234) · 35% are read, and title rows above the table are skipped. The file is read in this browser only; nothing is sent anywhere."));
      const handle = (file) => readUpload(file, msg);
      input.addEventListener("change", () => { const f = input.files[0]; if (f) handle(f); input.value = ""; });
      dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
      dz.addEventListener("dragleave", () => dz.classList.remove("over"));
      dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); });
      // the page may open on a copy of a built-in dataset ("report"); mark that one as the active choice
      const copyOf = DATASETS.report ? ["training", "sample", "demo", "long"].find((k) => DATASETS[k] && DATASETS[k].label === DATASETS.report.label) : null;
      const active = S.key === "report" && copyOf ? copyOf : S.key;
      const ds = (key, label, sub) => DATASETS[key] ? el("button", { class: "ds" + (active === key ? " on" : ""), type: "button", "aria-pressed": String(active === key), onclick: () => loadDataset(DATASETS[key].rows, DATASETS[key].label, DATASETS[key].example, key) }, el("b", {}, label), el("span", {}, sub)) : null;
      const side = el("div", { class: "upl-side" },
        el("div", { class: "lbl" }, "Now showing"),
        el("div", { class: "now" }, el("b", {}, S.label || "Loaded data"), el("span", { class: "muted" }, `${pl(S.names.length, "SOE")} · ${S.rows.length} SOE-year rows · ${S.years.length > 1 ? S.years[0] + "–" + last(S.years) : S.years[0]}`)),
        el("div", { class: "lbl", style: "margin-top:12px" }, "Or try built-in data"),
        el("div", { class: "ds-list" },
          DATASETS.report && !copyOf ? ds("report", "Report data", DATASETS.report.label) : null,
          ds("training", "Training data", "8 SOEs · 2015–2024"), ds("sample", "Example", "SOE A and B · 2020–2024"), ds("demo", "Demo portfolio", "8 SOEs · 2020–2024"), ds("long", "Long panel", "30 SOEs · 20 years")),
        trainingDownloads("about"),
        el("div", { class: "lbl", style: "margin-top:12px" }, "Standard template"),
        el("div", { class: "btn-row" }, dataButtons(templateCSV, "soe_tool_template.csv", "template"), dataButtons(dictionaryCSV, "soe_variable_dictionary.csv", "dictionary")));
      const note = S.uploadNote ? el("div", { class: "alert-box ok" }, S.uploadNote) : null;
      const soon = el("p", { class: "note coming" }, el("b", {}, "Coming next: "), "upload the PDF financial statements and have the numbers extracted into the template for you.");
      put(box, el("div", { class: "upl-grid" }, el("div", { class: "upl-main" }, el("h3", {}, "Load data"), dz, soon, note, msg), side));
      // the wide sections (column mapping, required columns, preview) run full width right under the top row
      put(this.H.more, S.mapping ? mappingDetails(S.mapping) : null, ...this.dataDetails());
    },
    /** "Required and optional columns" and "Data preview", collapsed, under the upload box */
    dataDetails() {
      const cols = el("details", { class: "plain" }, el("summary", {}, "Required and optional columns"),
        el("p", { class: "note" }, el("b", {}, "Required: "), CFG.REQUIRED_COLUMNS.join(", ") + "."),
        el("p", { class: "note" }, el("b", {}, "Optional, used when present: "), "Short Term Debt, FX Debt, Fuel Cost and the exposure shares (bottom-up shock exposures); Government Guaranteed Debt (kept for reference); Source File, Source Page, Audit Status, Extraction Method and Data Quality Flag (provenance). The full list with synonyms is in the ", go("assumptions", "Technical notes"), "."));
      const prevCols = ["Entity", "Year", "Sector", "Revenues", "Operating Profits (EBIT)", "Net Income", "Total Assets", "Total Liabilities", "Equity", "Government Grants"];
      const preview = el("details", { class: "plain" }, el("summary", {}, `Data preview (${S.rows.length} rows)`),
        simpleTable(prevCols, S.rows.slice(0, 300).map((r) => prevCols.map((c) => (NUMCOLS.has(c) && c !== "Year" ? money(r[c]) : String(r[c] ?? "")))), { tall: true, right: (i) => i >= 3 }));
      return [cols, preview];
    },
    buildQuality(body) {
      const rows = S.rows, n = rows.length, latest = latestOf(S.en);
      const blocks = [];
      ["Data Quality Flag", "Audit Status", "Extraction Method"].forEach((c) => {
        if (!rows.some((r) => r[c])) return;
        const m = new Map();
        rows.forEach((r) => { const v = r[c] || "(blank)"; m.set(v, (m.get(v) || 0) + 1); });
        const items = [...m.entries()].sort((a, b) => b[1] - a[1]);
        blocks.push(el("div", { class: "dq-row" }, el("span", { class: "lbl" }, c),
          el("div", { class: "dq-bar", role: "img", "aria-label": items.map(([v, k]) => `${v} ${k}`).join(", ") }, items.map(([v, k], i) => el("span", { class: "q" + Math.min(i, 3), style: `width:${(k / n) * 100}%`, title: `${v}: ${k} rows` }))),
          el("div", { class: "dq-legend" }, items.map(([v, k], i) => el("span", {}, el("i", { class: "q" + Math.min(i, 3) }), `${v} `, el("b", { class: "num" }, String(k)))))));
      });
      const ex = latest.map((r) => Object.values(E.soeExposures(r)).filter(([, src]) => /^(Observed|Derived)/.test(src)).length);
      const withEx = ex.filter((k) => k > 0).length;
      const withG = uniq(S.en.filter((r) => ok(r["Government Guaranteed Debt"])).map((r) => r.Entity)).length;
      const facts = el("ul", { class: "facts" },
        el("li", {}, el("b", {}, `${withEx} of ${pl(latest.length, "SOE")}`), " carry at least one shock exposure in the data (fuel cost, FX or short-term debt, exposure shares); the rest use sector or generic defaults on the Shock Scenarios tab."),
        el("li", {}, el("b", {}, `${withG} of ${pl(latest.length, "SOE")}`), " report government-guaranteed debt (kept with the data; the Expected Fiscal Cost tab uses a share of total liabilities as the exposure at default)."),
        el("li", {}, "Parameters: ", el("b", {}, String(CFG.PARAMETER_REGISTER.filter((r) => r.status === "placeholder").length)), " of " + CFG.PARAMETER_REGISTER.length + " numbers the tool uses are still placeholders that need a source; see the ", go("assumptions", "Technical notes"), "."));
      body.replaceChildren(...(blocks.length ? blocks : [el("p", { class: "note", style: "margin-top:0" }, "This file carries no provenance columns. Add source_file, source_page, audit_status, extraction_method and data_quality_flag (they are in the standard template) to record where each number came from and whether it is audited, extracted or a proxy.")]), facts);
    },
    buildAbout(body) {
      body.replaceChildren(
        el("ol", { class: "steps" },
          el("li", {}, go("how", "How it works"), " : the calculation in plain words, and how each shock travels through an SOE's accounts to the budget."),
          el("li", {}, go("kpi", "KPI Dashboard"), " : profitability, liquidity, solvency and fiscal-dependency ratios against illustrative thresholds; trend per SOE and comparison across SOEs."),
          el("li", {}, go("altman", "Distress Indicator"), " : one distress score per SOE (Altman Z″-EM) from four health checks, with its zone (safe, grey, distress) and an indicative rating."),
          el("li", {}, go("efc", "Expected Fiscal Cost"), " : PD × EAD × LGD for each SOE and the portfolio, from the latest accounts. This is where SOEs are added up."),
          el("li", {}, go("warning", "Early Warning"), " : trigger rules, grouped by issue, and the follow-up each signal calls for."),
          el("li", {}, go("shock", "Shock Scenarios"), " : one SOE under a fuel, exchange-rate, interest-rate, revenue or arrears shock; a Monte Carlo simulation of the range of outcomes; a portfolio macro shock that ranks SOEs; and a check of the model against past years.")),
        el("p", { class: "note" }, "For analysts: every coefficient and default, with its source and status, is in the ", go("assumptions", "Technical notes"), ". Every calculation runs in this page with the same formulas and config.py values as the Python tool."),
        el("details", { class: "plain" }, el("summary", {}, "Glossary — what the terms mean"),
          simpleTable(["Term", "Meaning"], Object.entries(CFG.GLOSSARY).map(([k, v]) => [k, v]), { cls: "glossary" })),
      );
    },
    render() {},
  };

  /* =====================================================================
     HOME — the start screen: one question, one upload box, and the four questions the tool
     answers, each with today's answer for the loaded data. The longer material is on About.
     ===================================================================== */
  const goTop = (id) => { showTab(id); window.scrollTo({ top: 0 }); };
  function uploadIcon() {
    const svg = svgEl("svg", { viewBox: "0 0 24 24", width: 22, height: 22, "aria-hidden": "true", class: "lp-ico" });
    svgEl("path", { d: "M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
    svgEl("path", { d: "M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round" }, svg);
    return svg;
  }
  /** the start-screen text as one paragraph: the end of it is hidden behind an inline "more..." so the upload box
   *  stays on the first screen. Opening shows the rest in place, in the same paragraph, followed by "less". */
  function moreText(shown, rest) {
    const extra = el("span", { class: "lp-more-text", id: nid("lp-more") }, " " + rest);
    extra.hidden = true;
    const btn = el("button", { type: "button", class: "lp-more", "aria-expanded": "false", "aria-controls": extra.id }, "more...");
    btn.addEventListener("click", () => {
      const open = extra.hidden;
      extra.hidden = !open; btn.setAttribute("aria-expanded", String(open)); btn.textContent = open ? "less" : "more...";
    });
    return [shown, extra, " ", btn];
  }
  /** download the training material: the WB-KDIs training data (Excel, with its supplementary sheets; uploading it
   *  back through "Load data" reproduces what the page shows for the built-in training data) and the training
   *  workbook (Word) that participants fill in while they use the tool (meeting 2026-10-30: Excel + Word, no CSV) */
  function trainingDownloads(where) {
    const D = DOWNLOADS;
    if (!D || !(D.xlsx || D.docx)) return null;
    const cls = (primary) => where === "home" ? "lp-dl" + (primary ? " primary" : "") : "btn-ghost";
    const xlsxBtn = D.xlsx && canDownload ? el("button", { type: "button", class: cls(true), onclick: () => download(D.xlsx.name, b64Bytes(D.xlsx.b64), XLSX_TYPE) }, "⬇ Excel data (.xlsx)") : null;
    const docxBtn = D.docx && canDownload ? el("button", { type: "button", class: cls(false), onclick: () => download(D.docx.name, b64Bytes(D.docx.b64), DOCX_TYPE) }, "⬇ Workbook (Word)") : null;
    if (!xlsxBtn && !docxBtn) return null;
    if (where === "about") {
      return [el("div", { class: "lbl", style: "margin-top:12px" }, "Training files"), el("div", { class: "btn-row" }, xlsxBtn, docxBtn)];
    }
    return el("div", { class: "lp-sample", role: "group", "aria-label": "Download the training files" },
      el("div", { class: "lp-sample-txt" },
        el("b", {}, "Practice files: WB-KDIs training"),
        el("span", {}, "The data (8 invented SOEs in 7 sectors, 2015–2024) to load here, and the workbook to fill in as you go through the tabs.")),
      el("div", { class: "lp-sample-btns" }, xlsxBtn, docxBtn));
  }
  pages.home = {
    build(root) {
      const H = (this.H = {});
      const msg = el("div", { class: "lp-msg" });

      /* 1. what the tool is for, and what it calculates (the Altman Z″-EM score explained in place) */
      const zc = CFG.ZEM_COEFFICIENTS, zd = CFG.Z_DISTRESS_CUTOFF, zs = CFG.Z_SAFE_CUTOFF;
      const scale = el("div", { class: "lp-scale", role: "img", "aria-label": `Distress at ${zd} or below, grey zone ${zd} to ${zs}, safe above ${zs}` },
        el("span", { class: "z-d" }, el("i"), el("b", {}, "Distress"), `≤ ${fmt(zd, 1)}`),
        el("span", { class: "z-g" }, el("i"), el("b", {}, "Grey zone"), `${fmt(zd, 1)}–${fmt(zs, 1)}`),
        el("span", { class: "z-s" }, el("i"), el("b", {}, "Safe"), `> ${fmt(zs, 1)}`));
      const formula = el("details", { class: "lp-formula" }, el("summary", {}, "The formula"),
        el("p", {}, `Z″ = ${zc.X1} X1 + ${zc.X2} X2 + ${zc.X3} X3 + ${zc.X4} X4`),
        el("ul", {}, el("li", {}, el("b", {}, "X1 "), "working capital ÷ total assets"), el("li", {}, el("b", {}, "X2 "), "retained earnings ÷ total assets"),
          el("li", {}, el("b", {}, "X3 "), "operating profit (EBIT) ÷ total assets"), el("li", {}, el("b", {}, "X4 "), "book equity ÷ total liabilities")));
      const step = (n, title, ...body) => el("div", { class: "lp-step" + (n === 2 ? " lp-step-z" : "") },
        el("div", { class: "lp-step-head" }, el("span", { class: "lp-step-n num" }, String(n)), el("b", {}, title)), ...body);
      const steps = el("div", { class: "lp-steps" },
        step(1, "Health ratios", el("p", {}, "Profitability, liquidity, solvency and dependence on the government, read from each SOE's yearly accounts.")),
        step(2, "Distress score (Altman Z″-EM)",
          el("p", {}, "Edward Altman's credit-scoring formula for companies in emerging markets. It weights four balance-sheet ratios into one number; the higher, the healthier."),
          scale, formula),
        step(3, "Expected fiscal cost", el("p", {}, "The score gives an indicative rating and a chance of default (PD). PD × debt at stake (EAD) × the share the government would bear (LGD) is what the SOE could cost the budget.")),
        step(4, "Warnings and shocks", el("p", {}, "Which signals call for action, and how a fuel, exchange-rate, interest-rate or revenue shock changes the score and the cost.")));
      const scope = el("p", { class: "lp-scope" }, "Covers non-financial SOEs; state banks and other financial SOEs need a different framework. ", go("about", "What the tool covers"));

      /* 2. load data: the sky-blue drop area, the column and preview folds, then what is on screen */
      const input = el("input", { type: "file", id: "upload", accept: ".csv,.xlsx,.xls,.txt", class: "sr-file", "aria-label": "Upload SOE financial statements, CSV or Excel" });
      const bar = el("label", { class: "lp-search", for: "upload" },
        uploadIcon(),
        el("span", { class: "lp-ph" }, el("b", {}, "Drop a CSV or Excel file here"), el("span", {}, "or choose one from your computer")),
        el("span", { class: "lp-pick" }, "Choose a file"));
      const drop = el("div", { class: "lp-drop", id: "uploadCard" }, el("div", { class: "lp-box" }, bar, input),
        el("p", { class: "lp-drop-note" }, "One row per SOE-year. Column names are matched to the standard schema, numbers such as 1,234 · (1,234) · 35% are read, and title rows above the table are skipped. The file is read in this browser only; nothing is sent anywhere."));
      const handle = (file) => readUpload(file, msg);
      input.addEventListener("change", () => { const f = input.files[0]; if (f) handle(f); input.value = ""; });
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove("over"); });
      drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); });
      const loaded = S.key === "upload" && S.uploadNote ? el("p", { class: "lp-loaded" }, S.uploadNote) : null;
      const folds = el("div", { class: "lp-folds" }, S.mapping ? mappingDetails(S.mapping) : null, ...pages.about.dataDetails());
      // "Now showing", the built-in datasets and the template, in three short lines
      const copyOf = DATASETS.report ? ["training", "sample", "demo", "long"].find((k) => DATASETS[k] && DATASETS[k].label === DATASETS.report.label) : null;
      const active = S.key === "report" && copyOf ? copyOf : S.key;
      const ds = (key, label, sub) => DATASETS[key] ? el("button", { type: "button", class: "lp-chip", "aria-pressed": String(active === key), title: sub,
        onclick: () => loadDataset(DATASETS[key].rows, DATASETS[key].label, DATASETS[key].example, key) }, label) : null;
      const fileBtn = (label, name, getText) => {
        const b = el("button", { type: "button", class: "lp-chip" }, (canDownload ? "⬇ " : "Copy ") + label);
        b.addEventListener("click", async () => {
          if (canDownload) { download(name, getText()); return; }
          try { await navigator.clipboard.writeText(getText()); b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy " + label), 1500); } catch (e) { goTop("about"); }
        });
        return b;
      };
      const yrs = S.years.length > 1 ? `${S.years[0]}–${last(S.years)}` : String(S.years[0] ?? "");
      const data = el("div", { class: "lp-data" }, folds,
        el("div", { class: "lp-data-row" }, el("span", { class: "lp-data-lbl" }, "Now showing"),
          el("span", { class: "lp-data-val" }, el("b", {}, S.label || "Loaded data"), el("span", { class: "muted" }, `${pl(S.names.length, "SOE")}, ${S.rows.length} SOE-year rows, ${yrs}`))),
        el("div", { class: "lp-data-row" }, el("span", { class: "lp-data-lbl" }, "Or try built-in data"),
          el("span", { class: "lp-data-val" }, DATASETS.report && !copyOf ? ds("report", "Report data", DATASETS.report.label) : null,
            ds("training", "Training data", "WB-KDIs training data: 8 SOEs in 7 sectors, 2015–2024, every column filled"), ds("sample", "Example", "SOE A and B, 2020–2024"), ds("demo", "Demo portfolio", "8 SOEs in 7 sectors, 2020–2024"), ds("long", "Long panel", "30 SOEs, 20 years"))),
        el("div", { class: "lp-data-row" }, el("span", { class: "lp-data-lbl" }, "Standard template"),
          el("span", { class: "lp-data-val" }, fileBtn("Template (CSV)", "soe_tool_template.csv", templateCSV), fileBtn("Dictionary (CSV)", "soe_variable_dictionary.csv", dictionaryCSV))));

      /* 3. what the tool finds in the data on screen: four questions with today's answers */
      H.qs = el("div", { class: "lp-qs" });
      root.replaceChildren(el("div", { class: "lp" },
        el("h2", { class: "lp-title" }, "About this tool"),
        // the tool's purpose, method and limits, as written by the team (paragraph breaks added for reading)
        el("div", { class: "lp-intro" },
          el("p", {}, ...moreText(
            "Governments often learn about the fiscal cost of a state-owned enterprise only when it asks for a bailout, builds up arrears, or calls on a guarantee. This tool helps ministries of finance, SOE monitoring units, and World Bank country teams spot those risks earlier. Using basic financial statements, it scores each SOE with the Altman Z″, a well-established measure of financial health calibrated for emerging markets, and ranks the portfolio by distress score to show which enterprises are most likely to need support from the budget. Alongside this distress score, the tool computes complementary financial indicators that provide additional context on liquidity, leverage, and operational performance. The Z″-score is then mapped to a shadow credit rating, which is used to derive an estimate of expected fiscal cost by combining the implied probability of default with sector-specific loss assumptions to express the potential government exposure as a share of GDP.",
            "Users can also simulate how fiscal exposure changes under macroeconomic shocks including fuel price movements, exchange rate shifts, and revenue contractions, and assess risk across the portfolio as a whole. The tool does not capture every source of SOE-related fiscal risk, and pricing subsidies, uncompensated public service obligations, and quasi-fiscal deficits require additional analysis, but as a first-pass screening instrument built for environments where data is limited and capacity is stretched, it offers a practical starting point for governments that want to move from reactive crisis management to proactive fiscal risk monitoring."))),
        // load data on the left, what the tool finds on the right
        el("div", { class: "lp-split" },
          el("section", { class: "lp-sec", "aria-labelledby": "lp-h-load" }, el("h3", { class: "lp-h", id: "lp-h-load" }, "Load data"), drop, trainingDownloads("home"), loaded, msg, data),
          el("section", { class: "lp-sec", "aria-labelledby": "lp-h-find" }, el("h3", { class: "lp-h", id: "lp-h-find" }, "What the tool finds in this data"), H.qs)),
        // how the tool gets there, under the data so the upload box stays on the first screen
        el("section", { class: "lp-sec", "aria-labelledby": "lp-h-calc" }, el("h3", { class: "lp-h", id: "lp-h-calc" }, "What the tool calculates"), steps, scope),
        el("nav", { class: "lp-links", "aria-label": "More" }, go("how", "How it works, step by step"), go("about", "About the tool and your data"))));
    },
    render() {
      const H = this.H, all = allRows(), rows = latestOf(all), n = rows.length, zc = zoneCounts(rows);
      const st = standardStress(all), stress = Object.fromEntries(st.map((x) => [x.row.Entity, x]));
      const total = sum(rows.map((r) => E.efcRow(r, S.efc.lgd, S.efc.ead, S.efc.basis).EFC));
      const drops = st.filter((x) => x.drop).length;
      const eB = sum(st.map((x) => last(x.base).EFC)), eS = sum(st.map((x) => last(x.str).EFC));
      const { by } = evalTriggers(rows, stress);
      const lv = (k) => rows.filter((r) => by[r.Entity] && by[r.Entity].level === k).length;
      const zones = (sub) => el("span", { class: "lp-q-sub" }, sub, el("span", { class: "lp-zones", role: "img", "aria-label": `${zc.Distress} in distress, ${zc.Grey} in the grey zone, ${zc.Safe} safe` },
        ...[["Distress", "d"], ["Grey", "g"], ["Safe", "s"]].filter(([z]) => zc[z]).map(([z, c]) => el("i", { class: "z-" + c, style: `flex:${zc[z]}` }))));
      // four rows per card (question, answer, what it means, where to go) so the answers line up across cards
      const q = (tab, ask, value, unit, sub, dest) => el("a", { class: "lp-q", href: "#view-" + tab, onclick: (e) => { e.preventDefault(); goTop(tab); } },
        el("span", { class: "lp-q-ask" }, ask),
        el("span", { class: "lp-q-val" }, el("b", { class: "num" }, value), unit ? el("small", {}, unit) : null),
        typeof sub === "string" ? el("span", { class: "lp-q-sub" }, sub) : sub,
        el("span", { class: "lp-q-go" }, "Open " + dest));
      const watch = lv("watch");
      const rise = eB > 0 ? eS / eB - 1 : NaN;
      put(H.qs,
        q("altman", "Which SOEs are in trouble?", String(zc.Distress + zc.Grey), `of ${n}`, zones(`in distress or the grey zone, ${zc.Distress} of them in distress`), "Distress Indicator"),
        q("efc", "What could they cost the budget?", money(total), CUR, S.gdp ? `expected fiscal cost, ${pctS(total / S.gdp)} of GDP` : "expected fiscal cost, from the latest accounts", "Expected Fiscal Cost"),
        q("warning", "What needs action now?", String(lv("alert")), `of ${n}`, `have an alert signal` + (watch ? `, and ${watch} more ${watch === 1 ? "is" : "are"} on watch` : ""), "Early Warning"),
        q("shock", "What if a shock hits?", String(drops), `of ${n}`, `fall a risk zone under the standard stress` + (ok(rise) && rise > 0.005 ? `; expected cost rises ${pct0(rise)} by year ${CFG.MC_HORIZON_YEARS}` : ""), "Shock Scenarios"));
    },
  };
  function readUpload(file, msg) {
    let headerNote = "";
    let uploadExtras = null;
    const done = (raw) => {
      if (!raw.length) { msg.replaceChildren(el("div", { class: "alert-box warn", style: "margin-top:10px" }, "The file has no data rows.")); return; }
      const mp = E.standardizeColumns(Object.keys(raw[0]));
      const rows = raw.map((r) => { const o = {}; for (const k in r) o[mp.rename[k] || k] = r[k]; return o; });
      const cols = Object.keys(rows[0]);
      const missing = CFG.REQUIRED_COLUMNS.filter((c) => !cols.includes(c));
      if (missing.length) {
        msg.replaceChildren(el("div", { class: "alert-box warn", style: "margin-top:10px" }, `Missing required column(s): ${missing.join(", ")}. Check the column mapping below, rename or add these columns, and upload again.`), mappingDetails({ report: mp.report }));
        return;
      }
      const mixed = E.currencyMix(rows);
      if (mixed) { msg.replaceChildren(el("div", { class: "alert-box warn", style: "margin-top:10px" }, mixed), mappingDetails({ report: mp.report })); return; }
      // Attach annual support flows from Grants_detail, never loan stocks or contingent guarantees.
      // The primary sheet wins on any disagreement; the discrepancy is surfaced for review.
      const merged = mergeSupportUpload(rows, uploadExtras);
      S.uploadExtras = merged.meta;
      const reqNum = CFG.NUMERIC_COLUMNS.filter((c) => CFG.REQUIRED_COLUMNS.includes(c));
      const co = coerceRows(merged.rows);
      const bad = co.filter((r) => reqNum.some((c) => !ok(r[c]))).length;
      S.mapping = { report: mp.report };
      S.uploadNote = `✓ Loaded ${pl(uniq(co.map((r) => r.Entity)).length, "SOE")}, ${co.length} SOE-year rows from ${file.name}.` + (headerNote.trim() ? " " + headerNote.trim() : "") + (merged.meta && merged.meta.sheets.length ? ` Supplementary sheets: ${merged.meta.sheets.join(", ")}.` : "") + (merged.meta && merged.meta.conflicts.length ? ` ${merged.meta.conflicts.length} support value(s) need reconciliation.` : "") + (bad ? ` ${bad} row(s) have non-numeric or missing required values — check the data preview below.` : "");
      loadDataset(merged.rows, file.name, false, "upload");
      showTab("home", true);
    };
    const fail = (e) => msg.replaceChildren(el("div", { class: "alert-box warn", style: "margin-top:10px" }, `Couldn't read that file: ${e}`));
    const take = (rows, how) => { const f = E.frameFromRows(rows); headerNote = (how ? how + " " : "") + (f.header ? `Header found on row ${f.header + 1}; the ${pl(f.header, "row")} above it skipped.` : ""); done(f.records); };
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      file.arrayBuffer().then((buf) => {
        let text;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder("windows-1252").decode(buf); }
        text = text.replace(/^\uFEFF/, "");
        const d = E.detectDelimiter(text);
        take(E.parseDelimited(text, d), d === "," ? "" : `Columns separated by ${d === ";" ? "semicolons" : d === "\t" ? "tabs" : "'" + d + "'"}.`);
      }).catch(fail);
    } else {
      // the standard template keeps the data on a sheet named "Data" (with Dictionary and Readme sheets beside it)
      const go2 = () => file.arrayBuffer().then((buf) => {
        const wb = window.XLSX.read(buf, { type: "array" }), sh = wb.SheetNames.includes("Data") ? "Data" : wb.SheetNames[0];
        uploadExtras = extractSupportSheets(wb); // metadata stays in browser, never bundled as default data
        take(window.XLSX.utils.sheet_to_json(wb.Sheets[sh], { header: 1, defval: null, raw: true }), wb.SheetNames.length > 1 ? `Read sheet "${sh}".` : "");
      }).catch(fail);
      if (window.XLSX) go2();
      else {
        const sc = el("script", { src: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" });
        sc.onload = go2; sc.onerror = () => fail("the Excel reader could not load (offline?). Save the sheet as CSV and upload that instead.");
        document.head.appendChild(sc);
      }
    }
  }

  /* =====================================================================
     KPI DASHBOARD
     ===================================================================== */
  const SPEC = CFG.KPI_THRESHOLDS;
  function kpiFmt(key, v) {
    if (!ok(v)) return "n/a";
    if (SPEC[key].unit === "%") return fmt(v * 100, Math.abs(v) >= 1 ? 0 : 1) + "%";
    return fmt(v, Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2) + "×";
  }
  const kpiTitle = (k) => `${SPEC[k].label} (${SPEC[k].unit === "%" ? "%" : "x"})`;
  function missingKpiMessage(k) {
    const missing = (SPEC[k].requires || []).filter((field) => !S.rows.some((r) => ok(r[field])));
    return missing.length
      ? `Data unavailable — ${SPEC[k].label} requires ${missing.join(", ")}. These inputs are not reported in the current dataset.`
      : `Data unavailable — ${SPEC[k].label} has no valid observations for the selected SOE, years or denominator.`;
  }
  function kpiTick(key) { return SPEC[key].unit === "%" ? (t, s) => fmt(t * 100, !s || s * 100 >= 1 ? 0 : s * 100 >= 0.1 ? 1 : 2) + "%" : (t, s) => tickLab(t, s) + "×"; }
  function cutText(key) {
    const sp = SPEC[key], f = (v) => (sp.unit === "%" ? fmt(v * 100, 0) + "%" : fmt(v, 1) + "×");
    return sp.direction === "higher_is_better" ? `alert < ${f(sp.red_cut)}, good ≥ ${f(sp.green_cut)}` : `alert > ${f(sp.red_cut)}, good ≤ ${f(sp.green_cut)}`;
  }
  const SUPPRESS = { roe: ["Equity", "negative equity"], debt_to_equity: ["Equity", "negative equity"], debt_to_ebitda: ["EBITDA", "negative EBITDA"], depreciation_to_ebitda: ["EBITDA", "negative EBITDA"], effective_tax_rate: ["Operating Profits (EBIT)", "negative EBIT"] };
  function kpiStatus(row, key) {
    const v = row[key], [lab] = E.classify(v, key);
    if (!ok(v) && SUPPRESS[key] && row[SUPPRESS[key][0]] <= 0) return { st: "alert", why: SUPPRESS[key][1] };
    return { st: RAG[lab] || null };
  }
  function periodRows(rows, st, keyCols) {
    // Most recent year per SOE | specific year | average across selected years (mean of each column)
    if (S.years.length < 2 || st.period === "recent") return latestOf(rows);
    if (st.period === "year") return rows.filter((r) => r.Year === st.year);
    const sel = rows.filter((r) => r.Year >= st.avgFrom && r.Year <= st.avgTo);
    return uniq(sel.map((r) => r.Entity)).map((e) => {
      const g = sel.filter((r) => r.Entity === e), o = { Entity: e, Sector: g[0].Sector, Year: null, _avg: true };
      keyCols.forEach((c) => { o[c] = mean(g.map((r) => r[c])); });
      return o;
    });
  }
  function periodControls(st, onChange) {
    const box = el("div", { class: "row-ctl" });
    if (S.years.length < 2) return box;
    box.appendChild(el("div", { class: "fld" }, el("span", { class: "lbl" }, "Period"), seg([["recent", "Most recent year"], ["year", "Specific year"], ["avg", "Average across years"]], st.period, (v) => { st.period = v; rebuild(); }, "Period")));
    if (st.period === "year") box.appendChild(fSelect("Year", S.years, st.year, (v) => { st.year = v; onChange(); }, { num: true }));
    if (st.period === "avg") box.appendChild(yearRangeCtl(S.years, st.avgFrom, st.avgTo, (f, t) => { st.avgFrom = f; st.avgTo = t; onChange(); }, "Years to average"));
    return box;
  }
  function periodLabel(st) { return S.years.length < 2 || st.period === "recent" ? "most recent year per SOE" : st.period === "year" ? String(st.year) : st.avgFrom === st.avgTo ? String(st.avgFrom) : `average of ${st.avgFrom}–${st.avgTo}`; }

  /** KPI scorecard table: latest year per SOE, most alerts first (KPI Dashboard and Report) */
  function scorecard(rowsK, avail, keys, expanded) {
    const latest = latestOf(rowsK);
    const scored = latest.map((r) => {
      const stt = Object.fromEntries([...new Set([...avail, ...keys])].map((k) => [k, kpiStatus(r, k)]));
      const prev = rowsK.filter((x) => x.Entity === r.Entity && x.Year < r.Year).sort((a, b) => b.Year - a.Year)[0];
      return { r, stt, prev, na: Object.values(stt).filter((s) => s.st === "alert").length, nw: Object.values(stt).filter((s) => s.st === "watch").length };
    }).sort((a, b) => b.na - a.na || a.r.Z_EM - b.r.Z_EM);
    const t = el("table");
    t.appendChild(el("thead", {}, el("tr", {}, el("th", {}, "SOE"), el("th", {}, "Z″ · zone"), keys.map((k) => el("th", { title: SPEC[k].description }, SPEC[k].label, el("br"), SPEC[k].unit === "%" ? "(%)" : "(×)")), el("th", { title: "Alerts out of all KPIs available" }, "Alerts"))));
    const tb = el("tbody");
    clipRows(scored, expanded).forEach(({ r, stt, prev, na, nw }) => {
      const tr = el("tr", { "data-s": slug(r.Sector) }, nameCell(r.Entity, r.Sector), statusCell(zk(r.Zone), fmt(r.Z_EM, 2), `${ZLABEL[zk(r.Zone)] || r.Zone} · ${r.Rating}`));
      keys.forEach((k) => { const s = stt[k]; tr.appendChild(statusCell(s.st, kpiFmt(k, r[k]), s.why || (prev && ok(prev[k]) ? `${prev.Year}: ${kpiFmt(k, prev[k])}` : null))); });
      const pips = el("span", { class: "pips", "aria-hidden": "true" });
      for (let i = 0; i < avail.length; i++) pips.appendChild(el("span", { class: i < na ? "on" : i < na + nw ? "w" : "" }));
      tr.appendChild(el("td", {}, el("span", { class: "flagcount" }, pips, `${na} / ${avail.length}`)));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    const legend = legendRow([el("span", {}, stChip("ok")), el("span", {}, stChip("watch")), el("span", {}, stChip("alert")),
      el("span", { class: "lt" }, el("b", {}, "Cutoffs: "), keys.map((k) => `${SPEC[k].label} ${cutText(k)}`).join(" · ")),
      el("span", { class: "lt" }, "n/a with a reason: the ratio is suppressed because equity, EBITDA or EBIT is negative, and counts as an alert.")], "");
    return { table: el("div", { class: "tbl-wrap" }, t), legend, scored };
  }
  pages.kpi = {
    build(root) {
      const st = S.kpi, H = (this.H = {});
      if (!S.years.includes(st.from)) st.from = S.years[0];
      if (!S.years.includes(st.to)) st.to = last(S.years);
      const rowsK = () => F().filter((r) => r.Year >= st.from && r.Year <= st.to);
      this.rowsK = rowsK;
      const avail = E.availableKpis(rowsK());
      this.avail = avail;
      const tools = el("div", { class: "row-ctl" },
        el("div", { class: "fld" }, el("span", { class: "lbl" }, "View"), seg([["trend", "Trend for one SOE"], ["compare", "Compare across SOEs"], ["scorecard", "Full scorecard"]], st.view, (v) => { st.view = v; rebuild(); })),
        S.years.length > 1 ? yearRangeCtl(S.years, st.from, st.to, (f, t) => { st.from = f; st.to = t; rebuild(); }) : null);
      const head = pageHead("PERFORMANCE MONITORING", "KPI Dashboard", "Profitability, liquidity, solvency, and fiscal-dependency ratios. Pick a ratio from each column's dropdown — thresholds are illustrative, pending recalibration.");
      const foot = el("div", { class: "foot" },
        el("div", {}, el("b", {}, "Thresholds. "), "Illustrative IMF SOE Health Check Tool-style red/amber/green cuts — provisional starting points, not calibrated to a specific country sample."),
        el("div", {}, el("b", {}, "Suppressed ratios. "), "ROE, Debt/Equity, Debt/EBITDA and Depreciation/EBITDA show n/a when equity or EBITDA is negative — the ratio's sign flips and would otherwise read as good. The scorecard counts these as alerts, as the guidance note recommends."));
      H.out = el("div");
      H.strip = statStrip();
      root.replaceChildren(head, H.strip, el("div", { class: "card", style: "margin-bottom:16px" }, tools), H.out, foot);
      // Keep all views selectable even if none of their KPI source columns exists.
      // Computable KPIs (this.avail) are still used solely for portfolio statistics.
      if (st.view === "trend") this.buildTrend();
      else if (st.view === "compare") this.buildCompare();
      else this.buildScorecard();
    },
    // The registered KPI catalog is the UI menu. Input availability affects
    // values/graphs, not visibility. Excluded legacy options (e.g. EBITDA
    // margin) stay excluded by config.KPI_CATEGORIES.
    // Keep this.avail for computing valid portfolio statistics only.
    catKpis(cat) { return CFG.KPI_CATEGORIES[cat].slice(); },
    buildTrend() {
      const st = S.kpi, H = this.H, names = uniq(this.rowsK().map((r) => r.Entity)).sort();
      if (!names.includes(st.soe)) st.soe = names[0];
      H.cards = {};
      const grid = el("div", { class: "grid4" });
      CFG.CATEGORY_ORDER.forEach((cat) => {
        const ks = this.catKpis(cat), c = card(CFG.CATEGORY_LABELS[cat], null, null, "top");
        if (!ks.length) { c.body.appendChild(el("p", { class: "kpi-desc" }, "No ratios available in this category for the current data.")); grid.appendChild(c.root); return; }
        if (!ks.includes(st.trend[cat])) st.trend[cat] = ks.find((k) => this.avail.includes(k)) || ks[0];
        const chart = el("div", { class: "chart" }), desc = el("p", { class: "kpi-desc" }), btn = el("div");
        c.body.append(fSelect("Ratio", ks.map((k) => [k, kpiTitle(k)]), st.trend[cat], (v) => { st.trend[cat] = v; this.render(); }), chart, desc, btn);
        H.cards[cat] = { chart, desc, btn };
        grid.appendChild(c.root);
      });
      H.out.replaceChildren(el("div", { class: "row-ctl", style: "margin-bottom:12px" }, fSelect("SOE", names, st.soe, (v) => { st.soe = v; this.render(); })), grid,
        legendRow([legendItem(LG.now, "Latest year"), legendItem(LG.hl, "Earlier years"), legendItem(LG.thrC, "Alert cutoff"), legendItem(LG.thrG, "Good cutoff"),
          el("span", { class: "lt" }, "Same chart for any number of years; with more than 15 years only the latest point is marked. A gap means the ratio is n/a that year.")], ""));
    },
    buildCompare() {
      const st = S.kpi, H = this.H;
      H.cards = {};
      const grid = el("div", { class: "grid4" });
      CFG.CATEGORY_ORDER.forEach((cat) => {
        const ks = this.catKpis(cat), c = card(CFG.CATEGORY_LABELS[cat], null, null, "top");
        if (!ks.length) { c.body.appendChild(el("p", { class: "kpi-desc" }, "No ratios available in this category for the current data.")); grid.appendChild(c.root); return; }
        if (!ks.includes(st.cmp[cat])) st.cmp[cat] = ks.find((k) => this.avail.includes(k)) || ks[0];
        const chart = el("div", { class: "chart" }), desc = el("p", { class: "kpi-desc" }), btn = el("div");
        c.body.append(fSelect("Ratio", ks.map((k) => [k, kpiTitle(k)]), st.cmp[cat], (v) => { st.cmp[cat] = v; this.render(); }), chart, desc, btn);
        H.cards[cat] = { chart, desc, btn };
        grid.appendChild(c.root);
      });
      H.period = el("div", { class: "note period-line" });
      H.out.replaceChildren(el("div", { style: "margin-bottom:8px" }, periodControls(st, () => this.render())), H.period, grid,
        legendRow([el("span", {}, stChip("ok")), el("span", {}, stChip("watch")), el("span", {}, stChip("alert")), el("span", { class: "lt" }, "Bars take the colour of their status; values carry the same symbol.")], ""));
    },
    buildScorecard() {
      const st = S.kpi, H = this.H;
      const cats = [["headline", "Headline"], ...CFG.CATEGORY_ORDER.map((c) => [c, CFG.CATEGORY_LABELS[c]]), ["all", "All"]];
      H.table = el("div"); H.legend = el("div");
      const c = card("Full SOE scorecard", "Latest year per SOE within the selected years · SOEs with the most alerts come first", seg(cats, st.scCat, (v) => { st.scCat = v; this.render(); }, "KPI category"));
      H.more = el("div");
      H.btn = el("div", { style: "margin-top:10px" });
      c.body.append(H.table, H.more, H.legend, H.btn);
      H.out.replaceChildren(c.root);
    },
    renderStrip() {
      const av = this.avail, latest = latestOf(this.rowsK()), n = latest.length;
      const many = av.length ? latest.filter((r) => av.filter((k) => kpiStatus(r, k).st === "alert").length >= Math.ceil(av.length / 2)).length : null;
      const medTile = (k, label) => {
        if (!av.includes(k)) return tile(label, null, null, "n/a", "", "Data unavailable · " + cutText(k));
        const vals = latest.map((r) => r[k]).filter(ok), v = median(vals), s2 = RAG[E.classify(v, k)[0]] || null;
        const na = n - vals.length;
        return tile(label, s2, s2 ? STLABEL[s2] : null, kpiFmt(k, v), "", `median of ${pl(vals.length, "SOE")}${na ? ` (${na} n/a)` : ""} · ${cutText(k)}`);
      };
      const g = av.includes("grants_to_revenue") ? latest.filter((r) => ok(r.grants_to_revenue) && r.grants_to_revenue > SPEC.grants_to_revenue.red_cut).length : null;
      put(this.H.strip,
        many === null ? tile("SOEs with most KPIs in alert", null, null, "n/a", "", "No calculable KPIs; alerts are not assessed") : countTile("SOEs with most KPIs in alert", many, n, `half or more of the ${av.length} ratios in alert · latest year`),
        medTile("operating_margin", "Median operating margin"),
        medTile("current_ratio", "Median current ratio"),
        medTile("debt_to_ebitda", "Median debt / EBITDA"),
        g === null ? tile("Grant-dependent SOEs", null, null, "n/a", "", "Data unavailable · government grants not reported") : countTile("Grant-dependent SOEs", g, n, `grants above ${fmt(SPEC.grants_to_revenue.red_cut * 100, 0)}% of revenue`, "watch"));
    },
    render() {
      const st = S.kpi, H = this.H;
      this.renderStrip();
      if (st.view === "trend") {
        const d = this.rowsK().filter((r) => r.Entity === st.soe).sort((a, b) => a.Year - b.Year);
        for (const cat in H.cards) {
          const k = st.trend[cat], { chart, desc, btn } = H.cards[cat];
          const sp = SPEC[k], xs = d.map((r) => r.Year), vals = d.map((r) => r[k]);
          desc.textContent = sp.description;
          if (!vals.some(ok)) {
            chart.replaceChildren(el("p", { class: "kpi-desc" }, missingKpiMessage(k))); btn.replaceChildren(); continue;
          }
          if (d.length < 2) { chart.replaceChildren(el("p", { class: "kpi-desc" }, `Only one year of data for ${st.soe} — need at least two to plot a trend.`)); btn.replaceChildren(); continue; }
          // one chart for any number of years: every year in the range on the x-axis (gaps where the ratio is n/a),
          // the latest year highlighted and labelled, dashed lines at the alert and good cutoffs
          lines(chart, xs, [{ vals, cls: "ln", dot: "hl", lastDot: "now", label: sp.label }], {
            h: 200, L: 46, R: 58, yFmt: kpiTick(k),
            hlines: [{ y: sp.red_cut, cls: "thr-crit", include: true }, { y: sp.green_cut, cls: "thr-good", include: true }],
            tipTitle: (i) => `${st.soe} · ${xs[i]}`,
            tip: (i) => {
              if (!ok(vals[i])) { const why = kpiStatus(d[i], k).why; return [["n/a", why ? `suppressed: ${why}` : "not reported"]]; }
              const s2 = RAG[E.classify(vals[i], k)[0]];
              return [[kpiFmt(k, vals[i]), sp.label], [STLABEL[s2] || "—", cutText(k)]];
            },
            endLabel: { series: 0, fmt: (v) => kpiFmt(k, v) }, naMarks: true,
          });
          btn.replaceChildren(dataButtons(() => toCSV(["Entity", "Sector", "Year", k], d.map((r) => [r.Entity, r.Sector, r.Year, r[k]])), `${st.soe}_${k}_trend.csv`));
        }
      } else if (st.view === "compare") {
        const keys = CFG.CATEGORY_ORDER.flatMap((cat) => this.catKpis(cat));
        const base = periodRows(this.rowsK(), st, keys);
        const nE = uniq(base.map((r) => r.Entity)).length;
        put(H.period, el("span", {}, "Showing: ", el("b", {}, periodLabel(st)), nE > LIMIT ? ` · ${st.all ? "all " + nE + " SOEs" : `the ${LIMIT} weakest of ${nE} SOEs on each ratio`}, weakest first` : " · weakest first"),
          moreToggle(nE, st.all, (v) => { st.all = v; this.render(); }));
        for (const cat in H.cards) {
          const k = st.cmp[cat], { chart, desc, btn } = H.cards[cat];
          const dir = SPEC[k].direction === "higher_is_better" ? 1 : -1;
          const rowsAll = base.filter((r) => ok(r[k])).sort((a, b) => dir * (a[k] - b[k]));
          const rows = clipRows(rowsAll, st.all);
          desc.textContent = SPEC[k].description;
          if (!rows.length) {
            chart.replaceChildren(el("p", { class: "kpi-desc" }, missingKpiMessage(k))); btn.replaceChildren(); continue;
          }
          hbars(chart, rows.map((r) => {
            const s = RAG[E.classify(r[k], k)[0]] || "none";
            return { label: r.Entity, v: r[k], cls: "bar st-" + s, lab: `${GLYPH[s] || ""} ${kpiFmt(k, r[k])}`.trim(), s: slug(r.Sector), tipTitle: `${r.Entity} · ${r.Sector}`, tip: [[kpiFmt(k, r[k]), SPEC[k].label], [STLABEL[s] || "No data", cutText(k)]] };
          }), { L: 70, R: 66, rowH: 28, nTicks: 3, tick: kpiTick(k) });
          btn.replaceChildren(dataButtons(() => toCSV(["Entity", "Sector", k], rowsAll.map((r) => [r.Entity, r.Sector, r[k]])), `${k}_by_soe.csv`));
        }
      } else {
        const cat = st.scCat;
        const keys = cat === "headline" ? CFG.REPORT_HEADLINE_KPIS.slice() : cat === "all"
          ? CFG.CATEGORY_ORDER.flatMap((c) => this.catKpis(c)) : this.catKpis(cat);
        const rowsK = this.rowsK(), latest = latestOf(rowsK);
        // Only available ratios count toward the risk score. Other columns
        // remain visible with neutral n/a cells, never fabricated zeros.
        const sc = scorecard(rowsK, this.avail, keys, st.all);
        H.table.replaceChildren(sc.table);
        put(H.more, moreToggle(latest.length, st.all, (v) => { st.all = v; this.render(); }, `Show the ${LIMIT} with most alerts only`));
        H.legend.replaceChildren(sc.legend);
        H.btn.replaceChildren(dataButtons(() => toCSV(["Entity", "Sector", "Year", ...keys], latest.map((r) => [r.Entity, r.Sector, r.Year, ...keys.map((k) => ok(r[k]) ? r[k] : "") ])), "kpi_scorecard.csv"));
      }
    },
  };

  /* =====================================================================
     ALTMAN Z-EM
     ===================================================================== */
  const ZKEYS = ["X1", "X2", "X3", "X4"];
  const SHORT = { X1: "WC / assets", X2: "RE / assets", X3: "EBIT / assets", X4: "Equity / liab." };
  const COMP_TITLES = { X1: "X1: Working capital / assets", X2: "X2: Retained earnings / assets", X3: "X3: EBIT / assets", X4: "X4: Equity / liabilities", Z_EM: "Z-EM score" };
  const GLOSS = { X1: "X1", X2: "X2", X3: "X3", X4: "X4", Z_EM: "Z-EM score" };
  pages.altman = {
    build(root) {
      const st = S.alt, H = (this.H = {});
      const head = pageHead("FINANCIAL DISTRESS SIGNAL", "Distress Indicator", "One distress score per SOE, built from four health checks on its accounts (the Altman Z″-EM score): can it pay this year's bills, has it built up savings, does the business make money, and how thick is its equity cushion. The score falls into three zones: safe, grey and distress. Hover the i icons for plain-language definitions.");
      H.out = el("div");
      const c = CFG.ZEM_COEFFICIENTS;
      const foot = el("div", { class: "foot" }, el("div", {}, el("b", {}, "Z-EM score. "), `Z = ${c.X1}·X1 + ${c.X2}·X2 + ${c.X3}·X3 + ${c.X4}·X4${CFG.ZEM_CONSTANT ? " + " + CFG.ZEM_CONSTANT : ""} (no constant — Eidelman convention). Z ≤ ${CFG.Z_DISTRESS_CUTOFF} distress, ${CFG.Z_DISTRESS_CUTOFF}–${CFG.Z_SAFE_CUTOFF} grey zone, > ${CFG.Z_SAFE_CUTOFF} safe. The rating is an indicative cohort mapping for reference only. For SOEs with large government transfers the unadjusted score is more likely to overstate than understate health.`));
      H.strip = statStrip();
      root.replaceChildren(head, H.strip, el("div", { class: "card", style: "margin-bottom:16px" }, el("div", { class: "row-ctl" }, el("div", { class: "fld" }, el("span", { class: "lbl" }, "View"), seg([["components", "Components for one SOE"], ["portfolio", "Portfolio view"]], st.view, (v) => { st.view = v; rebuild(); })))), H.out, foot);
      if (st.view === "components") this.buildComponents(); else this.buildPortfolio();
    },
    buildComponents() {
      const st = S.alt, H = this.H, names = uniq(F().map((r) => r.Entity)).sort();
      if (!names.includes(st.soe)) st.soe = names[0];
      const yrs = uniq(F().filter((r) => r.Entity === st.soe).map((r) => r.Year)).sort((a, b) => a - b);
      if (!yrs.includes(st.from)) st.from = yrs[0];
      if (!yrs.includes(st.to)) st.to = last(yrs);
      const ctl = el("div", { class: "row-ctl", style: "margin-bottom:12px" }, fSelect("SOE", names, st.soe, (v) => { st.soe = v; rebuild(); }));
      if (yrs.length > 2) ctl.append(fSelect("From", yrs, st.from, (v) => { st.from = Math.min(v, st.to); this.render(); }, { num: true }), fSelect("To", yrs, st.to, (v) => { st.to = Math.max(v, st.from); this.render(); }, { num: true }));
      H.charts = {};
      const grid = el("div", { class: "grid3" });
      ["X1", "X2", "X3", "X4", "Z_EM"].forEach((k) => {
        const chart = el("div", { class: "chart" });
        const c = el("div", { class: "card top" }, el("div", { class: "card-head", style: "margin-bottom:6px" }, el("div", {}, el("h3", {}, COMP_TITLES[k], info(CFG.GLOSSARY[GLOSS[k]] || "")))), chart);
        if (k === "Z_EM") c.insertBefore(legendRow([legendItem(LG.thrC, `Distress (${CFG.Z_DISTRESS_CUTOFF})`), legendItem(LG.thrW, `Safe threshold (${CFG.Z_SAFE_CUTOFF})`)]), chart);
        H.charts[k] = chart; grid.appendChild(c);
      });
      H.sum = el("div", { class: "card top" });
      grid.appendChild(H.sum);
      H.narr = el("div", { style: "margin-top:16px" });
      H.out.replaceChildren(ctl, grid, H.narr);
    },
    buildPortfolio() {
      const st = S.alt, H = this.H;
      H.label = el("div", { class: "note period-line" });
      H.bench = card("Benchmark across SOEs", null, null); H.dist = card("Portfolio distribution", null, null); H.drv = card("Scorecard and what drives each score", "Weighted contribution of each component (β × ratio), with the tool's rule-based reading underneath. Bars share one scale.");
      H.bench.body.append(el("div", { class: "chart" })); H.dist.body.append(el("div"));
      H.out.replaceChildren(el("div", { style: "margin-bottom:8px" }, periodControls(st, () => this.render())), H.label,
        el("div", { class: "grid" }, el("div", { class: "s7" }, H.bench.root), el("div", { class: "s5" }, H.dist.root), el("div", { class: "s12" }, H.drv.root)));
    },
    /** meeting 2026-10-30: the strip answers three questions for the SOE chosen below (in distress or not, its
     *  shadow rating, its probability of default) plus its distress score; the portfolio view shows the same four
     *  for the whole portfolio. */
    renderStrip() {
      const st = S.alt;
      if (st.view === "components") {
        const full = F().filter((r) => r.Entity === st.soe).sort((a, b) => a.Year - b.Year);
        const d = full.filter((r) => r.Year >= st.from && r.Year <= st.to);
        const r = last(d.length ? d : full);
        if (r) {
          const z = zk(r.Zone), pd = E.pdByRating(r.Rating), first = (d.length ? d : full)[0];
          const inZone = r.Zone === "Distress" ? "In distress" : r.Zone === "Grey" ? "Grey zone" : "Safe";
          const cut = r.Zone === "Distress" ? `Z″ ≤ ${CFG.Z_DISTRESS_CUTOFF}` : r.Zone === "Grey" ? `${CFG.Z_DISTRESS_CUTOFF} < Z″ ≤ ${CFG.Z_SAFE_CUTOFF}` : `Z″ > ${CFG.Z_SAFE_CUTOFF}`;
          const zs = (d.length ? d : full).map((q) => q.Z_EM).filter(ok);
          put(this.H.strip,
            tile(`${st.soe} · in distress?`, z, ZLABEL[z], inZone, String(r.Year), `${cut} · ${distressWhy(r)}`),
            tile("Distress score (Altman Z″)", z, ZLABEL[z], fmt(r.Z_EM, 2), "", zs.length > 1 ? `median ${first.Year}–${r.Year}: ${fmt(median(zs), 2)} · ${first.Year}: ${fmt(first.Z_EM, 2)}` : `${r.Year}`),
            tile("Shadow credit rating", null, null, r.Rating, "", `indicative rating read off the Z″ score, ${r.Year}`),
            tile("Probability of default", null, null, pctAuto(pd), "", `one-year PD for rating ${r.Rating}`));
          return;
        }
      }
      const rows = latestOf(F()), n = rows.length, zc = zoneCounts(rows), mz = median(rows.map((r) => r.Z_EM)), mzone = E.classifyZone(mz);
      const mpd = median(rows.map((r) => E.pdByRating(r.Rating)).filter(ok));
      put(this.H.strip,
        tile("SOEs in distress", zc.Distress ? "alert" : "ok", zc.Distress ? "Alert" : "Good", String(zc.Distress), `of ${n}`, `Z″ ≤ ${CFG.Z_DISTRESS_CUTOFF} · ${zc.Grey} more in the grey zone · latest year`),
        tile("Median distress score (Z″)", zk(mzone), ZLABEL[zk(mzone)], fmt(mz, 2), "", "median of the SOEs shown, latest year"),
        tile("Median shadow rating", null, null, E.zRating(mz), "", "rating at the median Z″"),
        tile("Median probability of default", null, null, pctAuto(mpd), "", "one-year PD, median of the SOEs shown"));
    },
    render() {
      const st = S.alt, H = this.H;
      this.renderStrip();
      if (st.view === "components") {
        const full = F().filter((r) => r.Entity === st.soe).sort((a, b) => a.Year - b.Year);
        const d = full.filter((r) => r.Year >= st.from && r.Year <= st.to);
        if (full.length < 2) {
          Object.values(H.charts).forEach((c) => c.replaceChildren(el("p", { class: "kpi-desc" }, `Only one year of data for ${st.soe} — need at least two to plot a trend.`)));
        } else {
          for (const k in H.charts) {
            const zs = k === "Z_EM";
            lines(H.charts[k], d.map((r) => r.Year), [{ vals: d.map((r) => r[k]), cls: "ln", dot: zs ? "now" : "hl", label: COMP_TITLES[k] }], {
              h: 190, R: 16, L: 44, zones: zs, hlines: zs ? [{ y: CFG.Z_DISTRESS_CUTOFF, cls: "thr-crit" }, { y: CFG.Z_SAFE_CUTOFF, cls: "thr-warn" }] : [],
              tip: (i) => [[fmt(d[i][k], zs ? 2 : 3), COMP_TITLES[k]], ...(zs ? [[d[i].Rating, ZLABEL[zk(d[i].Zone)]]] : [[sgn(d[i][k + "_contrib"], 2), "weighted contribution to Z″"]])],
            });
          }
        }
        H.sum.replaceChildren(el("h3", { style: "font-size:15px;margin-bottom:8px" }, "Summary"), summaryBox(E.zTrendSummary(d, st.soe)), el("div", { style: "margin-top:10px" },
          dataButtons(() => toCSV(["Entity", "Sector", "Year", "X1", "X2", "X3", "X4", "Z_EM", "Zone"], d.map((r) => [r.Entity, r.Sector, r.Year, ...["X1", "X2", "X3", "X4", "Z_EM"].map((c) => +(+r[c]).toFixed(3)), r.Zone])), `${st.soe}_z_components.csv`)));
        H.narr.replaceChildren(el("div", { class: "card" }, summaryBox(E.singleNarrative(last(full)), `Reading for ${last(full).Year} — rule-based, generated from the numbers`)));
        return;
      }
      const cols = ["Z_EM", ...ZKEYS, ...ZKEYS.map((k) => k + "_contrib")];
      const rows = periodRows(F(), st, cols).map((r) => Object.assign({}, r, r._avg ? { Zone: E.classifyZone(r.Z_EM), Rating: E.zRating(r.Z_EM) } : {})).sort((a, b) => a.Z_EM - b.Z_EM);
      const shown = clipRows(rows, st.all);
      put(H.label, el("span", {}, "Showing: ", el("b", {}, periodLabel(st)), rows.length > LIMIT ? ` · ${st.all ? "all " + rows.length + " SOEs" : `the ${LIMIT} weakest of ${rows.length} SOEs`} in the benchmark and scorecard, weakest first` : " · weakest first"),
        moreToggle(rows.length, st.all, (v) => { st.all = v; this.render(); }));
      hbars(H.bench.body.firstChild, shown.map((r) => ({ label: r.Entity, sub: r.Sector, s: slug(r.Sector), v: r.Z_EM, lab: `${fmt(r.Z_EM, 2)} · ${r.Rating}`, tipTitle: `${r.Entity} · ${r.Sector}`, tip: [[fmt(r.Z_EM, 2), "Z″" + (r._avg ? " (average)" : ` (${r.Year})`)], [ZLABEL[zk(r.Zone)] || r.Zone, "zone"], [r.Rating, `rating · PD ${pctAuto(E.pdByRating(r.Rating))}`]] })), { shade: true, max: CFG.Z_SAFE_CUTOFF + 0.4 });
      if (!H.bench.body.querySelector(".btn-row")) H.bench.body.appendChild(el("div", { style: "margin-top:8px" }));
      H.bench.body.lastChild.replaceChildren(dataButtons(() => toCSV(["Entity", "Sector", "Year", "Z_EM", "Zone", "Rating"], rows.map((r) => [r.Entity, r.Sector, r.Year ?? "avg", r.Z_EM, r.Zone, r.Rating])), "altman_z_benchmark.csv"));
      const zc = zoneCounts(rows), n = rows.length;
      H.dist.body.firstChild.replaceChildren(el("div", { class: "hero", style: "gap:12px" },
        el("div", { class: "hero-value", style: "font-size:40px" }, String(zc.Distress), el("small", {}, `of ${pl(n, "SOE")} in distress`)), ...zoneBar(zc, n), summaryBox(E.zoneSummary(rows))));
      // drivers table
      const maxAbs = Math.max(0.5, ...shown.flatMap((r) => ZKEYS.map((k) => Math.abs(r[k + "_contrib"])).filter(ok)));
      const t = el("table", { id: "compTable" });
      t.appendChild(el("thead", {}, el("tr", {}, el("th", {}, "SOE"), el("th", {}, "Year"), ZKEYS.map((k) => el("th", { title: CFG.ZEM_LABELS[k] }, `${k} · ${["working capital", "retained earnings", "EBIT", "equity / liabilities"][ZKEYS.indexOf(k)]}`)), el("th", {}, "Z″ · zone"), el("th", {}, "Rating · PD"))));
      const tb = el("tbody");
      const cross = E.crossNarrative(rows), flags = Object.fromEntries(cross.table.map((x) => [x.Entity, x.Flag]));
      shown.forEach((r) => {
        tb.appendChild(el("tr", { class: "main", "data-s": slug(r.Sector) }, nameCell(r.Entity, r.Sector), el("td", {}, r.Year ?? "avg"),
          ZKEYS.map((k) => {
            const c = r[k + "_contrib"];
            return el("td", { title: `${CFG.ZEM_LABELS[k]} = ${fmt(r[k], 3)} × ${CFG.ZEM_COEFFICIENTS[k]} = ${fmt(c, 2)}` }, el("div", { class: "mini" },
              el("div", { class: "track" }, ok(c) ? el("span", { class: c >= 0 ? "pos" : "neg", style: `width:${(Math.min(Math.abs(c), maxAbs) / maxAbs) * 50}%` }) : null), el("span", { class: "val num" }, sgn(c, 2))));
          }),
          statusCell(zk(r.Zone), fmt(r.Z_EM, 2), ZLABEL[zk(r.Zone)] || r.Zone), el("td", { style: "white-space:nowrap" }, `${r.Rating} · ${pctAuto(E.pdByRating(r.Rating))}`)));
        const rd = el("td", { class: "reading", colspan: "8" });
        boldText(rd, E.singleNarrative(r).replace(/^\*\*[^*]*\*\*\s*/, "") || "—");
        const fl = [flags[r.Entity]];
        if (ok(r.grants_to_revenue) && r.grants_to_revenue > SPEC.grants_to_revenue.red_cut && r.Zone !== "Distress") fl.push(`Grants equal ${fmt(r.grants_to_revenue * 100, 0)}% of revenue, so Z″ likely overstates health`);
        if (fl.filter(Boolean).length) { rd.appendChild(el("br")); fl.filter(Boolean).forEach((f) => rd.appendChild(el("span", { class: "flag" }, f))); }
        tb.appendChild(el("tr", { class: "read", "data-s": slug(r.Sector) }, rd));
      });
      t.appendChild(tb);
      H.drv.body.replaceChildren(el("div", { class: "tbl-wrap" }, t), el("p", { class: "note" }, cross.paragraph),
        el("div", { style: "margin-top:8px" }, dataButtons(() => toCSV(["Entity", "Sector", "Year", "Z_EM", "Zone", "Rating", ...ZKEYS, ...ZKEYS.map((k) => k + "_contrib")], rows.map((r) => [r.Entity, r.Sector, r.Year ?? "avg", r.Z_EM, r.Zone, r.Rating, ...ZKEYS.map((k) => r[k]), ...ZKEYS.map((k) => r[k + "_contrib"])])), "altman_z_scorecard.csv")));
    },
  };

  /* =====================================================================
     EXPECTED FISCAL COST
     ===================================================================== */
  /* Country GDP from the World Bank's World Development Indicators, in one of two series:
   *   NY.GDP.MKTP.CN  GDP (current LCU)  — the country's own currency
   *   NY.GDP.MKTP.CD  GDP (current US$)
   * Picking a country and a year looks GDP up and fills it in automatically; the units list then only sets how
   * the number is shown and typed. S.gdp is always kept in the statements' own scale (raw / SC).
   * No FX conversion is guessed: a GDP in another currency than the statements is filled in but not used
   * until the user ticks "use it anyway". */
  const GDP_SERIES = {
    CN: { code: "NY.GDP.MKTP.CN", name: "GDP (current LCU)" },
    CD: { code: "NY.GDP.MKTP.CD", name: "GDP (current US$)" },
  };
  // World Bank economies: ISO3 | name as the World Bank writes it | ISO 4217 code of the currency of its LCU series.
  // Kept in the page because the World Bank's country list carries no currency, and so the list works offline.
  const GDP_COUNTRIES = ("AFG|Afghanistan|AFN;ALB|Albania|ALL;DZA|Algeria|DZD;ASM|American Samoa|USD;AND|Andorra|EUR;AGO|Angola|AOA;" +
    "ATG|Antigua and Barbuda|XCD;ARG|Argentina|ARS;ARM|Armenia|AMD;ABW|Aruba|AWG;AUS|Australia|AUD;AUT|Austria|EUR;AZE|Azerbaijan|AZN;" +
    "BHS|Bahamas, The|BSD;BHR|Bahrain|BHD;BGD|Bangladesh|BDT;BRB|Barbados|BBD;BLR|Belarus|BYN;BEL|Belgium|EUR;BLZ|Belize|BZD;BEN|Benin|XOF;" +
    "BMU|Bermuda|BMD;BTN|Bhutan|BTN;BOL|Bolivia|BOB;BIH|Bosnia and Herzegovina|BAM;BWA|Botswana|BWP;BRA|Brazil|BRL;" +
    "VGB|British Virgin Islands|USD;BRN|Brunei Darussalam|BND;BGR|Bulgaria|EUR;BFA|Burkina Faso|XOF;BDI|Burundi|BIF;CPV|Cabo Verde|CVE;" +
    "KHM|Cambodia|KHR;CMR|Cameroon|XAF;CAN|Canada|CAD;CYM|Cayman Islands|KYD;CAF|Central African Republic|XAF;TCD|Chad|XAF;" +
    "CHI|Channel Islands|GBP;CHL|Chile|CLP;CHN|China|CNY;COL|Colombia|COP;COM|Comoros|KMF;COD|Congo, Dem. Rep.|CDF;COG|Congo, Rep.|XAF;" +
    "CRI|Costa Rica|CRC;CIV|Cote d'Ivoire|XOF;HRV|Croatia|EUR;CUB|Cuba|CUP;CUW|Curacao|ANG;CYP|Cyprus|EUR;CZE|Czechia|CZK;DNK|Denmark|DKK;" +
    "DJI|Djibouti|DJF;DMA|Dominica|XCD;DOM|Dominican Republic|DOP;ECU|Ecuador|USD;EGY|Egypt, Arab Rep.|EGP;SLV|El Salvador|USD;" +
    "GNQ|Equatorial Guinea|XAF;ERI|Eritrea|ERN;EST|Estonia|EUR;SWZ|Eswatini|SZL;ETH|Ethiopia|ETB;FRO|Faroe Islands|DKK;FJI|Fiji|FJD;" +
    "FIN|Finland|EUR;FRA|France|EUR;PYF|French Polynesia|XPF;GAB|Gabon|XAF;GMB|Gambia, The|GMD;GEO|Georgia|GEL;DEU|Germany|EUR;GHA|Ghana|GHS;" +
    "GIB|Gibraltar|GIP;GRC|Greece|EUR;GRL|Greenland|DKK;GRD|Grenada|XCD;GUM|Guam|USD;GTM|Guatemala|GTQ;GIN|Guinea|GNF;GNB|Guinea-Bissau|XOF;" +
    "GUY|Guyana|GYD;HTI|Haiti|HTG;HND|Honduras|HNL;HKG|Hong Kong SAR, China|HKD;HUN|Hungary|HUF;ISL|Iceland|ISK;IND|India|INR;" +
    "IDN|Indonesia|IDR;IRN|Iran, Islamic Rep.|IRR;IRQ|Iraq|IQD;IRL|Ireland|EUR;IMN|Isle of Man|GBP;ISR|Israel|ILS;ITA|Italy|EUR;" +
    "JAM|Jamaica|JMD;JPN|Japan|JPY;JOR|Jordan|JOD;KAZ|Kazakhstan|KZT;KEN|Kenya|KES;KIR|Kiribati|AUD;PRK|Korea, Dem. People's Rep.|KPW;" +
    "KOR|Korea, Rep.|KRW;XKX|Kosovo|EUR;KWT|Kuwait|KWD;KGZ|Kyrgyz Republic|KGS;LAO|Lao PDR|LAK;LVA|Latvia|EUR;LBN|Lebanon|LBP;" +
    "LSO|Lesotho|LSL;LBR|Liberia|LRD;LBY|Libya|LYD;LIE|Liechtenstein|CHF;LTU|Lithuania|EUR;LUX|Luxembourg|EUR;MAC|Macao SAR, China|MOP;" +
    "MDG|Madagascar|MGA;MWI|Malawi|MWK;MYS|Malaysia|MYR;MDV|Maldives|MVR;MLI|Mali|XOF;MLT|Malta|EUR;MHL|Marshall Islands|USD;" +
    "MRT|Mauritania|MRU;MUS|Mauritius|MUR;MEX|Mexico|MXN;FSM|Micronesia, Fed. Sts.|USD;MDA|Moldova|MDL;MCO|Monaco|EUR;MNG|Mongolia|MNT;" +
    "MNE|Montenegro|EUR;MAR|Morocco|MAD;MOZ|Mozambique|MZN;MMR|Myanmar|MMK;NAM|Namibia|NAD;NRU|Nauru|AUD;NPL|Nepal|NPR;" +
    "NLD|Netherlands|EUR;NCL|New Caledonia|XPF;NZL|New Zealand|NZD;NIC|Nicaragua|NIO;NER|Niger|XOF;NGA|Nigeria|NGN;" +
    "MKD|North Macedonia|MKD;MNP|Northern Mariana Islands|USD;NOR|Norway|NOK;OMN|Oman|OMR;PAK|Pakistan|PKR;PLW|Palau|USD;PAN|Panama|PAB;" +
    "PNG|Papua New Guinea|PGK;PRY|Paraguay|PYG;PER|Peru|PEN;PHL|Philippines|PHP;POL|Poland|PLN;PRT|Portugal|EUR;PRI|Puerto Rico|USD;" +
    "QAT|Qatar|QAR;ROU|Romania|RON;RUS|Russian Federation|RUB;RWA|Rwanda|RWF;WSM|Samoa|WST;SMR|San Marino|EUR;" +
    "STP|Sao Tome and Principe|STN;SAU|Saudi Arabia|SAR;SEN|Senegal|XOF;SRB|Serbia|RSD;SYC|Seychelles|SCR;SLE|Sierra Leone|SLE;" +
    "SGP|Singapore|SGD;SXM|Sint Maarten (Dutch part)|ANG;SVK|Slovak Republic|EUR;SVN|Slovenia|EUR;SLB|Solomon Islands|SBD;SOM|Somalia|SOS;" +
    "ZAF|South Africa|ZAR;SSD|South Sudan|SSP;ESP|Spain|EUR;LKA|Sri Lanka|LKR;KNA|St. Kitts and Nevis|XCD;LCA|St. Lucia|XCD;" +
    "MAF|St. Martin (French part)|EUR;VCT|St. Vincent and the Grenadines|XCD;SDN|Sudan|SDG;SUR|Suriname|SRD;SWE|Sweden|SEK;" +
    "CHE|Switzerland|CHF;SYR|Syrian Arab Republic|SYP;TJK|Tajikistan|TJS;TZA|Tanzania|TZS;THA|Thailand|THB;TLS|Timor-Leste|USD;" +
    "TGO|Togo|XOF;TON|Tonga|TOP;TTO|Trinidad and Tobago|TTD;TUN|Tunisia|TND;TUR|Turkiye|TRY;TKM|Turkmenistan|TMT;" +
    "TCA|Turks and Caicos Islands|USD;TUV|Tuvalu|AUD;UGA|Uganda|UGX;UKR|Ukraine|UAH;ARE|United Arab Emirates|AED;GBR|United Kingdom|GBP;" +
    "USA|United States|USD;URY|Uruguay|UYU;UZB|Uzbekistan|UZS;VUT|Vanuatu|VUV;VEN|Venezuela, RB|VES;VNM|Viet Nam|VND;" +
    "VIR|Virgin Islands (U.S.)|USD;PSE|West Bank and Gaza|ILS;YEM|Yemen, Rep.|YER;ZMB|Zambia|ZMW;ZWE|Zimbabwe|ZWG")
    .split(";").map((s) => s.split("|"));
  const GDP_CUR_NAME = { XOF: "CFA franc (XOF)", XAF: "CFA franc (XAF)", USD: "US dollars", EUR: "euros" };
  const gdpCurName = (c) => GDP_CUR_NAME[c] || c || "local currency";
  const GDP_UNIT_FACTORS = { statements: null, units: 1, thousand: 1e3, million: 1e6, billion: 1e9 };
  const GDP_CACHE = new Map(); // "CN|SEN|2024" → value in full currency units, or null when the World Bank has none
  const gdpUnitSize = (u) => u === "statements" ? SC : (GDP_UNIT_FACTORS[u] || 1);
  const gdpNumber = (v) => { const a = Math.abs(v); return Number(v).toLocaleString("en-US", { maximumFractionDigits: a >= 1e6 ? 0 : a >= 100 ? 2 : 4 }); };
  const gdpBig = (v) => { const a = Math.abs(v); return a >= 1e12 ? fmt(v / 1e12, 2) + " tn" : a >= 1e9 ? fmt(v / 1e9, 2) + " bn" : a >= 1e6 ? fmt(v / 1e6, 1) + " m" : gdpNumber(v); };
  const foldAccents = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  /** the statements' currency as a code: "CFA" for FCFA / CFA franc (either zone), else an ISO code, or null when not stated */
  function stmtCurrency() {
    const u = String(CUR || "").trim().toUpperCase().replace(/\./g, "");
    if (!u || /^(LCU|LOCAL CURRENCY|NATIONAL CURRENCY)$/.test(u)) return null;
    if (/^(F ?CFA|CFA|CFA ?F|CFA FRANCS?|FRANCS? CFA)$/.test(u)) return "CFA";
    if (/^(US ?\$|\$|USD|US DOLLARS?|DOLLARS?)$/.test(u)) return "USD";
    if (/^(€|EUR|EUROS?)$/.test(u)) return "EUR";
    return /^[A-Z]{3}$/.test(u) ? u : null;
  }
  function gdpCurrencyStatus(gdpCur) {
    const s = stmtCurrency();
    if (!s || !gdpCur) return "unknown";
    if (s === "CFA") return gdpCur === "XOF" || gdpCur === "XAF" ? "match" : "mismatch";
    return s === gdpCur ? "match" : "mismatch";
  }
  /** a Country column in the data (ISO3 code or World Bank name) picks the country for the user */
  function dataCountry() {
    const raw = foldAccents((S.rows.find((r) => r.Country) || {}).Country);
    if (!raw) return "";
    const hit = GDP_COUNTRIES.find(([c, n]) => c.toLowerCase() === raw || foldAccents(n) === raw || foldAccents(n).replace(/,.*$/, "") === raw);
    return hit ? hit[0] : "";
  }
  const gdpKey = (series, country, year) => `${series}|${country}|${year}`;
  function gdpField(onChange) {
    const valId = nid("gdp"), countryId = nid("gdp-country"), yearId = nid("gdp-year"), unitId = nid("gdp-units");
    const stUnits = (S.rows.find((r) => r.Units) || {}).Units;
    const anaYear = Number((S.tab === "efc" ? S.efc?.year : S.sh?.year) || last(S.years));
    const box = el("div", { class: "fld gdp-control" });
    const label = el("span", { class: "lbl" }, `Country GDP${CUR ? " (" + CUR + ")" : ""}`,
      info("Nominal GDP, to show expected fiscal cost as a share of the economy. Pick a country and a year and the World Bank figure is filled in. Choose the series in the statements' currency: Local currency (GDP, current LCU) or US dollars (GDP, current US$). The units list only changes how the number is shown and typed. You can also type a value."));
    if (!S.gdpSeries) S.gdpSeries = stmtCurrency() === "USD" ? "CD" : "CN";
    const seriesSeg = seg([["CN", "Local currency"], ["CD", "US dollars"]], S.gdpSeries, (v) => { S.gdpSeries = v; renderSource(); lookup(); }, "World Bank GDP series");
    seriesSeg.classList.add("gdp-series");
    const countrySel = el("select", { id: countryId }, el("option", { value: "" }, "Select a country…"),
      ...GDP_COUNTRIES.slice().sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => el("option", { value: c }, n)));
    const yearSel = el("select", { id: yearId });
    const topYear = Math.max(new Date().getFullYear() - 1, last(S.years) || 0);
    for (let yr = topYear; yr >= 1960; yr--) yearSel.appendChild(el("option", { value: String(yr) }, String(yr)));
    const unitSel = el("select", { id: unitId, "aria-label": "GDP units" },
      [["billion", "Billions"], ["million", "Millions"], ["thousand", "Thousands"], ["units", "Full units"],
       ["statements", `As in the statements (${stUnits || "full units"})`]].map(([value, t]) => el("option", { value }, t)));
    unitSel.value = S.gdpInputUnit || "billion";
    const valInp = el("input", { type: "text", inputmode: "decimal", id: valId, autocomplete: "off", placeholder: "Filled in automatically" });
    const status = el("div", { class: "gdp-status", role: "status", "aria-live": "polite" });
    const anyway = el("label", { class: "gdp-confirm" }, el("input", { type: "checkbox" }), el("span", {}, "Use it anyway — I know the currencies differ"));
    const anywayBox = anyway.querySelector("input");
    const source = el("div", { class: "gdp-source" });
    box.append(label,
      el("div", { class: "gdp-step" }, el("span", { class: "gdp-sub" }, "World Bank series"), seriesSeg),
      el("div", { class: "gdp-lookup-grid" }, el("label", { for: countryId }, "Country", countrySel), el("label", { for: yearId }, "Year", yearSel)),
      el("div", { class: "gdp-step" }, el("label", { for: valId, class: "gdp-sub" }, "GDP"), el("div", { class: "gdp-value" }, valInp, unitSel)),
      status, anyway, source);

    let pending = null, fetchId = 0; // pending: a looked-up GDP held back because its currency differs from the statements
    const fromData = !S.gdpCountry && dataCountry();
    countrySel.value = S.gdpCountry || fromData || "";
    if (fromData) S.gdpCountry = fromData;
    yearSel.value = String(S.gdpYear || anaYear);
    if (!yearSel.value) yearSel.selectedIndex = 0;
    const countryName = (c) => (GDP_COUNTRIES.find((x) => x[0] === c) || [c, c])[1];
    const countryCur = (c) => (GDP_COUNTRIES.find((x) => x[0] === c) || [])[2] || null;

    function showValue() {
      const raw = S.gdp ? S.gdp * SC : pending ? pending.value : null;
      valInp.value = raw ? gdpNumber(raw / gdpUnitSize(unitSel.value)) : "";
      valInp.classList.toggle("held", !!pending && !S.gdp);
    }
    function renderSource() {
      const s = GDP_SERIES[S.gdpSeries];
      source.replaceChildren("Source: World Bank WDI · ", el("a", { href: "https://data.worldbank.org/indicator/" + s.code, target: "_blank", rel: "noopener noreferrer" }, s.name), " · " + s.code);
    }
    function renderStatus(msg) {
      const src = S.gdpSrc, cls = (k) => status.className = "gdp-status " + k;
      anyway.hidden = !(pending || (src && src.forced));
      anywayBox.checked = !!(src && src.forced);
      if (msg) { cls(msg[0]); put(status, ...msg.slice(1)); return; }
      if (pending) {
        cls("warn");
        put(status, el("b", {}, "Not used yet. "), `${countryName(pending.country)} ${pending.year} GDP is in ${gdpCurName(pending.cur)}, the statements are in ${CUR}. ` +
          (pending.series === "CD" ? "Switch the series to Local currency, type" : "Type") + ` a GDP in ${CUR}, or tick below.`);
        return;
      }
      if (src && src.kind === "wb") {
        const stat = gdpCurrencyStatus(src.cur), yearOff = anaYear && Number(src.year) !== anaYear;
        cls(src.forced || yearOff ? "warn" : "ok");
        const useYear = yearOff ? el("button", { type: "button", class: "linkbtn", onclick: () => { yearSel.value = String(anaYear); S.gdpYear = yearSel.value; lookup(); } }, `Use ${anaYear}`) : null;
        put(status, el("b", {}, "✓ Filled in automatically: "), `${countryName(src.country)}, ${src.year} · ${gdpBig(src.value)} ${src.cur}. `,
          src.forced ? `Different currency from the statements (${CUR}); results mix currencies.` : stat === "match" ? `Same currency as the statements (${CUR}).` : `The statements don't say their currency; check it is ${gdpCurName(src.cur)}.`,
          yearOff ? el("span", { class: "gdp-yr" }, ` GDP year ${src.year}, analysis year ${anaYear}. `, useYear) : null);
        return;
      }
      if (src && src.kind === "manual" && S.gdp) {
        cls("ok"); put(status, el("b", {}, "✓ Entered by hand: "), `${gdpBig(S.gdp * SC)}${CUR ? " " + CUR : ""}.`);
        return;
      }
      cls("idle"); put(status, "Pick a country and a year: GDP is looked up and filled in automatically. Or type a value.");
    }
    function apply(res) {
      S.gdp = res.value / SC; S.gdpSrc = res; pending = null;
      S.gdpCountry = res.country; S.gdpYear = res.year; S.gdpSeries = res.series; // one GDP for every tab
      showValue(); renderStatus(); onChange();
    }
    function clearLooked() {
      if (S.gdpSrc && S.gdpSrc.kind === "wb") { S.gdp = null; S.gdpSrc = null; onChange(); }
    }
    async function lookup() {
      const country = countrySel.value, year = yearSel.value, series = S.gdpSeries, req = ++fetchId;
      pending = null;
      if (!country || !year) { showValue(); renderStatus(); return; }
      const key = gdpKey(series, country, year);
      if (S.gdpSrc && S.gdpSrc.kind === "wb" && gdpKey(S.gdpSrc.series, S.gdpSrc.country, S.gdpSrc.year) === key) { showValue(); renderStatus(); return; }
      let value = GDP_CACHE.get(key);
      if (value === undefined) {
        renderStatus(["busy", `Looking up ${countryName(country)} GDP for ${year}…`]);
        const url = `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${GDP_SERIES[series].code}?date=${encodeURIComponent(year)}&format=json&source=2`;
        try {
          const response = await fetch(url, { headers: { Accept: "application/json" } });
          if (!response.ok) throw Error("World Bank API status " + response.status);
          const data = await response.json();
          const row = Array.isArray(data) && Array.isArray(data[1]) ? data[1].find((r) => r && String(r.date) === year && Number.isFinite(r.value)) : null;
          value = row ? Number(row.value) : null;
          GDP_CACHE.set(key, value);
        } catch (err) {
          if (req !== fetchId || !box.isConnected) return;
          clearLooked(); showValue();
          renderStatus(["warn", "The World Bank lookup is unavailable (no internet, or the API is down). Type a GDP value instead."]);
          return;
        }
      }
      if (req !== fetchId || !box.isConnected) return;
      if (!(value > 0)) {
        clearLooked(); showValue();
        renderStatus(["warn", `The World Bank has no ${GDP_SERIES[series].name} for ${countryName(country)} in ${year}. Choose another year, or type a value.`]);
        return;
      }
      const res = { kind: "wb", series, country, year, value, cur: series === "CD" ? "USD" : countryCur(country) };
      if (gdpCurrencyStatus(res.cur) === "mismatch") { pending = res; clearLooked(); showValue(); renderStatus(); return; }
      apply(res);
    }
    countrySel.addEventListener("change", () => { S.gdpCountry = countrySel.value; lookup(); });
    yearSel.addEventListener("change", () => { S.gdpYear = yearSel.value; lookup(); });
    unitSel.addEventListener("change", () => { S.gdpInputUnit = unitSel.value; showValue(); });
    anywayBox.addEventListener("change", () => {
      if (anywayBox.checked && pending) apply(Object.assign({}, pending, { forced: true }));
      else if (!anywayBox.checked && S.gdpSrc && S.gdpSrc.forced) { pending = Object.assign({}, S.gdpSrc, { forced: false }); S.gdp = null; S.gdpSrc = null; showValue(); renderStatus(); onChange(); }
    });
    const typed = (final) => {
      const t = valInp.value.trim(), v = E.parseNumber(t);
      if (!t) { pending = null; S.gdp = null; S.gdpSrc = null; renderStatus(); onChange(); return; }
      if (!(Number.isFinite(v) && v > 0)) { renderStatus(["warn", "Type GDP as a positive number, for example 19,506 with Billions selected."]); return; }
      pending = null; S.gdp = (v * gdpUnitSize(unitSel.value)) / SC; S.gdpSrc = { kind: "manual" };
      if (final) showValue();
      renderStatus(); onChange();
    };
    valInp.addEventListener("change", () => { clearTimeout(valInp._t); typed(true); });
    valInp.addEventListener("input", () => { clearTimeout(valInp._t); valInp._t = setTimeout(() => typed(false), 600); });
    // another tab may have changed GDP since this field was built: showTab calls this to bring it up to date
    box._sync = () => {
      countrySel.value = S.gdpCountry || ""; yearSel.value = String(S.gdpYear || anaYear); unitSel.value = S.gdpInputUnit || "billion";
      seriesSeg.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(["CN", "CD"][i] === S.gdpSeries)));
      renderSource();
      if (S.gdpSrc && S.gdpSrc.kind === "manual") { pending = null; showValue(); renderStatus(); }
      else lookup(); // from the cache: shows the applied GDP, or holds back one in another currency
    };
    renderSource();
    // the country and year already chosen (or the data's own Country column) fill GDP in straight away
    if (S.gdpSrc && S.gdpSrc.kind === "manual") { showValue(); renderStatus(); }
    else lookup();
    return box;
  }
  pages.efc = {
    build(root) {
      const st = S.efc, H = (this.H = {});
      const yrs = uniq(F().map((r) => r.Year)).sort((a, b) => a - b);
      if (!yrs.includes(st.year)) st.year = last(yrs);
      const view = F().filter((r) => r.Year === st.year);
      const names = uniq(view.map((r) => r.Entity)).sort();
      const settings = card("Settings", null, null, "top");
      const lgdBox = el("div", { class: "fields" });
      if (st.mode === "single") lgdBox.appendChild(fSlider("LGD", { min: CFG.LGD_SLIDER_MIN, max: CFG.LGD_SLIDER_MAX, step: 1, value: st.lgd, fmt: (v) => v + "%", info: CFG.GLOSSARY.LGD }, (v) => { st.lgd = v; this.render(); }));
      else names.forEach((n) => lgdBox.appendChild(fSlider(`${n} LGD`, { min: CFG.LGD_SLIDER_MIN, max: CFG.LGD_SLIDER_MAX, step: 1, value: st.per[n] ?? st.lgd, fmt: (v) => v + "%" }, (v) => { st.per[n] = v; this.render(); })));
      // meeting 2026-10-30: EAD is a share of total liabilities only. If the State stands behind, say, 80% of an SOE's
      // liabilities, that share is the exposure; a separate "guaranteed debt" basis is not needed (switch removed).
      st.basis = "total_liabilities";
      H.eadNote = el("small", { class: "muted" });
      settings.body.append(el("div", { class: "fields" },
        fSelect("Year", yrs, st.year, (v) => { st.year = v; rebuild(); }, { num: true }),
        el("div", { class: "fld" }, el("span", { class: "lbl" }, "LGD input mode"), seg([["single", "Single LGD"], ["per", "Per-SOE LGD"]], st.mode, (v) => { st.mode = v; rebuild(); })),
        lgdBox,
        fSlider("EAD: share of total liabilities", { min: 0.5, max: 1, step: 0.1, value: st.ead, fmt: pct0, info: "Exposure at default: the share of the SOE's total liabilities the government would have to cover if the SOE defaulted. 100% counts every liability (the government stands behind the whole SOE); 60% and 80% are sensitivity cases." }, (v) => { st.ead = v; this.render(); }),
        gdpField(() => this.render())));
      H.strip = statStrip();
      H.bar = card("EFC by SOE", null, null); H.bar.body.append(el("div", { class: "chart" }), el("div", { style: "margin-top:8px" }));
      if (!names.includes(st.sens)) st.sens = names[0];
      H.sens = card("Government backstop sensitivity — one SOE", null, fSelect(null, names, st.sens, (v) => { st.sens = v; this.render(); }));
      H.sens.head.querySelector(".card-tools").prepend(el("span", { class: "chips-label" }, "SOE"));
      H.sens.body.append(el("div"), el("div", { class: "chart" }), el("p", { class: "note" }));
      const ref = card(null);
      ref.body.appendChild(el("p", { class: "note", style: "margin-top:0" }, "Government LGD by sector from GEMs public-lending recovery data 1994–2024. Lender recovery rate is taken directly as government LGD: a high lender recovery reflects a large government backstop."));
      ref.body.appendChild(simpleTable(["Sector · GEMs source row", "Average", "P10–P90", "n"],
        Object.entries(CFG.SECTOR_RECOVERY_DATA).map(([s, d]) => [nameCell(s, d.gems_source), pct(d.average, 1), `${fmt(d.p10 * 100, 0)}–${fmt(d.p90 * 100, 0)}%`, String(d.n_defaults)]), { right: (i) => i >= 1, cls: "compact" }));
      ref.root.querySelectorAll("td.name").forEach((t) => (t.style.whiteSpace = "normal"));
      H.table = card("EFC results", null, null);
      const refFold = fold(st.open || (st.open = {}), "lgdref", "LGD calibration reference (for reference)", [ref.root]);
      refFold.classList.add("card", "res-fold");
      root.replaceChildren(
        pageHead("FISCAL EXPOSURE", "Expected Fiscal Cost", "EFC = PD × EAD × LGD — PD from each SOE's own Z-EM-derived rating (20-band cohort table), EAD a share of total liabilities, LGD set by you. A triage-level estimate, not a budget forecast. This is where SOEs are added up: from each SOE's actual latest accounts, not under a shock."),
        H.strip,
        // settings on the left; on the right the two bar charts side by side with the EFC results under them;
        // the LGD calibration reference folded at the bottom (meeting 2026-10-30)
        el("div", { class: "grid" }, el("div", { class: "s4 sticky-panel" }, settings.root),
          el("div", { class: "s8 stack" }, el("div", { class: "grid efc-pair" }, el("div", { class: "s6" }, H.bar.root), el("div", { class: "s6" }, H.sens.root)), H.table.root)),
        el("div", { style: "margin-top:16px" }, refFold),
        el("div", { class: "foot" }, el("div", {}, el("b", {}, "Triage-level estimate. "), "PD is each SOE's own one-year PD from the rating cohort table — a placeholder pending probit-estimated probabilities. EAD is a proxy: a share of total liabilities.")));
    },
    render() {
      const st = S.efc, H = this.H;
      const view = F().filter((r) => r.Year === st.year);
      const res = view.map((r) => { const lgd = st.mode === "single" ? st.lgd : st.per[r.Entity] ?? st.lgd; return Object.assign({ r, lgd }, E.efcRow(r, lgd, st.ead, st.basis)); }).sort((a, b) => (b.EFC || 0) - (a.EFC || 0));
      const eadShort = (x) => (x.EAD_source.startsWith("Observed") ? "guaranteed debt" : `${pct0(st.ead)} of liabilities`);
      const total = sum(res.map((x) => x.EFC)), g = S.gdp;
      const top = res[0], top3 = sum(res.slice(0, 3).map((x) => x.EFC));
      let gst = null;
      if (g) { const gg = total / g; gst = gg >= CFG.REPORT_EFC_GDP_ALERT ? "alert" : gg >= CFG.REPORT_EFC_GDP_WATCH ? "watch" : "ok"; }
      const eadTxt = st.basis === "guaranteed_debt" ? `EAD guaranteed debt for ${res.filter((x) => x.EAD_source.startsWith("Observed")).length}, else ${pct0(st.ead)} of liabilities` : `EAD ${pct0(st.ead)} of liabilities`;
      put(H.strip,
        tile("Aggregate EFC", null, null, money(total), CUR, `${st.year} · ${pl(res.length, "SOE")} · LGD ${st.mode === "single" ? st.lgd + "%" : "per SOE"} · ${eadTxt}`),
        tile("EFC / GDP", gst, gst ? STLABEL[gst] : null, g ? pctS(total / g) : "—", "", g ? `watch from ${pct(CFG.REPORT_EFC_GDP_WATCH, 1)}, alert from ${pct(CFG.REPORT_EFC_GDP_ALERT, 1)} (illustrative)` : "Enter GDP under Settings"),
        top ? tile("Largest exposure", zk(top.r.Zone), ZLABEL[zk(top.r.Zone)], money(top.EFC), CUR, `${top.r.Entity} · ${pct(total ? top.EFC / total : NaN, 0)} of the total · PD ${pctAuto(top.PD)}`) : null,
        res.length > 3 ? tile("Top-3 concentration", null, null, pct(total ? top3 / total : NaN, 0), "", `of EFC in ${res.slice(0, 3).map((x) => x.r.Entity).join(", ")}`) : null,
        countTile("SOEs in distress", res.filter((x) => x.r.Zone === "Distress").length, res.length, `Z-EM ≤ ${CFG.Z_DISTRESS_CUTOFF}, PD ${pctAuto(E.pdByRating("D"))} at rating D`));
      H.bar.head.querySelector(".sub") || H.bar.head.firstChild.appendChild(el("p", { class: "sub" }));
      H.bar.head.querySelector(".sub").textContent = `${st.year} · ${g ? "labels show share of GDP" : "labels show share of portfolio EFC"}` + (res.length > LIMIT ? ` · ${st.all ? "all " + res.length + " SOEs" : `the ${LIMIT} largest of ${res.length}`}` : "");
      hbars(H.bar.body.firstChild, clipRows(res, st.all).map((x) => ({
        label: x.r.Entity, sub: `${x.r.Rating} · PD ${pctAuto(x.PD)}`, s: slug(x.r.Sector), v: ok(x.EFC) ? x.EFC * SC : null, cls: "bar",
        lab: `${money(x.EFC)} · ${g ? pctS(x.EFC / g) : pct(total ? x.EFC / total : NaN, 0)}`, tipTitle: `${x.r.Entity} · ${x.r.Sector}`,
        tip: [[money(x.EFC, true), "expected fiscal cost"], [pctAuto(x.PD), `PD (${x.r.Rating})`], [money(x.EAD, true), `EAD (${eadShort(x)})`], [x.lgd + "%", "LGD"]],
      })), { tick: (t, s) => moneyTick(t / SC, s / SC), nTicks: 4 });
      H.bar.body.lastChild.replaceChildren(el("div", { class: "btn-row" }, moreToggle(res.length, st.all, (v) => { st.all = v; this.render(); }, `Show the ${LIMIT} largest only`),
        dataButtons(() => toCSV(["Entity", "Sector", "Zone", "Z_EM", "Rating", "PD", "EAD", "EAD_source", "LGD", "EFC"], res.map((x) => [x.r.Entity, x.r.Sector, x.r.Zone, x.r.Z_EM, x.r.Rating, x.PD, x.EAD, x.EAD_source, x.LGD, x.EFC])), `efc_${st.year}.csv`)));
      // backstop sensitivity
      const s = res.find((x) => x.r.Entity === st.sens) || res[0];
      if (s) {
        const sc = E.recoveryScenarios(s.r.Sector), pdMax = E.worstPdInZone(s.r.Zone), isD = s.r.Rating === "D";
        const [lgBox, chart, note] = H.sens.body.children;
        const recs = sc.map(([label, lgd]) => ({ label, lgd, efc: s.PD * s.EAD * lgd, max: pdMax * s.EAD * lgd }));
        lgBox.replaceChildren(legendRow([legendItem(LG.bar, `At own PD (${s.r.Rating}, ${pctAuto(s.PD)})`), isD ? null : legendItem(LG.max, `At zone max PD (${pctAuto(pdMax)})`), legendItem(LG.ref, `Current baseline, LGD ${s.lgd}%`)]));
        backstop(chart, recs, s.EFC, isD);
        const d = CFG.SECTOR_RECOVERY_DATA[s.r.Sector] || CFG.SECTOR_RECOVERY_DATA.Other;
        note.textContent = `From GEMs' 10th/25th/average/90th-percentile recovery rates for ${s.r.Sector} (source row: ${d.gems_source}, n = ${d.n_defaults} defaults). High backstop intensity means the government has historically absorbed more, so EFC rises from low to high. ` +
          (isD ? "Rated D, so own PD is already the maximum and the zone-max marker is left out. " : "Zone max PD is an interim placeholder pending a dedicated maximum-PD table. ") + "A static what-if on LGD, separate from the shock module.";
      }
      // meeting 2026-10-30: the score and the rating are already on the Distress Indicator, so the table keeps the
      // chance of default, the exposure, the cost as a share of GDP and each SOE's share of the portfolio
      H.table.head.querySelector(".sub") || H.table.head.firstChild.appendChild(el("p", { class: "sub" }));
      H.table.head.querySelector(".sub").textContent = `${st.year} · EFC = PD × EAD × LGD (LGD ${st.mode === "single" ? st.lgd + "%" : "per SOE"})` + (g ? "" : " · enter GDP under Settings to see EFC as a share of GDP");
      H.table.body.replaceChildren(simpleTable(["SOE", "Zone", "PD", `EAD${CUR ? " (" + CUR + ")" : ""}`, "EFC / GDP", "Share of portfolio EFC"],
        res.map((x) => [nameCell(x.r.Entity, x.r.Sector), el("td", {}, zoneChip(x.r.Zone)), pctAuto(x.PD), money(x.EAD), g ? pctS(x.EFC / g) : "—", pct(total ? x.EFC / total : NaN, 1)]),
        { right: (i) => i >= 2, tall: res.length > 15, foot: ["Portfolio", "", "", money(sum(res.map((x) => x.EAD))), g ? pctS(total / g) : "—", "100%"] }));
    },
  };
  function backstop(box, recs, current, isD) {
    const W = widthOf(box), L = 56, R = 10, T = 18, B = 44, H = Math.round(Math.min(280, Math.max(220, W * 0.5)));
    const vals = recs.flatMap((p) => [p.efc, isD ? null : p.max]).concat([current]).filter(ok).map((v) => v * SC);
    const sc = nice(0, Math.max(...vals, 1), 4), y = lin(sc.lo, sc.hi, H - B, T);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    for (const t of sc.ticks) { svgEl("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), class: t === 0 ? "axis-l" : "grid-l" }, svg); txt(svg, L - 6, y(t), moneyTick(t / SC, sc.step / SC), "t-muted num", "end", 11); }
    const band = (W - R - L) / recs.length, bw = Math.min(24, band * 0.4), short = ["Low · P10", "P25", "Average", "High · P90"];
    recs.forEach((p, i) => {
      const cx = L + band * i + band / 2, g = svgEl("g", { class: "row" }, svg);
      if (ok(p.efc)) { svgEl("path", { d: vbar(cx - bw / 2, y(0), y(p.efc * SC), bw), class: "bar" }, g); txt(g, cx - (isD ? 0 : 4), y(p.efc * SC) - 10, money(p.efc), "t-ink num", isD ? "middle" : "end", 11, 600); }
      if (!isD && ok(p.max)) svgEl("circle", { cx: cx + bw / 2 + 8, cy: y(p.max * SC), r: 5, class: "dot-max" }, g);
      txt(g, cx, H - B + 16, short[i], "t-ink2", "middle", 11.5, 600);
      txt(g, cx, H - B + 31, "LGD " + fmt(p.lgd * 100, 0) + "%", "t-muted num", "middle", 11);
      const hit = svgEl("rect", { x: cx - band / 2, y: T, width: band, height: H - B - T + 36, class: "hit", tabindex: 0, "aria-label": `${p.label} EFC ${money(p.efc)}` }, g);
      bindTip(hit, p.label, [[money(p.efc, true), "at own PD"], ...(isD ? [] : [[money(p.max, true), "at zone max PD"]]), [fmt(p.lgd * 100, 1) + "%", "government LGD"]]);
    });
    if (ok(current)) svgEl("line", { x1: L, x2: W - R, y1: y(current * SC), y2: y(current * SC), class: "ref-l" }, svg);
    box.replaceChildren(svg);
  }

  /* =====================================================================
     SHOCK SCENARIOS
     ===================================================================== */
  const pctSig = (v) => (v > 0 ? "+" : "") + fmt(v * 100, 0) + "%";
  // cash waterfall: tiers as listed in the order of payment (the residual is split between the SOE and junior creditors)
  const WF_TIER = { statutory: "Taxes, levies and operator fee", ipp: "IPPs", fuel: "Fuel and gas", debt: "Senior debt service", reserve: "Reserve account",
    om_floor: "SOE O&M floor", ops: "SOE's other own costs", junior: "Other suppliers, regulators, capex" };
  // the tiers shown in the order of payment: the floor, junior creditors and the reserve only when set
  const wfOrderItems = (q) => Object.keys(WF_TIER).filter((k) => (k !== "om_floor" || (q.om_floor_share || 0) > 0) && (k !== "junior" || (q.junior_share || 0) > 0) && (k !== "reserve" || (q.reserve_months || 0) > 0));
  const WF_TIER_SET = { statutory: "Rank: taxes, operator", ipp: "Rank: IPPs", fuel: "Rank: fuel and gas", debt: "Rank: debt service", reserve: "Rank: reserve", om_floor: "Rank: O&M floor", residual: "Rank: residual" };
  const WF_RULES = [["soe", "The SOE (own costs above the floor first)"], ["junior", "Junior creditors first"], ["pro_rata", "The SOE and junior creditors pro rata"], ["state", "The State pays it"]];
  const PD_METHODS = [["rating", "Rating bands (at most 40%)"], ["rating_tail", "Rating bands with a logistic tail (above 40%)"], ["logistic", "Logistic in Z-EM"], ["rating_smooth", "Rating-anchored curve (AAA floor, logistic tail below D; Monte Carlo default)"], ["user", "User-specified"]];
  // arrears columns by tier: [rank key, path column, short label]
  const WF_COLS = [["statutory", "Arrears to Statutory and Operator", "Taxes, operator"], ["ipp", "Arrears to IPPs", "IPPs"], ["fuel", "Arrears to Fuel Suppliers", "Fuel"], ["debt", "Missed Debt Service", "Debt service"],
    ["om_floor", "Arrears on O&M Floor", "O&M floor"], ["ops", "Arrears on Own Operations", "Own operations"], ["junior", "Arrears to Junior Creditors", "Junior creditors"]];
  const CSV_V2 = ["Arrears to Statutory and Operator", "Arrears on O&M Floor", "Arrears to Junior Creditors", "Debt Default", "State Shortfall Payment", "Cumulative State Shortfall Payment",
    "Late-payment Interest", "Waterfall Routed Share", "Tariff Gap Compensation Change", "Customer Arrears Change", "Customer Arrears"];
  /* Meeting 2026-10-26: the user first sees PD × EAD × LGD, then picks No shock / Standard stress / Custom shock; a
     custom shock is chosen from a drop-down and only that shock's controls show — its SIZE first, then the
     STRUCTURAL factors that decide how exposed the SOE is. The horizon applies to every shock, so it has its own
     block; analyst settings sit in folds. Texts for each shock type live in config.SHOCK_TYPES. */
  const SHOCK_T = Object.fromEntries((CFG.SHOCK_TYPES || []).map((t) => [t.id, t]));
  const SHOCK_ORDER = (CFG.SHOCK_TYPES || []).map((t) => t.id);
  const bpsF = (v) => (v > 0 ? "+" : "") + fmt(v, 0) + " bps";
  const rateF = (v) => fmt(v * 100, 1) + "%";
  const SIZE = {
    fuel: [["fuel_shock_pct", "Fuel price change", -0.5, 1, 0.01, pctSig, CFG.GLOSSARY["Fuel shock"] + " Negative means fuel gets cheaper. Ignored while a fuel price path is set (More fuel options)."]],
    fx: [["fx_shock_pct", "Fall in the local currency", -0.3, 1, 0.01, pctSig, CFG.GLOSSARY["FX shock"] + " Negative means the local currency strengthens."]],
    rates: [["rate_shock_bps", "Rise in interest rates (floating-rate debt)", -500, 1000, 25, bpsF, CFG.GLOSSARY["Interest rate shock"] + " Negative means rates fall."],
      ["refinancing_spread_bps", "Extra cost of refinancing debt coming due", -300, 1000, 25, bpsF, "Extra spread paid when debt that falls due soon is rolled over in stressed conditions: rollover risk, distinct from floating-rate repricing."]],
    revenue: [], // one % slider, built in sizeFields (stored as standard deviations of the SOE's own revenue growth)
    arrears: [["arrears_pct_of_revenue", "Government arrears written off (% of revenue a year)", 0, 0.5, 0.01, pct0, CFG.GLOSSARY["Government arrears"] + " Here: the amount written off in each shock year. It cannot exceed the SOE's receivables and other non-cash current assets."]],
  };
  const STRUCT = {
    fuel: [
      ["fuel_cost_share", "Fuel cost share of operating costs", 0, 1, 0.01, pct0, "What share of this SOE's operating costs is spent on fuel. Higher share = more exposed to a fuel price shock."],
      ["fuel_oil_linkage", "Share of the fuel bill that follows the oil price", 0, 1, 0.05, (v) => fmt(v, 2), "1 = all of it; below 1 when part of the fuel (e.g. coal) does not follow oil. For SENELEC 0.9 (coal is 35.7 of 494.9 bn of fuel purchases in 2022)."],
      ["tariff_passthrough", "Passed on to customers through tariffs", 0, 1, 0.05, pct0, CFG.GLOSSARY["Tariff pass-through"] + " Case B: customers pay this share of the fuel-cost change."],
      ["fuel_subsidy_share", "Compensated by the State", 0, 1, 0.05, pct0, "Case C: the government compensates this share of the fuel-cost change left after any tariff increase (for SENELEC, the gap between the regulator's allowed revenue (RMA) and tariff revenue). The SOE absorbs what customers and the State do not (Case A). When the compensation is actually paid: More fuel options."],
    ],
    fx: [
      ["fx_debt_share", "Share of debt in foreign currency", 0, 1, 0.05, pct0, "How the SOE is financed, e.g. 60% in foreign currency and 40% in local currency. A weaker local currency revalues the foreign part upward."],
      ["fx_cost_share", "Share of costs paid in foreign currency", 0, 1, 0.05, pct0, "Imported fuel, equipment or services paid in a foreign currency."],
      ["fx_revenue_share", "Share of revenue earned in foreign currency", 0, 1, 0.05, pct0, "If lower than the cost share, a weaker local currency hurts profit."],
    ],
    rates: [
      ["floating_debt_share", "Share of debt at floating rates", 0, 1, 0.05, pct0, "Debt whose interest rate moves with market rates."],
      ["near_term_maturity_share", "Share of debt coming due soon", 0, 1, 0.05, pct0, "Debt that has to be refinanced within the year (short-term loans, overdrafts, maturing bonds)."],
      ["new_debt_interest_rate", "Interest rate on new borrowing", 0, 0.2, 0.005, rateF, "Annual rate on the new debt that funds a cash gap; this year's new draw pays half a year. 0% = original model."],
      ["cash_gap_short_term_share", "Cash gaps funded short-term", 0, 1, 0.05, pct0, "Share of each cash shortfall funded by overdrafts, short-term loans or unpaid supplier bills (current liabilities). The rest becomes long-term debt. 0% = original model (current liabilities held flat)."],
    ],
    revenue: [["revenue_elasticity", "Share of lost revenue that reaches operating profit", 0, 2, 0.1, (v) => fmt(v, 1), "1.0 = every unit of lost revenue is lost profit (costs do not adjust). Below 1 when some costs fall with sales."]],
    arrears: [],
  };
  const FUEL_MORE = [
    ["tariff_increase_pct", "End-user tariff increase (policy)", 0, 0.3, 0.01, pctSig, "Option A = 0% (tariff freeze). Option B = +10% to +15%. Revenue rises by this share during the shock years; the rest of the fuel-cost change is then split between customers, the State and the SOE."],
    ["comp_paid_share", "State compensation paid in the same year", 0, 1, 0.05, pct0, "Share of this year's recognised compensation that arrives as cash in the same year. The rest becomes a receivable on the State. A payment delay of about 300 days is roughly 18% (1 − 300/365). 100% = original model."],
    ["comp_backlog_collected", "Unpaid compensation collected the next year", 0, 1, 0.05, pct0, "Share of the receivable at the start of a year that the Treasury pays during that year. 100% = every claim is settled within a year."],
    ["comp_provision_share", "Unpaid compensation treated as a loss", 0, 1, 0.05, pct0, "0% = keep the unpaid amount as a receivable (net income looks stable, cash does not). 100% = write it off as a loss."],
    ["vat_trapped_share", "Input VAT on extra fuel not recovered", 0, 1, 0.05, pct0, `Share of the input VAT on the extra fuel bill (rate ${pct0(CFG.DEFAULT_CASH_SETTINGS.vat_rate)}, set in config.py) that cannot be offset or refunded, e.g. because many sales are VAT-exempt.`],
  ];
  const CASH_FIN = [
    ["cash_buffer_share", "Cash drawn before borrowing", 0, 1, 0.05, pct0, "Share of each year's cash shortfall paid out of the SOE's own cash (the 'Cash and Equivalents' column) before it borrows, as the IMF SOE stress-test tool does. Inert when the file reports no cash."],
    ["cash_floor_opex_share", "Cash floor kept (share of operating costs)", 0, 0.3, 0.01, pct0, "Minimum cash the SOE keeps for operations; only cash above it is drawn. 0% = the whole balance can be used."],
    ["cash_gap_payables_share", "… of the short-term part, unpaid supplier bills", 0, 1, 0.05, pct0, "Part of the short-term funding (Interest rates shock: 'Cash gaps funded short-term') that comes from paying fuel suppliers and IPPs late instead of borrowing from banks. Carries no interest here."],
  ];
  const VIEW_NOTE = {
    single: "One SOE, one set of shock sizes, compared with the same SOE's no-shock path.",
    mc: "Many possible shock sizes around the ones you set, to see the range of expected fiscal cost (Monte Carlo).",
    macro: "One broad shock hits every SOE at once. The result is a ranking of the SOEs that would add most to the fiscal cost, not a sum of simultaneous failures.",
    backtest: "Start the model in a past year, let a shock hit, and compare the projected distress score with what actually happened (in-sample check).",
  };
  const HEALTH = { X1: "This year's bills", X2: "Savings", X3: "Operating profit", X4: "Equity cushion" };
  const HEALTH_S = { X1: "Bills", X2: "Savings", X3: "Profit", X4: "Cushion" };
  const WHY = { X1: "it is short of cash for this year's bills", X2: "past losses have eaten its savings", X3: "the business makes too little operating profit", X4: "its equity cushion is thin or negative" };
  const STRONG = { X1: "enough cash for this year's bills", X2: "savings built up over the years", X3: "a profitable business", X4: "a thick equity cushion" };
  /** plain reason for a zone: the one or two weakest weighted health checks */
  function distressWhy(r) {
    const c = ["X1", "X2", "X3", "X4"].map((k) => [k, r[k] * CFG.ZEM_COEFFICIENTS[k]]).filter(([, v]) => ok(v)).sort((a, b) => a[1] - b[1]);
    if (!c.length) return "";
    if (r.Zone === "Safe") return "strongest point: " + STRONG[c[c.length - 1][0]];
    const weak = c.filter(([, v]) => v < 0).slice(0, 2).map(([k]) => WHY[k]);
    return weak.length ? "mainly because " + weak.join(" and ") : "all four health checks are positive but small";
  }
  const zoneRank = (z) => ZORDER.indexOf(z); // 0 = Distress, 2 = Safe
  /** collapsible block that remembers whether it was open across rebuilds */
  function fold(store, key, summary, kids, onOpen) {
    const d = el("details", { class: "fold", open: store[key] ? true : null }, el("summary", {}, summary), ...kids);
    d.addEventListener("toggle", () => { store[key] = d.open; if (d.open && onOpen) onOpen(); });
    return d;
  }
  /** opens How it works at the shock-transmission chapter, on the given shock */
  function goHowShock(id) {
    S.how = S.how || {};
    if (id) S.how.shock = id;
    S.built.how = false; // the chapter's step texts depend on the shock
    goHow("hw-shocks");
  }
  /** seeded standard normal draws (mulberry32 + Box–Muller), for the macro shock */
  function normals(seed) {
    let a = seed >>> 0, spare = null;
    const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return () => {
      if (spare !== null) { const s0 = spare; spare = null; return s0; }
      let x = 0; while (x === 0) x = u();
      const y = u(), m = Math.sqrt(-2 * Math.log(x));
      spare = m * Math.sin(2 * Math.PI * y);
      return m * Math.cos(2 * Math.PI * y);
    };
  }
  /** waterfall (bridge) chart: a start bar, steps floating from the running total, an end bar.
   *  steps [{label, sub, v}]; opt {upBad, fmt (totals), fmtD (steps), yFmt, h} */
  function rankChart(box, items, opt = {}) {
    const W = widthOf(box), narrow = W < 520, L = narrow ? 110 : 190, R = narrow ? 64 : 96, T = 8, B = 28, rowH = 34;
    const vals = items.flatMap((d) => [d.lo, d.hi, d.med]).filter(ok);
    const sc = nice(Math.min(0, ...vals), Math.max(0, ...vals), Math.max(3, Math.min(6, Math.floor((W - L - R) / 80))));
    const x = lin(sc.lo, sc.hi, L, W - R);
    const Hh = T + items.length * rowH + B, pb = T + items.length * rowH;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh });
    for (const t of sc.ticks) { svgEl("line", { x1: x(t), x2: x(t), y1: T, y2: pb, class: t === 0 ? "zero-l" : "grid-l" }, svg); txt(svg, x(t), pb + 16, opt.tick ? opt.tick(t, sc.step) : tickLab(t, sc.step), "t-muted num", "middle", 11); }
    items.forEach((d, i) => {
      const cy = T + i * rowH + rowH / 2, g = svgEl("g", { class: "row" }, svg);
      txt(g, 0, cy - 7, clip(`${i + 1}. ${d.label}`, narrow ? 14 : 26), "t-head", "start", 12.5, 700);
      txt(g, 0, cy + 9, clip(d.sub, narrow ? 16 : 30), "t-muted", "start", 10.5);
      if (ok(d.lo) && ok(d.hi)) svgEl("line", { x1: x(d.lo), x2: x(d.hi), y1: cy, y2: cy, class: "rk-whisk" }, g);
      if (ok(d.med)) { svgEl("circle", { cx: x(d.med), cy, r: 6, class: i < 3 ? "rk-dot top" : "rk-dot" }, g); txt(g, Math.min(W - R + 6, x(Math.max(d.hi, d.med)) + 8), cy, d.lab, "t-ink num", "start", 11.5, 700); }
      if (d.flag) txt(g, x(sc.lo) + 2, cy - 12, "⚠ check data", "t-crit", "start", 10, 700);
      const hit = svgEl("rect", { x: 0, y: cy - rowH / 2, width: W, height: rowH, class: "hit", tabindex: 0, "aria-label": `${d.label} ${d.lab}` }, g);
      bindTip(hit, d.label, d.tip || [[d.lab, ""]]);
      if (d.onPick) { hit.style.cursor = "pointer"; hit.addEventListener("click", d.onPick); hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); d.onPick(); } }); }
    });
    box.replaceChildren(svg);
  }
  const step = (n, title, sub) => el("div", { class: "step-h" }, el("span", { class: "step-n num" }, String(n)), el("div", {}, el("h3", {}, title), sub ? el("p", { class: "sub" }, sub) : null));
  pages.shock = {
    build(root) {
      const st = S.sh, H = (this.H = {});
      if (st.view === "all") st.view = "macro";
      st.open = st.open || {};
      if (!st.mode) st.mode = "none";
      if (!SHOCK_T[st.stype]) st.stype = SHOCK_ORDER[0];
      if (!S.names.includes(st.soe)) st.soe = S.names[0];
      const yrs = uniq(S.en.filter((r) => r.Entity === st.soe).map((r) => r.Year)).sort((a, b) => a - b);
      if (!yrs.includes(st.year)) st.year = last(yrs);
      const base = S.en.find((r) => r.Entity === st.soe && r.Year === st.year);
      const ekey = st.soe + "|" + st.year;
      if (st.expoFor !== ekey) { st.expoSrc = E.soeExposures(base); st.expo = expoFor(base); st.expoFor = ekey; }
      const [sig, fallback] = volFor(st.soe, base.Sector);
      this.sig = sig;
      H.fuelWarn = el("div");
      const view = st.view;

      /* 1. SOE and base year */
      const c1 = el("div", { class: "card top panel-card" }, step(1, view === "backtest" ? "SOE" : "SOE and base year"),
        el("div", { class: view === "backtest" ? "fields" : "fields two" }, fSelect("SOE", S.names, st.soe, (v) => { st.soe = v; st.year = null; rebuild(); }),
          view === "backtest" ? null : fSelect("Base year", yrs, st.year, (v) => { st.year = v; rebuild(); }, { num: true })),
        view === "backtest" ? null : el("p", { class: "note", style: "margin:8px 0 0" }, `Exposures start from ${st.soe}'s own data where the file has them, otherwise from sector defaults; the line under each slider says which. Revenue volatility ${pct(sig, 1)} (${fallback ? "sector default: fewer than 3 years of data" : "from its own history"}).`));
      /* 2. expected fiscal cost: the formula first, as asked */
      const nEfc = view === "macro" ? 1 : 2, nHor = view === "macro" ? 2 : 4;
      const c2 = el("div", { class: "card panel-card" }, step(nEfc, "Expected fiscal cost settings", "EFC = PD × EAD × LGD"),
        el("div", { class: "efc-formula", "aria-label": "Expected fiscal cost equals PD times EAD times LGD" },
          el("span", {}, el("b", {}, "PD"), "chance of distress, from the distress score"), el("i", {}, "×"),
          el("span", {}, el("b", {}, "EAD"), "how much is at stake"), el("i", {}, "×"),
          el("span", {}, el("b", {}, "LGD"), "share the government bears")),
        el("div", { class: "fields" },
          fSlider("LGD: share the government bears", { min: CFG.LGD_SLIDER_MIN, max: CFG.LGD_SLIDER_MAX, step: 1, value: st.lgd, fmt: (v) => v + "%", info: CFG.GLOSSARY.LGD }, (v) => { st.lgd = v; this.schedule(); }),
          fSlider("EAD: share of total liabilities at stake", { min: 0.5, max: 1, step: 0.1, value: st.ead, fmt: pct0, info: "Exposure at default as a share of the projected total liabilities. 60% and 80% are the sensitivity cases; 100% counts every liability (as if the government stands behind the whole SOE)." }, (v) => { st.ead = v; this.schedule(); }),
          el("p", { class: "note", style: "margin:0" }, el("b", {}, "PD "), view === "mc" ? "in Monte Carlo comes from a smooth curve through the rating steps." : "comes from the rating step of the projected distress score (method under Advanced settings)."),
          // meeting 2026-10-30: shown directly (no drop-down), so costs are read as a share of GDP straight away
          el("div", { class: "gdp-share" }, el("h4", { class: "gdp-share-h" }, "Show costs as a share of GDP"), el("div", { class: "fields" }, gdpField(() => this.schedule()),
            fSlider("Nominal GDP growth", { min: -0.05, max: 0.15, step: 0.005, value: S.growth, fmt: (v) => fmt(v * 100, 1) + "%/yr" }, (v) => { S.growth = v; this.schedule(); })))));
      /* 3. the shock */
      const c3 = el("div", { class: "card panel-card shock-card" }, step(3, "Shock", "Run no shock first, then the standard stress, then one shock at a time"),
        seg([["none", "No shock"], ["standard", "Standard stress"], ["custom", "Custom shock"]], st.mode, (v) => this.setMode(v), "Shock"),
        ...this.shockBody());
      /* 4. horizon: not a shock, it applies to all of them */
      const c4 = el("div", { class: "card panel-card" }, step(nHor, "Time horizon", "Applies to every shock"),
        el("div", { class: "fields" },
          fSlider("Years projected ahead", { min: 1, max: 7, step: 1, value: st.H, fmt: (v) => String(v), info: "How many years after the base year the accounts are rolled forward (a projection, not a forecast).", id: "sh-H" }, (v) => { st.H = v; st.D = Math.min(st.D, v); const d = $("#sh-D"); if (d) { d.max = v; d.value = st.D; d.dispatchEvent(new Event("input")); } this.schedule(); }),
          fSlider("Years the shock lasts", { min: 1, max: st.H, step: 1, value: Math.min(st.D, st.H), fmt: (v) => String(v), info: "How many of those years the shock is applied. After that it stops, but the extra debt and lost equity carry forward.", id: "sh-D" }, (v) => { st.D = v; this.schedule(); })));
      /* 5. analyst settings, folded */
      const adv = el("details", { class: "card panel-card adv", open: st.open.adv ? true : null },
        el("summary", {}, "Advanced settings (for analysts)", el("small", {}, "Cash financing · tariffs & collections · payment priority · PD method")),
        el("p", { class: "note" }, "Starting values come from the data or the documented defaults (Technical notes). Leave them unless you know why to change them."),
        fold(st.open, "cashfin", "How cash gaps are financed (all shocks)", [el("div", { class: "fields" }, ...CASH_FIN.map((d) => this.slider(d)))]),
        fold(st.open, "base", "Tariffs & collections (baseline, not a shock)", [el("div", { class: "fields" }, ...this.baseFields())]),
        fold(st.open, "wf", "Payment priority (cash waterfall), refinancing and borrowing cap", [el("div", { class: "fields" }, ...this.waterfallFields())]),
        fold(st.open, "pd", "Probability of default (PD) method", [el("div", { class: "fields" }, ...this.pdFields())]),
        el("div", { class: "presets", style: "margin-top:10px" }, el("button", { class: "btn-ghost", type: "button", onclick: () => { st.expoFor = null; rebuild(); } }, "Reset exposures to this SOE's data")));
      adv.addEventListener("toggle", () => { st.open.adv = adv.open; });
      const macroNote = el("div", { class: "card panel-card" }, el("h3", { style: "font-size:14px" }, "Portfolio macro shock"),
        el("p", { class: "note", style: "margin-top:6px" }, "Its two settings are on the right. Every SOE starts from its latest year and keeps its own exposures; the expected fiscal cost settings and the time horizon below still apply."));
      const btNote = el("div", { class: "card panel-card" }, el("h3", { style: "font-size:14px" }, "Model check"),
        el("p", { class: "note", style: "margin-top:6px" }, "The shock, the year it hits and its size are set on the right. The projection runs from the year before the shock to the last year in the data."));
      const panel = view === "macro" ? [macroNote, c2, c4] : view === "backtest" ? [c1, btNote, c2] : [c1, c2, c3, c4, adv];

      H.view = seg([["single", "One SOE"], ["mc", "Monte Carlo simulation"], ["macro", "Portfolio macro shock"], ["backtest", "Model check"]], view === "all" ? "macro" : view, (v) => { st.view = v; rebuild(); }, "View");
      H.desc = el("p", { class: "note", style: "margin:8px 0 0" });
      H.strip = statStrip();
      H.out = el("div", { class: "stack", style: "margin-top:16px" });
      root.replaceChildren(
        pageHead("DYNAMIC SIMULATION", "Shock Scenarios", "What could make an SOE's expected fiscal cost grow? Pick an SOE and a shock, and compare with the same SOE's no-shock path. Results are projections from the model, not forecasts.",
          el("button", { class: "btn", type: "button", onclick: () => goHowShock(st.mode === "custom" ? st.stype : null) }, "How a shock travels through the accounts →")),
        H.strip,
        el("div", { class: "grid" }, el("div", { class: "s4 sticky-panel shock-panel" }, el("div", { class: "stack panel-stack" }, ...panel)),
          el("div", { class: "s8" }, el("div", { class: "card" }, el("div", { class: "row-ctl" }, el("div", { class: "fld" }, el("span", { class: "lbl" }, "View"), H.view)), el("p", { class: "note view-note", style: "margin:6px 0 0" }, VIEW_NOTE[view] || ""), H.desc), H.out)),
        el("details", { class: "plain tech-notes" }, el("summary", {}, "Technical notes: how the shock engine works"), el("div", { class: "foot", style: "margin-top:8px" },
          el("div", {}, el("b", {}, "Simplifications. "), "Tax expense is held flat; net income carries the reported figure plus the shock's effect on EBIT and interest; any cash shortfall (losses, unpaid State compensation, trapped VAT) is paid first from the SOE's opening cash where the file reports it (above the floor), and the rest is borrowed — in current liabilities for the short-term share, otherwise as long-term debt; a later surplus repays short-term debt, then rebuilds the cash drawn; operating expense and revenue are held at base-year values. The government-arrears write-down is capped at the non-cash current assets left, so total assets never turn negative."),
          el("div", {}, el("b", {}, "Cash waterfall, refinancing and emergency support. "), "With the cash waterfall on (Advanced settings), the routed share of the SOE's cash (coverage × compliance × ramp-up) is paid out in the country order chosen there. The waterfall creates no cash: after the SOE's own cash, the routed shortfall is not borrowed but left unpaid from the lowest rank up — or paid by the State under that shortfall rule — as current liabilities that carry late-payment interest. Refinancing is a separate assumption. With a borrowing cap, new borrowing stops where total liabilities would pass that share of total assets and the government injects the rest as equity (emergency support, a direct budget cost)."),
          el("div", {}, el("b", {}, "Tariffs, collections and PD. "), "The cost-recovery ratio resets customer revenue to that share of full cost; the State compensates the share of the change set there. Uncollected customer bills become customer arrears, a current asset the SOE funds like any other cash gap. In single-SOE views PD follows the selected rating bands, logistic tail, full logistic, or user method; Monte Carlo and the portfolio macro shock use the rating-anchored PD curve for expected fiscal cost (PD × EAD × LGD) without drawing actual defaults."),
          el("div", {}, el("b", {}, "Fuel cost split. "), "The fuel-cost change is fuel share × oil linkage × operating expense × the fuel price shock (or the year's value of the fuel price path). A tariff increase is applied first. What is left is shared between customers (pass-through, Case B), the government (compensation share, Case C) and the SOE (the rest, Case A). Government compensation is recognised as revenue when due but arrives as cash only at the in-year paid share."),
          el("div", {}, el("b", {}, "Monte Carlo. "), "Fuel and FX shock sizes are drawn from a correlated normal distribution around the values set (with a fuel price path, fuel is drawn around the path's peak); the interest-rate and revenue shocks are drawn too when their standard deviation is above zero. Every other parameter stays at its value. The seed is fixed, so identical settings reproduce identical results."),
          el("div", {}, el("b", {}, "Portfolio macro shock and model check. "), "The macro shock applies the same revenue fall and borrowing-cost rise to every SOE, scaled by a common severity drawn from a lognormal distribution (mean 1), and ranks SOEs by the median rise in final-year expected fiscal cost against their own no-shock path. The model check projects from the year before the shock with the SOE's own exposures and compares the projected distress score with the accounts of the following years: an in-sample check, not a formal validation."))));
      this.fuelCheck();
      if (view === "single") this.buildSingle(); else if (view === "mc") this.buildMC(); else if (view === "macro") this.buildMacro(); else this.buildBack();
    },
    schedule() { clearTimeout(this._t); this._t = setTimeout(() => this.render(), ["mc", "macro"].includes(S.sh.view) ? 160 : 30); },
    /** one slider bound to a magnitude (st.mags) or an exposure / setting (st.expo), with its data source under it */
    slider([k, label, mn, mx, stp, f, help]) {
      const st = S.sh, src = st.expoSrc[k];
      const val = k in st.mags ? st.mags[k] : ok(st.expo[k]) ? st.expo[k] : CFG.DEFAULT_CASH_SETTINGS[k];
      return fSlider(label, { min: mn, max: mx, step: stp, value: val, fmt: f, info: help, id: "sh-" + k, help: src ? `Starts at ${f(src[0])} — ${src[1]}` : null },
        (v) => { if (k in st.mags) st.mags[k] = v; else st.expo[k] = v; this.fuelCheck(); this.schedule(); });
    },
    /** No shock / Standard stress / Custom: a custom shock starts from no shock, one type at a time */
    setMode(v) {
      const st = S.sh;
      st.mode = v;
      if (v === "standard") { Object.assign(st.mags, STD_MAG, { fuel_shock_path: [] }); st.D = Math.min(CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years, st.H); }
      else Object.assign(st.mags, ZERO_MAG, { fuel_shock_path: [] });
      rebuild();
    },
    /** chips for every shock size that is not zero; click to edit it, × to remove it */
    activeChips() {
      const st = S.sh, m = st.mags, items = [], sig = this.sig || 0;
      const add = (t, k, l) => items.push([t, k, l]);
      if ((m.fuel_shock_path || []).some((v) => v !== 0)) add("fuel", "fuel_shock_path", `Fuel path ${m.fuel_shock_path.map((v) => Math.round(v * 100)).join("/")}%`);
      else if (m.fuel_shock_pct) add("fuel", "fuel_shock_pct", `Fuel ${pctSig(m.fuel_shock_pct)}`);
      if (m.tariff_increase_pct) add("fuel", "tariff_increase_pct", `Tariff ${pctSig(m.tariff_increase_pct)}`);
      if (m.fx_shock_pct) add("fx", "fx_shock_pct", m.fx_shock_pct > 0 ? `Currency −${pct0(m.fx_shock_pct)}` : `Currency +${pct0(-m.fx_shock_pct)}`);
      if (m.rate_shock_bps) add("rates", "rate_shock_bps", `Rates ${bpsF(m.rate_shock_bps)}`);
      if (m.refinancing_spread_bps) add("rates", "refinancing_spread_bps", `Refinancing ${bpsF(m.refinancing_spread_bps)}`);
      if (m.revenue_shock_std_devs) add("revenue", "revenue_shock_std_devs", `Revenue ${pctSig(m.revenue_shock_std_devs * sig)}`);
      if (m.arrears_pct_of_revenue) add("arrears", "arrears_pct_of_revenue", `Arrears ${pct0(m.arrears_pct_of_revenue)} of revenue/yr`);
      return el("div", { class: "active-chips" }, el("span", { class: "chips-label" }, items.length ? "Active:" : "No shock set yet: choose a size below."),
        items.map(([t, k, l]) => el("span", { class: "achip" + (t === st.stype ? " on" : "") },
          el("button", { type: "button", class: "achip-go", title: "Edit this shock", onclick: () => { st.stype = t; rebuild(); } }, l),
          el("button", { type: "button", class: "achip-x", "aria-label": `Remove ${l}`, onclick: () => { if (k === "fuel_shock_path") st.mags.fuel_shock_path = []; else st.mags[k] = 0; rebuild(); } }, "×"))));
    },
    shockBody() {
      const st = S.sh, sig = this.sig || 0;
      if (st.mode === "none") return [el("p", { class: "note" }, "Baseline: the SOE's accounts rolled forward with nothing going wrong. Every shock is compared with this path.")];
      if (st.mode === "standard") {
        const m = STD_MAG;
        return [el("div", { class: "std-list" }, [
          ["Fuel", pctSig(m.fuel_shock_pct)], ["Currency", "−" + pct0(m.fx_shock_pct)], ["Interest rates", bpsF(m.rate_shock_bps)], ["Refinancing", bpsF(m.refinancing_spread_bps)],
          ["Revenue", `${sgn(m.revenue_shock_std_devs, 1)} s.d. (${pctSig(m.revenue_shock_std_devs * sig)})`], ["Arrears", pct0(m.arrears_pct_of_revenue) + " of revenue/yr"]].map(([a, b]) => el("span", {}, a, " ", el("b", {}, b)))),
          el("p", { class: "note" }, `All six shocks at once, for ${pl(Math.min(st.D, st.H), "year")}, at the tool's standard stress sizes. To change one size or test one shock alone, choose Custom shock.`)];
      }
      const t = SHOCK_T[st.stype];
      const out = [fSelect("Select shock type", SHOCK_ORDER.map((id) => [id, SHOCK_T[id].label]), st.stype, (v) => { st.stype = v; rebuild(); }, { id: "sh-stype" })];
      this.H.chips = el("div"); put(this.H.chips, this.activeChips()); out.push(this.H.chips);
      out.push(el("div", { class: "shock-info" },
        el("p", {}, el("b", {}, "What it is. "), t.what), el("p", {}, el("b", {}, "Who it hits. "), t.who),
        el("p", {}, el("b", {}, "Direction. "), t.direction), el("p", {}, el("b", {}, "Effect on the results. "), t.results),
        el("a", { href: "#view-how", onclick: (e) => { e.preventDefault(); goHowShock(t.id); } }, "How this shock travels through the accounts →")));
      // size first
      const g = t.guide || {}, key = t.key;
      const gLab = (v) => (st.stype === "rates" ? bpsF(v) : st.stype === "revenue" ? `${sgn(v, 1)} s.d. (${pctSig(v * sig)})` : st.stype === "arrears" ? pct0(v) : st.stype === "fx" ? "−" + pct0(v) : pctSig(v));
      const setG = (v) => { st.mags[key] = v; if (st.stype === "fuel") st.mags.fuel_shock_path = []; rebuild(); };
      out.push(el("div", { class: "blk-h" }, "1 · Size of the shock", info(CFG.SHOCK_SIZE_NOTE)),
        el("div", { class: "presets guide" }, el("span", { class: "chips-label" }, "Size guide:"),
          [["mild", "Mild"], ["standard", "Standard"], ["severe", "Severe"]].filter(([k]) => ok(g[k])).map(([k, l]) => el("button", { class: "btn-ghost", type: "button", title: `${l}: ${gLab(g[k])}`, "aria-pressed": String(st.mags[key] === g[k]), onclick: () => setG(g[k]) }, `${l} ${gLab(g[k])}`)),
          el("button", { class: "btn-ghost", type: "button", onclick: () => setG(0) }, "Off")));
      const sizes = st.stype === "revenue"
        ? [fSlider("Revenue change (% of revenue)", { min: -0.5, max: 0.2, step: 0.01, value: (st.mags.revenue_shock_std_devs || 0) * sig, id: "sh-revpct",
            fmt: (v) => `${pctSig(v)} · ${sig ? sgn(v / sig, 1) : "—"} s.d.`, info: "How much revenue falls in each shock year, for any reason. The tool also shows it in standard deviations (s.d.) of this SOE's own revenue growth; the DSA/DSF standard stress is −1 s.d." },
            (v) => { st.mags.revenue_shock_std_devs = sig ? v / sig : 0; this.schedule(); })]
        : SIZE[st.stype].map((d) => this.slider(d));
      out.push(el("div", { class: "fields" }, ...sizes));
      // then the structural factors
      const strc = STRUCT[st.stype];
      out.push(el("div", { class: "blk-h" }, "2 · Structural factors: how exposed this SOE is"),
        el("p", { class: "note", style: "margin:0 0 8px" }, strc.length ? "No data for this SOE? Leave them at their starting values and test how much the answer depends on them. If you have the data, add it to the upload file (or send it to the team)." : "None for this shock: its size is set relative to the SOE's revenue, and the write-off is capped by what the government actually owes."),
        strc.length ? el("div", { class: "fields" }, ...strc.map((d) => this.slider(d))) : null,
        el("p", { class: "muted data-hint" }, el("b", {}, "Data that sharpens this: "), t.data));
      if (st.stype === "fuel") {
        const oilPreset = () => {
          const { fuel_shock_pct, fuel_shock_path = [], ...ex } = CFG.OIL_SHOCK_PRESET;
          Object.assign(st.mags, ZERO_MAG, { fuel_shock_pct, fuel_shock_path: fuel_shock_path.slice() });
          Object.assign(st.expo, ex);
          st.H = Math.min(7, Math.max(st.H, 5, fuel_shock_path.length)); st.D = Math.min(st.D, st.H);
          rebuild();
        };
        const policy = (tu) => { st.mags.tariff_increase_pct = tu; Object.assign(st.expo, { tariff_passthrough: 0, fuel_subsidy_share: 1 }); rebuild(); };
        out.push(this.H.fuelWarn, fold(st.open, "fuelmore", "More fuel options: tariff policy, price path, State compensation", [
          el("div", { class: "fields" }, ...FUEL_MORE.map((d) => this.slider(d)), this.tariffBaseField(), this.pathField(),
            el("div", { class: "presets" }, el("span", { class: "chips-label" }, "Country case (Senegal):"),
              el("button", { class: "btn-ghost", type: "button", onclick: oilPreset }, `Oil ${pctSig(CFG.OIL_SHOCK_PRESET.fuel_shock_pct)} with delayed State payment`),
              el("button", { class: "btn-ghost", type: "button", onclick: () => policy(0) }, "Option A: tariff freeze"),
              el("button", { class: "btn-ghost", type: "button", onclick: () => policy(0.1) }, "Option B: +10%"),
              el("button", { class: "btn-ghost", type: "button", onclick: () => policy(0.15) }, "Option B: +15%")))]));
      }
      return out;
    },
    /** cash waterfall, refinancing and borrowing cap (Cash & financing tab) */
    waterfallFields() {
      const st = S.sh, e = st.expo, b = this.base();
      const std = b && ok(b["Short Term Debt"]) ? b["Short Term Debt"] : null;
      const rate = (v) => fmt(v * 100, 1) + "%";
      const months = (v) => (v > 0 ? `${fmt(v, 0)} month${v === 1 ? "" : "s"}` : "none");
      const baseNote = () => std !== null
        ? `Refinanced: ${pct0(e.refinance_share)} of the reported short-term debt (${money(std, true)}), at most the current liabilities.`
        : `No 'Short Term Debt' in the data — proxy: near-term maturity share ${pct0(e.near_term_maturity_share)} × total liabilities = ${money((e.near_term_maturity_share || 0) * (b ? b["Total Liabilities"] : NaN), true)}; ${pct0(e.refinance_share)} of it is refinanced.`;
      const hint = el("small", {}, baseNote());
      const on = (e.waterfall_on || 0) > 0;
      const orders = CFG.WATERFALL_ORDERS, okey = orders[e.waterfall_order] ? e.waterfall_order : "senelec_note", ord = orders[okey];
      const yr0 = Number(st.year);
      const orderList = el("ol", { class: "wf-order" });
      const drawOrder = () => {
        const rk = E.waterfallRanks(e), items = wfOrderItems(e);
        const groups = [...new Set(items.map((k) => rk[k]))].sort((x, y) => x - y);
        orderList.replaceChildren(...groups.map((g) => el("li", {}, items.filter((k) => rk[k] === g).map((k) => WF_TIER[k]).join(" = "))));
      };
      drawOrder();
      const rankBox = el("div", { class: "fields three" });
      if (okey === "custom") {
        const dflt = orders.senelec_note.ranks;
        rankBox.append(...CFG.WATERFALL_TIERS.map((k) => fSelect(WF_TIER_SET[k], [0, 1, 2, 3, 4, 5, 6], ok(e["rank_" + k]) ? e["rank_" + k] : dflt[k], (v) => { e["rank_" + k] = v; drawOrder(); this.schedule(); }, { num: true })));
      }
      rankBox.hidden = okey !== "custom";
      const ruleSel = fSelect("Who absorbs a shortfall", WF_RULES, e.shortfall_rule || "soe", (v) => { e.shortfall_rule = v; drawOrder(); this.schedule(); },
        { info: "What happens to the part of the year's cash need the routed cash cannot pay. The SOE: its own costs above the O&M floor go unpaid first (then the floor, then the ranks above). Junior creditors: other suppliers, regulators and capex first. Pro rata: the SOE and junior creditors share it. The State: a budget transfer pays it, so no tier goes unpaid — a direct fiscal cost, shown separately from EFC." });
      const sl2 = (label, k, mn, mx, step, f, help, after) => fSlider(label, { min: mn, max: mx, step, value: ok(e[k]) ? e[k] : CFG.DEFAULT_CASH_SETTINGS[k], fmt: f, id: "sh-" + k, info: help }, (v) => { e[k] = v; if (after) after(v); this.schedule(); });
      const head = (t, help) => el("div", { class: "lbl", style: "margin:6px 0 0" }, t, help ? info(help) : null);
      const wfBox = el("div", { class: "fields" },
        fSelect("Order of payment (country)", Object.entries(orders).map(([k, o]) => [k, o.label]), okey, (v) => {
          if (v === "custom") { const rk = E.waterfallRanks(e), cur = orders[okey].ranks || {}; CFG.WATERFALL_TIERS.forEach((t) => { e["rank_" + t] = t === "residual" ? (cur.residual ?? rk.junior) : rk[t]; }); }
          else if (orders[v].rule) e.shortfall_rule = orders[v].rule;
          e.waterfall_order = v; rebuild();
        }, { info: "The country's order of payment. Same number = pari passu: the tiers share the cash pro rata to their bills. Each preset sets its usual shortfall rule, which can be changed below." }),
        el("small", { class: "muted" }, ord.evidence),
        orderList, rankBox, ruleSel,
        el("p", { class: "note", style: "margin:0" }, "The waterfall decides who is paid, not how much cash there is: the routed cash is not borrowed, and its shortfall is left unpaid from the lowest rank up (or paid by the State). The borrowing split, rate and cap apply only to cash outside the waterfall."),
        head("Bills by tier", "How operating expense is split between the tiers. Fuel is the fuel share on the Fuel tab plus the fuel-cost change; debt service is the interest expense; the SOE's own costs are the rest of operating expense less depreciation."),
        sl2("IPP purchases, share of operating expense", "ipp_cost_share", 0, 0.8, 0.01, pct0, "Sizes the IPP tier. The SENELEC preset uses 17%: purchased electricity in 2022, an upper bound for IPPs alone.", drawOrder),
        sl2("Taxes, levies and operator fee, share of operating expense", "statutory_cost_share", 0, 0.3, 0.01, pct0, "Rank 0, paid first: statutory charges, levies and the operator's or collection agent's fee (in Côte d'Ivoire, the CIE remuneration; in Ghana, the statutory deductions). The reported tax expense is added to it."),
        sl2("O&M floor: protected share of the SOE's own costs", "om_floor_share", 0, 1, 0.05, pct0, "Share of the SOE's own operating costs guaranteed at the floor's rank, so that maintenance is not squeezed to zero. 0% = no floor: the SOE's own costs can go entirely unpaid.", drawOrder),
        sl2("Other suppliers, regulators and capex, share of own costs", "junior_share", 0, 1, 0.05, pct0, "The junior creditors in the residual tier. Whether they or the SOE take a shortfall first is the shortfall rule.", drawOrder),
        sl2("Reserve account target", "reserve_months", 0, 12, 1, (v) => (v > 0 ? `${fmt(v, 0)} month${v === 1 ? "" : "s"}` : "none"), "Months of IPP payments and debt service held in a reserve account, at its rank. Topped up from surpluses after the arrears ranked above it are paid, and drawn before the tiers ranked above it go unpaid. Held outside current assets. Use it only if the debt covenants or bond documents require one.", drawOrder),
        head("Adoption", "Coverage × compliance × ramp-up is the share of each year's cash that goes through the waterfall. The rest is handled as without it (cash drawn, then borrowed)."),
        sl2("Coverage: collections paid into the account", "waterfall_coverage", 0, 1, 0.05, pct0, "Which revenue enters the account: 100% = all collections; lower when only some customers pay into it."),
        sl2("Compliance: share of that cash actually routed", "waterfall_compliance", 0, 1, 0.05, pct0, "Imperfect adoption. The review suggests testing 60% to 100%; weak compliance is a common reason these mechanisms underdeliver."),
        sl2("Start year", "waterfall_start_year", 1, Math.max(1, st.H), 1, (v) => (ok(yr0) ? String(yr0 + v) : "year " + v), "First projection year in which the waterfall applies."),
        sl2("Ramp-up", "waterfall_rampup_months", 0, 36, 6, (v) => (v > 0 ? `${fmt(v, 0)} months` : "none"), "Phase-in: the routed share rises linearly to its full level over this many months from the start of the start year. The review suggests 12 to 24 months."),
        head("Cost of arrears", "Arrears outstanding at the start of a year carry this interest. It is added to the tier's bill and to interest expense, so who is left unpaid changes net income."),
        sl2("Late-payment interest: IPPs and fuel", "late_rate_priority", 0, 0.2, 0.005, rate, "Late-payment interest in the PPAs and fuel contracts. Placeholder: set from the contracts."),
        sl2("Default interest: missed debt service", "late_rate_debt", 0, 0.25, 0.005, rate, "Default interest on debt service not paid on time. Placeholder: set from the loan documents."),
        sl2("Late-payment interest: other tiers", "late_rate_other", 0, 0.2, 0.005, rate, "Taxes, the SOE's own costs, other suppliers and regulators."),
        el("div", { class: "fld" }, el("span", { class: "lbl" }, "Treat missed debt service as default (single-scenario sensitivity only)", info("On: a year that ends with debt service unpaid is rated D, and its PD is the PD on default set below the panel (100% by default). Off: the rating follows Z-EM only.")),
          seg([[0, "Off"], [1, "On"]], (ok(e.default_on_missed_debt) ? e.default_on_missed_debt : 0) > 0 ? 1 : 0, (v) => { e.default_on_missed_debt = v; this.schedule(); }, "Treat missed debt service as default (single-scenario sensitivity only)"),
          el("div", { class: "switch-effect-note", "data-debt-switch-note": "", role: "status", "aria-live": "polite" })),
        head("Behaviour", "Scenario parameters, not observed values: test them as sensitivities."),
        sl2("Supplier response: price cut for priority", "priority_discount", 0, 0.1, 0.005, rate, "Share of the IPP and fuel bills that priority creditors give back (lower prices or longer credit) in return for being paid first. Scales with the routed share. 0 = no response."),
        sl2("State response: extra compensation paid in-year", "state_paid_uplift", 0, 1, 0.05, (v) => (v > 0 ? "+" + pct0(v) : "none"), "Rise in the in-year paid share of State compensation while the waterfall is in force (times the routed share); +30% takes 60% to 90%. A waterfall can lock in payments but not the State's fiscal capacity, so 0 is the cautious case."),
        el("p", { class: "note", style: "margin:0" }, el("b", {}, "Moral hazard "), "(priority creditors monitoring less, junior stakeholders delaying investment) is not modelled directly: test it with lower compliance and a smaller O&M floor."));
      const sw = seg([[0, "Off"], [1, "On"]], on ? 1 : 0, (v) => { e.waterfall_on = v; rebuild(); }, "Cash waterfall"); // rebuild: the preset button shows the state too
      const wfNote = this.H.wfEffectNote = el("div", { class: "switch-effect-note", role: "status", "aria-live": "polite" });
      this.H.debtEffectNote = wfBox.querySelector("[data-debt-switch-note]");
      wfNote.textContent = on ? "Waterfall is ON. The indicator below explains which payment effects appear in this scenario." : "Waterfall is OFF: cash gaps follow ordinary cash-first financing / borrowing.";
      const refiBox = el("div", { class: "fields" },
        fSlider("Short-term bank debt refinanced", { min: 0, max: 1, step: 0.05, value: e.refinance_share || 0, fmt: pct0, id: "sh-refinance_share",
          info: CFG.GLOSSARY.Refinancing + " Replaced in the first projection year; it leaves current liabilities, so working capital (X1) improves, and total liabilities do not change. 0% = off." },
          (v) => { e.refinance_share = v; hint.textContent = baseNote(); this.schedule(); }),
        hint,
        fSlider("Overdraft rate (refinanced)", { min: 0, max: 0.2, step: 0.005, value: e.short_term_debt_rate, fmt: rate, id: "sh-short_term_debt_rate",
          info: "Interest rate the refinanced overdrafts pay today; the reported interest expense is assumed to include it. SENELEC note: 7.5–8.5%." }, (v) => { e.short_term_debt_rate = v; this.schedule(); }),
        fSlider("Long-term rate on refinanced debt", { min: 0, max: 0.2, step: 0.005, value: e.refinance_long_term_rate, fmt: rate, id: "sh-refinance_long_term_rate",
          info: "Rate on the long-term loans that replace the overdrafts. The difference with the overdraft rate is saved every year (negative if this rate is higher). Placeholder — set from the refinancing terms." },
          (v) => { e.refinance_long_term_rate = v; this.schedule(); }),
        fSlider("First year of refinancing", { min: 1, max: Math.max(1, st.H), step: 1, value: ok(e.refinance_start_year) ? e.refinance_start_year : 1, fmt: (v) => (ok(Number(st.year)) ? String(Number(st.year) + v) : "year " + v), id: "sh-refinance_start_year",
          info: "Lender response: refinancing takes a year or more to arrange. It happens in this year or later — in the first year whose previous-year rating meets the minimum below." }, (v) => { e.refinance_start_year = v; this.schedule(); }),
        fSelect("Minimum rating for refinancing", [["", "None"], ...CFG.Z_RATING_TABLE.map((r) => [r[2], r[2] + " or better"])], e.refinance_min_rating || "", (v) => { e.refinance_min_rating = v; this.schedule(); },
          { info: "Lenders refinance only once the SOE's rating (previous year, Z-EM based) reaches this level. None = no condition." }));
      return [
        el("hr", { class: "divider" }),
        el("div", { class: "fld" }, el("span", { class: "lbl" }, "Cash waterfall (priority of payments)", info(CFG.GLOSSARY["Cash waterfall"])), sw, wfNote),
        wfBox,
        el("hr", { class: "divider" }),
        el("div", { class: "fld" }, el("span", { class: "lbl" }, "Refinancing (separate assumption)", info(CFG.GLOSSARY.Refinancing))),
        refiBox,
        el("hr", { class: "divider" }),
        fSlider("Borrowing cap before emergency support", { min: 0, max: 1.5, step: 0.05, value: e.borrowing_cap_debt_to_assets || 0, fmt: (v) => (v > 0 ? fmt(v, 2) + " debt/assets" : "off"), id: "sh-borrowing_cap_debt_to_assets",
          info: CFG.GLOSSARY["Emergency support"] + " Set the ceiling as total liabilities / total assets (e.g. a covenant). 0 = off: the SOE can always borrow. Under the cash waterfall it applies only to the cash outside it." },
          (v) => { e.borrowing_cap_debt_to_assets = v; this.schedule(); }),
      ];
    },
    /** tariff level, the State receivable, collections and demand (Tariffs & collections tab) */
    baseFields() {
      const st = S.sh, e = st.expo, b = this.base();
      const g = b && ok(b[E.K.grants]) ? b[E.K.grants] : 0;
      const crr0 = b ? E.div(b[E.K.rev] - g, b[E.K.opex] + b[E.K.int]) : NaN;
      const sl2 = (label, k, mn, mx, step, f, help, after) => fSlider(label, { min: mn, max: mx, step, value: ok(e[k]) ? e[k] : CFG.DEFAULT_CASH_SETTINGS[k], fmt: f, id: "sh-" + k, info: help }, (v) => { e[k] = v; if (after) after(v); this.schedule(); });
      const head = (t, help) => el("div", { class: "lbl", style: "margin:6px 0 0" }, t, help ? info(help) : null);
      const blend = el("small", {});
      const showBlend = () => {
        const seg3 = [["households", "households"], ["large_private", "large private"], ["public", "public administrations"]];
        const w = seg3.reduce((a, [k]) => a + Math.max(0, e["share_" + k] || 0), 0);
        const c = w > 0 ? seg3.reduce((a, [k]) => a + Math.max(0, e["share_" + k] || 0) * Math.min(1, Math.max(0, e["collect_" + k] ?? 1)), 0) / w : 1;
        blend.textContent = `Blended collection rate ${pct(c, 1)} of billed sales (shares are weights and need not add up to 100%). ${c < 1 ? `${pct(1 - c, 1)} of each year's bills becomes customer arrears, a current asset the SOE has to fund.` : "100% = everything billed is collected (original model)."}`;
      };
      showBlend();
      return [
        el("p", { class: "note", style: "margin:0" }, "Baseline assumptions, the same with or without the waterfall. Fuel price and exchange rate are on the Fuel and FX tabs."),
        head("Tariff level"),
        sl2("Cost-recovery ratio (average tariff / full cost)", "cost_recovery_ratio", 0, 1.2, 0.01, (v) => (v > 0 ? pct0(v) : "as in the data"),
          `Customer revenue = this ratio × full cost (operating expense, including depreciation, plus interest). 0 = keep the data's tariff level: ${ok(crr0) ? pct(crr0, 1) : "—"} in ${st.year} (revenue less grants / operating expense + interest). The review suggests running 85% to 110%.`),
        el("small", {}, `In the data: ${ok(crr0) ? pct(crr0, 1) : "—"} (revenue less grants of ${money(b ? b[E.K.rev] - g : NaN, true)} / full cost ${money(b ? b[E.K.opex] + b[E.K.int] : NaN, true)}).`),
        sl2("State share of the tariff gap", "tariff_gap_state_share", 0, 1, 0.05, pct0, "Share of a change in the tariff gap that the State compensates (for SENELEC, the RMA compensation; 100% = the State covers the whole gap, 0% = the SOE absorbs it). The compensation is recognised in revenue and arrives as cash at the in-year paid share on the Cash & financing tab."),
        head("State compensation receivable", "The review: whether subsidy receivables from the State count as current assets, and whether they are collectible, can swing X1 more than anything the waterfall does."),
        sl2("Share counted in current assets (X1)", "receivable_current_share", 0, 1, 0.05, pct0, "Share of the unpaid State compensation counted as a current asset in working capital (X1) and the current ratio. 100% = all of it, collectible within a year. 0% = none: doubtful or long overdue, so it sits outside current assets. Collectibility over time is the 'collected the next year' setting on the Cash & financing tab."),
        head("Collection rates by customer segment", "Share of each year's bills each segment pays in the year. Public administrations are usually the weakest payers."),
        el("div", { class: "fields two" },
          sl2("Households: share of sales", "share_households", 0, 1, 0.05, pct0, "Weight of households in billed sales.", showBlend),
          sl2("Households: collected", "collect_households", 0, 1, 0.01, pct0, "Share of household bills paid in the year.", showBlend),
          sl2("Large private customers: share", "share_large_private", 0, 1, 0.05, pct0, "Weight of large private customers in billed sales.", showBlend),
          sl2("Large private: collected", "collect_large_private", 0, 1, 0.01, pct0, "Share of large private customers' bills paid in the year.", showBlend),
          sl2("Public administrations: share", "share_public", 0, 1, 0.05, pct0, "Weight of public administrations in billed sales.", showBlend),
          sl2("Public administrations: collected", "collect_public", 0, 1, 0.01, pct0, "Share of public administrations' bills paid in the year.", showBlend)),
        blend,
        sl2("Customer arrears collected the next year", "customer_arrears_collected", 0, 1, 0.05, pct0, "Share of the customer arrears at the start of a year collected during it."),
        head("Demand and losses"),
        sl2("Demand growth", "demand_growth", -0.05, 0.1, 0.005, (v) => (v ? sgn(v * 100, 1) + "%/yr" : "none"), "Sales and cash operating costs grow together each year, and the margin before depreciation grows with them. 0 = held at base-year values (original model)."),
        sl2("Rise in network losses", "losses_change", 0, 0.1, 0.005, (v) => (v ? "+" + fmt(v * 100, 1) + "% of sales" : "none"), "Extra technical and commercial losses: this share of customer revenue is lost at the same cost."),
      ];
    },
    /** probability of default: method, parameters and the PD on a missed debt payment (below LGD / EAD) */
    pdFields() {
      // Avoid offering deterministic rating/default controls while the user is viewing
      // Monte Carlo: those controls do not affect its rating-anchored EFC-only model.
      if (S.sh.view === "mc") return [el("div", {class:"mc-pd-side-note"},
        el("b",{},"Monte Carlo PD: rating-anchored"),
        el("small",{},"Uses each simulated Z-EM on a smooth curve through the rating band PDs (40% at Z-EM −1.5, rising along a logistic tail below it; floored at 0.02% at 4.9 and above); no realised-default draws. The single logistic is shown as a sensitivity."))];
      const e = S.sh.expo, m = e.pd_method || "rating";
      const ex = el("small", {});
      const showEx = () => {
        const zs = [-1.5, -3, -5, -7];
        ex.textContent = "PD at Z-EM " + zs.map((z) => `${fmt(z, 1)}: ${pctAuto(E.pdValue(z, E.zRating(z), false, e))}`).join(" · ") + ". Cumulative over the horizon: 1 − Π(1 − PDₜ).";
      };
      showEx();
      const sl2 = (label, k, mn, mx, step, f, help) => fSlider(label, { min: mn, max: mx, step, value: ok(e[k]) ? e[k] : CFG.DEFAULT_CASH_SETTINGS[k], fmt: f, id: "sh-" + k, info: help }, (v) => { e[k] = v; showEx(); this.schedule(); });
      return [
        fSelect("Probability of default (PD)", PD_METHODS, m, (v) => { e.pd_method = v; rebuild(); },
          { info: "Rating bands: PD by Z-EM rating, at most 40% (rating D). Logistic tail: the same bands, but below the D threshold (Z-EM " + fmt(CFG.Z_RATING_TABLE[CFG.Z_RATING_TABLE.length - 1][1], 1) + ") PD keeps rising along a logistic curve from 40% towards 100%. Logistic: PD = 1 / (1 + e^−(a + b·Z)) for every Z. User: one PD for every year. This selector controls single-scenario views; Monte Carlo uses the rating-anchored PD curve (AAA floor, logistic tail below the D threshold) for expected fiscal cost." }),
        sl2("Logistic slope b", "pd_logit_b", -3, -0.2, 0.01, (v) => fmt(v, 2), "How fast PD rises as Z-EM falls (negative). Sets the logistic tail below the D threshold (single-scenario \"logistic tail\" and the Monte Carlo rating-anchored curve) and the single logistic sensitivity. Calibrated against the current illustrative rating table; update with observed defaults when available."),
        m === "logistic" ? sl2("Logistic intercept a", "pd_logit_a", -5, 1, 0.01, (v) => fmt(v, 2), "Log-odds of default at Z-EM = 0. Calibrated against the existing rating PD table; methodological details in docs/PD_CALIBRATION.md.") : null,
        m === "user" ? sl2("PD (every year)", "pd_user", 0, 1, 0.01, pctAuto, "A PD set by the user, applied to every projection year.") : null,
        el("div", { class: "fld" }, el("span", { class: "lbl" }, "PD in a year with debt service missed", info("Single-scenario views only: when debt service is unpaid, the year is rated D and its PD can be overridden. Monte Carlo uses its own PD curve with no override or actual default draws.")),
          seg([[1, "100%"], [0.4, "40%"]], (ok(e.pd_on_default) ? e.pd_on_default : 1) >= 1 ? 1 : 0.4, (v) => { e.pd_on_default = v; this.schedule(); }, "PD on default")),
        ex,
      ].filter(Boolean);
    },
    /** fuel price path: whole percents per projection year, e.g. "0, 60, 30"; blank = the step shock above */
    pathField() {
      const st = S.sh, id = "sh-fuel-path", y0 = st.year ?? "";
      const show = (a) => a.map((v) => String(Math.round(v * 100))).join(", ");
      const inp = el("input", { type: "text", id, inputmode: "numeric", placeholder: "e.g. 0, 60, 30 (blank = slider above)", value: show(st.mags.fuel_shock_path || []) });
      const hint = el("small", {});
      const note = (a) => {
        if (!a.length) return "Blank: the fuel price shock slider applies for the shock duration.";
        const yrs = a.map((v, i) => `${ok(Number(y0)) ? Number(y0) + i + 1 : "year " + (i + 1)} ${pctSig(v)}`).join(" · ");
        return `${yrs}. The fuel price slider is ignored; the tariff increase applies in the non-zero years.` + (a.length > st.H ? ` Only the first ${st.H} of ${a.length} years fall within the horizon.` : "");
      };
      hint.textContent = note(st.mags.fuel_shock_path || []);
      const upd = () => {
        const s = inp.value.trim(), parts = s ? s.split(/[\s,;]+/).filter(Boolean) : [];
        if (!parts.every((x) => /^[+-]?\d+$/.test(x)) || parts.some((x) => Number(x) < -50 || Number(x) > 100)) {
          hint.textContent = "Whole percents between −50 and 100, one per year, separated by commas (e.g. 0, 60, 30). Not applied."; return;
        }
        st.mags.fuel_shock_path = parts.map((x) => Number(x) / 100); // a new array every time
        hint.textContent = note(st.mags.fuel_shock_path);
        this.schedule();
      };
      inp.addEventListener("change", upd); inp.addEventListener("input", () => { clearTimeout(inp._t); inp._t = setTimeout(upd, 400); });
      return el("div", { class: "fld" }, el("label", { for: id }, el("span", {}, "Fuel price path (% per year)", info("Optional. One fuel price change per projection year, in whole percents, starting with the year after the base year — e.g. 0, 60, 30 = no change in year 1, +60% in year 2, +30% in year 3, nothing after. Replaces the fuel price slider for the fuel channel only; the other shocks keep the shock duration. The IMF SOE stress-test tool also uses an explicit annual oil price path."))), inp, hint);
    },
    /** base of the end-user tariff increase: all revenue, or revenue less government grants */
    tariffBaseField() {
      const st = S.sh;
      return el("div", { class: "fld" }, el("span", { class: "lbl" }, "Tariff increase applies to", info("All revenue, or revenue less the 'Government Grants' column. Use the second when State compensation for frozen tariffs is booked inside revenue (SENELEC: 214.7 bn of RMA compensation in 1,015.2 bn of 2024 revenue), so a tariff rise lifts customer sales only.")),
        seg([["revenue", "All revenue"], ["revenue_ex_grants", "Revenue less grants"]], st.expo.tariff_revenue_base || "revenue", (v) => { st.expo.tariff_revenue_base = v; this.schedule(); }, "Tariff increase base"));
    },
    fuelCheck() {
      const e = S.sh.expo, over = e.tariff_passthrough + e.fuel_subsidy_share > 1 + 1e-9;
      put(this.H.fuelWarn, over ? el("div", { class: "alert-box warn" }, `Pass-through (${pct0(e.tariff_passthrough)}) and subsidy (${pct0(e.fuel_subsidy_share)}) add up to more than 100% of the fuel-cost change. The SOE's share is floored at zero, and the government still pays its full subsidy share.`) : null);
    },
    base() { const st = S.sh; return S.en.find((r) => r.Entity === st.soe && r.Year === st.year); },
    params(mags) { const st = S.sh, b = this.base(); return paramsFor(b, mags || st.mags, st.expo, st.D, st.H); },
    buildSingle() {
      const H = this.H, st = S.sh;
      H.subsidy = el("div");
      // meeting 2026-10-30: the two paths come first (where the SOE would have been with no shock, and where it is with
      // the shock); "How the shock travels" is folded under them. The "what moved it" bridges, the cash / State
      // compensation section, the year-by-year tables and the payment-priority scenarios were removed from this view.
      H.trans = card(null);
      H.trans.body.append(el("div", { class: "btn-row", style: "justify-content:flex-end;margin-bottom:8px" },
        el("a", { class: "btn-ghost", href: "#view-how", onclick: (e) => { e.preventDefault(); goHowShock(st.mode === "custom" ? st.stype : null); } }, "Step by step →")), el("div"));
      H.z = card("Distress score path", "Shock against the no-shock path for the same SOE"); H.z.body.append(legendRow([legendItem(LG.str, "With the shock"), legendItem(LG.base, "No shock"), legendItem(LG.act, "Shock active"), legendItem(LG.grey, "Grey zone"), legendItem(LG.dist, "Distress zone")]), el("div", { class: "chart" }));
      H.e = card("Expected fiscal cost path", null); H.e.body.append(legendRow([legendItem(LG.str, "With the shock"), legendItem(LG.base, "No shock")]), el("div", { class: "chart" }));
      H.transFold = fold(st.open, "r-trans", "How the shock travels", [H.trans.root]);
      H.transFold.classList.add("card", "res-fold");
      H.out.replaceChildren(H.subsidy, el("div", { class: "grid" }, el("div", { class: "s6" }, H.z.root), el("div", { class: "s6" }, H.e.root)), H.transFold);
    },
    buildMacro() {
      const st = S.sh, H = this.H;
      const m = st.macro || (st.macro = { rev: 0.10, bps: 200, sev: 0.5, n: 300 });
      H.mac = card("Portfolio-wide macro shock", "One broad shock hits every SOE at once, as in a pandemic or a commodity slump. It is not named after a single cause: set how much revenue falls and how much borrowing costs rise.", null, "top");
      H.mac.body.append(el("div", { class: "fields three" },
        fSlider("Revenue fall for every SOE", { min: 0, max: 0.4, step: 0.01, value: m.rev, fmt: (v) => (v ? "−" + pct0(v) : "none"), info: "The fall in each SOE's revenue in every shock year, as a share of its revenue." }, (v) => { m.rev = v; this.schedule(); }),
        fSlider("Rise in borrowing costs", { min: 0, max: 600, step: 25, value: m.bps, fmt: (v) => (v ? bpsF(v) : "none"), info: "Applied to each SOE's floating-rate debt (its own share, or the default)." }, (v) => { m.bps = v; this.schedule(); }),
        fSlider("Uncertainty about the size", { min: 0, max: 1, step: 0.05, value: m.sev, fmt: (v) => (v ? "±" + pct0(v) : "none: one run"), info: `The severity is drawn ${m.n} times (Monte Carlo) around the sizes set: the same draw hits every SOE, so they move together. 0 = one deterministic run.` }, (v) => { m.sev = v; this.schedule(); })));
      H.rank = card("Which SOEs would add most to the fiscal cost", null);
      H.rank.body.append(el("div", { class: "chart" }));
      H.rankTbl = el("div");
      H.macNote = el("div");
      H.out.replaceChildren(H.mac.root, H.rank.root, H.rankTbl, H.macNote);
    },
    buildBack() {
      const st = S.sh, H = this.H;
      const bt = st.bt || (st.bt = { year: null, type: "revenue", size: { revenue: -0.10, fuel: 0.25, fx: 0.30, rates: 200, none: 0 }, dur: 1 });
      const yrs = uniq(S.en.filter((r) => r.Entity === st.soe).map((r) => r.Year)).sort((a, b) => a - b);
      const cands = yrs.filter((y) => yrs.includes(y - 1));
      if (!cands.includes(bt.year)) bt.year = cands.includes(2020) ? 2020 : cands[0] ?? null;
      H.bt = card("Model check: does the projection follow what happened?", "Start the model in the year before a known shock, let the shock hit, and compare the projected distress score with the score in the accounts of the following years. A model that tracks the past reasonably well can say something about the future.", null, "top");
      if (!cands.length) { H.bt.body.append(el("p", { class: "note" }, `${st.soe} has only one year of data. The check needs at least two consecutive years.`)); H.out.replaceChildren(H.bt.root); return; }
      const SZ = { revenue: [-0.5, 0.2, 0.01, (v) => pctSig(v), "Revenue change"], fuel: [-0.5, 1, 0.01, pctSig, "Fuel price change"], fx: [-0.3, 1, 0.01, pctSig, "Fall in the local currency"], rates: [-500, 1000, 25, bpsF, "Rise in interest rates"] };
      const ctl = el("div", { class: "fields three" },
        fSelect("Shock hits in", cands, bt.year, (v) => { bt.year = v; this.render(); }, { num: true, info: "The projection starts from the accounts of the year before. Example: COVID-19 hit in 2020, so the model starts from 2019." }),
        fSelect("Shock", [["revenue", "Revenue fall (COVID-like)"], ["fuel", "Fuel price"], ["fx", "Currency fall"], ["rates", "Interest rates"], ["none", "No shock: pure projection"]], bt.type, (v) => { bt.type = v; rebuild(); }),
        bt.type === "none" ? el("div") : fSlider(SZ[bt.type][4], { min: SZ[bt.type][0], max: SZ[bt.type][1], step: SZ[bt.type][2], value: bt.size[bt.type], fmt: SZ[bt.type][3] }, (v) => { bt.size[bt.type] = v; this.schedule(); }),
        fSlider("Shock lasts", { min: 1, max: 3, step: 1, value: bt.dur, fmt: (v) => pl(v, "year") }, (v) => { bt.dur = v; this.schedule(); }));
      H.bt.body.append(ctl);
      H.btChart = card(null); H.btChart.body.append(legendRow([legendItem('<svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" class="ln"/></svg>', "Actual (from the accounts)"), legendItem(LG.str, "Model with the shock"), legendItem(LG.base, "Model, no shock"), legendItem(LG.act, "Shock active"), legendItem(LG.grey, "Grey zone"), legendItem(LG.dist, "Distress zone")]), el("div", { class: "chart" }));
      H.btRead = el("div");
      H.btAll = card("The same check for every SOE", "Same shock, same year · sorted by the average gap");
      H.out.replaceChildren(H.bt.root, H.btChart.root, H.btRead, H.btAll.root);
    },
    drawPDCalibration(p) {
      const H = this.H, a = p.pd_logit_a, b = p.pd_logit_b;
      const pred = (z) => E.pdValue(z, E.zRating(z), false, {pd_method:"logistic",pd_logit_a:a,pd_logit_b:b});
      const rating = (z) => E.pdValue(z, E.zRating(z), false, {pd_method:"rating"});
      const zw = [-4,-3,-2,-1,0,1,2,3,4,5], xlo=-5, xhi=5, W=720, ht=244, L=55, R=22, T=14, B=35;
      const x=(z)=>L+(z-xlo)/(xhi-xlo)*(W-L-R), y=(pd)=>ht-B-pd*(ht-B-T);
      const svg=svgEl("svg",{viewBox:`0 0 ${W} ${ht}`,width:"100%",role:"img", "aria-label":"Rating-anchored PD is continuous, floored at the AAA PD and rising along a logistic tail below the D threshold, the single logistic is a sensitivity, and rating-band PD is a staircase with a 40 percent ceiling"});
      [0,.2,.4,.6,.8,1].forEach((v)=>{
        svgEl("line",{x1:L,x2:W-R,y1:y(v),y2:y(v),class:"grid-l"},svg);
        txt(svg,L-8,y(v),fmt(v*100,0)+"%","t-muted num","end",10.5);
      });
      zw.forEach(z=>txt(svg,x(z),ht-14,z.toString(),"t-muted num","middle",10.5));
      const pts=[];for(let k=0;k<=250;k++){const z=xlo+k*(xhi-xlo)/250;pts.push((k?"L":"M")+x(z).toFixed(2)+","+y(pred(z)).toFixed(2));}
      svgEl("path",{d:pts.join(""),class:"pd-curve-logistic"},svg);
      const pts2=[];for(let k=0;k<=250;k++){const z=xlo+k*(xhi-xlo)/250;const v=E.pdValue(z,E.zRating(z),false,{pd_method:"rating_smooth",pd_logit_b:b});pts2.push((k?"L":"M")+x(z).toFixed(2)+","+y(v).toFixed(2));}
      svgEl("path",{d:pts2.join(""),class:"pd-curve-smooth"},svg);
      // A staircase, not a smoothed line: show that the prior rating approach has jumps.
      const boundaries=[xlo,...CFG.Z_RATING_TABLE.flatMap(v=>[v[0],v[1]]).filter(z=>ok(z)&&z>xlo&&z<xhi),xhi].filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>a-b);
      let d="";for(let i=0;i<boundaries.length-1;i++){
        const z0=boundaries[i],z1=boundaries[i+1],v=rating((z0+z1)/2),py=y(v);
        d+=(i===0?`M${x(z0)},${py}`:`V${py}`)+`H${x(z1)}`;
      }
      svgEl("path",{d,class:"pd-curve-rating"},svg);
      svgEl("line",{x1:L,x2:W-R,y1:y(.4),y2:y(.4),class:"pd-reference"},svg);
      txt(svg,W-R-4,y(.4)-8,"40% rating-band ceiling","t-muted","end",10);
      H.pdChart.replaceChildren(svg);
      const ratingAnchors = CFG.Z_RATING_TABLE.map(([lo,hi,name,ref]) => ({
        z: lo===null ? hi : hi===null ? lo : (lo+hi)/2,
        name, ref
      }));
      const errors = ratingAnchors.map(r=>Math.abs((pred(r.z)-r.ref)*100));
      const maxError=Math.max(...errors), mae=errors.reduce((a,b)=>a+b,0)/errors.length;
      const smooth=(z)=>E.pdValue(z,E.zRating(z),false,{pd_method:"rating_smooth",pd_logit_b:b});
      const smoothMax=Math.max(...ratingAnchors.map(r=>Math.abs((smooth(r.z)-r.ref)*100)));
      const zLo=ratingAnchors.reduce((m,r)=>Math.min(m,r.z),Infinity), zHi=ratingAnchors.reduce((m,r)=>Math.max(m,r.z),-Infinity);
      H.pdLead.textContent=`Monte Carlo PD: rating-anchored curve through the ${ratingAnchors.length} reference rating PDs (monotone interpolation of log-odds in Z-EM); ${smoothMax<1e-9?"exact at all "+ratingAnchors.length+" band centres":"maximum absolute difference at the band centres "+fmt(smoothMax,2)+" pp"}. Floored at ${pct(smooth(zHi+1),2)} above Z-EM ${fmt(zHi,1)}; below Z-EM ${fmt(zLo,1)} (the D threshold) PD keeps rising along a logistic tail from ${pct(smooth(zLo),0)} with slope b = ${fmt(b,3)} (${pct(smooth(zLo-1.5),0)} at Z-EM ${fmt(zLo-1.5,1)}). Sensitivity: single logistic PD = sigmoid(${fmt(a,5)} ${b<0?"−":"+"} ${fmt(Math.abs(b),5)} × Z-EM), minimax fit, maximum absolute difference ${fmt(maxError,2)} pp, mean ${fmt(mae,2)} pp. Reference PDs are illustrative; not validated against observed SOE defaults.`;
      H.pdTable.replaceChildren(simpleTable(["Rating","Representative Z-EM","Reference PD","Rating-anchored PD (Monte Carlo)","Logistic PD (sensitivity)","Logistic difference (pp)"],ratingAnchors.map(r=>[r.name,fmt(r.z,3),pct(r.ref,3),pct(smooth(r.z),3),pct(pred(r.z),3),sgn((pred(r.z)-r.ref)*100,3)]),{right:i=>i>0,cls:"compact"}));
    },
    buildMC() {
      const st = S.sh.mc, H = this.H;
      const LBL = { fuel: "Fuel", fx: "FX", rate: "Rate", revenue: "Revenue" };
      const corrBox = el("div", { class: "fields three" });
      const drawCorr = () => {
        const names = ["fuel", "fx"].concat(st.rsd > 0 ? ["rate"] : [], st.vsd > 0 ? ["revenue"] : []);
        const pairs = [];
        names.forEach((a, i) => names.slice(i + 1).forEach((b) => pairs.push([a, b])));
        corrBox.replaceChildren(...pairs.map(([a, b]) => fSlider(`${LBL[a]}–${LBL[b]} correlation`, { min: -1, max: 1, step: 0.05, value: st.corr[`${a}|${b}`] ?? 0, fmt: (v) => fmt(v, 2),
          info: a === "fuel" && b === "fx" ? "Positive correlation reflects fuel and FX shocks often moving together." : "How the two shocks move together across draws. The set of correlations has to be internally consistent; the page says so if it is not." }, (v) => { st.corr[`${a}|${b}`] = v; this.schedule(); })));
      };
      const sdSlider = (label, key, o, info) => fSlider(label, Object.assign({ value: st[key], info }, o), (v) => { const was = st[key] > 0; st[key] = v; if (was !== v > 0) drawCorr(); this.schedule(); });
      const set = el("div", { class: "fields two" },
        fSlider("Simulations", { min: 100, max: 10000, step: 100, value: st.n, fmt: (v) => v.toLocaleString("en-US"), info: "How many random shock draws to run." }, (v) => { st.n = v; this.schedule(); }),
        el("div"),
        sdSlider("Fuel shock std. dev.", "fsd", { min: 0.01, max: 0.3, step: 0.01, fmt: pct0 }, "Spread of the fuel shock across simulations, centred on the Fuel slider."),
        sdSlider("FX shock std. dev.", "xsd", { min: 0.01, max: 0.3, step: 0.01, fmt: pct0 }, "Spread of the FX shock across simulations, centred on the FX slider."),
        sdSlider("Interest-rate shock std. dev.", "rsd", { min: 0, max: 500, step: 25, fmt: (v) => (v ? fmt(v, 0) + " bps" : "off") }, "Spread of the interest-rate shock, centred on the rate slider. 0 = not drawn (held at the slider value)."),
        sdSlider("Revenue shock std. dev.", "vsd", { min: 0, max: 2, step: 0.1, fmt: (v) => (v ? fmt(v, 1) + " s.d." : "off") }, "Spread of the revenue shock in standard deviations of this SOE's own revenue growth, centred on the revenue slider. 0 = not drawn."));
      drawCorr();
      H.pdLead = el("p", {class:"note",style:"margin:0 0 12px"});
      H.pdChart = el("div",{class:"pd-comparison-chart"});
      H.pdTable = el("div");
      H.pdSensitivity=el("div",{class:"mc-sensitivity"});
      const more = el("details",{class:"mc-advanced"},
        el("summary",{},"Rating PD comparison and calibration details"),
        H.pdChart,
        el("div",{class:"pd-chart-legend"},el("span",{class:"legend-key pd-smooth-key"},"Rating-anchored (Monte Carlo)"),el("span",{class:"legend-key pd-logistic-key"},"Single logistic (sensitivity)"),el("span",{class:"legend-key pd-rating-key"},"Rating band steps (deterministic)")),
        H.pdTable,
        el("p",{class:"note"},"Sensitivity: the two-parameter logistic is fitted by minimizing the largest absolute percentage-point gap across the 20 representative rating anchors, so it cannot reproduce every reference PD. Neither curve is fitted to real SOE default histories."));
      const pdBox=card("PD model · Monte Carlo", "Headline EFC uses the rating-anchored PD curve (floored at the AAA PD, rising logistic tail below the D threshold); the single logistic is shown as a sensitivity under identical shocks.");
      pdBox.body.append(el("div",{class:"mc-model-summary"},
        el("span",{class:"mc-pill"},"Rating-anchored · default"),el("span",{class:"mc-pill"},"EFC only"),
        el("span",{class:"mc-pill"},"No actual default draws")),H.pdLead,el("p",{class:"note",style:"margin:0 0 12px"},"Monte Carlo PD is interpolated in Z-EM between rating band centres: it equals the rating PD at each band centre, rises smoothly between them, and is floored at 0.02% above 4.9. Below Z-EM −1.5 (the D threshold) PD keeps rising along a logistic tail from 40% with slope b (the logistic slope b used by the single logistic). Deterministic tabs use the rating band PD."),H.pdSensitivity,more);
      H.pdModel=pdBox;
      H.mcnote = el("p", { class: "note" });
      H.mcerr = el("div");
      const c = card("Monte Carlo settings", "Expand to adjust the simulation count, shock volatility and correlations", null);
      const settingsPanel = el("details", { class: "mc-settings-accordion" },
        el("summary", {}, el("span", {class: "mc-settings-toggle"}, "Monte Carlo settings"),
          el("small", {}, "Simulations, standard deviations and correlations")),
        el("div", {class: "mc-settings-inner"}, set,
          el("div", { class: "lbl", style: "margin:12px 0 6px" }, "Correlations between simulated shocks"), corrBox));
      c.body.append(settingsPanel,H.mcnote,H.mcerr);
      H.zh = card("Z-EM distribution (final year)"); H.zh.body.append(legendRow([legendItem(LG.thrC, `Distress (${CFG.Z_DISTRESS_CUTOFF})`), legendItem(LG.thrW, `Safe (${CFG.Z_SAFE_CUTOFF})`)]), el("div", { class: "chart" }));
      H.zd = card("Zone distribution across simulations"); H.zd.body.append(el("div"));
      H.eh = card("Expected fiscal cost distribution (final year)"); H.eh.body.append(el("div", { class: "chart" }));
      H.fan = card("Expected fiscal cost — percentile path", "Y-axis is auto-scaled to projected values (not necessarily from zero) to show changes clearly."); H.fan.body.append(legendRow([legendItem(LG.med, "Median"), legendItem(LG.inner, "25th–75th"), legendItem(LG.outer, "5th–95th")]), el("div", { class: "chart" }));
      H.pt = card("Percentile summary · final year");
      H.mcCompare = card("PD model comparison", "Same simulated shocks, EAD and LGD · bars show P95 expected fiscal cost");
      // The model comparison belongs alongside the Monte Carlo output panels.
      H.pdSensitivity.remove();
      H.mcCompare.body.append(H.pdSensitivity);
      H.mcDashMeta = el("div", { class: "mc-dash-sub" });
      H.mcFocusBtn = el("button", { type: "button", class: "mc-focus-button", "aria-pressed": "false", onclick: () => {
        const layout = H.out.closest(".grid");
        if (!layout) return;
        const expanded = layout.classList.toggle("mc-focus-mode");
        H.mcFocusBtn.textContent = expanded ? "↙ Show scenario controls" : "⤢ Expand dashboard";
        H.mcFocusBtn.setAttribute("aria-pressed", String(expanded));
      } }, "⤢ Expand dashboard");
      const col = (cls, content) => el("div", { class: cls }, content);
      H.mcres = el("section", { class: "mc-dashboard", "aria-label": "Monte Carlo risk dashboard" },
        el("div", { class: "mc-dash-head" },
          el("div", {}, el("div", { class: "mc-dash-eyebrow" }, "MONTE CARLO · RISK OVERVIEW"),
            el("h3", {}, "Fiscal risk, at a glance"), H.mcDashMeta),
          el("div", { class: "mc-dash-actions" }, H.mcFocusBtn)),
        el("div", { class: "mc-dash-grid" },
          col("mc-col-main mc-fan-card", H.fan.root),
          col("mc-col-side mc-zone-card", H.zd.root),
          col("mc-col-half mc-efc-card", H.eh.root),
          col("mc-col-half mc-zem-card", H.zh.root),
          col("mc-col-half mc-compare-card", H.mcCompare.root),
          col("mc-col-half mc-percentiles-card", H.pt.root)),
        el("p", { class: "mc-dash-footnote" }, "P95 and median are percentiles of expected fiscal costs across simulated shock paths, not realised payouts. The PD calibration is illustrative."));
      H.out.replaceChildren(modelJourney(true), H.pdModel.root, c.root, H.mcres, modelNotes());
    },
    render() {
      const st = S.sh, H = this.H;
      if (st.view === "macro") { put(H.desc); this.renderMacro(S.gdp ? E.gdpPath(S.gdp, S.growth, st.H) : null); return; }
      if (st.view === "backtest") { put(H.desc); this.renderBack(); return; }
      const b = this.base();
      if (!b) return;
      const p = this.params(), gs = S.gdp ? E.gdpPath(S.gdp, S.growth, st.H) : null;
      if (H.chips) put(H.chips, this.activeChips());
      H.desc.replaceChildren(el("b", {}, "Active shocks: "), E.describeShocks(p) + ` · ${st.soe}, base year ${st.year}`);
      if (H.wfEffectNote || H.debtEffectNote) {
        const wfOn = (p.waterfall_on || 0) > 0;
        const debtOn = (p.default_on_missed_debt || 0) > 0;
        let debtMiss = false, unpaid = 0, routed = 0, maxZDiff = 0;
        if (st.view === "single" || wfOn) {
          const path = E.runScenario(b, p, st.H);
          debtMiss = path.some(r => (r["Missed Debt Service"] || 0) > 0);
          unpaid = path.reduce((a, r) => a + (r["Unpaid Under Waterfall"] || 0), 0);
          routed = Math.max(0, ...path.map(r => r["Waterfall Routed Share"] || 0));
          if (wfOn && st.view === "single") {
            const basePath = E.runScenario(b, { ...p, waterfall_on: 0 }, st.H);
            maxZDiff = Math.max(0, ...path.map((r, i) => Math.abs(r.Z_EM - basePath[i].Z_EM)));
          }
        }
        if (H.wfEffectNote) H.wfEffectNote.textContent = !wfOn
          ? "OFF · All cash gaps use normal cash-first financing and borrowing."
          : `ON · Routed cash up to ${pct0(routed)} in this scenario; unpaid waterfall bills: ${money(unpaid)}. ` +
            (routed === 0 ? "No cash is routed yet: check coverage, compliance and start year." :
             st.view === "single" && maxZDiff < 0.00001 ? "The distress score is unchanged: prioritising payments does not create new cash; check the arrears and creditor comparison." :
             "Its effect shows in the distress score and expected fiscal cost paths.");
        if (H.debtEffectNote) H.debtEffectNote.textContent = !debtOn
          ? "OFF · Missed debt service does not force a D rating or override single-SOE PD."
          : st.view === "mc" ? "ON · Single-SOE sensitivity only. Monte Carlo does not override its PD or sample realised defaults."
          : debtMiss ? "ON · At least one year has missed debt service: check the chance of distress."
          : "ON but no missed debt service occurs with these assumptions; the PD and EFC therefore stay unchanged.";
      }
      if (st.view === "single") this.renderSingle(b, p, gs);
      else this.renderMC(b, p, gs);
    },
    renderSingle(b, p, gs) {
      const st = S.sh, H = this.H;
      const p0 = this.params(ZERO_MAG);
      const path = E.costPath(E.runScenario(b, p, st.H), st.lgd, gs, st.ead, p), base = E.costPath(E.runScenario(b, p0, st.H), st.lgd, gs, st.ead, p0);
      const f = last(path), f0 = path[0], fb = last(base);
      const subT = sum(path.map((r) => r["Direct Fuel Subsidy"])), hasSub = !!p.fuel_subsidy_share;
      const fp = p.fuel_shock_path && p.fuel_shock_path.length ? p.fuel_shock_path.slice(0, st.H) : null, nYrs = fp ? fp.filter((v) => v !== 0).length : Math.min(st.D, st.H);
      put(H.subsidy, subT ? el("div", { class: "alert-box warn", style: "margin-bottom:0" }, el("span", {}, el("b", {}, `State fuel compensation: ${money(subT, true)} over ${pl(nYrs, "year")}`),
        subT > 0 ? ` — a budget outlay on top of the expected fiscal cost, because the government absorbs ${pct0(p.fuel_subsidy_share)} of the fuel-cost change (Case C).` : ` — negative: cheaper fuel lowers the ${pct0(p.fuel_subsidy_share)} share the government covers, a budget saving.`,
        gs ? ` That is ${pctS(subT / gs[1])} of year-1 GDP.` : ""), (() => { const sup = sum(path.map((r) => r["Emergency Support"])); return sup > 0 ? el("span", {}, el("br"), el("b", {}, `Emergency government support: ${money(sup, true)}`), ` — capital injected once the SOE hits its borrowing cap, also a budget outlay on top of the expected fiscal cost${gs ? ` (${pctS(sup / gs[1])} of year-1 GDP)` : ""}.`) : null; })()) : null);
      // headline: one distress indicator (zone and why), the expected fiscal cost, zone migration, chance of distress
      const zf = ZLABEL[zk(f.Zone)] || f.Zone, zb = ZLABEL[zk(fb.Zone)] || fb.Zone;
      const moves = zoneRank(f.Zone) - zoneRank(f0.Zone), movesVsBase = zoneRank(f.Zone) - zoneRank(fb.Zone);
      const migV = moves === 0 ? "No change" : moves < 0 ? `Down ${pl(-moves, "zone")}` : `Up ${pl(moves, "zone")}`;
      const cpd = E.cumulativePd(path.slice(1).map((r) => r.PD)), cpd0 = E.cumulativePd(base.slice(1).map((r) => r.PD));
      const dft = path.find((r) => r["Debt Default"] > 0);
      put(H.strip,
        tile(`Distress indicator, ${f["Calendar Year"]}`, zk(f.Zone), zf, zf, `score ${fmt(f.Z_EM, 2)}`,
          `${st.soe}: ${distressWhy(f)}. No shock: ${zb} (${fmt(fb.Z_EM, 2)}).`),
        tile(`Expected fiscal cost, ${f["Calendar Year"]}`, f.EFC > fb.EFC * 1.005 ? "watch" : null, f.EFC > fb.EFC * 1.005 ? "Rises" : null, money(f.EFC), CUR,
          `no shock ${money(fb.EFC)} · ${sgn(fb.EFC ? (f.EFC / fb.EFC - 1) * 100 : NaN, 0)}%` + (gs ? ` · ${pctS(f.EFC_GDP)} of GDP` : "")),
        tile("Zone migration", moves < 0 ? "alert" : movesVsBase < 0 ? "watch" : "ok", moves < 0 ? "Worse" : moves > 0 ? "Better" : "Same", migV, "",
          `${f0.Zone} in ${f0["Calendar Year"]} → ${f.Zone} in ${f["Calendar Year"]}` + (movesVsBase !== 0 ? ` (no shock: ${fb.Zone})` : "") + ". Zones: safe, grey, distress."),
        tile(`Chance of distress over ${pl(st.H, "year")}`, dft || cpd >= 0.5 ? "alert" : cpd > cpd0 + 1e-9 ? "watch" : null, dft ? "Default" : null, pctAuto(cpd), "",
          (dft ? `debt service missed in ${dft["Calendar Year"]}: rated D · ` : "") + `no shock ${pctAuto(cpd0)} · at least one year of distress, 1 − Π(1 − PD)`),
        hasSub ? tile("State compensation", subT > 0 ? "watch" : "ok", subT > 0 ? "Recognised" : "Saving", money(subT), CUR, `government share ${pct0(p.fuel_subsidy_share)} · ${pct0(p.comp_paid_share ?? 1)} paid in-year`) : null);
      // how the shock travels: the chain of results, shock against no shock
      const y1 = path[1] || f, b1 = base[1] || fb;
      const gapOf = (pp) => sum(pp.slice(1).map((r) => (r["Cash Funding Gap"] || 0) + (r["Cash Drawdown"] || 0) + (r["Unpaid Under Waterfall"] || 0) + (r["Emergency Support"] || 0)));
      const gS = gapOf(path), gB = gapOf(base);
      const dTxt = (d, fmtD, upBad) => { const z = Math.abs(d) < 1e-9 * (1 + Math.abs(d)); return [z ? "no change" : (d > 0 ? "+" : "−") + fmtD(Math.abs(d)), z ? "zero" : (d > 0) === upBad ? "bad" : "good"]; };
      const shockOn = MAGS.some((k) => (k === "fuel_shock_path" ? (st.mags[k] || []).some((v) => v !== 0) : (st.mags[k] || 0) !== 0));
      const steps = [
        ["Shock", !shockOn ? "none" : st.mode === "standard" ? "Standard stress" : clip(E.describeShocks(p).split(" · ")[0].replace(/ — active.*/, ""), 44), shockOn ? (st.mode === "standard" ? "all six shocks · " : "") + `${pl(nYrs, "year")} from ${f0["Calendar Year"] + 1}` : "baseline only", null],
        [`Operating profit, ${y1["Calendar Year"]}`, money(y1.EBIT), "vs no shock", dTxt(y1.EBIT - b1.EBIT, money, false)],
        [`Net income, ${y1["Calendar Year"]}`, money(y1["Net Income"]), "vs no shock", dTxt(y1["Net Income"] - b1["Net Income"], money, false)],
        ["Cash gap to fill, all years", money(gS), "vs no shock", dTxt(gS - gB, money, true)],
        [`Debt, ${f["Calendar Year"]}`, money(f["Total Liabilities"]), "vs no shock", dTxt(f["Total Liabilities"] - fb["Total Liabilities"], money, true)],
        [`Distress score, ${f["Calendar Year"]}`, `${fmt(f.Z_EM, 2)} · ${f.Zone}`, "vs no shock", dTxt(f.Z_EM - fb.Z_EM, (v) => fmt(v, 2), false)],
        [`Expected fiscal cost, ${f["Calendar Year"]}`, money(f.EFC, true), `PD ${pctAuto(f.PD)} · vs no shock`, dTxt(f.EFC - fb.EFC, money, true)],
      ];
      put(H.trans.body.lastChild, el("ol", { class: "trans" }, steps.map(([t, v, s0, d], i) => el("li", { class: "trans-step" + (i === 0 ? " is-shock" : "") + (d ? " d-" + d[1] : "") },
          el("span", { class: "trans-t" }, t), el("b", { class: "trans-v num" }, v), el("span", { class: "trans-d num" }, d ? d[0] : s0), d ? el("span", { class: "trans-s" }, s0) : null))),
        el("p", { class: "note" }, shockOn ? `Read left to right: the shock changes ${st.soe}'s accounts, the gap is borrowed, the health checks weaken and the expected fiscal cost moves. Every number is compared with the same SOE's no-shock path.` : "No shock is set: this is the no-shock path. Choose Standard stress or a Custom shock in step 3."));
      const xs = path.map((r) => r["Calendar Year"]);
      const tipRows = (i) => [[fmt(path[i].Z_EM, 2), `with the shock · ${path[i].Rating} · ${path[i].Zone}`], [fmt(base[i].Z_EM, 2), `no shock · ${base[i].Rating}`], [money(path[i].EFC), `EFC with the shock (no shock ${money(base[i].EFC)})`]];
      lines(H.z.body.lastChild, xs, [{ vals: base.map((r) => r.Z_EM), cls: "ln-base", dot: "prev", skipFirstDot: true, label: "No shock" }, { vals: path.map((r) => r.Z_EM), cls: "ln-str", dot: "now", label: "With the shock" }],
        { zones: true, active: [1, Math.min(st.D, st.H)], xLab: (i) => (i === 0 ? `${xs[i]} base` : String(xs[i])), tip: tipRows, tipTitle: (i) => `${st.soe} · ${xs[i]}`, endLabel: { series: 1, fmt: (v) => fmt(v, 2) } });
      const useG = !!gs, key = useG ? "EFC_GDP" : "EFC";
      H.e.head.querySelector("h3").textContent = useG ? "Expected fiscal cost / GDP — path" : `Expected fiscal cost path${CUR ? " (" + CUR + ")" : ""}`;
      const yF = useG ? (t) => pctS(t) : (t, s) => moneyTick(t, s);
      lines(H.e.body.lastChild, xs, [{ vals: base.map((r) => r[key]), cls: "ln-base", dot: "prev", skipFirstDot: true, label: "No shock" }, { vals: path.map((r) => r[key]), cls: "ln-str", dot: "now", label: "With the shock" }],
        { zeroFloor: true, yFmt: yF, L: 62, xLab: (i) => (i === 0 ? `${xs[i]} base` : String(xs[i])), tipTitle: (i) => `${st.soe} · ${xs[i]}`, tip: (i) => [[useG ? pctS(path[i][key]) : money(path[i][key]), `with the shock · PD ${pctAuto(path[i].PD)}`], [useG ? pctS(base[i][key]) : money(base[i][key]), "no shock"]], endLabel: { series: 1, fmt: (v) => (useG ? pctS(v) : money(v)) } });
    },
    renderMC(b, p, gs) {
      const st = S.sh, m = st.mc, H = this.H;
      this.drawPDCalibration(p);
      const fpk = p.fuel_shock_path && p.fuel_shock_path.length ? p.fuel_shock_path.reduce((a, v) => (Math.abs(v) > Math.abs(a) ? v : a), p.fuel_shock_path[0]) : null;
      H.mcnote.textContent = `PD model: rating-anchored curve (AAA floor, logistic tail below D; single logistic shown as a sensitivity). Mean shocks: fuel ${fpk === null ? pctSig(p.fuel_shock_pct) : pctSig(fpk) + " (peak of the path)"}, FX ${pctSig(p.fx_shock_pct)}` + (m.rsd > 0 ? `, interest rate ${sgn(p.rate_shock_bps, 0)} bps` : "") + (m.vsd > 0 ? `, revenue ${sgn(p.revenue_shock_std_devs, 2)} s.d.` : "") + `. EFC = PD × EAD × LGD in each simulated year; the distribution is across expected costs, not realized defaults.`;
      let sims;
      try {
        sims = E.monteCarlo(b, { ...p, mc_pd_method: "rating_smooth" }, { n: m.n, fuelSd: m.fsd, fxSd: m.xsd, rho: m.corr["fuel|fx"], rateSd: m.rsd, revSd: m.vsd, correlations: m.corr, H: st.H, lgd: st.lgd, gdp: gs, seed: 42, eadShare: st.ead });
      } catch (e) {
        H.mcerr.replaceChildren(el("div", { class: "alert-box warn", style: "margin-top:10px" }, e.message));
        H.mcres.hidden = true;
        put(H.strip);
        return;
      }
      H.mcerr.replaceChildren(); H.mcres.hidden = false;
      const fin = sims.map((s) => last(s.path));
      const q = (k, x) => E.quantile(fin.map((r) => r[k]), x);
      const modelOutcomes = [
        { name: "Rating-anchored (Monte Carlo)", med: q("EFC_Rating_Anchored", .5), p95: q("EFC_Rating_Anchored", .95), anchor: true },
        { name: "Single logistic (sensitivity)", med: q("EFC_Full_Logistic", .5), p95: q("EFC_Full_Logistic", .95), anchor: false }
      ];
      const maxP95 = Math.max(...modelOutcomes.map(x => x.p95), 0.000001);
      H.pdSensitivity.replaceChildren(
        el("div", { class: "mc-compare-list" }, ...modelOutcomes.map(x =>
          el("div", { class: "mc-compare-row" },
            el("div", { class: "mc-compare-name" }, el("span", {}, x.name), el("strong", {}, money(x.p95))),
            el("div", { class: "mc-compare-track", role: "img", "aria-label": `${x.name} P95 expected fiscal cost ${money(x.p95)}` },
              el("span", { class: x.anchor ? "anchored" : "", style: `width:${Math.max(0, Math.min(100, x.p95 / maxP95 * 100))}%` })),
            el("small", {}, `Median ${money(x.med)} · P95 ${money(x.p95)}`)))),
        el("p", { class: "note" }, "Both PD curves use the same simulated shock paths. Differences reflect the PD model, not different economic shocks."));
      H.mcDashMeta.textContent = `${st.soe} · ${m.n.toLocaleString("en-US")} simulations · ${last(fin)["Calendar Year"]} final year · Rating-anchored PD`;
      const p50 = q("EFC_Rating_Anchored", 0.5), p95 = q("EFC_Rating_Anchored", 0.95), dist = fin.filter((r) => r.Zone === "Distress").length / fin.length;
      const gF = gs ? last(gs) : null;
      put(H.strip,
        tile(`Median EFC, year ${st.H}`, null, null, money(p50), CUR, `${st.soe} · ${m.n.toLocaleString("en-US")} simulations`),
        tile("P95 of expected fiscal cost", null, null, money(p95), CUR, "Top 5% of shock paths have higher modelled EFC, not realised payout"),
        tile("Ending in distress", dist > 0.5 ? "alert" : dist > 0 ? "watch" : "ok", null, pct(dist, 0), "", `of simulations, Z-EM ≤ ${CFG.Z_DISTRESS_CUTOFF} in ${last(fin)["Calendar Year"]}`),
        tile("P95 expected fiscal cost / GDP", null, null, gF ? pctS(p95 / gF) : "—", "", gF ? `GDP in ${last(fin)["Calendar Year"]}: ${money(gF)}` : "Enter GDP in the panel"));
      histogram(H.zh.body.lastChild, fin.map((r) => r.Z_EM), { zones: true, vlines: [{ x: CFG.Z_DISTRESS_CUTOFF, cls: "thr-crit" }, { x: CFG.Z_SAFE_CUTOFF, cls: "thr-warn" }] });
      const zc = zoneCounts(fin);
      H.zd.body.firstChild.replaceChildren(el("div", { class: "hero", style: "gap:12px" }, el("div", { class: "hero-value", style: "font-size:40px" }, pct(dist, 0), el("small", {}, "of simulations end in distress")), ...zoneBar(zc, fin.length),
        el("p", { class: "note", style: "margin:0" }, `Median Z″ ${fmt(q("Z_EM", 0.5), 2)}; 5th percentile ${fmt(q("Z_EM", 0.05), 2)}.`)));
      histogram(H.eh.body.firstChild, fin.map((r) => r.EFC), { xFmt: (t, s) => moneyTick(t, s), vlines: [{ x: p95, cls: "thr-crit", label: "P95" }, { x: p50, cls: "ref-l" }] });
      const key = gs ? "EFC_GDP" : "EFC", pp = E.percentilePath(sims, key), xs = pp.map((r) => r.year);
      H.fan.head.querySelector("h3").textContent = gs ? "Expected fiscal cost / GDP — percentile path" : `Expected fiscal cost — percentile path${CUR ? " (" + CUR + ")" : ""}`;
      const f = gs ? (v) => pctS(v) : (v) => money(v);
      lines(H.fan.body.lastChild, xs, [{ vals: pp.map((r) => r.p50), cls: "ln-med", dot: "now", label: "Median" }],
        { band: [{ lo: pp.map((r) => r.p5), hi: pp.map((r) => r.p95), cls: "band-outer" }, { lo: pp.map((r) => r.p25), hi: pp.map((r) => r.p75), cls: "band-inner" }], zeroFloor: false, L: 70, yFmt: gs ? (t) => pctS(t) : (t, s) => moneyTick(t, s),
          tip: (i) => [[f(pp[i].p95), "95th"], [f(pp[i].p75), "75th"], [f(pp[i].p50), "median"], [f(pp[i].p25), "25th"], [f(pp[i].p5), "5th"]], xLab: (i) => (i === 0 ? `${xs[i]} base` : String(xs[i])) });
      H.pt.body.replaceChildren(simpleTable(["Percentile", "Z-EM", `EFC${CUR ? " (" + CUR + ")" : ""}`, ...(gF ? ["EFC / GDP"] : [])],
        [[0.05, "5th"], [0.25, "25th"], [0.5, "Median"], [0.75, "75th"], [0.95, "95th"]].map(([x, l]) => [l, fmt(q("Z_EM", x), 2), money(q("EFC", x)), ...(gF ? [pctS(q("EFC", x) / gF)] : [])]), { right: (i) => i >= 1 }),
        el("div", { style: "margin-top:10px" }, dataButtons(() => toCSV(["sim", "fuel_shock_pct", "fx_shock_pct", ...(m.rsd > 0 ? ["rate_shock_bps"] : []), ...(m.vsd > 0 ? ["revenue_shock_std_devs"] : []), "MC_PD_Model", "Z_EM_final", "Zone_final", "PD_final", "EAD_final", "EFC_final", "PD_Full_Logistic", "EFC_Full_Logistic", "PD_Rating_Anchored", "EFC_Rating_Anchored"],
          sims.map((s, i) => [i, s.fuel, s.fx, ...(m.rsd > 0 ? [s.draw.rate] : []), ...(m.vsd > 0 ? [s.draw.revenue] : []), last(s.path).MC_PD_Model, last(s.path).Z_EM, last(s.path).Zone, last(s.path).PD, last(s.path).EAD, last(s.path).EFC, last(s.path).PD_Full_Logistic,last(s.path).EFC_Full_Logistic,last(s.path).PD_Rating_Anchored,last(s.path).EFC_Rating_Anchored])), `monte_carlo_${st.soe}.csv`)));
    },
    /** portfolio macro shock: one common shock, many severities, every SOE's own exposures → a ranking of who adds most */
    renderMacro(gs) {
      const st = S.sh, H = this.H, m = st.macro;
      const rows = latestOf(S.en), D = Math.min(st.D, st.H), Hh = st.H, n = m.sev > 0 ? m.n : 1;
      const g = normals(20261026), ks = Array.from({ length: n }, () => (m.sev > 0 ? Math.exp(m.sev * g() - (m.sev * m.sev) / 2) : 1));
      const pdP = { pd_method: "rating_smooth" };
      const run = (r, ex, mags) => { const pp = Object.assign(paramsFor(r, mags, ex, D, Hh), pdP); return E.costPath(E.runScenario(r, pp, Hh), st.lgd, gs, st.ead, pp); };
      const res = rows.map((r) => {
        const ex = expoFor(r), sig = volFor(r.Entity, r.Sector)[0];
        const base = last(run(r, ex, ZERO_MAG));
        const out = ks.map((k) => {
          const f = last(run(r, ex, Object.assign({}, ZERO_MAG, { revenue_shock_std_devs: sig ? -(m.rev * k) / sig : 0, rate_shock_bps: m.bps * k })));
          return { de: (f.EFC || 0) - (base.EFC || 0), dz: f.Z_EM - base.Z_EM, drop: zoneRank(f.Zone) < zoneRank(base.Zone), zone: f.Zone, z: f.Z_EM };
        });
        const q = (key, x) => E.quantile(out.map((o) => o[key]), x);
        return { r, base, out, med: q("de", 0.5), lo: q("de", 0.05), hi: q("de", 0.95), dz: q("dz", 0.5), zMed: q("z", 0.5), drop: out.filter((o) => o.drop).length / out.length };
      });
      // how often each SOE is among the three largest in a draw
      const top3 = Object.fromEntries(res.map((x) => [x.r.Entity, 0]));
      ks.forEach((_, i) => res.map((x) => [x.r.Entity, x.out[i].de]).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([nm]) => { top3[nm]++; }));
      res.sort((a, b) => b.med - a.med);
      res.forEach((x) => { x.zone = E.classifyZone(x.zMed); });
      const tot = sum(res.map((x) => Math.max(0, x.med))), tl = sum(res.map((x) => x.r["Total Liabilities"]));
      res.forEach((x, i) => { x.share = tot ? Math.max(0, x.med) / tot : NaN; x.tlShare = tl ? x.r["Total Liabilities"] / tl : NaN; x.flag = i < 3 && x.tlShare < 0.05 && x.share > 0.15; });
      const top = res[0], t3 = sum(res.slice(0, 3).map((x) => Math.max(0, x.med)));
      const drops = res.filter((x) => x.drop >= 0.5);
      const fy = top ? last(run(top.r, expoFor(top.r), ZERO_MAG))["Calendar Year"] : "";
      put(H.strip,
        top ? tile("Adds most to the fiscal cost", "alert", "Rank 1", top.r.Entity, "", `${top.r.Sector} · ${pct(top.share, 0)} of the added cost · in the top three in ${pct(top3[top.r.Entity] / n, 0)} of draws`) : null,
        tile("Share of the three largest", null, null, pct(tot ? t3 / tot : NaN, 0), "", `of the added expected fiscal cost, median draw · ${res.slice(0, 3).map((x) => x.r.Entity).join(", ")}`),
        countTile("Drop a zone (median draw)", drops.length, res.length, drops.length ? drops.slice(0, 3).map((x) => x.r.Entity).join(", ") + (drops.length > 3 ? "…" : "") : "every SOE keeps its zone"),
        tile("Draws", null, null, n.toLocaleString("en-US"), "", m.sev > 0 ? `severity ±${pct0(m.sev)} around revenue −${pct0(m.rev)} and +${fmt(m.bps, 0)} bps` : "one run at the sizes set"));
      H.rank.head.querySelector("h3").textContent = "Which SOEs would add most to the fiscal cost";
      const sub = H.rank.head.querySelector(".sub") || H.rank.head.firstChild.appendChild(el("p", { class: "sub" }));
      sub.textContent = `Rise in expected fiscal cost in ${fy} against each SOE's own no-shock path · dot = median draw${n > 1 ? ", line = 5th to 95th percentile" : ""} · select an SOE to open it in One SOE`;
      const pick = (x) => () => {
        st.soe = x.r.Entity; st.year = x.r.Year; st.view = "single"; st.mode = "custom"; st.stype = "revenue";
        Object.assign(st.mags, ZERO_MAG, { fuel_shock_path: [], revenue_shock_std_devs: (() => { const sg = volFor(x.r.Entity, x.r.Sector)[0]; return sg ? -m.rev / sg : 0; })(), rate_shock_bps: m.bps });
        st.D = D; rebuild(); window.scrollTo({ top: 0 });
      };
      if (!H.rankMore) { H.rankMore = el("div", { class: "btn-row", style: "margin-top:8px" }); H.rank.body.appendChild(H.rankMore); }
      put(H.rankMore, moreToggle(res.length, !!m.all, (v) => { m.all = v; this.render(); }, `Show the ${LIMIT} largest only`));
      rankChart(H.rank.body.firstChild, (m.all ? res : res.slice(0, LIMIT)).map((x) => ({ label: x.r.Entity, sub: `${x.r.Sector} · ${x.base.Zone} → ${x.zone || ""}`.replace(/ → $/, ""), med: x.med, lo: n > 1 ? x.lo : x.med, hi: n > 1 ? x.hi : x.med, lab: (x.med >= 0 ? "+" : "−") + money(Math.abs(x.med)), flag: x.flag, onPick: pick(x),
        tip: [[(x.med >= 0 ? "+" : "−") + money(Math.abs(x.med), true), "median rise in expected fiscal cost"], ...(n > 1 ? [[`${money(x.lo)} to ${money(x.hi)}`, "5th to 95th percentile"]] : []), [pct(x.share, 0), "of the added cost"], [pct(top3[x.r.Entity] / n, 0), "of draws in the top three"], [`${fmt(x.base.Z_EM, 2)} → ${fmt(x.zMed, 2)}`, "distress score, no shock → shock"]] })),
        { tick: (t, s2) => moneyTick(t, s2) });
      const tbl = simpleTable(["Rank", "SOE", "Added EFC (median)", ...(n > 1 ? ["5th–95th percentile"] : []), "Share of added cost", "In top three", "Distress score: no shock → shock", "Zone drop", "Share of portfolio debt"],
        res.map((x, i) => [String(i + 1), el("td", { class: "name" }, el("span", { class: "nm" }, x.r.Entity), el("span", { class: "sec" }, x.r.Sector)), (x.med >= 0 ? "+" : "−") + money(Math.abs(x.med)), ...(n > 1 ? [`${money(x.lo)} to ${money(x.hi)}`] : []),
          pct(x.share, 0), pct(top3[x.r.Entity] / n, 0), `${fmt(x.base.Z_EM, 2)} → ${fmt(x.zMed, 2)}`, x.drop >= 0.5 ? stChip("alert", pct(x.drop, 0) + " of draws") : x.drop > 0 ? stChip("watch", pct(x.drop, 0) + " of draws") : stChip("none", "No"), el("td", {}, pct(x.tlShare, 0), x.flag ? el("span", { class: "flag", style: "margin-left:6px" }, "check data") : null)]),
        { cls: "compact", right: (i) => i >= 2 && i !== 6 });
      put(H.rankTbl, fold(st.open, "r-macro-tbl", "Ranking as a table, with downloads", [el("div", { class: "card" }, tbl, el("div", { style: "margin-top:10px" },
        dataButtons(() => toCSV(["rank", "Entity", "Sector", "base_year", "added_EFC_median", "added_EFC_p5", "added_EFC_p95", "share_of_added_cost", "share_of_draws_in_top3", "Z_no_shock", "Z_shock_median", "zone_drop_share_of_draws", "share_of_portfolio_liabilities"],
          res.map((x, i) => [i + 1, x.r.Entity, x.r.Sector, x.r.Year, x.med, x.lo, x.hi, x.share, top3[x.r.Entity] / n, x.base.Z_EM, x.zMed, x.drop, x.tlShare])), "portfolio_macro_shock_ranking.csv")))]));
      const flagged = res.filter((x) => x.flag);
      put(H.macNote, el("div", { class: "card" }, el("h3", { style: "font-size:14px;margin-bottom:6px" }, "How to read this"),
        el("ul", { class: "caveats" },
          el("li", {}, el("b", {}, "A ranking, not a total. "), "It is nearly impossible for all SOEs to fail at once, so the tool does not add up their costs under the same shock. The question is which SOEs drive the cost when a broad shock hits. The portfolio's expected fiscal cost from the latest accounts is on the ", go("efc", "Expected Fiscal Cost"), " tab."),
          el("li", {}, el("b", {}, "A check on the model too. "), "If an SOE that holds little of the portfolio's debt comes out on top, look at its data before drawing conclusions." + (flagged.length ? ` Flagged here: ${flagged.map((x) => `${x.r.Entity} (${pct(x.tlShare, 0)} of portfolio debt)`).join(", ")}.` : " No SOE is flagged.")),
          el("li", {}, el("b", {}, "Same shock, own exposures. "), `Every SOE gets the same revenue fall and borrowing-cost rise for ${pl(D, "year")} of ${Hh}, starting from its latest accounts; the rate rise works through its own floating-rate share. PD comes from the smooth curve used in Monte Carlo, so small changes count.`),
          el("li", {}, el("b", {}, "Next step. "), "Select an SOE to open it in One SOE with this shock, or test it in a deep dive (for power utilities, the energy-sector model)."))));
    },
    /** in-sample check: from the year before a known shock, does the projection follow the accounts? */
    renderBack() {
      const st = S.sh, H = this.H, bt = st.bt;
      if (!H.btChart) { put(H.strip); return; }
      const one = (soe) => {
        const rows = S.en.filter((r) => r.Entity === soe).sort((a, b) => a.Year - b.Year);
        const b0 = rows.find((r) => r.Year === bt.year - 1);
        if (!b0) return null;
        const lastY = last(rows).Year, Hh = Math.min(7, lastY - b0.Year);
        if (Hh < 1) return null;
        const ex = expoFor(b0), sig = volFor(soe, b0.Sector)[0], v = bt.size[bt.type] || 0;
        const mags = Object.assign({}, ZERO_MAG, { fuel_shock_path: [] });
        if (bt.type === "revenue") mags.revenue_shock_std_devs = sig ? v / sig : 0;
        else if (bt.type === "fuel") mags.fuel_shock_pct = v;
        else if (bt.type === "fx") mags.fx_shock_pct = v;
        else if (bt.type === "rates") mags.rate_shock_bps = v;
        const pN = paramsFor(b0, ZERO_MAG, ex, bt.dur, Hh), pS = paramsFor(b0, mags, ex, bt.dur, Hh);
        const pathN = E.runScenario(b0, pN, Hh), pathS = E.runScenario(b0, pS, Hh);
        const xs = pathS.map((r) => r["Calendar Year"]), act = xs.map((y) => { const r = rows.find((q) => q.Year === y); return r ? r.Z_EM : NaN; });
        const actZ = xs.map((y) => { const r = rows.find((q) => q.Year === y); return r ? r.Zone : null; });
        const idx = xs.map((_, i) => i).filter((i) => i > 0 && ok(act[i]));
        const mae = (pp) => mean(idx.map((i) => Math.abs(pp[i].Z_EM - act[i])));
        const zoneHit = idx.filter((i) => pathS[i].Zone === actZ[i]).length;
        const iL = idx.length ? last(idx) : 0, dirA = act[iL] - act[0], dirM = pathS[iL].Z_EM - pathS[0].Z_EM;
        return { soe, b0, xs, act, pathN, pathS, idx, maeS: mae(pathS), maeN: mae(pathN), zoneHit, dirOk: idx.length ? Math.sign(dirA) === Math.sign(dirM) || Math.abs(dirA) < 0.05 : null, Hh };
      };
      const x = one(st.soe);
      if (!x) { put(H.strip); H.btChart.body.lastChild.replaceChildren(el("p", { class: "note" }, `No accounts for ${st.soe} in ${bt.year - 1}, the year before the shock.`)); put(H.btRead); return; }
      const nY = x.idx.length;
      put(H.strip,
        tile("Average gap: model with shock vs actual", x.maeS < 0.5 ? "ok" : x.maeS < 1.5 ? "watch" : "alert", x.maeS < 0.5 ? "Close" : x.maeS < 1.5 ? "Some gap" : "Large gap", fmt(x.maeS, 2), "score points", `over ${pl(nY, "year")} after ${x.b0.Year} · no-shock model: ${fmt(x.maeN, 2)}`),
        tile("Same zone as the accounts", x.zoneHit === nY ? "ok" : x.zoneHit >= nY / 2 ? "watch" : "alert", null, `${x.zoneHit} of ${nY}`, "years", "safe, grey or distress, year by year"),
        tile("Direction of change", x.dirOk ? "ok" : "alert", x.dirOk ? "Matches" : "Differs", x.dirOk ? "Same" : "Opposite", "", `actual ${sgn(x.act[last(x.idx)] - x.act[0], 2)} vs model ${sgn(last(x.pathS).Z_EM - x.pathS[0].Z_EM, 2)} by ${x.xs[last(x.idx)]}`));
      lines(H.btChart.body.lastChild, x.xs, [
        { vals: x.pathN.map((r) => r.Z_EM), cls: "ln-base", dot: "prev", skipFirstDot: true, label: "Model, no shock" },
        { vals: x.pathS.map((r) => r.Z_EM), cls: "ln-str", dot: "now", skipFirstDot: true, label: "Model with the shock" },
        { vals: x.act, cls: "ln", dot: "hl", label: "Actual" }],
        { zones: true, active: [1, Math.min(bt.dur, x.Hh)], xLab: (i) => (i === 0 ? `${x.xs[i]} start` : String(x.xs[i])), tipTitle: (i) => `${st.soe} · ${x.xs[i]}`,
          tip: (i) => [[fmt(x.act[i], 2), "actual (accounts)"], [fmt(x.pathS[i].Z_EM, 2), "model with the shock"], [fmt(x.pathN[i].Z_EM, 2), "model, no shock"]], endLabel: { series: 2, fmt: (v) => fmt(v, 2) } });
      const better = x.maeS < x.maeN - 0.01;
      put(H.btRead, el("div", { class: "card" }, summaryBox(
        `Starting from ${st.soe}'s ${x.b0.Year} accounts, with the shock hitting in ${bt.year}, the projected distress score is on average **${fmt(x.maeS, 2)} points** away from the score in the accounts, and in the same zone in **${x.zoneHit} of ${nY}** years. ` +
        (bt.type === "none" ? "No shock is applied: this is a pure projection." : better ? `Adding the shock brings the projection closer to what happened (the no-shock projection is ${fmt(x.maeN, 2)} points away).` : `The no-shock projection is ${fmt(x.maeN, 2)} points away, so this shock size does not explain the path better; try another size or type.`) +
        " There will always be a gap: the model holds revenue and costs at base-year levels except for the shock, while the real years brought other changes too.", "Reading — rule-based, generated from the numbers"),
        el("p", { class: "note" }, "This is an in-sample check of the projection, not a formal validation, and with demo data the accounts are invented. It shows whether the mechanics move the score in the right direction and by a plausible amount when a known shock hits.")));
      const all = S.names.map(one).filter(Boolean).sort((a, b) => a.maeS - b.maeS);
      const tblAll = all.length ? simpleTable(["SOE", "Start year", "Years compared", "Average gap, with shock", "Average gap, no shock", "Same zone", "Direction"],
        all.map((y) => [el("td", { class: "name" }, el("span", { class: "nm" }, y.soe), el("span", { class: "sec" }, y.b0.Sector)), String(y.b0.Year), String(y.idx.length), fmt(y.maeS, 2), fmt(y.maeN, 2), `${y.zoneHit} of ${y.idx.length}`, y.dirOk ? stChip("ok", "Same") : stChip("alert", "Opposite")]),
        { cls: "compact", right: (i) => i >= 1 && i <= 5 }) : null;
      H.btAll.body.replaceChildren(
        all.length ? summaryBox(`Across **${pl(all.length, "SOE")}**: the projection with the shock is on average **${fmt(mean(all.map((y) => y.maeS)), 2)} points** from the accounts (${fmt(mean(all.map((y) => y.maeN)), 2)} without the shock), lands in the same zone in **${sum(all.map((y) => y.zoneHit))} of ${sum(all.map((y) => y.idx.length))}** SOE-years, and moves in the same direction for **${all.filter((y) => y.dirOk).length} of ${all.length}** SOEs.`, "In-sample check across the portfolio") : el("p", { class: "note" }, `No SOE has accounts for ${bt.year - 1}.`),
        tblAll ? fold(st.open, "r-bt-all", `Every SOE, as a table (${all.length})`, [tblAll]) : null);
    },
  };

  /* =====================================================================
     GOVERNMENT SUPPORT (GRE)
     ===================================================================== */
  pages.gre = {
    build(root) {
      const st = S.gre, H = (this.H = {});
      H.strip = statStrip();
      if (!S.names.includes(st.sel)) st.sel = S.names[0];
      const sov = card("Sovereign context", "Set once for the country these SOEs sit in; take the rating from the agency's current list.", null, "top");
      sov.body.append(el("div", { class: "fields" },
        fSelect("Sovereign rating (local currency, long-term)", CFG.RATING_SCALE_ASC.slice().reverse(), st.sov, (v) => { st.sov = v; this.render(); }),
        fSelect("Sovereign outlook", CFG.SOVEREIGN_OUTLOOK_OPTIONS, st.outlook, (v) => { st.outlook = v; this.render(); })),
        el("details", { class: "plain" }, el("summary", {}, "What do Role, Link and the uplift mean?"),
          el("p", { class: "note" }, "A simplified, transparent stand-in for S&P Global Ratings' GRE methodology (25 March 2015) — not a reproduction of its Role–Link matrix or notching tables. Role and Link scores are summed into a likelihood-of-support tier, which sets a maximum notch uplift and a minimum gap below the sovereign."),
          el("p", { class: "note" }, el("b", {}, "Role"), " — how important is a default of this SOE to the government?"),
          simpleTable(["Role", "Criteria"], CFG.ROLE_LEVELS.map((r) => [r, CFG.ROLE_CRITERIA[r]]), { cls: "glossary" }),
          el("p", { class: "note" }, el("b", {}, "Link"), " — how tightly bound is the government to this SOE?"),
          simpleTable(["Link", "Criteria"], CFG.LINK_LEVELS.map((r) => [r, CFG.LINK_CRITERIA[r]]), { cls: "glossary" }),
          simpleTable(["Likelihood tier", "Max uplift (notches)", "Min. gap below sovereign"], CFG.LIKELIHOOD_TIERS_ASC.slice().reverse().map((t) => [t, CFG.LIKELIHOOD_UPLIFT[t].max_notches === null ? "up to sovereign" : String(CFG.LIKELIHOOD_UPLIFT[t].max_notches), CFG.LIKELIHOOD_UPLIFT[t].min_gap_to_sovereign === null ? "—" : String(CFG.LIKELIHOOD_UPLIFT[t].min_gap_to_sovereign)]), { right: (i) => i >= 1 }),
          el("p", { class: "note" }, `Dynamic cap: if an SOE's rating has fallen ${CFG.DYNAMIC_CAP_TRIGGER_NOTCHES}+ notches across its years, or the sovereign outlook is Negative, the tier is capped at ${CFG.DYNAMIC_CAP_TIER}.`)));
      H.tbl = card("Per-SOE assessment", "Set Role and Link for each SOE; select a row to see its rating ladder");
      H.det = card("Rating ladder", null); H.det.body.append(el("div", { class: "chart" }));
      H.res = card("Result", null);
      root.replaceChildren(
        pageHead("GOVERNMENT SUPPORT", "Strategic SOEs & Government-Related Entity Uplift", "How important is this SOE to the government (Role), and how tightly linked (Link)? Together they set a bounded uplift above the SOE's own Z-EM-derived rating, capped by the sovereign's rating and tightened automatically if the SOE's rating is falling fast or the sovereign outlook turns negative."),
        el("div", { class: "alert-box hint", style: "margin-bottom:16px" }, el("b", {}, "Kept off the tab bar for now. "), "This view rates support from an investor's point of view, which the debt team may question, and the public-service-obligation (PSO) angle is not mature yet. It will be revisited with the hidden-subsidies and PSO work. Nothing here feeds PD or expected fiscal cost."),
        H.strip,
        el("div", { class: "grid" }, el("div", { class: "s4 sticky-panel" }, sov.root), el("div", { class: "s8 stack" }, H.tbl.root, el("div", { class: "grid" }, el("div", { class: "s7" }, H.det.root), el("div", { class: "s5" }, H.res.root)))),
        el("div", { class: "foot" }, el("div", {}, el("b", {}, "Simplified proxy, not S&P's methodology. "), "The Role × Link mapping and uplift ranges are editable in config.py. Uplift only raises a rating, never above the tier's ceiling, and is reported for comparison only — it does not feed PD or EFC, which stay on the standalone rating.")));
    },
    render() {
      const st = S.gre, H = this.H;
      const res = S.names.map((n) => E.gre(S.en, n, st.role[n] || CFG.ROLE_LEVELS[0], st.link[n] || CFG.LINK_LEVELS[0], st.sov, st.outlook));
      {
        const n = res.length, up = res.filter((g) => g.notches > 0).length, nn = res.map((g) => g.notches);
        const capped = res.filter((g) => g.capApplied && g.capped !== g.tier).length;
        const ceil = res.filter((g) => g.notches > 0 && g.ceilingIdx !== null && g.uIdx === g.ceilingIdx).length;
        put(H.strip,
          tile("Sovereign rating", st.outlook === "Negative" ? "watch" : null, st.outlook === "Negative" ? "Negative" : null, st.sov, "", `outlook ${st.outlook} · local currency, long-term`),
          tile("SOEs lifted by support", up ? "ok" : null, up ? "Uplift" : null, String(up), `of ${n}`, "rated above their standalone level"),
          tile("Average uplift", null, null, fmt(mean(nn), 1), "notches", n ? `range ${Math.min(...nn)} to ${Math.max(...nn)}` : ""),
          countTile("Capped by the dynamic trigger", capped, n, "rating fell fast or sovereign outlook negative", "watch"),
          tile("At the sovereign ceiling", null, null, String(ceil), `of ${n}`, "only a higher-rated sovereign would lift them further"));
      }
      const t = el("table", { class: "ctl-table" });
      t.appendChild(el("thead", {}, el("tr", {}, ["SOE", "Own rating", "Role", "Link", "Likelihood", "Uplifted", "Notches", "Gap to sovereign"].map((h, i) => el("th", { class: i >= 6 ? "r" : "" }, h)))));
      const tb = el("tbody");
      res.forEach((g) => {
        const sector = (S.en.find((r) => r.Entity === g.entity) || {}).Sector || "";
        const sel = (opts, val, key) => { const s = el("select", { "aria-label": `${key} for ${g.entity}` }); opts.forEach((o) => s.appendChild(el("option", { value: o, selected: o === val ? true : null }, o))); s.addEventListener("click", (e) => e.stopPropagation()); s.addEventListener("change", () => { st[key][g.entity] = s.value; st.sel = g.entity; this.render(); }); return s; };
        const tr = el("tr", { class: "pick" + (g.entity === st.sel ? " sel" : ""), tabindex: "0" }, nameCell(g.entity, sector), el("td", {}, g.sacp),
          el("td", {}, sel(CFG.ROLE_LEVELS, g.role, "role")), el("td", {}, sel(CFG.LINK_LEVELS, g.link, "link")),
          el("td", {}, g.capped, g.capApplied && g.capped !== g.tier ? el("span", { class: "muted" }, " (capped)") : null), el("td", {}, el("b", {}, g.uplifted)),
          el("td", { class: "r" }, "+" + g.notches), el("td", { class: "r" }, g.gap === null ? "—" : String(g.gap)));
        const pick = () => { st.sel = g.entity; this.render(); };
        tr.addEventListener("click", pick);
        tr.addEventListener("keydown", (e) => { if (e.target === tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(); } });
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      H.tbl.body.replaceChildren(el("div", { class: "tbl-wrap" }, t), el("div", { style: "margin-top:10px" }, dataButtons(() => toCSV(["Entity", "Own rating", "Role", "Link", "Likelihood tier", "Dynamic cap applied", "Uplifted rating", "Notches gained", "Gap to sovereign"], res.map((g) => [g.entity, g.sacp, g.role, g.link, g.capped, g.capApplied ? "Yes" : "No", g.uplifted, g.notches, g.gap])), "gre_uplift_summary.csv")));
      const g = res.find((x) => x.entity === st.sel) || res[0];
      H.det.head.querySelector("h3").textContent = `Rating ladder · ${g.entity}`;
      ladder(H.det.body.firstChild, g);
      const words = g.sIdx === null ? "No standalone rating could be assigned." :
        `${g.entity} is ${g.sacp} on its own; the government's likely backing ${g.notches > 0 ? `lifts it to ${g.uplifted}` : "does not lift it"}; ${g.gap === 0 ? "it is rated level with the sovereign." : `it sits ${g.gap} notch${g.gap === 1 ? "" : "es"} below the sovereign.`}` +
        (g.notches > 0 && g.ceilingIdx !== null && g.uIdx === g.ceilingIdx ? " The ceiling, not the tier's maximum uplift, is binding, so stronger support in the same tier would not help — only a higher-rated sovereign would." : "");
      H.res.body.replaceChildren(el("div", { class: "fields" },
        el("div", { class: "res" }, el("div", { class: "res-h" }, "Likelihood of support"), el("div", { class: "res-z" }, el("b", { style: "font-size:20px" }, g.capped)), el("div", { class: "res-line" }, g.capApplied && g.capped !== g.tier ? `Capped from ${g.tier} by the dynamic trigger` : "From Role × Link")),
        el("div", { class: "res stress" }, el("div", { class: "res-h" }, "Uplifted rating"), el("div", { class: "res-z" }, el("b", {}, `${g.sacp} → ${g.uplifted}`)), el("div", { class: "res-line" }, `+${g.notches} notch${g.notches === 1 ? "" : "es"} · gap to sovereign ${g.gap ?? "—"}`)),
        g.capApplied ? el("div", { class: "alert-box warn" }, `Dynamic cap applies — ${g.triggers.join(", and ")}. Tier capped at ${CFG.DYNAMIC_CAP_TIER} regardless of Role and Link.`) : null,
        summaryBox(words, "In plain words")));
    },
  };
  function ladder(box, g) {
    const scale = CFG.RATING_SCALE_ASC, W = widthOf(box);
    const idxs = [g.sIdx, g.uIdx, g.vIdx, g.ceilingIdx].filter((v) => v !== null && v !== undefined);
    if (!idxs.length) { box.replaceChildren(el("p", { class: "note" }, "No rating to show.")); return; }
    const top = Math.min(scale.length - 1, Math.max(...idxs) + 1), bot = Math.max(0, Math.min(...idxs) - 2);
    const rowH = 26, T = 6, H = T + (top - bot + 1) * rowH + 6, L = 64, cw = 34, lx = L + cw + 16;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    const yOf = (i) => T + (top - i) * rowH;
    for (let i = top; i >= bot; i--) {
      const y = yOf(i);
      const inGap = g.vIdx !== null && g.uIdx !== null && i > g.uIdx && i <= g.vIdx;
      svgEl("rect", { x: L, y: y + 1, width: cw, height: rowH - 2, class: "lad-cell" + (inGap ? " span" : "") }, svg);
      txt(svg, L - 10, y + rowH / 2, scale[i], "t-ink2 num", "end", 12, 600);
      const tags = [];
      if (i === g.vIdx) tags.push("Sovereign");
      if (i === g.ceilingIdx) tags.push("Ceiling");
      if (i === g.uIdx && g.uIdx !== g.sIdx) tags.push("Uplifted");
      if (i === g.sIdx) tags.push(g.uIdx === g.sIdx ? "Standalone = Uplifted" : "Standalone");
      if (tags.length) txt(svg, lx, y + rowH / 2, tags.join(" = ").replace("Standalone = Uplifted = ", "Standalone = Uplifted = "), "t-head", "start", 12.5, 700);
    }
    if (g.uIdx !== null && g.sIdx !== null && g.uIdx > g.sIdx) {
      const x = L + cw / 2;
      svgEl("path", { d: `M${x},${yOf(g.sIdx) + rowH / 2 - 4}V${yOf(g.uIdx) + rowH / 2 + 6}`, class: "lad-arrow" }, svg);
      svgEl("path", { d: `M${x - 5},${yOf(g.uIdx) + rowH / 2 + 11}L${x},${yOf(g.uIdx) + rowH / 2 + 4}L${x + 5},${yOf(g.uIdx) + rowH / 2 + 11}`, class: "lad-arrow" }, svg);
    }
    if (g.gap && g.vIdx !== null && g.uIdx !== null && W > 360) {
      const y0 = yOf(g.vIdx) + 3, y1 = yOf(g.uIdx + 1) + rowH - 3, gx = W - 16;
      svgEl("path", { d: `M${gx - 6},${y0}H${gx}V${y1}H${gx - 6}`, class: "lad-arrow", style: "stroke:var(--muted);stroke-width:1.5" }, svg);
      txt(svg, gx - 10, (y0 + y1) / 2, `gap to sovereign = ${g.gap}`, "t-muted", "end", 11.5, 600);
    }
    box.replaceChildren(svg);
  }

  /* =====================================================================
     EARLY WARNING
     ===================================================================== */
  const RULE_BY = Object.fromEntries(CFG.TRIGGER_RULES.map((r) => [r.id, r]));
  /** which trigger rules each SOE fires (latest year) — Early Warning and the Report's policy section */
  function evalTriggers(rows, stress) {
    const hits = Object.fromEntries(CFG.TRIGGER_RULES.map((r) => [r.id, []])), by = {}, lvl = { alert: 0, watch: 1, ok: 2 };
    rows.forEach((r) => {
      const f = [];
      if (r.Zone === "Distress") f.push("distress");
      if (r.Equity <= 0) f.push("neg_equity");
      if ((ok(r.debt_to_ebitda) && r.debt_to_ebitda > SPEC.debt_to_ebitda.red_cut) || r.EBITDA <= 0) f.push("debt_ebitda");
      if (RULE_BY.interest_cover && ok(r.interest_coverage) && (r["Interest Expense"] || 0) > 0 && r.interest_coverage < SPEC.interest_coverage.red_cut) f.push("interest_cover");
      if (RULE_BY.liquidity && ok(r.current_ratio) && r.current_ratio < SPEC.current_ratio.red_cut) f.push("liquidity");
      if (stress[r.Entity] && stress[r.Entity].drop) f.push("stress_drop");
      if (r.Zone === "Grey") f.push("grey");
      const nc = E.notchChange(S.en, r.Entity)[2];
      if (nc !== null && nc <= -CFG.DYNAMIC_CAP_TRIGGER_NOTCHES) f.push("rating_fall");
      if (ok(r.grants_to_revenue) && r.grants_to_revenue > SPEC.grants_to_revenue.red_cut) f.push("grant_dependency");
      if (!f.length && r.Zone === "Safe") f.push("routine");
      f.forEach((id) => hits[id] && hits[id].push(r.Entity));
      const lv = f.map((id) => (RULE_BY[id] || {}).level).filter(Boolean);
      by[r.Entity] = { level: lv.sort((a, b) => lvl[a] - lvl[b])[0] || "ok", rules: f };
    });
    return { hits, by };
  }
  function signalBoard(rows, by, onPick, sel) {
    const board = el("div", { class: "zboard" });
    ["alert", "watch", "ok"].forEach((k) => {
      const list = rows.filter((r) => by[r.Entity].level === k);
      const cards = el("div", { class: "zcards" }, list.map((r) => {
        const kids = [el("span", {}, el("span", { class: "nm" }, r.Entity), el("span", { class: "zs" }, by[r.Entity].rules.map((id) => RULE_BY[id].short).join(" · "))), el("span", { class: "zv" }, fmt(r.Z_EM, 2))];
        return onPick ? el("button", { type: "button", class: "ctry pick-soe" + (r.Entity === sel ? " sel" : ""), "aria-pressed": String(r.Entity === sel), onclick: () => onPick(r.Entity) }, ...kids) : el("div", { class: "ctry" }, ...kids);
      }));
      board.appendChild(el("div", { class: "zcol " + k }, el("h4", {}, el("span", {}, el("i", { "aria-hidden": "true" }, GLYPH[k] + " "), STLABEL[k]), el("span", { class: "cnt" }, pl(list.length, "SOE"))), list.length ? cards : el("div", { class: "empty" }, "None")));
    });
    return board;
  }
  pages.warning = {
    build(root) {
      const H = (this.H = {});
      H.board = card("Signal board", "Each SOE under its most severe signal · select an SOE to see what to do");
      H.plan = card("Action plan", null, null, "top");
      H.rules = card("Trigger rules by issue", "Each rule, the follow-up it calls for, and the SOEs that fire it");
      H.strip = statStrip();
      root.replaceChildren(
        pageHead("EARLY WARNING", "Trigger rules and follow-up", `Rules that link an SOE's financial health to a pre-agreed response, evaluated on the latest year of each SOE shown. The stress rule uses the tool's standard stress over ${CFG.MC_HORIZON_YEARS} years.`),
        H.strip,
        el("div", { class: "grid" }, el("div", { class: "s5" }, H.board.root), el("div", { class: "s7" }, H.plan.root), el("div", { class: "s12" }, H.rules.root)),
        el("div", { class: "foot" }, el("div", {}, "Rules, cut-offs and actions are illustrative starting points (config.TRIGGER_RULES). The follow-up steps reflect common SOE-oversight practice and still need to be agreed with the Ministry of Finance and aligned with World Bank, IMF and governance-team guidance before use.")));
    },
    render() {
      const H = this.H, st = S.ew, rows = latestOf(F()).sort((a, b) => b.Z_EM - a.Z_EM);
      const stress = Object.fromEntries(standardStress(F()).map((x) => [x.row.Entity, x]));
      const { hits, by } = evalTriggers(rows, stress);
      const n = rows.length, lv = (k) => rows.filter((r) => by[r.Entity].level === k).length;
      const common = CFG.TRIGGER_RULES.filter((r) => r.id !== "routine" && hits[r.id].length).sort((a, b) => hits[b.id].length - hits[a.id].length)[0];
      put(H.strip,
        tile("Alert", "alert", "Alert", String(lv("alert")), `of ${n}`, "at least one alert rule fires"),
        tile("Watch", "watch", "Watch", String(lv("watch")), `of ${n}`, "watch rules only"),
        tile("Good", "ok", "Good", String(lv("ok")), `of ${n}`, "routine annual monitoring"),
        countTile("Fail the stress test", hits.stress_drop.length, n, "drop a zone under standard stress"),
        tile("Most common trigger", null, null, common ? String(hits[common.id].length) : "0", common ? "SOEs" : "", common ? common.short : "no rule fires"));
      // the SOE in focus: the most severe and weakest first, then the reader's choice
      const order = rows.slice().sort((a, b) => ({ alert: 0, watch: 1, ok: 2 }[by[a.Entity].level] - { alert: 0, watch: 1, ok: 2 }[by[b.Entity].level]) || a.Z_EM - b.Z_EM).map((r) => r.Entity);
      if (!order.includes(st.sel)) st.sel = order[0];
      const pick = (nm) => { st.sel = nm; this.render(); };
      H.board.body.replaceChildren(signalBoard(rows, by, pick, st.sel));
      const i = order.indexOf(st.sel), r = rows.find((q) => q.Entity === st.sel), b0 = by[st.sel];
      const rules = b0.rules.map((id) => RULE_BY[id]).filter(Boolean).sort((a, c) => ({ alert: 0, watch: 1, ok: 2 }[a.level] - { alert: 0, watch: 1, ok: 2 }[c.level]));
      H.plan.head.querySelector("h3").textContent = `Action plan · ${st.sel}`;
      const hist = S.en.filter((q) => q.Entity === st.sel).sort((a, c) => a.Year - c.Year);
      const ol = el("ol", { class: "tl" }, hist.map((h) => el("li", { class: h.Zone === "Distress" ? "hot" : "" }, el("span", { class: "when" }, String(h.Year)), el("span", { class: "rail" }),
        el("div", { class: "what" }, "Score ", el("b", {}, fmt(h.Z_EM, 2)), ` · ${h.Rating} · PD ${pctAuto(E.pdByRating(h.Rating))}`, zoneChip(h.Zone)))));
      const x = stress[st.sel];
      if (x) { const rs = last(x.str), rb = last(x.base); ol.appendChild(el("li", { class: "proj" }, el("span", { class: "when" }, `${rs["Calendar Year"]} stress`), el("span", { class: "rail" }), el("div", { class: "what" }, "Score ", el("b", {}, fmt(rs.Z_EM, 2)), ` · ${rs.Rating} under standard stress (no shock ${fmt(rb.Z_EM, 2)}, ${rb.Rating})`, zoneChip(rs.Zone)))); }
      const power = /power|utilit|energy|electric/i.test(r.Sector || "");
      H.plan.body.replaceChildren(
        el("div", { class: "row-ctl", style: "margin-bottom:10px" },
          fSelect("SOE", order, st.sel, (v) => pick(v)),
          el("div", { class: "btn-row" }, el("button", { class: "btn-ghost", type: "button", disabled: i <= 0 ? true : null, onclick: () => pick(order[i - 1]) }, "← Previous"),
            el("button", { class: "btn-ghost", type: "button", disabled: i >= order.length - 1 ? true : null, onclick: () => pick(order[i + 1]) }, "Next →")),
          el("span", { class: "muted", style: "font-size:12px" }, `${i + 1} of ${order.length}, most severe first`)),
        el("div", { class: "ew-plan" },
          el("p", { class: "note", style: "margin-top:0" }, stChip(b0.level), ` ${st.sel} (${r.Sector}) · distress score ${fmt(r.Z_EM, 2)}, ${String(r.Zone).toLowerCase()} zone, ${distressWhy(r)}.`),
          rules.map((rule) => el("div", {}, el("h4", {}, stChip(rule.level, rule.short), el("span", { class: "muted", style: "font-weight:400;font-size:12px" }, rule.category ? rule.category + " · " : "", rule.condition)),
            el("ol", {}, (rule.steps || [rule.action]).map((t) => el("li", {}, t))))),
          el("div", { class: "btn-row", style: "margin-top:12px" },
            el("button", { class: "btn", type: "button", onclick: () => { S.sh.soe = st.sel; S.sh.year = r.Year; S.sh.view = "single"; S.sh.mode = "standard"; Object.assign(S.sh.mags, STD_MAG, { fuel_shock_path: [] }); S.built.shock = false; showTab("shock"); window.scrollTo({ top: 0 }); } }, "Open in Shock Scenarios →"),
            power && b0.level !== "ok" ? el("span", { class: "muted", style: "font-size:12px" }, "Power utility: a candidate for a deep dive in the energy-sector fiscal-risk model.") : null)),
        el("details", { class: "plain", open: st.histOpen ? true : null, ontoggle: (e) => { st.histOpen = e.target.open; } }, el("summary", {}, "Score history and standard-stress projection"), ol));
      // rules grouped by issue, with a filter
      const cats = CFG.TRIGGER_CATEGORIES || uniq(CFG.TRIGGER_RULES.map((q) => q.category));
      if (st.cat !== "all" && !cats.includes(st.cat)) st.cat = "all";
      const chips = el("div", { class: "ew-cats" }, el("span", { class: "chips-label" }, "Issue"),
        [["all", "All"], ...cats.map((c) => [c, c])].map(([k, l]) => el("button", { class: "chip", type: "button", "aria-pressed": String(st.cat === k), onclick: () => { st.cat = k; this.render(); } },
          l, k === "all" ? null : el("span", { class: "muted" }, ` ${CFG.TRIGGER_RULES.filter((q) => q.category === k).reduce((a, q) => a + hits[q.id].length, 0)}`))));
      const shown = cats.filter((c) => st.cat === "all" || st.cat === c);
      H.rules.body.replaceChildren(chips, ...shown.map((c) => {
        const rs = CFG.TRIGGER_RULES.filter((q) => q.category === c);
        if (!rs.length) return null;
        return el("div", { class: "ew-group" }, el("h4", {}, c), rs.map((q) => el("div", { class: "ew-rule" },
          el("div", {}, stChip(q.level)),
          el("div", {}, el("div", { class: "cond" }, q.short), el("div", { class: "muted", style: "font-size:12.5px" }, q.condition),
            el("div", { class: "soe-list" }, hits[q.id].length ? hits[q.id].map((nm) => el("span", { class: "pick-chip", role: "button", tabindex: "0", onclick: () => pick(nm), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(nm); } } }, nm)) : el("span", { style: "background:transparent;border-color:transparent;color:var(--muted)" }, "None"))),
          el("div", {}, el("b", { style: "font-size:12px;color:var(--ink-2)" }, "Follow-up"), el("ol", {}, (q.steps || [q.action]).map((t) => el("li", {}, t)))))));
      }));
      const tbl = H.rules.body.querySelector("table"); if (tbl) tbl.id = "rulesTable";
    },
  };

  /* =====================================================================
     ASSUMPTIONS & SOURCES
     ===================================================================== */
  const ASM_K = { literature: "ok", user: "none", proxy: "watch", placeholder: "alert", design: "watch" };
  pages.assumptions = {
    build(root) {
      const st = S.asm, H = (this.H = {});
      const reg = CFG.PARAMETER_REGISTER, labels = CFG.PARAMETER_STATUS_LABELS;
      const tiles = el("div", { class: "statstrip" }, Object.keys(labels).map((k) => { const [a, b] = labels[k].split(" — "); return tile(a, ASM_K[k], ({ literature: "Sourced", user: "Set by you", proxy: "Proxy", placeholder: "Needs source", design: "Justify" })[k], String(reg.filter((r) => r.status === k).length), `of ${reg.length}`, b ? b[0].toUpperCase() + b.slice(1) : ""); }));
      const groups = uniq(reg.map((r) => r.group));
      const ctl = el("div", { class: "row-ctl" },
        el("div", { class: "fld" }, el("span", { class: "lbl" }, "Status"), chipsMulti(Object.keys(labels).map((k) => [k, labels[k].split(" — ")[0]]), st.status, () => this.render())),
        fSelect("Group", [["all", "All groups"], ...groups.map((g) => [g, g])], st.group, (v) => { st.group = v; this.render(); }));
      H.reg = card("Parameter register", "Every coefficient, threshold and default the tool uses, with its source and status", null, "top");
      H.reg.body.append(ctl, el("div", { style: "margin-top:12px" }), el("div", { style: "margin-top:10px" }));
      const dict = card("Standard data schema", `The ${CFG.SCHEMA.variables.length} variables the upload understands. Headers are matched by exact name, then known synonyms, then close spelling (similarity ≥ ${CFG.SCHEMA.fuzzy_cutoff}).`);
      dict.body.append(simpleTable(["Key", "Label", "Statement", "Kind", "Req.", "Used by", "Also recognised as"], SCHEMA_VARS().map((v) => [el("td", { class: "mono" }, v.key), v.label, v.statement, v.kind, v.required ? "yes" : "", v.used_by, el("td", { class: "wrap-cell" }, v.synonyms.join("; "))]), { cls: "compact dict", tall: true }),
        el("div", { class: "btn-row", style: "margin-top:10px" }, dataButtons(templateCSV, "soe_tool_template.csv", "template"), dataButtons(dictionaryCSV, "soe_variable_dictionary.csv", "dictionary")));
      root.replaceChildren(pageHead("TECHNICAL NOTES · FOR ANALYSTS", "Assumptions & sources", "Every number the tool relies on, where it comes from, and how firm it is. Placeholders are numbers the tool needs to run but that still need a literature or data source before results are used in policy advice. This page backs up the technical note; it is kept off the main tab bar."),
        tiles, el("div", { class: "stack", style: "margin-top:16px" }, H.reg.root, dict.root),
        el("div", { class: "foot" }, el("div", {}, "The register lives in config.PARAMETER_REGISTER; update a row's status and source there when a placeholder gets calibrated. Values shown are the config defaults — sliders on the other tabs can change them for a run.")));
    },
    render() {
      const st = S.asm, H = this.H, labels = CFG.PARAMETER_STATUS_LABELS;
      const rows = CFG.PARAMETER_REGISTER.filter((r) => st.status.has(r.status) && (st.group === "all" || r.group === st.group));
      const [, tblBox, btnBox] = H.reg.body.children;
      tblBox.replaceChildren(rows.length ? simpleTable(["Group", "Parameter", "Value", "Status", "Source", "Used in"], rows.map((r) => [r.group, el("td", {}, el("b", {}, r.parameter)), el("td", { class: "wrap-cell" }, String(r.value)), el("td", {}, stChip(ASM_K[r.status], labels[r.status].split(" — ")[0])), el("td", { class: "wrap-cell" }, r.source), el("td", { class: "wrap-cell" }, r.used_in)]), { cls: "compact register" }) : el("p", { class: "note" }, "No parameters match these filters."));
      btnBox.replaceChildren(dataButtons(() => toCSV(["group", "parameter", "value", "status", "source", "used_in"], rows.map((r) => [r.group, r.parameter, r.value, labels[r.status], r.source, r.used_in])), "parameter_register.csv"));
    },
  };

  /*__EXPLAINER_JS__*/

  /* =====================================================================
     optional upload-only fiscal-support additions
     ===================================================================== */
  /*__SUPPORT_EXTENSION_JS__*/

  /* =====================================================================
     boot
     ===================================================================== */
  const startKey = DATASETS.report ? "report" : DATASETS.training ? "training" : DATASETS.demo ? "demo" : "sample";
  const start = DATASETS[startKey];
  const h = (location.hash || "").slice(1).replace(/^view-/, "");
  if (pages[h]) S.tab = h;
  loadDataset(start.rows, start.label, start.example, startKey);
  let lastW = document.documentElement.clientWidth, raf = 0;
  new ResizeObserver(() => {
    const w = document.documentElement.clientWidth;
    if (w === lastW) return;
    lastW = w; cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => pages[S.tab].render());
  }).observe(document.body);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => pages[S.tab].render());
})();
