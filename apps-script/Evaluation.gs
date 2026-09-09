/**
 * PHÂN HỆ ĐÁNH GIÁ VC-NLĐ V3
 * - Dùng chung token, CCCD, tổ chức và phân quyền của HRM Enterprise.
 * - Dữ liệu đánh giá tiếp tục lưu trong Google Sheets.
 * - Phiếu tháng MM-YYYY mở từ ngày 25/MM đến hết ngày 10 tháng kế tiếp.
 *
 * Script Property bắt buộc:
 *   EVALUATION_SPREADSHEET_ID = ID file Google Sheets đánh giá hiện tại.
 */
var EVAL_CONFIG = {
  VERSION: 'EVALUATION_ENTERPRISE_3.0.0',
  SHEET_DATA: 'DuLieuDanhGia',
  SHEET_STAFF: 'DanhSachNhanSu',
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  OPEN_DAY: 25,
  CLOSE_DAY: 10,
  LEGACY_COLS: 24,
  HEADERS: [
    'Thời gian','ThangDanhGia','Họ và tên','Đơn vị','d11','d12','d13',
    'd21','d22','d23','d24','d25','d31','d32','d33','d41','d42','d43',
    'Tổng Điểm','Xếp Loại','Ghi chú A+ - Xuất sắc','Điểm Trưởng đơn vị đánh giá',
    'Trưởng đơn vị Xếp loại','Ghi chú KQ đánh giá','EvaluationId','CCCD','OrgId',
    'OrgCode','DepartmentPath','Status','SubmittedBy','UpdatedAt','ManagerCCCD','ManagerReviewedAt'
  ]
};

function evaluationSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('EVALUATION_SPREADSHEET_ID');
  if (!id) throw new Error('Chưa khai báo EVALUATION_SPREADSHEET_ID trong Script Properties');
  return SpreadsheetApp.openById(id);
}

function evaluationSheet_() {
  var sh = evaluationSpreadsheet_().getSheetByName(EVAL_CONFIG.SHEET_DATA);
  if (!sh) throw new Error('Không tìm thấy sheet ' + EVAL_CONFIG.SHEET_DATA);
  return sh;
}

function evaluationMonth_(value) {
  var s = String(value || '').trim();
  var m = /^(0[1-9]|1[0-2])-(\d{4})$/.exec(s);
  if (!m) throw new Error('Tháng đánh giá phải có định dạng MM-YYYY');
  return { value:s, month:Number(m[1]), year:Number(m[2]) };
}

function evaluationWindow_(value, now) {
  var p = evaluationMonth_(value);
  var nextMonth = p.month === 12 ? 1 : p.month + 1;
  var nextYear = p.month === 12 ? p.year + 1 : p.year;
  var open = Utilities.formatString('%04d-%02d-%02d', p.year, p.month, EVAL_CONFIG.OPEN_DAY);
  var close = Utilities.formatString('%04d-%02d-%02d', nextYear, nextMonth, EVAL_CONFIG.CLOSE_DAY);
  var today = Utilities.formatDate(now || new Date(), EVAL_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  return {
    month:p.value, open_date:open, close_date:close, today:today,
    is_open:today >= open && today <= close,
    is_before:today < open,
    message:today < open
      ? 'Kỳ đánh giá tháng ' + p.value + ' mở từ ngày ' + dateVN_(open) + '.'
      : today > close
        ? 'Kỳ đánh giá tháng ' + p.value + ' đã đóng ngày ' + dateVN_(close) + '.'
        : 'Kỳ đánh giá mở đến hết ngày ' + dateVN_(close) + '.'
  };
}

function evaluationContext_(token) {
  var me = verify_(token);
  if (!me) return null;
  var scope = enterpriseScope_(me.cccd);
  var org = orgIndex_().map[me.org_id] || me.organization || null;
  return {
    employee:me, scope:scope, org:org,
    is_manager:scope.manager_org_ids.indexOf(me.org_id) >= 0 || isManager_(me.role),
    is_hr:scope.is_admin || scope.is_university_hr || scope.hr_org_ids.length > 0 || isHR_(me.role)
  };
}

function evaluationContextApi_(token) {
  var c = evaluationContext_(token);
  if (!c) return fail_('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  return ok_({
    found:true, hoTen:c.employee.name, donVi:c.employee.department,
    orgId:c.employee.org_id, cccd:c.employee.cccd,
    isManager:c.is_manager, isHR:c.is_hr, multiUnit:false,
    windowRule:'Từ ngày 25 của tháng đánh giá đến hết ngày 10 tháng kế tiếp',
    version:EVAL_CONFIG.VERSION
  });
}

function ensureEvaluationHeaders_(sh) {
  var current = sh.getRange(1, 1, 1, EVAL_CONFIG.HEADERS.length).getValues()[0];
  var changed = false;
  for (var i=0;i<EVAL_CONFIG.HEADERS.length;i++) if (current[i] !== EVAL_CONFIG.HEADERS[i]) { changed=true; break; }
  if (changed) sh.getRange(1, 1, 1, EVAL_CONFIG.HEADERS.length).setValues([EVAL_CONFIG.HEADERS]);
  sh.getRange(1,1,1,EVAL_CONFIG.HEADERS.length).setFontWeight('bold');
  sh.getRange(2,26,Math.max(sh.getMaxRows()-1,1),1).setNumberFormat('@');
}

function evaluationRows_() {
  var sh=evaluationSheet_(); ensureEvaluationHeaders_(sh);
  var last=sh.getLastRow();
  if(last<2)return{sheet:sh,rows:[]};
  var values=sh.getRange(2,1,last-1,EVAL_CONFIG.HEADERS.length).getValues();
  var rows=[];
  values.forEach(function(v,i){if(v[0]||v[1]||v[2])rows.push({row:i+2,v:v});});
  return{sheet:sh,rows:rows};
}

function evaluationPath_(orgId) {
  var idx=orgIndex_(), names=[], seen={}, id=orgId;
  while(id&&idx.map[id]&&!seen[id]){seen[id]=true;names.unshift(idx.map[id].name);id=idx.map[id].parent_id;}
  return names.join(' › ');
}

function evaluationView_(r) {
  var v=r.v;
  return {
    rowId:String(v[24]||''), evaluationId:String(v[24]||''), cccd:String(v[25]||''),
    orgId:String(v[26]||''), orgCode:String(v[27]||''), departmentPath:String(v[28]||''),
    thang:String(v[1]||''), hoTen:String(v[2]||''), donVi:String(v[3]||''),
    chiTiet:v.slice(4,21), tongDiem:v[18], xepLoai:String(v[19]||''),
    sepDiem:v[21], sepLoai:String(v[22]||''), sepGhiChu:String(v[23]||''),
    status:String(v[29]||'submitted')
  };
}

function evaluationFindSelf_(rows, cccd, orgId, month) {
  for(var i=0;i<rows.length;i++){
    var v=rows[i].v;
    if(String(v[25])===cccd&&String(v[26])===orgId&&String(v[1])===month)return rows[i];
  }
  return null;
}

function evaluationStatus_(token,d) {
  var c=evaluationContext_(token);if(!c)return fail_('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  var month=evaluationMonth_(d.month||d.assessmentMonth).value;
  var pack=evaluationRows_(), existing=evaluationFindSelf_(pack.rows,c.employee.cccd,c.employee.org_id,month);
  return ok_({exists:!!existing,window:evaluationWindow_(month),evaluation:existing?evaluationView_(existing):null});
}

function evaluationNumber_(value,name,min,max){var n=Number(value);if(!isFinite(n)||n<min||n>max)throw new Error(name+' không hợp lệ');return n;}

function evaluationSubmit_(token,d) {
  var c=evaluationContext_(token);if(!c)return fail_('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  var form=d.form||d, month=evaluationMonth_(form.assessmentMonth).value, win=evaluationWindow_(month);
  if(!win.is_open)return fail_(win.message+' Bạn không thể gửi đánh giá ngoài thời gian quy định.');
  var lock=LockService.getScriptLock();if(!lock.tryLock(15000))return fail_('Hệ thống đang xử lý yêu cầu khác. Vui lòng thử lại.');
  try{
    var pack=evaluationRows_();
    if(evaluationFindSelf_(pack.rows,c.employee.cccd,c.employee.org_id,month))return fail_('Bạn đã gửi đánh giá tháng '+month+'.');
    var v11=String(form.diem_1_1)==='0'?'Vi phạm':'Không vi phạm';
    var v12=String(form.diem_1_2)==='0'?'Vi phạm':'Không vi phạm';
    var v13=String(form.diem_1_3)==='0'?'Vi phạm':'Không vi phạm';
    var violated=v11==='Vi phạm'||v12==='Vi phạm'||v13==='Vi phạm';
    var keys=['diem_2_1','diem_2_2','diem_2_3','diem_2_4','diem_2_5','diem_3_1','diem_3_2','diem_3_3','diem_4_1','diem_4_2','diem_4_3'];
    var scores=[],total=0;
    keys.forEach(function(k){var n=violated?0:evaluationNumber_(form[k],k,0,30);scores.push(n);total+=n;});
    if(total>100)throw new Error('Tổng điểm không được vượt quá 100');
    var grade=violated?'C':total>90?'A+':total>=80?'A':total>=65?'B':'C';
    var note=String(form.extraContent||'').trim();if(grade==='A+'&&!note)throw new Error('Xếp loại A+ phải có nội dung công việc vượt định mức');
    var org=c.org||{},now=new Date(),id='EV-'+Utilities.getUuid();
    var row=[now,month,c.employee.name,org.name||c.employee.department,v11,v12,v13]
      .concat(scores).concat([total,grade,note,'','','',id,c.employee.cccd,c.employee.org_id,org.code||'',evaluationPath_(c.employee.org_id),'submitted',c.employee.cccd,now,'','']);
    pack.sheet.getRange(pack.sheet.getLastRow()+1,1,1,row.length).setValues([row]);
    log_('EVALUATION_SUBMIT',c.employee.cccd,id+'@'+month);
    return ok_({score:total.toFixed(1),grade:grade,evaluationId:id,message:'Đã gửi đánh giá tháng '+month+'.'});
  }finally{lock.releaseLock();}
}

function evaluationHistory_(token) {
  var c=evaluationContext_(token);if(!c)return fail_('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  var out=evaluationRows_().rows.filter(function(r){return String(r.v[25])===c.employee.cccd;}).map(evaluationView_);
  out.sort(function(a,b){return b.thang.slice(3)+b.thang.slice(0,2)-(a.thang.slice(3)+a.thang.slice(0,2));});
  return ok_({rows:out});
}

function evaluationAllowedOrgIds_(c,mode){
  if(c.scope.is_admin||c.scope.is_university_hr)return orgIndex_().rows.map(function(o){return o.id;});
  if(mode==='manager'&&c.scope.manager_org_ids.indexOf(c.employee.org_id)>=0)return[c.employee.org_id];
  return mode==='manager'?c.scope.manager_org_ids:c.scope.hr_org_ids;
}

function evaluationScopedData_(token,d,mode) {
  var c=evaluationContext_(token);if(!c)return fail_('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  if(mode==='manager'&&!c.is_manager)return fail_('Không có quyền đánh giá đơn vị');
  if(mode==='hr'&&!c.is_hr)return fail_('Không có quyền xem báo cáo nhân sự');
  var month=evaluationMonth_(d.month||d.selectedMonth).value,allowed=evaluationAllowedOrgIds_(c,mode);
  var out=evaluationRows_().rows.filter(function(r){return String(r.v[1])===month&&allowed.indexOf(String(r.v[26]))>=0;}).map(evaluationView_);
  out.sort(function(a,b){return a.departmentPath.localeCompare(b.departmentPath,'vi')||a.hoTen.localeCompare(b.hoTen,'vi');});
  return ok_({rows:out});
}

function evaluationManagerSave_(token,d) {
  var c=evaluationContext_(token);if(!c)return fail_('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  if(!c.is_manager&&!c.is_hr)return fail_('Không có quyền đánh giá');
  var list=d.evaluations;if(!Array.isArray(list)||!list.length)return fail_('Không có dữ liệu cần lưu');
  var allowed=c.is_hr?evaluationAllowedOrgIds_(c,'hr'):evaluationAllowedOrgIds_(c,'manager');
  var lock=LockService.getScriptLock();if(!lock.tryLock(15000))return fail_('Hệ thống đang xử lý yêu cầu khác. Vui lòng thử lại.');
  try{
    var pack=evaluationRows_(),byId={};pack.rows.forEach(function(r){byId[String(r.v[24])]=r;});var done=0,now=new Date();
    list.forEach(function(item){
      var r=byId[String(item.evaluationId||item.rowId||'')];if(!r||allowed.indexOf(String(r.v[26]))<0)throw new Error('Phiếu không tồn tại hoặc ngoài phạm vi quản lý');
      var score=evaluationNumber_(item.sepDiem,'Điểm trưởng đơn vị',0,100),grade=score>90?'A+':score>=80?'A':score>=65?'B':'C';
      pack.sheet.getRange(r.row,22,1,3).setValues([[score,grade,String(item.sepGhiChu||'')]]);
      pack.sheet.getRange(r.row,30,1,5).setValues([['manager_reviewed',r.v[30]||r.v[25],now,c.employee.cccd,now]]);done++;
    });
    log_('EVALUATION_MANAGER_SAVE',c.employee.cccd,'count='+done);return ok_({updated:done,message:'Đã lưu '+done+' kết quả đánh giá.'});
  }finally{lock.releaseLock();}
}

function evaluationExport_(token,d) {
  var result=evaluationScopedData_(token,d,'hr');if(!result.success)return result;
  var month=evaluationMonth_(d.month||d.selectedMonth).value,ss=evaluationSpreadsheet_(),name='BaoCao_'+month.replace('-','_'),old=ss.getSheetByName(name);
  if(old)ss.deleteSheet(old);var sh=ss.insertSheet(name),headers=['STT','CCCD','Họ và tên','Mã đơn vị','Đường dẫn đơn vị','Tháng','Tổng điểm','Tự xếp loại','Điểm TĐV','TĐV xếp loại','Ghi chú TĐV'];
  var values=[headers];result.rows.forEach(function(r,i){values.push([i+1,r.cccd,r.hoTen,r.orgCode,r.departmentPath,r.thang,r.tongDiem,r.xepLoai,r.sepDiem,r.sepLoai,r.sepGhiChu]);});
  sh.getRange(1,1,values.length,headers.length).setValues(values);sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#0f2557').setFontColor('#ffffff');sh.setFrozenRows(1);sh.getRange(2,2,Math.max(values.length-1,1),1).setNumberFormat('@');sh.autoResizeColumns(1,headers.length);
  return ok_({sheetName:name,total:result.rows.length,url:ss.getUrl()+'#gid='+sh.getSheetId(),message:'Đã xuất báo cáo.'});
}

/** Chạy một lần sau khi sao chép file Evaluation.gs vào Apps Script. */
function setupEvaluationSheetV3() {
  var sh=evaluationSheet_();ensureEvaluationHeaders_(sh);var ss=evaluationSpreadsheet_(),staff=ss.getSheetByName(EVAL_CONFIG.SHEET_STAFF);if(!staff)throw new Error('Không tìm thấy sheet '+EVAL_CONFIG.SHEET_STAFF);
  var staffValues=staff.getDataRange().getValues(),map={},idx=orgIndex_();
  for(var i=1;i<staffValues.length;i++){
    var unit=String(staffValues[i][0]||'').trim(),name=String(staffValues[i][1]||'').trim(),cccd=normalizeCCCD_(staffValues[i][2]),parent=String(staffValues[i][5]||'').trim();
    if(name&&unit)map[name+'|'+unit]={cccd:cccd,parent:parent};
  }
  var pack=evaluationRows_(),updated=0,errors=[];
  pack.rows.forEach(function(r){
    if(r.v[24]&&r.v[25]&&r.v[26])return;
    var key=String(r.v[2]||'').trim()+'|'+String(r.v[3]||'').trim(),person=map[key],candidates=idx.rows.filter(function(o){return o.name===String(r.v[3]||'').trim();}),org=null;
    if(person&&person.parent&&candidates.length>1){org=candidates.filter(function(o){var p=idx.map[o.parent_id];return p&&p.name===person.parent;})[0]||null;}else if(candidates.length===1)org=candidates[0];
    if(!person||!/^\d{12}$/.test(person.cccd)||!org){errors.push('Dòng '+r.row+': không ánh xạ được CCCD/đơn vị');return;}
    var status=r.v[22]?'manager_reviewed':'submitted',now=r.v[0]||new Date();
    sh.getRange(r.row,25,1,10).setValues([['EV-'+Utilities.getUuid(),person.cccd,org.id,org.code||'',evaluationPath_(org.id),status,person.cccd,now,'',r.v[22]?now:'']]);updated++;
  });
  return {success:errors.length===0,updated:updated,failed:errors.length,errors:errors.slice(0,30),version:EVAL_CONFIG.VERSION};
}
