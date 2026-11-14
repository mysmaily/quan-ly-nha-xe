// Tạo dữ liệu mẫu để xem thử: bun src/seed-demo.ts
import { db } from "./db.ts";

// Giống xe thực tế: cột A/B/C, tầng 1 số lẻ, tầng 2 số chẵn, hàng cuối 5 giường
function layout(rows = 5) {
  const floors = [0, 1].map((fi) => {
    const seats: any[] = [];
    for (let r = 0; r < rows; r++)
      ["A", "B", "C"].forEach((L, i) => seats.push({ code: L + (2 * r + 1 + fi), r, c: i * 2, type: "single", price: r < 3 && fi === 0 ? 400000 : null }));
    const n = 2 * rows + 1 + fi;
    [["A", n], ["A", n + 2], ["B", n], ["C", n + 2], ["C", n]].forEach(([L, k], c) =>
      seats.push({ code: `${L}${k}`, r: rows, c, type: "single", price: 300000 }));
    return { name: `Tầng ${fi + 1}`, rows: rows + 1, cols: 5, seats };
  });
  return JSON.stringify({ naming: "column", floors });
}
const CODES = JSON.parse(layout()).floors.flatMap((f: any) => f.seats.map((s: any) => s.code));

const bus = db.query("INSERT INTO buses (plate, name, route_out, route_back, default_price, layout) VALUES (?,?,?,?,?,?)")
  .run("37B-123.45", "Xe 1", "Nghệ An → Hà Nội", "Hà Nội → Nghệ An", 350000, layout());
const busId = Number(bus.lastInsertRowid);
const staff = db.query("INSERT OR IGNORE INTO users (name, phone, pin_hash, role, job, bus_id) VALUES (?,?,?,?,?,?)")
  .run("Nguyễn Văn Lơ", "0911111111", Bun.password.hashSync("1111"), "staff", "lo_xe", busId);
db.query("INSERT OR IGNORE INTO users (name, phone, pin_hash, role, job, bus_id) VALUES (?,?,?,?,?,?)")
  .run("Trần Văn Lái", "0922222222", Bun.password.hashSync("2222"), "staff", "lai_xe", busId);

const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const day = (n: number) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const picks = ["Ngã tư Diễn Châu", "Cầu Giát", "Bến xe Vinh", "Chợ Hoàng Mai", "Quán Hành", "Thị xã Thái Hoà"];
for (let k = -20; k <= 0; k++) {
  for (const dir of ["di", "ve"]) {
    const t = db.query("INSERT OR IGNORE INTO trips (bus_id, date, direction, route) VALUES (?,?,?,?) RETURNING id")
      .get(busId, day(k), dir, dir === "di" ? "Nghệ An → Hà Nội" : "Hà Nội → Nghệ An") as any;
    const n = 8 + Math.floor(Math.random() * 18);
    for (let i = 0; i < n; i++) {
      const seat = CODES[(i * 7) % CODES.length];
      const paid = k < 0 || Math.random() < 0.35 ? 1 : 0;
      const boarded = paid || (k === 0 && Math.random() < 0.4) ? 1 : 0;
      const amount = Math.random() < 0.15 ? 300000 : 350000;
      db.query(`INSERT INTO bookings (trip_id, seat, phone, pickup, qty, price, boarded, paid, paid_amount, paid_at, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),?)`).run(
        t.id, seat, "09" + String(10000000 + Math.floor(Math.random() * 89999999)), picks[i % picks.length], 1, 350000, boarded, paid, paid ? amount : 0, Number(staff.lastInsertRowid) || null);
    }
  }
}
console.log("Đã tạo dữ liệu mẫu. Lơ xe: 0911111111 / 1111 · Lái xe: 0922222222 / 2222");
