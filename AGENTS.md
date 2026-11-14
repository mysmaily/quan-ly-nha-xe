# AGENTS.md — Quản lý nhà xe

Hướng dẫn cho AI agent / lập trình viên làm việc trên repo này. Đọc hết trước khi sửa code.

## 1. Sản phẩm là gì

Web app nội bộ cho **nhà xe khách giường nằm** (thường 2 tầng). Chạy trên trình duyệt điện thoại nhưng phải
**giống app native nhất có thể** (PWA cài lên màn hình chính) — lý do: không có tài khoản Apple/Google để phát hành app.

Hai nhóm người dùng, **ưu tiên lơ xe trước** khi quyết định tính năng/UI:

| Vai trò | `role` | Dùng ở đâu | Nhu cầu chính |
|---|---|---|---|
| **Lơ xe / lái xe** | `staff` | Trên xe, một tay cầm điện thoại, vừa nghe khách gọi | Nhìn toàn bộ sơ đồ giường trong 1 màn hình, chạm giường → nhập SĐT + điểm đón, gọi lại khách, đánh dấu lên xe, thu tiền |
| **Chủ xe** | `admin` | Ở nhà | Xem doanh thu / số khách hôm nay, tuần, tháng, tháng trước; quản lý xe, sơ đồ giường, giá; quản lý nhân viên & phân công xe |

Ngôn ngữ giao diện: **tiếng Việt** (cả text UI, thông báo lỗi API, comment code). Tiền: VNĐ, số nguyên, hiển thị `350.000đ` / rút gọn `350k`, `4.5tr`.

## 2. Nghiệp vụ

### 2.1 Xe & chuyến
- **Xe** (`buses`): biển số, tên gọi, **tên chuyến đi** và **tên chuyến về** (VD `Nghệ An → Hà Nội` / `Hà Nội → Nghệ An`), giá mặc định, sơ đồ giường (`layout` JSON).
- **Chuyến** (`trips`) = xe + **ngày khởi hành** + chiều (`di` | `ve`). Tạo tự động (lazy) lần đầu mở `GET /api/trip`. Mỗi chuyến có sơ đồ giường riêng; sang ngày khác là sơ đồ trống.
- Chuyến đêm qua 0h vẫn tính theo ngày khởi hành. "Hôm nay" luôn tính theo giờ Việt Nam (UTC+7), xem `vnToday()` ở cả server và client.
- Ngừng xe = `active = 0` (ẩn, giữ lịch sử doanh thu), đồng thời gỡ phân công nhân viên.

### 2.2 Sơ đồ giường (`buses.layout`)
```json
{
  "naming": "column",
  "floors": [
    { "name": "Tầng 1", "rows": 6, "cols": 5,
      "seats": [ { "code": "A1", "r": 0, "c": 0, "type": "single", "price": null, "combo": null } ] }
  ]
}
```
- Mỗi tầng là lưới `rows × cols`; ô không có giường = **lối đi** / khoảng trống. Nhờ vậy vẽ được mọi kiểu xe:
  2 lối đi – 3 dãy (cols 5), 1 lối đi – 2 dãy giường đôi (cols 3)…
  Ở màn lơ xe, **cột không có giường nào được thu hẹp ~1/3** (`colTemplate()`), để giường to; trình soạn sơ đồ giữ cột đều để dễ chạm.
- **Hàng cuối (băng nằm liền) không chia giường**: mô hình xe luôn có dải **"Băng cuối · khách thêm"** dưới các tầng (`Bench`),
  chạm vào là danh sách khách không có giường + nút thêm. "Tạo nhanh" không sinh hàng cuối nữa.
- `type`: `single` (1 chỗ) | `double` (2 chỗ). Tối đa 3 tầng, 20 hàng, 8 cột (server `cleanLayout()` kiểm tra lại).
- `price` = giá lẻ / người riêng của giường (`null` → `buses.default_price`).
- `combo` = giá combo cả giường đôi (`null` → `buses.default_combo_price`, nếu = 0 → `2 × giá lẻ`). Chỉ có ý nghĩa với giường đôi.
- **Đánh số** (`naming`), xem `renumber()` trong `public/js/seatmap.js`:
  - `column` (mặc định, giống xe thực tế): cột dãy A/B/C, **tầng 1 số lẻ, tầng 2 số chẵn** (A1 dưới, A2 trên, A3 dưới…).
    (Nếu chủ xe vẫn tự vẽ giường ở cột lối đi: lấy chữ dãy ngoài cùng gần nhất, số = số hàng + số tầng, VD `A13`, `C13`.)
  - `floor`: tầng 1 `A1, A2…`, tầng 2 `B1, B2…` theo thứ tự hàng.
- Booking lưu **mã giường** (`seat`), không lưu toạ độ. Đổi mã/xoá giường trong sơ đồ → booking cũ thành "khách phụ" (không khớp giường nào).

### 2.3 Khách (`bookings`)
- Một booking = một cuộc gọi đặt chỗ: SĐT, tên (tuỳ chọn), **điểm đón**, điểm trả, ghi chú, số người (`qty`), giá (`price`).
- **Nhồi khách là bình thường**: số khách KHÔNG cần khớp số giường. Một giường có thể có nhiều booking; `seat = NULL` là **khách băng cuối**
  (băng cuối, ghế phụ, nằm lối đi). Booking có mã giường không còn trong sơ đồ cũng được coi là khách băng cuối (`extrasOf()`).
  Không bao giờ chặn đặt khi giường/xe đã kín — chỉ hiển thị cảnh báo (badge đỏ `+1`).
- Huỷ vé = `status = 'cancelled'` (soft delete), không xoá dòng.
- Gõ đủ 10 số SĐT → tự điền điểm đón/tên lần trước của khách trên cùng xe (`GET /api/lookup`). Gợi ý các điểm đón hay dùng 60 ngày gần nhất.

### 2.4 Trạng thái khách & màu giường
| Trạng thái | Điều kiện | Màu giường |
|---|---|---|
| Trống | không có booking | trắng, viền xám |
| Đã đặt | có booking chưa lên xe, chưa thu | **vàng** |
| Đã lên xe | `boarded = 1`, chưa thu | **xanh nhạt** |
| Đã thu tiền | `paid = 1` | **xanh đậm + dấu `$`** |

Giường nhiều khách: tất cả đã thu → xanh `$`; tất cả đã lên/đã thu → xanh nhạt; còn lại → vàng (`seatStatus()` trong `seatmap.js`).
Thu tiền tự đặt `boarded = 1`. Giường đôi chưa đủ người → badge `1/2`; quá chỗ → badge đỏ `+n`. Booking combo chiếm trọn giường đôi.
Dấu `$` và badge nằm ở đáy giường, thay chỗ cái gối. Băng cuối dùng cùng quy tắc màu cho cả nhóm khách.

### 2.5 Giá & thu tiền
- Giá vé tính **theo người**: giường đơn `qty × giá lẻ`.
- Giường đôi có 2 lựa chọn khi đặt: **Combo cả giường** (`combo = 1`, mặc định 2 người, giá combo) hoặc **Lẻ / nằm ghép** (`combo = 0`, `qty × giá lẻ`).
  Mặc định chọn combo nếu giường trống, chọn lẻ nếu giường đã có người.
- `price` = số tiền dự kiến (tự tính, lơ xe sửa tay được). Khi thu: **"Thu {price}"** (đúng giá) hoặc **"Thu số khác"** → nhập số thực thu → `paid_amount`.
- Giới hạn chống nhập nhầm: mọi số tiền ≤ 100.000.000 (`moneyVal()` server).

### 2.6 Thống kê (chủ xe)
- **Doanh thu = tổng `paid_amount` của booking `paid = 1`**, không tính booking huỷ. Tiền "chưa thu" = tổng `price` của booking chưa thu.
- Gom theo **ngày khởi hành của chuyến** (`trips.date`), không theo giờ bấm thu.
- Các kỳ: hôm nay, hôm qua, tuần này (bắt đầu thứ 2), tháng này, tháng trước; biểu đồ 14 ngày; bảng theo xe và theo chuyến.

### 2.7 Nhân viên & phân quyền
- Đăng nhập bằng **SĐT + mã PIN** (4–12 số). Phiên 180 ngày (cookie `sid`, HttpOnly). Sai 5 lần → khoá 5 phút theo SĐT+IP.
- `job`: `lo_xe` | `lai_xe` | `quan_ly` | `khac` (chỉ là nhãn). Quyền thật nằm ở `role`.
- `staff` **chỉ thấy và thao tác xe được phân công** (`users.bus_id`), mọi ngày, cả 2 chiều. Kiểm tra ở server bằng `assertBusAccess()` — đừng chỉ ẩn ở UI.
- `admin` thấy mọi xe; là người duy nhất xem thống kê, sửa xe, quản lý nhân viên. Không thể tự xoá/tự hạ quyền chính mình.
- Tài khoản admin đầu tiên tạo tự động khi DB trống từ env `ADMIN_PHONE` / `ADMIN_PIN` (mặc định `0900000000` / `123456`).
- Xoá nhân viên = `active = 0` + xoá phiên. Đổi PIN của người khác → đăng xuất họ.

### 2.8 Đồng bộ
Lái xe và lơ xe cùng xe dùng chung dữ liệu: màn hình chuyến tự tải lại **mỗi 10 giây** và khi app quay lại foreground; thống kê mỗi 30 giây.
Không có websocket. Chưa hỗ trợ offline cho thao tác ghi (mất mạng → báo lỗi để thử lại).

## 3. Tech stack

- **Runtime/server**: [Bun](https://bun.sh) — `Bun.serve`, `bun:sqlite`, `Bun.password` (argon2) — **không có dependency runtime**. Router tự viết trong `src/server.ts`.
- **Database**: SQLite 1 file (`DB_PATH`, mặc định `./data/nhaxe.db`), WAL, foreign keys bật. Schema + migration trong `src/db.ts`.
- **Frontend**: Preact + htm (bản standalone vendored ở `public/vendor/preact-htm.js`), ES modules, **không có bước build**, không TypeScript ở client.
  Template viết bằng `html\`...\`` (htm), đóng component bằng `<//>`.
- **PWA**: `manifest.webmanifest`, `sw.js` (network-first cho file tĩnh, không bao giờ cache `/api`), icon PNG/SVG.
- **Deploy**: Docker (`oven/bun` alpine) + Caddy tự cấp HTTPS (`docker-compose.yml`, `Caddyfile`). HTTPS là bắt buộc để cài PWA.

### Cấu trúc thư mục
```
src/
  db.ts          schema, migration (ALTER TABLE có kiểm tra cột), tạo admin đầu tiên
  server.ts      API + phục vụ file tĩnh + đăng nhập; mọi kiểm tra quyền/validate ở đây
  seed-demo.ts   dữ liệu mẫu (1 xe 40 giường kiểu A1/A2, 2 nhân viên, 3 tuần booking)
public/
  index.html, styles.css, sw.js, manifest.webmanifest, icon*
  vendor/preact-htm.js
  js/lib.js      api(), định dạng tiền/ngày/SĐT, toast, Sheet (bottom sheet), ask() (dialog), MoneyInput, Segmented, Field, icon()
  js/seatmap.js  BusModel/FloorGrid/Bed (vẽ xe), seatStatus, capacity, generateLayout, renumber
  js/trip.js     màn hình chuyến: useTrip (tải + poll), TripHeader, SummaryBar, SeatMap, PassengerList, BookingSheet, BookingForm, MovePicker
  js/admin.js    StatsPage, BusesPage + BusEditor + LayoutEditor, StaffPage + UserEditor
  js/app.js      shell: đăng nhập, hash routing, TopBar/TabBar, StaffShell, AdminShell, MePage
```

### API (JSON, cookie `sid`, lỗi trả `{ error: "thông báo tiếng Việt" }`)
| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| POST | `/api/login` `/api/logout` | — | `{phone, pin}` |
| GET | `/api/me` | đăng nhập | user + xe được phân công + `today` |
| POST | `/api/me/pin` | đăng nhập | `{old_pin, pin}` |
| GET | `/api/buses` | đăng nhập | admin: mọi xe active; staff: xe của mình |
| POST/PUT/DELETE | `/api/buses[/:id]` | admin | DELETE = ngừng xe |
| GET | `/api/trip?bus_id&date&direction` | xe được phép | tạo chuyến nếu chưa có; trả `{trip, bus, bookings}` (chỉ booking active) |
| POST | `/api/bookings` | xe được phép | `{trip_id, seat?, phone, name, pickup, dropoff, note, qty, price?, combo?}` — bỏ `price` thì server tự tính |
| PUT | `/api/bookings/:id` | xe được phép | sửa từng trường; đổi giường = gửi `seat` (`null` = khách phụ) |
| POST | `/api/bookings/:id/pay` | xe được phép | `{amount?}` — bỏ trống = thu đúng `price`; tự `boarded = 1` |
| POST | `/api/bookings/:id/unpay` | xe được phép | |
| POST | `/api/bookings/:id/board` | xe được phép | `{boarded: true/false}` |
| DELETE | `/api/bookings/:id` | xe được phép | huỷ vé (soft) |
| GET | `/api/lookup?bus_id&phone?` | xe được phép | khách quen + điểm đón hay dùng |
| GET | `/api/stats?period=` | admin | `today|yesterday|week|month|last_month` |
| GET/POST/PUT/DELETE | `/api/users[/:id]` | admin | |

## 4. Quy ước khi sửa code

**UI (mobile-first, giống app):**
- Thiết kế cho màn 375px trước, kiểm tra cả màn thấp (375×667) và **dark mode** (lơ xe dùng ban đêm).
- **Sơ đồ xe phải vừa 1 màn hình** không cuộn (kể cả iPhone SE 375×667): shell là flex column `TopBar → .main (cuộn) → TabBar`;
  ở chế độ sơ đồ, `.trip-page.map-mode` cao đúng bằng `.main` (`min-height: 500px`, thấp hơn thì cuộn), sơ đồ co giãn theo
  (`flex: 1 1 0`, hàng lưới `minmax(0, 1fr)`). Nội dung trong giường phải co được (mã ở giữa, dấu/badge đè lên vị trí gối). Đừng thêm khối cao phía trên sơ đồ.
- Nút bấm ≥ 44px, input font 16px (tránh iOS zoom), số điện thoại `type="tel"`, tiền dùng `MoneyInput` (`inputmode="numeric"`, tự chọn hết khi focus).
- Popup dùng `Sheet` (bottom sheet, nút back Android đóng được) và `ask()` thay cho `confirm()/prompt()`. Trong một luồng nhiều bước, **đổi `mode` bên trong cùng một Sheet** thay vì đóng sheet này mở sheet khác (tránh lệch history của nút back).
- Màu dùng token CSS ở `:root` (`--booked*`, `--boarded*`, `--paid-solid`, `--empty*`…), có bản dark tương ứng. Không hard-code màu mới.
- Thông báo dùng `toast(msg, "ok" | "err")`.

**Server/DB:**
- Mọi input đi qua helper `str()`, `int()`, `moneyVal()`, `normPhone()`; lỗi nghiệp vụ `throw new HttpError(status, "tiếng Việt")`.
- Kiểm tra quyền ở server (`requireAdmin`, `assertBusAccess`, `bookingAccess`) cho mọi route mới.
- Đổi schema: thêm migration idempotent trong `src/db.ts` (kiểm tra `PRAGMA table_info` rồi `ALTER TABLE ... ADD COLUMN`). Không xoá/đổi tên cột đang dùng; DB production phải nâng cấp được tại chỗ.
- Không xoá cứng dữ liệu nghiệp vụ (booking, xe, nhân viên) — dùng `status`/`active`.
- Thêm trường vào `layout` → cập nhật `cleanLayout()` ở server (server loại bỏ trường lạ).
- Logic giá có ở **cả hai nơi**: `seatPrices()` trong `src/server.ts` và `seatPrices()` trong `public/js/trip.js` — sửa thì sửa cả hai.

**Cache:** file tĩnh trả `Cache-Control: no-cache` (vendor 1 ngày); service worker network-first. Thêm file JS mới → thêm vào `SHELL` trong `public/sw.js` và tăng `CACHE` (`nhaxe-vN`) khi đổi cấu trúc.

## 5. Chạy, kiểm thử, deploy

```bash
bun install
bun run seed-demo     # tuỳ chọn: tạo dữ liệu mẫu (xoá ./data trước nếu muốn làm lại từ đầu)
bun run dev           # http://localhost:3000, tự reload khi sửa src/
```
Tài khoản mẫu: chủ xe `0900000000` / `123456`, lơ xe `0911111111` / `1111`, lái xe `0922222222` / `2222`.

- Xoá file DB khi server đang chạy → phải khởi động lại server (server giữ handle file cũ).
- Muốn đăng nhập 2 vai trò cùng lúc trên 1 trình duyệt: mở `localhost:3000` cho lơ xe và `127.0.0.1:3000` cho chủ xe (cookie tách theo host).
- Chưa có test tự động: kiểm tra bằng trình duyệt ở khổ mobile + gọi API bằng `curl`/`fetch` (đặc biệt các trường hợp phân quyền staff ↔ xe khác, admin-only).
- Deploy: sửa tên miền trong `Caddyfile`, `ADMIN_*` trong `docker-compose.yml`, rồi `docker compose up -d --build`. Sao lưu = copy `data/nhaxe.db` (`sqlite3 ... ".backup ..."`).

## 6. Git

- Remote: `git@github.com:mysmaily/quan-ly-nha-xe.git`, nhánh `main`. Push bằng key của tài khoản có quyền:
  `GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes" git push origin main`
- Không commit `data/` (DB chứa SĐT khách thật) và `node_modules/`.
- Commit message tiếng Việt, dòng đầu tóm tắt, thân liệt kê thay đổi theo vai trò (Lơ xe / Chủ xe / Sửa lỗi).

## 7. Hướng phát triển đã bàn (chưa làm)
- Chế độ offline: lưu tạm thao tác khi mất sóng, tự gửi lại khi có mạng.
- Các kiểu giá khác cho giường đôi (VD chỉ bán combo, cấm nằm ghép) nếu nhà xe yêu cầu.
