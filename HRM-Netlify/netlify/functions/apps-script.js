const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export default async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ success: false, message: "Method not allowed" }), {
      status: 405,
      headers: { ...jsonHeaders, Allow: "POST" },
    });
  }

  const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  const proxyKey = process.env.APPS_SCRIPT_PROXY_KEY;
  if (!appsScriptUrl || !proxyKey) {
    console.error("Missing APPS_SCRIPT_URL or APPS_SCRIPT_PROXY_KEY");
    return new Response(JSON.stringify({ success: false, message: "Máy chủ chưa được cấu hình đầy đủ" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ success: false, message: "Dữ liệu gửi lên không hợp lệ" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const allowedActions = new Set([
    "login", "login-with-dept", "me", "logout", "leave-request", "leave-requests",
    "approve", "reject", "hr-confirm", "hr-return", "create-return", "hr-confirm-return",
    "hr-reject-return", "stats", "employee-leave-info", "employees", "create-employee",
    "update-employee", "import-employees", "holiday-settings", "save-holiday", "delete-holiday", "ping"
  ]);
  const action = String(payload?.action || "").trim().toLowerCase();
  if (!allowedActions.has(action)) {
    return new Response(JSON.stringify({ success: false, message: "Thao tác không hợp lệ" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  payload.action = action;
  payload.proxy_key = proxyKey;

  try {
    const upstream = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8", Accept: "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });
    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("Invalid Apps Script response", upstream.status, text.slice(0, 300));
      return new Response(JSON.stringify({ success: false, message: "Apps Script trả về dữ liệu không hợp lệ" }), {
        status: 502,
        headers: jsonHeaders,
      });
    }
    return new Response(JSON.stringify(data), {
      status: upstream.ok ? 200 : 502,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error("Apps Script proxy error", error);
    return new Response(JSON.stringify({ success: false, message: "Không kết nối được Apps Script" }), {
      status: 502,
      headers: jsonHeaders,
    });
  }
};

export const config = { path: "/api/apps-script" };
