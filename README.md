# HRM nghỉ phép – Enterprise V2

Hệ thống hỗ trợ cơ cấu nhiều cấp của Đại học Y Dược TP.HCM và phân quyền HR theo Trường/Khoa. Xem `DEPLOY-ENTERPRISE-V2.md` để nâng cấp từ dữ liệu hiện tại.

Enterprise V2.1 bổ sung `leave_balances` độc lập theo năm học, không cộng dồn và giữ chỗ ngày phép cho đơn đang chờ duyệt.

Enterprise V2.2 bổ sung quyền quản trị toàn hệ thống: sửa/vô hiệu hóa đơn vị, thu hồi phân quyền, vô hiệu hóa nhân viên và sửa/xóa đơn nghỉ. Trước khi đưa mã V2.2 lên chạy, thực thi một lần `schema-v2.2-admin-management.sql` trong Supabase SQL Editor; thao tác sửa/xóa đơn sẽ cập nhật số dư phép trong cùng một giao dịch.

Trang **Cơ cấu tổ chức** hỗ trợ tải file mẫu, import và export CSV. Cột `parent_code` phải chứa mã đơn vị cha và dòng cha phải nằm trước dòng con; `org_type` dùng một trong các giá trị `university`, `school`, `faculty`, `center`, `office`, `department`, `division`, `subject`.

Import nhân viên dùng cột `org_code` (mã đơn vị duy nhất), không dùng tên đơn vị. Hãy export Cơ cấu tổ chức để lấy đúng mã. Danh sách và file export nhân viên có thêm `department_path`, ví dụ `Đại học Y Dược TP.HCM › Trường Dược › Phòng Quản trị tổng hợp`, nên các đơn vị trùng tên giữa Trường Dược và Trường Y không bị nhầm.

Enterprise V2.2.3 khóa các thao tác ghi trong lúc chờ máy chủ: nút vừa bấm chuyển sang **Đang thực hiện...**, bị vô hiệu hóa và có thông báo tiến trình toàn cục. Yêu cầu lặp cùng loại bị chặn cho đến khi thao tác hiện tại hoàn tất hoặc hết thời gian chờ.

Frontend chạy bằng Cloudflare Worker + Static Assets. Worker route `/api/apps-script` chuyển tiếp yêu cầu đến Apps Script; các file trong `public` được Worker phục vụ trực tiếp. Apps Script tiếp tục giữ toàn bộ nghiệp vụ, Supabase service-role key và GmailApp.

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

## 2. Cấu hình Cloudflare Worker

Vào **Workers & Pages → dự án → Settings/Bindings → Variables and Secrets** và thêm cho môi trường Production:

| Key | Value |
|---|---|
| `APPS_SCRIPT_URL` | Secret chứa URL Apps Script kết thúc bằng `/exec` |
| `APPS_SCRIPT_PROXY_KEY` | Secret, đúng bằng `NETLIFY_PROXY_KEY` trong Apps Script |

Không đưa Supabase URL, anon key hoặc service-role key lên frontend Cloudflare. Các giá trị Supabase tiếp tục nằm trong Script Properties của Apps Script.

## 3. Đưa mã lên Cloudflare Worker

Đưa toàn bộ thư mục dự án lên Git; không chỉ tải riêng `index.html`:

1. Tạo repository GitHub/GitLab và đưa toàn bộ thư mục dự án lên.
2. Cloudflare Dashboard → **Workers & Pages → Create/Import repository**.
3. Chọn repository.
4. Production branch: `main`.
5. Build command: `npm run check`.
6. Deploy command: `npx wrangler deploy`.
7. Root directory: `/` (gốc repository), rồi deploy.

## 4. Kiểm tra

1. Mở `https://TEN-DU-AN.pages.dev/api/apps-script` bằng trình duyệt: phải báo `Method not allowed` vì endpoint chỉ nhận POST.
2. Mở trang chính và đăng nhập bằng CCCD.
3. Kiểm tra Dashboard, đơn của tôi, duyệt đơn, GmailApp và import/export nhân viên.
4. Đăng nhập tài khoản `system_admin`, kiểm tra sửa/xóa đơn vị, thu hồi phân quyền, xóa nhân viên và sửa/xóa đơn nghỉ.
5. Trong Cloudflare → dự án → Observability/Logs, kiểm tra route `/api/apps-script` nếu có lỗi.
6. Trong Apps Script → Executions, kiểm tra log `[PERF]`.

## 5. Tên miền riêng

Cloudflare → **Domains → Add custom domain**. Không thay đổi mã vì frontend dùng đường dẫn cùng miền `/api/apps-script`.

## Bảo mật

- `APPS_SCRIPT_PROXY_KEY` và `NETLIFY_PROXY_KEY` phải giống nhau nhưng không được commit vào Git.
- Nếu khóa proxy bị lộ, thay đồng thời trong Cloudflare Secrets và Apps Script rồi deploy lại.
- Apps Script chặn mọi POST không có khóa proxy.
- Supabase vẫn bật RLS và service-role key không xuất hiện ở trình duyệt.
