import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client';
import { useAuth } from '../stores/auth';
import { useMeta } from '../stores/meta';
import { confirmDialog, toast } from '../stores/ui';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import { ExportButton } from '../components/ui/ImportExport';
import SupplierSelect from '../components/ui/SupplierSelect';
import BarList from '../components/charts/BarList';

const PAGE_SIZE = 10;
const ACCENT_CLS = ['accent-blue', 'accent-green', 'accent-amber', 'accent-red'];

// 项目规格字段：[中文列名, 数据库字段, 弹窗分组]（顺序即列表/模板列顺序）
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
const GROUPS = ['立项信息', '模组器件', '制程胶材', '背光模组']
  .map((gr) => [gr, PROJECT_SPEC_FIELDS.filter(([, , g]) => g === gr).map(([l, f]) => [l, f])]);
const EMPTY_SPEC = Object.fromEntries(PROJECT_SPEC_FIELDS.map(([, f]) => [f, '']));

function SourceBadge({ src }) {
  if (src === '文档导入') return <span className="badge dev">📄 文档导入</span>;
  return <span className="badge">手动</span>;
}

// ---------- BOM 专属批量导入（智能表头识别 + 项目名称自动生成） ----------
let xlsxPromise = null;
function loadXlsx() {
  if (!xlsxPromise) xlsxPromise = import('xlsx');
  return xlsxPromise;
}

function ProjectImport({ open, onClose, onDone }) {
  const fileRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setRows([]);
      setPreviewOpen(false);
      setSubmitting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [open]);

  const readFileBuffer = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(new Uint8Array(e.target.result));
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(file);
    });

  const parse = async () => {
    const file = fileRef.current && fileRef.current.files[0];
    if (!file) { toast('请先选择 Excel 文件', 'error'); return; }
    try {
      const XLSX = await loadXlsx();
      const buf = await readFileBuffer(file);
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
      if (!grid.length) { toast('文件中没有数据', 'error'); return; }
      const specMap = {};
      PROJECT_SPEC_FIELDS.forEach(([label, field]) => {
        specMap[label.toLowerCase()] = field;
        specMap[field.toLowerCase()] = field;
      });
      const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
      const toField = (c) => specMap[norm(c)] || specMap[norm(c).replace(/-/g, '_')] || null;
      const isNameCol = (k) => ['项目名称', '项目', 'project_name'].includes(norm(k));
      // 智能识别表头行：扫描前 20 行取命中规格列最多的一行（兼容带说明/合并行的表格）
      let headerIdx = -1; let best = 0;
      for (let i = 0; i < Math.min(grid.length, 20); i++) {
        const hit = (grid[i] || []).filter((c) => { const k = norm(c); return k && (toField(c) || isNameCol(k)); }).length;
        if (hit > best) { best = hit; headerIdx = i; }
      }
      if (headerIdx < 0 || best < 3) { toast('未识别到规格表头，请使用「下载导入模板」', 'error'); return; }
      const colField = (grid[headerIdx] || []).map((c) => (isNameCol(c) ? 'project_name' : toField(c)));
      const out = [];
      for (let i = headerIdx + 1; i < grid.length; i++) {
        const r = grid[i] || [];
        if (!r.some((c) => String(c).trim() !== '')) continue;
        const item = { project_name: '', ...EMPTY_SPEC };
        colField.forEach((field, ci) => {
          if (field && ci < r.length) item[field] = String(r[ci]).trim();
        });
        out.push(item);
      }
      // 项目名称自动生成：MOD厂 + 项目尺寸（重复名称追加序号）
      const dup = {};
      out.forEach((item) => {
        if (!item.project_name) item.project_name = [item.mod_factory, item.project_size].filter(Boolean).join(' ');
        if (!item.project_name) item.project_name = '未命名项目';
        dup[item.project_name] = (dup[item.project_name] || 0) + 1;
        if (dup[item.project_name] > 1) item.project_name = `${item.project_name} (${dup[item.project_name]})`;
      });
      setRows(out);
      setPreviewOpen(true);
      toast(`共解析 ${out.length} 行，均含项目名称，可预览后确认导入`, 'success');
    } catch (e) {
      toast('文件解析失败：' + e.message, 'error');
    }
  };

  const downloadTemplate = async () => {
    try {
      const XLSX = await loadXlsx();
      const headers = ['项目名称', ...PROJECT_SPEC_FIELDS.map(([label]) => label)];
      const ws = XLSX.utils.aoa_to_sheet([headers, ['示例项目', ...PROJECT_SPEC_FIELDS.map(() => '')]]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '项目导入模板');
      const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'BOM信息导入模板.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast('模板生成失败：' + e.message, 'error');
    }
  };

  const confirmImport = async () => {
    if (!rows.length) { toast('没有可导入的有效数据', 'error'); return; }
    setSubmitting(true);
    try {
      const res = await apiPost('/api/projects/batch', { items: rows });
      const errN = (res.errors || []).length;
      toast(`导入完成：成功 ${res.success} 条` + (errN ? `，失败 ${errN} 条（项目名称缺失）` : ''), errN ? 'error' : 'success');
      onClose();
      if (typeof onDone === 'function') onDone();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const cols = ['项目名称', ...PROJECT_SPEC_FIELDS.map(([label]) => label)];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="批量导入BOM信息"
      wide
      footer={
        <>
          <button className="btn" disabled={submitting} onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={submitting || !rows.length} onClick={confirmImport}>
            {submitting ? '导入中...' : '确认导入'}
          </button>
        </>
      }
    >
      <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
        支持 .xlsx / .xls / .csv 文件。第一行为表头，需包含<b>项目名称</b>（必填），其余列名可参考模板：
        基线、量产封样时间、项目尺寸、MOD厂、MOD料号、panel、IC、CG厂、CG材质、FPC、OCA、POL、COG-ACF、FOG-ACF、
        元器件包封胶、一线胶、面胶、银浆、硅酮胶、盲孔一道胶、盲孔二道胶、背光厂、遮光胶、上/下增光、扩散、LED灯胶、
        反射、LED、LGP、胶框、铁框。未填项目名称的行将按「MOD厂 + 项目尺寸」自动生成。
      </div>
      <div className="toolbar">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="search-input" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn" onClick={downloadTemplate}>⬇ 下载模板</button>
        <button className="btn btn-primary" onClick={parse}>解析预览</button>
      </div>
      {previewOpen && (
        <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>{cols.map((c, i) => <th key={i}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><b>{r.project_name}</b></td>
                  {PROJECT_SPEC_FIELDS.map(([label, field]) => (
                    <td className="spec" key={field} title={r[field]}>{r[field] || '-'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export default function Projects() {
  const hasPerm = useAuth((s) => s.hasPerm);
  const categories = useMeta((s) => s.categories);
  const ensureMeta = useMeta((s) => s.ensure);

  const [tab, setTab] = useState('manage');
  const [keyword, setKeyword] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState(() => new Set());
  const [stats, setStats] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ project_name: '', supplier: '', category: '', flow: '', ...EMPTY_SPEC });
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async (p = 1, kw = keyword) => {
    const qs = new URLSearchParams({ page: p, pageSize: PAGE_SIZE });
    if (kw.trim()) qs.set('keyword', kw.trim());
    try {
      const data = await apiGet('/api/projects?' + qs.toString());
      setRows(data.items || []);
      setTotal(data.total || 0);
      setPage(p);
      setChecked(new Set());
    } catch (e) { toast(e.message, 'error'); }
  }, [keyword]);

  const loadStats = useCallback(async () => {
    try { setStats(await apiGet('/api/projects/stats')); } catch (e) { /* 看板失败不阻塞 */ }
  }, []);

  useEffect(() => { ensureMeta().catch(() => {}); }, [ensureMeta]);
  useEffect(() => { load(1); }, [load]);

  const doQuery = (e) => { if (e) e.preventDefault(); load(1, keyword); };
  const resetAll = () => { setKeyword(''); load(1, ''); };
  const activeTab = (name) => { setTab(name); if (name === 'analysis') loadStats(); };

  const pageIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => checked.has(id));
  const toggleAll = () => {
    const next = new Set(checked);
    if (allChecked) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    setChecked(next);
  };
  const toggleOne = (id) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChecked(next);
  };

  const openAdd = () => { setEditingId(null); setForm({ project_name: '', supplier: '', category: '', flow: '', ...EMPTY_SPEC }); setModalOpen(true); };
  const openEdit = (r) => {
    setEditingId(r.id);
    const spec = {};
    PROJECT_SPEC_FIELDS.forEach(([, f]) => (spec[f] = r[f] || ''));
    setForm({
      project_name: r.project_name || '', supplier: r.supplier || '', category: r.category || '',
      flow: String(r.flow || '').replace(/\s*[→>]\s*/g, '\n'), ...spec,
    });
    setModalOpen(true);
  };
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.project_name.trim()) { toast('项目名称不能为空', 'error'); return; }
    const flow = String(form.flow || '').split(/\r?\n+/).map((s) => s.trim()).filter(Boolean).join(' → ');
    const payload = { project_name: form.project_name.trim(), supplier: form.supplier.trim(), category: form.category, flow };
    PROJECT_SPEC_FIELDS.forEach(([, f]) => (payload[f] = form[f].trim()));
    setBusy(true);
    try {
      if (editingId) { await apiPut('/api/projects/' + editingId, payload); toast('修改成功', 'success'); }
      else { await apiPost('/api/projects', payload); toast('新建成功', 'success'); }
      setModalOpen(false);
      load(page);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const removeOne = async (id) => {
    if (!await confirmDialog('确定删除该BOM信息吗？')) return;
    try {
      await apiDelete('/api/projects/' + id);
      toast('已删除', 'success');
      if (rows.length === 1 && page > 1) load(page - 1); else load(page);
    } catch (e) { toast(e.message, 'error'); }
  };

  const batchDelete = async () => {
    const ids = [...checked];
    if (!ids.length) { toast('请先勾选要删除的BOM信息', 'error'); return; }
    if (!await confirmDialog(`确定删除选中的 ${ids.length} 条BOM信息？`)) return;
    let ok = 0;
    try {
      for (const id of ids) { const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' }); if (res.ok) ok++; }
      toast(`已删除 ${ok} 条`, ok === ids.length ? 'success' : 'error');
      load(rows.length === ids.length && page > 1 ? page - 1 : page);
    } catch (e) { toast(e.message, 'error'); }
  };

  const can = (code) => hasPerm(code);
  const st = stats || {};
  const exportQuery = () => { const kw = keyword.trim(); return kw ? new URLSearchParams({ keyword: kw }) : ''; };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>BOM信息</h1>
          <div className="desc">BOM信息的录入、管理与分析展示</div>
        </div>
      </div>

      <div className="sub-tabs">
        <button className={'sub-tab' + (tab === 'manage' ? ' active' : '')} onClick={() => activeTab('manage')}>📋 一、BOM列表</button>
        <button className={'sub-tab' + (tab === 'analysis' ? ' active' : '')} onClick={() => activeTab('analysis')}>📊 二、分析看板</button>
      </div>

      {tab === 'manage' && (
        <section className="sub-panel active">
          <div className="card">
            <div className="card-title">
              <span>BOM信息列表</span>
              <div>
                {can('action:import') && <button className="btn" onClick={() => setImportOpen(true)}>📥 批量导入</button>}
                {can('action:export') && <ExportButton api="projects" entity="BOM信息" filename="BOM信息" query={exportQuery()} />}
                {can('action:delete') && <button className="btn btn-danger" onClick={batchDelete}>🗑 批量删除</button>}
                {can('action:create') && <button className="btn btn-primary" onClick={openAdd}>＋ 新建BOM信息</button>}
              </div>
            </div>
            <form className="toolbar" onSubmit={doQuery}>
              <input className="search-input" placeholder="搜索项目名称 / 基线 / MOD料号 / panel / IC / 背光厂..." value={keyword} onChange={(e) => setKeyword(e.target.value)} />
              <button type="submit" className="btn">查询</button>
              <button type="button" className="btn" onClick={resetAll}>重置</button>
            </form>
            <div className="table-wrap">
              <table className="data-table" style={rows.length ? undefined : { display: 'none' }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} title="全选本页" /></th>
                    <th>项目名称</th>
                    {PROJECT_SPEC_FIELDS.map(([label]) => <th key={label}>{label}</th>)}
                    <th>来源</th><th>录入时间</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td><input type="checkbox" checked={checked.has(p.id)} onChange={() => toggleOne(p.id)} /></td>
                      <td><b>{p.project_name}</b></td>
                      {PROJECT_SPEC_FIELDS.map(([label, f]) => (
                        <td className="spec" key={label} title={p[f] || ''}>{p[f] || '-'}</td>
                      ))}
                      <td><SourceBadge src={p.source} /></td>
                      <td>{p.created_at || '-'}</td>
                      <td>
                        <div className="actions">
                          {can('action:edit') && <button className="btn btn-sm" onClick={() => openEdit(p)}>编辑</button>}
                          {can('action:delete') && <button className="btn btn-sm btn-danger" onClick={() => removeOne(p.id)}>删除</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && (
                <div className="empty">
                  <div className="big">🗂️</div>
                  <div>暂无BOM信息，点击「新建BOM信息」手动录入</div>
                </div>
              )}
            </div>
            <Pagination page={page} total={total} pageSize={PAGE_SIZE} onGo={load} />
          </div>
        </section>
      )}

      {tab === 'analysis' && (
        <section className="sub-panel active">
          <div className="stat-grid">
            {[
              ['项目总数', st.total || 0, '全部BOM信息'],
              ['供应商数', (st.suppliers || []).length, '已关联的供应商'],
              ['品类数', (st.categories || []).length, '已覆盖的物料品类'],
              ['流程填写率', (st.flowCoverage || 0) + '%', '已填写流程的项目占比'],
            ].map(([label, value, hint], i) => (
              <div className={'stat-card ' + ACCENT_CLS[i]} key={label}>
                <div className="label">{label}</div>
                <div className="value">{value}</div>
                <div className="hint">{hint}</div>
              </div>
            ))}
          </div>
          <div className="chart-grid">
            <div className="card">
              <div className="card-title">按供应商分布</div>
              <BarList rows={st.suppliers || []} color="#2563eb" />
            </div>
            <div className="card">
              <div className="card-title">按品类分布</div>
              <BarList rows={st.categories || []} color="#16a34a" />
            </div>
            <div className="card chart-wide">
              <div className="card-title">最近录入的项目</div>
              {!(st.recent || []).length ? (
                <div className="empty" style={{ padding: '28px 0' }}><div className="big">📭</div><div>暂无数据</div></div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr><th>项目名称</th><th>供应商</th><th>品类</th><th>流程</th><th>来源</th><th>录入时间</th></tr>
                    </thead>
                    <tbody>
                      {(st.recent || []).map((r) => (
                        <tr key={r.id}>
                          <td><b>{r.project_name}</b></td>
                          <td>{r.supplier || '-'}</td>
                          <td>{r.category || '-'}</td>
                          <td className="flow-cell" title={r.flow || ''}>{r.flow || '-'}</td>
                          <td><SourceBadge src={r.source} /></td>
                          <td>{r.created_at || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 新建/编辑 BOM 信息弹窗 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? '编辑BOM信息' : '新建BOM信息'}
        wide
        footer={
          <>
            <button className="btn" onClick={() => setModalOpen(false)}>取消</button>
            <button className="btn btn-primary" disabled={busy} onClick={save}>保存</button>
          </>
        }
      >
        <div className="form-grid">
          <div className="form-item full">
            <label>项目名称<span className="req">*</span></label>
            <input value={form.project_name} onChange={(e) => setField('project_name', e.target.value)} placeholder="必填" />
          </div>
          <div className="form-item half">
            <label>供应商</label>
            <SupplierSelect value={form.supplier} onChange={(v) => setField('supplier', v)} />
          </div>
          <div className="form-item half">
            <label>品类</label>
            <select value={form.category} onChange={(e) => setField('category', e.target.value)}>
              <option value="">请选择（品类管理中类）</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-item full">
            <label>流程</label>
            <textarea value={form.flow} onChange={(e) => setField('flow', e.target.value)} placeholder="每行一个步骤，将自动转为 步骤A → 步骤B" />
          </div>
          {GROUPS.map(([gr, items]) => (
            <Fragment key={gr}>
              <div className="form-section">{gr}</div>
              {items.map(([label, f]) => (
                <div className="form-item half" key={f}>
                  <label>{label}</label>
                  <input value={form[f]} onChange={(e) => setField(f, e.target.value)} placeholder={label} />
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </Modal>

      <ProjectImport open={importOpen} onClose={() => setImportOpen(false)} onDone={() => load(page)} />
    </>
  );
}
