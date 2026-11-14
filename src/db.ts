import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/nhaxe.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true, strict: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS buses (
  id INTEGER PRIMARY KEY,
  plate TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  route_out TEXT NOT NULL,
  route_back TEXT NOT NULL,
  default_price INTEGER NOT NULL DEFAULT 0,
  layout TEXT NOT NULL DEFAULT '{"floors":[]}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',      -- admin | staff
  job TEXT NOT NULL DEFAULT 'lo_xe',       -- lo_xe | lai_xe | quan_ly | khac
  bus_id INTEGER REFERENCES buses(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY,
  bus_id INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                      -- YYYY-MM-DD (ngày khởi hành)
  direction TEXT NOT NULL,                 -- di | ve
  route TEXT NOT NULL,
  UNIQUE (bus_id, date, direction)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  seat TEXT,                               -- NULL = khách thêm, không có ghế
  phone TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  pickup TEXT NOT NULL DEFAULT '',
  dropoff TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1,
  price INTEGER NOT NULL DEFAULT 0,        -- giá dự kiến (theo giá ghế)
  paid INTEGER NOT NULL DEFAULT 0,
  paid_amount INTEGER NOT NULL DEFAULT 0,  -- tiền thực thu
  paid_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',   -- active | cancelled
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_trip ON bookings(trip_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(phone);
CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(date);
`);

// Nâng cấp DB cũ: thêm cột "đã lên xe"
const cols = db.query("PRAGMA table_info(bookings)").all() as { name: string }[];
if (!cols.some((c) => c.name === "boarded")) {
  db.exec("ALTER TABLE bookings ADD COLUMN boarded INTEGER NOT NULL DEFAULT 0");
}
// Giá combo giường đôi: mặc định của xe (0 = 2 × giá lẻ) + đánh dấu khách đặt combo
if (!cols.some((c) => c.name === "combo")) db.exec("ALTER TABLE bookings ADD COLUMN combo INTEGER NOT NULL DEFAULT 0");
const busCols = db.query("PRAGMA table_info(buses)").all() as { name: string }[];
if (!busCols.some((c) => c.name === "default_combo_price")) {
  db.exec("ALTER TABLE buses ADD COLUMN default_combo_price INTEGER NOT NULL DEFAULT 0");
}

// Tạo tài khoản chủ xe đầu tiên nếu DB trống
const count = db.query("SELECT COUNT(*) AS n FROM users").get() as { n: number };
if (count.n === 0) {
  const phone = process.env.ADMIN_PHONE || "0900000000";
  const pin = process.env.ADMIN_PIN || "123456";
  db.query("INSERT INTO users (name, phone, pin_hash, role, job) VALUES (?, ?, ?, 'admin', 'quan_ly')").run(
    "Chủ xe",
    phone,
    Bun.password.hashSync(pin),
  );
  console.log(`[init] Đã tạo tài khoản chủ xe: SĐT ${phone} / PIN ${pin} — hãy đổi PIN sau khi đăng nhập.`);
}
