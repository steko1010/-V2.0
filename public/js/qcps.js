// ================= QCP 质量控制计划 =================

// ---------- 子界面 Tab 切换 ----------
function switchQcpTab(name) {
  document.querySelectorAll('.sub-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.sub-panel').forEach((p) => {
    p.classList.toggle('active', p.id === 'panel-' + name);
  });
  if (name === 'analysis') loadStats(); // 显示分析时重新渲染图表
}

let editingId = null;
let qcpItems = [];
let qcpPage = 1;
let qcpPages = 1;
let qcpTotal = 0;
const QCP_PAGE_SIZE = 10;

// ---------- 品类目录状态 ----------
let activeCategory = '';     // '' = 全部
let metaCats = [];           // 品类目录（物料中类，有序）
let catCountMap = new Map(); // 品类 -> 记录数
let allQcpTotal = 0;         // 全部 QCP 总数

function qcpStatusBadge(status) {
  const color = { '草稿': 'doc-pending', '生效': 'done', '作废': 'dead' }[status] || '';
  return `<span class="badge ${color}">${esc(status || '-')}</span>`;
}

function qcpCatBadge(cat) {
  const color = { 'CG': 'badge-blue', 'FPC': 'badge-green', '背光': 'badge-amber', 'IC': 'badge-purple' }[cat] || 'badge-gray';
  return `<span class="badge ${color}">${esc(cat || '-')}</span>`;
}

async function loadQcps(page) {
  const keyword = document.getElementById('keyword').value.trim();
  const status = document.getElementById('filterStatus').value;
  const params = new URLSearchParams({ page: page || qcpPage, pageSize: QCP_PAGE_SIZE });
  if (keyword) params.set('keyword', keyword);
  if (status) params.set('status', status);
  if (activeCategory) params.set('category', activeCategory);
  const data = await apiGet('/api/qcps?' + params.toString());
  qcpItems = data.items || [];
  qcpPage = data.page;
  qcpPages = data.pages;
  qcpTotal = data.total;
  renderQcps();
}

function renderQcps() {
  const tbody = document.getElementById('qcpBody');
  const pager = document.getElementById('qcpPager');
  document.getElementById('emptyBox').style.display = qcpItems.length ? 'none' : 'block';
  if (!qcpItems.length) {
    tbody.innerHTML = '';
    pager.style.display = 'none';
    const allCb = document.getElementById('qcpCheckAll');
    if (allCb) allCb.checked = false;
    return;
  }
  pager.style.display = 'flex';
  pager.innerHTML = qcpPages > 1
    ? `
      <button class="btn btn-sm" ${qcpPage <= 1 ? 'disabled' : ''} onclick="goQcpPage(${qcpPage - 1})">上一页</button>
      <span style="line-height:32px">第 ${qcpPage} / ${qcpPages} 页（共 ${qcpTotal} 条）</span>
      <button class="btn btn-sm" ${qcpPage >= qcpPages ? 'disabled' : ''} onclick="goQcpPage(${qcpPage + 1})">下一页</button>`
    : `<span style="line-height:32px">共 ${qcpTotal} 条</span>`;
  tbody.innerHTML = qcpItems
    .map((q) => `
      <tr>
        <td><input type="checkbox" class="qcp-check" value="${q.id}"></td>
        <td>${qcpCatBadge(q.category)}</td>
        <td>${esc(q.process) || '-'}</td>
        <td>${esc(q.control_item) || '-'}</td>
        <td>${esc(q.method) || '-'}</td>
        <td>${esc(q.freq) || '-'}</td>
        <td>${esc(q.device) || '-'}</td>
        <td>${esc(q.responsible) || '-'}</td>
        <td>${qcpStatusBadge(q.status)}</td>
        <td>
          <div class="actions">
            <button class="btn btn-sm" data-permission="action:edit" onclick="openQcpModal(${q.id})">编辑</button>
            <button class="btn btn-sm btn-danger" data-permission="action:delete" onclick="deleteQcp(${q.id})">删除</button>
          </div>
        </td>
      </tr>`)
    .join('');
  const allCb = document.getElementById('qcpCheckAll');
  if (allCb) allCb.checked = false;
}

// ---------- 左侧品类目录 ----------
// 渲染目录：全部 QCP + 各品类（目录=物料中类，若有记录但未维护中类的历史品类也追加显示）
function renderDir() {
  const list = document.getElementById('catDirList');
  if (!list) return;
  const items = [{ name: '' }];
  (metaCats || []).forEach((c) => items.push({ name: c }));
  const seen = new Set(items.map((i) => i.name));
  for (const [name] of catCountMap) {
    if (name && !seen.has(name)) { items.push({ name }); seen.add(name); }
  }
  list.innerHTML = items.map((it) => {
    const name = it.name;
    const label = name || '全部 QCP';
    const cnt = name ? (catCountMap.get(name) || 0) : allQcpTotal;
    const active = activeCategory === name;
    const addBtn = name
      ? `<span class="cat-add" data-permission="action:create" title="新增到此目录：${esc(name)}" onclick="event.stopPropagation();openQcpModal(null, '${esc(name)}')">＋</span>`
      : '';
    return `
      <div class="cat-dir-item ${active ? 'active' : ''}" data-name="${esc(name)}" onclick="selectDir(this)">
        <span class="cat-ico">${name ? '📁' : '🗂'}</span>
        <span class="cat-txt" title="${esc(label)}">${esc(label)}</span>
        <span class="cat-cnt">${cnt}</span>
        ${addBtn}
      </div>`;
  }).join('');
}

// 点击目录条目：切换到该品类（空 = 全部）
function selectDir(el) {
  activeCategory = el.dataset.name || '';
  renderDir();
  loadQcps(1);
}

// 强制重新拉取品类目录与数量（点击目录头部 ↻）
async function loadDir(force) {
  if (force || !metaCats.length) {
    try {
      const m = await apiGet('/api/meta');
      metaCats = (m && m.categories) || [];
    } catch (e) { /* 目录加载失败时保留现状 */ }
  }
  loadStats();
}

function resetQcps() {
  document.getElementById('keyword').value = '';
  document.getElementById('filterStatus').value = '';
  activeCategory = '';
  renderDir();
  loadQcps(1);
}

function goQcpPage(p) {
  qcpPage = p;
  loadQcps(p);
}

// preCategory：目录行「＋」点击时传入，新增自动归入该品类
function openQcpModal(id, preCategory) {
  editingId = id || null;
  const row = id ? qcpItems.find((q) => q.id === id) : null;
  document.getElementById('modalTitle').textContent = row ? '编辑 QCP' : '新增 QCP';
  const cat = row ? (row.category || '') : (preCategory || activeCategory || '');
  setCategoryValue('f_category', cat);
  document.getElementById('f_name').value = row ? row.name : '';
  document.getElementById('f_supplier').value = row ? row.supplier : '';
  document.getElementById('f_process').value = row ? row.process : '';
  document.getElementById('f_control_item').value = row ? row.control_item : '';
  document.getElementById('f_spec').value = row ? row.spec : '';
  document.getElementById('f_method').value = row ? row.method : '';
  document.getElementById('f_freq').value = row ? row.freq : '';
  document.getElementById('f_device').value = row ? row.device : '';
  document.getElementById('f_responsible').value = row ? row.responsible : '';
  document.getElementById('f_status').value = row ? row.status : '生效';
  document.getElementById('f_remark').value = row ? row.remark : '';
  openModal('qcpModal');
}

async function saveQcp() {
  const payload = {
    category: document.getElementById('f_category').value,
    name: document.getElementById('f_name').value.trim(),
    supplier: document.getElementById('f_supplier').value.trim(),
    process: document.getElementById('f_process').value.trim(),
    control_item: document.getElementById('f_control_item').value.trim(),
    spec: document.getElementById('f_spec').value.trim(),
    method: document.getElementById('f_method').value.trim(),
    freq: document.getElementById('f_freq').value.trim(),
    device: document.getElementById('f_device').value.trim(),
    responsible: document.getElementById('f_responsible').value.trim(),
    status: document.getElementById('f_status').value,
    remark: document.getElementById('f_remark').value.trim(),
  };
  if (!Object.values(payload).some((v) => String(v || '').trim() !== '')) return toast('请至少填写一项内容', 'error');
  try {
    if (editingId) {
      await apiPut('/api/qcps/' + editingId, payload);
      toast('修改成功', 'success');
    } else {
      await apiPost('/api/qcps', payload);
      toast('新增成功', 'success');
    }
    closeModal('qcpModal');
    loadQcps();
    loadStats();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteQcp(id) {
  if (!await confirmDialog('确定删除该 QCP 吗？')) return;
  try {
    await apiDelete('/api/qcps/' + id);
    toast('已删除', 'success');
    // 若当前页删空且不是第一页，则回退一页
    if (qcpItems.length === 1 && qcpPage > 1) qcpPage -= 1;
    loadQcps();
    loadStats();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ---------- 批量删除 ----------
function toggleQcpAll(cb) {
  document.querySelectorAll('#qcpBody .qcp-check').forEach((x) => { x.checked = cb.checked; });
}

async function batchDeleteQcps() {
  const ids = [...document.querySelectorAll('#qcpBody .qcp-check:checked')].map((x) => parseInt(x.value, 10));
  if (!ids.length) return toast('请先勾选要删除的 QCP', 'error');
  if (!await confirmDialog(`确定删除选中的 ${ids.length} 条 QCP？`)) return;
  const allCb = document.getElementById('qcpCheckAll');
  let ok = 0;
  try {
    for (const id of ids) {
      const res = await fetch(`/api/qcps/${id}`, { method: 'DELETE' });
      if (res.ok) ok++;
    }
    if (allCb) allCb.checked = false;
    toast(`已删除 ${ok} 条`, ok === ids.length ? 'success' : 'error');
    // 若整页删空且不是第一页，则回退一页
    if (qcpItems.length === ids.length && qcpPage > 1) qcpPage -= 1;
    loadQcps();
    loadStats();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadStats() {
  const s = await apiGet('/api/qcps/stats');
  // 按品类 · 工序数量（不去重）
  const catProcess = (s.byCategory || []).map((r) => ({ name: r.name, value: r.processCount, hint: '工序' }));
  renderBars('barCategoryProcess', catProcess, '#7c3aed');
  renderBars('barProcess', s.byProcess || [], '#16a34a');
  // 同步左侧品类目录计数
  allQcpTotal = s.total || 0;
  catCountMap = new Map((s.byCategory || []).map((r) => [r.name, r.processCount]));
  renderDir();
}

function renderBars(elId, rows, color) {
  const el = document.getElementById(elId);
  if (!rows.length) {
    el.innerHTML = '<div class="empty" style="padding:24px 0"><div class="big">📭</div><div>暂无数据</div></div>';
    return;
  }
  const max = Math.max(...rows.map((r) => r.value));
  el.innerHTML = rows
    .map((r) => {
      const pct = max ? Math.round((r.value / max) * 100) : 0;
      const hint = r.hint ? `<span class="bar-hint">${esc(r.hint)}</span>` : '';
      return `
        <div class="bar-row">
          <div class="bar-label" title="${esc(r.name)}">${esc(r.name)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <div class="bar-value">${r.value}${hint}</div>
        </div>`;
    })
    .join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('keyword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadQcps(1);
  });
  setupBatchImport({
    api: 'qcps',
    entity: 'QCP',
    requiredLabel: '', // 无必填列，所有内容均可选填
    refresh: () => { loadQcps(); loadStats(); },
    fields: [
      ['品类', 'category'], ['QCP 名称', 'name'], ['供应商', 'supplier'], ['工序', 'process'],
      ['控制项目', 'control_item'], ['规格要求', 'spec'], ['检验方法', 'method'],
      ['频次', 'freq'], ['检测设备', 'device'], ['责任人', 'responsible'], ['状态', 'status'],
    ],
  });
  document.querySelectorAll('.sub-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchQcpTab(btn.dataset.tab));
  });
  // 品类目录（= 品类管理中维护的物料中类）初始化
  const cats = await loadMidCategories();
  metaCats = cats || [];
  await renderCategoryOptions('f_category', '请选择');
  // 供应商输入框候选值：数据源 = 供应商信息中维护的供应商
  await renderSupplierDatalist('supList');
  loadQcps();
  loadStats();
});
