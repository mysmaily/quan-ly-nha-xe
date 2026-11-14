import { html, render, useState, useEffect, api, toast, Toaster, ConfirmHost, Sheet, Field, Segmented, Empty, icon, phoneFmt, JOBS, store } from "./lib.js";
import { useTrip, TripPage } from "./trip.js";
import { StatsPage, BusesPage, StaffPage } from "./admin.js";

// ---------- điều hướng theo hash (#/so-do, #/thong-ke…) ----------
function useHashRoute(def) {
  const get = () => location.hash.replace(/^#\/?/, "") || def;
  const [r, setR] = useState(get);
  useEffect(() => {
    const on = () => setR(get());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [r, (x) => { if (x !== r) location.hash = "/" + x; }];
}

function TabBar({ tabs, value, onChange }) {
  return html`<nav class="tabbar">
    ${tabs.map((t) => html`<button class=${t.key === value ? "on" : ""} onClick=${() => onChange(t.key)}>
      ${icon(t.icon, 24)}<span>${t.label}</span></button>`)}
  </nav>`;
}

function TopBar({ title, sub, right }) {
  return html`<header class="topbar"><div class="tb-text"><div class="tb-title">${title}</div>${sub && html`<div class="tb-sub">${sub}</div>`}</div>${right}</header>`;
}

// ---------- đăng nhập ----------
function Login({ onDone }) {
  const [phone, setPhone] = useState(() => store.get("lastPhone", ""));
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/login", { method: "POST", body: { phone, pin } });
      store.set("lastPhone", phone);
      onDone();
    } catch (err) { toast(err.message, "err"); setPin(""); }
    finally { setBusy(false); }
  }
  return html`
    <div class="login">
      <div class="login-logo">${icon("bus", 44)}</div>
      <h1>Nhà Xe</h1>
      <p class="muted">Đăng nhập bằng số điện thoại và mã PIN</p>
      <form class="form" onSubmit=${submit}>
        <${Field} label="Số điện thoại"><input type="tel" inputmode="tel" autocomplete="username" value=${phone} onInput=${(e) => setPhone(e.target.value)} /><//>
        <${Field} label="Mã PIN"><input type="password" inputmode="numeric" autocomplete="current-password" value=${pin} onInput=${(e) => setPin(e.target.value)} /><//>
        <button class="btn primary block lg" disabled=${busy || !phone || !pin}>${busy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
      </form>
    </div>`;
}

// ---------- trang cá nhân ----------
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; });

function MePage({ me, bus, onLogout }) {
  const [oldPin, setOld] = useState("");
  const [pin, setPin] = useState("");
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  async function changePin(e) {
    e.preventDefault();
    try { await api("/me/pin", { method: "POST", body: { old_pin: oldPin, pin } }); toast("Đã đổi mã PIN"); setOld(""); setPin(""); }
    catch (err) { toast(err.message, "err"); }
  }
  return html`
    <div class="page">
      <div class="card me-card">
        <div class="avatar lg">${me.name.trim().split(/\s+/).pop()[0]?.toUpperCase()}</div>
        <div>
          <div class="row-title">${me.name}</div>
          <div class="row-sub">${me.role === "admin" ? "Chủ xe" : JOBS[me.job]} · ${phoneFmt(me.phone)}</div>
          ${bus && html`<div class="row-sub">Xe: ${bus.plate}${bus.name ? " · " + bus.name : ""}</div>`}
        </div>
      </div>
      ${!standalone && html`
        <div class="card">
          <div class="card-title">Cài lên màn hình chính</div>
          ${deferredPrompt
            ? html`<button class="btn primary block" onClick=${async () => { deferredPrompt.prompt(); deferredPrompt = null; }}>Cài ứng dụng</button>`
            : ios
              ? html`<p class="hint">Trong Safari: bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên) → chọn <b>Thêm vào MH chính</b>. App sẽ mở toàn màn hình như ứng dụng thật.</p>`
              : html`<p class="hint">Trong Chrome: bấm menu <b>⋮</b> → <b>Thêm vào màn hình chính</b> / <b>Cài đặt ứng dụng</b>.</p>`}
        </div>`}
      <form class="card form" onSubmit=${changePin}>
        <div class="card-title">Đổi mã PIN</div>
        <${Field} label="PIN hiện tại"><input type="password" inputmode="numeric" value=${oldPin} onInput=${(e) => setOld(e.target.value)} /><//>
        <${Field} label="PIN mới (4–12 số)"><input type="password" inputmode="numeric" value=${pin} onInput=${(e) => setPin(e.target.value)} /><//>
        <button class="btn outline block" disabled=${!oldPin || !pin}>${icon("key", 18)} Đổi PIN</button>
      </form>
      <button class="btn block ghost danger-text" onClick=${onLogout}>${icon("logout", 18)} Đăng xuất</button>
    </div>`;
}

// ---------- chọn xe (người được xem nhiều xe) ----------
function BusPicker({ buses, value, onPick, onClose }) {
  return html`<${Sheet} title="Chọn xe" onClose=${onClose}>
    <div class="list cards">
      ${buses.map((b) => html`<div class="row bus-row" onClick=${() => onPick(b.id)}>
        <div class="row-icon">${icon("bus")}</div>
        <div class="row-main">
          <div class="row-title">${b.plate}${b.name && html` <span class="muted">· ${b.name}</span>`}</div>
          <div class="row-sub">${b.route_out}</div>
        </div>
        <div class="row-end">${b.id === value && icon("check")}</div>
      </div>`)}
    </div>
  <//>`;
}

// Trang Quản lý: chỉ hiện với tài khoản có quyền (admin); mục con nằm trong hash #/quan-ly/xe…
const MANAGE = [
  { key: "", label: "Thống kê" },
  { key: "xe", label: "Xe" },
  { key: "nhan-vien", label: "Nhân viên" },
];
function ManagePage({ me, sub, go }) {
  const cur = MANAGE.some((m) => m.key === sub) ? sub : "";
  return html`
    <div class="view-switch"><${Segmented} value=${cur} onChange=${(k) => go(k ? "quan-ly/" + k : "quan-ly")}
      options=${MANAGE.map((m) => ({ value: m.key, label: m.label }))} /></div>
    ${cur === "xe" ? html`<${BusesPage} />` : cur === "nhan-vien" ? html`<${StaffPage} me=${me} />` : html`<${StatsPage} />`}`;
}

// Hash cũ của giao diện chủ xe trước đây → đường dẫn mới
const LEGACY = { "thong-ke": "quan-ly", chuyen: "so-do", xe: "quan-ly/xe", "nhan-vien": "quan-ly/nhan-vien" };

// ---------- 1 giao diện chung, tab theo quyền ----------
function Shell({ me, myBus, onLogout }) {
  const isAdmin = me.role === "admin";
  const [route, go] = useHashRoute(isAdmin ? "quan-ly" : "so-do");
  let [tab, sub = ""] = route.split("/");
  if (LEGACY[route]) [tab, sub = ""] = LEGACY[route].split("/");
  if (tab === "quan-ly" && !isAdmin) tab = "so-do";
  if (!["so-do", "danh-sach", "quan-ly", "toi"].includes(tab)) tab = isAdmin ? "quan-ly" : "so-do";
  const onTrip = tab === "so-do" || tab === "danh-sach";

  // Xe được xem: admin mọi xe, nhân viên xe được phân công (server quyết định qua /api/buses)
  const [buses, setBuses] = useState(null);
  const [busId, setBusId] = useState(() => store.get("bus", null));
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!onTrip) return;
    api("/buses").then((bs) => {
      setBuses(bs);
      setBusId((id) => (bs.some((b) => b.id === id) ? id : bs[0]?.id ?? null));
    }).catch((e) => toast(e.message, "err"));
  }, [onTrip]);
  const bus = buses?.find((b) => b.id === busId) || null;
  const t = useTrip(bus?.id);
  const pick = (id) => { setBusId(id); store.set("bus", id); setPicking(false); };

  const tabs = [
    { key: "so-do", label: "Sơ đồ", icon: "seat" },
    { key: "danh-sach", label: "Danh sách", icon: "list" },
    isAdmin && { key: "quan-ly", label: "Quản lý", icon: "chart" },
    { key: "toi", label: "Tài khoản", icon: "user" },
  ].filter(Boolean);

  let top, body;
  if (onTrip) {
    const many = buses && buses.length > 1;
    const title = bus ? bus.plate + (bus.name ? " · " + bus.name : "") : "Nhà Xe";
    top = html`<${TopBar}
      title=${many ? html`<button class="tb-pick" onClick=${() => setPicking(true)}>${title}${icon("down", 18)}</button>` : title}
      sub=${me.name + " · " + (isAdmin ? "Chủ xe" : JOBS[me.job])}
      right=${bus && html`<button class="icon-btn" aria-label="Tải lại" onClick=${() => { t.reload(); toast("Đã cập nhật"); }}>${icon("refresh")}</button>`} />`;
    body = !buses ? html`<div class="page"><div class="loading">Đang tải…</div></div>`
      : !bus ? html`<div class="page"><${Empty}>${isAdmin
          ? html`Chưa có xe nào. Vào <b>Quản lý → Xe</b> để thêm xe.`
          : html`Bạn chưa được phân công xe nào.<br />Hãy liên hệ chủ xe để được thêm vào xe.`}<//></div>`
      : html`<${TripPage} t=${t} view=${tab === "danh-sach" ? "list" : "map"} />`;
  } else if (tab === "quan-ly") {
    top = html`<${TopBar} title="Quản lý" sub=${me.name} />`;
    body = html`<${ManagePage} me=${me} sub=${sub} go=${go} />`;
  } else {
    top = html`<${TopBar} title="Tài khoản" sub=${me.name} />`;
    body = html`<${MePage} me=${me} bus=${myBus} onLogout=${onLogout} />`;
  }
  return html`
    ${top}
    <main class="main">${body}</main>
    <${TabBar} value=${tab} onChange=${go} tabs=${tabs} />
    ${picking && buses && html`<${BusPicker} buses=${buses} value=${busId} onPick=${pick} onClose=${() => setPicking(false)} />`}`;
}

// ---------- gốc ----------
function App() {
  const [me, setMe] = useState(undefined);
  const load = () => api("/me").then(setMe).catch(() => setMe(null));
  useEffect(() => {
    load();
    const on = () => setMe(null);
    window.addEventListener("unauthorized", on);
    return () => window.removeEventListener("unauthorized", on);
  }, []);
  const logout = async () => { await api("/logout", { method: "POST" }).catch(() => {}); location.hash = ""; setMe(null); };

  let body;
  if (me === undefined) body = html`<div class="loading full">Đang tải…</div>`;
  else if (!me) body = html`<${Login} onDone=${load} />`;
  else body = html`<${Shell} me=${me.user} myBus=${me.bus} onLogout=${logout} />`;
  return html`${body}<${Toaster} /><${ConfirmHost} />`;
}

render(html`<${App} />`, document.getElementById("app"));

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
