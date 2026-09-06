# HRM nghỉ phép – Enterprise V2

Hệ thống hỗ trợ cơ cấu nhiều cấp của Đại học Y Dược TP.HCM và phân quyền HR theo Trường/Khoa. Xem `DEPLOY-ENTERPRISE-V2.md` để nâng cấp từ dữ liệu hiện tại.

Enterprise V2.1 bổ sung `leave_balances` độc lập theo năm học, không cộng dồn và giữ chỗ ngày phép cho đơn đang chờ duyệt.

Enterprise V2.2 bổ sung quyền quản trị toàn hệ thống: sửa/vô hiệu hóa đơn vị, thu hồi phân quyền, vô hiệu hóa nhân viên và sửa/xóa đơn nghỉ. Trước khi đưa mã V2.2 lên chạy, thực thi một lần `schema-v2.2-admin-management.sql` trong Supabase SQL Editor; thao tác sửa/xóa đơn sẽ cập nhật số dư phép trong cùng một giao dịch.

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

1. Mở `https://TEN-SITE.netlify.app/.netlify/functions/hrm-api` hoặc `https://TEN-SITE.netlify.app/api/apps-script` bằng trình duyệt: phải báo `Method not allowed` vì endpoint chỉ nhận POST.
2. Mở trang chính và đăng nhập bằng CCCD.
3. Kiểm tra Dashboard, đơn của tôi, duyệt đơn, GmailApp và import/export nhân viên.
4. Đăng nhập tài khoản `system_admin`, kiểm tra sửa/xóa đơn vị, thu hồi phân quyền, xóa nhân viên và sửa/xóa đơn nghỉ.
5. Trong Netlify → Logs → Functions, kiểm tra function `hrm-api` nếu có lỗi.
6. Trong Apps Script → Executions, kiểm tra log `[PERF]`.

## 5. Tên miền riêng

Netlify → Domain management → Add a domain → Add a domain you already own. Sau đó cấu hình DNS theo hướng dẫn Netlify. Không thay đổi mã khi đổi từ `*.netlify.app` sang tên miền riêng vì frontend dùng đường dẫn cùng miền `/api/apps-script`.

## Bảo mật

- `APPS_SCRIPT_PROXY_KEY` và `NETLIFY_PROXY_KEY` phải giống nhau nhưng không được commit vào Git.
- Nếu khóa proxy bị lộ, thay đồng thời ở Netlify và Apps Script rồi deploy lại.
- Apps Script chặn mọi POST không có khóa proxy.
- Supabase vẫn bật RLS và service-role key không xuất hiện ở trình duyệt.
