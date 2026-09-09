const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

const WORKER_VERSION = "HRM_CLOUDFLARE_WORKER_1.0.0";
const ALLOWED_ACTIONS = new Set(["login","login-with-dept","me","logout","leave-request","leave-balance","leave-requests","approve","reject","hr-confirm","hr-return","create-return","hr-confirm-return","hr-reject-return","stats","employee-leave-info","employees","create-employee","update-employee","import-employees","organization-tree","save-organization","import-organizations","assign-role","delete-organization","revoke-role","delete-employee","admin-update-leave","admin-delete-leave","holiday-settings","save-holiday","delete-holiday","ping"]);

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

async function proxyAppsScript(request, env) {
  if (request.method !== "POST") {
    return json({ success: false, message: "Method not allowed", version: WORKER_VERSION }, 405, { Allow: "POST" });
  }

  const appsScriptUrl = env.APPS_SCRIPT_URL;
  const proxyKey = env.APPS_SCRIPT_PROXY_KEY;
  if (!appsScriptUrl || !proxyKey) {
    console.error("Missing Worker secrets APPS_SCRIPT_URL/APPS_SCRIPT_PROXY_KEY");
    return json({ success: false, message: "Máy chủ chưa được cấu hình đầy đủ" }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return json({ success: false, message: "Dữ liệu gửi lên không hợp lệ" }, 400);
  }

  const action = String(payload.action || "").trim().toLowerCase();
  if (!ALLOWED_ACTIONS.has(action)) {
    return json({ success: false, message: "Thao tác không hợp lệ" }, 400);
  }
  payload.action = action;
  payload.proxy_key = proxyKey;

  try {
    const upstream = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8", Accept: "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow"
    });
    const body = await upstream.text();
    let data;
    try {
      data = JSON.parse(body);
    } catch (_) {
      console.error("Invalid Apps Script response", upstream.status, body.slice(0, 300));
      return json({ success: false, message: "Apps Script trả về dữ liệu không hợp lệ" }, 502);
    }
    return json(data, upstream.ok ? 200 : 502);
  } catch (error) {
    console.error("Apps Script proxy error", error);
    return json({ success: false, message: "Không kết nối được Apps Script" }, 502);
  }
}

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/apps-script" || pathname === "/api/apps-script/") {
      return proxyAppsScript(request, env);
    }
    if (pathname.startsWith("/api/")) {
      return json({ success: false, message: "API không tồn tại" }, 404);
    }
    return env.ASSETS.fetch(request);
  }
};
