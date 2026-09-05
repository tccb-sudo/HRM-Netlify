import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
new vm.Script(scripts);
const fn = await import(new URL("../netlify/functions/hrm-api.js", import.meta.url));
if (typeof fn.default?.handler !== "function" && typeof fn.handler !== "function") throw new Error("Netlify handler không hợp lệ");

if (html.includes("google.script.run")) throw new Error("index.html vẫn còn google.script.run");
if (!html.includes("/api/apps-script")) throw new Error("Thiếu API endpoint Netlify");

console.log("Kiểm tra mã Netlify thành công.");
