(function () {
  'use strict';

  const METHOD_MAP = {
    verifyUser: 'evaluation-context',
    checkDoubleEntry: 'evaluation-status',
    saveData: 'evaluation-submit',
    getUserHistory: 'evaluation-history',
    getStaffData: 'evaluation-unit-data',
    updateManagerEvaluations: 'evaluation-manager-save',
    getAllStaffData: 'evaluation-hr-data',
    exportReport: 'evaluation-export'
  };

  function token() { return localStorage.getItem('hrm_token') || ''; }

  function formToObject(form) {
    if (!form || !(form instanceof HTMLFormElement)) return form || {};
    const out = {};
    new FormData(form).forEach((value, key) => { out[key] = value; });
    return out;
  }

  async function call(method, args) {
    const action = METHOD_MAP[method];
    if (!action) throw new Error('Phương thức không được hỗ trợ: ' + method);
    const payload = { action, token: token() };
    if (method === 'checkDoubleEntry') payload.month = args[1];
    if (method === 'saveData') payload.form = formToObject(args[0]);
    if (method === 'getStaffData' || method === 'getAllStaffData' || method === 'exportReport') payload.month = args[1] || args[0];
    if (method === 'updateManagerEvaluations') payload.evaluations = args[0];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch('/api/apps-script', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal
      });
    } finally { clearTimeout(timeout); }
    const result = await response.json().catch(() => ({ success:false, message:'Máy chủ trả về dữ liệu không hợp lệ' }));
    if (!response.ok) throw new Error(result.message || ('Lỗi máy chủ ' + response.status));
    if (method === 'verifyUser') return result.success ? result : { found:false, message:result.message };
    if (method === 'checkDoubleEntry') {
      if (!result.success) throw new Error(result.message);
      window.__evaluationWindow = result.window;
      return !!result.exists;
    }
    if (method === 'getUserHistory' || method === 'getStaffData' || method === 'getAllStaffData') {
      if (!result.success) throw new Error(result.message);
      return result.rows || [];
    }
    return result;
  }

  function runner(success, failure) {
    return new Proxy({}, {
      get(_target, prop) {
        if (prop === 'withSuccessHandler') return fn => runner(fn, failure);
        if (prop === 'withFailureHandler') return fn => runner(success, fn);
        return (...args) => call(String(prop), args).then(
          value => { if (success) success(value); },
          error => { if (failure) failure(error.message || String(error)); else console.error(error); }
        );
      }
    });
  }

  window.google = { script: {} };
  Object.defineProperty(window.google.script, 'run', { get: () => runner(null, null) });

  window.evaluationPortalStart = function () {
    const saved = JSON.parse(localStorage.getItem('hrm_user') || 'null');
    const input = document.getElementById('cccd_input');
    if (!token() || !saved) {
      if (input) { input.value = ''; input.placeholder = 'Vui lòng đăng nhập tại Sổ tay HRM'; input.disabled = true; }
      const group = document.getElementById('login-input-group');
      if (group) group.innerHTML = '<p style="text-align:center;color:#b91c1c;margin-bottom:14px">Phiên đăng nhập không tồn tại hoặc đã hết hạn.</p><button class="btn btn-primary" onclick="location.href=\'/\'">Về trang đăng nhập HRM</button>';
      return;
    }
    if (input) { input.value = saved.cccd || ''; input.readOnly = true; }
    handleVerify();
  };
})();
