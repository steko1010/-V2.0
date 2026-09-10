// ================= 稽核 =================

// ---------- 子界面 Tab 切换 ----------
function switchAuditTab(name) {
  document.querySelectorAll('.sub-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.sub-panel').forEach((p) => {
    p.classList.toggle('active', p.id === 'panel-' + name);
  });
  if (name === 'dashboard') loadStats(); // 显示看板时重新渲染图表
}

let editingId = null;
let auditItems = [];
let auditPage = 1;
let auditPages = 1;
let auditTotal = 0;
const AUDIT_PAGE_SIZE = 10;

function auditResultBadge(result) {
  const color = {
    '合格': 'done',
    '有条件合格': 'cert',
    '不合格': 'dead',
  }[result] || '';
  return `<span class="badge ${color}">${esc(result || '-')}</span>`;
}

function materialTypeBadge(t) {
  if (!t) return '-';
  const cls = { FPC: 'done', CG: 'cert', '背光': 'doc-yes', IC: 'badge-purple' }[t] || '';
  return `<span class="badge ${cls}">${esc(t)}</span>`;
}

async function loadAudits(page) {
  const keyword = document.getElementById('keyword').value.trim();
  const result = document.getElementById('filterResult').value;
  const materialType = document.getElementById('filterMaterialType').value;
  const params = new URLSearchParams({ page: page || auditPage, pageSize: AUDIT_PAGE_SIZE });
  if (keyword) params.set('keyword', keyword);
  if (result) params.set('result', result);
  if (materialType) params.set('materialType', materialType);
  const data = await apiGet('/api/audits?' + params.toString());
  auditItems = data.items || [];
  auditPage = data.page;
  auditPages = data.pages;
  auditTotal = data.total;
  renderAudits();
}

function renderAudits() {
  const tbody = document.getElementById('auditBody');
  const pager = document.getElementById('auditPager');
  document.getElementById('emptyBox').style.display = auditItems.length ? 'none' : 'block';
  if (!auditItems.length) {
    tbody.innerHTML = '';
    pager.style.display = 'none';
    const allCb = document.getElementById('auditCheckAll');
    if (allCb) allCb.checked = false;
    return;
  }
  pager.style.display = 'flex';
  pager.innerHTML = auditPages > 1
    ? `
      <button class="btn btn-sm" ${auditPage <= 1 ? 'disabled' : ''} onclick="goAuditPage(${auditPage - 1})">上一页</button>
      <span style="line-height:32px">第 ${auditPage} / ${auditPages} 页（共 ${auditTotal} 条）</span>
      <button class="btn btn-sm" ${auditPage >= auditPages ? 'disabled' : ''} onclick="goAuditPage(${auditPage + 1})">下一页</button>`
    : `<span style="line-height:32px">共 ${auditTotal} 条</span>`;
  tbody.innerHTML = auditItems
    .map((a) => `
      <tr>
        <td><input type="checkbox" class="audit-check" value="${a.id}"></td>
        <td>${materialTypeBadge(a.material_type)}</td>
        <td>${esc(a.audit_date) || '-'}</td>
        <td><b>${esc(a.supplier)}</b></td>
        <td class="flow-cell" title="${esc(a.scope)}">${esc(a.scope) || '-'}</td>
        <td>${auditResultBadge(a.result)}</td>
        <td>${esc(a.auditor) || '-'}</td>
        <td>
          <div class="actions">
            <button class="btn btn-sm" data-permission="action:edit" onclick="openAuditModal(${a.id})">编辑</button>
            <button class="btn btn-sm btn-danger" data-permission="action:delete" onclick="deleteAudit(${a.id})">删除</button>
          </div>
        </td>
      </tr>`)
    .join('');
  const allCb = document.getElementById('auditCheckAll');
  if (allCb) allCb.checked = false;
}

function resetAudits() {
  document.getElementById('keyword').value = '';
  document.getElementById('filterResult').value = '';
  document.getElementById('filterMaterialType').value = '';
  loadAudits(1);
}

function goAuditPage(p) {
  auditPage = p;
  loadAudits(p);
}

function openAuditModal(id) {
  editingId = id || null;
  const row = id ? auditItems.find((a) => a.id === id) : null;
  document.getElementById('modalTitle').textContent = row ? '编辑稽核' : '新增稽核';
  setCategoryValue('f_material_type', row ? row.material_type : '');
  document.getElementById('f_audit_date').value = row ? row.audit_date : '';
  document.getElementById('f_supplier').value = row ? row.supplier : '';
  document.getElementById('f_auditor').value = row ? row.auditor : '';
  document.getElementById('f_scope').value = row ? row.scope : '';
  document.getElementById('f_result').value = row ? row.result : '合格';
  openModal('auditModal');
}

async function saveAudit() {
  const payload = {
    material_type: document.getElementById('f_material_type').value,
    audit_date: document.getElementById('f_audit_date').value,
    supplier: document.getElementById('f_supplier').value.trim(),
    auditor: document.getElementById('f_auditor').value.trim(),
    scope: document.getElementById('f_scope').value.trim(),
    result: document.getElementById('f_result').value,
  };
  if (!payload.material_type) return toast('请选择物料品类', 'error');
  if (!payload.supplier) return toast('稽核供应商不能为空', 'error');
  try {
    if (editingId) {
      await apiPut('/api/audits/' + editingId, payload);
      toast('修改成功', 'success');
    } else {
      await apiPost('/api/audits', payload);
      toast('新增成功', 'success');
    }
    closeModal('auditModal');
    loadAudits();
    loadStats();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteAudit(id) {
  if (!await confirmDialog('确定删除该稽核记录吗？')) return;
  try {
    await apiDelete('/api/audits/' + id);
    toast('已删除', 'success');
    // 若当前页删空且不是第一页，则回退一页
    if (auditItems.length === 1 && auditPage > 1) auditPage -= 1;
    loadAudits();
    loadStats();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ---------- 批量删除 ----------
function toggleAuditAll(cb) {
  document.querySelectorAll('#auditBody .audit-check').forEach((x) => { x.checked = cb.checked; });
}

async function batchDeleteAudits() {
  const ids = [...document.querySelectorAll('#auditBody .audit-check:checked')].map((x) => parseInt(x.value, 10));
  if (!ids.length) return toast('请先勾选要删除的稽核记录', 'error');
  if (!await confirmDialog(`确定删除选中的 ${ids.length} 条稽核记录？`)) return;
  const allCb = document.getElementById('auditCheckAll');
  let ok = 0;
  try {
    for (const id of ids) {
      const res = await fetch(`/api/audits/${id}`, { method: 'DELETE' });
      if (res.ok) ok++;
    }
    if (allCb) allCb.checked = false;
    toast(`已删除 ${ok} 条`, ok === ids.length ? 'success' : 'error');
    // 若整页删空且不是第一页，则回退一页
    if (auditItems.length === ids.length && auditPage > 1) auditPage -= 1;
    loadAudits();
    loadStats();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadStats() {
  const s = await apiGet('/api/audits/stats');
  const find = (rows, name) => (rows.find((r) => r.name === name) || {}).value || 0;
  document.getElementById('st_total').textContent = s.total || 0;
  document.getElementById('st_pass').textContent = find(s.byResult, '合格') + find(s.byResult, '有条件合格');
  document.getElementById('st_fail').textContent = find(s.byResult, '不合格');
  renderBars('barResult', s.byResult || [], '#2563eb');
  const bySup = (s.bySupplier || []).slice(0, 8);
  renderBars('barSupplier', bySup.map((i) => ({ name: i.name, value: i.count })), '#0d9488');
  renderBars('barIssues', bySup.map((i) => ({ name: i.name, value: i.issueCount })), '#d97706');
  renderTrend('trendChart', s.issueTrend || { years: [], series: [] });
}

const TREND_COLORS = ['#2563eb', '#d97706', '#0d9488', '#dc2626', '#7c3aed', '#ca8a04'];

// 年度问题个数趋势：横轴=年，纵轴=问题个数，每个供应商一条折线（纯 SVG 绘制）
function renderTrend(elId, trend) {
  const el = document.getElementById(elId);
  const years = trend.years || [];
  const series = trend.series || [];
  if (!years.length || !series.length) {
    el.innerHTML = '<div class="empty" style="padding:24px 0"><div class="big">📭</div><div>暂无数据</div></div>';
    return;
  }
  const W = 760, H = 260, PL = 44, PR = 16, PT = 18, PB = 30;
  const iw = W - PL - PR, ih = H - PT - PB;
  const maxV = Math.max(1, ...series.map((s) => Math.max(...s.values)));
  const step = niceStep(maxV);
  const maxAxis = Math.ceil(maxV / step) * step;
  const x = (i) => (years.length === 1 ? PL + iw / 2 : PL + (i / (years.length - 1)) * iw);
  const y = (v) => PT + ih - (v / maxAxis) * ih;

  let html = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">`;
  for (let v = 0; v <= maxAxis; v += step) {
    const yy = y(v);
    html += `<line x1="${PL}" y1="${yy}" x2="${W - PR}" y2="${yy}" stroke="#e5e7eb" stroke-dasharray="3 3"/>`;
    html += `<text x="${PL - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#9ca3af">${v}</text>`;
  }
  years.forEach((yr, i) => {
    html += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="12" fill="#6b7280">${esc(yr)}</text>`;
  });
  series.forEach((s, si) => {
    const color = TREND_COLORS[si % TREND_COLORS.length];
    const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    html += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    s.values.forEach((v, i) => {
      html += `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="#fff" stroke="${color}" stroke-width="2"><title>${esc(s.name)} ${esc(years[i])}：${v} 个问题</title></circle>`;
    });
  });
  html += '</svg>';
  html += '<div class="trend-legend">' + series
    .map((s, si) => `<span class="trend-legend-item"><i style="background:${TREND_COLORS[si % TREND_COLORS.length]}"></i>${esc(s.name)}</span>`)
    .join('') + '</div>';
  el.innerHTML = html;
}

// 纵轴刻度取整：使刻度数为 1~4 之间且为 1/2/5 的倍数
function niceStep(maxV) {
  const raw = maxV / 4;
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const f = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return f * pow;
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
          <div class="bar-label">${esc(r.name)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <div class="bar-value">${r.value}</div>
        </div>`;
    })
    .join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('keyword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadAudits(1);
  });
  setupBatchImport({
    api: 'audits',
    entity: '稽核',
    requiredLabel: '供应商',
    refresh: () => { loadAudits(); loadStats(); },
    fields: [
      ['物料品类', 'material_type'], ['时间', 'audit_date'], ['供应商', 'supplier'],
      ['稽核内容', 'scope'], ['稽核结果', 'result'], ['稽核人员', 'auditor'],
    ],
  });
  document.querySelectorAll('.sub-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchAuditTab(btn.dataset.tab));
  });
  await renderCategoryOptions('filterMaterialType', '全部物料品类');
  await renderCategoryOptions('f_material_type', '请选择');
  // 供应商输入框候选值：数据源 = 供应商信息中维护的供应商
  await renderSupplierDatalist('supList');
  loadAudits();
  loadStats();
});
