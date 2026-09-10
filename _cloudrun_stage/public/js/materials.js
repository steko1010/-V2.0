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

async function loadMeta() {
  try {
    state.meta = await apiGet('/api/meta');
    fillSelect('filterStatus', state.meta.statuses, '全部状态');
    fillSelect('filterCategory', state.meta.categories, '全部分类');
    fillSelect('filterSupplier', state.meta.suppliers, '全部供应商');
    fillSelect('f_status', state.meta.statuses);
    const supList = document.getElementById('supList');
    supList.innerHTML = state.meta.suppliers.map((s) => `<option value="${esc(s)}">`).join('');
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
  if (!items.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    document.querySelector('.table-wrap table').style.display = 'none';
    const allCb = document.getElementById('matCheckAll');
    if (allCb) allCb.checked = false;
    return;
  }
  empty.style.display = 'none';
  document.querySelector('.table-wrap table').style.display = '';
  body.innerHTML = items.map((r) => `
    <tr>
      <td><input type="checkbox" class="mat-check" value="${r.id}"></td>
      <td class="code-cell">${esc(r.code)}</td>
      <td><b>${esc(r.name)}</b></td>
      <td>${esc(r.model)}</td>
      <td>${esc(r.category)}</td>
      <td>${esc(r.supplier)}</td>
      <td>${esc(r.manufacturer)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${expiryBadge(r)}</td>
      <td>${docBadge(r.rohs)}</td>
      <td>${docBadge(r.reach)}</td>
      <td>${esc(r.applied_by)}</td>
      <td class="actions">
        <button class="btn btn-sm" data-permission="action:edit" onclick="editMaterial(${r.id})">编辑</button>
        <button class="btn btn-sm btn-danger" data-permission="action:delete" onclick="deleteMaterial(${r.id})">删除</button>
      </td>
    </tr>`).join('');
  const allCb = document.getElementById('matCheckAll');
  if (allCb) allCb.checked = false;
}

// ---------- 批量删除 ----------
function toggleMatAll(cb) {
  document.querySelectorAll('#tableBody .mat-check').forEach((x) => { x.checked = cb.checked; });
}

async function batchDeleteMaterials() {
  const ids = [...document.querySelectorAll('#tableBody .mat-check:checked')].map((x) => parseInt(x.value, 10));
  if (!ids.length) return toast('请先勾选要删除的物料', 'error');
  if (!await confirmDialog(`确定删除选中的 ${ids.length} 条物料？删除后不可恢复。`)) return;
  const allCb = document.getElementById('matCheckAll');
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

document.getElementById('keyword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyFilters();
});

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
  if (!data.name) { toast('物料名称不能为空', 'error'); return; }
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

document.addEventListener('DOMContentLoaded', async () => {
  setupBatchImport({
    api: 'materials',
    entity: '物料',
    requiredLabel: '物料名称',
    refresh: () => loadMaterials(),
    fields: [
      ['编码', 'code'], ['物料名称', 'name'], ['型号规格', 'model'], ['分类', 'category'],
      ['供应商', 'supplier'], ['制造商', 'manufacturer'], ['认证状态', 'status'],
      ['认证到期', 'cert_expire_date'], ['ROHS', 'rohs'], ['REACH', 'reach'], ['申请人', 'applied_by'],
    ],
  });
  await loadMeta();
  await loadMaterials();
});
