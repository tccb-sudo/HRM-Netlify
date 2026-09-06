/**
 * HRM NGHI PHEP - Google Apps Script + Supabase
 * Apps Script serves index.html, authenticates by CCCD, calls Supabase REST,
 * and sends notifications with GmailApp.
 *
 * Script Properties required:
 *   SUPABASE_URL=https://zzedmeuoayasvnkuwctd.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
 *   SPREADSHEET_ID=legacy Google Sheet id (migration only)
 *   WEB_APP_URL=deployed Apps Script URL (used in email)
 */
var CONFIG = {
  VERSION: 'HRM_ENTERPRISE_2.2.0',
  TOKEN_TTL_MS: 8 * 60 * 60 * 1000,
  ANNUAL_LEAVE_DEFAULT: 12,
  ROLES: { EMPLOYEE:'employee', LECTURER:'lecturer', MANAGER:'manager', MANAGER_LECTURER:'manager_lecturer', HR:'hr' },
  STATUS: {
    PENDING:'pending', APPROVED:'approved', REJECTED:'rejected', HR_CONFIRMED:'hr_confirmed', HR_RETURNED:'hr_returned',
    RETURN_PENDING:'return_pending', RETURN_CONFIRMED:'return_confirmed', RETURN_REJECTED:'return_rejected'
  },
  LEGACY_SHEETS: { EMPLOYEES:'EMPLOYEES', LEAVE_REQUESTS:'LEAVE_REQUESTS', LOGS:'LOGS', HOLIDAY_SETTINGS:'HOLIDAY_SETTINGS' }
};

function doGet(e) {
  return jsonOutput_({success:true,service:'HRM Apps Script Middleware',version:CONFIG.VERSION});
}

function doPost(e) {
  var p = (e && e.parameter) || {}, body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (_) { body = p; }
  var expectedProxyKey=PropertiesService.getScriptProperties().getProperty('NETLIFY_PROXY_KEY')||'';
  if(!expectedProxyKey||body.proxy_key!==expectedProxyKey)return jsonOutput_({success:false,message:'Yêu cầu không được phép'});
  delete body.proxy_key;
  return jsonOutput_(route_(String(p.action || body.action || '').trim().toLowerCase(), body, p.token || body.token || ''));
}

function handleApiCall(payloadJson) {
  try {
    var startedAt = Date.now();
    var d = JSON.parse(payloadJson || '{}');
    var action = String(d.action || '').trim().toLowerCase();
    var result = route_(action, d, d.token || '');
    console.log('[PERF] ' + action + ': ' + (Date.now() - startedAt) + ' ms');
    return result;
  } catch (err) { return fail_('Dữ liệu gửi lên không hợp lệ: ' + err.message); }
}

function route_(action, d, token) {
  try {
    switch (action) {
      case 'login': return login_(d.cccd);
      case 'login-with-dept': return loginWithDept_(d.cccd, d.department);
      case 'me': return me_(token);
      case 'logout': return logout_(token);
      case 'leave-request': return createLeaveRequest_(token, d);
      case 'leave-balance': return getLeaveBalance_(token, d);
      case 'leave-requests': return getLeaveRequests_(token, d);
      case 'approve': return changeStatus_(token, d, 'approved');
      case 'reject': return changeStatus_(token, d, 'rejected');
      case 'hr-confirm': return changeStatus_(token, d, 'hr_confirmed');
      case 'hr-return': return changeStatus_(token, d, 'hr_returned');
      case 'create-return': return createReturn_(token, d);
      case 'hr-confirm-return': return resolveReturn_(token, d, true);
      case 'hr-reject-return': return resolveReturn_(token, d, false);
      case 'stats': return getStats_(token);
      case 'employee-leave-info': return getEmployeeLeaveInfo_(token, d);
      case 'employees': return getEmployees_(token);
      case 'create-employee': return createEmployee_(token, d);
      case 'update-employee': return updateEmployee_(token, d);
      case 'import-employees': return importEmployees_(token, d);
      case 'organization-tree': return getOrganizationTree_(token);
      case 'save-organization': return saveOrganization_(token, d);
      case 'assign-role': return assignEnterpriseRole_(token, d);
      case 'delete-organization': return deleteOrganization_(token, d);
      case 'revoke-role': return revokeEnterpriseRole_(token, d);
      case 'delete-employee': return deleteEmployee_(token, d);
      case 'admin-update-leave': return adminUpdateLeave_(token, d);
      case 'admin-delete-leave': return adminDeleteLeave_(token, d);
      case 'holiday-settings': return ok_({ holidays:getHolidays_(d.year) });
      case 'save-holiday': return saveHoliday_(token, d);
      case 'delete-holiday': return deleteHoliday_(token, d);
      case 'ping': return ok_({ version:CONFIG.VERSION, message:'pong', ts:new Date().toISOString() });
      case 'migrate': return migrateSheetsToSupabase(token, d);
      default: return fail_('Unknown action: ' + action);
    }
  } catch (err) {
    console.error(err.stack || err);
    return fail_('Lỗi hệ thống: ' + err.message);
  }
}

// ---------- Supabase REST ----------
function sbConfig_() {
  var p = PropertiesService.getScriptProperties();
  var url = String(p.getProperty('SUPABASE_URL') || '').replace(/\/$/, '');
  var key = p.getProperty('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !key) throw new Error('Chưa cấu hình SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong Script Properties');
  return { url:url, key:key };
}

function sb_(table, method, query, body, prefer) {
  var c = sbConfig_();
  var url = c.url + '/rest/v1/' + table + (query ? '?' + query : '');
  var options = {
    method: method || 'get', muteHttpExceptions:true,
    headers: { apikey:c.key, Authorization:'Bearer ' + c.key, Accept:'application/json', Prefer:prefer || 'return=representation' }
  };
  if (body !== undefined && body !== null) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode(), text = res.getContentText();
  var parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = text; }
  if (code < 200 || code >= 300) throw new Error('Supabase ' + code + ': ' + (typeof parsed === 'string' ? parsed : JSON.stringify(parsed)));
  return parsed;
}

function q_(v) { return encodeURIComponent(String(v)); }
function select_(table, filters, order) {
  var parts = ['select=*'];
  Object.keys(filters || {}).forEach(function(k) { parts.push(q_(k) + '=eq.' + q_(filters[k])); });
  if (order) parts.push('order=' + q_(order));
  return sb_(table, 'get', parts.join('&')) || [];
}
function one_(table, filters) { var a = select_(table, filters); return a.length ? a[0] : null; }
function insert_(table, row, upsert) { return sb_(table, 'post', '', row, upsert ? 'resolution=merge-duplicates,return=representation' : 'return=representation'); }
function update_(table, filters, patch) {
  var parts = [];
  Object.keys(filters).forEach(function(k) { parts.push(q_(k) + '=eq.' + q_(filters[k])); });
  return sb_(table, 'patch', parts.join('&'), patch);
}
function delete_(table, filters) {
  var parts = [];
  Object.keys(filters).forEach(function(k) { parts.push(q_(k) + '=eq.' + q_(filters[k])); });
  return sb_(table, 'delete', parts.join('&'));
}
function upsertOn_(table,row,columns){return sb_(table,'post','on_conflict='+q_(columns.join(',')),row,'resolution=merge-duplicates,return=representation');}
function rpc_(name,params){return sb_('rpc/'+name,'post','',params||{},'return=representation');}

// ---------- Auth + enterprise organization model ----------
function normalizeCCCD_(v){var s=String(v||'').replace(/\D/g,'');while(s.length<12)s='0'+s;return s;}
function organizations_(){var cache=CacheService.getScriptCache(),raw=cache.get('ORG_TREE_V2');if(raw)return JSON.parse(raw);var rows=select_('organizations',{active:true},'sort_order.asc,name.asc');cache.put('ORG_TREE_V2',JSON.stringify(rows),300);return rows;}
function orgIndex_(){var a=organizations_(),m={};a.forEach(function(o){m[o.id]=o;});return{rows:a,map:m};}
function descendantOrgIds_(rootId,idx){idx=idx||orgIndex_();var out=[rootId],changed=true;while(changed){changed=false;idx.rows.forEach(function(o){if(out.indexOf(o.parent_id)>=0&&out.indexOf(o.id)<0){out.push(o.id);changed=true;}});}return out;}
function ancestorOrgIds_(orgId,idx){idx=idx||orgIndex_();var out=[],seen={},id=orgId;while(id&&idx.map[id]&&!seen[id]){seen[id]=true;out.push(id);id=idx.map[id].parent_id;}return out;}
function resolveOrg_(value){var s=String(value||'').trim(),idx=orgIndex_();for(var i=0;i<idx.rows.length;i++){var o=idx.rows[i];if(o.id===s||o.code===s||o.name===s)return o;}return null;}
function roleAssignments_(cccd){return select_('role_assignments',{cccd:cccd,active:true});}
function enterpriseScope_(cccd){var idx=orgIndex_(),roles=roleAssignments_(cccd),scope=[],manager=[],hr=[],admin=false,universityHr=false;roles.forEach(function(r){var ids=r.include_descendants?descendantOrgIds_(r.org_id,idx):[r.org_id];if(r.role==='unit_manager')manager=manager.concat(ids);if(r.role==='organization_hr'||r.role==='university_hr')hr=hr.concat(ids);if(r.role==='university_hr')universityHr=true;if(r.role==='system_admin'){admin=true;scope=idx.rows.map(function(o){return o.id;});}scope=scope.concat(ids);});function uniq(a){return a.filter(function(x,i){return x&&a.indexOf(x)===i;});}return{assignments:roles,scope_org_ids:uniq(scope),manager_org_ids:uniq(manager),hr_org_ids:uniq(hr),is_admin:admin,is_university_hr:universityHr};}
function effectiveRole_(workerType,scope){if(scope.is_admin)return'hr';if(scope.hr_org_ids.length)return'hr';if(scope.manager_org_ids.length)return workerType==='lecturer'?'manager_lecturer':'manager';return workerType==='lecturer'?'lecturer':'employee';}
function buildEmployeeV2_(cccd,selectedOrg){var c=normalizeCCCD_(cccd),p=one_('people',{cccd:c,active:true});if(!p)return null;var memberships=select_('organization_memberships',{cccd:c,active:true}),idx=orgIndex_();if(!memberships.length)return null;var chosen=null;if(selectedOrg){for(var i=0;i<memberships.length;i++){var o=idx.map[memberships[i].org_id];if(memberships[i].org_id===selectedOrg||(o&&(o.name===selectedOrg||o.code===selectedOrg))){chosen=memberships[i];break;}}}if(!chosen)chosen=memberships.filter(function(m){return m.is_primary;})[0]||memberships[0];var org=idx.map[chosen.org_id],scope=enterpriseScope_(c),names=memberships.map(function(m){return idx.map[m.org_id]?idx.map[m.org_id].name:m.org_id;});var annual=calcAnnual_(p.start_date);return{cccd:c,name:p.name,email:p.email||'',start_date:p.start_date||'',org_id:chosen.org_id,organization:org||null,department:org?org.name:chosen.org_id,departments:names,membership_org_ids:memberships.map(function(m){return m.org_id;}),worker_type:chosen.worker_type,role:effectiveRole_(chosen.worker_type,scope),enterprise_roles:scope.assignments,scope_org_ids:scope.scope_org_ids,manager_org_ids:scope.manager_org_ids,hr_org_ids:scope.hr_org_ids,is_admin:scope.is_admin,is_university_hr:scope.is_university_hr,annual_leave_days:annual,used_leave_days:0,seniority_years:seniority_(p.start_date)};}
function login_(cccd){cccd=normalizeCCCD_(cccd);if(!/^\d{12}$/.test(cccd))return fail_('Vui lòng nhập đủ 12 số CCCD');var emp=buildEmployeeV2_(cccd);if(!emp)return fail_('CCCD không tồn tại hoặc chưa được phân đơn vị. Liên hệ Nhân sự.');if(emp.departments.length>1)return ok_({needSelectDept:true,departments:emp.departments,name:emp.name,cccd:emp.cccd});return finishLogin_(emp);}
function loginWithDept_(cccd,dept){var emp=buildEmployeeV2_(normalizeCCCD_(cccd),dept);if(!emp||emp.departments.indexOf(dept)<0)return fail_('Đơn vị không hợp lệ');return finishLogin_(emp);}
function finishLogin_(emp){var scopedRows=scopedAcademicRequests_(emp),balance=ensureLeaveBalance_(emp.cccd,emp.start_date,new Date());emp.annual_leave_days=balance.entitlement;emp.used_leave_days=balance.used_days;emp.reserved_leave_days=balance.reserved_days;var token=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');CacheService.getScriptCache().put('TOKEN_'+token,JSON.stringify({employee:emp}),Math.floor(CONFIG.TOKEN_TTL_MS/1000));log_('LOGIN',emp.cccd,'role='+emp.role+'; org='+emp.org_id);var clean=sanitizeEmp_(emp),visible=filterRowsForRole_(scopedRows,emp,'').map(requestView_);return ok_({token:token,user:clean,bootstrap:{user:clean,requests:visible,stats:canApprove_(emp.role)?statsFromRows_(visible):null,holidays:isLecturer_(emp.role)?getHolidays_(new Date().getFullYear()):[]}});}
function verify_(token){if(!token)return null;var raw=CacheService.getScriptCache().get('TOKEN_'+token);if(!raw)return null;var t=JSON.parse(raw);return t.employee||null;}
function me_(token){var e=verify_(token);if(!e)return fail_('Token không hợp lệ hoặc hết hạn');var b=ensureLeaveBalance_(e.cccd,e.start_date,new Date());e.annual_leave_days=b.entitlement;e.used_leave_days=b.used_days;e.reserved_leave_days=b.reserved_days;CacheService.getScriptCache().put('TOKEN_'+token,JSON.stringify({employee:e}),Math.floor(CONFIG.TOKEN_TTL_MS/1000));return ok_({user:sanitizeEmp_(e)});}
function logout_(token){if(token)CacheService.getScriptCache().remove('TOKEN_'+token);return ok_({message:'Đã đăng xuất'});}

// ---------- Employees and leave balance ----------
function findEmployee_(cccd){var e=buildEmployeeV2_(cccd);if(!e)return null;var b=ensureLeaveBalance_(e.cccd,e.start_date,new Date());e.annual_leave_days=b.entitlement;e.used_leave_days=b.used_days;e.reserved_leave_days=b.reserved_days;return e;}
function findEmployeeFast_(cccd){return buildEmployeeV2_(cccd);}
function sanitizeEmp_(e){var ay=academicPeriod_(new Date()),reserved=Number(e.reserved_leave_days)||0;return{cccd:e.cccd,name:e.name,department:e.department,departments:e.departments,org_id:e.org_id,organization:e.organization,role:e.role,worker_type:e.worker_type,enterprise_roles:e.enterprise_roles,scope_org_ids:e.scope_org_ids,email:e.email,start_date:e.start_date,annual_leave_days:e.annual_leave_days,used_leave_days:e.used_leave_days,reserved_leave_days:reserved,remaining_leave_days:e.annual_leave_days-e.used_leave_days-reserved,seniority_years:e.seniority_years,academic_year:ay.label,academic_year_start:dateISO_(ay.start),academic_year_end:dateISO_(ay.end),is_lecturer:isLecturer_(e.role),is_manager:isManager_(e.role),is_hr:isHR_(e.role),is_university_hr:(e.enterprise_roles||[]).some(function(r){return r.role==='university_hr';}),is_admin:e.is_admin};}
function canManageOrg_(me,orgId){return !!(me&&isHR_(me.role)&&(me.is_admin||me.hr_org_ids.indexOf(orgId)>=0));}
function getEmployeesSlow_(token){var me=verify_(token);if(!me)return fail_('Chưa đăng nhập');if(!isHR_(me.role))return fail_('Không có quyền');var memberships=select_('organization_memberships',{active:true}),people=select_('people',{active:true},'name.asc'),idx=orgIndex_(),allowed=me.is_admin?idx.rows.map(function(o){return o.id;}):me.hr_org_ids,byPerson={};people.forEach(function(p){byPerson[p.cccd]=p;});var leaveRows=scopedAcademicRequests_(me),byCCCD={};leaveRows.forEach(function(r){(byCCCD[r.cccd]=byCCCD[r.cccd]||[]).push(r);});var out=[];memberships.forEach(function(m){if(allowed.indexOf(m.org_id)<0||!byPerson[m.cccd])return;var p=byPerson[m.cccd],o=idx.map[m.org_id],annual=calcAnnual_(p.start_date),info=leaveInfoFromRows_(byCCCD[p.cccd]||[],annual),scope=enterpriseScope_(p.cccd);out.push({cccd:p.cccd,name:p.name,department:o?o.name:m.org_id,org_id:m.org_id,role:effectiveRole_(m.worker_type,scope),worker_type:m.worker_type,email:p.email||'',start_date:p.start_date||'',annual_leave_days:annual,used_leave_days:info.used,remaining_leave_days:info.remaining});});return ok_({employees:out});}
function getEmployees_(token){
  var me=verify_(token);if(!me)return fail_('Chưa đăng nhập');if(!isHR_(me.role))return fail_('Không có quyền');
  var memberships=select_('organization_memberships',{active:true});
  var people=select_('people',{active:true},'name.asc');
  var allRoles=select_('role_assignments',{active:true});
  var currentYear=academicPeriod_(new Date()).label,balances=select_('leave_balances',{academic_year:currentYear});
  var idx=orgIndex_(),allowed=me.is_admin?idx.rows.map(function(o){return o.id;}):me.hr_org_ids;
  var byPerson={},rolesByCCCD={},balanceByCCCD={};
  people.forEach(function(p){byPerson[p.cccd]=p;});
  allRoles.forEach(function(r){(rolesByCCCD[r.cccd]=rolesByCCCD[r.cccd]||[]).push(r);});
  balances.forEach(function(b){balanceByCCCD[b.cccd]=b;});
  var out=[];
  memberships.forEach(function(m){
    var p=byPerson[m.cccd];if(!p||allowed.indexOf(m.org_id)<0)return;
    var roles=rolesByCCCD[m.cccd]||[],hasHR=false,hasManager=false;
    roles.forEach(function(r){if(r.role==='organization_hr'||r.role==='university_hr'||r.role==='system_admin')hasHR=true;if(r.role==='unit_manager')hasManager=true;});
    var role=hasHR?'hr':hasManager?(m.worker_type==='lecturer'?'manager_lecturer':'manager'):(m.worker_type==='lecturer'?'lecturer':'employee');
    var o=idx.map[m.org_id],b=balanceByCCCD[p.cccd],annual=b?Number(b.entitlement):annualAt_(p.start_date,academicPeriod_(new Date()).start),used=b?Number(b.used_days):0,reserved=b?Number(b.reserved_days):0;
    out.push({cccd:p.cccd,name:p.name,department:o?o.name:m.org_id,org_id:m.org_id,role:role,worker_type:m.worker_type,email:p.email||'',start_date:p.start_date||'',annual_leave_days:annual,used_leave_days:used,reserved_leave_days:reserved,remaining_leave_days:Math.max(0,annual-used-reserved)});
  });
  out.sort(function(a,b){return String(a.name).localeCompare(String(b.name),'vi');});
  return ok_({employees:out});
}
function savePersonMembership_(d,upsert){var c=normalizeCCCD_(d.cccd),org=resolveOrg_(d.org_id||d.department),worker=['lecturer','manager_lecturer'].indexOf(d.role)>=0?'lecturer':(d.worker_type||'employee');if(!org)throw new Error('Không tìm thấy đơn vị trong cơ cấu tổ chức');insert_('people',{cccd:c,name:String(d.name||'').trim(),email:String(d.email||'').trim(),start_date:dateISO_(d.start_date),active:true},true);var existing=select_('organization_memberships',{cccd:c,active:true}),makePrimary=d.is_primary===true||!existing.length;if(d.is_primary===true)update_('organization_memberships',{cccd:c},{is_primary:false});insert_('organization_memberships',{cccd:c,org_id:org.id,worker_type:worker,is_primary:makePrimary,active:true},true);if(d.role==='manager'||d.role==='manager_lecturer')upsertOn_('role_assignments',{cccd:c,org_id:org.id,role:'unit_manager',include_descendants:false,active:true},['cccd','org_id','role']);else update_('role_assignments',{cccd:c,org_id:org.id,role:'unit_manager'},{active:false});if(d.role==='hr')upsertOn_('role_assignments',{cccd:c,org_id:org.id,role:'organization_hr',include_descendants:true,active:true},['cccd','org_id','role']);return org;}
function createEmployee_(token,d){var me=verify_(token);if(!me)return fail_('Chưa đăng nhập');if(!isHR_(me.role))return fail_('Không có quyền');var c=normalizeCCCD_(d.cccd),org=resolveOrg_(d.org_id||d.department);if(!/^\d{12}$/.test(c)||!d.name||!org||!d.role)return fail_('Thiếu hoặc sai thông tin nhân viên/đơn vị');if(!canManageOrg_(me,org.id))return fail_('Đơn vị nằm ngoài phạm vi quản lý');savePersonMembership_(d,true);log_('CREATE_EMP',me.cccd,c+'@'+org.id);return ok_({message:'Thêm nhân viên thành công'});}
function updateEmployee_(token,d){var me=verify_(token);if(!me)return fail_('Chưa đăng nhập');if(!isHR_(me.role))return fail_('Không có quyền');var c=normalizeCCCD_(d.cccd),org=resolveOrg_(d.org_id||d.department);if(!org||!canManageOrg_(me,org.id))return fail_('Đơn vị không hợp lệ hoặc ngoài phạm vi quản lý');savePersonMembership_(d,true);log_('UPDATE_EMP',me.cccd,c+'@'+org.id);return ok_({message:'Cập nhật thành công'});}
function importEmployees_(token,d){var me=verify_(token);if(!me)return fail_('Chưa đăng nhập');if(!isHR_(me.role))return fail_('Không có quyền');var input=d.employees;if(!Array.isArray(input)||!input.length)return fail_('Tệp import không có dữ liệu');if(input.length>2000)return fail_('Mỗi lần chỉ import tối đa 2.000 dòng');var errors=[];input.forEach(function(r,i){try{var c=normalizeCCCD_(r.cccd),org=resolveOrg_(r.org_id||r.department);if(!/^\d{12}$/.test(c)||!r.name||!org||!canManageOrg_(me,org.id))throw new Error('CCCD, đơn vị hoặc phạm vi không hợp lệ');savePersonMembership_(r,true);}catch(err){errors.push('Dòng '+(i+2)+': '+err.message);}});if(errors.length)return fail_('Import chưa hoàn tất. '+errors.slice(0,10).join('; '));log_('IMPORT_EMPLOYEES',me.cccd,'rows='+input.length);return ok_({message:'Đã import '+input.length+' dòng nhân viên',imported:input.length});}

// ---------- Organization administration ----------
function getOrganizationTree_(token){var me=verify_(token);if(!me)return fail_('Chưa đăng nhập');var idx=orgIndex_(),allowed=me.is_admin||me.is_university_hr?idx.rows.map(function(o){return o.id;}):me.scope_org_ids;return ok_({organizations:idx.rows.filter(function(o){return allowed.indexOf(o.id)>=0;}),role_assignments:isHR_(me.role)?select_('role_assignments',{active:true}):[]});}
function saveOrganization_(token,d){var me=verify_(token);if(!me)return fail_('Chưa đăng nhập');if(!isHR_(me.role))return fail_('Không có quyền');var id=String(d.id||('org-'+Utilities.getUuid().slice(0,8))).trim(),existing=d.id?one_('organizations',{id:id,active:true}):null,parent=d.parent_id?resolveOrg_(d.parent_id):null;if(!parent&&!existing)return fail_('Đơn vị mới phải có đơn vị cha');if(existing&&!parent&&existing.parent_id)return fail_('Chỉ đơn vị gốc được để trống đơn vị cha');if(parent&&(!canManageOrg_(me,parent.id)||parent.id===id||descendantOrgIds_(id).indexOf(parent.id)>=0))return fail_('Đơn vị cha không hợp lệ hoặc ngoài phạm vi quản lý');if(existing&&!canManageOrg_(me,existing.id))return fail_('Không có quyền sửa đơn vị này');var code=String(d.code||id).trim().toUpperCase(),name=String(d.name||'').trim(),type=String(d.org_type||'department');if(!name)return fail_('Vui lòng nhập tên đơn vị');insert_('organizations',{id:id,code:code,name:name,org_type:type,parent_id:parent?parent.id:null,active:d.active!==false,sort_order:Number(d.sort_order)||100,updated_at:new Date().toISOString()},true);CacheService.getScriptCache().remove('ORG_TREE_V2');log_('SAVE_ORG',me.cccd,id);return ok_({message:'Đã lưu đơn vị',org_id:id});}
function assignEnterpriseRole_(token,d){var me=verify_(token);if(!me)return fail_('Chưa đăng nhập');if(!isHR_(me.role))return fail_('Không có quyền');var c=normalizeCCCD_(d.cccd),org=resolveOrg_(d.org_id),role=String(d.enterprise_role||'');if(!one_('people',{cccd:c})||!org)return fail_('Nhân sự hoặc đơn vị không tồn tại');if(!canManageOrg_(me,org.id)&&!me.is_admin)return fail_('Ngoài phạm vi quản lý');if(['unit_manager','organization_hr','university_hr','system_admin'].indexOf(role)<0)return fail_('Vai trò không hợp lệ');if((role==='university_hr'||role==='system_admin')&&!me.is_admin&&!me.is_university_hr)return fail_('Chỉ quản trị cấp Đại học được phân vai trò này');upsertOn_('role_assignments',{cccd:c,org_id:org.id,role:role,include_descendants:role!=='unit_manager',active:true},['cccd','org_id','role']);log_('ASSIGN_ROLE',me.cccd,c+'@'+org.id+':'+role);return ok_({message:'Đã phân quyền'});}
function requireAdmin_(token){var me=verify_(token);return me&&me.is_admin?me:null;}
function deleteOrganization_(token,d){var me=requireAdmin_(token);if(!me)return fail_('Chỉ Quản trị hệ thống được xóa đơn vị');var id=String(d.org_id||d.id||'');if(!id||id==='ump')return fail_('Không thể xóa đơn vị gốc');var org=one_('organizations',{id:id,active:true});if(!org)return fail_('Không tìm thấy đơn vị');if(select_('organizations',{parent_id:id,active:true}).length)return fail_('Đơn vị còn đơn vị con; hãy xử lý đơn vị con trước');if(select_('organization_memberships',{org_id:id,active:true}).length)return fail_('Đơn vị còn nhân sự; hãy chuyển nhân sự trước');update_('organizations',{id:id},{active:false,updated_at:new Date().toISOString()});CacheService.getScriptCache().remove('ORG_TREE_V2');log_('DELETE_ORG',me.cccd,id);return ok_({message:'Đã vô hiệu hóa đơn vị'});}
function revokeEnterpriseRole_(token,d){var me=requireAdmin_(token);if(!me)return fail_('Chỉ Quản trị hệ thống được thu hồi phân quyền');var id=Number(d.role_assignment_id||d.id),r=one_('role_assignments',{id:id,active:true});if(!r)return fail_('Không tìm thấy phân quyền');if(r.cccd===me.cccd&&r.role==='system_admin')return fail_('Không thể tự thu hồi quyền quản trị của chính mình');update_('role_assignments',{id:id},{active:false});log_('REVOKE_ROLE',me.cccd,String(id));return ok_({message:'Đã thu hồi phân quyền'});}
function deleteEmployee_(token,d){var me=requireAdmin_(token);if(!me)return fail_('Chỉ Quản trị hệ thống được xóa nhân viên');var c=normalizeCCCD_(d.cccd);if(c===me.cccd)return fail_('Không thể tự xóa tài khoản đang đăng nhập');if(!one_('people',{cccd:c,active:true}))return fail_('Không tìm thấy nhân viên');update_('people',{cccd:c},{active:false,updated_at:new Date().toISOString()});update_('organization_memberships',{cccd:c},{active:false,is_primary:false});update_('role_assignments',{cccd:c},{active:false});log_('DELETE_EMPLOYEE',me.cccd,c);return ok_({message:'Đã vô hiệu hóa nhân viên; lịch sử đơn nghỉ được giữ nguyên'});}
function adminUpdateLeave_(token,d){var me=requireAdmin_(token);if(!me)return fail_('Chỉ Quản trị hệ thống được sửa đơn nghỉ');var r=getRequest_(d.request_id);if(!r)return fail_('Không tìm thấy đơn');var from=parseDate_(d.from_date),to=parseDate_(d.to_date),half=String(d.half_day||r.half_day||'none');if(!from||!to||from>to)return fail_('Khoảng ngày không hợp lệ');var ay=academicPeriod_(from);if(to>ay.end)return fail_('Đơn không được kéo dài qua hai năm học');var days=half==='none'?workDays_(from,to):.5;if(half!=='none'&&from.getTime()!==to.getTime())return fail_('Đơn nửa ngày phải trong cùng một ngày');if(days<=0)return fail_('Không có ngày làm việc');var owner=findEmployee_(r.cccd);if(!owner)return fail_('Nhân viên không còn hoạt động');ensureLeaveBalance_(r.cccd,owner.start_date,from);var conflicts=sb_('leave_requests','get','select=id&id=neq.'+q_(r.id)+'&cccd=eq.'+q_(r.cccd)+'&status=neq.rejected&from_date=lte.'+q_(dateISO_(to))+'&to_date=gte.'+q_(dateISO_(from)));if(conflicts.length)return fail_('Khoảng ngày trùng với đơn khác');var history=historyItem_(me,'admin_updated','Quản trị sửa đơn: '+String(d.note||''));rpc_('hrm_admin_update_leave',{p_request_id:r.id,p_from_date:dateISO_(from),p_to_date:dateISO_(to),p_days:days,p_reason:String(d.reason||r.reason).trim(),p_attachment:d.attachment===undefined?r.attachment:String(d.attachment||''),p_half_day:half,p_academic_year:ay.label,p_history_item:history});log_('ADMIN_UPDATE_LEAVE',me.cccd,r.id);return ok_({message:'Đã cập nhật đơn nghỉ',days:days});}
function adminDeleteLeave_(token,d){var me=requireAdmin_(token);if(!me)return fail_('Chỉ Quản trị hệ thống được xóa đơn nghỉ');var id=String(d.request_id||'');if(!id)return fail_('Thiếu mã đơn');rpc_('hrm_admin_delete_leave',{p_request_id:id});log_('ADMIN_DELETE_LEAVE',me.cccd,id);return ok_({message:'Đã xóa đơn và hoàn lại số dư phép liên quan'});}

// ---------- Academic-year leave balances ----------
function seniorityAt_(startDate,atDate){var s=parseDate_(startDate),a=parseDate_(atDate);if(!s||!a||a<s)return 0;var y=a.getFullYear()-s.getFullYear();if(a.getMonth()<s.getMonth()||(a.getMonth()===s.getMonth()&&a.getDate()<s.getDate()))y--;return Math.max(0,y);}
function annualAt_(startDate,periodStart){return Math.min(12+Math.floor(seniorityAt_(startDate,periodStart)/5),18);}
function ensureLeaveBalance_(cccd,startDate,referenceDate){var ay=academicPeriod_(referenceDate),row=one_('leave_balances',{cccd:cccd,academic_year:ay.label});if(!row){var entitlement=annualAt_(startDate,ay.start);var created=insert_('leave_balances',{cccd:cccd,academic_year:ay.label,period_start:dateISO_(ay.start),period_end:dateISO_(ay.end),entitlement:entitlement,used_days:0,reserved_days:0,carryover_days:0,updated_at:new Date().toISOString()},true);row=created&&created.length?created[0]:one_('leave_balances',{cccd:cccd,academic_year:ay.label});}row.entitlement=Number(row.entitlement)||0;row.used_days=Number(row.used_days)||0;row.reserved_days=Number(row.reserved_days)||0;row.carryover_days=0;row.remaining_days=Math.max(0,row.entitlement-row.used_days-row.reserved_days);return row;}
function getLeaveBalance_(token,d){var e=verify_(token);if(!e)return fail_('Chưa đăng nhập');var ref=parseDate_(d.reference_date)||new Date(),b=ensureLeaveBalance_(e.cccd,e.start_date,ref);return ok_({balance:b});}
function balanceAction_(name,cccd,year,days){var result=rpc_(name,{p_cccd:cccd,p_year:year,p_days:Number(days)});return result===true||(Array.isArray(result)&&result[0]===true);}

// ---------- Leave requests ----------
function createLeaveRequest_(token,d) {
  var e=verify_(token); if(!e)return fail_('Chưa đăng nhập');
  var from=parseDate_(d.from_date),to=parseDate_(d.to_date); if(!from||!to||from>to)return fail_('Khoảng ngày không hợp lệ'); if(!String(d.reason||'').trim())return fail_('Vui lòng nhập lý do');
  var leaveYear=academicPeriod_(from);if(to>leaveYear.end)return fail_('Đơn nghỉ không được kéo dài qua hai năm học. Năm học '+leaveYear.label+' kết thúc ngày 30/06/'+leaveYear.end.getFullYear()+'. Vui lòng tạo hai đơn riêng: một đơn đến 30/06/'+leaveYear.end.getFullYear()+' và một đơn từ 01/07/'+leaveYear.end.getFullYear()+'.');
  if(isLecturer_(e.role)){var h=holidayOverlap_(from,to);if(h)return fail_('Khoảng thời gian này thuộc kỳ '+(h.type==='summer'?'nghỉ hè':'nghỉ Tết')+' ('+dateVN_(h.from_date)+' đến '+dateVN_(h.to_date)+'). Giảng viên không cần tạo đơn.');}
  var half=d.half_day||'none',days=0;
  if(half!=='none'){if(from.getTime()!==to.getTime())return fail_('Nghỉ nửa ngày chỉ áp dụng trong cùng một ngày');if(from.getDay()===0||from.getDay()===6)return fail_('Không thể nghỉ nửa ngày vào cuối tuần');days=.5;} else {days=workDays_(from,to);if(days<=0)return fail_('Không có ngày làm việc trong khoảng đã chọn');}
  var balance=ensureLeaveBalance_(e.cccd,e.start_date,from),remain=balance.remaining_days;if(days>remain)return fail_('Vượt số ngày phép khả dụng ('+remain+' ngày) trong năm học '+leaveYear.label+'. Số ngày đang chờ duyệt cũng đã được giữ chỗ.');
  var conflicts=sb_('leave_requests','get','select=id&cccd=eq.'+q_(e.cccd)+'&status=neq.rejected&from_date=lte.'+q_(dateISO_(to))+'&to_date=gte.'+q_(dateISO_(from)));if(conflicts.length)return fail_('Trùng lịch với đơn đã có');
  if(!balanceAction_('hrm_reserve_leave',e.cccd,leaveYear.label,days))return fail_('Số ngày phép vừa thay đổi hoặc không còn đủ. Vui lòng tải lại và thử lại.');
  var id='LR'+Date.now(),now=new Date().toISOString();
  var history=[historyItem_(e,'pending','Tạo đơn xin nghỉ phép')];
  var hrOrg=resolveHrOrg_(e.org_id);
  try{insert_('leave_requests',{id:id,cccd:e.cccd,employee_name:e.name,department:e.department,org_id:e.org_id,hr_org_id:hrOrg,academic_year:leaveYear.label,from_date:dateISO_(from),to_date:dateISO_(to),days:days,reason:String(d.reason).trim(),status:'pending',attachment:d.attachment||'',history:history,half_day:half,return_info:null,created_at:now,updated_at:now});}catch(err){balanceAction_('hrm_release_reserved_leave',e.cccd,leaveYear.label,days);throw err;}
  log_('CREATE',e.cccd,id); try{notifyManagerNew_(e,id,d.from_date,d.to_date,days,d.reason,half);}catch(err){console.error(err);}
  return ok_({message:'Tạo đơn thành công ('+days+' ngày), đang chờ phê duyệt.',request_id:id,days:days,half_day:half});
}
function requestView_(r){r.employee_id=r.cccd;r.from_date=dateVN_(r.from_date);r.to_date=dateVN_(r.to_date);r.history=r.history||[];r.half_day=r.half_day||'none';return r;}
function scopedAcademicRequests_(e) {
  var ay=academicPeriod_(new Date());
  var query='select=*&from_date=gte.'+q_(dateISO_(ay.start))+'&from_date=lte.'+q_(dateISO_(ay.end))+'&order=created_at.desc';
  return sb_('leave_requests','get',query)||[];
}
function filterRowsForRole_(rows,e,scope) {
  if(scope==='mine'||(!scope&&(e.role==='employee'||e.role==='lecturer'))) return rows.filter(function(r){return r.cccd===e.cccd;});
  if(scope==='team') {
    if(isManager_(e.role)) return rows.filter(function(r){return e.manager_org_ids.indexOf(r.org_id)>=0&&r.cccd!==e.cccd;});
    if(isHR_(e.role)) return rows.filter(function(r){return (e.is_admin||e.hr_org_ids.indexOf(r.org_id)>=0)&&r.cccd!==e.cccd;});
    return [];
  }
  if(isManager_(e.role)) return rows.filter(function(r){return e.manager_org_ids.indexOf(r.org_id)>=0;});
  if(isHR_(e.role)) return rows.filter(function(r){return e.is_admin||e.hr_org_ids.indexOf(r.org_id)>=0;});
  return rows.filter(function(r){return r.cccd===e.cccd;});
}
function leaveInfoFromRows_(rows,total) {
  var used=0;
  rows.forEach(function(r){if(['approved','hr_confirmed','approved_partial_returned','hr_confirmed_partial_returned'].indexOf(r.status)>=0)used+=Number(r.days)||0;});
  return {used:used,remaining:total-used,total:total};
}
function statsFromRows_(rows) {
  var bp={},bd={},count={};
  rows.filter(function(r){return ['approved','hr_confirmed','approved_partial_returned','hr_confirmed_partial_returned'].indexOf(r.status)>=0;}).forEach(function(r){bp[r.cccd]=bp[r.cccd]||{name:r.employee_name,department:r.department,total_days:0};bp[r.cccd].total_days+=Number(r.days)||0;bd[r.department]=bd[r.department]||{total_days:0,count:0};bd[r.department].total_days+=Number(r.days)||0;bd[r.department].count++;});
  ['pending','approved','rejected','hr_confirmed','hr_returned','returned'].forEach(function(s){count[s]=rows.filter(function(r){return r.status===s;}).length;});
  return {academic_year:academicPeriod_(new Date()).label,by_person:Object.keys(bp).map(function(k){bp[k].id=k;return bp[k];}),by_department:Object.keys(bd).map(function(k){bd[k].department=k;return bd[k];}),status_count:count,total_requests:rows.length};
}
function getLeaveRequests_(token,d) {
  var e=verify_(token);if(!e)return fail_('Chưa đăng nhập');var rows=scopedAcademicRequests_(e),scope=String(d.scope||'');rows=filterRowsForRole_(rows,e,scope).map(requestView_);
  var st=String(d.status||'');if(st&&st!=='all'){if(st==='return_pending')rows=rows.filter(function(r){return r.return_info&&r.return_info.status==='return_pending';});else rows=rows.filter(function(r){return r.status===st||(st==='approved'&&r.status==='approved_partial_returned')||(st==='hr_confirmed'&&r.status==='hr_confirmed_partial_returned');});}
  return ok_({requests:rows});
}
function getRequest_(id){var r=one_('leave_requests',{id:id});return r?requestView_(r):null;}
function changeStatus_(token,d,status) {
  var e=verify_(token);if(!e)return fail_('Chưa đăng nhập');var req=getRequest_(d.request_id);if(!req)return fail_('Không tìm thấy đơn');var note=String(d.note||'').trim();
  if(status==='approved'||status==='rejected'){if(!isManager_(e.role)&&!isHR_(e.role))return fail_('Không có quyền');if(isManager_(e.role)&&e.manager_org_ids.indexOf(req.org_id)<0)return fail_('Đơn không thuộc đơn vị phụ trách');if(isHR_(e.role)&&!e.is_admin&&e.hr_org_ids.indexOf(req.org_id)<0)return fail_('Đơn ngoài phạm vi Nhân sự phụ trách');if(status==='rejected'&&!note)return fail_('Vui lòng nhập lý do từ chối');if(req.status!=='pending')return fail_('Đơn đã được xử lý');}
  else {if(!isHR_(e.role)||(!e.is_admin&&e.hr_org_ids.indexOf(req.org_id)<0))return fail_('Chỉ Nhân sự phụ trách đơn vị này mới có quyền');if(status==='hr_confirmed'&&req.status!=='approved')return fail_('Đơn chưa được trưởng đơn vị duyệt');if(status==='hr_returned'&&!note)return fail_('Vui lòng nhập lý do trả lại');}
  var originalHistory=JSON.parse(JSON.stringify(req.history||[])),hist=JSON.parse(JSON.stringify(originalHistory));hist.push(historyItem_(e,status,note));var patch={status:status,history:hist,updated_at:new Date().toISOString()};
  if(status==='approved'||status==='rejected'){patch.approver_cccd=e.cccd;patch.approver_note=note;}else{patch.hr_cccd=e.cccd;patch.hr_note=note;}
  update_('leave_requests',{id:req.id},patch);
  var balanceYear=req.academic_year||academicPeriod_(parseDate_(req.from_date)).label,balanceOk=true;
  if(status==='rejected'||status==='hr_returned')balanceOk=balanceAction_('hrm_release_reserved_leave',req.cccd,balanceYear,req.days);
  if(status==='hr_confirmed')balanceOk=balanceAction_('hrm_confirm_reserved_leave',req.cccd,balanceYear,req.days);
  if(!balanceOk){update_('leave_requests',{id:req.id},{status:req.status,history:originalHistory,updated_at:new Date().toISOString()});return fail_('Không cập nhật được số dư phép. Trạng thái đơn đã được hoàn tác.');}
  log_(status.toUpperCase(),e.cccd,req.id);
  try{if(status==='approved')notifyHRPending_(req);if(status==='hr_confirmed'||status==='hr_returned'){var owner=findEmployee_(req.cccd);if(owner)notifyEmployeeResult_(owner,req.id,status,note);}}catch(err){console.error(err);}
  return ok_({message:'OK',employee_id:req.cccd,days:req.days});
}

// ---------- Return leave ----------
function createReturn_(token,d) {
  var e=verify_(token);if(!e)return fail_('Chưa đăng nhập');var r=getRequest_(d.request_id);if(!r)return fail_('Không tìm thấy đơn gốc');if(r.cccd!==e.cccd)return fail_('Bạn không có quyền trả phép đơn này');
  if(['approved','hr_confirmed'].indexOf(r.status)<0)return fail_('Chỉ có thể trả phép với đơn đã được duyệt');if(r.return_info&&r.return_info.status==='return_pending')return fail_('Đơn này đang có yêu cầu trả phép chờ xử lý');
  var from=parseDate_(r.from_date),today=new Date();today.setHours(0,0,0,0);if(from<=today)return fail_('Chỉ có thể trả phép trước ngày bắt đầu nghỉ');if(!String(d.reason||'').trim())return fail_('Vui lòng nhập lý do trả phép');
  var orig=Number(r.days),n=0,type=d.return_type;if(type==='full')n=orig;else if(type==='half'){if(orig<1)return fail_('Đơn nửa ngày không thể trả nửa ngày');if(['morning','afternoon'].indexOf(d.return_session)<0)return fail_('Vui lòng chọn buổi');n=.5;}else if(type==='partial'){n=Number(d.return_days);if(n<=0||n>=orig||Math.round(n*2)!==n*2)return fail_('Số ngày trả phải nhỏ hơn tổng ngày và theo bước 0.5');}else return fail_('Loại trả phép không hợp lệ');
  var info={return_type:type,return_days:n,return_session:d.return_session||'',reason:String(d.reason).trim(),created_at:new Date().toISOString(),created_by:e.cccd,status:'return_pending',hr_note:'',confirmed_at:''};var hist=r.history||[];hist.push(historyItem_(e,'return_pending','Yêu cầu trả '+n+' ngày phép: '+info.reason));
  update_('leave_requests',{id:r.id},{return_info:info,history:hist,updated_at:new Date().toISOString()});log_('CREATE_RETURN',e.cccd,r.id);try{notifyHRReturn_(e,r.id,info);}catch(err){console.error(err);}return ok_({message:'Đã gửi yêu cầu trả '+n+' ngày phép. Chờ Nhân sự phụ trách xác nhận.',return_days:n});
}
function resolveReturn_(token,d,confirm) {
  var e=verify_(token);if(!e)return fail_('Chưa đăng nhập');var r=getRequest_(d.request_id);if(!r||!r.return_info)return fail_('Không tìm thấy yêu cầu trả phép');if(!isHR_(e.role)||(!e.is_admin&&e.hr_org_ids.indexOf(r.org_id)<0))return fail_('Chỉ Nhân sự phụ trách đơn vị này mới có quyền');var originalInfo=JSON.parse(JSON.stringify(r.return_info)),originalHistory=JSON.parse(JSON.stringify(r.history||[])),info=JSON.parse(JSON.stringify(r.return_info));if(info.status!=='return_pending')return fail_('Yêu cầu này đã được xử lý');if(!confirm&&!String(d.note||'').trim())return fail_('Vui lòng nhập lý do từ chối');
  var now=new Date().toISOString();info.status=confirm?'return_confirmed':'return_rejected';info.hr_note=d.note||'';info.confirmed_at=now;info.confirmed_by=e.cccd;var hist=JSON.parse(JSON.stringify(originalHistory));hist.push(historyItem_(e,info.status,(confirm?'Xác nhận':'Từ chối')+' trả phép '+info.return_days+' ngày. '+(d.note||'')));var patch={return_info:info,history:hist,updated_at:now};
  if(confirm){var newDays=Number(r.days)-Number(info.return_days);patch.days=newDays;patch.status=info.return_type==='full'?'returned':r.status.replace(/_partial_returned$/,'')+'_partial_returned';}
  update_('leave_requests',{id:r.id},patch);
  if(confirm){var by= r.academic_year||academicPeriod_(parseDate_(r.from_date)).label;var fn=r.status==='hr_confirmed'?'hrm_reduce_used_leave':'hrm_release_reserved_leave';if(!balanceAction_(fn,r.cccd,by,info.return_days)){update_('leave_requests',{id:r.id},{days:r.days,status:r.status,return_info:originalInfo,history:originalHistory,updated_at:new Date().toISOString()});return fail_('Không cập nhật được số dư hoàn phép. Đơn đã được hoàn tác.');}}
  log_(confirm?'CONFIRM_RETURN':'REJECT_RETURN',e.cccd,r.id);try{var owner=findEmployee_(r.cccd);if(owner)notifyEmployeeReturn_(owner,r.id,confirm,info.return_days,d.note);}catch(err){console.error(err);}return ok_({message:confirm?'Đã xác nhận trả '+info.return_days+' ngày phép.':'Đã từ chối yêu cầu trả phép',return_days:info.return_days,new_days:confirm?patch.days:r.days});
}

// ---------- Holidays, statistics ----------
function getHolidays_(year){var filters={};if(year)filters.year=Number(year);return select_('holiday_settings',filters,'from_date.asc').map(function(h){h.from_date=dateVN_(h.from_date);h.to_date=dateVN_(h.to_date);return h;});}
function holidayOverlap_(from,to){var hs=getHolidays_(from.getFullYear());for(var i=0;i<hs.length;i++){var a=parseDate_(hs[i].from_date),b=parseDate_(hs[i].to_date);if(from<=b&&to>=a)return hs[i];}return null;}
function saveHoliday_(token,d){var e=verify_(token);if(!e)return fail_('Chưa đăng nhập');if(!isHR_(e.role))return fail_('Không có quyền');if(!d.year||!d.type||!d.from_date||!d.to_date)return fail_('Thiếu thông tin kỳ nghỉ');insert_('holiday_settings',{year:Number(d.year),type:d.type,from_date:dateISO_(d.from_date),to_date:dateISO_(d.to_date),note:d.note||'',created_by:e.cccd,created_at:new Date().toISOString()},true);return ok_({message:'Đã lưu kỳ nghỉ'});}
function deleteHoliday_(token,d){var e=verify_(token);if(!e)return fail_('Chưa đăng nhập');if(!isHR_(e.role))return fail_('Không có quyền');delete_('holiday_settings',{year:Number(d.year),type:d.type});return ok_({message:'Đã xóa kỳ nghỉ'});}
function detailedLeave_(cccd,total,referenceDate){var ay=academicPeriod_(referenceDate||new Date()),rows=select_('leave_requests',{cccd:cccd});var used=0,reqs=[];rows.forEach(function(r){var st=r.status;if(['rejected','pending','returned','hr_returned'].indexOf(st)>=0)return;var d=parseDate_(r.from_date);if(!d||d<ay.start||d>ay.end)return;if(['approved','hr_confirmed','approved_partial_returned','hr_confirmed_partial_returned'].indexOf(st)<0)return;used+=Number(r.days)||0;reqs.push(requestView_(r));});return {used:used,remaining:total-used,total:total,requests:reqs,academic_year:ay.label,period_start:dateISO_(ay.start),period_end:dateISO_(ay.end)};}
function getEmployeeLeaveInfo_(token,d){var e=verify_(token);if(!e)return fail_('Chưa đăng nhập');if(!canApprove_(e.role))return fail_('Không có quyền');var t=findEmployee_(d.cccd);if(!t)return fail_('Không tìm thấy nhân viên');if(!e.is_admin&&e.scope_org_ids.indexOf(t.org_id)<0)return fail_('Nhân viên nằm ngoài phạm vi quản lý');var b=ensureLeaveBalance_(t.cccd,t.start_date,new Date()),info=detailedLeave_(t.cccd,b.entitlement);return ok_({cccd:t.cccd,name:t.name,department:t.department,org_id:t.org_id,annual_days:b.entitlement,used_days:b.used_days,reserved_days:b.reserved_days,remaining:b.remaining_days,seniority:t.seniority_years,start_date:t.start_date,academic_year:b.academic_year,period_start:b.period_start,period_end:b.period_end,requests:info.requests});}
function getStats_(token){var e=verify_(token);if(!e)return fail_('Chưa đăng nhập');if(!canApprove_(e.role))return fail_('Không có quyền');var rows=filterRowsForRole_(scopedAcademicRequests_(e),e,'');return ok_({stats:statsFromRows_(rows)});}

// ---------- Utilities ----------
function parseDate_(v){if(!v)return null;if(v instanceof Date)return new Date(v.getFullYear(),v.getMonth(),v.getDate());var s=String(v).trim(),m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);return m?new Date(+m[1],+m[2]-1,+m[3]):null;}
function dateISO_(v){var d=parseDate_(v);return d?Utilities.formatDate(d,'UTC','yyyy-MM-dd'):null;}
function dateVN_(v){var d=parseDate_(v);return d?Utilities.formatDate(d,'UTC','dd/MM/yyyy'):'';}
function isoDateTime_(v){if(!v)return new Date().toISOString();var d=v instanceof Date?v:new Date(v);return isNaN(d)?new Date().toISOString():d.toISOString();}
function jsonValue_(v,fallback){if(v===null||v===undefined||v==='')return fallback;if(typeof v==='object')return v;try{return JSON.parse(v);}catch(_){return fallback;}}
function normalizeNullableCCCD_(v){return v?normalizeCCCD_(v):null;}
function seniority_(v){var d=parseDate_(v);if(!d)return 0;var n=new Date(),y=n.getFullYear()-d.getFullYear();if(n.getMonth()<d.getMonth()||(n.getMonth()===d.getMonth()&&n.getDate()<d.getDate()))y--;return Math.max(0,y);}
function calcAnnual_(v){return Math.min(12+Math.floor(seniority_(v)/5),18);}
function workDays_(a,b){var n=0,d=new Date(a);while(d<=b){if(d.getDay()!==0&&d.getDay()!==6)n++;d.setDate(d.getDate()+1);}return n;}
function academicPeriod_(referenceDate){var d=parseDate_(referenceDate)||new Date(),y=d.getFullYear(),startYear=d.getMonth()>=6?y:y-1;return{start:new Date(startYear,6,1),end:new Date(startYear+1,5,30),label:startYear+'–'+(startYear+1)};}
function isLecturer_(r){return r==='lecturer'||r==='manager_lecturer';}function isManager_(r){return r==='manager'||r==='manager_lecturer';}function isHR_(r){return r==='hr';}function canApprove_(r){return isManager_(r)||isHR_(r);}
function resolveHrOrg_(orgId){var idx=orgIndex_(),anc=ancestorOrgIds_(orgId,idx);for(var i=0;i<anc.length;i++){var a=select_('role_assignments',{org_id:anc[i],role:'organization_hr',active:true});if(a.length)return anc[i];}for(var j=0;j<anc.length;j++){var u=select_('role_assignments',{org_id:anc[j],role:'university_hr',active:true});if(u.length)return anc[j];}return'ump';}
function historyItem_(e,status,note){return{time:new Date().toISOString(),status:status,actor_id:e.cccd,actor_name:e.name,actor_dept:e.department,role:e.role,note:note||''};}
function ok_(o){o=o||{};o.success=true;return o;}function fail_(m){return{success:false,message:m};}function jsonOutput_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
function log_(action,cccd,detail){try{insert_('audit_logs',{created_at:new Date().toISOString(),action:action,cccd:cccd||null,detail:detail||''});}catch(err){console.error('Audit: '+err.message);}}

// ---------- Gmail notifications ----------
function appUrl_(){return PropertiesService.getScriptProperties().getProperty('WEB_APP_URL')||ScriptApp.getService().getUrl()||'';}
function sendMail_(to,subject,title,rows,footer){if(!to)return;var body='<div style="font-family:Arial;max-width:600px;margin:auto;background:#102044;color:#eef3fa;padding:24px;border-radius:12px"><h2 style="color:#f4b942">'+html_(title)+'</h2><table style="width:100%">'+rows.map(function(r){return'<tr><td style="padding:7px;color:#9fb2ce">'+html_(r[0])+'</td><td style="padding:7px">'+html_(r[1])+'</td></tr>';}).join('')+'</table><p style="color:#f4b942">'+html_(footer)+'</p></div>';GmailApp.sendEmail(to,subject,'',{htmlBody:body,name:'HRM · Sổ tay Quản lý nghỉ phép'});try{insert_('notifications',{recipient_email:to,subject:subject,status:'sent',created_at:new Date().toISOString()});}catch(_){}}
function html_(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function peopleForRole_(orgId,role){var rs=select_('role_assignments',{org_id:orgId,role:role,active:true}),out=[];rs.forEach(function(r){var p=one_('people',{cccd:r.cccd,active:true});if(p&&p.email)out.push(p);});return out;}
function managers_(orgId){return peopleForRole_(orgId,'unit_manager');}
function hrsForRequest_(r){var target=r.hr_org_id||resolveHrOrg_(r.org_id),a=peopleForRole_(target,'organization_hr');if(!a.length)a=peopleForRole_(target,'university_hr');return a;}
function notifyManagerNew_(e,id,from,to,days,reason,half){managers_(e.org_id).forEach(function(m){sendMail_(m.email,'[Cần duyệt] Đơn xin nghỉ phép của '+e.name,'Đơn xin nghỉ phép mới',[['VC-NLĐ',e.name],['Đơn vị',e.department],['Mã đơn',id],['Từ ngày',from],['Đến ngày',to],['Số ngày',String(days)],['Lý do',reason]],'Đăng nhập '+appUrl_()+' để xem xét.');});}
function notifyHRPending_(r){hrsForRequest_(r).forEach(function(h){sendMail_(h.email,'[Chờ xác nhận] Đơn nghỉ phép của '+r.employee_name,'Đơn chờ Nhân sự phụ trách xác nhận',[['VC-NLĐ',r.employee_name],['Đơn vị',r.department],['Mã đơn',r.id],['Số ngày',String(r.days)]],'Đăng nhập '+appUrl_()+' để xác nhận.');});}
function notifyEmployeeResult_(e,id,status,note){sendMail_(e.email,(status==='hr_confirmed'?'[Hoàn tất] ':'[Trả lại] ')+'Đơn '+id,'Kết quả xử lý đơn',[['Mã đơn',id],['Kết quả',status==='hr_confirmed'?'Đã ghi nhận':'Trả lại'],['Ghi chú',note||'--']],'Vui lòng đăng nhập hệ thống để xem chi tiết.');}
function notifyHRReturn_(e,id,info){var r=one_('leave_requests',{id:id})||{org_id:e.org_id,hr_org_id:resolveHrOrg_(e.org_id)};hrsForRequest_(r).forEach(function(h){sendMail_(h.email,'[Trả phép] '+e.name+' muốn trả phép','Yêu cầu trả phép',[['Nhân viên',e.name],['Đơn vị',e.department],['Mã đơn',id],['Số ngày trả',String(info.return_days)],['Lý do',info.reason]],'Đăng nhập '+appUrl_()+' để xử lý.');});}
function notifyEmployeeReturn_(e,id,confirmed,days,note){sendMail_(e.email,(confirmed?'[Hoàn phép] ':'[Từ chối trả phép] ')+id,confirmed?'Đã xác nhận trả phép':'Đã từ chối trả phép',[['Mã đơn',id],['Số ngày',String(days)],['Ghi chú',note||'--']],'Vui lòng đăng nhập hệ thống để xem chi tiết.');}
