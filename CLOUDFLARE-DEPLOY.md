# Triển khai HRM bằng Cloudflare Worker + Static Assets

## 1. Apps Script

Giữ nguyên Web App Apps Script hiện tại. Trong Script Properties phải có:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NETLIFY_PROXY_KEY` (giữ tên này để không phải sửa hệ thống đang chạy)

Deployment phải **Execute as Me**, quyền truy cập **Anyone**, URL kết thúc bằng `/exec`.

## 2. Tạo hoặc cập nhật Worker project

1. Đưa toàn bộ thư mục dự án lên GitHub, bao gồm `src/worker.js`, `public` và `wrangler.jsonc`.
2. Cloudflare Dashboard → Workers & Pages → Import repository (có thể dùng lại project hiện tại).
3. Chọn repository và nhánh `main`.
4. Build command: `npm run check`.
5. Deploy command: `npx wrangler deploy`.
6. Root directory: `/` nếu các file nằm ở gốc repository.
7. Không khai báo Pages build output; `wrangler.jsonc` đã cấu hình Static Assets từ `public`.

## 3. Khai báo Secrets

Trong Pages project → Settings → Variables and Secrets, thêm cho Production:

| Tên | Giá trị |
|---|---|
| `APPS_SCRIPT_URL` | URL Web App Apps Script kết thúc bằng `/exec` |
| `APPS_SCRIPT_PROXY_KEY` | Giá trị giống hệt `NETLIFY_PROXY_KEY` trong Script Properties |

Chọn loại **Secret** cho cả hai. Sau khi thêm hoặc đổi Secret phải deploy lại.

## 4. Kiểm tra

1. Build log phải có dòng `Kiểm tra mã Cloudflare Worker thành công.`
2. Mở `/api/apps-script` bằng GET phải nhận HTTP 405 và JSON `Method not allowed`.
3. Mở trang chính, đăng nhập CCCD và kiểm tra danh sách nhân viên.
4. Kiểm tra tạo/sửa/xóa, import/export, duyệt đơn và GmailApp.

## 5. Chuyển tên miền

Chỉ chuyển DNS sau khi địa chỉ `*.workers.dev` hoạt động đầy đủ. Trang dùng API cùng miền `/api/apps-script`, nên không cần sửa frontend khi gắn tên miền riêng.
