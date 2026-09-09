import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
new vm.Script(scripts);
const worker = await import(new URL("../src/worker.js", import.meta.url));
if (typeof worker.default?.fetch !== "function") throw new Error("Cloudflare Worker không hợp lệ");

if (html.includes("google.script.run")) throw new Error("index.html vẫn còn google.script.run");
if (!html.includes("/api/apps-script")) throw new Error("Thiếu API endpoint Cloudflare");
if (!html.includes("validateAcademicYearRange")) throw new Error("Thiếu kiểm tra đơn vượt năm học ở giao diện");

const gas = fs.readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
if (!gas.includes("if(to>leaveYear.end)")) throw new Error("Thiếu kiểm tra đơn vượt năm học ở Apps Script");
if (!gas.includes("HRM_ENTERPRISE_3.0.0")) throw new Error("Apps Script chưa phải phiên bản Enterprise V3.0.0");
const evaluationGas=fs.readFileSync(new URL("../apps-script/Evaluation.gs",import.meta.url),"utf8");
const evaluationHtml=fs.readFileSync(new URL("../public/danh-gia/index.html",import.meta.url),"utf8");
const evaluationBridge=fs.readFileSync(new URL("../public/danh-gia/bridge.js",import.meta.url),"utf8");
new vm.Script(evaluationBridge);
const evaluationScripts=[...evaluationHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join("\n");
new vm.Script(evaluationScripts);
for(const action of ["evaluation-context","evaluation-status","evaluation-submit","evaluation-history","evaluation-unit-data","evaluation-hr-data","evaluation-manager-save","evaluation-export"]){
  if(!gas.includes(`case '${action}'`))throw new Error(`Apps Script thiếu action ${action}`);
  if(!evaluationBridge.includes(action))throw new Error(`Bridge đánh giá thiếu action ${action}`);
}
if(!evaluationGas.includes("EVALUATION_ENTERPRISE_3.0.0")||!evaluationGas.includes("OPEN_DAY: 25")||!evaluationGas.includes("CLOSE_DAY: 10"))throw new Error("Thiếu quy tắc kỳ đánh giá 25-10");
if(!evaluationHtml.includes('/danh-gia/bridge.js'))throw new Error("Giao diện đánh giá chưa kết nối API bridge");
if (!html.includes("pendingActions")||!html.includes("Đang thực hiện thao tác")) throw new Error("Thiếu khóa chống nhấn lặp thao tác");
if (!html.includes("openEditEmployeeByCCCD")||html.includes("openEditEmployeeModal(${JSON.stringify")) throw new Error("Nút sửa nhân viên vẫn nhúng JSON vào onclick");
if (!html.includes("org_code,department_path")) throw new Error("Export nhân viên chưa có mã và đường dẫn đơn vị");
if (!gas.includes("function orgPathLabel_")) throw new Error("API chưa trả đường dẫn đầy đủ của đơn vị");
if (!gas.includes("hrm_reserve_leave")) throw new Error("Thiếu cơ chế giữ chỗ ngày phép");
if (!html.includes("onLeaveDateChange")) throw new Error("Thiếu tải số dư theo năm học đã chọn");
if (!gas.includes("function descendantOrgIds_")) throw new Error("Thiếu xử lý cây đơn vị");
if (!html.includes("page-organizations")) throw new Error("Thiếu giao diện cơ cấu tổ chức");
for (const action of ["import-organizations","delete-organization","revoke-role","delete-employee","admin-update-leave","admin-delete-leave"]) {
  if (!gas.includes(`case '${action}'`)) throw new Error(`Apps Script thiếu action ${action}`);
  if (!html.includes(`'${action}'`)) throw new Error(`Giao diện thiếu action ${action}`);
}
const adminSql=fs.readFileSync(new URL("../schema-v2.2-admin-management.sql",import.meta.url),"utf8");
if(!adminSql.includes("hrm_admin_update_leave")||!adminSql.includes("hrm_admin_delete_leave"))throw new Error("Thiếu RPC quản trị đơn nghỉ");

console.log("Kiểm tra mã Cloudflare Worker thành công.");
