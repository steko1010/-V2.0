// ================= 选型：物料汇总表 / 供应商选型 / 看板 =================

function gradeStatusBadge(s) {
  const cls = { '合作中': 'done', '暂停': 'doc-pending', '淘汰': 'dead' }[s] || '';
  return `<span class="badge ${cls}">${esc(s || '-')}</span>`;
}

let state = {
  page: 1,
  pageSize: 10,
  keyword: '',
  category: '',
  status: '',
  supplier: '',
  total: 0,
  editingId: null,
  meta: { statuses: [], docStatuses: [], categories: [], suppliers: [] },
};
let lastCheck = null;
const charts = {};
let chartsInited = false;
const STATUS_COLORS = {
  '绿区': '#10b981', '黄区': '#f59e0b', '红区': '#ef4444',
};

// ---------- 子界面 Tab 切换 ----------
function switchTab(name) {
  document.querySelectorAll('.sub-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.sub-panel').forEach((p) => {
    p.classList.toggle('active', p.id === 'panel-' + name);
  });
  // 看板面板隐藏时无法初始化图表，切到该面板时才初始化 / 重绘
  if (name === 'board') {
    if (!chartsInited) initCharts();
    else Object.values(charts).forEach((c) => c && c.resize());
    loadStats();
    loadSupplierBoard();
  }
}

function refreshBoard() {
  loadStats();
  loadSupplierBoard();
}

// ---------- 物料汇总表 ----------
async function loadMeta() {
  try {
    state.meta = await apiGet('/api/meta');
    fillSelect('filterStatus', state.meta.statuses, '全部状态');
    fillSelect('filterCategory', state.meta.categories, '全部分类');
    fillSelect('filterSupplier', state.meta.suppliers, '全部供应商');
    fillSelect('f_status', state.meta.statuses);
    const supList = document.getElementById('supList');
    supList.innerHTML = state.meta.suppliers.map((s) => `<option value="${esc(s)}">`).join('');
    if (state.meta.statuses.length) {
      document.getElementById('f_status').value = state.meta.statuses[0];
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

function fillSelect(id, options, placeholder) {
  const el = document.getElementById(id);
  const opts = options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  el.innerHTML = (placeholder ? `<option value="">${esc(placeholder)}</option>` : '') + opts;
}

async function loadMaterials() {
  const params = new URLSearchParams({
    page: state.page,
    pageSize: state.pageSize,
    keyword: state.keyword,
    category: state.category,
    status: state.status,
    supplier: state.supplier,
  });
  try {
    const data = await apiGet('/api/materials?' + params.toString());
    state.total = data.total;
    renderTable(data.items);
    renderPagination();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderTable(items) {
  window.__pageItems = items;
  const body = document.getElementById('tableBody');
  const empty = document.getElementById('emptyBox');
  const table = document.getElementById('materialTable');
  if (!items.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    table.style.display = 'none';
    const allCb = document.getElementById('selMatCheckAll');
    if (allCb) allCb.checked = false;
    return;
  }
  empty.style.display = 'none';
  table.style.display = '';
  body.innerHTML = items.map((r) => `
    <tr>
      <td><input type="checkbox" class="selmat-check" value="${r.id}"></td>
      <td class="code-cell">${esc(r.code)}</td>
      <td><b>${esc(r.name)}</b></td>
      <td>${esc(r.model)}</td>
      <td>${esc(r.category)}</td>
      <td>${esc(r.supplier)}</td>
      <td>${statusBadge(r.status)}</td>
      <td class="actions">
        <button class="btn btn-sm" data-permission="action:edit" onclick="editMaterial(${r.id})">编辑</button>
        <button class="btn btn-sm btn-danger" data-permission="action:delete" onclick="deleteMaterial(${r.id})">删除</button>
      </td>
    </tr>`).join('');
  const allCb = document.getElementById('selMatCheckAll');
  if (allCb) allCb.checked = false;
}

// ---------- 批量删除（选型物料汇总表） ----------
function toggleSelMatAll(cb) {
  document.querySelectorAll('#tableBody .selmat-check').forEach((x) => { x.checked = cb.checked; });
}

async function batchDeleteMaterials() {
  const ids = [...document.querySelectorAll('#tableBody .selmat-check:checked')].map((x) => parseInt(x.value, 10));
  if (!ids.length) return toast('请先勾选要删除的物料', 'error');
  if (!await confirmDialog(`确定删除选中的 ${ids.length} 条物料？删除后不可恢复。`)) return;
  const allCb = document.getElementById('selMatCheckAll');
  let ok = 0;
  try {
    for (const id of ids) {
      const res = await fetch(`/api/materials/${id}`, { method: 'DELETE' });
      if (res.ok) ok++;
    }
    if (allCb) allCb.checked = false;
    toast(`已删除 ${ok} 条`, ok === ids.length ? 'success' : 'error');
    loadMaterials();
    loadMeta();
  } catch (e) { toast(e.message, 'error'); }
}

function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  const el = document.getElementById('pagination');
  if (state.total === 0) { el.innerHTML = ''; return; }
  const pages = [];
  const push = (p, label, cls = '') => pages.push(`<button class="${cls}" ${p === state.page ? '' : `onclick="goPage(${p})"`}>${label}</button>`);
  push(1, '«');
  const start = Math.max(2, state.page - 2);
  const end = Math.min(totalPages - 1, state.page + 2);
  for (let i = start; i <= end; i++) push(i, i, i === state.page ? 'current' : '');
  push(totalPages, '»');
  el.innerHTML = `
    <span>共 ${state.total} 条 · 第 ${state.page}/${totalPages} 页</span>
    ${pages.join('')}`;
}

function goPage(p) { state.page = p; loadMaterials(); }

function applyFilters() {
  state.keyword = document.getElementById('keyword').value.trim();
  state.category = document.getElementById('filterCategory').value;
  state.status = document.getElementById('filterStatus').value;
  state.supplier = document.getElementById('filterSupplier').value;
  state.page = 1;
  loadMaterials();
}

function resetFilters() {
  document.getElementById('keyword').value = '';
  document.getElementById('filterCategory').value = '';
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterSupplier').value = '';
  state.keyword = state.category = state.status = state.supplier = '';
  state.page = 1;
  loadMaterials();
}

function editMaterial(id) {
  const row = (window.__pageItems || []).find((r) => r.id === id);
  if (!row) { toast('物料不存在', 'error'); return; }
  state.editingId = id;
  document.getElementById('modalTitle').textContent = '编辑物料';
  fillForm(row);
  openModal('editModal');
}

function fillForm(row) {
  const map = {
    f_name: 'name', f_supplier: 'supplier', f_model: 'model', f_status: 'status',
  };
  for (const [id, key] of Object.entries(map)) {
    document.getElementById(id).value = row[key] || '';
  }
}

function openAdd() {
  state.editingId = null;
  document.getElementById('modalTitle').textContent = '新增物料';
  for (const id of ['f_name', 'f_supplier', 'f_model']) {
    document.getElementById(id).value = '';
  }
  document.getElementById('f_status').value = state.meta.statuses[0] || '黄区';
  openModal('editModal');
}

function collectForm() {
  const map = {
    name: 'f_name', supplier: 'f_supplier', model: 'f_model', status: 'f_status',
  };
  const out = {};
  for (const [key, id] of Object.entries(map)) out[key] = document.getElementById(id).value.trim();
  return out;
}

async function saveMaterial() {
  const data = collectForm();
  if (!data.name) { toast('物料品类不能为空', 'error'); return; }
  try {
    if (state.editingId) {
      await apiPut(`/api/materials/${state.editingId}`, data);
      toast('已保存', 'success');
    } else {
      await apiPost('/api/materials', data);
      toast('新增成功', 'success');
      state.page = 1;
    }
    closeModal('editModal');
    loadMaterials();
    loadMeta();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteMaterial(id) {
  const ok = await confirmDialog('确定删除该物料吗？删除后不可恢复。');
  if (!ok) return;
  try {
    await apiDelete(`/api/materials/${id}`);
    toast('已删除', 'success');
    loadMaterials();
    loadMeta();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- 供应商选型 ----------
const candState = { page: 1, pageSize: 10, keyword: '', category: '', status: '', total: 0 };
let candAll = [];

async function loadCandidateSuppliers() {
  try {
    const data = await apiGet('/api/suppliers');
    candAll = data.items || [];
    await fillCandidateFilters();
    renderCandidates();
  } catch (e) { toast(e.message, 'error'); }
}

async function fillCandidateFilters() {
  // 供应商选型的“物料品类”筛选与品类管理中类库保持一致（额外带上已在用的历史品类）
  const cats = await loadMidCategories();
  const extra = [...new Set(candAll.map((s) => s.material_type).filter(Boolean))].filter((c) => !cats.includes(c));
  fillSelect('csCategory', [...cats, ...extra], '全部物料品类');
  const stats = [...new Set(candAll.map((s) => s.status).filter(Boolean))].sort();
  fillSelect('csStatus', stats, '全部状态');
}

function filteredCandidates() {
  const kw = candState.keyword.toLowerCase();
  return candAll.filter((s) => {
    if (candState.category && s.material_type !== candState.category) return false;
    if (candState.status && s.status !== candState.status) return false;
    if (kw && !String(s.name || '').toLowerCase().includes(kw)) return false;
    return true;
  });
}

function renderCandidates() {
  const list = filteredCandidates();
  candState.total = list.length;
  const totalPages = Math.max(1, Math.ceil(list.length / candState.pageSize));
  candState.page = Math.min(candState.page, totalPages);
  const slice = list.slice((candState.page - 1) * candState.pageSize, candState.page * candState.pageSize);
  const body = document.getElementById('candidateBody');
  const empty = document.getElementById('candidateEmpty');
  const table = document.getElementById('candidateTable');
  if (!slice.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    table.style.display = 'none';
  } else {
    empty.style.display = 'none';
    table.style.display = '';
    body.innerHTML = slice.map((s) => `
      <tr>
        <td><b>${esc(s.name)}</b></td>
        <td>${esc(s.material_type) || '-'}</td>
        <td>${gradeStatusBadge(s.status)}</td>
        <td class="spec" title="${esc(s.address)}">${esc(s.address) || '-'}</td>
        <td class="spec" title="${esc(s.product_type)}">${esc(s.product_type) || '-'}</td>
      </tr>`).join('');
  }
  renderCandidatePager();
}

function renderCandidatePager() {
  const totalPages = Math.max(1, Math.ceil(candState.total / candState.pageSize));
  const el = document.getElementById('candidatePager');
  if (!candState.total) { el.innerHTML = ''; return; }
  const pages = [];
  const push = (p, label, cls = '') => pages.push(`<button class="${cls}" ${p === candState.page ? '' : `onclick="goCandidatePage(${p})"`}>${label}</button>`);
  push(1, '«');
  const start = Math.max(2, candState.page - 2);
  const end = Math.min(totalPages - 1, candState.page + 2);
  for (let i = start; i <= end; i++) push(i, i, i === candState.page ? 'current' : '');
  push(totalPages, '»');
  el.innerHTML = `
    <span>共 ${candState.total} 条 · 第 ${candState.page}/${totalPages} 页</span>
    ${pages.join('')}`;
}

function goCandidatePage(p) { candState.page = p; renderCandidates(); }

function applyCandidateFilters() {
  candState.keyword = document.getElementById('csKeyword').value.trim();
  candState.category = document.getElementById('csCategory').value;
  candState.status = document.getElementById('csStatus').value;
  candState.page = 1;
  renderCandidates();
}

function resetCandidateFilters() {
  document.getElementById('csKeyword').value = '';
  document.getElementById('csCategory').value = '';
  document.getElementById('csStatus').value = '';
  candState.keyword = candState.category = candState.status = '';
  candState.page = 1;
  renderCandidates();
}

// ---------- 看板 ----------
function initCharts() {
  if (typeof echarts === 'undefined') {
    toast('图表库加载失败，请检查网络后刷新', 'error');
    return;
  }
  const mount = (key, elId) => {
    const el = document.getElementById(elId);
    if (!el) { console.warn('图表容器不存在:', elId); return null; }
    return echarts.init(el);
  };
  charts.status = mount('status', 'chartStatus');
  charts.category = mount('category', 'chartCategory');
  charts.supplier = mount('supplier', 'chartSupplier');
  charts.supStatus = mount('supStatus', 'chartSupStatus');
  charts.supCategory = mount('supCategory', 'chartSupCategory');
  chartsInited = true;
  window.addEventListener('resize', () => {
    for (const c of Object.values(charts)) c && c.resize();
  });
}

async function loadStats() {
  try {
    const d = await apiGet('/api/stats');
    renderCards(d);
    renderCharts(d);
    renderRecent(d.recent);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderCards(d) {
  document.getElementById('statTotal').textContent = d.total;
  document.getElementById('statCert').textContent = d.certOk;
  document.getElementById('statProgress').textContent = d.inProgress;
  document.getElementById('statExpired').textContent = d.expired.length;
  document.getElementById('statExpiring').textContent = d.expiring.length;
}

function renderCharts(d) {
  if (typeof echarts === 'undefined') return;
  const set = (ch, opt) => { if (ch) ch.setOption(opt); };

  // 认证状态分布（饼图）
  set(charts.status, {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, textStyle: { fontSize: 12 } },
    series: [{
      type: 'pie', radius: ['38%', '65%'], center: ['50%', '45%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { formatter: '{b}\n{c}', fontSize: 12 },
      data: d.byStatus.map((s) => ({ name: s.name, value: s.value, itemStyle: { color: STATUS_COLORS[s.name] } })),
    }],
  });

  // 分类分布（柱状图）
  set(charts.category, {
    tooltip: {},
    grid: { left: 8, right: 20, top: 30, bottom: 30, containLabel: true },
    xAxis: {
      type: 'value', axisLabel: { fontSize: 11 },
      splitLine: { lineStyle: { color: '#f1f5f9' } },
    },
    yAxis: {
      type: 'category', data: d.byCategory.map((c) => c.name),
      axisLabel: { fontSize: 12 },
    },
    series: [{
      type: 'bar', barMaxWidth: 26,
      data: d.byCategory.map((c) => c.value),
      itemStyle: { color: '#3b82f6', borderRadius: [0, 6, 6, 0] },
      label: { show: true, position: 'right', fontSize: 11 },
    }],
  });

  // 供应商 TOP10（横向条形）
  set(charts.supplier, {
    tooltip: {},
    grid: { left: 8, right: 20, top: 30, bottom: 30, containLabel: true },
    xAxis: {
      type: 'value', axisLabel: { fontSize: 11 },
      splitLine: { lineStyle: { color: '#f1f5f9' } },
    },
    yAxis: {
      type: 'category', data: d.bySupplier.map((s) => s.name),
      axisLabel: { fontSize: 11 },
    },
    series: [{
      type: 'bar', barMaxWidth: 20,
      data: d.bySupplier.map((s) => s.value),
      itemStyle: { color: '#10b981', borderRadius: [0, 6, 6, 0] },
      label: { show: true, position: 'right', fontSize: 11 },
    }],
  });
}

function renderRecent(rows) {
  const body = document.getElementById('recentBody');
  body.innerHTML = rows.map((r) => `
    <tr>
      <td class="code-cell">${esc(r.code)}</td>
      <td><b>${esc(r.name)}</b></td>
      <td>${esc(r.model)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${esc(r.applied_by)}</td>
      <td>${esc(r.created_at)}</td>
    </tr>`).join('');
}

// ---------- 供应商看板 ----------
const SUP_STATUS_COLORS = {
  '合作中': '#10b981',
  '暂停': '#f59e0b',
  '淘汰': '#ef4444',
};

async function loadSupplierBoard() {
  try {
    const [st, list] = await Promise.all([
      apiGet('/api/suppliers/stats'),
      apiGet('/api/suppliers'),
    ]);
    renderSupCards(st);
    renderSupCharts(st);
    renderSupTable(list.items || []);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderSupCards(st) {
  const byStatus = (name) => {
    const row = (st.byStatus || []).find((s) => s.name === name);
    return row ? row.value : 0;
  };
  document.getElementById('supTotal').textContent = st.total;
  document.getElementById('supActive').textContent = byStatus('合作中');
  document.getElementById('supPaused').textContent = byStatus('暂停');
  document.getElementById('supDead').textContent = byStatus('淘汰');
  document.getElementById('supCategoryCount').textContent = (st.byCategory || []).length;
}

function renderSupCharts(st) {
  if (typeof echarts === 'undefined') return;
  const set = (ch, opt) => { if (ch) ch.setOption(opt); };

  // 供应商状态分布（饼图）
  set(charts.supStatus, {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, textStyle: { fontSize: 12 } },
    series: [{
      type: 'pie', radius: ['38%', '65%'], center: ['50%', '45%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { formatter: '{b}\n{c}', fontSize: 12 },
      data: (st.byStatus || []).map((s) => ({ name: s.name, value: s.value, itemStyle: { color: SUP_STATUS_COLORS[s.name] } })),
    }],
  });

  // 供应商物料品类分布（柱状图）
  set(charts.supCategory, {
    tooltip: {},
    grid: { left: 8, right: 20, top: 30, bottom: 30, containLabel: true },
    xAxis: {
      type: 'value', axisLabel: { fontSize: 11 },
      splitLine: { lineStyle: { color: '#f1f5f9' } },
    },
    yAxis: {
      type: 'category', data: (st.byCategory || []).map((c) => c.name),
      axisLabel: { fontSize: 12 },
    },
    series: [{
      type: 'bar', barMaxWidth: 26,
      data: (st.byCategory || []).map((c) => c.value),
      itemStyle: { color: '#8b5cf6', borderRadius: [0, 6, 6, 0] },
      label: { show: true, position: 'right', fontSize: 11 },
    }],
  });
}

function renderSupTable(rows) {
  const body = document.getElementById('supBoardBody');
  const list = rows.slice(0, 20);
  body.innerHTML = list.map((s) => `
    <tr>
      <td><b>${esc(s.name)}</b></td>
      <td>${esc(s.material_type) || '-'}</td>
      <td>${gradeStatusBadge(s.status)}</td>
      <td class="spec" title="${esc(s.address)}">${esc(s.address) || '-'}</td>
      <td class="spec" title="${esc(s.product_type)}">${esc(s.product_type) || '-'}</td>
    </tr>`).join('');
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px;">暂无供应商数据</td></tr>';
  }
}

// ---------- Excel 批量导出 ----------
// 按当前筛选条件导出物料列表数据
async function exportMaterials() {
  try {
    const params = new URLSearchParams({
      keyword: document.getElementById('keyword').value.trim(),
      category: document.getElementById('filterCategory').value,
      status: document.getElementById('filterStatus').value,
      supplier: document.getElementById('filterSupplier').value,
    });
    const qs = params.toString();
    const res = await fetch('/api/materials/export' + (qs ? '?' + qs : ''));
    if (!res.ok) {
      let msg = '导出失败';
      try { const d = await res.json(); msg = d.message || msg; } catch (e) { /* ignore */ }
      toast(msg, 'error');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `物料台账_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('导出成功', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ---------- Excel 批量导入 ----------
let importRows = [];

function openImportModal() {
  importRows = [];
  document.getElementById('importFile').value = '';
  document.getElementById('importPreviewWrap').style.display = 'none';
  document.getElementById('importResult').innerHTML = '';
  document.getElementById('btnConfirmImport').disabled = true;
  openModal('importModal');
}

// 下载导入模板
function downloadImportTemplate() {
  if (typeof XLSX === 'undefined') { toast('Excel 解析库加载失败，请检查网络后刷新', 'error'); return; }
  const headers = ['编码', '物料品类', '型号规格', '分类', '供应商', '制造商', '认证状态'];
  const sample = ['', '贴片电阻', '0805-10K-1%', '电阻', '某电子有限公司', '某制造商', '绿区'];
  const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '物料导入模板');
  XLSX.writeFile(wb, '物料导入模板.xlsx');
}

// 解析 Excel 文件并预览
function parseImportExcel() {
  const file = document.getElementById('importFile').files[0];
  if (!file) { toast('请先选择 Excel 文件', 'error'); return; }
  if (typeof XLSX === 'undefined') { toast('Excel 解析库加载失败，请检查网络后刷新', 'error'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      importRows = rows.map((r, i) => {
        const get = (...keys) => {
          for (const k of keys) {
            for (const key of Object.keys(r)) {
              if (String(key).trim() === k) return String(r[key]).trim();
            }
          }
          return '';
        };
        return {
          code: get('编码', '物料编码', '编号'),
          name: get('物料品类', '物料名称', '名称'),
          model: get('型号规格', '型号', '规格'),
          category: get('分类', '品类', '类别'),
          supplier: get('供应商'),
          manufacturer: get('制造商', '品牌'),
          status: get('认证状态', '状态'),
        };
      });
      renderImportPreview();
    } catch (err) {
      toast('文件解析失败：' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderImportPreview() {
  const wrap = document.getElementById('importPreviewWrap');
  const body = document.getElementById('importPreviewBody');
  const result = document.getElementById('importResult');
  const valid = importRows.filter((r) => r.name);
  const invalid = importRows.length - valid.length;
  wrap.style.display = 'block';
  body.innerHTML = importRows.map((r, i) => `
    <tr${r.name ? '' : ' style="background:#fef2f2;"'}>
      <td>${i + 1}</td>
      <td class="code-cell">${esc(r.code) || '-'}</td>
      <td><b>${esc(r.name) || '<span style="color:var(--danger)">（缺少名称）</span>'}</b></td>
      <td>${esc(r.model) || '-'}</td>
      <td>${esc(r.category) || '-'}</td>
      <td>${esc(r.supplier) || '-'}</td>
      <td>${esc(r.manufacturer) || '-'}</td>
      <td>${esc(r.status) || '黄区'}</td>
    </tr>`).join('');
  result.innerHTML = `
    <div style="padding:10px 14px; border-radius:8px; background:${invalid ? 'var(--danger-soft,#fef2f2)' : 'var(--ok-soft,#ecfdf5)'}; margin-bottom:12px;">
      共解析 <b>${importRows.length}</b> 行，有效 <b>${valid.length}</b> 行${invalid ? `，<b style="color:var(--danger)">缺少名称 ${invalid} 行（将被跳过）</b>` : ''}。
    </div>`;
  document.getElementById('btnConfirmImport').disabled = valid.length === 0;
}

async function confirmImport() {
  const valid = importRows.filter((r) => r.name);
  if (!valid.length) { toast('没有可导入的有效数据', 'error'); return; }
  const btn = document.getElementById('btnConfirmImport');
  btn.disabled = true;
  btn.textContent = '导入中...';
  try {
    const res = await apiPost('/api/materials/batch', { items: valid });
    const msg = `导入完成：成功 ${res.success} 条` +
      (res.errors && res.errors.length ? `，失败 ${res.errors.length} 条` : '') +
      (res.skipped && res.skipped.length ? `，跳过 ${res.skipped.length} 条` : '');
    toast(msg, res.errors && res.errors.length ? 'error' : 'success');
    closeModal('importModal');
    await loadMeta();
    await loadMaterials();
  } catch (e) { toast(e.message, 'error'); }
  finally {
    btn.disabled = false;
    btn.textContent = '确认导入';
  }
}

// ---------- 初始化 ----------
document.getElementById('keyword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyFilters();
});

document.getElementById('csKeyword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyCandidateFilters();
});

document.querySelectorAll('.sub-tab').forEach((b) => {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
});

document.addEventListener('DOMContentLoaded', async () => {
  await loadMeta();
  await loadMaterials();
  loadCandidateSuppliers();
});
