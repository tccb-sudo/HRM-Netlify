import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
new vm.Script(scripts);
const fn = await import(new URL("../netlify/functions/hrm-api.js", import.meta.url));
if (typeof fn.default?.handler !== "function" && typeof fn.handler !== "function") throw new Error("Netlify handler không hợp lệ");

if (html.includes("google.script.run")) throw new Error("index.html vẫn còn google.script.run");
if (!html.includes("/api/apps-script")) throw new Error("Thiếu API endpoint Netlify");
if (!html.includes("validateAcademicYearRange")) throw new Error("Thiếu kiểm tra đơn vượt năm học ở giao diện");

const gas = fs.readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
if (!gas.includes("if(to>leaveYear.end)")) throw new Error("Thiếu kiểm tra đơn vượt năm học ở Apps Script");
if (!gas.includes("HRM_ENTERPRISE_2.2.0")) throw new Error("Apps Script chưa phải phiên bản Enterprise V2.2");
if (!gas.includes("hrm_reserve_leave")) throw new Error("Thiếu cơ chế giữ chỗ ngày phép");
if (!html.includes("onLeaveDateChange")) throw new Error("Thiếu tải số dư theo năm học đã chọn");
if (!gas.includes("function descendantOrgIds_")) throw new Error("Thiếu xử lý cây đơn vị");
if (!html.includes("page-organizations")) throw new Error("Thiếu giao diện cơ cấu tổ chức");
for (const action of ["delete-organization","revoke-role","delete-employee","admin-update-leave","admin-delete-leave"]) {
  if (!gas.includes(`case '${action}'`)) throw new Error(`Apps Script thiếu action ${action}`);
  if (!html.includes(`'${action}'`)) throw new Error(`Giao diện thiếu action ${action}`);
}
const adminSql=fs.readFileSync(new URL("../schema-v2.2-admin-management.sql",import.meta.url),"utf8");
if(!adminSql.includes("hrm_admin_update_leave")||!adminSql.includes("hrm_admin_delete_leave"))throw new Error("Thiếu RPC quản trị đơn nghỉ");

console.log("Kiểm tra mã Netlify thành công.");
