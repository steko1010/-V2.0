// ================= 供应商信息 =================

// ---------- 子界面 Tab 切换 ----------
function switchSupplierTab(name) {
  document.querySelectorAll('.sub-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.sub-panel').forEach((p) => {
    p.classList.toggle('active', p.id === 'panel-' + name);
  });
  if (name === 'analysis') loadStats(); // 显示分析时重新渲染图表
}

let editingId = null;
let supplierItems = [];
let supPage = 1;
const SUP_PAGE_SIZE = 10;

// 列表列配置：中文列名 -> 字段名（用于单元格渲染）
const SUPPLIER_COLUMNS = [
  ['name', '供应商'],
  ['material_type', '物料品类'],
  ['address', '工厂地址'],
  ['company_profile', '公司简介'],
  ['product_type', '产品类型'],
  ['capacity_phone', '产能(手机)'],
  ['module_customers', '模组客户'],
  ['terminal_customers', '终端客户'],
  ['system_capability', '体系能力'],
  ['automation_capability', '自动化能力'],
  ['inspection_capability', '检验能力'],
  ['traceability_capability', '追溯能力'],
  ['testing_capability', '测试能力'],
  ['rework', '返修'],
  ['strengths', '优势'],
  ['weaknesses', '劣势'],
  ['audit_address', '审核地址'],
  ['audit_time', '审核时间'],
  ['audit_members', '审核成员'],
  ['audit_result', '审核结果'],
  ['qsa', 'QSA'],
  ['qpa', 'QPA'],
  ['audit_record', '审核记录'],
  ['mass_production_record', '传音量产记录'],
];

function ratingBadge(r) {
  const color = { A: 'done', B: 'cert', C: '', D: 'dead' }[r] || '';
  return `<span class="badge ${color}">${esc(r || '-')} 级</span>`;
}

function statusBadgeGen(status) {
  const color = { '合作中': 'done', '暂停': 'doc-pending', '淘汰': 'dead' }[status] || '';
  return `<span class="badge ${color}">${esc(status || '-')}</span>`;
}

function materialTypeBadge(t) {
  if (!t) return '-';
  const cls = { FPC: 'done', CG: 'cert', '背光': 'doc-yes', IC: 'badge-purple' }[t] || '';
  return `<span class="badge ${cls}">${esc(t)}</span>`;
}

function attachLink(att) {
  if (!att) return '-';
  const name = att.split('/').pop() || '附件';
  return `<a href="${esc(att)}" target="_blank" class="link" title="${esc(att)}">📎 ${esc(name)}</a>`;
}

async function loadSuppliers(keepPage) {
  const keyword = document.getElementById('keyword').value.trim();
  const materialType = document.getElementById('materialTypeFilter').value;
  const params = new URLSearchParams();
  if (keyword) params.set('keyword', keyword);
  if (materialType) params.set('materialType', materialType);
  const qs = params.toString();
  const data = await apiGet('/api/suppliers' + (qs ? `?${qs}` : ''));
  supplierItems = data.items || [];
  if (!keepPage) supPage = 1;
  renderSuppliers();
}

function renderSuppliers() {
  const tbody = document.getElementById('supplierBody');
  const pager = document.getElementById('supplierPager');
  document.getElementById('emptyBox').style.display = supplierItems.length ? 'none' : 'block';
  if (!supplierItems.length) {
    tbody.innerHTML = '';
    pager.style.display = 'none';
    const allCb = document.getElementById('supCheckAll');
    if (allCb) allCb.checked = false;
    return;
  }
  const pages = Math.max(1, Math.ceil(supplierItems.length / SUP_PAGE_SIZE));
  if (supPage > pages) supPage = pages;
  const start = (supPage - 1) * SUP_PAGE_SIZE;
  const pageItems = supplierItems.slice(start, start + SUP_PAGE_SIZE);
  pager.style.display = 'flex';
  pager.innerHTML = pages > 1
    ? `
      <button class="btn btn-sm" ${supPage <= 1 ? 'disabled' : ''} onclick="goSupplierPage(${supPage - 1})">上一页</button>
      <span style="line-height:32px">第 ${supPage} / ${pages} 页（共 ${supplierItems.length} 条）</span>
      <button class="btn btn-sm" ${supPage >= pages ? 'disabled' : ''} onclick="goSupplierPage(${supPage + 1})">下一页</button>`
    : `<span style="line-height:32px">共 ${supplierItems.length} 条</span>`;
  tbody.innerHTML = pageItems
    .map((s) => `
      <tr>
        <td><input type="checkbox" class="sup-check" value="${s.id}"></td>
        <td><b>${esc(s.name)}</b></td>
        <td>${materialTypeBadge(s.material_type)}</td>
        <td class="spec" title="${esc(s.address)}">${esc(s.address) || '-'}</td>
        <td class="spec" title="${esc(s.company_profile)}">${esc(s.company_profile) || '-'}</td>
        <td class="spec" title="${esc(s.product_type)}">${esc(s.product_type) || '-'}</td>
        <td class="spec" title="${esc(s.capacity_phone)}">${esc(s.capacity_phone) || '-'}</td>
        <td class="spec" title="${esc(s.module_customers)}">${esc(s.module_customers) || '-'}</td>
        <td class="spec" title="${esc(s.terminal_customers)}">${esc(s.terminal_customers) || '-'}</td>
        <td class="spec" title="${esc(s.system_capability)}">${esc(s.system_capability) || '-'}</td>
        <td class="spec" title="${esc(s.automation_capability)}">${esc(s.automation_capability) || '-'}</td>
        <td class="spec" title="${esc(s.inspection_capability)}">${esc(s.inspection_capability) || '-'}</td>
        <td class="spec" title="${esc(s.traceability_capability)}">${esc(s.traceability_capability) || '-'}</td>
        <td class="spec" title="${esc(s.testing_capability)}">${esc(s.testing_capability) || '-'}</td>
        <td class="spec" title="${esc(s.rework)}">${esc(s.rework) || '-'}</td>
        <td class="spec" title="${esc(s.strengths)}">${esc(s.strengths) || '-'}</td>
        <td class="spec" title="${esc(s.weaknesses)}">${esc(s.weaknesses) || '-'}</td>
        <td class="spec" title="${esc(s.audit_address)}">${esc(s.audit_address) || '-'}</td>
        <td class="spec" title="${esc(s.audit_time)}">${esc(s.audit_time) || '-'}</td>
        <td class="spec" title="${esc(s.audit_members)}">${esc(s.audit_members) || '-'}</td>
        <td class="spec" title="${esc(s.audit_result)}">${esc(s.audit_result) || '-'}</td>
        <td class="spec" title="${esc(s.qsa)}">${esc(s.qsa) || '-'}</td>
        <td class="spec" title="${esc(s.qpa)}">${esc(s.qpa) || '-'}</td>
        <td class="spec" title="${esc(s.audit_record)}">${esc(s.audit_record) || '-'}</td>
        <td class="spec" title="${esc(s.mass_production_record)}">${esc(s.mass_production_record) || '-'}</td>
        <td>${attachLink(s.attachment)}</td>
        <td>
          <div class="actions">
            <button class="btn btn-sm" data-permission="action:edit" onclick="openSupplierModal(${s.id})">编辑</button>
            <button class="btn btn-sm btn-danger" data-permission="action:delete" onclick="deleteSupplier(${s.id})">删除</button>
          </div>
        </td>
      </tr>`)
    .join('');
  const allCb = document.getElementById('supCheckAll');
  if (allCb) allCb.checked = false;
}

function resetSuppliers() {
  document.getElementById('keyword').value = '';
  document.getElementById('materialTypeFilter').value = '';
  loadSuppliers();
}

function goSupplierPage(p) {
  supPage = p;
  renderSuppliers();
}

function openSupplierModal(id) {
  editingId = id || null;
  const row = id ? supplierItems.find((s) => s.id === id) : null;
  document.getElementById('modalTitle').textContent = row ? '编辑供应商' : '新增供应商';
  const fields = [
    'name', 'contact', 'phone', 'email', 'address', 'category',
    'company_profile', 'product_type', 'capacity_phone',
    'module_customers', 'terminal_customers', 'system_capability',
    'automation_capability', 'inspection_capability', 'traceability_capability',
    'testing_capability', 'rework', 'strengths', 'weaknesses', 'remark', 'attachment',
    'audit_address', 'audit_time', 'audit_members', 'audit_result',
    'qsa', 'qpa', 'audit_record', 'mass_production_record',
  ];
  fields.forEach((f) => {
    const el = document.getElementById('f_' + f);
    if (el) el.value = row ? (row[f] || '') : '';
  });
  setCategoryValue('f_material_type', row ? (row.material_type || '') : '');
  document.getElementById('f_rating').value = row ? (row.rating || 'C') : 'C';
  document.getElementById('f_status').value = row ? (row.status || '合作中') : '合作中';
  const attachEl = document.getElementById('attachLink');
  const att = row ? row.attachment : '';
  if (att) {
    attachEl.textContent = '查看已上传附件';
    attachEl.href = att;
    attachEl.style.display = 'inline';
  } else {
    attachEl.style.display = 'none';
  }
  openModal('supplierModal');
}

async function saveSupplier() {
  const payload = {
    name: document.getElementById('f_name').value.trim(),
    contact: document.getElementById('f_contact').value.trim(),
    phone: document.getElementById('f_phone').value.trim(),
    email: document.getElementById('f_email').value.trim(),
    address: document.getElementById('f_address').value.trim(),
    category: document.getElementById('f_category') ? document.getElementById('f_category').value.trim() : '',
    material_type: document.getElementById('f_material_type').value,
    company_profile: document.getElementById('f_company_profile').value.trim(),
    product_type: document.getElementById('f_product_type').value.trim(),
    capacity_phone: document.getElementById('f_capacity_phone').value.trim(),
    module_customers: document.getElementById('f_module_customers').value.trim(),
    terminal_customers: document.getElementById('f_terminal_customers').value.trim(),
    system_capability: document.getElementById('f_system_capability').value.trim(),
    automation_capability: document.getElementById('f_automation_capability').value.trim(),
    inspection_capability: document.getElementById('f_inspection_capability').value.trim(),
    traceability_capability: document.getElementById('f_traceability_capability').value.trim(),
    testing_capability: document.getElementById('f_testing_capability').value.trim(),
    rework: document.getElementById('f_rework').value.trim(),
    strengths: document.getElementById('f_strengths').value.trim(),
    weaknesses: document.getElementById('f_weaknesses').value.trim(),
    remark: document.getElementById('f_remark').value.trim(),
    attachment: document.getElementById('f_attachment').value.trim(),
    rating: document.getElementById('f_rating').value,
    status: document.getElementById('f_status').value,
    audit_address: document.getElementById('f_audit_address').value.trim(),
    audit_time: document.getElementById('f_audit_time').value.trim(),
    audit_members: document.getElementById('f_audit_members').value.trim(),
    audit_result: document.getElementById('f_audit_result').value.trim(),
    qsa: document.getElementById('f_qsa').value.trim(),
    qpa: document.getElementById('f_qpa').value.trim(),
    audit_record: document.getElementById('f_audit_record').value.trim(),
    mass_production_record: document.getElementById('f_mass_production_record').value.trim(),
  };
  if (!payload.name) return toast('供应商不能为空', 'error');
  if (!payload.material_type) return toast('请选择物料品类', 'error');
  try {
    if (editingId) {
      await apiPut('/api/suppliers/' + editingId, payload);
      toast('修改成功', 'success');
      closeModal('supplierModal');
      loadSuppliers(true); // 编辑后保持当前页
      loadStats();
    } else {
      await apiPost('/api/suppliers', payload);
      toast('新增成功', 'success');
      closeModal('supplierModal');
      loadSuppliers(); // 新增后回第 1 页展示最新数据
      loadStats();
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

// 附件上传：读取本地文件 -> base64 -> 上传接口
async function uploadAttachment() {
  const fileInput = document.getElementById('f_attach_file');
  const file = fileInput && fileInput.files && fileInput.files[0];
  if (!file) return toast('请先选择文件', 'error');
  if (file.size > 20 * 1024 * 1024) return toast('附件不能超过 20MB', 'error');
  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
    const data = await apiPost('/api/upload', { name: file.name, base64 });
    document.getElementById('f_attachment').value = data.url;
    const attachEl = document.getElementById('attachLink');
    attachEl.textContent = '查看已上传附件：' + (data.name || '');
    attachEl.href = data.url;
    attachEl.style.display = 'inline';
    toast('附件上传成功', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteSupplier(id) {
  if (!await confirmDialog('确定删除该供应商吗？')) return;
  try {
    await apiDelete('/api/suppliers/' + id);
    toast('已删除', 'success');
    loadSuppliers(true);
    loadStats();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ---------- 批量删除 ----------
function toggleSupAll(cb) {
  document.querySelectorAll('#supplierBody .sup-check').forEach((x) => { x.checked = cb.checked; });
}

async function batchDeleteSuppliers() {
  const ids = [...document.querySelectorAll('#supplierBody .sup-check:checked')].map((x) => parseInt(x.value, 10));
  if (!ids.length) return toast('请先勾选要删除的供应商', 'error');
  if (!await confirmDialog(`确定删除选中的 ${ids.length} 家供应商？`)) return;
  const allCb = document.getElementById('supCheckAll');
  let ok = 0;
  try {
    for (const id of ids) {
      const res = await fetch(`/api/suppliers/${id}`, { method: 'DELETE' });
      if (res.ok) ok++;
    }
    if (allCb) allCb.checked = false;
    toast(`已删除 ${ok} 家`, ok === ids.length ? 'success' : 'error');
    loadSuppliers(true);
    loadStats();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadStats() {
  const s = await apiGet('/api/suppliers/stats');
  const total = s.total || 0;
  document.getElementById('st_total').textContent = total;
  const find = (rows, name) => (rows.find((r) => r.name === name) || {}).value || 0;
  document.getElementById('st_active').textContent = find(s.byStatus, '合作中');
  document.getElementById('st_a').textContent = find(s.byRating, 'A');
  document.getElementById('st_paused').textContent = total - find(s.byStatus, '合作中');
  renderBars('barStatus', s.byStatus || [], '#2563eb');
  renderBars('barRating', (s.byRating || []).map((r) => ({ ...r, name: r.name + ' 级' })), '#16a34a');
  renderBars('barCategory', s.byCategory || [], '#d97706');
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
      return `
        <div class="bar-row">
          <div class="bar-label" title="${esc(r.name)}">${esc(r.name)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <div class="bar-value">${r.value}</div>
        </div>`;
    })
    .join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('keyword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadSuppliers();
  });
  setupBatchImport({
    api: 'suppliers',
    entity: '供应商',
    requiredLabel: '供应商',
    refresh: () => { loadSuppliers(); loadStats(); },
    fields: [
      ['供应商', 'name'], ['物料品类', 'material_type'], ['工厂地址', 'address'],
      ['公司简介', 'company_profile'], ['产品类型', 'product_type'], ['产能(手机)', 'capacity_phone'],
      ['模组客户', 'module_customers'], ['终端客户', 'terminal_customers'], ['体系能力', 'system_capability'],
      ['自动化能力', 'automation_capability'], ['检验能力', 'inspection_capability'],
      ['追溯能力', 'traceability_capability'], ['测试能力', 'testing_capability'], ['返修', 'rework'],
      ['优势', 'strengths'], ['劣势', 'weaknesses'],
      ['审核地址', 'audit_address'], ['审核时间', 'audit_time'], ['审核成员', 'audit_members'],
      ['审核结果', 'audit_result'], ['QSA', 'qsa'], ['QPA', 'qpa'],
      ['审核记录', 'audit_record'], ['传音量产记录', 'mass_production_record'], ['附件', 'attachment'],
    ],
  });
  document.querySelectorAll('.sub-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchSupplierTab(btn.dataset.tab));
  });
  await renderCategoryOptions('materialTypeFilter', '全部物料品类');
  await renderCategoryOptions('f_material_type', '请选择');
  loadSuppliers();
  loadStats();
});
