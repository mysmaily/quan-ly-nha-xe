import { html, render, useState, useEffect, api, toast, Toaster, ConfirmHost, Field, Segmented, Empty, icon, phoneFmt, JOBS, store } from "./lib.js";
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

// ---------- giao diện lơ xe ----------
function StaffShell({ me, bus, onLogout }) {
  const [tab, setTab] = useHashRoute("so-do");
  const t = useTrip(bus?.id);
  if (!bus) {
    return html`<${TopBar} title="Nhà Xe" />
      <div class="main"><div class="page"><${Empty}>Bạn chưa được phân công xe nào.<br />Hãy liên hệ chủ xe để được thêm vào xe.<//>
        <button class="btn block ghost danger-text" onClick=${onLogout}>${icon("logout", 18)} Đăng xuất</button></div></div>`;
  }
  return html`
    <${TopBar} title=${bus.plate + (bus.name ? " · " + bus.name : "")} sub=${me.name + " · " + JOBS[me.job]}
      right=${html`<button class="icon-btn" aria-label="Tải lại" onClick=${() => { t.reload(); toast("Đã cập nhật"); }}>${icon("refresh")}</button>`} />
    <main class="main">
      ${tab === "toi" ? html`<${MePage} me=${me} bus=${bus} onLogout=${onLogout} />`
        : html`<${TripPage} t=${t} view=${tab === "danh-sach" ? "list" : "map"} />`}
    </main>
    <${TabBar} value=${tab} onChange=${setTab} tabs=${[
      { key: "so-do", label: "Sơ đồ", icon: "seat" },
      { key: "danh-sach", label: "Danh sách", icon: "list" },
      { key: "toi", label: "Tài khoản", icon: "user" },
    ]} />`;
}

// ---------- giao diện chủ xe ----------
function AdminTrips() {
  const [buses, setBuses] = useState(null);
  const [busId, setBusId] = useState(() => store.get("adminBus", null));
  const [view, setView] = useState("map");
  useEffect(() => {
    api("/buses").then((bs) => {
      setBuses(bs);
      if (!bs.some((b) => b.id === busId)) setBusId(bs[0]?.id ?? null);
    }).catch((e) => toast(e.message, "err"));
  }, []);
  const t = useTrip(busId);
  if (!buses) return html`<div class="page"><div class="loading">Đang tải…</div></div>`;
  if (!buses.length) return html`<div class="page"><${Empty}>Chưa có xe nào. Vào mục <b>Xe</b> để thêm xe.<//></div>`;
  return html`
    <div class="bus-chips">
      ${buses.map((b) => html`<button class=${"chip " + (b.id === busId ? "on" : "")} onClick=${() => { setBusId(b.id); store.set("adminBus", b.id); }}>${b.plate}${b.name ? " · " + b.name : ""}</button>`)}
    </div>
    <div class="view-switch"><${Segmented} value=${view} onChange=${setView} options=${[{ value: "map", label: "Sơ đồ" }, { value: "list", label: "Danh sách" }]} /></div>
    ${busId && html`<${TripPage} t=${t} view=${view} />`}`;
}

function AdminShell({ me, bus, onLogout }) {
  const [tab, setTab] = useHashRoute("thong-ke");
  const titles = { "thong-ke": "Tổng quan", chuyen: "Chuyến xe", xe: "Quản lý xe", "nhan-vien": "Nhân viên", toi: "Tài khoản" };
  return html`
    <${TopBar} title=${titles[tab] || "Nhà Xe"} sub=${me.name} />
    <main class="main">
    ${tab === "chuyen" ? html`<${AdminTrips} />`
      : tab === "xe" ? html`<${BusesPage} />`
      : tab === "nhan-vien" ? html`<${StaffPage} me=${me} />`
      : tab === "toi" ? html`<${MePage} me=${me} bus=${bus} onLogout=${onLogout} />`
      : html`<${StatsPage} />`}
    </main>
    <${TabBar} value=${tab} onChange=${setTab} tabs=${[
      { key: "thong-ke", label: "Tổng quan", icon: "chart" },
      { key: "chuyen", label: "Chuyến", icon: "seat" },
      { key: "xe", label: "Xe", icon: "bus" },
      { key: "nhan-vien", label: "Nhân viên", icon: "users" },
      { key: "toi", label: "Tôi", icon: "user" },
    ]} />`;
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
  else if (me.user.role === "admin") body = html`<${AdminShell} me=${me.user} bus=${me.bus} onLogout=${logout} />`;
  else body = html`<${StaffShell} me=${me.user} bus=${me.bus} onLogout=${logout} />`;
  return html`${body}<${Toaster} /><${ConfirmHost} />`;
}

render(html`<${App} />`, document.getElementById("app"));

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
