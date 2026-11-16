(function(){
"use strict";
const SB = "https://lpiwmdomdzebzhmxzesn.supabase.co", KEY = "sb_publishable_6H1om-emHz6RrLBy1guQfg_PfGyseKE", SALT = "2b734bebc02a061eb5e33a10c6a9bd8e", ITER = 310000;
const hex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
let PASS = null, AES = null;
async function rpc(fn, args){
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {method:"POST", headers:{"apikey":KEY, "Content-Type":"application/json"}, body:JSON.stringify(args)});
  if (!r.ok){ const e = new Error("rpc " + r.status); e.status = r.status; throw e; }
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
async function deriveKey(p){
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(p), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2", salt:hex(SALT), iterations:ITER, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, false, ["decrypt"]);
}
async function dec(buf){
  const u = new Uint8Array(buf);
  const pt = await crypto.subtle.decrypt({name:"AES-GCM", iv:u.slice(0,12)}, AES, u.slice(12));
  return new TextDecoder().decode(pt);
}
window.HD_DEC = dec;

/* db cùng kiểu với Claude, chạy trên Supabase */
const listeners = {}, sigs = {}; let polling = null;
async function poll(){
  if (polling) return polling;
  polling = (async () => {
    try{
      const rows = await rpc("hd_list", {p:PASS}) || [];
      const by = {}; rows.forEach(r => { if (!r.deleted) (by[r.col] = by[r.col] || []).push(r); });
      Object.keys(listeners).forEach(c => {
        const sig = JSON.stringify((by[c] || []).map(r => [r.id, r.updated_at]));
        if (sigs[c] === sig) return;   /* không có gì mới thì không vẽ lại trang */
        sigs[c] = sig;
        const docs = (by[c] || []).map(r => ({id:r.id, data:() => r.data}));
        listeners[c].forEach(l => { try{ l.cb({docs, metadata:{fromCache:false}}); }catch(e){ console.error(e); } });
      });
    }catch(e){
      Object.values(listeners).flat().forEach(l => l.err && l.err(e));
      if (e.status === 400 || e.status === 401){ try{ localStorage.removeItem("hd:pass"); }catch(_){} }
    }finally{ polling = null; }
  })();
  return polling;
}
let soonT = null; const soon = () => { clearTimeout(soonT); soonT = setTimeout(poll, 400); };
const db = Object.freeze({
  collection: c => ({ onSnapshot(cb, err){ (listeners[c] = listeners[c] || []).push({cb, err}); delete sigs[c]; soon(); return () => { listeners[c] = listeners[c].filter(x => x.cb !== cb); }; } }),
  doc: path => { const [c, ...rest] = path.split("/"); const id = rest.join("/");
    return { set: async data => { await rpc("hd_put", {p:PASS, c, i:id, d:data}); soon(); },
             delete: async () => { await rpc("hd_del", {p:PASS, c, i:id}); soon(); } }; }
});
window.claude = Object.freeze({ use: async name => name === "db" ? db : null, web: true });
document.addEventListener("visibilitychange", () => { if (!document.hidden && PASS) poll(); });

async function enter(p, remember){
  const ok = await rpc("hd_check", {p});
  if (!ok) return false;
  PASS = p; AES = await deriveKey(p);
  const r = await fetch("trip.enc?v=202611162000"); const js = await dec(await r.arrayBuffer());
  (new Function(js))();
  if (remember){ try{ localStorage.setItem("hd:pass", p); }catch(_){} }
  document.getElementById("gate").classList.add("hide");
  const s = document.createElement("script"); s.src = "app.js?v=202611162000"; document.body.appendChild(s);
  setInterval(() => { if (!document.hidden) poll(); }, 10000);
  return true;
}
const form = document.getElementById("gateForm"), msg = document.getElementById("gateMsg"), btn = document.getElementById("gateBtn");
form.onsubmit = async ev => {
  ev.preventDefault(); btn.disabled = true; msg.textContent = "Đang kiểm tra…";
  try{ if (!(await enter(document.getElementById("gatePass").value.trim(), true))) msg.textContent = "Sai mật khẩu."; }
  catch(e){ msg.textContent = "Chưa kết nối được. Kiểm tra mạng rồi thử lại."; }
  btn.disabled = false;
};
let saved = null; try{ saved = localStorage.getItem("hd:pass"); }catch(_){}
if (saved){ msg.textContent = "Đang mở…"; enter(saved, false).then(ok => { if (!ok){ msg.textContent = ""; try{ localStorage.removeItem("hd:pass"); }catch(_){} } }).catch(() => { msg.textContent = "Chưa kết nối được. Kiểm tra mạng rồi thử lại."; }); }
else document.getElementById("gatePass").focus();
})();
