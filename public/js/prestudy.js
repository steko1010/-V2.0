// ================= 预研专项 =================

// ---------- 子界面 Tab 切换 ----------
function switchPrestudyTab(name) {
  document.querySelectorAll('.sub-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.sub-panel').forEach((p) => {
    p.classList.toggle('active', p.id === 'panel-' + name);
  });
  if (name === 'dashboard') loadPrestudyStats(); // 显示看板时加载统计
}

let preList = [];
let prePage = 1;
let preTotal = 0;
const PRE_PAGE_SIZE = 10;

// ---------- 列表展示 ----------
async function loadPrestudies(page = 1) {
  const keyword = document.getElementById('pKeyword').value.trim();
  try {
    const params = new URLSearchParams({ page, pageSize: PRE_PAGE_SIZE });
    if (keyword) params.set('keyword', keyword);
    const res = await fetch('/api/prestudies?' + params.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || '加载失败');
    preList = data.items || [];
    prePage = data.page;
    preTotal = data.total;
    renderPrestudies(data.total, data.pages);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderPrestudies(total, pages) {
  const body = document.getElementById('prestudyBody');
  const empty = document.getElementById('prestudyEmpty');
  const pager = document.getElementById('prestudyPager');

  if (!preList.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    pager.style.display = 'none';
    const allCb = document.getElementById('preCheckAll');
    if (allCb) allCb.checked = false;
    return;
  }
  empty.style.display = 'none';

  body.innerHTML = preList.map((r, i) => `
    <tr>
      <td><input type="checkbox" class="pre-check" value="${r.id}"></td>
      <td>${(prePage - 1) * PRE_PAGE_SIZE + i + 1}</td>
      <td>${preBadge(r.category)}</td>
      <td><b>${esc(r.topic)}</b></td>
      <td>${esc(r.milestone_lx) || '-'}</td>
      <td>${esc(r.milestone_p1) || '-'}</td>
      <td>${esc(r.milestone_p2) || '-'}</td>
      <td>${esc(r.milestone_p3) || '-'}</td>
      <td class="spec" title="${esc(r.risk)}">${esc(r.risk) || '-'}</td>
      <td>${esc(r.status) || '-'}</td>
      <td>${esc(r.owner) || '-'}</td>
      <td>
        <div class="actions">
          <button class="btn btn-sm" data-permission="action:edit" onclick="openPrestudyModal(${r.id})">编辑</button>
          <button class="btn btn-sm btn-danger" data-permission="action:delete" onclick="deletePrestudy(${r.id})">删除</button>
        </div>
      </td>
    </tr>`).join('');

  // 分页
  pager.style.display = 'flex';
  pager.innerHTML = '';
  if (pages > 1) {
    pager.innerHTML = `
      <button class="btn btn-sm" ${prePage <= 1 ? 'disabled' : ''} onclick="loadPrestudies(${prePage - 1})">上一页</button>
      <span style="line-height:32px">第 ${prePage} / ${pages} 页（共 ${total} 条）</span>
      <button class="btn btn-sm" ${prePage >= pages ? 'disabled' : ''} onclick="loadPrestudies(${prePage + 1})">下一页</button>`;
  } else {
    pager.innerHTML = `<span style="line-height:32px">共 ${total} 条</span>`;
  }
  const allCb = document.getElementById('preCheckAll');
  if (allCb) allCb.checked = false;
}

function preBadge(cat) {
  const map = {
    'CG': ['CG', 'badge-blue'],
    'FPC': ['FPC', 'badge-green'],
    '背光': ['背光', 'badge-amber'],
    'IC': ['IC', 'badge-purple'],
  };
  const [label, cls] = map[cat] || [cat || '-', 'badge-gray'];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function resetPrestudies() {
  document.getElementById('pKeyword').value = '';
  loadPrestudies(1);
}

// ---------- 新增 / 编辑 / 删除 ----------
let editingId = null;

function openPrestudyModal(id) {
  editingId = id || null;
  document.getElementById('prestudyModalTitle').textContent = id ? '编辑预研专项' : '新增预研专项';
  document.getElementById('f_category').value = '';
  document.getElementById('f_topic').value = '';
  document.getElementById('f_risk').value = '';
  document.getElementById('f_milestone_lx').value = '';
  document.getElementById('f_milestone_p1').value = '';
  document.getElementById('f_milestone_p2').value = '';
  document.getElementById('f_milestone_p3').value = '';
  document.getElementById('f_status').value = '';
  document.getElementById('f_owner').value = '';
  if (id) {
    const r = preList.find((x) => x.id === id);
    if (r) {
      setCategoryValue('f_category', r.category || '');
      document.getElementById('f_topic').value = r.topic || '';
      document.getElementById('f_risk').value = r.risk || '';
      document.getElementById('f_milestone_lx').value = r.milestone_lx || '';
      document.getElementById('f_milestone_p1').value = r.milestone_p1 || '';
      document.getElementById('f_milestone_p2').value = r.milestone_p2 || '';
      document.getElementById('f_milestone_p3').value = r.milestone_p3 || '';
      document.getElementById('f_status').value = r.status || '';
      document.getElementById('f_owner').value = r.owner || '';
    }
  }
  document.getElementById('prestudyModal').style.display = 'flex';
}

function closePrestudyModal() {
  document.getElementById('prestudyModal').style.display = 'none';
}

async function savePrestudy() {
  const payload = {
    category: document.getElementById('f_category').value,
    topic: document.getElementById('f_topic').value.trim(),
    risk: document.getElementById('f_risk').value.trim(),
    milestone_lx: document.getElementById('f_milestone_lx').value.trim(),
    milestone_p1: document.getElementById('f_milestone_p1').value.trim(),
    milestone_p2: document.getElementById('f_milestone_p2').value.trim(),
    milestone_p3: document.getElementById('f_milestone_p3').value.trim(),
    status: document.getElementById('f_status').value.trim(),
    owner: document.getElementById('f_owner').value.trim(),
  };
  if (!payload.topic) return toast('专项名称不能为空', 'error');
  if (!payload.category) return toast('请选择物料品类', 'error');
  try {
    const res = await fetch(editingId ? `/api/prestudies/${editingId}` : '/api/prestudies', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || '保存失败');
    }
    toast('保存成功');
    closePrestudyModal();
    loadPrestudies(editingId ? prePage : 1);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deletePrestudy(id) {
  if (!await confirmDialog('确定删除该预研专项？')) return;
  try {
    const res = await fetch(`/api/prestudies/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || '删除失败');
    }
    toast('已删除');
    // 行删除：直接从当前列表移除该行并重渲染
    preList = preList.filter((r) => r.id !== id);
    preTotal = Math.max(0, preTotal - 1);
    if (preList.length === 0 && prePage > 1) {
      // 当前页删空且非第一页，回退一页加载
      loadPrestudies(prePage - 1);
    } else {
      renderPrestudies(preTotal, Math.max(1, Math.ceil(preTotal / PRE_PAGE_SIZE)));
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ---------- 批量删除 ----------
function togglePreAll(cb) {
  document.querySelectorAll('#prestudyBody .pre-check').forEach((x) => { x.checked = cb.checked; });
}

async function batchDeletePrestudies() {
  const ids = [...document.querySelectorAll('#prestudyBody .pre-check:checked')].map((x) => parseInt(x.value, 10));
  if (!ids.length) return toast('请先勾选要删除的预研专项', 'error');
  if (!await confirmDialog(`确定删除选中的 ${ids.length} 个预研专项？`)) return;
  const allCb = document.getElementById('preCheckAll');
  let ok = 0;
  try {
    for (const id of ids) {
      const res = await fetch(`/api/prestudies/${id}`, { method: 'DELETE' });
      if (res.ok) ok++;
    }
    if (allCb) allCb.checked = false;
    toast(`已删除 ${ok} 条`, ok === ids.length ? 'success' : 'error');
    // 刷新当前页（若删空则自动回退）
    if (preList.length === ids.length && prePage > 1) {
      loadPrestudies(prePage - 1);
    } else {
      loadPrestudies(prePage);
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ---------- 看板 ----------
async function loadPrestudyStats() {
  try {
    const res = await fetch('/api/prestudies/stats');
    const s = await res.json();
    if (!res.ok) throw new Error(s.message || '加载看板失败');
    document.getElementById('st_total').textContent = s.total || 0;
    const find = (rows, name) => (rows.find((r) => r.name === name) || {}).value || 0;
    document.getElementById('st_doing').textContent =
      find(s.byStatus, '进行中') + find(s.byStatus, '研发中') + find(s.byStatus, '推进中');
    document.getElementById('st_done').textContent =
      find(s.byStatus, '已完成') + find(s.byStatus, '完成') + find(s.byStatus, '结项');
    document.getElementById('st_paused').textContent =
      find(s.byStatus, '暂停') + find(s.byStatus, '搁置') + find(s.byStatus, '风险');
    renderBars('barCategory', s.byCategory || [], '#2563eb');
    renderBars('barStatus', s.byStatus || [], '#16a34a');
    renderBars('barProgress', s.byProgress || [], '#d97706');
    renderBars('barOwner', s.byOwner || [], '#7c3aed');
    renderRecent(s.recent || []);
  } catch (e) {
    toast(e.message, 'error');
  }
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

function renderRecent(rows) {
  const body = document.getElementById('recentBody');
  const empty = document.getElementById('recentEmpty');
  if (!rows.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  body.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${preBadge(r.category)}</td>
      <td><b>${esc(r.topic)}</b></td>
      <td>${esc(r.milestone_lx) || '-'}</td>
      <td>${esc(r.milestone_p1) || '-'}</td>
      <td>${esc(r.milestone_p2) || '-'}</td>
      <td>${esc(r.milestone_p3) || '-'}</td>
      <td>${esc(r.status) || '-'}</td>
      <td>${esc(r.owner) || '-'}</td>
    </tr>`).join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  setupBatchImport({
    api: 'prestudies',
    entity: '预研专项',
    requiredLabel: '专项名称',
    refresh: () => loadPrestudies(1),
    fields: [
      ['物料品类', 'category'], ['专项名称', 'topic'], ['风险', 'risk'],
      ['立项', 'milestone_lx'], ['P1', 'milestone_p1'], ['P2', 'milestone_p2'], ['P3', 'milestone_p3'],
      ['状态', 'status'], ['责任人', 'owner'],
    ],
  });
  document.querySelectorAll('.sub-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchPrestudyTab(btn.dataset.tab));
  });
  await renderCategoryOptions('f_category', '请选择');
  loadPrestudies(1);
});
