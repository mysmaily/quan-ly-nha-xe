// Tiện ích dùng chung: gọi API, định dạng, toast, sheet, icon
import { html, useState, useEffect, useRef } from "../vendor/preact-htm.js";
export { html, useState, useEffect, useRef };
export { render, useMemo, useCallback } from "../vendor/preact-htm.js";

// ---------- API ----------
export async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch("/api" + path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Mất kết nối mạng, vui lòng thử lại");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") window.dispatchEvent(new Event("unauthorized"));
  if (!res.ok) throw new Error(data.error || "Có lỗi xảy ra");
  return data;
}

// ---------- định dạng ----------
export const money = (n) => (Number(n) || 0).toLocaleString("vi-VN") + "đ";
export function moneyShort(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return +(n / 1e9).toFixed(2) + " tỷ";
  if (n >= 1e6) return +(n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + "tr";
  if (n >= 1e3) return Math.round(n / 1e3) + "k";
  return String(n);
}
export const phoneFmt = (p) => {
  if (!p) return "";
  const d = p.replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : p;
};
const DOW = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
export function addDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function vnToday() {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}
export function dateLabel(date, today = vnToday()) {
  const d = new Date(date + "T00:00:00Z");
  const short = `${DOW[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  if (date === today) return "Hôm nay · " + short;
  if (date === addDays(today, 1)) return "Ngày mai · " + short;
  if (date === addDays(today, -1)) return "Hôm qua · " + short;
  return short;
}
export const timeOf = (sqlDate) => {
  if (!sqlDate) return "";
  const d = new Date(sqlDate.replace(" ", "T") + "Z");
  return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
};
export const JOBS = { lo_xe: "Lơ xe", lai_xe: "Lái xe", quan_ly: "Quản lý", khac: "Khác" };

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- toast ----------
export function toast(msg, type = "ok") {
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, type } }));
}
export function Toaster() {
  const [t, setT] = useState(null);
  useEffect(() => {
    let timer;
    const on = (e) => { setT(e.detail); clearTimeout(timer); timer = setTimeout(() => setT(null), 2600); };
    window.addEventListener("toast", on);
    return () => window.removeEventListener("toast", on);
  }, []);
  return t ? html`<div class="toast ${t.type}" onClick=${() => setT(null)}>${t.msg}</div>` : null;
}

// ---------- nút back của điện thoại đóng sheet ----------
const backStack = [];
let ignorePop = 0;
window.addEventListener("popstate", () => {
  if (ignorePop > 0) { ignorePop--; return; }
  const top = backStack.pop();
  if (top) { top.done = true; top.close(); }
});
function useBackClose(onClose) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const entry = { done: false, close: () => ref.current() };
    backStack.push(entry);
    history.pushState({ sheet: backStack.length }, "");
    return () => {
      if (entry.done) return;
      const i = backStack.indexOf(entry);
      if (i >= 0) backStack.splice(i, 1);
      ignorePop++;
      history.back();
    };
  }, []);
}

/** Bottom sheet kiểu app di động */
export function Sheet({ title, onClose, children, footer, full }) {
  useBackClose(onClose);
  useEffect(() => {
    document.body.classList.add("noscroll");
    return () => document.body.classList.remove("noscroll");
  }, []);
  return html`
    <div class="sheet-wrap" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class=${"sheet" + (full ? " full" : "")} role="dialog" aria-label=${title}>
        <div class="sheet-handle"></div>
        <div class="sheet-head">
          <div class="sheet-title">${title}</div>
          <button class="icon-btn" aria-label="Đóng" onClick=${onClose}>${icon("x")}</button>
        </div>
        <div class="sheet-body">${children}</div>
        ${footer && html`<div class="sheet-foot">${footer}</div>`}
      </div>
    </div>`;
}

// ---------- hộp xác nhận ----------
let confirmSetter = null;
export function ask(message, { ok = "Đồng ý", danger = false, input = null } = {}) {
  return new Promise((resolve) => confirmSetter?.({ message, ok, danger, input, resolve }));
}
export function ConfirmHost() {
  const [c, setC] = useState(null);
  const [val, setVal] = useState("");
  confirmSetter = (x) => { setVal(x.input?.value ?? ""); setC(x); };
  if (!c) return null;
  const done = (v) => { c.resolve(v); setC(null); };
  return html`
    <div class="dialog-wrap" onClick=${(e) => e.target === e.currentTarget && done(false)}>
      <div class="dialog">
        <div class="dialog-msg">${c.message}</div>
        ${c.input && html`<${MoneyInput} value=${val} onInput=${setVal} autofocus />`}
        <div class="dialog-actions">
          <button class="btn ghost" onClick=${() => done(false)}>Huỷ</button>
          <button class="btn ${c.danger ? "danger" : "primary"}" onClick=${() => done(c.input ? val : true)}>${c.ok}</button>
        </div>
      </div>
    </div>`;
}

// ---------- ô nhập tiền ----------
export function MoneyInput({ value, onInput, placeholder = "0", autofocus }) {
  const ref = useRef();
  useEffect(() => { if (autofocus) setTimeout(() => ref.current?.focus(), 50); }, []);
  const digits = String(value ?? "").replace(/\D/g, "");
  const shown = digits ? Number(digits).toLocaleString("vi-VN") : "";
  return html`
    <div class="money-input">
      <input ref=${ref} inputmode="numeric" placeholder=${placeholder} value=${shown}
        onFocus=${(e) => setTimeout(() => e.target.select(), 0)}
        onInput=${(e) => onInput(e.target.value.replace(/\D/g, ""))} />
      <span>đ</span>
    </div>`;
}

export function Segmented({ options, value, onChange }) {
  return html`<div class="segmented">
    ${options.map((o) => html`<button class=${o.value === value ? "on" : ""} onClick=${() => onChange(o.value)}>${o.label}</button>`)}
  </div>`;
}

export function Field({ label, hint, children }) {
  return html`<label class="field"><span class="field-label">${label}</span>${children}${hint && html`<span class="field-hint">${hint}</span>`}</label>`;
}

export function Empty({ children }) {
  return html`<div class="empty">${children}</div>`;
}

// ---------- icon (stroke SVG) ----------
const ICONS = {
  x: "M18 6 6 18M6 6l12 12",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z",
  left: "m15 18-6-6 6-6",
  right: "m9 18 6-6-6-6",
  plus: "M12 5v14M5 12h14",
  check: "M20 6 9 17l-5-5",
  pin: "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  seat: "M5 11V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M3 11h18v6H3zM6 17v3M18 17v3",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  chart: "M3 3v18h18M7 16v-5M12 16V7M17 16v-8",
  bus: "M4 16V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10M4 16h16v3H4zM4 11h16M7 19v2M17 19v2M8 14h.01M16 14h.01",
  cash: "M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 12h.01M18 12h.01",
  swap: "M7 16V4M7 4 3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4",
  refresh: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  key: "M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8Zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
  undo: "M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13",
};
export function icon(name, size = 22) {
  return html`<svg class="ic" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${ICONS[name]} /></svg>`;
}
