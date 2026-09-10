import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../api/client';
import { useAuth } from '../stores/auth';
import { useMeta } from '../stores/meta';
import { confirmDialog, toast } from '../stores/ui';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import { ExportButton, ImportModal } from '../components/ui/ImportExport';
import BarList from '../components/charts/BarList';

const PAGE_SIZE = 10;
const ACCENT_CLS = ['accent-blue', 'accent-green', 'accent-amber', 'accent-red'];
const RATINGS = ['A', 'B', 'C', 'D'];
const STATUSES = ['合作中', '暂停', '淘汰'];

// 列表列顺序：[字段, 中文列名]
const SUPPLIER_COLUMNS = [
  ['name', '供应商'], ['material_type', '物料品类'], ['address', '工厂地址'],
  ['company_profile', '公司简介'], ['product_type', '产品类型'], ['capacity_phone', '产能(手机)'],
  ['module_customers', '模组客户'], ['terminal_customers', '终端客户'],
  ['system_capability', '体系能力'], ['automation_capability', '自动化能力'],
  ['inspection_capability', '检验能力'], ['traceability_capability', '追溯能力'],
  ['testing_capability', '测试能力'], ['rework', '返修'], ['strengths', '优势'], ['weaknesses', '劣势'],
  ['audit_address', '审核地址'], ['audit_time', '审核时间'], ['audit_members', '审核成员'],
  ['audit_result', '审核结果'], ['qsa', 'QSA'], ['qpa', 'QPA'], ['audit_record', '审核记录'],
  ['mass_production_record', '传音量产记录'],
];

// 导入模板列（与导出/服务器字段一致）
const IMPORT_FIELDS = [
  ['供应商', 'name', ['供应商名称']], ['物料品类', 'material_type'], ['工厂地址', 'address'],
  ['公司简介', 'company_profile'], ['产品类型', 'product_type'], ['产能(手机)', 'capacity_phone'],
  ['模组客户', 'module_customers'], ['终端客户', 'terminal_customers'], ['体系能力', 'system_capability'],
  ['自动化能力', 'automation_capability'], ['检验能力', 'inspection_capability'],
  ['追溯能力', 'traceability_capability'], ['测试能力', 'testing_capability'], ['返修', 'rework'],
  ['优势', 'strengths'], ['劣势', 'weaknesses'],
  ['审核地址', 'audit_address'], ['审核时间', 'audit_time'], ['审核成员', 'audit_members'],
  ['审核结果', 'audit_result'], ['QSA', 'qsa'], ['QPA', 'qpa'],
  ['审核记录', 'audit_record'], ['传音量产记录', 'mass_production_record'], ['附件', 'attachment'],
];

const EMPTY_FORM = {
  name: '', contact: '', phone: '', email: '', address: '', material_type: '',
  rating: 'C', status: '合作中', company_profile: '', product_type: '', capacity_phone: '',
  module_customers: '', terminal_customers: '', system_capability: '', automation_capability: '',
  inspection_capability: '', traceability_capability: '', testing_capability: '', rework: '',
  strengths: '', weaknesses: '', remark: '', attachment: '', audit_address: '', audit_time: '',
  audit_members: '', audit_result: '', qsa: '', qpa: '', audit_record: '', mass_production_record: '',
};

// 弹窗输入分组：[分组名, [[字段, 中文名, 是否必填]...]]（material_type/评级/状态单列处理）
const INPUT_FIELDS = [
  ['基本信息', [
    ['name', '供应商', true], ['contact', '联系人'], ['phone', '联系电话'], ['email', '邮箱'],
    ['address', '工厂地址'], ['company_profile', '公司简介'], ['product_type', '产品类型'],
    ['capacity_phone', '产能(手机)'], ['rework', '返修'],
  ]],
  ['客户资源', [
    ['module_customers', '模组客户'], ['terminal_customers', '终端客户'],
  ]],
  ['体系与能力', [
    ['system_capability', '体系能力'], ['automation_capability', '自动化能力'],
    ['inspection_capability', '检验能力'], ['traceability_capability', '追溯能力'],
    ['testing_capability', '测试能力'],
  ]],
  ['综合评价', [
    ['strengths', '优势'], ['weaknesses', '劣势'],
  ]],
  ['审核信息', [
    ['audit_address', '审核地址'], ['audit_time', '审核时间'], ['audit_members', '审核成员'],
    ['audit_result', '审核结果'], ['qsa', 'QSA'], ['qpa', 'QPA'],
    ['audit_record', '审核记录'], ['mass_production_record', '传音量产记录'],
  ]],
];

function typeBadge(t) {
  if (!t) return '-';
  const cls = { FPC: 'done', CG: 'cert', 背光: 'doc-yes', IC: 'badge-purple' }[t] || '';
  return <span className={'badge ' + cls}>{t}</span>;
}
function AttachLink({ att }) {
  if (!att) return '-';
  const name = decodeURIComponent(att.split('/').pop() || '附件');
  return <a href={att} target="_blank" rel="noreferrer" title={att}>{name}</a>;
}

const readAsDataURL = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('文件读取失败'));
  reader.readAsDataURL(file);
});

export default function Suppliers() {
  const hasPerm = useAuth((s) => s.hasPerm);
  const categories = useMeta((s) => s.categories);
  const ensureMeta = useMeta((s) => s.ensure);
  const refreshMeta = useMeta((s) => s.refresh);

  const [tab, setTab] = useState('info');
  const [allItems, setAllItems] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [matType, setMatType] = useState('');
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState(() => new Set());
  const [stats, setStats] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const attachRef = useRef(null);

  const load = useCallback(async (kw = keyword, mt = matType) => {
    const qs = new URLSearchParams();
    if (kw.trim()) qs.set('keyword', kw.trim());
    if (mt) qs.set('materialType', mt);
    try {
      const data = await apiGet('/api/suppliers' + (qs.toString() ? '?' + qs.toString() : ''));
      setAllItems(data.items || []);
      setPage(1);
      setChecked(new Set());
    } catch (e) { toast(e.message, 'error'); }
  }, [keyword, matType]);

  const loadStats = useCallback(async () => {
    try { setStats(await apiGet('/api/suppliers/stats')); } catch (e) { /* 失败不阻塞 */ }
  }, []);

  useEffect(() => { ensureMeta().catch(() => {}); }, [ensureMeta]);
  useEffect(() => { load(); loadStats(); }, [load, loadStats]);

  const totalPages = Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const slice = allItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const sliceIds = useMemo(() => slice.map((r) => r.id), [slice]);
  const allChecked = sliceIds.length > 0 && sliceIds.every((id) => checked.has(id));

  const toggleAll = () => {
    const next = new Set(checked);
    if (allChecked) sliceIds.forEach((id) => next.delete(id));
    else sliceIds.forEach((id) => next.add(id));
    setChecked(next);
  };
  const toggleOne = (id) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChecked(next);
  };

  const doQuery = (e) => { if (e) e.preventDefault(); load(keyword, matType); };
  const resetAll = () => { setKeyword(''); setMatType(''); load('', ''); };

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const openAdd = () => { setEditingId(null); setForm({ ...EMPTY_FORM, material_type: matType || '' }); setModalOpen(true); };
  const openEdit = (row) => {
    setEditingId(row.id);
    const f = { ...EMPTY_FORM };
    Object.keys(f).forEach((k) => { f[k] = row[k] == null ? '' : String(row[k]); });
    f.rating = row.rating || 'C';
    f.status = row.status || '合作中';
    setForm(f);
    setModalOpen(true);
  };

  const uploadAttachment = async () => {
    const file = attachRef.current && attachRef.current.files[0];
    if (!file) { toast('请先选择文件', 'error'); return; }
    if (file.size > 20 * 1024 * 1024) { toast('附件不能超过 20MB', 'error'); return; }
    try {
      const base64 = await readAsDataURL(file);
      const data = await apiPost('/api/upload', { name: file.name, base64 });
      setField('attachment', data.url);
      toast('附件上传成功：' + (data.name || ''), 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  const save = async () => {
    if (!form.name.trim()) { toast('供应商不能为空', 'error'); return; }
    if (!form.material_type) { toast('请选择物料品类', 'error'); return; }
    const payload = { ...form };
    Object.keys(payload).forEach((k) => { if (typeof payload[k] === 'string') payload[k] = payload[k].trim(); });
    payload.rating = form.rating;
    payload.status = form.status;
    setBusy(true);
    try {
      if (editingId) { await apiPut('/api/suppliers/' + editingId, payload); toast('修改成功', 'success'); }
      else { await apiPost('/api/suppliers', payload); toast('新增成功', 'success'); }
      setModalOpen(false);
      load(keyword, matType);
      loadStats();
      refreshMeta().catch(() => {});
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const removeOne = async (id) => {
    if (!await confirmDialog('确定删除该供应商吗？')) return;
    try {
      await apiDelete('/api/suppliers/' + id);
      toast('已删除', 'success');
      load(keyword, matType);
      loadStats();
      refreshMeta().catch(() => {});
    } catch (e) { toast(e.message, 'error'); }
  };

  const batchDelete = async () => {
    const ids = [...checked];
    if (!ids.length) { toast('请先勾选要删除的供应商', 'error'); return; }
    if (!await confirmDialog(`确定删除选中的 ${ids.length} 家供应商？`)) return;
    let ok = 0;
    try {
      for (const id of ids) { const res = await fetch(`/api/suppliers/${id}`, { method: 'DELETE' }); if (res.ok) ok++; }
      toast(`已删除 ${ok} 家`, ok === ids.length ? 'success' : 'error');
      load(keyword, matType);
      loadStats();
      refreshMeta().catch(() => {});
    } catch (e) { toast(e.message, 'error'); }
  };

  const can = (code) => hasPerm(code);
  const st = stats || {};
  const find = (rows, name) => ((rows || []).find((r) => r.name === name) || {}).value || 0;
  const exportQuery = () => {
    const q = new URLSearchParams();
    if (keyword.trim()) q.set('keyword', keyword.trim());
    if (matType) q.set('materialType', matType);
    return q;
  };

  // 表单字段渲染
  const renderField = ([k, label, required]) => {
    if (k === 'material_type') {
      return (
        <div className="form-item half" key={k}>
          <label>{label}<span className="req">*</span></label>
          <select value={form.material_type} onChange={(e) => setField(k, e.target.value)}>
            <option value="">请选择</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      );
    }
    return (
      <div className="form-item half" key={k}>
        <label>{label}{required && <span className="req">*</span>}</label>
        <input value={form[k]} onChange={(e) => setField(k, e.target.value)} placeholder={label} />
      </div>
    );
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>供应商信息</h1>
          <div className="desc">供应商台账管理：物料品类、工厂信息、客户资源与体系能力</div>
        </div>
      </div>

      <div className="sub-tabs">
        <button className={'sub-tab' + (tab === 'info' ? ' active' : '')} onClick={() => setTab('info')}>🏭 一、供应商信息</button>
        <button className={'sub-tab' + (tab === 'analysis' ? ' active' : '')} onClick={() => { setTab('analysis'); loadStats(); }}>📊 二、分析看板</button>
      </div>

      {tab === 'info' && (
        <section className="sub-panel active">
          <div className="stat-grid">
            {[
              ['供应商总数', st.total ?? 0, '全部供应商'],
              ['合作中', find(st.byStatus, '合作中'), '正常合作状态'],
              ['A 级供应商', find(st.byRating, 'A'), '评级为 A 的供应商'],
              ['暂停 / 淘汰', (st.total || 0) - find(st.byStatus, '合作中'), '非合作状态供应商'],
            ].map(([label, value, hint], i) => (
              <div className={'stat-card ' + ACCENT_CLS[i]} key={label}>
                <div className="label">{label}</div>
                <div className="value">{value}</div>
                <div className="hint">{hint}</div>
              </div>
            ))}
          </div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, margin: '0 0 12px', flexWrap: 'wrap' }}>
              {can('action:import') && <button className="btn" onClick={() => setImportOpen(true)}>📥 批量导入</button>}
              {can('action:export') && <ExportButton api="suppliers" entity="供应商" query={exportQuery()} />}
              {can('action:delete') && <button className="btn btn-danger" onClick={batchDelete}>🗑 批量删除</button>}
              {can('action:create') && <button className="btn btn-primary" onClick={openAdd}>＋ 新增供应商</button>}
            </div>
            <form className="toolbar" onSubmit={doQuery}>
              <select value={matType} onChange={(e) => { setMatType(e.target.value); load(keyword, e.target.value); }}>
                <option value="">全部物料品类</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input className="search-input" placeholder="搜索名称 / 品类 / 产品类型 / 客户..." value={keyword} onChange={(e) => setKeyword(e.target.value)} />
              <button type="submit" className="btn">查询</button>
              <button type="button" className="btn" onClick={resetAll}>重置</button>
            </form>
            <div className="table-wrap">
              <table className="data-table" style={slice.length ? undefined : { display: 'none' }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} title="全选本页" /></th>
                    {SUPPLIER_COLUMNS.map(([, label]) => <th key={label}>{label}</th>)}
                    <th>附件</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((s) => (
                    <tr key={s.id}>
                      <td><input type="checkbox" checked={checked.has(s.id)} onChange={() => toggleOne(s.id)} /></td>
                      {SUPPLIER_COLUMNS.map(([f, label]) => {
                        if (f === 'name') return <td key={label}><b>{s[f]}</b></td>;
                        if (f === 'material_type') return <td key={label}>{typeBadge(s[f])}</td>;
                        return <td className="spec" key={label} title={s[f] || ''}>{s[f] || '-'}</td>;
                      })}
                      <td><AttachLink att={s.attachment} /></td>
                      <td>
                        <div className="actions">
                          {can('action:edit') && <button className="btn btn-sm" onClick={() => openEdit(s)}>编辑</button>}
                          {can('action:delete') && <button className="btn btn-sm btn-danger" onClick={() => removeOne(s.id)}>删除</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!slice.length && (
                <div className="empty">
                  <div className="big">🏭</div>
                  <div>暂无供应商，点击上方「新增供应商」开始录入</div>
                </div>
              )}
            </div>
            <Pagination page={safePage} total={allItems.length} pageSize={PAGE_SIZE} onGo={setPage} />
          </div>
        </section>
      )}

      {tab === 'analysis' && (
        <section className="sub-panel active">
          <div className="card">
            <div className="card-title">供应商分析</div>
            <div className="chart-grid">
              <div className="card"><div className="card-title">按合作状态</div><BarList rows={st.byStatus || []} color="#2563eb" /></div>
              <div className="card"><div className="card-title">按评级</div><BarList rows={(st.byRating || []).map((r) => ({ ...r, name: r.name + ' 级' }))} color="#16a34a" /></div>
              <div className="card chart-wide"><div className="card-title">物料品类分布</div><BarList rows={st.byCategory || []} color="#d97706" /></div>
            </div>
          </div>
        </section>
      )}

      {/* 新增/编辑供应商弹窗 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? '编辑供应商' : '新增供应商'}
        wide
        footer={
          <>
            <button className="btn" onClick={() => setModalOpen(false)}>取消</button>
            <button className="btn btn-primary" disabled={busy} onClick={save}>保存</button>
          </>
        }
      >
        <div className="form-grid">
          {renderField(['name', '供应商', true])}
          {renderField(['material_type', '物料品类', true])}
          <div className="form-item half">
            <label>评级</label>
            <select value={form.rating} onChange={(e) => setField('rating', e.target.value)}>
              {RATINGS.map((r) => <option key={r} value={r}>{r} 级</option>)}
            </select>
          </div>
          <div className="form-item half">
            <label>合作状态</label>
            <select value={form.status} onChange={(e) => setField('status', e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {INPUT_FIELDS.map(([sec, fields]) => (
            <Fragment key={sec}>
              <div className="form-section">{sec}</div>
              {fields.map((f) => renderField(f))}
            </Fragment>
          ))}
          <div className="form-section">附件</div>
          <div className="form-item full">
            <label>附件上传</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input ref={attachRef} type="file" style={{ width: 'auto', flex: 1, minWidth: 220 }} />
              <button type="button" className="btn" onClick={uploadAttachment}>上传附件</button>
              {form.attachment ? (
                <a href={form.attachment} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>查看已上传附件：{decodeURIComponent(form.attachment.split('/').pop() || '附件')}</a>
              ) : null}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>支持 PDF / Word / Excel / 图片，单文件不超过 20MB</div>
          </div>
          <div className="form-section">综合评价</div>
          {renderField(['strengths', '优势'])}
          {renderField(['weaknesses', '劣势'])}
          <div className="form-item full">
            <label>备注</label>
            <textarea value={form.remark} onChange={(e) => setField('remark', e.target.value)} placeholder="备注信息" />
          </div>
        </div>
      </Modal>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        cfg={{ api: 'suppliers', entity: '供应商', requiredLabel: '供应商', fields: IMPORT_FIELDS }}
        onDone={() => { load(keyword, matType); loadStats(); refreshMeta().catch(() => {}); }}
      />
    </>
  );
}
