// Trang chủ xe: thống kê, quản lý xe + sơ đồ ghế, nhân viên
import {
  html, useState, useEffect, api, money, moneyShort, phoneFmt, dateLabel, toast, ask, Sheet, MoneyInput, Field,
  Segmented, Empty, icon, JOBS,
} from "./lib.js";
import { FloorGrid, Bed, capacity, generateLayout, renumber } from "./seatmap.js";

// ================= THỐNG KÊ =================
const PERIODS = [
  { key: "today", label: "Hôm nay" },
  { key: "yesterday", label: "Hôm qua" },
  { key: "week", label: "Tuần này" },
  { key: "month", label: "Tháng này" },
  { key: "last_month", label: "Tháng trước" },
];

export function StatsPage() {
  const [period, setPeriod] = useState("today");
  const [data, setData] = useState(null);
  const [bar, setBar] = useState(null);
  const load = () => api("/stats?period=" + period).then(setData).catch((e) => toast(e.message, "err"));
  useEffect(() => { load(); }, [period]);
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    return () => clearInterval(t);
  }, [period]);
  if (!data) return html`<div class="page"><div class="loading">Đang tải…</div></div>`;

  const max = Math.max(1, ...data.daily.map((d) => d.revenue));
  const sel = bar != null ? data.daily[bar] : null;
  const label = PERIODS.find((p) => p.key === period).label;

  return html`
    <div class="page">
      <div class="stat-cards">
        ${PERIODS.map((p) => {
          const s = data.periods[p.key];
          return html`<button class="stat-card ${p.key === period ? "on" : ""} ${p.key === "today" ? "wide" : ""}" onClick=${() => setPeriod(p.key)}>
            <div class="sc-label">${p.label}</div>
            <div class="sc-value">${p.key === "today" ? money(s.revenue) : moneyShort(s.revenue)}</div>
            <div class="sc-sub">${s.passengers} khách${s.unpaid ? html` · <span class="c-booked">chưa thu ${moneyShort(s.unpaid)}</span>` : ""}</div>
          </button>`;
        })}
      </div>

      <div class="card">
        <div class="card-title">Doanh thu 14 ngày gần nhất
          <span class="muted">${sel ? `${dateLabel(sel.date, data.today)}: ${money(sel.revenue)} · ${sel.passengers} khách` : "Chạm vào cột để xem"}</span>
        </div>
        <div class="bars">
          ${data.daily.map((d, i) => html`
            <button class="bar ${i === bar ? "on" : ""} ${d.date === data.today ? "today" : ""}" onClick=${() => setBar(i === bar ? null : i)}>
              <i style=${`height:${Math.max(2, (d.revenue / max) * 100)}%`}></i>
              <span>${Number(d.date.slice(8))}</span>
            </button>`)}
        </div>
      </div>

      <div class="section-title"><span>Theo xe · ${label}</span></div>
      <div class="list">
        ${data.byBus.length ? data.byBus.map((b) => html`
          <div class="row static">
            <div class="row-icon">${icon("bus")}</div>
            <div class="row-main">
              <div class="row-title">${b.plate}${b.name && html` <span class="muted">· ${b.name}</span>`}</div>
              <div class="row-sub">${b.passengers} khách${b.unpaid ? html` · <span class="c-booked">chưa thu ${money(b.unpaid)}</span>` : ""}</div>
            </div>
            <div class="row-end"><b class="c-paid">${money(b.revenue)}</b></div>
          </div>`) : html`<${Empty}>Chưa có xe nào<//>`}
      </div>

      <div class="section-title"><span>Theo chuyến · ${label}</span></div>
      <div class="list">
        ${data.byTrip.length ? data.byTrip.map((t) => html`
          <div class="row static">
            <div class="row-main">
              <div class="row-title">${t.route}</div>
              <div class="row-sub">${dateLabel(t.date, data.today)} · ${t.plate} · ${t.passengers} khách</div>
            </div>
            <div class="row-end">
              <b class="c-paid">${moneyShort(t.revenue)}</b>
              ${t.unpaid > 0 && html`<small class="c-booked">+${moneyShort(t.unpaid)} chưa thu</small>`}
            </div>
          </div>`) : html`<${Empty}>Chưa có chuyến nào có khách<//>`}
      </div>
      <p class="hint center">Doanh thu = tiền lơ xe đã bấm "Đã thu". Tính theo ngày khởi hành của chuyến.</p>
    </div>`;
}

// ================= XE =================
export function BusesPage() {
  const [buses, setBuses] = useState(null);
  const [users, setUsers] = useState([]);
  const [edit, setEdit] = useState(null); // bus | "new"
  const load = () => {
    api("/buses").then(setBuses).catch((e) => toast(e.message, "err"));
    api("/users").then(setUsers).catch(() => {});
  };
  useEffect(load, []);
  if (!buses) return html`<div class="page"><div class="loading">Đang tải…</div></div>`;
  return html`
    <div class="page">
      <div class="list cards">
        ${buses.map((b) => {
          const seats = b.layout.floors.flatMap((f) => f.seats);
          const crew = users.filter((u) => u.bus_id === b.id);
          return html`<div class="row bus-row" onClick=${() => setEdit(b)}>
            <div class="row-icon">${icon("bus")}</div>
            <div class="row-main">
              <div class="row-title">${b.plate}${b.name && html` <span class="muted">· ${b.name}</span>`}</div>
              <div class="row-sub">Đi: ${b.route_out}</div>
              <div class="row-sub">Về: ${b.route_back}</div>
              <div class="row-sub">${seats.length} giường · ${seats.reduce((a, s) => a + capacity(s), 0)} chỗ · ${money(b.default_price)}</div>
              <div class="row-sub">${crew.length ? crew.map((u) => `${JOBS[u.job]} ${u.name}`).join(", ") : html`<span class="c-booked">Chưa phân công nhân viên</span>`}</div>
            </div>
            <div class="row-end">${icon("right")}</div>
          </div>`;
        })}
        ${!buses.length && html`<${Empty}>Chưa có xe nào. Bấm nút bên dưới để thêm xe đầu tiên.<//>`}
      </div>
      <button class="btn primary block" onClick=${() => setEdit("new")}>${icon("plus")} Thêm xe</button>
      ${edit && html`<${BusEditor} bus=${edit === "new" ? null : edit} onClose=${() => setEdit(null)}
        onSaved=${() => { setEdit(null); load(); }} />`}
    </div>`;
}

function BusEditor({ bus, onClose, onSaved }) {
  const [f, setF] = useState(() => bus
    ? { plate: bus.plate, name: bus.name, route_out: bus.route_out, route_back: bus.route_back, default_price: String(bus.default_price) }
    : { plate: "", name: "", route_out: "", route_back: "", default_price: "" });
  const [layout, setLayout] = useState(() => bus ? bus.layout : generateLayout({}));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  // Gợi ý tên chuyến về = đảo chiều chuyến đi
  const autoBack = (v) => {
    const parts = v.split(/\s*(?:→|->|-|–)\s*/);
    setF((x) => {
      const oldAuto = x.route_out.split(/\s*(?:→|->|-|–)\s*/).reverse().join(" → ");
      const back = !x.route_back || x.route_back === oldAuto ? (parts.length === 2 ? `${parts[1]} → ${parts[0]}` : x.route_back) : x.route_back;
      return { ...x, route_out: v, route_back: back };
    });
  };

  async function save() {
    setBusy(true);
    try {
      const body = { ...f, default_price: Number(f.default_price || 0), layout };
      await api(bus ? `/buses/${bus.id}` : "/buses", { method: bus ? "PUT" : "POST", body });
      toast("Đã lưu xe");
      onSaved();
    } catch (e) { toast(e.message, "err"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!(await ask(`Ngừng sử dụng xe ${bus.plate}? Lịch sử doanh thu vẫn được giữ lại.`, { ok: "Ngừng xe", danger: true }))) return;
    try { await api(`/buses/${bus.id}`, { method: "DELETE" }); toast("Đã ngừng xe"); onSaved(); }
    catch (e) { toast(e.message, "err"); }
  }

  return html`<${Sheet} full title=${bus ? "Sửa xe " + bus.plate : "Thêm xe mới"} onClose=${onClose}
    footer=${html`<button class="btn ghost" onClick=${onClose}>Huỷ</button><button class="btn primary grow" disabled=${busy} onClick=${save}>${busy ? "Đang lưu…" : "Lưu xe"}</button>`}>
    <div class="form">
      <div class="grid2">
        <${Field} label="Biển số"><input placeholder="37B-123.45" value=${f.plate} onInput=${(e) => set("plate", e.target.value)} /><//>
        <${Field} label="Tên gọi (tuỳ chọn)"><input placeholder="Xe số 1" value=${f.name} onInput=${(e) => set("name", e.target.value)} /><//>
      </div>
      <${Field} label="Tên chuyến đi"><input placeholder="Nghệ An → Hà Nội" value=${f.route_out} onInput=${(e) => autoBack(e.target.value)} /><//>
      <${Field} label="Tên chuyến về"><input placeholder="Hà Nội → Nghệ An" value=${f.route_back} onInput=${(e) => set("route_back", e.target.value)} /><//>
      <${Field} label="Giá vé mặc định / người" hint="Giường nào không đặt giá riêng sẽ dùng giá này">
        <${MoneyInput} value=${f.default_price} onInput=${(v) => set("default_price", v)} />
      <//>
    </div>
    <div class="section-title"><span>Sơ đồ giường</span></div>
    <${LayoutEditor} layout=${layout} onChange=${setLayout} defaultPrice=${Number(f.default_price || 0)} />
    ${bus && html`<button class="btn block ghost danger-text" onClick=${remove}>${icon("trash", 18)} Ngừng sử dụng xe này</button>`}
  <//>`;
}

// ---------- trình soạn sơ đồ ----------
function LayoutEditor({ layout, onChange, defaultPrice }) {
  const [fi, setFi] = useState(0);
  const [tool, setTool] = useState("select");
  const [sel, setSel] = useState(null); // {r, c}
  const [gen, setGen] = useState(null);
  const floors = layout.floors;
  const floor = floors[Math.min(fi, floors.length - 1)];
  const allSeats = floors.flatMap((f) => f.seats);

  const updateFloor = (fn) => onChange({ ...layout, floors: floors.map((f, i) => (i === fi ? fn(f) : f)) });
  const nextCode = () => {
    const prefix = "ABC"[fi] || "D";
    const used = new Set(allSeats.map((s) => s.code));
    let n = 1;
    while (used.has(prefix + n)) n++;
    return prefix + n;
  };

  function tap(r, c, seat) {
    if (tool === "select") { setSel(seat ? { r, c } : null); return; }
    if (tool === "erase") { if (seat) updateFloor((f) => ({ ...f, seats: f.seats.filter((s) => s !== seat) })); return; }
    const type = tool;
    if (seat) updateFloor((f) => ({ ...f, seats: f.seats.map((s) => (s === seat ? { ...s, type } : s)) }));
    else updateFloor((f) => ({ ...f, seats: [...f.seats, { code: nextCode(), r, c, type, price: null }] }));
  }

  function resize(dr, dc) {
    updateFloor((f) => {
      const rows = Math.max(1, Math.min(20, f.rows + dr));
      const cols = Math.max(1, Math.min(8, f.cols + dc));
      return { ...f, rows, cols, seats: f.seats.filter((s) => s.r < rows && s.c < cols) };
    });
  }

  const selSeat = sel && floor?.seats.find((s) => s.r === sel.r && s.c === sel.c);
  const patchSel = (p) => updateFloor((f) => ({ ...f, seats: f.seats.map((s) => (s === selSeat ? { ...s, ...p } : s)) }));

  async function setFloorPrice() {
    const v = await ask(`Đặt giá cho tất cả giường ở "${floor.name}" (để trống = dùng giá mặc định):`, { ok: "Áp dụng", input: { value: "" } });
    if (v === false) return;
    updateFloor((f) => ({ ...f, seats: f.seats.map((s) => ({ ...s, price: v === "" ? null : Number(v) })) }));
  }

  const renderCell = (seat, r, c) => {
    const isSel = sel && sel.r === r && sel.c === c && seat;
    if (!seat) return html`<button class="cell slot" onClick=${() => tap(r, c, null)}>${tool === "single" || tool === "double" ? "+" : ""}</button>`;
    return html`<${Bed} seat=${seat} cls=${"edit" + (isSel ? " selected" : "")} onClick=${() => tap(r, c, seat)}>
      <span class="who">${moneyShort(seat.price ?? defaultPrice)}</span>
    <//>`;
  };

  return html`
    <div class="layout-editor">
      <div class="floor-tabs">
        ${floors.map((f, i) => html`<button class=${i === fi ? "on" : ""} onClick=${() => { setFi(i); setSel(null); }}>${f.name} <small>${f.seats.length}</small></button>`)}
        ${floors.length < 3 && html`<button onClick=${() => { onChange({ ...layout, floors: [...floors, { name: `Tầng ${floors.length + 1}`, rows: floor?.rows || 6, cols: floor?.cols || 5, seats: [] }] }); setFi(floors.length); }}>+ Tầng</button>`}
      </div>

      <div class="editor-bar">
        <button class="btn sm outline" onClick=${() => setGen({ floors: 2, lanes: 3, rows: 5, backRow: true, type: "single", naming: layout.naming || "column" })}>Tạo nhanh</button>
        <button class="btn sm outline" onClick=${() => onChange(renumber(layout))}>Đánh số lại</button>
      </div>
      <div class="field naming">
        <span class="field-label">Cách đánh số</span>
        <${Segmented} value=${layout.naming || "column"} onChange=${(v) => onChange(renumber(layout, v))} options=${[
          { value: "column", label: "Cột A/B/C · T1 lẻ, T2 chẵn" }, { value: "floor", label: "Theo tầng A…, B…" }]} />
      </div>
      <div class="editor-bar">
        ${floor && html`<button class="btn sm outline" onClick=${setFloorPrice}>Giá cả tầng</button>`}
      </div>

      ${floor ? html`
        <${Segmented} value=${tool} onChange=${(t) => { setTool(t); setSel(null); }} options=${[
          { value: "select", label: "Chọn" }, { value: "single", label: "+ Đơn" }, { value: "double", label: "+ Đôi" }, { value: "erase", label: "Xoá" },
        ]} />
        <p class="hint">${{ select: "Chạm vào giường để sửa mã, giá.", single: "Chạm ô trống để thêm giường đơn.", double: "Chạm ô trống để thêm giường đôi.", erase: "Chạm giường để xoá." }[tool]}</p>
        <div class="resize">
          <span>Hàng</span><button class="btn sm ghost" onClick=${() => resize(-1, 0)}>−</button><b>${floor.rows}</b><button class="btn sm ghost" onClick=${() => resize(1, 0)}>+</button>
          <span>Cột</span><button class="btn sm ghost" onClick=${() => resize(0, -1)}>−</button><b>${floor.cols}</b><button class="btn sm ghost" onClick=${() => resize(0, 1)}>+</button>
        </div>
        <${FloorGrid} floor=${floor} renderCell=${renderCell} editor />
        ${selSeat && html`
          <div class="inspector card">
            <div class="grid2">
              <${Field} label="Mã giường"><input value=${selSeat.code} onInput=${(e) => patchSel({ code: e.target.value.toUpperCase().slice(0, 10) })} /><//>
              <${Field} label="Loại">
                <${Segmented} value=${selSeat.type} onChange=${(t) => patchSel({ type: t })} options=${[{ value: "single", label: "Đơn" }, { value: "double", label: "Đôi" }]} />
              <//>
            </div>
            <${Field} label="Giá riêng / người" hint=${`Để trống = giá mặc định (${money(defaultPrice)})`}>
              <${MoneyInput} value=${selSeat.price ?? ""} placeholder=${String(defaultPrice)} onInput=${(v) => patchSel({ price: v === "" ? null : Number(v) })} />
            <//>
            <div class="row-btns">
              <button class="btn ghost danger-text" onClick=${() => { updateFloor((f) => ({ ...f, seats: f.seats.filter((s) => s !== selSeat) })); setSel(null); }}>${icon("trash", 16)} Xoá giường</button>
              <button class="btn ghost" onClick=${() => setSel(null)}>Xong</button>
            </div>
          </div>`}
        <div class="row-btns">
          <${Field} label="Tên tầng"><input value=${floor.name} onInput=${(e) => updateFloor((f) => ({ ...f, name: e.target.value }))} /><//>
          ${floors.length > 1 && html`<button class="btn ghost danger-text" onClick=${async () => {
            if (await ask(`Xoá "${floor.name}" và toàn bộ giường trên tầng này?`, { ok: "Xoá tầng", danger: true })) {
              onChange({ ...layout, floors: floors.filter((_, i) => i !== fi) }); setFi(0);
            }
          }}>Xoá tầng</button>`}
        </div>
        <p class="hint">Tổng: ${allSeats.length} giường · ${allSeats.reduce((a, s) => a + capacity(s), 0)} chỗ (giường đôi = 2 chỗ)</p>
      ` : html`<${Empty}>Chưa có tầng nào<//>`}

      ${gen && html`<${Sheet} title="Tạo nhanh sơ đồ" onClose=${() => setGen(null)}>
        <div class="form">
          <${Field} label="Số tầng"><${Segmented} value=${gen.floors} onChange=${(v) => setGen({ ...gen, floors: v })} options=${[{ value: 1, label: "1 tầng" }, { value: 2, label: "2 tầng" }]} /><//>
          <${Field} label="Số dãy giường"><${Segmented} value=${gen.lanes} onChange=${(v) => setGen({ ...gen, lanes: v })} options=${[{ value: 2, label: "2 dãy" }, { value: 3, label: "3 dãy" }]} /><//>
          <${Field} label="Cách đánh số"><${Segmented} value=${gen.naming} onChange=${(v) => setGen({ ...gen, naming: v })} options=${[{ value: "column", label: "A1 dưới, A2 trên" }, { value: "floor", label: "Tầng A…, tầng B…" }]} /><//>
          <${Field} label="Loại giường"><${Segmented} value=${gen.type} onChange=${(v) => setGen({ ...gen, type: v })} options=${[{ value: "single", label: "Đơn" }, { value: "double", label: "Đôi" }]} /><//>
          <${Field} label="Số hàng mỗi tầng">
            <div class="stepper">
              <button type="button" onClick=${() => setGen({ ...gen, rows: Math.max(1, gen.rows - 1) })}>−</button><span>${gen.rows}</span>
              <button type="button" onClick=${() => setGen({ ...gen, rows: Math.min(15, gen.rows + 1) })}>+</button>
            </div>
          <//>
          <label class="switch-row"><input type="checkbox" checked=${gen.backRow} onChange=${(e) => setGen({ ...gen, backRow: e.target.checked })} /><span>Có hàng cuối nằm liền (băng cuối)</span></label>
          <p class="hint">Sẽ tạo ${(() => { const l = generateLayout(gen); return l.floors.reduce((a, f) => a + f.seats.length, 0); })()} giường. Sau đó chạm từng giường để chỉnh sửa.</p>
          <div class="row-btns">
            <button class="btn ghost" onClick=${() => setGen(null)}>Huỷ</button>
            <button class="btn primary grow" onClick=${async () => {
              if (allSeats.length && !(await ask("Thay toàn bộ sơ đồ hiện tại?", { ok: "Thay sơ đồ", danger: true }))) return;
              onChange(generateLayout(gen)); setFi(0); setSel(null); setGen(null);
            }}>Tạo sơ đồ</button>
          </div>
        </div>
      <//>`}
    </div>`;
}

// ================= NHÂN VIÊN =================
export function StaffPage({ me }) {
  const [users, setUsers] = useState(null);
  const [buses, setBuses] = useState([]);
  const [edit, setEdit] = useState(null);
  const load = () => {
    api("/users").then(setUsers).catch((e) => toast(e.message, "err"));
    api("/buses").then(setBuses).catch(() => {});
  };
  useEffect(load, []);
  if (!users) return html`<div class="page"><div class="loading">Đang tải…</div></div>`;

  const groups = [
    ...buses.map((b) => ({ title: `Xe ${b.plate}${b.name ? " · " + b.name : ""}`, list: users.filter((u) => u.bus_id === b.id) })),
    { title: "Chưa phân công xe", list: users.filter((u) => !u.bus_id || !buses.some((b) => b.id === u.bus_id)) },
  ].filter((g) => g.list.length);

  return html`
    <div class="page">
      ${groups.map((g) => html`
        <div class="section-title"><span>${g.title}</span></div>
        <div class="list">
          ${g.list.map((u) => html`
            <div class="row" onClick=${() => setEdit(u)}>
              <div class="avatar">${u.name.trim().split(/\s+/).pop()[0]?.toUpperCase()}</div>
              <div class="row-main">
                <div class="row-title">${u.name}${u.role === "admin" && html` <span class="pill paid">Chủ xe</span>`}</div>
                <div class="row-sub">${JOBS[u.job]} · ${phoneFmt(u.phone)}</div>
              </div>
              <a class="call-mini" href=${"tel:" + u.phone} onClick=${(e) => e.stopPropagation()}>${icon("phone", 18)}</a>
            </div>`)}
        </div>`)}
      <button class="btn primary block" onClick=${() => setEdit("new")}>${icon("plus")} Thêm nhân viên</button>
      ${edit && html`<${UserEditor} user=${edit === "new" ? null : edit} me=${me} buses=${buses}
        onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); load(); }} />`}
    </div>`;
}

function UserEditor({ user, me, buses, onClose, onSaved }) {
  const [f, setF] = useState(() => user
    ? { name: user.name, phone: user.phone, pin: "", job: user.job, role: user.role, bus_id: user.bus_id || "" }
    : { name: "", phone: "", pin: "", job: "lo_xe", role: "staff", bus_id: buses[0]?.id || "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(user ? `/users/${user.id}` : "/users", { method: user ? "PUT" : "POST", body: { ...f, bus_id: f.bus_id || null } });
      toast("Đã lưu nhân viên");
      onSaved();
    } catch (err) { toast(err.message, "err"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!(await ask(`Xoá nhân viên ${user.name}? Họ sẽ không đăng nhập được nữa.`, { ok: "Xoá", danger: true }))) return;
    try { await api(`/users/${user.id}`, { method: "DELETE" }); toast("Đã xoá"); onSaved(); }
    catch (err) { toast(err.message, "err"); }
  }

  return html`<${Sheet} title=${user ? "Sửa nhân viên" : "Thêm nhân viên"} onClose=${onClose}>
    <form class="form" onSubmit=${save}>
      <${Field} label="Họ tên"><input value=${f.name} placeholder="Nguyễn Văn A" onInput=${(e) => set("name", e.target.value)} /><//>
      <${Field} label="Số điện thoại (dùng để đăng nhập)"><input type="tel" inputmode="tel" value=${f.phone} onInput=${(e) => set("phone", e.target.value)} /><//>
      <${Field} label=${user ? "Mã PIN mới" : "Mã PIN"} hint=${user ? "Để trống nếu không đổi PIN" : "4–12 chữ số, đưa cho nhân viên để đăng nhập"}>
        <input inputmode="numeric" autocomplete="off" value=${f.pin} placeholder=${user ? "••••" : "VD: 1234"} onInput=${(e) => set("pin", e.target.value.replace(/\D/g, ""))} />
      <//>
      <${Field} label="Công việc">
        <${Segmented} value=${f.job} onChange=${(v) => set("job", v)} options=${Object.entries(JOBS).map(([value, label]) => ({ value, label }))} />
      <//>
      <${Field} label="Làm việc trên xe">
        <select value=${f.bus_id} onChange=${(e) => set("bus_id", e.target.value ? Number(e.target.value) : "")}>
          <option value="">— Chưa phân công —</option>
          ${buses.map((b) => html`<option value=${b.id}>${b.plate}${b.name ? " · " + b.name : ""}</option>`)}
        </select>
      <//>
      <${Field} label="Quyền" hint="Chủ xe xem được doanh thu, quản lý xe và nhân viên">
        <${Segmented} value=${f.role} onChange=${(v) => set("role", v)} options=${[{ value: "staff", label: "Nhân viên" }, { value: "admin", label: "Chủ xe" }]} />
      <//>
      <div class="row-btns">
        ${user && user.id !== me.id && html`<button type="button" class="btn ghost danger-text" onClick=${remove}>${icon("trash", 16)} Xoá</button>`}
        <button class="btn primary grow" disabled=${busy}>${busy ? "Đang lưu…" : "Lưu"}</button>
      </div>
    </form>
  <//>`;
}
