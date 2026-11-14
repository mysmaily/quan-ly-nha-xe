import { db } from "./db.ts";
import { join, normalize } from "node:path";

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const SESSION_DAYS = 180;
const SECURE_COOKIE = process.env.COOKIE_SECURE === "1";

// ---------- helpers ----------
type User = {
  id: number; name: string; phone: string; role: "admin" | "staff"; job: string;
  bus_id: number | null; active: number;
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init.headers || {}) },
  });

/** Ngày hiện tại theo giờ Việt Nam (UTC+7) */
function vnToday(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}
function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const MAX_MONEY = 100_000_000; // chặn nhập nhầm số tiền quá lớn
const moneyVal = (v: unknown) => {
  const n = Math.max(0, int(v));
  if (n > MAX_MONEY) throw new HttpError(400, "Số tiền quá lớn, vui lòng kiểm tra lại");
  return n;
};
const int = (v: unknown, def = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : def;
};
const normPhone = (p: unknown) => str(p, 20).replace(/[^\d+]/g, "");

function getCookie(req: Request, name: string) {
  const c = req.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]!) : null;
}

function currentUser(req: Request): User | null {
  const token = getCookie(req, "sid");
  if (!token) return null;
  const row = db
    .query(
      `SELECT u.id, u.name, u.phone, u.role, u.job, u.bus_id, u.active, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    )
    .get(token) as (User & { expires_at: number }) | null;
  if (!row || row.expires_at < Date.now() || !row.active) return null;
  const { expires_at, ...user } = row;
  return user;
}

function requireAdmin(u: User) {
  if (u.role !== "admin") throw new HttpError(403, "Chỉ chủ xe mới có quyền này");
}

function parseBus(row: any) {
  if (!row) return row;
  return { ...row, layout: JSON.parse(row.layout || '{"floors":[]}') };
}

function getBus(id: number) {
  const bus = db.query("SELECT * FROM buses WHERE id = ?").get(id);
  if (!bus) throw new HttpError(404, "Không tìm thấy xe");
  return parseBus(bus);
}

/** Lơ xe chỉ được thao tác trên xe mình được phân công */
function assertBusAccess(u: User, busId: number) {
  if (u.role === "admin") return;
  if (u.bus_id !== busId) throw new HttpError(403, "Bạn không được phân công xe này");
}

function getTripById(id: number) {
  const trip = db.query("SELECT * FROM trips WHERE id = ?").get(id) as any;
  if (!trip) throw new HttpError(404, "Không tìm thấy chuyến");
  return trip;
}

function getOrCreateTrip(busId: number, date: string, direction: "di" | "ve") {
  const bus = getBus(busId);
  const route = direction === "di" ? bus.route_out : bus.route_back;
  db.query("INSERT OR IGNORE INTO trips (bus_id, date, direction, route) VALUES (?, ?, ?, ?)").run(busId, date, direction, route);
  const trip = db.query("SELECT * FROM trips WHERE bus_id = ? AND date = ? AND direction = ?").get(busId, date, direction) as any;
  // Cập nhật tên tuyến nếu admin vừa đổi
  if (trip.route !== route) {
    db.query("UPDATE trips SET route = ? WHERE id = ?").run(route, trip.id);
    trip.route = route;
  }
  return { trip, bus };
}

function seatPrice(bus: any, seatCode: string | null): number {
  if (!seatCode) return bus.default_price;
  for (const f of bus.layout.floors || []) {
    for (const s of f.seats || []) {
      if (s.code === seatCode) return s.price ?? bus.default_price;
    }
  }
  return bus.default_price;
}

const BOOKING_COLS = `b.id, b.trip_id, b.seat, b.phone, b.name, b.pickup, b.dropoff, b.note, b.qty, b.price,
  b.boarded, b.paid, b.paid_amount, b.paid_at, b.status, b.created_at, b.updated_at, u.name AS created_by_name`;

function getBooking(id: number) {
  const b = db.query(`SELECT ${BOOKING_COLS} FROM bookings b LEFT JOIN users u ON u.id = b.created_by WHERE b.id = ?`).get(id) as any;
  if (!b) throw new HttpError(404, "Không tìm thấy khách");
  return b;
}

function bookingAccess(u: User, id: number) {
  const b = getBooking(id);
  const trip = getTripById(b.trip_id);
  assertBusAccess(u, trip.bus_id);
  return { b, trip };
}

// ---------- stats ----------
function periodRange(period: string, today = vnToday()): [string, string] {
  const d = new Date(today + "T00:00:00Z");
  switch (period) {
    case "today": return [today, today];
    case "yesterday": { const y = addDays(today, -1); return [y, y]; }
    case "week": {
      const dow = (d.getUTCDay() + 6) % 7; // thứ 2 = 0
      return [addDays(today, -dow), today];
    }
    case "month": return [today.slice(0, 8) + "01", today];
    case "last_month": {
      const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
      return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
    }
    default: throw new HttpError(400, "Kỳ thống kê không hợp lệ");
  }
}

function sumRange(from: string, to: string, busId?: number) {
  const busFilter = busId ? "AND t.bus_id = ?" : "";
  const args: any[] = [from, to];
  if (busId) args.push(busId);
  return db
    .query(
      `SELECT
        COALESCE(SUM(CASE WHEN b.paid = 1 THEN b.paid_amount END), 0) AS revenue,
        COALESCE(SUM(CASE WHEN b.paid = 0 THEN b.price END), 0) AS unpaid,
        COALESCE(SUM(b.qty), 0) AS passengers,
        COUNT(DISTINCT b.trip_id) AS trips
      FROM bookings b JOIN trips t ON t.id = b.trip_id
      WHERE b.status = 'active' AND t.date BETWEEN ? AND ? ${busFilter}`,
    )
    .get(...args) as { revenue: number; unpaid: number; passengers: number; trips: number };
}

function stats(period: string) {
  const today = vnToday();
  const periods: Record<string, any> = {};
  for (const p of ["today", "yesterday", "week", "month", "last_month"]) {
    const [from, to] = periodRange(p, today);
    periods[p] = { from, to, ...sumRange(from, to) };
  }
  const [from, to] = periodRange(period, today);
  const byBus = db
    .query(
      `SELECT bu.id, bu.plate, bu.name,
        COALESCE(SUM(CASE WHEN b.paid = 1 THEN b.paid_amount END), 0) AS revenue,
        COALESCE(SUM(CASE WHEN b.paid = 0 THEN b.price END), 0) AS unpaid,
        COALESCE(SUM(b.qty), 0) AS passengers
      FROM buses bu
      LEFT JOIN trips t ON t.bus_id = bu.id AND t.date BETWEEN ? AND ?
      LEFT JOIN bookings b ON b.trip_id = t.id AND b.status = 'active'
      WHERE bu.active = 1
      GROUP BY bu.id ORDER BY revenue DESC, bu.plate`,
    )
    .all(from, to);
  const byTrip = db
    .query(
      `SELECT t.id, t.date, t.direction, t.route, bu.plate,
        COALESCE(SUM(CASE WHEN b.paid = 1 THEN b.paid_amount END), 0) AS revenue,
        COALESCE(SUM(CASE WHEN b.paid = 0 THEN b.price END), 0) AS unpaid,
        COALESCE(SUM(b.qty), 0) AS passengers
      FROM trips t JOIN buses bu ON bu.id = t.bus_id
      JOIN bookings b ON b.trip_id = t.id AND b.status = 'active'
      WHERE t.date BETWEEN ? AND ?
      GROUP BY t.id ORDER BY t.date DESC, bu.plate, t.direction LIMIT 100`,
    )
    .all(from, to);
  // Biểu đồ 14 ngày gần nhất
  const start = addDays(today, -13);
  const rows = db
    .query(
      `SELECT t.date,
        COALESCE(SUM(CASE WHEN b.paid = 1 THEN b.paid_amount END), 0) AS revenue,
        COALESCE(SUM(b.qty), 0) AS passengers
      FROM trips t JOIN bookings b ON b.trip_id = t.id AND b.status = 'active'
      WHERE t.date BETWEEN ? AND ? GROUP BY t.date`,
    )
    .all(start, today) as any[];
  const map = new Map(rows.map((r) => [r.date, r]));
  const daily = Array.from({ length: 14 }, (_, i) => {
    const date = addDays(start, i);
    return { date, revenue: map.get(date)?.revenue || 0, passengers: map.get(date)?.passengers || 0 };
  });
  return { today, period, from, to, periods, byBus, byTrip, daily };
}

// ---------- layout validation ----------
function cleanLayout(input: any) {
  const floors = Array.isArray(input?.floors) ? input.floors.slice(0, 3) : [];
  const codes = new Set<string>();
  return {
    floors: floors.map((f: any, i: number) => {
      const rows = Math.min(Math.max(int(f.rows, 6), 1), 20);
      const cols = Math.min(Math.max(int(f.cols, 3), 1), 8);
      const seats = (Array.isArray(f.seats) ? f.seats : [])
        .filter((s: any) => int(s.r, -1) >= 0 && int(s.r) < rows && int(s.c, -1) >= 0 && int(s.c) < cols)
        .map((s: any) => {
          let code = str(s.code, 10) || `${i + 1}-${s.r}-${s.c}`;
          while (codes.has(code)) code += "'";
          codes.add(code);
          const price = s.price === null || s.price === undefined || s.price === "" ? null : Math.max(0, int(s.price));
          return { code, r: int(s.r), c: int(s.c), type: s.type === "double" ? "double" : "single", price };
        });
      return { name: str(f.name, 30) || `Tầng ${i + 1}`, rows, cols, seats };
    }),
  };
}

// ---------- routes ----------
type Ctx = { req: Request; url: URL; user: User; params: string[]; body: any };
type Handler = (c: Ctx) => any;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, path: string, h: Handler) =>
  routes.push([method, new RegExp("^" + path.replace(/:\w+/g, "([^/]+)") + "$"), h]);

route("GET", "/api/me", ({ user }) => ({
  user,
  bus: user.bus_id ? parseBus(db.query("SELECT * FROM buses WHERE id = ?").get(user.bus_id)) : null,
  today: vnToday(),
}));

route("POST", "/api/me/pin", ({ user, body }) => {
  const pin = str(body.pin, 12);
  if (!/^\d{4,12}$/.test(pin)) throw new HttpError(400, "PIN phải gồm 4–12 chữ số");
  const row = db.query("SELECT pin_hash FROM users WHERE id = ?").get(user.id) as any;
  if (!Bun.password.verifySync(str(body.old_pin, 12), row.pin_hash)) throw new HttpError(400, "PIN cũ không đúng");
  db.query("UPDATE users SET pin_hash = ? WHERE id = ?").run(Bun.password.hashSync(pin), user.id);
  return { ok: true };
});

// Xe
route("GET", "/api/buses", ({ user }) => {
  const rows =
    user.role === "admin"
      ? db.query("SELECT * FROM buses WHERE active = 1 ORDER BY plate").all()
      : db.query("SELECT * FROM buses WHERE id = ? AND active = 1").all(user.bus_id ?? -1);
  return rows.map(parseBus);
});

function busFields(body: any) {
  const plate = str(body.plate, 20).toUpperCase();
  const route_out = str(body.route_out, 100);
  const route_back = str(body.route_back, 100);
  if (!plate) throw new HttpError(400, "Chưa nhập biển số xe");
  if (!route_out || !route_back) throw new HttpError(400, "Chưa nhập tên chuyến đi / chuyến về");
  return {
    plate, route_out, route_back,
    name: str(body.name, 60),
    default_price: moneyVal(body.default_price),
    layout: JSON.stringify(cleanLayout(body.layout)),
  };
}

route("POST", "/api/buses", ({ user, body }) => {
  requireAdmin(user);
  const f = busFields(body);
  const r = db
    .query("INSERT INTO buses (plate, name, route_out, route_back, default_price, layout) VALUES (?, ?, ?, ?, ?, ?)")
    .run(f.plate, f.name, f.route_out, f.route_back, f.default_price, f.layout);
  return getBus(Number(r.lastInsertRowid));
});

route("PUT", "/api/buses/:id", ({ user, body, params }) => {
  requireAdmin(user);
  const id = int(params[0]);
  getBus(id);
  const f = busFields(body);
  db.query("UPDATE buses SET plate = ?, name = ?, route_out = ?, route_back = ?, default_price = ?, layout = ? WHERE id = ?").run(
    f.plate, f.name, f.route_out, f.route_back, f.default_price, f.layout, id,
  );
  return getBus(id);
});

route("DELETE", "/api/buses/:id", ({ user, params }) => {
  requireAdmin(user);
  const id = int(params[0]);
  // Ẩn xe (giữ lại lịch sử doanh thu), gỡ phân công nhân viên
  db.query("UPDATE buses SET active = 0 WHERE id = ?").run(id);
  db.query("UPDATE users SET bus_id = NULL WHERE bus_id = ?").run(id);
  return { ok: true };
});

// Chuyến + danh sách khách
route("GET", "/api/trip", ({ user, url }) => {
  const busId = int(url.searchParams.get("bus_id"));
  const date = url.searchParams.get("date") || vnToday();
  const direction = url.searchParams.get("direction") === "ve" ? "ve" : "di";
  if (!isDate(date)) throw new HttpError(400, "Ngày không hợp lệ");
  assertBusAccess(user, busId);
  const { trip, bus } = getOrCreateTrip(busId, date, direction);
  if (!bus.active) throw new HttpError(404, "Xe đã ngừng hoạt động");
  const bookings = db
    .query(`SELECT ${BOOKING_COLS} FROM bookings b LEFT JOIN users u ON u.id = b.created_by
            WHERE b.trip_id = ? AND b.status = 'active' ORDER BY b.created_at, b.id`)
    .all(trip.id);
  return { trip, bus, bookings };
});

route("POST", "/api/bookings", ({ user, body }) => {
  const trip = getTripById(int(body.trip_id));
  assertBusAccess(user, trip.bus_id);
  const bus = getBus(trip.bus_id);
  const seat = str(body.seat, 10) || null;
  const qty = Math.min(Math.max(int(body.qty, 1), 1), 50);
  const phone = normPhone(body.phone);
  if (!phone && !str(body.name)) throw new HttpError(400, "Nhập số điện thoại hoặc tên khách");
  const price = body.price === undefined || body.price === null || body.price === ""
    ? seatPrice(bus, seat) * qty
    : moneyVal(body.price);
  const r = db
    .query(`INSERT INTO bookings (trip_id, seat, phone, name, pickup, dropoff, note, qty, price, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(trip.id, seat, phone, str(body.name, 60), str(body.pickup, 200), str(body.dropoff, 200), str(body.note, 300), qty, price, user.id);
  return getBooking(Number(r.lastInsertRowid));
});

route("PUT", "/api/bookings/:id", ({ user, body, params }) => {
  const { b } = bookingAccess(user, int(params[0]));
  const next = {
    seat: "seat" in body ? str(body.seat, 10) || null : b.seat,
    phone: "phone" in body ? normPhone(body.phone) : b.phone,
    name: "name" in body ? str(body.name, 60) : b.name,
    pickup: "pickup" in body ? str(body.pickup, 200) : b.pickup,
    dropoff: "dropoff" in body ? str(body.dropoff, 200) : b.dropoff,
    note: "note" in body ? str(body.note, 300) : b.note,
    qty: "qty" in body ? Math.min(Math.max(int(body.qty, 1), 1), 50) : b.qty,
    price: "price" in body ? moneyVal(body.price) : b.price,
  };
  db.query(`UPDATE bookings SET seat = ?, phone = ?, name = ?, pickup = ?, dropoff = ?, note = ?, qty = ?, price = ?,
            updated_at = datetime('now') WHERE id = ?`)
    .run(next.seat, next.phone, next.name, next.pickup, next.dropoff, next.note, next.qty, next.price, b.id);
  return getBooking(b.id);
});

route("POST", "/api/bookings/:id/pay", ({ user, body, params }) => {
  const { b } = bookingAccess(user, int(params[0]));
  const amount = body.amount === undefined || body.amount === null || body.amount === "" ? b.price : moneyVal(body.amount);
  db.query("UPDATE bookings SET paid = 1, boarded = 1, paid_amount = ?, paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(amount, b.id);
  return getBooking(b.id);
});

route("POST", "/api/bookings/:id/board", ({ user, body, params }) => {
  const { b } = bookingAccess(user, int(params[0]));
  db.query("UPDATE bookings SET boarded = ?, updated_at = datetime('now') WHERE id = ?").run(body.boarded === false ? 0 : 1, b.id);
  return getBooking(b.id);
});

route("POST", "/api/bookings/:id/unpay", ({ user, params }) => {
  const { b } = bookingAccess(user, int(params[0]));
  db.query("UPDATE bookings SET paid = 0, paid_amount = 0, paid_at = NULL, updated_at = datetime('now') WHERE id = ?").run(b.id);
  return getBooking(b.id);
});

route("DELETE", "/api/bookings/:id", ({ user, params }) => {
  const { b } = bookingAccess(user, int(params[0]));
  db.query("UPDATE bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(b.id);
  return { ok: true };
});

// Gợi ý: khách quen theo SĐT, điểm đón hay dùng
route("GET", "/api/lookup", ({ user, url }) => {
  const busId = int(url.searchParams.get("bus_id"));
  assertBusAccess(user, busId);
  const phone = normPhone(url.searchParams.get("phone"));
  const customer = phone.length >= 9
    ? db.query(`SELECT b.name, b.pickup, b.dropoff FROM bookings b JOIN trips t ON t.id = b.trip_id
                WHERE b.phone = ? AND t.bus_id = ? ORDER BY b.id DESC LIMIT 1`).get(phone, busId)
    : null;
  const pickups = (db.query(`SELECT b.pickup, COUNT(*) AS n FROM bookings b JOIN trips t ON t.id = b.trip_id
       WHERE t.bus_id = ? AND b.pickup <> '' AND t.date >= ? GROUP BY b.pickup ORDER BY n DESC LIMIT 30`)
    .all(busId, addDays(vnToday(), -60)) as any[]).map((r) => r.pickup);
  return { customer, pickups };
});

// Thống kê
route("GET", "/api/stats", ({ user, url }) => {
  requireAdmin(user);
  return stats(url.searchParams.get("period") || "today");
});

// Nhân viên
const USER_COLS = "u.id, u.name, u.phone, u.role, u.job, u.bus_id, u.active, b.plate AS bus_plate";
route("GET", "/api/users", ({ user }) => {
  requireAdmin(user);
  return db.query(`SELECT ${USER_COLS} FROM users u LEFT JOIN buses b ON b.id = u.bus_id WHERE u.active = 1 ORDER BY u.role, u.name`).all();
});

function userFields(body: any, requirePin: boolean) {
  const name = str(body.name, 60);
  const phone = normPhone(body.phone);
  const pin = str(body.pin, 12);
  if (!name) throw new HttpError(400, "Chưa nhập tên");
  if (phone.length < 9) throw new HttpError(400, "Số điện thoại không hợp lệ");
  if ((requirePin || pin) && !/^\d{4,12}$/.test(pin)) throw new HttpError(400, "PIN phải gồm 4–12 chữ số");
  const role = body.role === "admin" ? "admin" : "staff";
  const job = ["lo_xe", "lai_xe", "quan_ly", "khac"].includes(body.job) ? body.job : "lo_xe";
  const bus_id = body.bus_id ? int(body.bus_id) : null;
  return { name, phone, pin, role, job, bus_id };
}

route("POST", "/api/users", ({ user, body }) => {
  requireAdmin(user);
  const f = userFields(body, true);
  const exists = db.query("SELECT id, active FROM users WHERE phone = ?").get(f.phone) as any;
  if (exists?.active) throw new HttpError(400, "Số điện thoại này đã có tài khoản");
  if (exists) {
    db.query("UPDATE users SET name = ?, pin_hash = ?, role = ?, job = ?, bus_id = ?, active = 1 WHERE id = ?")
      .run(f.name, Bun.password.hashSync(f.pin), f.role, f.job, f.bus_id, exists.id);
    return { id: exists.id };
  }
  const r = db.query("INSERT INTO users (name, phone, pin_hash, role, job, bus_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run(f.name, f.phone, Bun.password.hashSync(f.pin), f.role, f.job, f.bus_id);
  return { id: Number(r.lastInsertRowid) };
});

route("PUT", "/api/users/:id", ({ user, body, params }) => {
  requireAdmin(user);
  const id = int(params[0]);
  const f = userFields(body, false);
  if (id === user.id && f.role !== "admin") throw new HttpError(400, "Không thể tự bỏ quyền chủ xe của mình");
  const dup = db.query("SELECT id FROM users WHERE phone = ? AND id <> ?").get(f.phone, id);
  if (dup) throw new HttpError(400, "Số điện thoại này đã có tài khoản khác");
  db.query("UPDATE users SET name = ?, phone = ?, role = ?, job = ?, bus_id = ? WHERE id = ?")
    .run(f.name, f.phone, f.role, f.job, f.bus_id, id);
  if (f.pin) {
    db.query("UPDATE users SET pin_hash = ? WHERE id = ?").run(Bun.password.hashSync(f.pin), id);
    db.query("DELETE FROM sessions WHERE user_id = ? AND user_id <> ?").run(id, user.id);
  }
  return { ok: true };
});

route("DELETE", "/api/users/:id", ({ user, params }) => {
  requireAdmin(user);
  const id = int(params[0]);
  if (id === user.id) throw new HttpError(400, "Không thể tự xoá tài khoản của mình");
  db.query("UPDATE users SET active = 0, bus_id = NULL WHERE id = ?").run(id);
  db.query("DELETE FROM sessions WHERE user_id = ?").run(id);
  return { ok: true };
});

// ---------- login ----------
const loginAttempts = new Map<string, { n: number; until: number }>();

async function handleLogin(req: Request) {
  const body = (await req.json().catch(() => ({}))) as any;
  const phone = normPhone(body.phone);
  const key = phone + "|" + (req.headers.get("x-forwarded-for") || "");
  const att = loginAttempts.get(key);
  if (att && att.n >= 5 && att.until > Date.now()) {
    return json({ error: "Sai quá nhiều lần, thử lại sau 5 phút" }, { status: 429 });
  }
  const u = db.query("SELECT id, pin_hash FROM users WHERE phone = ? AND active = 1").get(phone) as any;
  if (!u || !Bun.password.verifySync(str(body.pin, 12), u.pin_hash)) {
    const n = (att && att.until > Date.now() ? att.n : 0) + 1;
    loginAttempts.set(key, { n, until: Date.now() + 5 * 60_000 });
    return json({ error: "Sai số điện thoại hoặc mã PIN" }, { status: 401 });
  }
  loginAttempts.delete(key);
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  db.query("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, u.id, Date.now() + SESSION_DAYS * 86400_000);
  db.query("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  return json({ ok: true }, {
    headers: {
      "set-cookie": `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${SECURE_COOKIE ? "; Secure" : ""}`,
    },
  });
}

// ---------- static ----------
async function serveStatic(pathname: string) {
  let p = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  if (p === "/" || p === "") p = "/index.html";
  let file = Bun.file(join(PUBLIC_DIR, p));
  if (!(await file.exists()) || !join(PUBLIC_DIR, p).startsWith(PUBLIC_DIR)) {
    file = Bun.file(join(PUBLIC_DIR, "index.html")); // SPA fallback
    p = "/index.html";
  }
  // no-cache: trình duyệt luôn kiểm tra bản mới (cập nhật app là có ngay), file không đổi thì trả 304
  const vendor = p.startsWith("/vendor/");
  return new Response(file, { headers: { "cache-control": vendor ? "public, max-age=86400" : "no-cache" } });
}

// ---------- server ----------
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return serveStatic(url.pathname);
    try {
      if (url.pathname === "/api/login" && req.method === "POST") return await handleLogin(req);
      if (url.pathname === "/api/logout" && req.method === "POST") {
        const token = getCookie(req, "sid");
        if (token) db.query("DELETE FROM sessions WHERE token = ?").run(token);
        return json({ ok: true }, { headers: { "set-cookie": "sid=; Path=/; Max-Age=0" } });
      }
      const user = currentUser(req);
      if (!user) return json({ error: "Chưa đăng nhập" }, { status: 401 });
      for (const [method, re, h] of routes) {
        if (method !== req.method) continue;
        const m = url.pathname.match(re);
        if (!m) continue;
        const body = method === "GET" ? {} : ((await req.json().catch(() => ({}))) ?? {});
        return json(await h({ req, url, user, params: m.slice(1), body }));
      }
      return json({ error: "Không tìm thấy" }, { status: 404 });
    } catch (e: any) {
      if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });
      console.error(e);
      return json({ error: "Lỗi máy chủ" }, { status: 500 });
    }
  },
});

console.log(`Nhà xe đang chạy tại http://localhost:${PORT}`);
