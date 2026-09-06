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
if (!gas.includes("HRM_ENTERPRISE_2.1.0")) throw new Error("Apps Script chưa phải phiên bản Enterprise V2.1");
if (!gas.includes("hrm_reserve_leave")) throw new Error("Thiếu cơ chế giữ chỗ ngày phép");
if (!html.includes("onLeaveDateChange")) throw new Error("Thiếu tải số dư theo năm học đã chọn");
if (!gas.includes("function descendantOrgIds_")) throw new Error("Thiếu xử lý cây đơn vị");
if (!html.includes("page-organizations")) throw new Error("Thiếu giao diện cơ cấu tổ chức");

console.log("Kiểm tra mã Netlify thành công.");
