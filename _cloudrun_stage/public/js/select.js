let meta = { statuses: [], docStatuses: [] };
let lastCheck = null;

async function loadMeta() {
  try {
    meta = await apiGet('/api/meta');
    fillSelect('a_status', meta.statuses);
    if (meta.statuses.length) {
      document.getElementById('a_status').value = meta.statuses[0] || '黄区';
    }
  } catch (e) { toast(e.message, 'error'); }
}

function fillSelect(id, options) {
  document.getElementById(id).innerHTML =
    options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
}

function collectQuery() {
  return {
    code: document.getElementById('q_code').value.trim(),
    name: document.getElementById('q_name').value.trim(),
    model: document.getElementById('q_model').value.trim(),
    supplier: document.getElementById('q_supplier').value.trim(),
    manufacturer: document.getElementById('q_manufacturer').value.trim(),
  };
}

async function doCheck() {
  const q = collectQuery();
  if (!q.name && !q.model && !q.code) {
    toast('请至少输入物料名称、型号或编码之一', 'error');
    return;
  }
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = '查重中...';
  try {
    const data = await apiPost('/api/check', q);
    lastCheck = { query: q, data };
    renderResult(q, data);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 开始查重';
  }
}

function renderResult(q, data) {
  const box = document.getElementById('resultBox');
  const title = document.getElementById('resultTitle');
  const tip = document.getElementById('resultTip');
  const icon = document.getElementById('resultIcon');

  box.classList.add('show');
  box.classList.remove('in-library', 'not-in', 'maybe');
  icon.textContent = data.inLibrary ? '⚠️' : data.fuzzy.length ? '💡' : '✅';
  box.classList.add(data.inLibrary ? 'in-library' : data.fuzzy.length ? 'maybe' : 'not-in');
  title.textContent = data.inLibrary ? '已在物料库中' : data.fuzzy.length ? '存在相似物料' : '未在库中，可新增';
  tip.textContent = data.tip;

  renderMatches(data);

  // 未在库（无精确匹配）时显示「加入物料库」卡片，并带入查询信息
  const addCard = document.getElementById('addCard');
  addCard.style.display = data.inLibrary ? 'none' : 'block';
  if (!data.inLibrary) {
    document.getElementById('a_name').value = q.name || '';
    document.getElementById('a_supplier').value = q.supplier || '';
    document.getElementById('a_model').value = q.model || '';
  }
}

function renderMatches(data) {
  document.getElementById('matchesArea').style.display = 'block';
  document.getElementById('exactCount').textContent = data.exact.length;
  document.getElementById('fuzzyCount').textContent = data.fuzzy.length;
  document.getElementById('exactEmpty').style.display = data.exact.length ? 'none' : 'block';
  document.getElementById('fuzzyEmpty').style.display = data.fuzzy.length ? 'none' : 'block';
  document.getElementById('exactList').innerHTML = data.exact.map(matchCard).join('');
  document.getElementById('fuzzyList').innerHTML = data.fuzzy.map(matchCard).join('');
}

function matchCard(r) {
  return `
    <div class="match-card">
      <div class="m-head">
        <div class="m-name">${esc(r.name)}</div>
        ${statusBadge(r.status)}
      </div>
      <div class="m-info">
        <span><b>编码</b> ${esc(r.code) || '-'}</span><span class="sep">|</span>
        <span><b>型号</b> ${esc(r.model) || '-'}</span><span class="sep">|</span>
        <span><b>分类</b> ${esc(r.category) || '-'}</span><span class="sep">|</span>
        <span><b>供应商</b> ${esc(r.supplier) || '-'}</span><span class="sep">|</span>
        <span><b>制造商</b> ${esc(r.manufacturer) || '-'}</span><span class="sep">|</span>
        <span><b>认证</b> ${esc(r.cert_expire_date) || '未设置'}</span>
      </div>
    </div>`;
}

async function addToLibrary() {
  if (!lastCheck) return;
  const data = {
    code: '',
    name: document.getElementById('a_name').value.trim(),
    model: document.getElementById('a_model').value.trim(),
    supplier: document.getElementById('a_supplier').value.trim(),
    status: document.getElementById('a_status').value,
  };
  if (!data.name) { toast('物料名称不能为空', 'error'); return; }
  try {
    await apiPost('/api/materials', data);
    toast('已加入物料库', 'success');
    document.getElementById('addCard').style.display = 'none';
    clearForm();
  } catch (e) { toast(e.message, 'error'); }
}

function clearForm() {
  for (const id of ['q_code', 'q_name', 'q_model', 'q_supplier', 'q_manufacturer']) {
    document.getElementById(id).value = '';
  }
  document.getElementById('resultBox').classList.remove('show');
  document.getElementById('matchesArea').style.display = 'none';
  lastCheck = null;
}

document.addEventListener('DOMContentLoaded', loadMeta);
