/**
 * ONE-TIME MIGRATION: Google Sheets -> Supabase
 * SpreadsheetApp is intentionally isolated in this file.
 *
 * Before running:
 * 1) Run schema.sql in Supabase.
 * 2) Set Script Properties: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *    SPREADSHEET_ID and MIGRATION_ADMIN_KEY.
 * 3) Run previewMigration(), then runMigrationOnce().
 */

function previewMigration() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Chưa cấu hình SPREADSHEET_ID');
  var ss = SpreadsheetApp.openById(id);
  var result = {
    employees: sheetRows_(ss, CONFIG.LEGACY_SHEETS.EMPLOYEES).length,
    leave_requests: sheetRows_(ss, CONFIG.LEGACY_SHEETS.LEAVE_REQUESTS).length,
    holiday_settings: sheetRows_(ss, CONFIG.LEGACY_SHEETS.HOLIDAY_SETTINGS).length,
    audit_logs: sheetRows_(ss, CONFIG.LEGACY_SHEETS.LOGS).length
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function runMigrationOnce() {
  var p = PropertiesService.getScriptProperties();
  var adminKey = p.getProperty('MIGRATION_ADMIN_KEY');
  if (!adminKey) throw new Error('Chưa cấu hình MIGRATION_ADMIN_KEY');
  var result = migrateSheetsToSupabase('', { admin_key:adminKey });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function migrateSheetsToSupabase(token, d) {
  var p = PropertiesService.getScriptProperties();
  if (!d || d.admin_key !== p.getProperty('MIGRATION_ADMIN_KEY')) return fail_('MIGRATION_ADMIN_KEY không hợp lệ');
  var id = p.getProperty('SPREADSHEET_ID');
  if (!id) return fail_('Chưa cấu hình SPREADSHEET_ID');
  var ss = SpreadsheetApp.openById(id);
  var result = {
    employees: migrateEmployees_(ss),
    leave_requests: migrateRequests_(ss),
    holiday_settings: migrateHolidays_(ss),
    audit_logs: migrateLogs_(ss)
  };
  return ok_({message:'Migrate hoàn tất', result:result});
}

function sheetRows_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values.shift().map(function(x) { return String(x).trim().toLowerCase(); });
  return values.filter(function(row) {
    return row.some(function(x) { return x !== ''; });
  }).map(function(row) {
    var obj = {};
    headers.forEach(function(key, i) { obj[key] = row[i]; });
    return obj;
  });
}

function migrateEmployees_(ss) {
  var rows = sheetRows_(ss, CONFIG.LEGACY_SHEETS.EMPLOYEES).map(function(r) {
    return {cccd:normalizeCCCD_(r.cccd), name:r.name, department:r.department, role:r.role,
      email:r.email || '', start_date:dateISO_(r.start_date)};
  });
  batchUpsert_('employees', rows, 200);
  return rows.length;
}

function migrateRequests_(ss) {
  var rows = sheetRows_(ss, CONFIG.LEGACY_SHEETS.LEAVE_REQUESTS).map(function(r) {
    return {id:String(r.id), cccd:normalizeCCCD_(r.cccd || r.employee_id), employee_name:r.employee_name,
      department:r.department, from_date:dateISO_(r.from_date), to_date:dateISO_(r.to_date),
      days:Number(r.days) || 0, reason:r.reason || '', status:r.status || 'pending',
      approver_cccd:normalizeNullableCCCD_(r.approver_cccd || r.approver_id), approver_note:r.approver_note || '',
      hr_cccd:normalizeNullableCCCD_(r.hr_cccd || r.hr_confirm), hr_note:r.hr_note || '',
      created_at:isoDateTime_(r.created_at), updated_at:isoDateTime_(r.updated_at), attachment:r.attachment || '',
      history:jsonValue_(r.history, []), half_day:r.half_day || 'none', return_info:jsonValue_(r.return_info, null)};
  });
  batchUpsert_('leave_requests', rows, 100);
  return rows.length;
}

function migrateHolidays_(ss) {
  var rows = sheetRows_(ss, CONFIG.LEGACY_SHEETS.HOLIDAY_SETTINGS).map(function(r) {
    return {year:Number(r.year), type:r.type, from_date:dateISO_(r.from_date), to_date:dateISO_(r.to_date),
      note:r.note || '', created_by:normalizeNullableCCCD_(r.created_by), created_at:isoDateTime_(r.created_at)};
  });
  batchUpsert_('holiday_settings', rows, 200);
  return rows.length;
}

function migrateLogs_(ss) {
  var rows = sheetRows_(ss, CONFIG.LEGACY_SHEETS.LOGS).map(function(r) {
    return {created_at:isoDateTime_(r.timestamp || r.created_at), action:r.action || '',
      cccd:normalizeNullableCCCD_(r.user_id || r.cccd), detail:r.detail || ''};
  });
  batchInsert_('audit_logs', rows, 200);
  return rows.length;
}

function batchUpsert_(table, rows, size) {
  for (var i = 0; i < rows.length; i += size) insert_(table, rows.slice(i, i + size), true);
}

function batchInsert_(table, rows, size) {
  for (var i = 0; i < rows.length; i += size) insert_(table, rows.slice(i, i + size), false);
}
