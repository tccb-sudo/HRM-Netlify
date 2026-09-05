# HRM nghỉ phép – triển khai Netlify

Frontend chạy trên Netlify. Netlify Function `/api/apps-script` chuyển tiếp yêu cầu đến Apps Script. Apps Script tiếp tục giữ toàn bộ nghiệp vụ, Supabase service-role key và GmailApp.

## 1. Cập nhật Apps Script

Thay `Code.gs` bằng `apps-script/Code.gs`. Giữ `Migration.gs` nếu cần đối chiếu/migrate dữ liệu.

Trong Apps Script → Project Settings → Script Properties, giữ các thuộc tính hiện tại và thêm:

| Thuộc tính | Giá trị |
|---|---|
| `NETLIFY_PROXY_KEY` | Một chuỗi bí mật dài, ngẫu nhiên |

Triển khai Web App:

- Execute as: Me
- Who has access: Anyone
- Dùng URL kết thúc bằng `/exec`

Mở trực tiếp URL `/exec` phải thấy JSON nhận diện middleware, không còn giao diện HRM.

## 2. Cấu hình Netlify

Vào Site configuration → Environment variables và thêm:

| Key | Value |
|---|---|
| `APPS_SCRIPT_URL` | URL Apps Script kết thúc bằng `/exec` |
| `APPS_SCRIPT_PROXY_KEY` | Đúng bằng `NETLIFY_PROXY_KEY` trong Apps Script |

Không đưa Supabase URL, anon key hoặc service-role key lên frontend Netlify. Các giá trị Supabase tiếp tục nằm trong Script Properties của Apps Script.

## 3. Đưa mã lên Netlify

Vì hệ thống có Netlify Function, không triển khai bằng cách chỉ kéo thả riêng `index.html`. Hãy triển khai qua Git:

1. Tạo repository GitHub/GitLab và đưa toàn bộ thư mục dự án lên.
2. Netlify → Add new site → Import an existing project.
3. Chọn repository.
4. Build command: để trống.
5. Publish directory: `public`
6. Functions directory: `netlify/functions`.
7. Deploy site.

## 4. Kiểm tra

1. Mở `https://TEN-SITE.netlify.app/api/apps-script` bằng trình duyệt: phải báo `Method not allowed` vì endpoint chỉ nhận POST.
2. Mở trang chính và đăng nhập bằng CCCD.
3. Kiểm tra Dashboard, đơn của tôi, duyệt đơn, GmailApp và import/export nhân viên.
4. Trong Netlify → Logs → Functions, kiểm tra function `apps-script` nếu có lỗi.
5. Trong Apps Script → Executions, kiểm tra log `[PERF]`.

## 5. Tên miền riêng

Netlify → Domain management → Add a domain → Add a domain you already own. Sau đó cấu hình DNS theo hướng dẫn Netlify. Không thay đổi mã khi đổi từ `*.netlify.app` sang tên miền riêng vì frontend dùng đường dẫn cùng miền `/api/apps-script`.

## Bảo mật

- `APPS_SCRIPT_PROXY_KEY` và `NETLIFY_PROXY_KEY` phải giống nhau nhưng không được commit vào Git.
- Nếu khóa proxy bị lộ, thay đồng thời ở Netlify và Apps Script rồi deploy lại.
- Apps Script chặn mọi POST không có khóa proxy.
- Supabase vẫn bật RLS và service-role key không xuất hiện ở trình duyệt.
