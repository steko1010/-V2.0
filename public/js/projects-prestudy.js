// ================= 预研专项分析（项目信息页分析看板） =================
// 预研专项的录入与列表功能已迁移至独立页面 prestudy.html（左侧导航「预研」），
// 此文件仅保留项目信息页分析看板中「预研专项分析」所需的函数。

function preBadge(cat) {
  const map = {
    'CG': ['CG', 'badge-blue'],
    'FPC': ['FPC', 'badge-green'],
    '背光': ['背光', 'badge-amber'],
  };
  const [label, cls] = map[cat] || [cat || '-', 'badge-gray'];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

async function loadPrestudyStats() {
  try {
    const res = await fetch('/api/prestudies/stats');
    const s = await res.json();
    if (!res.ok) throw new Error(s.message || '加载看板失败');
    document.getElementById('ps_st_total').textContent = s.total || 0;
    const find = (rows, name) => (rows.find((r) => r.name === name) || {}).value || 0;
    document.getElementById('ps_st_doing').textContent =
      find(s.byStatus, '进行中') + find(s.byStatus, '研发中') + find(s.byStatus, '推进中');
    document.getElementById('ps_st_done').textContent =
      find(s.byStatus, '已完成') + find(s.byStatus, '完成') + find(s.byStatus, '结项');
    document.getElementById('ps_st_paused').textContent =
      find(s.byStatus, '暂停') + find(s.byStatus, '搁置') + find(s.byStatus, '风险');
    psRenderBars('ps_barCategory', s.byCategory || [], '#2563eb');
    psRenderBars('ps_barStatus', s.byStatus || [], '#16a34a');
    psRenderBars('ps_barProgress', s.byProgress || [], '#d97706');
    psRenderBars('ps_barOwner', s.byOwner || [], '#7c3aed');
    psRenderRecent(s.recent || []);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function psRenderBars(elId, rows, color) {
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

function psRenderRecent(rows) {
  const body = document.getElementById('ps_recentBody');
  const empty = document.getElementById('ps_recentEmpty');
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
