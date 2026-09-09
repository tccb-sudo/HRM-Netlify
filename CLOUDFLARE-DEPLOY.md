# Triển khai HRM trên Cloudflare Pages

## 1. Apps Script

Giữ nguyên Web App Apps Script hiện tại. Trong Script Properties phải có:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NETLIFY_PROXY_KEY` (giữ tên này để không phải sửa hệ thống đang chạy)

Deployment phải **Execute as Me**, quyền truy cập **Anyone**, URL kết thúc bằng `/exec`.

## 2. Tạo Pages project

1. Đưa toàn bộ thư mục dự án lên GitHub, bao gồm thư mục `functions`.
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Chọn repository và nhánh `main`.
4. Framework preset: None.
5. Build command: `npm run check`.
6. Build output directory: `public`.
7. Root directory: để trống nếu các file đang nằm ở gốc repository.

## 3. Khai báo Secrets

Trong Pages project → Settings → Variables and Secrets, thêm cho Production:

| Tên | Giá trị |
|---|---|
| `APPS_SCRIPT_URL` | URL Web App Apps Script kết thúc bằng `/exec` |
| `APPS_SCRIPT_PROXY_KEY` | Giá trị giống hệt `NETLIFY_PROXY_KEY` trong Script Properties |

Chọn loại **Secret** cho cả hai. Sau khi thêm hoặc đổi Secret phải deploy lại.

## 4. Kiểm tra

1. Build log phải có dòng `Kiểm tra mã Cloudflare Pages thành công.`
2. Mở `/api/apps-script` bằng GET phải nhận HTTP 405 và JSON `Method not allowed`.
3. Mở trang chính, đăng nhập CCCD và kiểm tra danh sách nhân viên.
4. Kiểm tra tạo/sửa/xóa, import/export, duyệt đơn và GmailApp.

## 5. Chuyển tên miền

Chỉ chuyển DNS sau khi địa chỉ `*.pages.dev` đã hoạt động đầy đủ. Trang dùng API cùng miền `/api/apps-script`, nên không cần sửa frontend khi gắn tên miền riêng.
