// Màn hình chuyến xe: mô hình xe, danh sách khách, đặt chỗ, lên xe, thu tiền
import {
  html, useState, useEffect, useRef, useMemo, api, money, moneyShort, phoneFmt, dateLabel, addDays, vnToday,
  timeOf, toast, ask, Sheet, MoneyInput, Field, Segmented, Empty, icon, store,
} from "./lib.js";
import { BusModel, Bed, capacity, seatStatus } from "./seatmap.js";

// ---------- trạng thái chuyến (ngày, chiều đi/về, dữ liệu) ----------
export function useTrip(busId) {
  const [date, setDate] = useState(vnToday());
  const [dir, setDirRaw] = useState(() => store.get("dir:" + busId, "di"));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reqId = useRef(0);

  const setDir = (d) => { setDirRaw(d); store.set("dir:" + busId, d); };

  async function reload() {
    if (!busId) return;
    const id = ++reqId.current;
    try {
      const d = await api(`/trip?bus_id=${busId}&date=${date}&direction=${dir}`);
      if (id === reqId.current) { setData(d); setError(null); }
    } catch (e) {
      if (id === reqId.current) setError(e.message);
    }
  }

  useEffect(() => {
    setData(null);
    setDirRaw(store.get("dir:" + busId, "di"));
  }, [busId]);
  useEffect(() => { setData(null); reload(); }, [busId, date, dir]);
  // Đồng bộ với người khác trên cùng xe (lái xe + lơ xe) mỗi 10 giây
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && reload(), 10_000);
    const onVis = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [busId, date, dir]);

  return { busId, date, setDate, dir, setDir, data, error, reload };
}

// ---------- tiện ích ----------
function allSeats(bus) {
  return (bus.layout.floors || []).flatMap((f) => f.seats.map((s) => ({ ...s, floor: f.name })));
}
/** Giá giường: single = giá lẻ / người; combo = giá cả giường đôi (null với giường đơn) */
function seatPrices(bus, code) {
  const s = code && allSeats(bus).find((x) => x.code === code);
  const single = s && s.price != null ? s.price : bus.default_price;
  if (!s || s.type !== "double") return { single, combo: null };
  return { single, combo: s.combo ?? (bus.default_combo_price || single * 2) };
}
function naturalCmp(a, b) {
  return String(a).localeCompare(String(b), "vi", { numeric: true });
}
function extrasOf(data) {
  const codes = new Set(allSeats(data.bus).map((s) => s.code));
  return data.bookings.filter((b) => !b.seat || !codes.has(b.seat));
}
const bStatus = (b) => (b.paid ? "paid" : b.boarded ? "boarded" : "booked");
const STATUS_LABEL = { empty: "Trống", booked: "Đã đặt", boarded: "Đã lên xe", paid: "Đã thu" };

// ---------- header: chọn ngày + chiều ----------
function TripHeader({ t, bus }) {
  return html`
    <div class="trip-head">
      <div class="date-nav">
        <button class="icon-btn" aria-label="Ngày trước" onClick=${() => t.setDate(addDays(t.date, -1))}>${icon("left")}</button>
        <label class="date-btn">
          ${dateLabel(t.date)}
          <input type="date" class="date-hidden" value=${t.date} onChange=${(e) => e.target.value && t.setDate(e.target.value)} />
        </label>
        ${t.date !== vnToday() && html`<button class="back-today" onClick=${() => t.setDate(vnToday())}>Hôm nay</button>`}
        <button class="icon-btn" aria-label="Ngày sau" onClick=${() => t.setDate(addDays(t.date, 1))}>${icon("right")}</button>
      </div>
      <div class="dir-toggle">
        <button class=${t.dir === "di" ? "on" : ""} onClick=${() => t.setDir("di")}><small>ĐI</small><span>${bus.route_out}</span></button>
        <button class=${t.dir === "ve" ? "on" : ""} onClick=${() => t.setDir("ve")}><small>VỀ</small><span>${bus.route_back}</span></button>
      </div>
    </div>`;
}

function SummaryBar({ data, onExtras }) {
  const seats = allSeats(data.bus);
  const beds = seats.reduce((a, s) => a + capacity(s), 0);
  let pax = 0, paid = 0, unpaid = 0, boarded = 0;
  for (const b of data.bookings) {
    pax += b.qty;
    if (b.boarded || b.paid) boarded += b.qty;
    if (b.paid) paid += b.paid_amount; else unpaid += b.price;
  }
  const extras = extrasOf(data).reduce((a, b) => a + b.qty, 0);
  return html`
    <div class="summary">
      <div><b class=${pax > beds ? "over" : ""}>${pax}<small>/${beds}</small></b><span>khách · ${boarded} lên</span></div>
      <div><b class="c-paid">${moneyShort(paid)}</b><span>đã thu</span></div>
      <div><b class="c-booked">${moneyShort(unpaid)}</b><span>chưa thu</span></div>
      <button class="extras-btn" onClick=${onExtras}><b>${extras ? "+" + extras : icon("plus", 18)}</b><span>khách phụ</span></button>
    </div>`;
}

function Legend() {
  return html`<div class="legend">
    <span><i class="dot empty"></i>Trống</span>
    <span><i class="dot booked"></i>Đã đặt</span>
    <span><i class="dot boarded"></i>Lên xe</span>
    <span><i class="dot paid">$</i>Đã thu</span>
  </div>`;
}

// ---------- trang chuyến ----------
export function TripPage({ t, view }) {
  const [sheet, setSheet] = useState(null); // {seat, bookingId, mode}
  const { data, error } = t;

  if (error && !data) return html`<div class="page"><${Empty}>${error}<br /><button class="btn" onClick=${t.reload}>Thử lại</button><//></div>`;
  if (!data) return html`<div class="page"><div class="loading">Đang tải…</div></div>`;

  const openBooking = (b) => setSheet({ seat: b.seat, bookingId: b.id, mode: "view" });
  const openExtras = () => setSheet({ seat: null, mode: "extras" });

  return html`
    <div class="page trip-page ${view === "map" ? "map-mode" : ""}">
      <${TripHeader} t=${t} bus=${data.bus} />
      <${SummaryBar} data=${data} onExtras=${openExtras} />
      ${view === "map"
        ? html`<${Legend} /><${SeatMap} data=${data} onSeat=${(seat) => setSheet({ seat: seat.code, mode: "auto" })} />`
        : html`<${PassengerList} data=${data} onBooking=${openBooking} onExtra=${() => setSheet({ seat: null, mode: "new" })} />`}
      ${sheet && html`<${BookingSheet} key=${sheet.seat + ":" + sheet.bookingId + ":" + sheet.mode} data=${data} ...${sheet}
        reload=${t.reload} onClose=${() => setSheet(null)} />`}
    </div>`;
}

// ---------- mô hình xe ----------
function SeatMap({ data, onSeat }) {
  const { bus, bookings } = data;
  const bySeat = useMemo(() => {
    const m = new Map();
    for (const b of bookings) if (b.seat) (m.get(b.seat) || m.set(b.seat, []).get(b.seat)).push(b);
    return m;
  }, [bookings]);

  const renderCell = (seat) => {
    if (!seat) return html`<div class="cell aisle"></div>`;
    const bs = bySeat.get(seat.code) || [];
    const cap = capacity(seat);
    // Khách combo chiếm trọn giường đôi
    const pax = bs.reduce((a, b) => a + (b.combo ? Math.max(b.qty, cap) : b.qty), 0);
    const status = seatStatus(bs);
    return html`<${Bed} seat=${seat} status=${status} onClick=${() => onSeat(seat)}>
      ${status === "paid" && html`<span class="paid-mark">$</span>`}
      ${pax > cap ? html`<span class="badge over">+${pax - cap}</span>`
        : seat.type === "double" && pax > 0 && pax < cap ? html`<span class="badge">${pax}/${cap}</span>` : null}
    <//>`;
  };
  return html`<${BusModel} layout=${bus.layout} renderCell=${renderCell} fill />`;
}

// ---------- danh sách khách ----------
function PassengerList({ data, onBooking, onExtra }) {
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState(() => store.get("listSort", "seat"));
  const [q, setQ] = useState("");
  let list = data.bookings.slice();
  if (filter === "notboarded") list = list.filter((b) => !b.boarded && !b.paid);
  if (filter === "unpaid") list = list.filter((b) => !b.paid);
  if (filter === "paid") list = list.filter((b) => b.paid);
  if (q) {
    const s = q.toLowerCase();
    list = list.filter((b) => [b.phone, b.name, b.pickup, b.dropoff, b.seat, b.note].some((x) => (x || "").toLowerCase().includes(s)));
  }
  list.sort((a, b) =>
    sort === "pickup"
      ? naturalCmp(a.pickup || "~", b.pickup || "~") || naturalCmp(a.seat || "~", b.seat || "~")
      : naturalCmp(a.seat || "~", b.seat || "~"),
  );
  return html`
    <div class="list-tools">
      <div class="search">${icon("search", 18)}<input placeholder="Tìm SĐT, tên, điểm đón…" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <${Segmented} value=${filter} onChange=${setFilter} options=${[
        { value: "all", label: "Tất cả" }, { value: "notboarded", label: "Chưa lên" },
        { value: "unpaid", label: "Chưa thu" }, { value: "paid", label: "Đã thu" }]} />
      <div class="sort-row">Sắp xếp:
        <button class=${"chip " + (sort === "seat" ? "on" : "")} onClick=${() => { setSort("seat"); store.set("listSort", "seat"); }}>Theo ghế</button>
        <button class=${"chip " + (sort === "pickup" ? "on" : "")} onClick=${() => { setSort("pickup"); store.set("listSort", "pickup"); }}>Theo điểm đón</button>
      </div>
    </div>
    <div class="list">
      ${list.length ? list.map((b) => html`<${BookingRow} b=${b} onClick=${() => onBooking(b)} />`) : html`<${Empty}>Chưa có khách nào<//>`}
    </div>
    <button class="btn block outline add-extra" onClick=${onExtra}>${icon("plus")} Thêm khách không có ghế</button>`;
}

function BookingRow({ b, onClick }) {
  const st = bStatus(b);
  return html`
    <div class="row" onClick=${onClick}>
      <div class="seat-badge ${st}">${b.seat || "+"}</div>
      <div class="row-main">
        <div class="row-title">${b.name || phoneFmt(b.phone) || "Khách"}${b.qty > 1 ? html` <span class="qty">×${b.qty}</span>` : ""}</div>
        <div class="row-sub">${icon("pin", 14)} ${b.pickup || "Chưa có điểm đón"}</div>
      </div>
      <div class="row-end h">
        <span class="pill ${st}">${b.paid ? "$ " + moneyShort(b.paid_amount) : STATUS_LABEL[st]}</span>
        ${b.phone && html`<a class="call-mini" href=${"tel:" + b.phone} onClick=${(e) => e.stopPropagation()} aria-label="Gọi">${icon("phone", 18)}</a>`}
      </div>
    </div>`;
}

// ---------- sheet chi tiết ghế / đặt chỗ / khách phụ ----------
function BookingSheet({ data, seat, bookingId, mode: initialMode, reload, onClose }) {
  const { bus, trip, bookings } = data;
  const seatObj = seat ? allSeats(bus).find((s) => s.code === seat) : null;
  const onSeat = seat ? bookings.filter((b) => b.seat === seat) : [];
  const [selId, setSelId] = useState(bookingId || null);
  const [fromExtras, setFromExtras] = useState(initialMode === "extras");
  const [mode, setMode] = useState(initialMode === "auto" ? (onSeat.length ? "view" : "new") : initialMode);
  const [busy, setBusy] = useState(false);
  const shown = selId ? bookings.filter((b) => b.id === selId) : onSeat;
  const extras = extrasOf(data);

  // Khách đã bị huỷ (ở máy khác) → quay lại / đóng
  useEffect(() => {
    if (mode === "view" && !shown.length) fromExtras ? (setSelId(null), setMode("extras")) : onClose();
  }, [mode, shown.length]);

  const run = async (fn, msg) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); await reload(); if (msg) toast(msg); }
    catch (e) { toast(e.message, "err"); }
    finally { setBusy(false); }
  };

  const selBooking = selId && bookings.find((b) => b.id === selId);
  const curSeat = selBooking ? selBooking.seat : seat;
  const curSeatObj = curSeat ? allSeats(bus).find((s) => s.code === curSeat) : null;
  const title = mode === "extras" ? "Khách phụ / không có ghế"
    : curSeat ? `Giường ${curSeat}${curSeatObj ? (curSeatObj.type === "double" ? " · đôi" : "") : " (đã xoá khỏi sơ đồ)"}`
    : "Khách không có ghế";
  const editing = mode.startsWith("edit:") ? bookings.find((b) => b.id === Number(mode.slice(5))) : null;
  const moving = mode.startsWith("move:") ? bookings.find((b) => b.id === Number(mode.slice(5))) : null;
  const backToExtras = () => { setSelId(null); setMode("extras"); };

  if (mode === "extras") {
    return html`<${Sheet} title=${title} onClose=${onClose}>
      <p class="hint">Khách ngồi/nằm ghế phụ, lối đi… khi xe đã kín giường.</p>
      <div class="list">${extras.map((b) => html`<${BookingRow} b=${b} onClick=${() => { setSelId(b.id); setMode("view"); }} />`)}</div>
      ${!extras.length && html`<${Empty}>Chưa có khách phụ<//>`}
      <button class="btn block primary" onClick=${() => setMode("new")}>${icon("plus")} Thêm khách phụ</button>
    <//>`;
  }

  if (mode === "new" || editing) {
    return html`<${Sheet} title=${editing ? "Sửa thông tin khách" : title + " · thêm khách"} onClose=${onClose}>
      <${BookingForm} bus=${bus} trip=${trip} seat=${editing ? editing.seat : seat} booking=${editing}
        others=${(editing ? bookings.filter((b) => b.seat === editing.seat && b.id !== editing.id) : onSeat).length}
        onCancel=${() => (editing || onSeat.length ? setMode("view") : fromExtras ? backToExtras() : onClose())}
        onSaved=${async () => {
          await reload();
          if (editing || seat) setMode("view"); else if (fromExtras) backToExtras(); else onClose();
        }} />
    <//>`;
  }

  if (moving) {
    return html`<${Sheet} title="Chuyển sang giường khác" onClose=${onClose}>
      <${MovePicker} data=${data} booking=${moving} onCancel=${() => setMode("view")}
        onPick=${(code) => run(async () => {
          await api(`/bookings/${moving.id}`, { method: "PUT", body: { seat: code } });
          onClose();
        }, code ? `Đã chuyển sang giường ${code}` : "Đã chuyển sang khách phụ")} />
    <//>`;
  }

  return html`<${Sheet} title=${title} onClose=${onClose}>
    ${fromExtras && html`<button class="link-btn" onClick=${backToExtras}>‹ Danh sách khách phụ</button>`}
    ${curSeat && !selId && (() => {
      const p = seatPrices(bus, curSeat);
      return html`<div class="sheet-meta">${p.combo != null ? html`Combo <b>${money(p.combo)}</b> · Lẻ <b>${money(p.single)}</b>/người` : html`Giá <b>${money(p.single)}</b>/người`}
        · ${onSeat.reduce((a, b) => a + b.qty, 0)} khách trên giường</div>`;
    })()}
    ${shown.map((b) => {
      const st = bStatus(b);
      return html`
      <div class="bk-card ${st}">
        <div class="bk-top">
          <div>
            <span class="pill ${st}">${STATUS_LABEL[st]}</span>
            <div class="bk-phone">${phoneFmt(b.phone) || "Không có SĐT"}</div>
            ${(b.name || b.qty > 1 || b.combo) && html`<div class="bk-name">${[b.name, b.combo ? `Combo giường đôi${b.qty !== 2 ? ` · ${b.qty} người` : ""}` : b.qty > 1 && `${b.qty} người`].filter(Boolean).join(" · ")}</div>`}
          </div>
          ${b.phone && html`<a class="btn call" href=${"tel:" + b.phone}>${icon("phone", 20)} Gọi</a>`}
        </div>
        <div class="bk-line">${icon("pin", 16)} <span><small>Đón:</small> ${b.pickup || "—"}</span></div>
        ${b.dropoff && html`<div class="bk-line">${icon("pin", 16)} <span><small>Trả:</small> ${b.dropoff}</span></div>`}
        ${b.note && html`<div class="bk-note">${b.note}</div>`}

        ${!b.paid && html`
          <div class="bk-board">
            ${b.boarded
              ? html`<span class="c-boarded">${icon("check", 18)} Khách đã lên xe</span>
                  <button class="btn ghost sm" disabled=${busy} onClick=${() => run(() => api(`/bookings/${b.id}/board`, { method: "POST", body: { boarded: false } }), "Đã huỷ trạng thái lên xe")}>Chưa lên</button>`
              : html`<button class="btn board block-in" disabled=${busy}
                  onClick=${() => run(() => api(`/bookings/${b.id}/board`, { method: "POST", body: { boarded: true } }), "Khách đã lên xe")}>
                  ${icon("check", 20)} Khách đã lên xe</button>`}
          </div>`}

        <div class="bk-pay ${b.paid ? "paid" : ""}">
          ${b.paid
            ? html`<div class="pay-done"><span class="paid-mark static">$</span> Đã thu <b>${money(b.paid_amount)}</b> lúc ${timeOf(b.paid_at)}
                ${b.paid_amount !== b.price && html`<small> (giá ${money(b.price)})</small>`}</div>
                <button class="btn ghost sm" disabled=${busy} onClick=${async () => {
                  if (await ask("Huỷ trạng thái đã thu của khách này?")) run(() => api(`/bookings/${b.id}/unpay`, { method: "POST" }), "Đã huỷ thu tiền");
                }}>${icon("undo", 16)} Huỷ thu</button>`
            : html`<button class="btn pay-main" disabled=${busy}
                  onClick=${() => run(() => api(`/bookings/${b.id}/pay`, { method: "POST" }), "Đã thu " + money(b.price))}>
                  $ Thu ${money(b.price)}</button>
                <button class="btn outline" disabled=${busy} onClick=${async () => {
                  const v = await ask("Số tiền thực thu:", { ok: "Thu tiền", input: { value: String(b.price) } });
                  if (v !== false && v !== "") run(() => api(`/bookings/${b.id}/pay`, { method: "POST", body: { amount: Number(v) } }), "Đã thu " + money(v));
                }}>Thu số khác</button>`}
        </div>
        <div class="bk-actions">
          <button class="btn ghost sm" onClick=${() => setMode("edit:" + b.id)}>${icon("edit", 16)} Sửa</button>
          <button class="btn ghost sm" onClick=${() => setMode("move:" + b.id)}>${icon("swap", 16)} Đổi giường</button>
          <button class="btn ghost sm danger-text" disabled=${busy} onClick=${async () => {
            if (await ask(`Huỷ vé của ${phoneFmt(b.phone) || b.name || "khách"}?`, { ok: "Huỷ vé", danger: true }))
              run(() => api(`/bookings/${b.id}`, { method: "DELETE" }), "Đã huỷ vé");
          }}>${icon("trash", 16)} Huỷ vé</button>
        </div>
        <div class="bk-by">Nhập bởi ${b.created_by_name || "?"} lúc ${timeOf(b.created_at)}</div>
      </div>`;
    })}
    ${!selId && seat && html`<button class="btn block outline" onClick=${() => setMode("new")}>${icon("plus")} Thêm khách vào giường này</button>`}
    ${selId && seat && onSeat.length > 1 && html`<div class="sheet-meta">Giường này còn ${onSeat.length - 1} khách khác.</div>`}
  <//>`;
}

function MovePicker({ data, booking, onPick, onCancel }) {
  const used = new Map();
  for (const b of data.bookings) if (b.seat && b.id !== booking.id) (used.get(b.seat) || used.set(b.seat, []).get(b.seat)).push(b);
  const renderCell = (seat) => {
    if (!seat) return html`<div class="cell aisle"></div>`;
    const cur = seat.code === booking.seat;
    return html`<${Bed} seat=${seat} status=${seatStatus(used.get(seat.code) || [])} cls=${cur ? "current" : ""} disabled=${cur}
      onClick=${() => onPick(seat.code)} />`;
  };
  return html`
    <p class="hint">Chọn giường mới cho khách ${phoneFmt(booking.phone) || booking.name}. Giường đã có người vẫn chọn được (ghép thêm).</p>
    <div class="move-model"><${BusModel} layout=${data.bus.layout} renderCell=${renderCell} /></div>
    <div class="row-btns">
      <button class="btn ghost" onClick=${onCancel}>Quay lại</button>
      ${booking.seat && html`<button class="btn outline" onClick=${() => onPick(null)}>Chuyển thành khách phụ</button>`}
    </div>`;
}

// ---------- form đặt chỗ ----------
function BookingForm({ bus, trip, seat, booking, others = 0, onSaved, onCancel }) {
  const prices = seatPrices(bus, booking ? booking.seat : seat);
  const isDouble = prices.combo != null;
  const unit = prices.single;
  // Giường đôi trống → mặc định combo; đã có người nằm → mặc định lẻ (ghép)
  const calc = (combo, qty) => String(combo ? prices.combo : unit * qty);
  const [f, setF] = useState(() => {
    if (booking) return { phone: booking.phone, name: booking.name, pickup: booking.pickup, dropoff: booking.dropoff, note: booking.note, qty: booking.qty, price: String(booking.price), combo: !!booking.combo };
    const combo = isDouble && others === 0;
    const qty = combo ? 2 : 1;
    return { phone: "", name: "", pickup: "", dropoff: "", note: "", qty, price: calc(combo, qty), combo };
  });
  const [priceTouched, setPriceTouched] = useState(!!booking);
  const [payNow, setPayNow] = useState(false);
  const [more, setMore] = useState(!!(booking && (booking.dropoff || booking.note)));
  const [pickups, setPickups] = useState([]);
  const [known, setKnown] = useState(null);
  const [busy, setBusy] = useState(false);
  const phoneRef = useRef();
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    api(`/lookup?bus_id=${bus.id}`).then((r) => setPickups(r.pickups)).catch(() => {});
    if (!booking) setTimeout(() => phoneRef.current?.focus(), 250);
  }, []);

  // Khách quen: gõ đủ SĐT → tự điền điểm đón lần trước
  useEffect(() => {
    const d = f.phone.replace(/\D/g, "");
    if (booking || d.length < 10) { setKnown(null); return; }
    const t = setTimeout(() => {
      api(`/lookup?bus_id=${bus.id}&phone=${d}`).then((r) => {
        if (!r.customer) return;
        setKnown(r.customer);
        setF((x) => ({ ...x, pickup: x.pickup || r.customer.pickup, name: x.name || r.customer.name, dropoff: x.dropoff || r.customer.dropoff }));
      }).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [f.phone]);

  const setQty = (q) => {
    q = Math.max(1, Math.min(50, q));
    setF((x) => ({ ...x, qty: q, price: priceTouched ? x.price : calc(x.combo, q) }));
  };
  const setKind = (combo) => {
    setPriceTouched(false);
    setF((x) => { const qty = combo ? 2 : 1; return { ...x, combo, qty, price: calc(combo, qty) }; });
  };

  async function save(e) {
    e.preventDefault();
    if (busy) return;
    if (!f.phone.trim() && !f.name.trim()) { toast("Nhập số điện thoại hoặc tên khách", "err"); return; }
    setBusy(true);
    try {
      const body = { ...f, price: Number(f.price || 0) };
      if (booking) {
        await api(`/bookings/${booking.id}`, { method: "PUT", body });
        toast("Đã lưu");
      } else {
        const b = await api("/bookings", { method: "POST", body: { ...body, trip_id: trip.id, seat } });
        if (payNow) await api(`/bookings/${b.id}/pay`, { method: "POST" });
        toast(seat ? `Đã thêm khách vào giường ${seat}` : "Đã thêm khách phụ");
      }
      await onSaved();
    } catch (err) {
      toast(err.message, "err");
    } finally {
      setBusy(false);
    }
  }

  const suggest = pickups.filter((p) => p !== f.pickup && (!f.pickup || p.toLowerCase().includes(f.pickup.toLowerCase()))).slice(0, 8);

  return html`
    <form class="form" onSubmit=${save}>
      <${Field} label="Số điện thoại">
        <input ref=${phoneRef} type="tel" inputmode="tel" autocomplete="off" placeholder="09xx xxx xxx" value=${f.phone}
          onInput=${(e) => set("phone", e.target.value)} />
      <//>
      ${known && html`<div class="known">${icon("check", 16)} Khách quen — đã điền điểm đón lần trước</div>`}
      <${Field} label="Điểm đón">
        <input placeholder="VD: Ngã tư Diễn Châu" value=${f.pickup} onInput=${(e) => set("pickup", e.target.value)} />
      <//>
      ${suggest.length > 0 && html`<div class="chips">${suggest.map((p) => html`<button type="button" class="chip" onClick=${() => set("pickup", p)}>${p}</button>`)}</div>`}
      ${isDouble && html`
        <div class="kind-pick">
          <button type="button" class=${f.combo ? "on" : ""} onClick=${() => setKind(true)}>
            <b>Combo cả giường</b><span>${money(prices.combo)}</span>
          </button>
          <button type="button" class=${!f.combo ? "on" : ""} onClick=${() => setKind(false)}>
            <b>Lẻ (nằm ghép)</b><span>${money(unit)}/người</span>
          </button>
        </div>`}
      <div class="grid2">
        <${Field} label="Tên khách (không bắt buộc)">
          <input placeholder="Anh/chị…" value=${f.name} onInput=${(e) => set("name", e.target.value)} />
        <//>
        <${Field} label="Số người">
          <div class="stepper">
            <button type="button" onClick=${() => setQty(f.qty - 1)}>−</button>
            <span>${f.qty}</span>
            <button type="button" onClick=${() => setQty(f.qty + 1)}>+</button>
          </div>
        <//>
      </div>
      <${Field} label="Giá vé (tổng)" hint=${f.combo ? `Giá combo giường đôi: ${money(prices.combo)}` : `Giá lẻ: ${money(unit)}/người`}>
        <${MoneyInput} value=${f.price} onInput=${(v) => { setPriceTouched(true); set("price", v); }} />
      <//>
      ${more
        ? html`
          <${Field} label="Điểm trả"><input placeholder="Không bắt buộc" value=${f.dropoff} onInput=${(e) => set("dropoff", e.target.value)} /><//>
          <${Field} label="Ghi chú"><textarea rows="2" placeholder="Hàng gửi kèm, trẻ em…" value=${f.note} onInput=${(e) => set("note", e.target.value)}></textarea><//>`
        : html`<button type="button" class="link-btn" onClick=${() => setMore(true)}>+ Điểm trả, ghi chú</button>`}
      ${!booking && html`
        <label class="switch-row">
          <input type="checkbox" checked=${payNow} onChange=${(e) => setPayNow(e.target.checked)} />
          <span>Khách đã lên xe và trả tiền luôn (${money(f.price)})</span>
        </label>`}
      <div class="row-btns sticky">
        <button type="button" class="btn ghost" onClick=${onCancel}>Huỷ</button>
        <button class="btn primary grow" disabled=${busy}>${busy ? "Đang lưu…" : booking ? "Lưu" : "Thêm khách"}</button>
      </div>
    </form>`;
}
