import { useEffect, useRef, useState } from 'react';
import { apiPost } from '../../api/client';
import { toast } from '../../stores/ui';
import { dedupeImportRows } from '../../utils/dedupeImportRows';
import Modal from './Modal';

// xlsx 体积较大，动态按需加载（仅在生成模板 / 解析文件时），自动 code-split
let xlsxPromise = null;
function loadXlsx() {
  if (!xlsxPromise) xlsxPromise = import('xlsx');
  return xlsxPromise;
}

// ---------- 批量导出按钮（迁移自 common.js exportBatchData） ----------
// entity 用于默认文件名与提示；query 可选（查询字符串或 URLSearchParams，随筛选条件导出）
// label / filename 可选覆盖按钮文案与导出文件名
export function ExportButton({ api, entity, query, label, filename }) {
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setBusy(true);
    try {
      const qs = query instanceof URLSearchParams ? query.toString() : String(query || '');
      const url = '/api/' + api + '/export' + (qs ? '?' + qs : '');
      const res = await fetch(url);
      if (!res.ok) {
        let msg = '导出失败';
        try { const d = await res.json(); msg = d.message || msg; } catch (e) { /* ignore */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url2 = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url2;
      a.download = `${filename || entity}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url2), 1000);
      toast('导出成功', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="btn" disabled={busy} onClick={doExport}>
      {busy ? '导出中...' : label || '📤 批量导出'}
    </button>
  );
}

// ---------- 批量导入弹窗（迁移自 common.js 的 setupBatchImport / buildBatchImportModal 等） ----------
// cfg: { api, entity, fields: [[中文列名, 字段名], ...], requiredLabel, extraBody }
// extraBody：随导入请求一起提交的固定字段（如预研/在研清单归属 kind），不参与文件列匹配
// 权限由调用方控制；onDone 在导入成功后回调（如刷新列表）
export function ImportModal({ open, onClose, cfg, onDone }) {
  const fileRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 每次打开时清空上一次状态
  useEffect(() => {
    if (open) {
      setRows([]);
      setHeaders([]);
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

  // 解析预览：表头支持列名 / 字段名，忽略空格与大小写差异
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
      const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, '');
      const map = {};
      // 第三项为可选的历史列名别名，保证旧模板 Excel 仍可正常导入
      cfg.fields.forEach(([label, field, aliases]) => {
        map[norm(label)] = field;
        map[norm(field)] = field;
        (aliases || []).forEach((alt) => { map[norm(alt)] = field; });
      });
      const headRow = (grid[0] || []).map((c) => norm(c));
      const idx = cfg.fields.map(([label, field]) => headRow.findIndex((h) => map[h] === field));
      const heads = cfg.fields.map(([label, field], i) => (idx[i] >= 0 ? label : `${label} *`));
      const data = [];
      for (let r = 1; r < grid.length; r++) {
        const row = grid[r] || [];
        if (!row.length || row.every((c) => String(c == null ? '' : c).trim() === '')) continue;
        const item = {};
        cfg.fields.forEach(([label, field], i) => {
          const j = idx[i];
          item[field] = j >= 0 && row[j] != null ? String(row[j]).trim() : '';
        });
        data.push(item);
      }
      // 只有「内容完全一致」的行才合并；同一项目的多条不同信息全部保留
      const { rows: unique, removed } = dedupeImportRows(data, cfg.fields);
      setRows(unique);
      setHeaders(heads);
      setPreviewOpen(true);
      const mergeTip = removed ? `，已合并 ${removed} 行内容完全重复的数据` : '';
      toast(`解析出 ${unique.length} 行数据${mergeTip}${unique.length > 20 ? '（预览前 20 行）' : ''}`, 'success');
    } catch (e) {
      toast('解析失败：' + e.message, 'error');
    }
  };

  const downloadTemplate = async () => {
    try {
      const XLSX = await loadXlsx();
      const heads = cfg.fields.map(([label]) => label);
      const ws = XLSX.utils.aoa_to_sheet([heads]);
      ws['!cols'] = heads.map((h) => ({ wch: Math.max(12, Math.min(30, String(h).length * 2 + 4)) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '导入模板');
      const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cfg.entity}导入模板.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast('模板生成失败：' + e.message, 'error');
    }
  };

  const confirmImport = async () => {
    if (!rows.length) { toast('没有可导入的数据', 'error'); return; }
    setSubmitting(true);
    try {
      const body = { items: rows };
      if (cfg.extraBody && typeof cfg.extraBody === 'object') Object.assign(body, cfg.extraBody);
      const res = await apiPost('/api/' + cfg.api + '/batch', body);
      const errN = (res.errors || []).length;
      const skipN = res.skipped || 0;
      const skipTip = skipN ? `，跳过 ${skipN} 条内容重复` : '';
      if (errN) {
        const head = (res.errors || []).slice(0, 5).map((er) => {
          const line = er.rowIndex ? `第 ${er.rowIndex} 行` : '';
          const rowName = cfg.fields
            .map(([label, field]) => (er.row && er.row[field] ? `${label}「${er.row[field]}」` : ''))
            .filter(Boolean).slice(0, 1).join('');
          return `${line}${rowName}：${er.message}`;
        }).join('；');
        const more = errN > 5 ? `，另有 ${errN - 5} 条同类错误` : '';
        toast(`成功导入 ${res.success} 条${skipTip}，失败 ${errN} 条。${head}${more}`, 'error', 8000);
      } else {
        toast(`成功导入 ${res.success} 条${skipTip}`, 'success');
      }
      onClose();
      if (typeof onDone === 'function') onDone();
    } catch (e) {
      toast(e.message, 'error');
      setSubmitting(false);
    }
  };

  const tipText = cfg.requiredLabel
    ? `第一行为表头，需包含 ${cfg.requiredLabel}（必填）；列名可参考下载模板，多余列将忽略。`
    : '第一行为表头，所有列均为选填；列名可参考下载模板，多余列将忽略。';
  // 去重口径说明：同一对象的多条不同信息都保留，只有内容完全重复的行才合并
  const dedupeText = '同一对象可有多条记录（如一个项目多条风险点）会逐条保留；仅「各列内容完全一致」的重复行合并为一条。';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`批量导入「${cfg.entity}」`}
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
        支持 .xlsx / .xls / .csv 文件。{tipText}
        <div style={{ marginTop: 4 }}>{dedupeText}</div>
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
              <tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((it, i) => (
                <tr key={i}>
                  {cfg.fields.map(([label, field]) => (
                    <td key={field}>{it[field] || '-'}</td>
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
