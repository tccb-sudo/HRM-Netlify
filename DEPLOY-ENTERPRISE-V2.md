# Triển khai HRM Enterprise V2

Phiên bản này hỗ trợ cây đơn vị nhiều cấp, HR Đại học, HR Trường/Khoa và Trưởng đơn vị.

## 1. Sao lưu

Trong Supabase, tạo bản backup trước khi chạy migration. Không xóa các bảng V1.

## 2. Nâng cấp Supabase

Mở Supabase → SQL Editor, dán toàn bộ `schema-v2-enterprise.sql` và chạy một lần.

Tệp sẽ tự động:

- tạo `organizations`, `people`, `organization_memberships`, `role_assignments`;
- tạo các đơn vị cấp Đại học đã thống nhất;
- chuyển nhân viên V1 vào nhánh Trường Dược;
- chuyển Trưởng đơn vị và HR V1 sang phân quyền mới;
- bổ sung `org_id`, `hr_org_id`, `academic_year` cho đơn nghỉ cũ.

## 3. Chỉ định quản trị đầu tiên

Thay CCCD trong câu lệnh sau và chạy trong SQL Editor:

```sql
insert into public.role_assignments(cccd,org_id,role,include_descendants)
values ('CCCD_12_SO_CUA_QUAN_TRI','ump','system_admin',true)
on conflict (cccd,org_id,role)
do update set active=true,include_descendants=true;
```

CCCD này phải đã tồn tại trong bảng `people`.

## 4. Cập nhật Apps Script

Thay toàn bộ `Code.gs` bằng `apps-script/Code.gs`, sau đó tạo phiên bản triển khai mới. Giữ nguyên URL Web App và Script Properties hiện có.

Health check phải trả phiên bản:

```json
{"success":true,"service":"HRM Apps Script Middleware","version":"HRM_ENTERPRISE_2.0.0"}
```

## 5. Cập nhật GitHub và Netlify

Upload toàn bộ mã nguồn lên GitHub. Netlify phải đóng gói `netlify/functions/hrm-api.js`.

Endpoint kiểm tra:

```text
https://TEN-SITE.netlify.app/.netlify/functions/hrm-api
```

Kết quả GET đúng là HTTP 405 với `HRM_NETLIFY_PROXY_2.0.0`.

## 6. Thiết lập tổ chức và phân quyền

Đăng nhập tài khoản quản trị → **Cơ cấu tổ chức**:

1. Tạo các phòng/bộ môn của Trường Y và Khoa Răng Hàm Mặt.
2. Tạo nhân viên hoặc import CSV vào đúng đơn vị.
3. Gán `Trưởng đơn vị` tại phòng/bộ môn.
4. Gán `HR Trường/Khoa` tại Trường Dược, Trường Y hoặc Khoa Răng Hàm Mặt.
5. Gán `HR Đại học` tại Đại học Y Dược TP.HCM.

Luồng mặc định:

- đơn thuộc Trường/Khoa: Trưởng đơn vị → HR Trường/Khoa;
- đơn thuộc đơn vị trực thuộc Đại học: Trưởng đơn vị → HR Đại học;
- HR Đại học xem toàn bộ nhưng không phải duyệt lại đơn do HR Trường/Khoa đã xác nhận.

## 7. Kiểm tra nghiệm thu

- Nhân viên chỉ xem đơn của mình.
- Trưởng đơn vị chỉ xem và duyệt đơn đúng đơn vị được giao.
- HR Trường/Khoa xem tất cả đơn trong nhánh mình phụ trách.
- HR Đại học xem toàn Đại học.
- HR ở nhánh khác không xác nhận được đơn ngoài phạm vi.
- Đơn không được kéo dài qua ngày 30/06 của năm học.
