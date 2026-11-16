"use strict";
const T = window.TRIP;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtVND = n => Math.round(n).toLocaleString("vi-VN") + "đ";
const fmtTr = n => (n/1e6).toLocaleString("vi-VN",{maximumFractionDigits:1}) + " triệu";
const img = k => k ? `img/${k}.jpg` : "";
const ICON = {
  today:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  trip:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20l5-16 6 12 5-8"/></svg>',
  money:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12"/><circle cx="12" cy="12" r="2.5"/></svg>',
  prod:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="13" height="12"/><path d="M16 10l5-3v10l-5-3"/></svg>',
  fx:'<svg width="22" height="22" viewBox="0 0 150 100"><use href="#mark"/></svg>'
};
const ROUTES = [
  {k:"hom-nay", name:"Hôm nay", icon:ICON.today},
  {k:"hanh-trinh", name:"Hành trình", icon:ICON.trip},
  {k:"chi-tieu", name:"Chi tiêu", icon:ICON.money},
  {k:"san-xuat", name:"Sản xuất", icon:ICON.prod},
  {k:"hieu-ung", name:"Hiệu ứng", icon:ICON.fx}
];

/* ---------- local fallback storage (when db is not available) ---------- */
const LS = {
  get(k, d){ try{ const v = localStorage.getItem("hd:"+k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem("hd:"+k, JSON.stringify(v)); }catch(e){} }
};

/* ---------- state ---------- */
const S = {
  db:null, assets:null, sample:null, dictation:null, canWrite:true,
  expenses:{}, days:{}, beats:{}, eps:{}, prep:{}, settings:{rate:T.rate},
  scripts:{}, sync:"Đang mở dữ liệu…", previewDay: LS.get("previewDay", null)
};
const COLS = ["expenses","days","beats","eps","prep","settings"];

function store(col){ return S[col]; }
async function put(col, id, data){
  S[col][id] = Object.assign({}, S[col][id] || {}, data);
  if (S.db){
    const clean = {}; Object.keys(S[col][id]).forEach(k => { if (k[0] !== "_") clean[k] = S[col][id][k]; });
    try{ await S.db.doc(col+"/"+id).set(clean); }
    catch(e){ toast(e && e.code === "quota_exceeded" ? "Hết chỗ lưu trữ dữ liệu." : "Chưa lưu được, thử lại sau."); }
  } else LS.set(col, S[col]);
  render();
}
async function del(col, id){
  delete S[col][id];
  if (S.db){ try{ await S.db.doc(col+"/"+id).delete(); }catch(e){ toast("Chưa xóa được."); } }
  else LS.set(col, S[col]);
  render();
}

async function boot(){
  COLS.forEach(c => { const v = LS.get(c, null); if (v) S[c] = Object.assign(S[c], v); });
  render();
  if (!window.claude || !window.claude.use){ S.sync = "Lưu trên máy này"; render(); return; }
  const timer = setTimeout(()=>{ if (!S.db){ S.sync = "Lưu trên máy này"; render(); } }, 10000);
  try{
    const db = await window.claude.use("db");
    if (db){
      S.db = db; S.sync = "Đang đồng bộ…"; render();
      let first = 0;
      COLS.forEach(c => {
        db.collection(c).onSnapshot(snap => {
          const o = {}; snap.docs.forEach(d => { o[d.id] = d.data(); });
          if (c === "settings") S.settings = Object.assign({rate:T.rate}, (o.main||{}));
          else { if (c === "beats") Object.keys(o).forEach(k => { if (S.beats[k] && S.beats[k]._open) o[k] = Object.assign({}, o[k], {_open:true}); }); S[c] = o; }
          if (!snap.metadata.fromCache){ clearTimeout(timer); S.sync = "Đã đồng bộ"; }
          render();
        }, err => { S.sync = "Mất kết nối dữ liệu"; render(); });
      });
    } else { S.sync = "Lưu trên máy này"; render(); }
  }catch(e){ S.sync = "Lưu trên máy này"; render(); }
  try{
    const user = await window.claude.use("user");
    if (user && user.can){ const w = await user.can("data.write"); if (w === false) S.canWrite = false; }
  }catch(e){}
  try{ S.assets = await window.claude.use("assets"); }catch(e){}
  try{ S.sample = await window.claude.use("sample"); }catch(e){}
  try{ S.dictation = await window.claude.use("dictation"); }catch(e){}
  render();
}
function rate(){ return Number((S.settings && S.settings.rate) || T.rate); }
async function setRate(v){
  S.settings.rate = v;
  if (S.db){ try{ await S.db.doc("settings/main").set({rate:v}); }catch(e){} } else LS.set("settings", S.settings);
  render();
}

/* ---------- trip day ---------- */
function todayISO(){ const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function realTripDay(){
  const a = new Date(T.start+"T00:00:00"), b = new Date(todayISO()+"T00:00:00");
  return Math.round((b-a)/86400000) + 1;
}
function tripDay(){ return S.previewDay ? Number(S.previewDay) : realTripDay(); }
const dayObj = d => T.days.find(x => x.d === d);
const epObj = n => T.episodes.find(e => e.n === n);
const isHoliday = d => { const o = dayObj(d); if (!o) return false; return d >= 14; }; // 20/12 trở đi là mùa lễ

/* ---------- scripts ---------- */
async function loadScript(n){
  if (S.scripts[n]) return S.scripts[n];
  try{
    const r = await fetch(window.HD_DEC ? `scripts/tap${n}.enc` : `scripts/tap${n}.md`);
    if (!r.ok) throw 0;
    const txt = window.HD_DEC ? await window.HD_DEC(await r.arrayBuffer()) : await r.text();
    S.scripts[n] = parseScript(txt, n);
  }catch(e){ S.scripts[n] = {error:true, sections:[]}; }
  return S.scripts[n];
}
function inline(s){
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(&lt;?([^)\s]+?)&gt;?\)/g, (m,t,u)=>`<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  return s;
}
function parseScript(md, n){
  const lines = md.split("\n");
  const out = {n, title:"", meta:[], sections:[]};
  let sec = null, beat = null;
  const newBeat = (t) => { beat = {title:t, items:[], idx: sec.beats.length}; sec.beats.push(beat); };
  for (let raw of lines){
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith("# ")){ out.title = l.slice(2); continue; }
    if (l.startsWith("## ")){
      sec = {title:l.slice(3), q:"", beats:[], kind:/^Ngày \d+/.test(l.slice(3)) ? "day" : (/^Mở tập/.test(l.slice(3)) ? "open" : "list"), list:[]};
      const m = sec.title.match(/^Ngày (\d+)/); if (m) sec.day = Number(m[1]);
      out.sections.push(sec); beat = null; continue;
    }
    if (!sec){ const m = l.match(/^\*\*(.+?):\*\*\s*(.*)$/); if (m) out.meta.push({k:m[1], v:m[2]}); continue; }
    if (/^\*[^*].*\*$/.test(l)){ sec.q = l.slice(1,-1).replace(/^Câu hỏi của ngày:\s*/,""); continue; }
    const bm = l.match(/^\*\*([^*]+)\*\*$/);
    if (bm){ newBeat(bm[1]); continue; }
    if (l.startsWith("- ")){
      const body = l.slice(2);
      const im = body.match(/^\*\*(.+?):\*\*\s*(.*)$/);
      if (sec.kind === "list"){ sec.list.push(body); continue; }
      if (!beat) newBeat(sec.kind === "open" ? "Mở tập" : "Ghi chú");
      beat.items.push(im ? {k:im[1], v:im[2]} : {k:"", v:body});
      continue;
    }
    if (sec.kind === "list") sec.list.push(l);
  }
  out.sections.forEach((s,si) => s.beats.forEach(b => { b.key = `t${n}-s${si}-b${b.idx}`; b.lamp = /^Đèn của ngày/.test(b.title); }));
  return out;
}

/* ---------- money ---------- */
function expenseList(){ return Object.entries(S.expenses).map(([id,e]) => Object.assign({id}, e)).filter(e => typeof e.amt === "number"); }
function spentTotal(){ return expenseList().reduce((a,e)=>a+e.amt,0); }
function spentBy(cat){ return expenseList().filter(e=>e.cat===cat).reduce((a,e)=>a+e.amt,0); }
function spentDay(d){ return expenseList().filter(e=>Number(e.day)===d).reduce((a,e)=>a+e.amt,0); }

/* ---------- ui helpers ---------- */
let toastTimer;
function toast(t){ let el = $("#toast"); if (!el){ el = document.createElement("div"); el.id="toast"; el.className="toast"; el.setAttribute("role","status"); document.body.appendChild(el); } el.textContent = t; el.style.display="block"; clearTimeout(toastTimer); toastTimer = setTimeout(()=>el.style.display="none", 2600); }
function route(){ const h = location.hash.replace(/^#\/?/,"") || "hom-nay"; const [k, a, b] = h.split("/"); return {k, a, b}; }

function renderShell(){
  const r = route();
  const items = ROUTES.map(x => `<a href="#/${x.k}" ${r.k===x.k?'aria-current="page"':''}>${x.icon}<span>${x.name}</span></a>`).join("");
  $("#nav").innerHTML = items; $("#tabbar").innerHTML = items;
  const d = tripDay();
  $("#railFoot").innerHTML = `<b>Thái Lan</b> · 7/12/2026 – 3/1/2027<br>${esc(S.sync)}`;
  $("#syncTop").textContent = d < 1 ? `còn ${1-d} ngày` : (d <= 28 ? `ngày ${d}/28` : "đã về");
}

function render(){
  renderShell();
  const r = route();
  const v = $("#view");
  const fn = {"hom-nay":vToday, "hanh-trinh":vTrip, "chi-tieu":vMoney, "san-xuat":vProd, "hieu-ung":vFx, "kenh":vFx}[r.k] || vToday;
  // keep focus & scroll on re-render of same view
  const active = document.activeElement && document.activeElement.id;
  const keepVal = active && document.activeElement.value;
  fn(v, r);
  if (active){ const el = document.getElementById(active); if (el && el !== document.activeElement){ if (keepVal != null && "value" in el && el.dataset.keep !== "0") el.value = keepVal; el.focus(); } }
}
window.addEventListener("hashchange", () => { $("#sheet").classList.remove("open"); $("#sheetBg").classList.remove("open"); window.scrollTo(0,0); render(); });

/* ---------- views ---------- */
const PREP = [
  ["hochieu","Hộ chiếu còn hạn tới ít nhất tháng 6/2027. App vé máy bay đang báo hộ chiếu đã hết hạn: cập nhật số hộ chiếu mới."],
  ["vedi","Đặt vé Sài Gòn – Chiang Mai 7/12 và vé về từ Bangkok"],
  ["thieba","Đặt phòng Tha Rae đêm 22–24/12"],
  ["bkk","Đặt phòng Bangkok 26/12 – 2/1"],
  ["thietbi","Mua Insta360 Ace Pro 2, mic Mic Air, đèn Ulanzi VL49, thẻ nhớ"],
  ["quaythu","Quay thử một ngày ở Sài Gòn, xem pin và thẻ nhớ đủ không"],
  ["kenh","Tạo tài khoản @haidangkechuyen trên YouTube và TikTok"],
  ["intro","Đăng video giới thiệu kênh (30/11)"],
  ["tdac","Khai TDAC trong 3 ngày trước khi bay"],
  ["baohiem","Mua bảo hiểm du lịch"],
  ["ao","Áo khoác cho Pai, thuốc say xe, giấy vệ sinh cho xe đêm"]
];

const GEAR = [["g-ace","Insta360 Ace Pro 2 (gói Xplorer, khoảng 12,4 triệu)"],["g-mic","Mic Insta360 Mic Air"],["g-den","Đèn Ulanzi VL49"],["g-the","2 thẻ nhớ tốc độ cao (V30 trở lên)"],["g-ssd","Ổ cứng SSD nhỏ để chép cảnh mỗi tối"],["g-gay","Gậy tự sướng dài kiêm chân máy"],["g-sac","Sạc dự phòng (tối đa 2 cục, dưới 100 Wh, để trong hành lý xách tay)"],["g-cu","Cục sạc nhiều cổng và dây USB-C"]];
function checkList(list, pre){
  const li = ([k,t]) => { const ok = S.prep[k] && S.prep[k].done; return `<li class="${ok?"done":""}"><input type="checkbox" id="c-${k}" data-prep="${k}" ${ok?"checked":""}><label for="c-${k}"><span>${esc(t)}</span></label></li>`; };
  const todo = list.filter(([k]) => !(S.prep[k] && S.prep[k].done)), done = list.filter(([k]) => S.prep[k] && S.prep[k].done);
  return `${todo.length ? `<ul class="check">${todo.map(li).join("")}</ul>` : `<p class="notice">Xong hết rồi.</p>`}
    ${done.length ? `<details class="donebox" ${S.showDone?"open":""}><summary>Đã xong (${done.length})</summary><ul class="check">${done.map(li).join("")}</ul></details>` : ""}`;
}
function dayCard(o, opts={}){
  const ep = epObj(o.ep);
  return `
  <dl class="facts">
    <dt>Làm gì</dt><dd>${esc(o.todo)}</dd>
    ${o.move?`<dt>Đi lại</dt><dd>${esc(o.move)}</dd>`:""}
    ${o.sleep?`<dt>Ngủ</dt><dd>${esc(o.sleep)}</dd>`:""}
    ${o.see?`<dt>Sẽ thấy</dt><dd>${esc(o.see)}${o.check?' <span class="muted">(theo lịch lễ 2025, kiểm lại lịch 2026)</span>':''}</dd>`:""}
    ${o.map?`<dt>Bản đồ</dt><dd><a href="https://www.google.com/maps/search/?api=1&query=${o.map}" target="_blank" rel="noopener">Mở Google Maps</a></dd>`:""}
    <dt>Quay cho</dt><dd><a href="#/san-xuat/${o.ep}/ngay-${o.d}">Tập ${o.ep} · ${esc(ep.place)}</a></dd>
  </dl>`;
}

function vToday(v){
  const d = tripDay();
  const pick = `<label class="f small" style="max-width:260px">Xem thử như đang ở ngày
    <select id="preview">${[`<option value="">Hôm nay thật</option>`].concat(T.days.map(x=>`<option value="${x.d}" ${Number(S.previewDay)===x.d?"selected":""}>Ngày ${x.d} · ${x.date}</option>`)).join("")}</select></label>`;
  if (d < 1){
    const done = PREP.filter(([k])=>S.prep[k] && S.prep[k].done).length;
    v.innerHTML = `
    <section class="today-hero">
      <div>
        <p class="kicker">Trước chuyến đi</p>
        <h1 class="disp h-hero num">Còn ${1-d} ngày</h1>
        <p class="city">Bay Sài Gòn – Chiang Mai, thứ Hai 7/12, 13:25</p>
      </div>
      <img src="${img("thaphae")}" alt="Cổng Tha Phae, Chiang Mai">
    </section>
    <div class="tsplit"><div>
    <section class="sec">
      <div class="sec-head"><h2 class="disp h-sec">Việc trước khi bay</h2><span class="muted num">${done}/${PREP.length}</span></div>
      <div class="progress" style="margin-bottom:8px"><i class="lamp" style="width:${done/PREP.length*100}%"></i></div>
      ${checkList(PREP, "prep-")}
    </section>
    <section class="sec">
      <div class="sec-head"><h2 class="disp h-sec">Đồ quay</h2><span class="muted num">${GEAR.filter(([k])=>S.prep[k]&&S.prep[k].done).length}/${GEAR.length}</span></div>
      ${checkList(GEAR, "")}
    </section>
    </div><aside>
    <section class="sec">
      <div class="sec-head"><h2 class="disp h-sec">Ngày đầu tiên</h2><a class="btn small ghost" href="#/hanh-trinh">Cả hành trình</a></div>
      ${dayObj(1).img?`<img class="cover" src="${img(dayObj(1).img)}" alt="" loading="lazy">`:""}
      ${dayCard(dayObj(1))}
    </section>
    <section class="sec">${pick}</section>
    </aside></div>`;
  } else if (d > 28){
    v.innerHTML = `<section class="today-hero"><div><p class="kicker">Đã về</p><h1 class="disp h-hero">Mùa Thái Lan xong</h1><p class="city">Tổng chi ${fmtVND(spentTotal())}</p></div><img src="${img("watarun")}" alt=""></section>
    <section class="sec"><a class="btn lamp" href="#/san-xuat/8">Dựng tập 8</a></section><section class="sec">${pick}</section>`;
  } else {
    const o = dayObj(d), ep = epObj(o.ep), next = dayObj(d+1);
    const sp = spentDay(d), plan = (isHoliday(d)?T.daily.holiday:T.daily.normal); const planV = (plan.ngu+plan.an+plan.pho)*rate();
    v.innerHTML = `
    <section class="today-hero">
      <div>
        <p class="kicker">${esc(o.date)} · Tập ${o.ep}</p>
        <h1 class="disp h-hero num">Ngày ${d}</h1>
        <p class="city">${esc(o.city)}</p>
      </div>
      ${o.img?`<img src="${img(o.img)}" alt="${esc(o.city)}">`:`<img src="${img(ep.img)}" alt="">`}
    </section>
    <section class="sec">${dayCard(o)}</section>
    <section class="sec strip">
      <div class="sec-head" style="margin-bottom:10px"><h2 class="disp" style="font-size:24px">Quay hôm nay</h2><a class="btn small" href="#/san-xuat/${o.ep}/ngay-${d}">Mở bảng quay</a></div>
      <p id="todayShots" class="muted">Đang mở kịch bản…</p>
    </section>
    <section class="sec">
      <div class="sec-head"><h2 class="disp h-sec">Tiêu hôm nay</h2><span class="num">${fmtVND(sp)} <span class="muted">/ dự tính ${fmtVND(planV)}</span></span></div>
      <div class="progress"><i class="${sp>planV?"over":""}" style="width:${Math.min(100, planV? sp/planV*100:0)}%"></i></div>
      <div style="margin-top:18px">${addExpenseForm(d)}</div>
    </section>
    ${next?`<section class="sec"><div class="sec-head"><h2 class="disp h-sec">Ngày mai</h2><span class="muted">${esc(next.date)} · ${esc(next.city)}</span></div><p class="lead">${esc(next.todo)}</p>${next.move?`<p class="muted" style="margin-top:6px">Đi lại: ${esc(next.move)}</p>`:""}</section>`:""}
    <section class="sec">${pick}</section>`;
    loadScript(o.ep).then(sc => {
      const sec = sc.sections.find(s => s.day === d); const el = $("#todayShots"); if (!el) return;
      if (!sec){ el.textContent = "Không tìm thấy kịch bản ngày này."; return; }
      const tot = sec.beats.length, shot = sec.beats.filter(b => S.beats[b.key] && S.beats[b.key].shot).length;
      el.classList.remove("muted");
      el.innerHTML = `<b class="num">${shot}/${tot} cảnh</b> · ${esc(sec.q)}<br><span class="muted">${sec.beats.map(b=>esc(b.title)).join(" → ")}</span>`;
    });
  }
  bindCommon(v);
  v.querySelectorAll(".donebox").forEach(d => d.addEventListener("toggle", () => { S.showDone = d.open; }));
  const sel = $("#preview"); if (sel) sel.onchange = () => { S.previewDay = sel.value || null; LS.set("previewDay", S.previewDay); render(); };
  v.querySelectorAll("[data-prep]").forEach(c => c.onchange = () => put("prep", c.dataset.prep, {done:c.checked}));
}

function vTrip(v){
  const d = tripDay();
  v.innerHTML = `
  <section class="sec">
    <h1 class="disp h-hero">Hành trình</h1>
    <p class="lead" style="margin-top:12px;max-width:60ch">28 ngày, 8 tập. Bấm vào một ngày để xem đi đâu, sẽ thấy gì, và ghi lại chuyện trong ngày.</p>
  </section>
  ${T.episodes.map(ep => `
  <section class="ep-block">
    <div class="ep-title"><h2 class="disp" style="font-size:28px">Tập ${ep.n} · ${esc(ep.place)}</h2><a class="small" href="#/san-xuat/${ep.n}">Sản xuất</a></div>
    ${T.days.filter(x=>x.ep===ep.n).map(x=>{
      const st = x.d===d?"is-today":(x.d<d?"past":""); const note = S.days[x.d] && S.days[x.d].note;
      return `<button class="day-row ${st}" data-day="${x.d}">
        <span class="d num">${x.d}<small>${esc(x.date.split(" ").slice(-1)[0])}</small></span>
        <span><span class="t" style="font-weight:700">${esc(x.city)}</span>${x.d===d?'<span class="tag">hôm nay</span>':''}${note?'<span class="tag" style="background:var(--surface2);color:var(--ink)">có ghi chú</span>':''}<br><span class="${st==='is-today'?'':'muted'}">${esc(x.todo)}</span></span>
        ${x.img?`<img src="${img(x.img)}" alt="" loading="lazy">`:'<span class="ph"></span>'}
      </button>`;}).join("")}
  </section>`).join("")}`;
  v.querySelectorAll("[data-day]").forEach(b => b.onclick = () => openDay(Number(b.dataset.day)));
}

function openDay(d){
  const o = dayObj(d), note = (S.days[d] && S.days[d].note) || "";
  const sh = $("#sheet");
  sh.innerHTML = `
    <button class="btn small close" id="closeSheet">Đóng</button>
    ${o.img?`<img class="cover" src="${img(o.img)}" alt="${esc(o.city)}">`:""}
    <div class="in">
      <p class="muted">${esc(o.date)} · Tập ${o.ep}</p>
      <h2 class="disp" style="font-size:48px;margin:6px 0 4px">Ngày ${d}</h2>
      <p class="lead" style="margin-bottom:24px">${esc(o.city)}</p>
      ${dayCard(o)}
      <label class="f" style="margin-top:28px">Nhật ký ngày này
        <textarea id="dayNote" placeholder="Chuyện xảy ra, người đã gặp, giá thật, điều bất ngờ…">${esc(note)}</textarea></label>
      <div class="row" style="margin-top:10px"><button class="btn" id="saveNote">Lưu nhật ký</button>${dictBtn("dayNote")}</div>
      ${o.img&&T.credits[o.img]?`<p class="small muted" style="margin-top:24px">Ảnh minh họa: ${esc(T.credits[o.img].replace(/, Wikimedia Commons$/,''))}, Wikimedia Commons</p>`:""}
    </div>`;
  sh.classList.add("open"); $("#sheetBg").classList.add("open");
  const close = () => { sh.classList.remove("open"); $("#sheetBg").classList.remove("open"); };
  $("#closeSheet").onclick = close; $("#sheetBg").onclick = close;
  sh.querySelectorAll("a[href^='#/']").forEach(a => a.addEventListener("click", close));
  $("#saveNote").onclick = async () => { await put("days", String(d), {note: $("#dayNote").value}); toast("Đã lưu nhật ký ngày "+d); };
  bindDict(sh);
  $("#closeSheet").focus();
}
document.addEventListener("keydown", e => { if (e.key === "Escape"){ $("#sheet").classList.remove("open"); $("#sheetBg").classList.remove("open"); } });

let unit = LS.get("unit","baht");
function addExpenseForm(day){
  const d = day ?? Math.max(0, Math.min(28, tripDay()));
  return `<form class="add-grid" id="expForm">
    <label class="f">Số tiền<input type="number" inputmode="decimal" id="expAmt" min="0" step="any" required placeholder="${unit==="baht"?"150":"120000"}"></label>
    <div class="unit" role="group" aria-label="Đơn vị"><button type="button" data-unit="baht" aria-pressed="${unit==="baht"}">฿</button><button type="button" data-unit="vnd" aria-pressed="${unit==="vnd"}">đ</button></div>
    <label class="f">Khoản<select id="expCat">${T.budgetLines.map(b=>`<option value="${b.k}" ${b.k==="an"?"selected":""}>${esc(b.name)}</option>`).join("")}</select></label>
    <label class="f">Ngày<select id="expDay"><option value="0" ${d<1?"selected":""}>Trước chuyến</option>${T.days.map(x=>`<option value="${x.d}" ${x.d===d?"selected":""}>Ngày ${x.d}</option>`).join("")}</select></label>
    <label class="f note">Ghi chú<input type="text" id="expNote" placeholder="Khao soi ở Khao Soi Islam"></label>
    <button class="btn lamp wide" type="submit">Ghi khoản này</button>
  </form>`;
}
function bindCommon(root){
  root.querySelectorAll("[data-unit]").forEach(b => b.onclick = () => { unit = b.dataset.unit; LS.set("unit", unit); root.querySelectorAll("[data-unit]").forEach(x=>x.setAttribute("aria-pressed", x.dataset.unit===unit)); });
  const f = root.querySelector("#expForm");
  if (f) f.onsubmit = async ev => {
    ev.preventDefault();
    const raw = Number($("#expAmt").value); if (!raw) return;
    const amt = unit === "baht" ? raw*rate() : raw;
    const id = "e" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    const doc = {amt, baht: unit==="baht"?raw:null, cat:$("#expCat").value, day:Number($("#expDay").value), note:$("#expNote").value.trim(), at:Date.now()};
    $("#expAmt").value=""; $("#expNote").value="";
    await put("expenses", id, doc);
    toast("Đã ghi " + fmtVND(amt));
  };
}

function vMoney(v){
  const total = spentTotal(), list = expenseList().sort((a,b)=>b.day-a.day || b.at-a.at);
  const days = [...new Set(list.map(e=>e.day))];
  v.innerHTML = `
  <section class="sec">
    <p class="muted">Đã tiêu</p>
    <h1 class="disp big-money num">${fmtVND(total)}</h1>
    <p class="lead" style="margin-top:8px">trên mục tiêu ${fmtTr(T.budget)}, trần ${fmtTr(T.ceiling)}. Còn ${fmtVND(T.budget-total)}.</p>
    <div class="progress" style="margin-top:16px"><i class="${total>T.budget?"over":"lamp"}" style="width:${Math.min(100,total/T.budget*100)}%"></i></div>
  </section>
  <section class="sec strip">
    <h2 class="disp" style="font-size:24px;margin-bottom:14px">Ghi một khoản</h2>
    ${addExpenseForm()}
    <p class="small muted" style="margin-top:12px">Quy đổi 1 baht = <input type="number" id="rate" value="${rate()}" style="width:96px;min-height:44px;padding:8px;display:inline-block" aria-label="Tỷ giá"> đồng. Đổi tỷ giá chỉ áp dụng cho khoản ghi sau.</p>
  </section>
  <section class="sec">
    <h2 class="disp h-sec" style="margin-bottom:6px">Theo khoản</h2>
    ${T.budgetLines.filter(b=>b.plan||spentBy(b.k)).map(b=>{const s=spentBy(b.k);return `<div class="cat-row"><b>${esc(b.name)}</b><span class="num" style="text-align:right">${fmtVND(s)}<span class="muted"> / ${b.plan?fmtTr(b.plan):"—"}</span></span><div class="progress"><i class="${b.plan&&s>b.plan?"over":""}" style="width:${b.plan?Math.min(100,s/b.plan*100):0}%"></i></div></div>`}).join("")}
  </section>
  <section class="sec">
    <h2 class="disp h-sec">Sổ chi</h2>
    ${list.length?days.map(d=>`<div class="exp-day"><h3><span>${d?`Ngày ${d} · ${esc(dayObj(d).city)}`:"Trước chuyến"}</span> <span class="num muted" style="float:right">${fmtVND(spentDay(d))}</span></h3>
      ${list.filter(e=>e.day===d).map(e=>`<div class="exp"><span>${esc(e.note||T.budgetLines.find(b=>b.k===e.cat)?.name||"")}<br><span class="small muted">${esc(T.budgetLines.find(b=>b.k===e.cat)?.name||"")}${e.baht?` · ${e.baht.toLocaleString("vi-VN")} ฿`:""}</span></span><span class="num">${fmtVND(e.amt)}</span><button class="btn small ghost" data-del="${e.id}" aria-label="Xóa khoản này">Xóa</button></div>`).join("")}</div>`).join("")
      :`<p class="muted" style="margin-top:12px">Chưa có khoản nào. Khoản đầu tiên chắc là vé máy bay.</p>`}
  </section>
  <section class="sec">
    <h2 class="disp h-sec" style="margin-bottom:10px">Dự tính mỗi ngày</h2>
    <p>Ngày thường: ngủ 200 ฿, ăn 170 ฿, đi lại 70 ฿. Mùa lễ (20/12–2/1): ngủ 350 ฿. Nếu phải cắt giảm: bỏ Chiang Rai còn khoảng 14 triệu; bỏ cả Isan còn khoảng 12,5 triệu nhưng mất ba tập.</p>
  </section>`;
  bindCommon(v);
  v.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { if (confirm("Xóa khoản này?")) del("expenses", b.dataset.del); });
  const r = $("#rate"); r.dataset.keep="0"; r.onchange = () => { const x = Number(r.value); if (x>0) setRate(x); };
}

/* ---------- production ---------- */
let prodTab = LS.get("prodTab","quay");
function epStats(sc){
  let tot=0, shot=0, voice=0;
  sc.sections.forEach(s => s.beats.forEach(b => { tot++; const x=S.beats[b.key]; if (x&&x.shot) shot++; if (x&&x.voices&&x.voices.length) voice++; }));
  return {tot, shot, voice};
}
function vProd(v, r){
  const n = Number(r.a) || epObj((dayObj(Math.max(1,Math.min(28,tripDay())))||{}).ep||1)?.n || 1;
  const ep = epObj(n);
  const focusDay = r.b && r.b.startsWith("ngay-") ? Number(r.b.slice(5)) : null;
  if (focusDay) prodTab = "quay";
  const st = S.eps[n] || {};
  v.innerHTML = `
  <nav class="ep-tabs" aria-label="Chọn tập">${T.episodes.map(e=>`<a href="#/san-xuat/${e.n}" ${e.n===n?'aria-current="page"':''}><b>Tập ${e.n}</b><span>${esc(e.place)}</span></a>`).join("")}</nav>
  <section class="ep-head">
    <div>
      <p class="muted">Tập ${n} · ${esc(ep.place)} · ngày ${ep.days[0]}–${ep.days[1]} · đăng dự kiến ${ep.post}</p>
      <h1 class="disp" style="font-size:clamp(30px,4.6vw,44px);margin:10px 0 14px">${esc(ep.title)}</h1>
      <p id="epProg" class="muted">Đang mở kịch bản…</p>
    </div>
    <img src="${img(ep.img)}" alt="">
  </section>
  <div class="subnav" role="group" aria-label="Phần">
    <button data-tab="quay" aria-pressed="${prodTab==="quay"}">Quay</button>
    <button data-tab="kichban" aria-pressed="${prodTab==="kichban"}">Kịch bản</button>
    <button data-tab="dung" aria-pressed="${prodTab==="dung"}">Dựng</button>
    <button data-tab="dohoa" aria-pressed="${prodTab==="dohoa"}">Hiệu ứng</button>
  </div>
  <div id="prodBody"></div>`;
  v.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { prodTab = b.dataset.tab; LS.set("prodTab", prodTab); render(); });
  const cur = v.querySelector(".ep-tabs [aria-current]"); if (cur) cur.scrollIntoView({inline:"center", block:"nearest"});
  loadScript(n).then(sc => {
    if (route().k !== "san-xuat") return;
    const body = $("#prodBody"); if (!body) return;
    const s = epStats(sc);
    $("#epProg").innerHTML = `<span class="num"><b>${s.shot}/${s.tot}</b> cảnh đã quay · <b>${s.voice}</b> cảnh có giọng đọc</span><div class="progress" style="margin-top:8px"><i class="lamp" style="width:${s.tot?s.shot/s.tot*100:0}%"></i></div>`;
    if (sc.error){ body.innerHTML = `<p class="notice warn">Chưa mở được kịch bản tập này. <a href="${T.docUrl}" target="_blank" rel="noopener">Mở trong doc</a>.</p>`; return; }
    if (prodTab === "kichban") body.innerHTML = renderScript(sc);
    else if (prodTab === "dung") renderEdit(body, sc, n, st, s);
    else if (prodTab === "dohoa") renderEpFx(body, n);
    else renderShoot(body, sc, n, focusDay);
  });
}

function itemsHTML(items){
  return `<dl class="lines">${items.map(it=>`<dt>${esc(it.k||"·")}</dt><dd class="${/^(Nói|Hỏi)/.test(it.k)?"say":""}">${inline(it.v)}</dd>`).join("")}</dl>`;
}
function renderShoot(body, sc, n, focusDay){
  body.innerHTML = sc.sections.filter(s=>s.kind!=="list").map(s => `
    <section class="dsec" id="${s.day?"d"+s.day:"open"}">
      ${secTitle(s)}
      ${s.q?`<p class="q">${esc(s.q)}</p>`:""}
      ${s.beats.map(b => beatHTML(b, s)).join("")}
    </section>`).join("") + `<p class="small muted" style="margin-top:36px">Đánh dấu "đã quay" ngay sau mỗi cảnh. Ghi chú, clip và giọng đọc ở đây là thứ Claude dùng khi dựng.</p>`;
  bindBeats(body, sc, n);
  if (focusDay){ const el = document.getElementById("d"+focusDay); if (el) setTimeout(()=>el.scrollIntoView({block:"start"}), 50); }
}
function secTitle(s){
  const m = s.title.match(/^(Ngày \d+ · [^—]+?)\s+—\s+(.+)$/);
  return m ? `<p class="muted" style="font-weight:500">${esc(m[1])}</p><h2 class="disp" style="margin-top:4px">${esc(m[2])}</h2>` : `<h2 class="disp">${esc(s.title)}</h2>`;
}
function beatHTML(b, s){
  const x = S.beats[b.key] || {}; const say = b.items.find(i=>/^Nói/.test(i.k));
  const att = (x.clips||[]).length + (x.voices||[]).length;
  return `<details class="beat ${b.lamp?"lamp-beat":""}" data-key="${b.key}" ${x._open?"open":""}>
    <summary>
      <label class="shotbox" onclick="event.stopPropagation()"><input type="checkbox" class="shot" data-shot="${b.key}" ${x.shot?"checked":""} aria-label="Đã quay: ${esc(b.title)}"></label>
      <span><span class="bt">${esc(b.title)}</span>${placeOf(s,b)?`<br><span class="meta" style="font-weight:700">Ở: ${esc(placeOf(s,b)[0])}</span>`:""}<br><span class="meta">${say?esc(say.v.replace(/\*\*/g,"").slice(0,90))+(say.v.length>90?"…":""):b.items.length+" dòng"}</span></span>
      <span class="meta num">${x.note?"ghi chú · ":""}${att?att+" tệp":""}</span>
    </summary>
    <div class="body">
      ${placeHTML(placeOf(s, b))}
      ${itemsHTML(b.items)}
      <div class="tools">
        <label class="f">Ghi chú hiện trường (giá thật, câu nói thật, chỗ nên cắt)
          <textarea id="note-${b.key}" data-note="${b.key}">${esc(x.note||"")}</textarea></label>
        <div class="row"><button class="btn small" data-savenote="${b.key}">Lưu ghi chú</button>${dictBtn("note-"+b.key)}${S.sample?`<button class="btn small ghost" data-draft="${b.key}">Nhờ Claude viết lời lồng tiếng</button>`:""}</div>
        ${x.draft?`<div class="draft"><p class="small muted" style="margin-bottom:6px">Bản nháp lồng tiếng</p><p>${esc(x.draft)}</p></div>`:""}
        <div>
          <p class="small" style="font-weight:700;margin-bottom:6px">Clip và giọng đọc</p>
          <div class="att">${(x.clips||[]).map((c,i)=>`<span class="chip">Clip <a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name||c.url)}</a><button data-rm="${b.key}|clips|${i}" aria-label="Bỏ">×</button></span>`).join("")}
          ${(x.voices||[]).map((c,i)=>`<span class="chip">Giọng <audio controls preload="none" src="${esc(c.url)}" style="height:30px;max-width:200px"></audio><button data-rm="${b.key}|voices|${i}" aria-label="Bỏ">×</button></span>`).join("")}</div>
          <div class="row" style="margin-top:10px">
            <input type="url" id="link-${b.key}" placeholder="Dán link Google Drive của clip" style="flex:1;min-width:200px">
            <button class="btn small" data-addlink="${b.key}">Thêm link</button>
          </div>
          ${S.assets?`<div class="row" style="margin-top:10px">
            <label class="btn small ghost">Tải clip ngắn (dưới 20 MB)<input type="file" accept="video/*,image/*" data-up="${b.key}|clips" class="hidden"></label>
            <label class="btn small ghost">Tải file giọng đọc<input type="file" accept="audio/*" capture data-up="${b.key}|voices" class="hidden"></label>
            <button class="btn small ghost" data-rec="${b.key}">Thu giọng ngay</button>
          </div>`:`<p class="small muted" style="margin-top:8px">Tải tệp lên chỉ dùng được khi mở trang trong Claude với quyền chỉnh sửa. Clip dài thì để trên Google Drive rồi dán link.</p>`}
        </div>
      </div>
    </div>
  </details>`;
}
function credit(k){ return (window.PLACE_CREDITS||{})[k] || (T.credits[k]||"").replace(/, Wikimedia Commons$/,""); }
function placeOf(s, b){ const arr = (window.PLACES||{})[s.day]; return arr ? arr[b.idx] : null; }
function placeHTML(p){
  if (!p) return "";
  const [name, q, im, tip] = p;
  return `<div class="place">
    ${im?`<img src="${img(im)}" alt="${esc(name)}" loading="lazy">`:""}
    <div class="ptext">
      <p class="small muted">Đến đâu quay</p>
      <p class="pname">${esc(name)}</p>
      ${tip?`<p class="ptip">${esc(tip)}</p>`:""}
      ${q?`<a class="btn small lamp" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}" target="_blank" rel="noopener">Mở bản đồ</a>`:""}
      ${im?`<p class="small muted pcred">Ảnh tham khảo: ${esc(credit(im))}, Wikimedia Commons</p>`:""}
    </div>
  </div>`;
}
function beatByKey(sc, key){ for (const s of sc.sections) for (const b of s.beats) if (b.key===key) return {b,s}; }
function bindBeats(body, sc, n){
  body.querySelectorAll("details.beat").forEach(d => d.addEventListener("toggle", () => { const k=d.dataset.key; S.beats[k]=Object.assign({},S.beats[k]||{},{_open:d.open}); }));
  body.querySelectorAll("[data-shot]").forEach(c => c.onchange = () => put("beats", c.dataset.shot, {shot:c.checked, shotAt: c.checked?Date.now():null}));
  body.querySelectorAll("[data-savenote]").forEach(b => b.onclick = async () => { const k=b.dataset.savenote; await put("beats", k, {note: document.getElementById("note-"+k).value, _open:true}); toast("Đã lưu ghi chú"); });
  body.querySelectorAll("[data-addlink]").forEach(b => b.onclick = async () => {
    const k=b.dataset.addlink, el=document.getElementById("link-"+k), u=el.value.trim(); if(!/^https?:\/\//.test(u)){ toast("Link cần bắt đầu bằng https://"); return; }
    const x=S.beats[k]||{}; await put("beats", k, {clips:[...(x.clips||[]), {url:u, name:u.replace(/^https?:\/\//,"").slice(0,40)}], _open:true});
  });
  body.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => { const [k,f,i]=b.dataset.rm.split("|"); const x=S.beats[k]||{}; const arr=[...(x[f]||[])]; arr.splice(Number(i),1); await put("beats", k, {[f]:arr, _open:true}); });
  body.querySelectorAll("[data-up]").forEach(inp => inp.onchange = async () => {
    const [k,f] = inp.dataset.up.split("|"); const file = inp.files[0]; if (!file) return;
    if (file.size > 20*1024*1024){ toast("Tệp quá 20 MB. Để trên Google Drive rồi dán link."); return; }
    await uploadTo(k, f, file, file.name);
  });
  body.querySelectorAll("[data-rec]").forEach(b => b.onclick = () => record(b, b.dataset.rec));
  body.querySelectorAll("[data-draft]").forEach(b => b.onclick = () => draftVO(b, sc, b.dataset.draft));
  bindDict(body);
}
async function uploadTo(k, f, blob, name){
  if (!S.assets) return;
  toast("Đang tải lên…");
  try{
    const r = await S.assets.upload(blob);
    const x = S.beats[k]||{};
    await put("beats", k, {[f]:[...(x[f]||[]), {url:r.url, id:r.id, name}], _open:true});
    toast("Đã tải lên");
  }catch(e){ toast("Chưa tải lên được: " + (e && e.message ? e.message : "lỗi")); }
}
let rec = null;
async function record(btn, k){
  if (rec){ rec.stop(); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder){ toast("Trình duyệt này không thu âm được. Dùng nút tải file giọng đọc."); return; }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    const chunks = []; rec = new MediaRecorder(stream);
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = async () => { stream.getTracks().forEach(t=>t.stop()); const blob = new Blob(chunks, {type: rec.mimeType || "audio/webm"}); rec = null; btn.textContent = "Thu giọng ngay"; await uploadTo(k, "voices", blob, "giong-"+new Date().toLocaleTimeString("vi-VN")); };
    rec.start(); btn.textContent = "Dừng thu";
  }catch(e){ rec = null; toast("Không mở được micro ở đây. Thu bằng app ghi âm của điện thoại rồi tải file lên."); }
}
async function draftVO(btn, sc, k){
  const {b, s} = beatByKey(sc, k); const x = S.beats[k]||{};
  btn.disabled = true; btn.textContent = "Claude đang viết…";
  const prompt = `Bạn viết lời lồng tiếng cho kênh du lịch "Hải Đăng" (tiếng Việt, người kể xưng "mình", giọng chậm, thật, có duyên vừa đủ, không văn vẻ, không sáo rỗng, không dùng từ như "tuyệt vời", "hành trình", "khám phá"). Câu ngắn, dễ đọc thành tiếng.
Tập: ${sc.title}
Ngày: ${s.title}${s.q?` — câu hỏi của ngày: ${s.q}`:""}
Cảnh: ${b.title}
Kịch bản cảnh:
${b.items.map(i=>`- ${i.k}: ${i.v}`).join("\n")}
Ghi chú thực tế từ hiện trường (giá thật, chuyện thật): ${x.note || "(chưa có)"}
Yêu cầu: viết 2–4 câu lồng tiếng cho cảnh này, dùng số liệu và chi tiết thật trong ghi chú để điền vào chỗ ___. Nếu ghi chú chưa có số, giữ ___ chứ không tự bịa. Chỉ trả về lời lồng tiếng, không giải thích.`;
  try{
    const r = await S.sample(prompt, {modelTier:"default"});
    await put("beats", k, {draft: r.text.trim(), _open:true});
  }catch(e){
    if (e && e.code === "not_granted"){ S.sample = null; render(); }
    else toast(e && e.code === "rate_limited" ? "Hơi nhiều yêu cầu, đợi một chút." : "Claude chưa viết được, thử lại sau.");
    btn.disabled = false; btn.textContent = "Nhờ Claude viết lời lồng tiếng";
  }
}

function renderScript(sc){
  let h = `<article class="script"><h1 class="disp">${esc(sc.title)}</h1>`;
  sc.meta.forEach(m => h += `<p><b>${esc(m.k)}:</b> ${inline(m.v)}</p>`);
  sc.sections.forEach(s => {
    h += `<h2 class="disp">${esc(s.title)}</h2>`;
    if (s.q) h += `<p><em>${esc(s.q)}</em></p>`;
    s.beats.forEach(b => { h += `<p class="beat-t">${esc(b.title)}</p><ul>${b.items.map(i=>`<li>${i.k?`<b>${esc(i.k)}:</b> `:""}${inline(i.v)}</li>`).join("")}</ul>`; });
    if (s.list.length) h += `<ul>${s.list.map(x=>`<li>${inline(x)}</li>`).join("")}</ul>`;
  });
  return h + `<p class="small muted" style="margin-top:32px">Bản gốc ở <a href="${T.docUrl}" target="_blank" rel="noopener">doc kế hoạch</a>. Sửa kịch bản ở doc rồi nhờ Claude cập nhật Studio.</p></article>`;
}


const GFX = [
  ["Mở tập", "3 giây", "Đặt sau 10–20 giây đầu của tập, khi người xem đã vào chuyện. Không mở video bằng logo.",
   ["Cảnh quay tối lại còn 38% độ sáng trong 0,5 giây, đồng thời phóng to chậm 105% trong suốt đoạn.",
    "Ngọn đèn bật ở góc trên bên trái (cách mép trái 90 px, mép trên 70 px trên khung 1280×720) lúc 0,25 giây, phồng nhẹ rồi về cỡ, kèm một vòng sáng lan ra và tan.",
    "Tia đèn vươn dài ra từ đèn trong lúc xoay từ −6° xuống 32°, rồi lùi về 30° (1,05 giây).",
    "Chữ chạy ra ở chỗ tia rọi: logo lúc 1,05 giây, chữ \"hải đăng\" lúc 1,13 giây, tên tập lúc 1,28 giây. Chữ hiện dần kèm trượt nhẹ, không bị cắt mất dấu.",
    "Tia thu về đèn lúc 1,2 giây, đèn tắt lúc 1,9 giây. Chữ đứng tới giây thứ 3 rồi rời đi theo thứ tự ngược lại."]],
  ["Sang ngày mới", "2,5 giây", "Dùng giữa mọi ngày trong tập. Đây là động tác để người xem nhận ra kênh.",
   ["Cảnh cuối ngày tối đi 50%, đèn bật ở góc trên, tia xoay xuống 24°.",
    "Tia thu lại, dải vàng hình tia đèn bắn ra từ bên trái (0,56 giây), chữ \"Ngày N\" cùng thứ, ngày, nơi hiện ra.",
    "Số ngày lật lên số mới lúc 1,15 giây, có độ nảy nhẹ khi dừng.",
    "Cảnh sáng hôm sau hiện ra phía sau dải vàng, hơi to rồi lùi về đúng chỗ.",
    "Chữ rời đi trước (1,88 giây), dải vàng trượt ra bên phải sau (1,98 giây)."]],
  ["Chữ dưới màn hình", "1 giây vào, 0,3 giây ra", "Tên nơi chốn ở góc trái dưới, thẻ giá ở góc phải dưới.",
   ["Khối vàng (tên nơi) trượt ra từ trong khung, khối đen (chú thích) theo sau 0,1 giây.",
    "Thẻ giá làm ngược chiều, vào sau tên nơi 0,55 giây.",
    "Giá luôn ghi cả baht lẫn đồng, đúng số đã trả.",
    "Rời đi theo thứ tự ngược lại, mỗi khối 0,26–0,28 giây."]],
  ["Đèn của ngày", "4 giây", "Cảnh cuối mỗi ngày, ngay trước câu dẫn sang ngày mai.",
   ["Cảnh tối dần còn 15% độ sáng trong 1 giây.",
    "Chấm đèn bật lúc 0,8 giây. Trong video thật, đặt chấm đèn đúng vào nguồn sáng có trong cảnh quay tối đó.",
    "Tia quét một lượt ở nửa trên khung (từ −170° tới −10°, 1,5 giây), không đi qua chỗ có chữ.",
    "\"Đèn của ngày\" hiện lúc 2,45 giây, câu dẫn sang ngày mai lúc 2,57 giây."]]
];
function renderEdit(body, sc, n, st, s){
  const req = st.request;
  const steps = [
    [s.shot===s.tot && s.tot>0, `Quay đủ cảnh`, `${s.shot}/${s.tot} cảnh đã đánh dấu.`],
    [s.voice>0, `Có giọng đọc`, `${s.voice} cảnh có file giọng. Lồng tiếng thu sau cũng được.`],
    [!!st.drive, `Footage đã lên Google Drive`, st.drive?`<a href="${esc(st.drive)}" target="_blank" rel="noopener">Mở thư mục</a>`:`Dán link thư mục chứa toàn bộ clip của tập này.`],
    [!!st.finalTitle, `Chốt tiêu đề và chữ thumbnail`, st.finalTitle?esc(st.finalTitle):`Tiêu đề trong kịch bản: ${esc(epObj(n).title)}`],
    [!!req, `Gửi Claude dựng`, req?`Đã gửi lúc ${new Date(req.at).toLocaleString("vi-VN")}. Trạng thái: ${esc(req.status||"chờ dựng")}.`:`Bấm nút bên dưới khi đã đủ footage.`]
  ];
  body.innerHTML = `
  <ul class="pipeline">${steps.map(([ok,t,d])=>`<li class="${ok?"ok":""}"><span class="dot" aria-hidden="true"></span><span><b>${t}</b><br><span class="muted">${d}</span></span></li>`).join("")}</ul>
  <section class="sec grid2">
    <div style="display:grid;gap:14px">
      <label class="f">Link thư mục Google Drive của tập ${n}<input type="url" id="epDrive" value="${esc(st.drive||"")}" placeholder="https://drive.google.com/…"></label>
      <label class="f">Tiêu đề chốt<input type="text" id="epTitle" value="${esc(st.finalTitle||"")}" placeholder="${esc(epObj(n).title)}"></label>
      <label class="f">Chữ trên thumbnail (tối đa 6 chữ)<input type="text" id="epThumb" value="${esc(st.thumb||"")}" placeholder="mì này không phải của Thái"></label>
      <label class="f">Dặn thêm cho người dựng<textarea id="epNote" placeholder="Cảnh nào thích nhất, đoạn nào bỏ, nhạc kiểu gì…">${esc(st.note||"")}</textarea></label>
      <div class="row"><button class="btn" id="epSave">Lưu</button></div>
    </div>
    <div>
      <h2 class="disp" style="font-size:26px;margin-bottom:10px">Gửi Claude dựng</h2>
      <p>Studio gom kịch bản, ghi chú hiện trường, giọng đọc và link footage thành một phiếu dựng. Sau đó bạn nhắn Claude trong project Hải Đăng:</p>
      <p class="notice" style="margin:14px 0;font-weight:700">Dựng tập ${n} từ Studio</p>
      <p class="muted">Claude đọc phiếu này, lấy clip từ Drive, dựng theo thứ tự kịch bản, chèn chữ dưới màn hình và chuyển cảnh theo bộ nhận diện, rồi gửi bản xem trước để bạn duyệt.</p>
      <button class="btn lamp" id="epSend" style="margin-top:18px" ${!st.drive?"disabled":""}>${req?"Gửi lại phiếu dựng":"Gửi Claude dựng tập "+n}</button>
      ${!st.drive?`<p class="small muted" style="margin-top:8px">Cần link Google Drive trước.</p>`:""}
    </div>
  </section>
  <section class="sec">
    <h2 class="disp h-sec" style="margin-bottom:10px">TikTok từ tập này</h2>
    <ul class="check">${(sc.sections.find(x=>/^TikTok/.test(x.title))||{list:[]}).list.map((t,i)=>{const ok=st.tiktok&&st.tiktok[i];return `<li class="${ok?"done":""}"><input type="checkbox" id="tt${i}" data-tt="${i}" ${ok?"checked":""}><label for="tt${i}"><span>${inline(t)}</span></label></li>`}).join("")}</ul>
  </section>`;
  const save = async (extra={}) => put("eps", String(n), Object.assign({drive:$("#epDrive").value.trim(), finalTitle:$("#epTitle").value.trim(), thumb:$("#epThumb").value.trim(), note:$("#epNote").value}, extra));
  $("#epSave").onclick = async () => { await save(); toast("Đã lưu"); };
  $("#epSend").onclick = async () => {
    const beats = {}; sc.sections.forEach(x=>x.beats.forEach(b=>{ const y=S.beats[b.key]; if(y) beats[b.key]={title:b.title, shot:!!y.shot, note:y.note||"", clips:y.clips||[], voices:y.voices||[], draft:y.draft||""}; }));
    await save({request:{at:Date.now(), status:"chờ dựng", beats}});
    toast("Đã gửi phiếu dựng tập "+n);
  };
  body.querySelectorAll("[data-tt]").forEach(c => c.onchange = () => { const t = Object.assign({}, st.tiktok||{}, {[c.dataset.tt]:c.checked}); put("eps", String(n), {tiktok:t}); });
}

/* ---------- dictation ---------- */
function dictBtn(target){ return S.dictation ? `<button class="btn small ghost" type="button" data-dict="${target}">Nói thay gõ</button>` : ""; }
let dictOn = null;
function bindDict(root){
  root.querySelectorAll("[data-dict]").forEach(b => b.onclick = () => {
    const d = S.dictation; const ta = document.getElementById(b.dataset.dict); if (!d || !ta) return;
    if (dictOn){ d.stop(); return; }
    const base = ta.value ? ta.value.replace(/\s*$/," ") : "";
    let acc = "";
    d.onPartial(({text}) => { ta.value = base + acc + text; });
    d.onFinal(({text}) => { acc += text + " "; ta.value = base + acc; });
    d.onState(({state}) => { if (state === "idle"){ dictOn = null; b.textContent = "Nói thay gõ"; } else { dictOn = true; b.textContent = "Dừng nghe"; } });
    d.start().catch(e => { dictOn = null; b.textContent = "Nói thay gõ"; if (e && e.code === "not_granted") { S.dictation = null; render(); } });
  });
}

/* ---------- hiệu ứng ---------- */
const pad2 = n => String(n).padStart(2, "0");
const CANALPHA = (() => { try{ const safari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent) || /iPhone|iPad/.test(navigator.userAgent); return !safari && !!document.createElement("video").canPlayType('video/webm; codecs="vp9"'); }catch(e){ return false; } })();
const TRANS = [["tia_den","Tia đèn","Dải vàng quét ngang theo hướng tia đèn. Dùng khi đổi nơi trong cùng một ngày."],["man_dem","Màn đêm","Màn mực kéo xuống, một vạch vàng chạy theo. Dùng khi từ chiều sang tối."],["den_chop","Đèn chớp","Vòng sáng nở ra từ góc đèn rồi thu lại. Dùng cho khoảnh khắc bất ngờ."],["song_bien","Sóng biển","Lớp màu biển dâng lên như con sóng. Dùng khi tới chỗ có nước: sông, biển, hồ."]];
function fxItem(o){
  // o: {webm, poster, bg, title, desc, links:[[label,url]], tall}
  return `<div class="fxc${o.tall?" tall":""}">
    <button class="fxv${o.tall?" tall":""}" type="button" data-big="${o.id}" style="background-image:url('${o.bg}')" aria-label="Xem to: ${esc(o.title)}">
      <img class="pf" src="${o.poster}" alt="" loading="lazy">${CANALPHA?`<video muted loop playsinline preload="none" data-src="${o.webm}"></video>`:""}
    </button>
    <b>${esc(o.title)}</b>${o.desc?`<span class="d">${esc(o.desc)}</span>`:""}
    <div class="fxl">${o.links.map(([l,u])=>`<a href="${u}" download="haidang_${u.split("/").pop()}" target="_blank" rel="noopener">${l}</a>`).join("")}</div>
  </div>`;
}
const FXI = {};
function reg(o){ FXI[o.id] = o; return fxItem(o); }
const fxTrans = k => { const t = TRANS.find(x=>x[0]===k); return reg({id:"t-"+k, webm:`fx/youtube/chuyen_canh_${k}.webm`, poster:`fx/poster/chuyen_canh_${k}.webp`, bg:img("thaphae"), title:t[1], desc:t[2], links:[["YouTube nền xanh",`fx/youtube/chuyen_canh_${k}_nenxanh.mp4`],["TikTok nền xanh",`fx/tiktok/chuyen_canh_${k}_nenxanh.mp4`],["Nền trong",`fx/youtube/chuyen_canh_${k}.webm`]]}); };
const fxOpen = e => reg({id:"o-"+e.n, webm:`fx/youtube/mo_tap_${e.n}.webm`, poster:`fx/poster/mo_tap_${e.n}.webp`, bg:img(e.img), title:`Tập ${e.n} · ${e.place}`, links:[["Nền xanh",`fx/youtube/mo_tap_${e.n}_nenxanh.mp4`],["Nền trong",`fx/youtube/mo_tap_${e.n}.webm`]]});
const fxDay = x => reg({id:"d-"+x.d, webm:`fx/youtube/the_ngay/the_ngay_${pad2(x.d)}.webm`, poster:`fx/poster/the_ngay_${pad2(x.d)}.webp`, bg:img(x.img || epObj(x.ep).img), title:`Ngày ${x.d} · ${x.date}`, links:[["Nền xanh",`fx/youtube/the_ngay/the_ngay_${pad2(x.d)}_nenxanh.mp4`],["Nền trong",`fx/youtube/the_ngay/the_ngay_${pad2(x.d)}.webm`]]});
const fxLamp = () => reg({id:"lamp", webm:"fx/youtube/den_cua_ngay.webm", poster:"fx/poster/den_cua_ngay.webp", bg:img("chedi"), title:"Đèn của ngày", desc:"3,4 giây, cảnh cuối mỗi ngày. Câu dẫn sang ngày mai gõ thêm khi dựng.", links:[["Nền xanh","fx/youtube/den_cua_ngay_nenxanh.mp4"],["Nền trong","fx/youtube/den_cua_ngay.webm"]]});

function steps3(){
  return `<ol class="steps3">
    <li><b>Lấy bản nền xanh</b><span>Bấm “Nền xanh” dưới hiệu ứng, lưu về máy.</span></li>
    <li><b>Đặt lên trên clip</b><span>Thêm vào lớp phủ (Overlay). Chuyển cảnh: kéo cho giữa đoạn nằm đúng chỗ nối hai clip.</span></li>
    <li><b>Xóa nền xanh</b><span>CapCut: Xóa nền → Chroma key → chấm vào màu xanh. Premiere: Ultra Key.</span></li>
  </ol>`;
}

function renderEpFx(body, n){
  const ep = epObj(n), days = T.days.filter(x=>x.ep===n);
  body.innerHTML = `
  <p class="lead" style="max-width:62ch">Hiệu ứng dùng trong tập ${n}. Bấm vào khung để xem to. Cả bộ (chuyển cảnh, kết tập, TikTok) ở mục <a href="#/hieu-ung">Hiệu ứng</a>.</p>
  <div class="fxgrid" style="margin-top:20px">${fxOpen(ep)}${days.map(fxDay).join("")}${fxLamp()}</div>
  <section class="sec">
    <h2 class="disp h-sec" style="margin-bottom:6px">Chuyển động mẫu</h2>
    <p class="muted" style="margin-bottom:14px">Bản chạy được, đã điền tên và ngày của tập ${n}. "Xem chậm" để soi từng động tác.</p>
    <div style="background:var(--surface)"><iframe src="motion.html?ep=${n}" title="Chuyển động tập ${n}" style="display:block;width:100%;height:520px;border:0"></iframe></div>
    <p class="small muted" style="margin-top:8px">Ảnh trong bản mẫu là ảnh minh họa từ Wikimedia Commons. <a href="motion.html?ep=${n}" target="_blank" rel="noopener">Mở toàn màn hình</a></p>
  </section>
  <section class="sec">
    <h2 class="disp h-sec" style="margin-bottom:6px">Thông số cho người dựng</h2>
    <p class="muted" style="margin-bottom:8px">Một bộ nhịp cho cả kênh: vào nhanh rồi dừng êm (cubic-bezier .16, 1, .3, 1), ra chậm rồi tăng tốc (.7, 0, .84, 0), đi từ A sang B (.65, 0, .35, 1). Không nảy, không chớp.</p>
    ${GFX.map(([t,d,w,steps])=>`<details class="beat"><summary style="grid-template-columns:minmax(0,1fr)"><span><span class="bt">${t}</span><br><span class="meta">${d} · ${w}</span></span></summary><div class="body" style="padding-left:16px"><ol style="margin:0;padding-left:20px">${steps.map(x=>`<li style="margin:6px 0">${esc(x)}</li>`).join("")}</ol></div></details>`).join("")}
  </section>`;
  fxWire(body);
  const fr = body.querySelector("iframe");
  const fit = () => { try{ const w = fr.contentDocument.querySelector(".wrap"); fr.style.height = ((w ? w.offsetHeight : fr.contentDocument.body.scrollHeight) + 4) + "px"; }catch(e){} };
  fr.addEventListener("load", () => { fit(); setTimeout(fit, 400); try{ fr.contentWindow.addEventListener("resize", fit); }catch(e){} });
}

function vFx(v, r){
  const eps = T.episodes;
  v.innerHTML = `
  <section class="fx-hero">
    <h1 class="disp h-hero">Hiệu ứng</h1>
    <p class="lead">Phần lớn tập dài là cắt thẳng theo hành động. Hiệu ứng chỉ dùng ở bốn chỗ: mở tập, sang ngày mới, đổi nơi, cuối tập. Bấm vào khung để xem to.</p>
  </section>
<nav class="jump" aria-label="Đi tới">${[["chuyen-canh","Chuyển cảnh"],["mo-tap","Mở tập"],["the-ngay","Thẻ ngày"],["cuoi","Cuối tập"],["mau","Mẫu tĩnh"],["nhan-dien","Nhận diện"]].map(([k,t])=>`<a href="#${k}" data-jump="${k}">${t}</a>`).join("")}</nav>

  <section class="sec strip">
    <h2 class="disp" style="font-size:24px;margin-bottom:14px">Dùng trong CapCut</h2>
    ${steps3()}
    <p class="small muted" style="margin-top:12px">Bản “nền trong” (.webm) cho trình dựng đọc được nền trong suốt, như DaVinci Resolve. YouTube 1920×1080, TikTok 1080×1920, 30 khung/giây.</p>
  </section>
  <section class="sec" id="chuyen-canh">
    <div class="sec-head"><h2 class="disp h-sec">Chuyển cảnh</h2><span class="muted">1 giây</span></div>
    <p class="muted" style="margin:-8px 0 16px">Giữa đoạn, hiệu ứng che kín khung. Cắt sang cảnh mới đúng chỗ đó.</p>
    <div class="fxgrid">${TRANS.map(([k])=>fxTrans(k)).join("")}</div>
  </section>
  <section class="sec" id="mo-tap">
    <div class="sec-head"><h2 class="disp h-sec">Mở tập</h2><span class="muted">3,4 giây</span></div>
    <p class="muted" style="margin:-8px 0 16px">Đặt sau 10–20 giây đầu, khi người xem đã vào chuyện. Không mở video bằng logo.</p>
    <div class="fxgrid">${eps.map(fxOpen).join("")}</div>
  </section>
  <section class="sec" id="the-ngay">
    <div class="sec-head"><h2 class="disp h-sec">Thẻ ngày</h2><span class="muted">2,5 giây</span></div>
    <p class="muted" style="margin:-8px 0 4px">Cảnh đầu mỗi ngày. Số ngày lật từ hôm trước sang.</p>
    ${eps.map(e=>`<h3 class="fxh">Tập ${e.n} · ${esc(e.place)}</h3><div class="fxgrid">${T.days.filter(x=>x.ep===e.n).map(fxDay).join("")}</div>`).join("")}
  </section>
  <section class="sec" id="cuoi">
    <h2 class="disp h-sec" style="margin-bottom:16px">Cuối ngày, cuối tập, cuối clip</h2>
    <div class="fxgrid">
      ${fxLamp()}
      ${reg({id:"end", webm:"fx/youtube/ket_tap_youtube.mp4", poster:"fx/poster/ket_tap_youtube.webp", bg:img("thaphae"), title:"Kết tập YouTube", desc:"8 giây, nền đặc. Hai ô bên phải và vòng tròn là chỗ gắn màn hình kết của YouTube.", links:[["Tải về","fx/youtube/ket_tap_youtube.mp4"]], solid:true})}
      ${reg({id:"tt", webm:"fx/tiktok/tiktok_ket.webm", poster:"fx/poster/tiktok_ket.webp", bg:img("paiwalk"), title:"Cuối clip TikTok", desc:"2,5 giây, dọc. Ghép vào cuối mỗi clip TikTok cắt từ tập dài.", links:[["Nền xanh","fx/tiktok/tiktok_ket_nenxanh.mp4"],["Nền trong","fx/tiktok/tiktok_ket.webm"]], tall:true})}
    </div>
  </section>
  <section class="sec" id="mau">
    <h2 class="disp h-sec" style="margin-bottom:16px">Mẫu tĩnh</h2>
    <div class="tgrid">
      ${[["thumbnail-mau.jpg","Thumbnail 1280×720"],["chu-duoi-man-hinh.jpg","Chữ dưới màn hình"],["man-hinh-ket.jpg","Màn hình kết"],["anh-bia-youtube.jpg","Ảnh bìa YouTube 2560×1440"],["anh-dai-dien.jpg","Ảnh đại diện"],["logo-va-mau.jpg","Logo và màu"]].map(([f,c])=>`<figure><a href="brand/${f}" target="_blank" rel="noopener"><img src="brand/${f}" alt="${c}" loading="lazy"></a><figcaption>${c}</figcaption></figure>`).join("")}
    </div>
    <p class="small muted" style="margin-top:12px">Bản xem nhanh. File gốc sửa được nằm ở <a href="${T.brandUrl}" target="_blank" rel="noopener">bộ nhận diện</a>.</p>
  </section>
  <section class="sec brand-band" id="nhan-dien">
    <svg width="120" height="80" style="color:var(--ink)" aria-hidden="true"><use href="#mark"/></svg>
    <h2 class="disp" style="font-size:clamp(48px,9vw,96px);margin-top:14px">hải đăng</h2>
    <p class="lead" style="margin-top:8px">Mỗi nơi một câu chuyện.</p>
  </section>
  <section class="sec grid2">
    <div>
      <h2 class="disp h-sec" style="margin-bottom:12px">Kênh</h2>
      <dl class="facts" style="grid-template-columns:110px minmax(0,1fr)">
        <dt>Tên</dt><dd>Hải Đăng</dd>
        <dt>Tài khoản</dt><dd>@haidangkechuyen (dự phòng @haidang.didau)</dd>
        <dt>Series</dt><dd>Hải Đăng · Thái Lan, #haidangthailan</dd>
        <dt>Dấu riêng</dt><dd>"Đèn của ngày" cuối mỗi ngày; "Một món, một lý do" cho món ăn</dd>
        <dt>Giọng kể</dt><dd>Chậm, thật, có duyên vừa đủ, không kể khổ</dd>
      </dl>
    </div>
    <div>
      <h2 class="disp h-sec" style="margin-bottom:12px">Màu và chữ</h2>
      <div class="swatch"><div style="background:#FFC83D">Đèn<br>#FFC83D</div><div style="background:#121A1F;color:#FAF8F3">Mực<br>#121A1F</div><div style="background:#FAF8F3;outline:1px solid var(--line)">Giấy<br>#FAF8F3</div><div style="background:#1E4A5A;color:#FAF8F3">Biển<br>#1E4A5A</div></div>
      <p style="margin-top:14px">Tiêu đề: <b class="disp" style="font-size:20px">Bricolage Grotesque 800</b>. Chữ thường: <b>Be Vietnam Pro</b>.</p>
    </div>
  </section>
  <section class="sec">
    <h2 class="disp h-sec" style="margin-bottom:14px">Tài liệu gốc</h2>
    <div class="btn2">
      <a class="btn" href="${T.docUrl}" target="_blank" rel="noopener">Doc kế hoạch và kịch bản</a>
      <a class="btn ghost" href="${T.brandUrl}" target="_blank" rel="noopener">Bộ nhận diện</a>
    </div>
  </section>`;
  fxWire(v);
  const jl = [...v.querySelectorAll("[data-jump]")];
  if ("IntersectionObserver" in window){
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting){ jl.forEach(a => a.setAttribute("aria-current", a.dataset.jump === e.target.id)); const a = jl.find(a=>a.dataset.jump===e.target.id); if (a) a.parentNode.scrollTo({left:a.offsetLeft-18, behavior:"auto"}); } }), {rootMargin:"-45% 0px -50% 0px"});
    jl.forEach(a => { const el = document.getElementById(a.dataset.jump); if (el) io.observe(el); });
  }
  v.querySelectorAll("[data-jump]").forEach(a => a.onclick = ev => { ev.preventDefault(); const el = document.getElementById(a.dataset.jump); if (el) window.scrollTo({top: el.getBoundingClientRect().top + scrollY - (innerWidth < 900 ? 120 : 70)}); });
  if (r && r.k === "kenh") setTimeout(() => { const el = document.getElementById("nhan-dien"); if (el) el.scrollIntoView(); }, 30);
}

let fxIO = null;
function fxWire(root){
  if (fxIO) fxIO.disconnect();
  if (CANALPHA && "IntersectionObserver" in window){
    fxIO = new IntersectionObserver(es => es.forEach(e => {
      const vd = e.target;
      if (e.isIntersecting){ if (!vd.src && vd.dataset.src) vd.src = vd.dataset.src; vd.play().catch(()=>{}); }
      else if (!vd.paused) vd.pause();
    }), {rootMargin:"120px"});
    root.querySelectorAll(".fxv video[data-src]").forEach(vd => { fxIO.observe(vd); vd.addEventListener("playing", () => vd.parentNode.classList.add("playing")); vd.addEventListener("pause", () => vd.parentNode.classList.remove("playing")); });
  }
  root.querySelectorAll("[data-big]").forEach(b => b.onclick = () => openFx(FXI[b.dataset.big]));
}
function openFx(o){
  if (!o) return;
  const sh = $("#sheet");
  const src = CANALPHA || o.solid ? o.webm : null;
  sh.innerHTML = `
    <button class="btn small close" id="closeSheet">Đóng</button>
    <div class="in">
      <h2 class="disp" style="font-size:32px;margin:4px 70px 14px 0">${esc(o.title)}</h2>
      <div class="fxv big${o.tall?" tall":""}" style="background-image:url('${o.bg}')">${src?`<video src="${src}" autoplay muted loop playsinline controls></video>`:`<img class="pf" src="${o.poster}" alt=""><canvas id="keyCv"></canvas>`}</div>
      ${o.desc?`<p style="margin-top:14px">${esc(o.desc)}</p>`:""}
      <div class="fxl" style="margin-top:14px">${o.links.map(([l,u])=>`<a href="${u}" download="haidang_${u.split("/").pop()}" target="_blank" rel="noopener">${l}</a>`).join("")}</div>
    </div>`;
  sh.classList.add("open","fxsheet"); $("#sheetBg").classList.add("open");
  const close = () => { sh.classList.remove("open","fxsheet"); $("#sheetBg").classList.remove("open"); sh.innerHTML = ""; };
  $("#closeSheet").onclick = close; $("#sheetBg").onclick = close;
  $("#closeSheet").focus();
  if (!src) keyPlay(o.links[0][1], $("#keyCv"), sh);
}
/* Safari không chạy webm nền trong: chạy bản nền xanh rồi tự tách nền trên canvas */
function keyPlay(url, cv, sh){
  if (!cv) return;
  const vd = document.createElement("video"); vd.muted = true; vd.loop = true; vd.playsInline = true; vd.setAttribute("playsinline",""); vd.src = url;
  const ctx = cv.getContext("2d", {willReadFrequently:true});
  let on = true;
  const step = () => {
    if (!on || !sh.classList.contains("open")){ vd.pause(); vd.removeAttribute("src"); return; }
    if (vd.readyState >= 2 && vd.currentTime > 0){
      const w = cv.width = Math.min(960, vd.videoWidth), h = cv.height = Math.round(vd.videoHeight * w / vd.videoWidth);
      ctx.drawImage(vd, 0, 0, w, h);
      const im = ctx.getImageData(0, 0, w, h), d = im.data;
      for (let i = 0; i < d.length; i += 4){ const r = d[i], g = d[i+1], b = d[i+2]; if (g > 90 && g > r * 1.35 && g > b * 1.35){ d[i+3] = 0; } else if (g > r && g > b){ d[i+1] = Math.max(r, b); } }
      ctx.putImageData(im, 0, 0);
      cv.parentNode.classList.add("playing");
    }
    requestAnimationFrame(step);
  };
  vd.play().then(() => requestAnimationFrame(step)).catch(() => { on = false; });
}

/* ---------- bản mới ---------- */
(function(){
  let cur = null;
  const check = async () => { try{ const r = await fetch("version.json?t=" + Date.now(), {cache:"no-store"}); if (!r.ok) return; const v = (await r.json()).v; if (cur && v !== cur) location.reload(); cur = v; }catch(e){} };
  if (location.protocol.startsWith("http") && (!window.claude || window.claude.web)) { check(); window.addEventListener("hashchange", check); document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); }); }
})();

boot();
