# Production Bình Tăng

- URL: https://binhtang.metasport.vn
- Ngày triển khai: 14/11/2026.
- Code gốc: `main`, commit `6e7b1ad`, kèm sửa Dockerfile dùng Bun `1.4.4-alpine` và đồng bộ `bun.lock` với `package.json`.
- Website host trong Hacado App: ID `18`, IP `10.10.0.26`.
- Proxy: ID `13`, IP nội bộ `10.10.0.98`, IP công khai `103.147.35.96`.
- Cloudflare: tài khoản `x24sport.com@gmail.com`, zone `metasport.vn`, bản ghi A `binhtang` → `103.147.35.96`, bật proxy.
- HTTPS: Let's Encrypt tại proxy; certbot tự gia hạn. HTTP chuyển sang HTTPS. Cloudflare đang dùng chế độ Full.

## Runtime và dữ liệu

Trên `10.10.0.26`:

- Compose: `/opt/binhtang/compose.yml`, project `binhtang`.
- Container: `binhtang-dashboard`, image `binhtang-dashboard:6e7b1ad`.
- Source: `/opt/binhtang/releases/6e7b1ad`.
- Cổng: `10.10.0.26:8999` → container `3000`.
- Dữ liệu bền vững: `/opt/binhtang/shared/data/nhaxe.db`.
- ENV riêng: `/opt/binhtang/shared/app.env` (quyền 0600); bật `COOKIE_SECURE=1`.
- Container tự khởi động lại, giới hạn RAM 512 MB, có healthcheck HTTP và giới hạn dung lượng log.
- Production khởi tạo dữ liệu mới, có một tài khoản chủ xe; không chép DB local hay dữ liệu mẫu.

Trên proxy `10.10.0.98`:

- Nginx: `/etc/nginx/conf.d/binhtang.metasport.vn.conf`.
- Chứng chỉ: `/etc/letsencrypt/live/binhtang.metasport.vn/`.
- Proxy chuyển request tới `10.10.0.26:8999`, không cache API.

Thông tin đăng nhập bàn giao tại `data/binhtang-access.txt` trên máy triển khai, được Git bỏ qua. Không commit thông tin này hoặc DB.

## Vận hành

```sh
ssh root@10.10.0.26 'cd /opt/binhtang && docker compose ps'
ssh root@10.10.0.26 'cd /opt/binhtang && docker compose restart dashboard'
ssh root@10.10.0.98 'nginx -t && systemctl reload nginx'
```

Khi nâng cấp, tạo release mới, sao lưu DB bằng SQLite trước, cập nhật đường dẫn build và tag image trong compose rồi chạy `docker compose up -d --build`. Giữ nguyên thư mục `shared` và ENV để bảo toàn dữ liệu và tài khoản.

Đã tạo một bản sao lưu bằng `VACUUM INTO` ở `/opt/binhtang/shared/data/backups/` và kiểm tra `PRAGMA integrity_check` trả `ok`. Chưa cấu hình sao lưu định kỳ.

## Kiểm tra sau triển khai

- Homepage trả 200 qua Cloudflare và trực tiếp HTTPS origin; chứng chỉ hợp lệ.
- HTTP chuyển hướng 301 sang HTTPS.
- API chưa đăng nhập trả 401, `Cache-Control: no-store`.
- Đăng nhập chủ xe, cookie Secure/HttpOnly, `/api/me`, `/api/buses`, `/api/users`, thống kê hôm nay và đăng xuất đều thành công.
- Chrome mở tên miền thật hiển thị form đăng nhập; container báo healthy.
