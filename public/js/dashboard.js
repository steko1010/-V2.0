const charts = {};
const STATUS_COLORS = {
  '绿区': '#10b981', '黄区': '#f59e0b', '红区': '#ef4444',
};

function initCharts() {
  if (typeof echarts === 'undefined') {
    toast('图表库加载失败，请检查网络后刷新', 'error');
    return;
  }
  charts.status = echarts.init(document.getElementById('chartStatus'));
  charts.category = echarts.init(document.getElementById('chartCategory'));
  charts.supplier = echarts.init(document.getElementById('chartSupplier'));
  charts.docs = echarts.init(document.getElementById('chartDocs'));
  window.addEventListener('resize', () => {
    for (const c of Object.values(charts)) c && c.resize();
  });
}

async function loadStats() {
  try {
    const d = await apiGet('/api/stats');
    renderCards(d);
    renderCharts(d);
    renderAlerts(d);
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

  // 认证状态分布（饼图）
  charts.status.setOption({
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
  charts.category.setOption({
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
  charts.supplier.setOption({
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

  // 资料覆盖率（雷达图）
  const docNames = Object.keys(d.docCoverage);
  const docValues = Object.values(d.docCoverage);
  charts.docs.setOption({
    tooltip: { formatter: '{b}: {c}%' },
    radar: {
      indicator: docNames.map((n) => ({ name: n, max: 100 })),
      radius: '62%',
      axisName: { fontSize: 13 },
      splitArea: { areaStyle: { color: ['#fff', '#f8fafc'] } },
    },
    series: [{
      type: 'radar',
      data: [{
        value: docValues,
        name: '覆盖率',
        areaStyle: { color: 'rgba(37,99,235,.25)' },
        lineStyle: { color: '#2563eb', width: 2 },
        itemStyle: { color: '#2563eb' },
      }],
    }],
  });
}

function renderAlerts(d) {
  const expired = document.getElementById('expiredList');
  const expiring = document.getElementById('expiringList');

  expired.innerHTML = d.expired.length
    ? d.expired.map((r) => `
        <li>
          <span><b>${esc(r.name)}</b> ${esc(r.model) ? `(${esc(r.model)})` : ''} · ${esc(r.supplier) || '-'}</span>
          <span class="date" style="color:var(--danger)">${esc(r.cert_expire_date)}</span>
        </li>`).join('')
    : '<li class="empty">🎉 暂无已过期的认证</li>';

  expiring.innerHTML = d.expiring.length
    ? d.expiring.map((r) => `
        <li>
          <span><b>${esc(r.name)}</b> ${esc(r.model) ? `(${esc(r.model)})` : ''} · ${esc(r.supplier) || '-'}</span>
          <span class="date" style="color:var(--warning)">${esc(r.cert_expire_date)}</span>
        </li>`).join('')
    : '<li class="empty">🎉 90天内无到期的认证</li>';
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

document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  loadStats();
});
