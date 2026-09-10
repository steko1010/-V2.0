// ================= 系统管理 =================
let ROLES = [];
let PERMS = [];

// 内置角色在“账号”列的中文标识（不显示英文代码）
const BUILTIN_ROLE_LABELS = { admin: '管理员', editor: '编辑员', readonly: '只读' };
const builtinRoleLabel = (code) => BUILTIN_ROLE_LABELS[code] || '内置管理员';

function switchAdminTab(name) {
  document.querySelectorAll('.sub-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.sub-panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
  if (name === 'roles') loadRoles();
  if (name === 'perms') loadPerms();
  if (name === 'users') loadUsers();
  if (name === 'categories') loadCategories();
}

async function loadUsers() {
  const data = await apiGet('/api/users');
  const tbody = document.getElementById('userBody');
  tbody.innerHTML = (data.items || []).map((u) => {
    const scopeTxt = u.is_super ? '<span class="badge done">全部</span>' :
      `${u.scopes?.categories?.length || 0}品类 / ${u.scopes?.suppliers?.length || 0}供应商`;
    return `<tr>
      <td><b>${esc(u.username)}</b>${u.is_super ? ' <span class="badge badge-purple">超管</span>' : ''}</td>
      <td>${esc(u.display_name) || '-'}</td>
      <td>${u.status === '启用' ? '<span class="badge done">启用</span>' : '<span class="badge dead">停用</span>'}</td>
      <td>${u.is_super ? '是' : '否'}</td>
      <td>${esc(u.roles) || '-'}</td>
      <td>${scopeTxt}</td>
      <td>${esc(u.created_at) || '-'}</td>
      <td>
        <button class="btn btn-sm" onclick="openUserModal(${u.id})">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id}, '${esc(u.username)}')">删除</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;color:#9ca3af">暂无用户</td></tr>';
}

async function loadRoles() {
  const [roleData, permData] = await Promise.all([
    apiGet('/api/roles'),
    apiGet('/api/permissions'),
  ]);
  ROLES = roleData.items || [];
  const permMap = new Map((permData.items || []).map((p) => [p.code, p]));
  const tbody = document.getElementById('roleBody');
  tbody.innerHTML = ROLES.map((r) => {
    const owned = (r.permissions || []).map((c) => permMap.get(c)).filter(Boolean);
    const menus = owned.filter((p) => p.kind === 'menu');
    const acts = owned.filter((p) => p.kind === 'action');
    const permLabel = (p) => `${esc(p.name)} <code style="font-size:11px;color:#6b7280">${esc(p.code)}</code>`;
    const parts = [];
    if (r.description) parts.push(esc(r.description));
    if (menus.length) parts.push('菜单权限：' + menus.map(permLabel).join('、'));
    if (acts.length) parts.push('操作权限：' + acts.map(permLabel).join('、'));
    const descHtml = parts.length ? parts.join('<br>') : '-';
    const accountHtml = r.built_in
      ? `<span class="badge badge-purple">${esc(builtinRoleLabel(r.code))}</span>`
      : `<code>${esc(r.code)}</code>`;
    return `<tr>
    <td>${accountHtml}</td>
    <td><b>${esc(r.name)}</b></td>
    <td>${descHtml}</td>
    <td>${r.built_in ? '<span class="badge done">内置</span>' : '<span class="badge">自定义</span>'}</td>
    <td><a href="#" onclick="viewRolePerms(${r.id}, '${esc(r.name)}')">查看权限</a></td>
    <td>
      <button class="btn btn-sm" onclick="openRoleModal(${r.id})">编辑</button>
      <button class="btn btn-sm btn-danger" onclick="deleteRole(${r.id}, '${esc(r.name)}', ${r.built_in ? 1 : 0})">删除</button>
    </td>
  </tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:#9ca3af">暂无角色</td></tr>';
}

async function loadPerms() {
  const data = await apiGet('/api/permissions');
  const tbody = document.getElementById('permBody');
  tbody.innerHTML = (data.items || []).map((p) => `<tr>
    <td>${p.kind === 'menu' ? '<span class="badge cert">菜单</span>' : '<span class="badge test">操作</span>'}</td>
    <td><code>${esc(p.code)}</code></td>
    <td>${esc(p.name)}</td>
  </tr>`).join('');
}

async function viewRolePerms(id, name) {
  const [permData, roleData] = await Promise.all([
    apiGet('/api/permissions'),
    apiGet('/api/roles/' + id + '/permissions'),
  ]);
  const owned = new Set(roleData.items || []);
  const checkItem = (p) =>
    `<label style="flex:0 0 30%"><input type="checkbox" ${owned.has(p.code) ? 'checked' : ''} disabled> ${esc(p.name)} <code style="font-size:11px;color:#9ca3af">${esc(p.code)}</code></label>`;
  const menusEl = document.getElementById('pv_menus');
  const actsEl = document.getElementById('pv_actions');
  menusEl.innerHTML = (permData.items || []).filter((p) => p.kind === 'menu').map(checkItem).join('') ||
    '<span style="color:#9ca3af;font-size:12px">（无菜单权限）</span>';
  actsEl.innerHTML = (permData.items || []).filter((p) => p.kind === 'action').map(checkItem).join('') ||
    '<span style="color:#9ca3af;font-size:12px">（无操作权限）</span>';
  document.getElementById('permViewTitle').textContent = `角色「${name}」权限`;
  openModal('permViewModal');
}

// ---------- 用户编辑 ----------
let editingUserId = null;
let CATEGORY_OPTIONS = [];

// 从元数据接口加载真实品类选项
async function loadCategoryOptions() {
  try {
    const meta = await apiGet('/api/meta');
    CATEGORY_OPTIONS = meta.categories || [];
  } catch (e) {
    CATEGORY_OPTIONS = [];
  }
}

async function openUserModal(id) {
  editingUserId = id || null;
  document.getElementById('userModalTitle').textContent = id ? '编辑用户' : '新增用户';
  document.getElementById('u_pwd_req').style.display = id ? 'none' : 'inline';
  document.getElementById('u_username').disabled = false;
  document.getElementById('u_username').title = id ? '修改账号或姓名将同步更新同名角色' : '';
  // 渲染角色/品类 checkbox
  const rolesDiv = document.getElementById('u_roles');
  rolesDiv.innerHTML = ROLES.map((r) => `<label><input type="checkbox" value="${r.id}" class="u-role-cb"> ${esc(r.name)}</label>`).join('');
  const catsDiv = document.getElementById('u_cats');
  if (!CATEGORY_OPTIONS.length) await loadCategoryOptions();
  catsDiv.innerHTML = CATEGORY_OPTIONS.map((c) => `<label><input type="checkbox" value="${esc(c)}" class="u-cat-cb"> ${esc(c)}</label>`).join('') ||
    '<span style="color:#9ca3af;font-size:12px">暂无品类数据</span>';

  if (id) {
    const data = await apiGet('/api/users');
    const u = (data.items || []).find((x) => x.id === id);
    if (!u) return;
    const roles = (u.roles || '').split(',').filter(Boolean);
    const scopes = u.scopes || { categories: [], suppliers: [] };
    document.getElementById('u_username').value = u.username;
    document.getElementById('u_password').value = '';
    document.getElementById('u_display_name').value = u.display_name || '';
    document.getElementById('u_status').value = u.status || '启用';
    document.getElementById('u_is_super').value = u.is_super ? '1' : '0';
    rolesDiv.querySelectorAll('.u-role-cb').forEach((cb) => {
      cb.checked = roles.some((name) => ROLES.find((r) => r.id == cb.value)?.name === name);
    });
    // 品类回显（若选项不包含已授权品类，动态补上）
    for (const c of scopes.categories) {
      if (!CATEGORY_OPTIONS.includes(c)) CATEGORY_OPTIONS.push(c);
    }
    if (scopes.categories.length) {
      catsDiv.innerHTML = CATEGORY_OPTIONS.map((c) =>
        `<label><input type="checkbox" value="${esc(c)}" class="u-cat-cb" ${scopes.categories.includes(c) ? 'checked' : ''}> ${esc(c)}</label>`
      ).join('');
    }
    document.getElementById('u_suppliers').value = (scopes.suppliers || []).join('\n');
  } else {
    document.getElementById('u_username').value = '';
    document.getElementById('u_password').value = '';
    document.getElementById('u_display_name').value = '';
    document.getElementById('u_status').value = '启用';
    document.getElementById('u_is_super').value = '0';
    document.getElementById('u_suppliers').value = '';
  }
  openModal('userModal');
}

async function saveUser() {
  const username = document.getElementById('u_username').value.trim();
  const password = document.getElementById('u_password').value;
  const display_name = document.getElementById('u_display_name').value.trim();
  const status = document.getElementById('u_status').value;
  const is_super = document.getElementById('u_is_super').value === '1' ? 1 : 0;
  const role_ids = [...document.querySelectorAll('.u-role-cb:checked')].map((cb) => parseInt(cb.value, 10));
  const categories = [...document.querySelectorAll('.u-cat-cb:checked')].map((cb) => cb.value);
  const suppliers = document.getElementById('u_suppliers').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!username) return toast('请输入账号', 'error');
  if (!editingUserId && !password) return toast('请输入密码', 'error');
  try {
    if (editingUserId) {
      const body = { username, status, display_name, is_super, role_ids, scopes: { categories, suppliers } };
      if (password) body.password = password;
      await apiPut('/api/users/' + editingUserId, body);
      toast('修改成功', 'success');
    } else {
      await apiPost('/api/users', { username, password, display_name, status, is_super, role_ids, scopes: { categories, suppliers } });
      toast('新增成功', 'success');
    }
    closeModal('userModal');
    loadUsers();
    loadRoles();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteUser(id, name) {
  if (!await confirmDialog('确定删除用户「' + name + '」吗？')) return;
  try {
    await apiDelete('/api/users/' + id);
    toast('已删除', 'success');
    loadUsers();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- 角色编辑 ----------
let editingRoleId = null;

async function openRoleModal(id) {
  editingRoleId = id || null;
  document.getElementById('roleModalTitle').textContent = id ? '编辑角色' : '新增角色';
  document.getElementById('r_code').disabled = !!id;
  // 渲染权限 checkbox
  const permData = await apiGet('/api/permissions');
  PERMS = permData.items || [];
  const menuPerms = PERMS.filter((p) => p.kind === 'menu');
  const actPerms = PERMS.filter((p) => p.kind === 'action');
  const wrap = document.getElementById('r_perms');
  wrap.innerHTML = `
    <div style="flex:1 1 100%; font-weight:600; color:#374151">菜单权限</div>
    ${menuPerms.map((p) => `<label style="flex:0 0 30%"><input type="checkbox" value="${esc(p.code)}" class="r-perm-cb"> ${esc(p.name)} <code style="font-size:11px;color:#9ca3af">${esc(p.code)}</code></label>`).join('')}
    <div style="flex:1 1 100%; font-weight:600; color:#374151; margin-top:8px">操作权限</div>
    ${actPerms.map((p) => `<label style="flex:0 0 30%"><input type="checkbox" value="${esc(p.code)}" class="r-perm-cb"> ${esc(p.name)} <code style="font-size:11px;color:#9ca3af">${esc(p.code)}</code></label>`).join('')}
  `;
  if (id) {
    const data = await apiGet('/api/roles/' + id + '/permissions');
    wrap.querySelectorAll('.r-perm-cb').forEach((cb) => { cb.checked = (data.items || []).includes(cb.value); });
    const r = ROLES.find((x) => x.id === id);
    if (r) {
      document.getElementById('r_code').value = r.built_in ? builtinRoleLabel(r.code) : r.code;
      document.getElementById('r_name').value = r.name;
      document.getElementById('r_desc').value = r.description || '';
    }
  } else {
    document.getElementById('r_code').value = '';
    document.getElementById('r_name').value = '';
    document.getElementById('r_desc').value = '';
  }
  // 品类为管理员专属菜单：仅当角色同时持有「系统管理」菜单时才允许勾选
  wrap.onchange = (e) => {
    const cb = e.target;
    if (!cb.classList || !cb.classList.contains('r-perm-cb') || cb.value !== 'page:categories' || !cb.checked) return;
    const adminCb = wrap.querySelector('.r-perm-cb[value="page:admin"]');
    if (!adminCb || !adminCb.checked) {
      cb.checked = false;
      toast('品类为管理员专属菜单，需同时勾选「系统管理」', 'error');
    }
  };
  openModal('roleModal');
}

async function saveRole() {
  const code = document.getElementById('r_code').value.trim();
  const name = document.getElementById('r_name').value.trim();
  const description = document.getElementById('r_desc').value.trim();
  const permission_codes = [...document.querySelectorAll('.r-perm-cb:checked')].map((cb) => cb.value);
  if (!code || !name) return toast('账号与姓名必填', 'error');
  try {
    if (editingRoleId) {
      await apiPut('/api/roles/' + editingRoleId, { name, description, permission_codes });
      toast('修改成功', 'success');
    } else {
      await apiPost('/api/roles', { code, name, description, permission_codes });
      toast('新增成功', 'success');
    }
    closeModal('roleModal');
    loadRoles();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteRole(id, name, builtIn) {
  const msg = builtIn
    ? '确定删除内置角色「' + name + '」吗？\n删除后，该角色用户将被解除关联，且重启服务也不会自动恢复。'
    : '确定删除角色「' + name + '」吗？';
  if (!await confirmDialog(msg)) return;
  try {
    await apiDelete('/api/roles/' + id);
    toast('已删除', 'success');
    loadRoles();
  } catch (e) { toast(e.message, 'error'); }
}

// ================= 品类管理（系统管理页内页签） =================
const catState = {
  page: 1,
  pageSize: 20,
  keyword: '',
  total: 0,
  editingId: null,
  selectedIds: new Set(),
};

async function loadCategories() {
  const params = new URLSearchParams({
    page: catState.page,
    pageSize: catState.pageSize,
    keyword: catState.keyword,
  });
  try {
    const data = await apiGet('/api/material-categories?' + params.toString());
    if (!data.items.length && data.page > 1) {
      catState.page--;
      return loadCategories();
    }
    catState.total = data.total;
    renderCategoryTable(data.items);
    renderCategoryPagination();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderCategoryTable(items) {
  window.__catItems = items;
  const body = document.getElementById('categoryBody');
  const empty = document.getElementById('emptyBox');
  const table = document.getElementById('catTable');
  if (!body || !empty || !table) return;
  if (!items.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    table.style.display = 'none';
    syncCategoryChecks();
    return;
  }
  empty.style.display = 'none';
  table.style.display = '';
  body.innerHTML = items.map((r) => `
    <tr>
      <td><input type="checkbox" class="cat-row-cb" value="${r.id}"></td>
      <td><b>${esc(r.big)}</b></td>
      <td>${r.mid ? esc(r.mid) : '-'}</td>
      <td>${r.small ? esc(r.small) : '-'}</td>
      <td class="actions">
        <button class="btn btn-sm" data-permission="action:edit" onclick="editCategory(${r.id})">编辑</button>
        <button class="btn btn-sm btn-danger" data-permission="action:delete" onclick="deleteCategory(${r.id})">删除</button>
      </td>
    </tr>`).join('');
  syncCategoryChecks();
}

function renderCategoryPagination() {
  const totalPages = Math.max(1, Math.ceil(catState.total / catState.pageSize));
  const el = document.getElementById('categoryPager');
  if (!el) return;
  if (catState.total === 0) { el.innerHTML = ''; return; }
  const pages = [];
  const push = (p, label, cls = '') => pages.push(`<button class="${cls}" ${p === catState.page ? '' : `onclick="goCategoryPage(${p})"`}>${label}</button>`);
  push(1, '«');
  const start = Math.max(2, catState.page - 2);
  const end = Math.min(totalPages - 1, catState.page + 2);
  for (let i = start; i <= end; i++) push(i, i, i === catState.page ? 'current' : '');
  push(totalPages, '»');
  el.style.display = 'flex';
  el.innerHTML = `
    <span>共 ${catState.total} 条 · 第 ${catState.page}/${totalPages} 页</span>
    ${pages.join('')}`;
}

function goCategoryPage(p) { catState.page = p; loadCategories(); }

function applyFilters() {
  const kw = document.getElementById('keyword');
  catState.keyword = kw ? kw.value.trim() : '';
  catState.page = 1;
  catState.selectedIds.clear();
  loadCategories();
}

function resetCategories() {
  const kw = document.getElementById('keyword');
  if (kw) kw.value = '';
  catState.keyword = '';
  catState.page = 1;
  catState.selectedIds.clear();
  loadCategories();
}

// ---------- 勾选 / 批量删除 ----------
function syncCategoryChecks() {
  const all = document.getElementById('selectAllCat');
  const cbs = [...document.querySelectorAll('.cat-row-cb')];
  cbs.forEach((cb) => {
    cb.checked = catState.selectedIds.has(parseInt(cb.value, 10));
  });
  const checkedCount = cbs.filter((cb) => cb.checked).length;
  if (all) all.checked = cbs.length > 0 && checkedCount === cbs.length;
  updateBulkDeleteBtn();
}

function updateBulkDeleteBtn() {
  const btn = document.getElementById('bulkDeleteCat');
  if (!btn) return;
  const n = catState.selectedIds.size;
  btn.disabled = n === 0;
  btn.textContent = n > 0 ? `🗑 批量删除(${n})` : '🗑 批量删除';
}

async function bulkDeleteCategories() {
  const ids = [...catState.selectedIds];
  if (!ids.length) return;
  const ok = await confirmDialog(`确定删除选中的 ${ids.length} 个品类吗？删除后不可恢复。`);
  if (!ok) return;
  try {
    const res = await apiDelete('/api/material-categories/batch', { ids });
    catState.selectedIds.clear();
    toast(`已删除 ${res.deleted || ids.length} 个品类`, 'success');
    loadCategories();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- 新增 / 编辑 / 删除品类 ----------
function openAddCategory() {
  catState.editingId = null;
  document.getElementById('modalTitle').textContent = '新增品类';
  for (const id of ['f_big', 'f_mid', 'f_small']) document.getElementById(id).value = '';
  openModal('categoryModal');
}

function editCategory(id) {
  const row = (window.__catItems || []).find((r) => r.id === id);
  if (!row) { toast('品类不存在', 'error'); return; }
  catState.editingId = id;
  document.getElementById('modalTitle').textContent = '编辑品类';
  document.getElementById('f_big').value = row.big || '';
  document.getElementById('f_mid').value = row.mid || '';
  document.getElementById('f_small').value = row.small || '';
  openModal('categoryModal');
}

async function saveCategory() {
  const data = {
    big: document.getElementById('f_big').value.trim(),
    mid: document.getElementById('f_mid').value.trim(),
    small: document.getElementById('f_small').value.trim(),
  };
  if (!data.big) { toast('物料大类不能为空', 'error'); return; }
  try {
    if (catState.editingId) {
      await apiPut('/api/material-categories/' + catState.editingId, data);
      toast('已保存', 'success');
    } else {
      await apiPost('/api/material-categories', data);
      toast('新增成功', 'success');
      catState.page = 1;
    }
    closeModal('categoryModal');
    loadCategories();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteCategory(id) {
  const row = (window.__catItems || []).find((r) => r.id === id);
  const ok = await confirmDialog(
    row ? `确定删除品类「${[row.big, row.mid, row.small].filter(Boolean).join(' / ')}」吗？删除后不可恢复。` : '确定删除该品类吗？删除后不可恢复。'
  );
  if (!ok) return;
  try {
    await apiDelete('/api/material-categories/' + id);
    catState.selectedIds.delete(id);
    toast('已删除', 'success');
    loadCategories();
  } catch (e) { toast(e.message, 'error'); }
}

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.sub-tab').forEach((btn) => btn.addEventListener('click', () => switchAdminTab(btn.dataset.tab)));

  // 品类页签：搜索回车 / 全选 / 行勾选（面板始终在 DOM 中，事件只需绑定一次）
  const kw = document.getElementById('keyword');
  if (kw) kw.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFilters(); });
  const selAll = document.getElementById('selectAllCat');
  if (selAll) selAll.addEventListener('change', (e) => {
    const cbs = [...document.querySelectorAll('.cat-row-cb')];
    if (e.target.checked) cbs.forEach((cb) => catState.selectedIds.add(parseInt(cb.value, 10)));
    else cbs.forEach((cb) => catState.selectedIds.delete(parseInt(cb.value, 10)));
    syncCategoryChecks();
  });
  const catBody = document.getElementById('categoryBody');
  if (catBody) catBody.addEventListener('change', (e) => {
    if (!e.target.classList || !e.target.classList.contains('cat-row-cb')) return;
    const id = parseInt(e.target.value, 10);
    if (e.target.checked) catState.selectedIds.add(id);
    else catState.selectedIds.delete(id);
    syncCategoryChecks();
  });
  setupBatchImport({
    api: 'material-categories',
    entity: '品类',
    requiredLabel: '物料大类',
    refresh: () => { catState.selectedIds.clear(); loadCategories(); },
    fields: [
      ['物料大类', 'big'], ['物料中类', 'mid'], ['物料小类', 'small'],
    ],
  });

  // 初始数据
  try {
    const r = await apiGet('/api/roles');
    ROLES = r.items || [];
  } catch (e) { /* ignore */ }
  loadUsers();

  // 支持 ?tab=categories 直达（原「品类」独立页 / 收藏链接跳转而来）
  const tab = new URLSearchParams(location.search).get('tab');
  if (tab) switchAdminTab(tab);
});