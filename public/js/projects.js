// ================= 项目信息：两个子界面 =================

let editingId = null;
let projectItems = [];
let pImportRows = [];

// 项目规格字段：[中文列名, 数据库字段, 弹窗分组]（顺序即列表呈现顺序）
const PROJECT_SPEC_FIELDS = [
  ['基线', 'baseline', '立项信息'],
  ['量产封样时间', 'mass_production_sample_date', '立项信息'],
  ['项目尺寸', 'project_size', '立项信息'],
  ['MOD厂', 'mod_factory', '模组器件'],
  ['MOD料号', 'mod_part_no', '模组器件'],
  ['panel', 'panel', '模组器件'],
  ['IC', 'ic', '模组器件'],
  ['CG厂', 'cg_factory', '模组器件'],
  ['CG材质', 'cg_material', '模组器件'],
  ['FPC', 'fpc', '模组器件'],
  ['OCA', 'oca', '模组器件'],
  ['POL', 'pol', '模组器件'],
  ['COG-ACF', 'cog_acf', '制程胶材'],
  ['FOG-ACF', 'fog_acf', '制程胶材'],
  ['元器件包封胶', 'component_sealant', '制程胶材'],
  ['一线胶', 'one_line_glue', '制程胶材'],
  ['面胶', 'face_glue', '制程胶材'],
  ['银浆', 'silver_paste', '制程胶材'],
  ['硅酮胶', 'silicone_glue', '制程胶材'],
  ['盲孔一道胶', 'blind_hole_glue_1', '制程胶材'],
  ['盲孔二道胶', 'blind_hole_glue_2', '制程胶材'],
  ['背光厂', 'backlight_factory', '背光模组'],
  ['遮光胶', 'shading_tape', '背光模组'],
  ['上/下增光', 'upper_lower_brightness', '背光模组'],
  ['扩散', 'diffuser', '背光模组'],
  ['LED灯胶', 'led_glue', '背光模组'],
  ['反射', 'reflector', '背光模组'],
  ['LED', 'led', '背光模组'],
  ['LGP', 'lgp', '背光模组'],
  ['胶框', 'glue_frame', '背光模组'],
  ['铁框', 'iron_frame', '背光模组'],
];

// ---------- 子界面 Tab 切换 ----------
function switchTab(name) {
  document.querySelectorAll('.sub-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.sub-panel').forEach((p) => {
    p.classList.toggle('active', p.id === 'panel-' + name);
  });
  if (name === 'manage') loadProjects();
  if (name === 'analysis') {
    loadStats();
    loadPrestudyStats();
  }
}

// ---------- 工具函数 ----------
function collectFlow(el) {
  return String(el.value || '')
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' → ');
}

function sourceBadge(src) {
  if (src === '文档导入') return '<span class="badge dev">📄 文档导入</span>';
  return '<span class="badge">手动</span>';
}

// ---------- 项目 Excel 批量导入（信息管理） ----------

function openProjectImportModal() {
  pImportRows = [];
  document.getElementById('pImportFile').value = '';
  document.getElementById('pImportPreviewWrap').style.display = 'none';
  document.getElementById('pImportResult').innerHTML = '';
  document.getElementById('btnConfirmPImport').disabled = true;
  openModal('projectImportModal');
}

// 下载导入模板
function downloadProjectImportTemplate() {
  if (typeof XLSX === 'undefined') { toast('Excel 解析库加载失败，请检查网络后刷新', 'error'); return; }
  const headers = ['项目名称', ...PROJECT_SPEC_FIELDS.map(([label]) => label)];
  const sample = ['示例项目', ...PROJECT_SPEC_FIELDS.map(() => '')];
  const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '项目导入模板');
  XLSX.writeFile(wb, '项目信息导入模板.xlsx');
}

// 解析 Excel 文件并预览
function parseProjectImportExcel() {
  const file = document.getElementById('pImportFile').files[0];
  if (!file) { toast('请先选择 Excel 文件', 'error'); return; }
  if (typeof XLSX === 'undefined') { toast('Excel 解析库加载失败，请检查网络后刷新', 'error'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
      if (!grid.length) { toast('文件中没有数据', 'error'); return; }
      // 表头名 -> 数据库字段 的映射
      const specMap = {};
      PROJECT_SPEC_FIELDS.forEach(([label, field]) => {
        specMap[label] = field;
        specMap[label.toLowerCase()] = field;
        specMap[field.toLowerCase()] = field;
      });
      const norm = (s) => String(s || '').trim().toLowerCase();
      // 匹配表头：先按原始（小写化）匹配，再尝试把连字符转下划线（COG-ACF -> cog_acf）
      const toField = (c) => {
        const k = norm(c);
        return specMap[k] || specMap[k.replace(/-/g, '_')] || null;
      };
      const isNameCol = (k) => ['项目名称', '项目', 'project_name'].includes(norm(k));
      // 智能识别表头行：扫描前 20 行，取命中规格列最多的一行
      // （兼容第一行是说明/合并行的表格）
      let headerIdx = -1, best = 0;
      for (let i = 0; i < Math.min(grid.length, 20); i++) {
        const hit = grid[i].filter((c) => {
          const k = norm(c);
          return k && (toField(c) || isNameCol(k));
        }).length;
        if (hit > best) { best = hit; headerIdx = i; }
      }
      if (headerIdx < 0 || best < 3) { toast('未识别到规格表头，请使用「下载导入模板」', 'error'); return; }
      const colField = grid[headerIdx].map((c) => {
        if (isNameCol(c)) return 'project_name';
        return toField(c);
      });
      pImportRows = [];
      for (let i = headerIdx + 1; i < grid.length; i++) {
        const r = grid[i];
        if (!r.some((c) => String(c).trim() !== '')) continue; // 跳过空行
        const out = { project_name: '' };
        PROJECT_SPEC_FIELDS.forEach(([, field]) => (out[field] = ''));
        colField.forEach((field, ci) => {
          if (field && ci < r.length) out[field] = String(r[ci]).trim();
        });
        pImportRows.push(out);
      }
      // 项目名称自动生成：MOD厂 + 项目尺寸（重复名称追加序号）
      const dup = {};
      pImportRows = pImportRows.map((r) => {
        if (!r.project_name) r.project_name = [r.mod_factory, r.project_size].filter(Boolean).join(' ');
        if (!r.project_name) r.project_name = '未命名项目';
        dup[r.project_name] = (dup[r.project_name] || 0) + 1;
        if (dup[r.project_name] > 1) r.project_name = `${r.project_name} (${dup[r.project_name]})`;
        return r;
      });
      renderProjectImportPreview();
    } catch (err) {
      toast('文件解析失败：' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderProjectImportPreview() {
  const wrap = document.getElementById('pImportPreviewWrap');
  const head = document.getElementById('pImportPreviewHead');
  const body = document.getElementById('pImportPreviewBody');
  const result = document.getElementById('pImportResult');
  const valid = pImportRows.filter((r) => r.project_name);
  const invalid = pImportRows.length - valid.length;
  wrap.style.display = 'block';
  const cols = ['项目名称', ...PROJECT_SPEC_FIELDS.map(([label]) => label)];
  head.innerHTML = `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
  body.innerHTML = pImportRows.map((r, i) => `
    <tr${r.project_name ? '' : ' style="background:#fef2f2;"'}>
      <td><b>${esc(r.project_name) || '<span style="color:var(--danger)">（缺少项目名称）</span>'}</b></td>
      ${PROJECT_SPEC_FIELDS.map(([, field]) => `<td class="spec" title="${esc(r[field])}">${esc(r[field]) || '-'}</td>`).join('')}
    </tr>`).join('');
  result.innerHTML = `
    <div style="padding:10px 14px; border-radius:8px; background:${invalid ? 'var(--danger-soft,#fef2f2)' : 'var(--ok-soft,#ecfdf5)'}; margin-bottom:12px;">
      共解析 <b>${pImportRows.length}</b> 行，有效 <b>${valid.length}</b> 行${invalid ? `，<b style="color:var(--danger)">缺少项目名称 ${invalid} 行（将被跳过）</b>` : ''}。
    </div>`;
  document.getElementById('btnConfirmPImport').disabled = valid.length === 0;
}

async function confirmProjectImport() {
  const valid = pImportRows.filter((r) => r.project_name);
  if (!valid.length) { toast('没有可导入的有效数据', 'error'); return; }
  const btn = document.getElementById('btnConfirmPImport');
  btn.disabled = true;
  btn.textContent = '导入中...';
  try {
    const res = await apiPost('/api/projects/batch', { items: valid });
    const msg = `导入完成：成功 ${res.success} 条` +
      (res.errors && res.errors.length ? `，失败 ${res.errors.length} 条（项目名称缺失）` : '');
    toast(msg, res.errors && res.errors.length ? 'error' : 'success');
    closeModal('projectImportModal');
    await loadProjects();
  } catch (e) { toast(e.message, 'error'); }
  finally {
    btn.disabled = false;
    btn.textContent = '确认导入';
  }
}

// ================= 子界面二：信息管理（新建 / 修改 / 删除） =================

// 分页状态：默认每页 5 条
let pPage = 1;
let pPages = 1;
let pTotal = 0;
const PAGE_SIZE = 10;

async function loadProjects(targetPage) {
  const page = targetPage || pPage;
  if (page < 1 || (pPages > 0 && page > pPages)) return;
  const keyword = document.getElementById('pKeyword').value.trim();
  const qs = [`page=${page}`, `pageSize=${PAGE_SIZE}`];
  if (keyword) qs.push('keyword=' + encodeURIComponent(keyword));
  const data = await apiGet('/api/projects?' + qs.join('&'));
  projectItems = data.items || [];
  pTotal = data.total || 0;
  pPages = data.pages || 1;
  pPage = data.page || page;
  renderProjects();
}

function buildProjectHead() {
  const cols = ['项目名称', ...PROJECT_SPEC_FIELDS.map(([label]) => label), '来源', '录入时间', '操作'];
  document.getElementById('projectHead').innerHTML = `<tr>
    <th style="width:36px"><input type="checkbox" id="projCheckAll" onclick="toggleProjAll(this)" title="全选本页"></th>
    ${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
}

function renderProjects() {
  const tbody = document.getElementById('projectBody');
  document.getElementById('projectEmpty').style.display = projectItems.length ? 'none' : 'block';
  tbody.innerHTML = projectItems
    .map((p) => `
      <tr>
        <td><input type="checkbox" class="proj-check" value="${p.id}"></td>
        <td><b>${esc(p.project_name)}</b></td>
        ${PROJECT_SPEC_FIELDS.map(([, field]) => `<td class="spec" title="${esc(p[field])}">${esc(p[field]) || '-'}</td>`).join('')}
        <td>${sourceBadge(p.source)}</td>
        <td>${esc(p.created_at)}</td>
        <td>
          <div class="actions">
            <button class="btn btn-sm" data-permission="action:edit" onclick="openProjectModal(${p.id})">编辑</button>
            <button class="btn btn-sm btn-danger" data-permission="action:delete" onclick="deleteProject(${p.id})">删除</button>
          </div>
        </td>
      </tr>`)
    .join('');
  renderProjectPager();
  const allCb = document.getElementById('projCheckAll');
  if (allCb) allCb.checked = false;
}

// 底部翻页控件：上一页 / 下一页 / 共 x 页
function renderProjectPager() {
  const el = document.getElementById('projectPager');
  if (!el) return;
  if (pPages <= 1) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = 'flex';
  el.innerHTML = `
    <button class="btn btn-sm" onclick="loadProjects(1)" ${pPage <= 1 ? 'disabled' : ''}>⏮ 首页</button>
    <button class="btn btn-sm" onclick="loadProjects(${pPage - 1})" ${pPage <= 1 ? 'disabled' : ''}>◀ 上一页</button>
    <span class="pager-info">第 ${pPage} / ${pPages} 页 · 共 ${pTotal} 条</span>
    <button class="btn btn-sm" onclick="loadProjects(${pPage + 1})" ${pPage >= pPages ? 'disabled' : ''}>下一页 ▶</button>
    <button class="btn btn-sm" onclick="loadProjects(${pPages})" ${pPage >= pPages ? 'disabled' : ''}>末页 ⏭</button>`;
}

function resetProjects() {
  document.getElementById('pKeyword').value = '';
  loadProjects(1);
}

// 批量导出当前查询结果（按搜索条件过滤，导出全部匹配项）为 Excel
async function exportProjects() {
  try {
    const keyword = document.getElementById('pKeyword').value.trim();
    const qs = keyword ? '?keyword=' + encodeURIComponent(keyword) : '';
    const res = await fetch('/api/projects/export' + qs);
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
    a.download = `项目信息_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('导出成功', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

// 生成规格字段分组表单（prefix 决定 id 前缀，containerId 为目标容器）
function buildSpecFieldGrid(containerId, prefix) {
  const groups = {};
  PROJECT_SPEC_FIELDS.forEach(([label, field, group]) => {
    if (!groups[group]) groups[group] = [];
    groups[group].push([label, field]);
  });
  document.getElementById(containerId).innerHTML = Object.entries(groups)
    .map(([group, items]) => `
      <div class="form-section">${esc(group)}</div>
      ${items.map(([label, field]) => `
        <div class="form-item">
          <label>${esc(label)}</label>
          <input id="${prefix}_${field}" placeholder="${esc(label)}">
        </div>`).join('')}`)
    .join('');
}

// 弹窗（信息管理）中的规格字段分组表单
function buildSpecFields() {
  buildSpecFieldGrid('specFields', 'f');
}

function openProjectModal(id) {
  editingId = id || null;
  const row = id ? projectItems.find((p) => p.id === id) : null;
  document.getElementById('projectModalTitle').textContent = row ? '编辑项目信息' : '新建项目信息';
  document.getElementById('f_project_name').value = row ? row.project_name : '';
  document.getElementById('f_supplier').value = row ? row.supplier : '';
  setCategoryValue('f_category', row ? row.category : '');
  document.getElementById('f_flow').value = row ? String(row.flow).replace(/\s*[→>]\s*/g, '\n') : '';
  PROJECT_SPEC_FIELDS.forEach(([, field]) => {
    const el = document.getElementById('f_' + field);
    if (el) el.value = row ? row[field] || '' : '';
  });
  openModal('projectModal');
}

async function saveProject() {
  const payload = {
    project_name: document.getElementById('f_project_name').value.trim(),
    supplier: document.getElementById('f_supplier').value.trim(),
    category: document.getElementById('f_category').value.trim(),
    flow: collectFlow(document.getElementById('f_flow')),
  };
  PROJECT_SPEC_FIELDS.forEach(([, field]) => {
    const el = document.getElementById('f_' + field);
    payload[field] = el ? el.value.trim() : '';
  });
  if (!payload.project_name) return toast('项目名称不能为空', 'error');
  try {
    if (editingId) {
      await apiPut('/api/projects/' + editingId, payload);
      toast('修改成功', 'success');
    } else {
      await apiPost('/api/projects', payload);
      toast('新建成功', 'success');
    }
    closeModal('projectModal');
    loadProjects();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteProject(id) {
  if (!await confirmDialog('确定删除该项目信息吗？')) return;
  try {
    await apiDelete('/api/projects/' + id);
    toast('已删除', 'success');
    // 若当前页删空且不是第一页，则回退一页
    if (projectItems.length === 1 && pPage > 1) pPage -= 1;
    loadProjects(pPage);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ---------- 批量删除 ----------
function toggleProjAll(cb) {
  document.querySelectorAll('#projectBody .proj-check').forEach((x) => { x.checked = cb.checked; });
}

async function batchDeleteProjects() {
  const ids = [...document.querySelectorAll('#projectBody .proj-check:checked')].map((x) => parseInt(x.value, 10));
  if (!ids.length) return toast('请先勾选要删除的项目信息', 'error');
  if (!await confirmDialog(`确定删除选中的 ${ids.length} 条项目信息？`)) return;
  const allCb = document.getElementById('projCheckAll');
  let ok = 0;
  try {
    for (const id of ids) {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (res.ok) ok++;
    }
    if (allCb) allCb.checked = false;
    toast(`已删除 ${ok} 条`, ok === ids.length ? 'success' : 'error');
    // 若整页删空且不是第一页，则回退一页
    if (projectItems.length === ids.length && pPage > 1) pPage -= 1;
    loadProjects(pPage);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ================= 子界面二：分析展示 =================

async function loadStats() {
  const s = await apiGet('/api/projects/stats');
  document.getElementById('st_total').textContent = s.total;
  document.getElementById('st_suppliers').textContent = s.suppliers.length;
  document.getElementById('st_categories').textContent = s.categories.length;
  document.getElementById('st_flow').textContent = s.flowCoverage + '%';
  renderBars('barSuppliers', s.suppliers, '#2563eb');
  renderBars('barCategories', s.categories, '#16a34a');
  renderRecent(s.recent || []);
}

function renderBars(elId, rows, color) {
  const el = document.getElementById(elId);
  if (!rows.length) {
    el.innerHTML = '<div class="empty" style="padding:28px 0"><div class="big">📭</div><div>暂无数据</div></div>';
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
  const el = document.getElementById('recentProjects');
  if (!rows.length) {
    el.innerHTML = '<div class="empty" style="padding:28px 0"><div class="big">📭</div><div>暂无数据</div></div>';
    return;
  }
  el.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>项目名称</th>
            <th>供应商</th>
            <th>品类</th>
            <th>流程</th>
            <th>来源</th>
            <th>录入时间</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td><b>${esc(r.project_name)}</b></td>
              <td>${esc(r.supplier) || '-'}</td>
              <td>${esc(r.category) || '-'}</td>
              <td class="flow-cell" title="${esc(r.flow)}">${esc(r.flow) || '-'}</td>
              <td>${sourceBadge(r.source)}</td>
              <td>${esc(r.created_at)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ---------- 初始化 ----------
document.addEventListener('DOMContentLoaded', async () => {
  buildProjectHead();
  buildSpecFields();
  document.querySelectorAll('.sub-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.getElementById('pKeyword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadProjects(1);
  });
  // 项目品类下拉：数据源 = 品类管理中维护的物料中类
  await renderCategoryOptions('f_category', '请选择');
  // 预加载列表（供供应商 datalist 使用）
  loadProjects().catch(() => {});
});
