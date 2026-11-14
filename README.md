# Nhà Xe — quản lý xe giường nằm

Web app chạy trên điện thoại như app thật (cài lên màn hình chính, mở toàn màn hình), không cần tài khoản Apple/Google.

- **Lơ xe / lái xe**: đăng nhập bằng SĐT + PIN, chỉ thấy xe mình được phân công. Chọn ngày + chiều (Đi/Về), xem sơ đồ 2 tầng, chạm ghế để thêm khách (SĐT, điểm đón), bấm **Gọi**, **Thu tiền** theo giá đặt sẵn hoặc **Thu số khác**. Ghế đã kín vẫn thêm được khách (ghép, nằm ghế phụ) — ghế hiện badge đỏ `+1`.
- **Chủ xe**: Tổng quan doanh thu / số khách hôm nay, hôm qua, tuần này, tháng này, tháng trước; thống kê theo xe, theo chuyến; quản lý xe + soạn sơ đồ giường (đơn/đôi, giá riêng từng giường); quản lý nhân viên và phân công xe; xem/thao tác chuyến của mọi xe.

Màu ghế: trắng = trống · cam = đã đặt, chưa thu · xanh lá = đã thu · badge đỏ = quá số chỗ.

## Công nghệ

Bun + SQLite (1 file `data/nhaxe.db`), giao diện Preact không cần build. Không phụ thuộc dịch vụ ngoài.

## Chạy thử trên máy

```bash
bun install
```

```bash
bun run seed-demo   # (tuỳ chọn) tạo 1 xe + 2 nhân viên + dữ liệu 3 tuần để xem thử
```

```bash
bun run dev         # http://localhost:3000
```

Tài khoản chủ xe tạo tự động lần đầu: SĐT `0900000000`, PIN `123456` (đổi bằng biến `ADMIN_PHONE`, `ADMIN_PIN`).
Dữ liệu mẫu: lơ xe `0911111111` / `1111`, lái xe `0922222222` / `2222`.

## Đưa lên VPS (Docker)

1. Trỏ tên miền (VD `nhaxe.tenban.vn`) về IP của VPS.
2. Sửa `Caddyfile`: thay `nhaxe.example.com` bằng tên miền của bạn. Sửa `ADMIN_PHONE` / `ADMIN_PIN` trong `docker-compose.yml`.
3. Copy thư mục lên VPS rồi chạy:

```bash
docker compose up -d --build
```

Caddy tự cấp HTTPS (bắt buộc để cài app lên màn hình chính iPhone/Android).
Không có tên miền thì xoá service `caddy`, xoá dòng `COOKIE_SECURE` và truy cập `http://IP-VPS:3000` (khi đó không cài được dạng app).

**Sao lưu**: chỉ cần copy file `data/nhaxe.db` (nên làm hằng ngày, VD bằng cron):

```bash
sqlite3 data/nhaxe.db ".backup data/backup-$(date +%F).db"
```

## Cài lên điện thoại

- **iPhone (Safari)**: mở trang → nút Chia sẻ → *Thêm vào MH chính*.
- **Android (Chrome)**: mở trang → menu ⋮ → *Cài đặt ứng dụng*.

Đăng nhập được giữ 180 ngày. Lái xe và lơ xe cùng xe thấy dữ liệu của nhau, tự cập nhật mỗi 10 giây.

## Cách tính

- Chuyến = xe + ngày khởi hành + chiều (Đi/Về). Tên chiều lấy theo tên đặt ở mục Xe.
- Giá vé mặc định của xe áp cho mọi giường; giường nào đặt giá riêng thì dùng giá riêng. Giá là **mỗi người** (giường đôi 2 người = 2 × giá).
- **Doanh thu** = tổng tiền lơ xe đã bấm *Đã thu* (số thực thu). Khách chưa thu hiển thị riêng ở "chưa thu".
- Huỷ vé không xoá hẳn dữ liệu; ngừng xe vẫn giữ lịch sử doanh thu.
