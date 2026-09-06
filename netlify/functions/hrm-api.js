const JSON_HEADERS = {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const FUNCTION_VERSION = "HRM_NETLIFY_PROXY_2.1.0";
const ALLOWED_ACTIONS = new Set(["login","login-with-dept","me","logout","leave-request","leave-balance","leave-requests","approve","reject","hr-confirm","hr-return","create-return","hr-confirm-return","hr-reject-return","stats","employee-leave-info","employees","create-employee","update-employee","import-employees","organization-tree","save-organization","assign-role","holiday-settings","save-holiday","delete-holiday","ping"]);

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return {statusCode:405,headers:{...JSON_HEADERS,Allow:"POST"},body:JSON.stringify({success:false,message:"Method not allowed",version:FUNCTION_VERSION})};
  const appsScriptUrl=process.env.APPS_SCRIPT_URL,proxyKey=process.env.APPS_SCRIPT_PROXY_KEY;
  if(!appsScriptUrl||!proxyKey){console.error("Missing environment variables");return{statusCode:500,headers:JSON_HEADERS,body:JSON.stringify({success:false,message:"Máy chủ chưa được cấu hình đầy đủ"})};}
  let payload;
  try{payload=JSON.parse(event.body||"{}");}catch(_){return{statusCode:400,headers:JSON_HEADERS,body:JSON.stringify({success:false,message:"Dữ liệu gửi lên không hợp lệ"})};}
  const action=String(payload.action||"").trim().toLowerCase();
  if(!ALLOWED_ACTIONS.has(action))return{statusCode:400,headers:JSON_HEADERS,body:JSON.stringify({success:false,message:"Thao tác không hợp lệ"})};
  payload.action=action;payload.proxy_key=proxyKey;
  try{
    const upstream=await fetch(appsScriptUrl,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8","Accept":"application/json"},body:JSON.stringify(payload),redirect:"follow"});
    const text=await upstream.text();let data;
    try{data=JSON.parse(text);}catch(_){console.error("Invalid Apps Script response",upstream.status,text.slice(0,300));return{statusCode:502,headers:JSON_HEADERS,body:JSON.stringify({success:false,message:"Apps Script trả về dữ liệu không hợp lệ"})};}
    return{statusCode:upstream.ok?200:502,headers:JSON_HEADERS,body:JSON.stringify(data)};
  }catch(error){console.error("Apps Script proxy error",error);return{statusCode:502,headers:JSON_HEADERS,body:JSON.stringify({success:false,message:"Không kết nối được Apps Script"})};}
};
