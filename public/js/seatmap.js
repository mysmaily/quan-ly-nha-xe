// Mô hình xe: vẽ sơ đồ giường các tầng (dùng chung cho lơ xe và trình soạn sơ đồ)
import { html } from "./lib.js";

export const capacity = (seat) => (seat.type === "double" ? 2 : 1);

/** Trạng thái 1 giường từ danh sách khách trên giường đó */
export function seatStatus(bookings) {
  if (!bookings.length) return "empty";
  if (bookings.every((b) => b.paid)) return "paid";
  if (bookings.every((b) => b.boarded || b.paid)) return "boarded";
  return "booked";
}

const WHEEL = html`<svg class="wheel" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4">
  <circle cx="12" cy="12" r="9.5" /><circle cx="12" cy="12" r="2.2" /><path d="M3 11c3-1 6-1.4 9-1.4s6 .4 9 1.4M10.2 13.5 7 20M13.8 13.5 17 20" /></svg>`;

/** Lưới 1 tầng. renderCell(seat|null, r, c) trả về nội dung ô. fill = giãn kín chiều cao */
export function FloorGrid({ floor, renderCell, fill, driver, editor }) {
  const cells = [];
  const byPos = new Map(floor.seats.map((s) => [s.r + ":" + s.c, s]));
  for (let r = 0; r < floor.rows; r++)
    for (let c = 0; c < floor.cols; c++) cells.push(renderCell(byPos.get(r + ":" + c) || null, r, c));
  const style = `grid-template-columns: repeat(${floor.cols}, minmax(0, 1fr));`;
  return html`
    <div class="floor ${fill ? "fill" : ""} ${editor ? "editor" : ""}">
      <div class="floor-name">${driver && WHEEL}<span>${floor.name}</span></div>
      <div class="floor-grid" style=${style}>${cells}</div>
    </div>`;
}

/** Mô hình xe: các tầng nằm cạnh nhau, tầng 1 có vô lăng */
export function BusModel({ layout, renderCell, fill }) {
  const floors = layout.floors || [];
  if (!floors.length) return html`<div class="empty">Xe chưa có sơ đồ ghế. Chủ xe cần vào mục Xe để soạn sơ đồ.</div>`;
  return html`<div class="bus-model ${fill ? "fill" : ""}">
    ${floors.map((f, i) => html`<${FloorGrid} floor=${f} renderCell=${renderCell} fill=${fill} driver=${i === 0} />`)}
  </div>`;
}

/** Hình giường: mã ở giữa, gối ở cuối; giường đôi có 2 gối */
export function Bed({ seat, status = "empty", cls = "", onClick, disabled, children }) {
  return html`
    <button class="cell bed ${seat.type} ${status} ${cls}" disabled=${disabled} onClick=${onClick} aria-label=${"Giường " + seat.code}>
      <span class="code">${seat.code}</span>
      ${children}
      <span class="pillows">${seat.type === "double" ? html`<i></i><i></i>` : html`<i></i>`}</span>
    </button>`;
}

// ---------- tạo & đánh số sơ đồ ----------
const LETTERS = "ABCDEFGH";

/**
 * Đánh số. Kiểu "column" (giống xe thực tế): cột A/B/C, tầng 1 số lẻ, tầng 2 số chẵn
 *   (A1 dưới, A2 trên, A3 dưới…); giường ở lối đi hàng cuối lấy chữ cột ngoài cùng gần nhất, số tiếp theo (A13, C13).
 * Kiểu "floor": tầng 1 A1, A2…; tầng 2 B1, B2… theo thứ tự hàng.
 */
export function renumber(layout, naming = layout.naming || "column") {
  if (naming === "floor") {
    return {
      ...layout, naming,
      floors: layout.floors.map((f, fi) => {
        const sorted = f.seats.slice().sort((a, b) => a.r - b.r || a.c - b.c);
        return { ...f, seats: sorted.map((s, i) => ({ ...s, code: LETTERS[fi] + (i + 1) })) };
      }),
    };
  }
  const nF = layout.floors.length;
  const used = new Set();
  const floors = layout.floors.map((f, fi) => {
    // Cột "dãy" = cột có từ 2 giường trở lên
    const count = Array(f.cols).fill(0);
    for (const s of f.seats) count[s.c]++;
    const lanes = count.map((n, c) => (n >= 2 ? c : -1)).filter((c) => c >= 0);
    const laneLetter = new Map(lanes.map((c, i) => [c, LETTERS[i]]));
    const rowsUsed = [...new Set(f.seats.map((s) => s.r))].sort((a, b) => a - b);
    const rowNo = new Map(rowsUsed.map((r, i) => [r, i * nF + fi + 1]));
    const mid = (f.cols - 1) / 2;
    return {
      ...f,
      seats: f.seats.slice().sort((a, b) => a.r - b.r || a.c - b.c).map((s) => {
        let code;
        if (laneLetter.has(s.c)) code = laneLetter.get(s.c) + rowNo.get(s.r);
        else {
          const letter = lanes.length ? laneLetter.get(s.c <= mid ? lanes[0] : lanes[lanes.length - 1]) : "X";
          code = letter + (rowNo.get(s.r) + nF);
        }
        while (used.has(code)) code += "'";
        used.add(code);
        return { ...s, code };
      }),
    };
  });
  return { ...layout, naming, floors };
}

/** Tạo nhanh sơ đồ xe giường nằm */
export function generateLayout({ floors = 2, lanes = 3, rows = 5, backRow = true, type = "single", naming = "column" }) {
  const cols = lanes * 2 - 1; // giường - lối đi - giường ...
  const layout = {
    naming,
    floors: Array.from({ length: floors }, (_, fi) => {
      const seats = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c += 2) seats.push({ code: "", r, c, type, price: null });
      if (backRow) for (let c = 0; c < cols; c++) seats.push({ code: "", r: rows, c, type: "single", price: null });
      return { name: floors === 1 ? "Sơ đồ" : `Tầng ${fi + 1}`, rows: rows + (backRow ? 1 : 0), cols, seats };
    }),
  };
  return renumber(layout, naming);
}
