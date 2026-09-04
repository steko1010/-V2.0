// ---------- API 封装 ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  // 401 自动跳登录
  if (res.status === 401 && !location.pathname.endsWith('/login.html')) {
    location.replace('/login.html?redirect=' + encodeURIComponent(location.pathname.split('/').pop() || 'index.html'));
    throw new Error('未登录');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) {
    throw new Error((data && data.message) || `请求失败 (${res.status})`);
  }
  return data;
}

const apiGet = (p) => api(p);
const apiPost = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body) });
const apiPut = (p, body) => api(p, { method: 'PUT', body: JSON.stringify(body) });
const apiDelete = (p, body) => api(p, { method: 'DELETE', body: body === undefined ? undefined : JSON.stringify(body) });

// ---------- 品类下拉库（统一 = 品类管理中维护的「物料中类」） ----------
let midCategoryPromise = null;
function loadMidCategories() {
  if (!midCategoryPromise) {
    midCategoryPromise = apiGet('/api/meta')
      .then((m) => (m && m.categories) || [])
      .catch(() => []);
  }
  return midCategoryPromise;
}
// 将某个 select 渲染为中类选项；placeholder 显示在空值 option（用于筛选/请选择）
async function renderCategoryOptions(id, placeholder) {
  const cats = await loadMidCategories();
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = `<option value="">${esc(placeholder || '请选择')}</option>`
    + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}
// 设置品类下拉的值；若值未在品类目录维护（历史数据），自动补一项以便回显/筛选
function setCategoryValue(id, val) {
  const sel = document.getElementById(id);
  if (!sel) return;
  if (val && ![...sel.options].some((o) => o.value === val)) {
    const o = document.createElement('option');
    o.value = val;
    o.textContent = val;
    sel.appendChild(o);
  }
  sel.value = val || '';
}

// ---------- Toast ----------
let toastTimer = null;
function toast(msg, type = 'info', duration = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + (type === 'error' ? 'error' : type === 'success' ? 'success' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, duration);
}

// ---------- 状态徽章 ----------
function statusBadge(status) {
  const cls = { '绿区': 'done', '黄区': 'test', '红区': 'dead' }[status] || '';
  return `<span class="badge ${cls}">${status || '-'}</span>`;
}

function docBadge(v) {
  const cls = { '有': 'doc-yes', '无': 'doc-no', '待补': 'doc-pending' }[v] || '';
  return `<span class="badge ${cls}">${v || '-'}</span>`;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(d) {
  if (!d) return '-';
  return d;
}

// 认证到期剩余天数（返回对象，用于看板/列表着色）
function expiryInfo(row) {
  if (!row.cert_expire_date) return null;
  const today = new Date();
  const exp = new Date(row.cert_expire_date + 'T00:00:00');
  const days = Math.ceil((exp - today) / 86400000);
  return { days, expired: days < 0, expiring: days >= 0 && days <= 90 };
}

function expiryBadge(row) {
  const info = expiryInfo(row);
  if (!info) return '<span class="badge">-</span>';
  if (row.status !== '绿区') return `<span class="badge">${row.cert_expire_date}</span>`;
  if (info.expired) return `<span class="badge badge-danger">已过期 ${Math.abs(info.days)}天</span>`;
  if (info.expiring) return `<span class="badge badge-warn">${info.days}天后到期</span>`;
  return `<span class="badge">${row.cert_expire_date}</span>`;
}

// ---------- 通用 批量导入 / 导出 ----------
let BATCH_CFG = null;
let batchImportRows = [];

// 动态加载 SheetJS（优先本地静态库，缺失时回退 CDN，避免内网无法解析 Excel）
function loadXlsxLib() {
  return new Promise((resolve) => {
    if (typeof XLSX !== 'undefined') return resolve(true);
    const s = document.createElement('script');
    s.src = 'js/vendor/xlsx.full.min.js';
    s.onload = () => resolve(true);
    s.onerror = () => {
      const s2 = document.createElement('script');
      s2.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s2.onload = () => resolve(true);
      s2.onerror = () => resolve(false);
      document.head.appendChild(s2);
    };
    document.head.appendChild(s);
  });
}

// 初始化批量导入/导出：cfg = { api, entity, fields:[[label, field],...], requiredLabel, refresh }
function setupBatchImport(cfg) {
  BATCH_CFG = cfg;
  if (!document.getElementById('batchImportModal')) buildBatchImportModal();
}

function buildBatchImportModal() {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.id = 'batchImportModal';
  mask.innerHTML = `
    <div class="modal modal-lg">
      <div class="modal-head">
        <h3 id="batchImportTitle">批量导入${BATCH_CFG ? '「' + BATCH_CFG.entity + '」' : ''}</h3>
        <button class="modal-close" onclick="closeModal('batchImportModal')">×</button>
      </div>
      <div class="modal-body">
        <div class="import-tip" id="batchImportTip"></div>
        <div class="toolbar">
          <input type="file" id="batchImportFile" accept=".xlsx,.xls,.csv" class="search-input" style="flex:1; min-width:220px;">
          <button class="btn" onclick="downloadBatchTemplate()">⬇ 下载模板</button>
          <button class="btn btn-primary" onclick="parseBatchImportExcel()">解析预览</button>
        </div>
        <div class="table-wrap" id="batchImportPreviewWrap" style="display:none; max-height:320px; overflow:auto;">
          <table class="data-table">
            <thead id="batchImportPreviewHead"></thead>
            <tbody id="batchImportPreviewBody"></tbody>
          </table>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" onclick="closeModal('batchImportModal')">取消</button>
        <button class="btn btn-primary" id="btnConfirmBatchImport" onclick="confirmBatchImport()" disabled>确认导入</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  const tip = mask.querySelector('#batchImportTip');
  if (tip && BATCH_CFG) {
    const reqTip = BATCH_CFG.requiredLabel
      ? `第一行为表头，需包含 <b>${BATCH_CFG.requiredLabel}</b>（必填）`
      : '第一行为表头，所有列均为选填';
    tip.innerHTML = `支持 .xlsx / .xls / .csv 文件。${reqTip}；列名可参考下载模板，多余列将忽略。`;
  }
}

function openBatchImportModal() {
  if (!BATCH_CFG) return;
  // 每次打开清空上次状态
  batchImportRows = [];
  const file = document.getElementById('batchImportFile');
  if (file) file.value = '';
  const wrap = document.getElementById('batchImportPreviewWrap');
  if (wrap) { wrap.style.display = 'none'; wrap.querySelector('tbody').innerHTML = ''; }
  const btn = document.getElementById('btnConfirmBatchImport');
  if (btn) btn.disabled = true;
  openModal('batchImportModal');
}

function downloadBatchTemplate() {
  if (!BATCH_CFG) return;
  loadXlsxLib().then((ok) => {
    if (!ok) { toast('Excel 解析库加载失败，请检查网络后刷新', 'error'); return; }
    const headers = BATCH_CFG.fields.map(([label]) => label);
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(12, Math.min(30, String(h).length * 2 + 4)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '导入模板');
    XLSX.writeFile(wb, `${BATCH_CFG.entity}导入模板.xlsx`);
  });
}

function parseBatchImportExcel() {
  const file = document.getElementById('batchImportFile').files[0];
  if (!file) { toast('请先选择 Excel 文件', 'error'); return; }
  loadXlsxLib().then((ok) => {
    if (!ok) { toast('Excel 解析库加载失败，请检查网络后刷新', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
        if (!grid.length) { toast('文件中没有数据', 'error'); return; }
        // 表头 -> 字段映射（支持列名 / 字段名，忽略空格与大小写差异）
        const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, '');
        const map = {};
        BATCH_CFG.fields.forEach(([label, field]) => {
          map[norm(label)] = field;
          map[norm(field)] = field;
        });
        const headRow = (grid[0] || []).map((c) => norm(c));
        const idx = BATCH_CFG.fields.map(([label, field]) => headRow.findIndex((h) => map[h] === field));
        const headers = BATCH_CFG.fields.map(([label, field], i) => idx[i] >= 0 ? label : `${label} *`);
        const data = [];
        for (let r = 1; r < grid.length; r++) {
          const row = grid[r] || [];
          if (!row.length || row.every((c) => String(c == null ? '' : c).trim() === '')) continue;
          const item = {};
          BATCH_CFG.fields.forEach(([label, field], i) => {
            const j = idx[i];
            item[field] = (j >= 0 && row[j] != null) ? String(row[j]).trim() : '';
          });
          data.push(item);
        }
        batchImportRows = data;
        if (!data.length) { toast('表格内容为空，仅表头无数据行', 'error'); return; }
        // 预览（前 20 行）
        const head = document.getElementById('batchImportPreviewHead');
        const body = document.getElementById('batchImportPreviewBody');
        head.innerHTML = headers.map((h) => `<th>${esc(h)}</th>`).join('');
        const show = data.slice(0, 20);
        body.innerHTML = show.map((it) => `<tr>${BATCH_CFG.fields.map(([label, field]) => `<td>${esc(it[field]) || '-'}</td>`).join('')}</tr>`).join('');
        document.getElementById('batchImportPreviewWrap').style.display = 'block';
        document.getElementById('btnConfirmBatchImport').disabled = false;
        toast(`解析出 ${data.length} 行数据${data.length > 20 ? '（预览前 20 行）' : ''}`, 'success');
      } catch (err) {
        toast('解析失败：' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function confirmBatchImport() {
  if (!batchImportRows.length) { toast('没有可导入的数据', 'error'); return; }
  const btn = document.getElementById('btnConfirmBatchImport');
  btn.disabled = true;
  apiPost('/api/' + BATCH_CFG.api + '/batch', { items: batchImportRows })
    .then((res) => {
      const errN = (res.errors || []).length;
      if (errN) {
        // 展示具体失败原因（服务端逐行返回），便于用户修正文件
        const head = (res.errors || []).slice(0, 5).map((er) => {
          const line = er.rowIndex ? `第 ${er.rowIndex} 行` : '';
          const rowName = BATCH_CFG.fields
            .map(([label, field]) => er.row && er.row[field] ? `${label}「${er.row[field]}」` : '')
            .filter(Boolean).slice(0, 1).join('');
          return `${line}${rowName}：${er.message}`;
        }).join('；');
        const more = errN > 5 ? `，另有 ${errN - 5} 条同类错误` : '';
        toast(`成功导入 ${res.success} 条，失败 ${errN} 条。${head}${more}`, 'error', 8000);
      } else {
        toast(`成功导入 ${res.success} 条`, 'success');
      }
      closeModal('batchImportModal');
      if (typeof BATCH_CFG.refresh === 'function') BATCH_CFG.refresh();
    })
    .catch((e) => {
      toast(e.message, 'error');
      btn.disabled = false;
    });
}

// 批量导出（模板列 = 展示列表表头）
function exportBatchData() {
  if (!BATCH_CFG) return;
  const btn = event && event.target;
  if (btn) btn.disabled = true;
  fetch('/api/' + BATCH_CFG.api + '/export')
    .then((r) => { if (!r.ok) throw new Error('导出失败'); return r.blob(); })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${BATCH_CFG.entity}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('导出成功', 'success');
    })
    .catch((e) => toast(e.message, 'error'))
    .finally(() => { if (btn) btn.disabled = false; });
}

// ---------- 弹窗工具 ----------
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// ---------- 通用确认对话框（替代原生 confirm；规避 iframe 沙箱/内嵌预览禁用 confirm 导致点击无反应的问题） ----------
function confirmDialog(message, title = '请确认') {
  return new Promise((resolve) => {
    let mask = document.getElementById('confirmDialogMask');
    if (!mask) {
      mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.id = 'confirmDialogMask';
      mask.innerHTML = `
        <div class="modal" style="max-width:420px">
          <div class="modal-head">
            <h3 id="confirmDialogTitle"></h3>
            <button class="modal-close" type="button" id="confirmDialogX" aria-label="关闭">×</button>
          </div>
          <div class="modal-body">
            <div id="confirmDialogMsg"></div>
          </div>
          <div class="modal-foot">
            <button class="btn" type="button" id="confirmDialogCancel">取消</button>
            <button class="btn btn-danger" type="button" id="confirmDialogOk">确定</button>
          </div>
        </div>`;
      document.body.appendChild(mask);
      mask._finish = (v) => {
        mask.classList.remove('show');
        if (mask._resolve) { const r = mask._resolve; mask._resolve = null; r(v); }
      };
      mask.addEventListener('click', (e) => { if (e.target === mask) mask._finish(false); });
      mask.querySelector('#confirmDialogCancel').addEventListener('click', () => mask._finish(false));
      mask.querySelector('#confirmDialogX').addEventListener('click', () => mask._finish(false));
      mask.querySelector('#confirmDialogOk').addEventListener('click', () => mask._finish(true));
    }
    mask._resolve = resolve;
    mask.classList.add('show');
    document.getElementById('confirmDialogTitle').textContent = title;
    document.getElementById('confirmDialogMsg').innerHTML = esc(message).replace(/\n/g, '<br>');
    const okBtn = document.getElementById('confirmDialogOk');
    if (okBtn && okBtn.focus) okBtn.focus();
  });
}

// 供按钮/快捷键关闭确认框：result 为 true(确定)/false(取消)
function closeConfirmDialog(result) {
  const mask = document.getElementById('confirmDialogMask');
  if (mask && mask._finish) mask._finish(!!result);
}

// ---------- 当前用户与权限 ----------
window.currentUser = null;

function hasPerm(code) {
  const u = window.currentUser;
  if (!u) return false;
  if (u.isSuper) return true;
  return (u.permissions || []).includes(code);
}

// 按钮权限渲染：data-permission="action:edit" / 多权限用空格分隔（OR 关系）
// 动态渲染的按钮每次 DOM 更新后也会自动重新应用；仅隐藏无权元素，恢复时还原原状态
function applyPermissions() {
  document.querySelectorAll('[data-permission]').forEach((el) => {
    const codes = (el.dataset.permission || '').split(/\s+/).filter(Boolean);
    if (!codes.length) return;
    const ok = codes.some((c) => hasPerm(c));
    if (!ok) {
      el.style.display = 'none';
      el.classList.add('perm-hidden');
    } else if (el.classList.contains('perm-hidden')) {
      el.style.display = '';
      el.classList.remove('perm-hidden');
    }
  });
}

// 页面文件 -> 所需菜单权限码
const PAGE_PERM_MAP = {
  'index.html': 'page:index',
  'prestudy.html': 'page:prestudy',
  'selection.html': 'page:selection',
  'audits.html': 'page:audits',
  'projects.html': 'page:projects',
  'suppliers.html': 'page:suppliers',
  'qcps.html': 'page:qcps',
  'admin.html': 'page:admin',
};
// 侧边栏显示顺序：用于"无当前页权限时跳转到首个可访问页面"
const PAGE_MENU_ORDER = [
  ['page:index', 'index.html'],
  ['page:prestudy', 'prestudy.html'],
  ['page:selection', 'selection.html'],
  ['page:audits', 'audits.html'],
  ['page:projects', 'projects.html'],
  ['page:suppliers', 'suppliers.html'],
  ['page:qcps', 'qcps.html'],
  ['page:admin', 'admin.html'],
];
function firstAccessiblePage() {
  const hit = PAGE_MENU_ORDER.find(([code]) => hasPerm(code));
  return hit ? hit[1] : null; // null = 没有任何可访问的菜单页面
}

// 侧边栏菜单显隐：每个导航项按 data-menu 对应的权限码控制；
// 角色勾选了哪个菜单权限，侧边栏就只显示对应模块入口（超管自动放行）
function applyMenuPermissions() {
  document.querySelectorAll('[data-menu]').forEach((el) => {
    const code = el.dataset.menu;
    if (code && !hasPerm(code)) el.style.display = 'none';
  });
}

// 在侧边栏底部注入当前用户与注销按钮
function injectUserBar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || document.getElementById('userBar')) return;
  const u = window.currentUser;
  if (!u) return;
  const bar = document.createElement('div');
  bar.id = 'userBar';
  bar.className = 'user-bar';
  bar.innerHTML = `
    <div class="ub-info">
      <div class="ub-name" title="${esc(u.username)}">${esc(u.display_name || u.username)}</div>
      <div class="ub-roles">${esc((u.roles || []).map((r) => r.name).join(' / ') || (u.isSuper ? '超级管理员' : '用户'))}</div>
    </div>
    <button class="btn btn-sm ub-logout" id="btnLogout">注销</button>
  `;
  sidebar.appendChild(bar);
  document.getElementById('btnLogout').addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    location.replace('/login.html');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-mask').forEach((mask) => {
    mask.addEventListener('click', (e) => {
      if (e.target === mask) mask.classList.remove('show');
    });
  });
  document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.modal-mask').classList.remove('show'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const cm = document.getElementById('confirmDialogMask');
    if (cm && cm.classList.contains('show')) {
      if (cm._finish) cm._finish(false);
      return;
    }
    document.querySelectorAll('.modal-mask.show').forEach((m) => m.classList.remove('show'));
  });

  // 左侧分组导航：点击组标题展开 / 收起
  document.querySelectorAll('.nav-group-title').forEach((title) => {
    title.addEventListener('click', () => {
      title.closest('.nav-group').classList.toggle('collapsed');
    });
  });

  // 鉴权：拉取当前登录用户
  if (!location.pathname.endsWith('/login.html')) {
    fetch('/api/me')
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('unauth')))
      .then((data) => {
        window.currentUser = data.user;
        injectUserBar();
        applyMenuPermissions();
        applyPermissions();
        // 页面级守卫：按当前页面所需菜单权限校验，无权限则跳转到首个可访问页面
        const page = location.pathname.split('/').pop() || 'index.html';
        if (PAGE_PERM_MAP[page] && !hasPerm(PAGE_PERM_MAP[page])) {
          const target = firstAccessiblePage();
          location.replace(target || '/login.html');
          return;
        }
      })
      .catch(() => {
        location.replace('/login.html?redirect=' + encodeURIComponent(location.pathname.split('/').pop() || 'index.html'));
      });
  }

  // 动态表格行内按钮（编辑/删除等 data-permission）：每次 DOM 更新后自动应用操作权限显隐
  if (typeof MutationObserver !== 'undefined') {
    const permObserver = new MutationObserver(() => applyPermissions());
    permObserver.observe(document.body, { childList: true, subtree: true });
  }
});
