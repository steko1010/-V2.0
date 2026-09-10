import { useEffect } from 'react';
import { useUi } from '../../stores/ui';

// 命令式确认框（对应 common.js 的 confirmDialog；替代原生 confirm）
export default function ConfirmHost() {
  const confirm = useUi((s) => s.confirm);
  const resolve = useUi((s) => s.resolveConfirm);

  useEffect(() => {
    if (!confirm) return;
    const onKey = (e) => { if (e.key === 'Escape') resolve(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirm, resolve]);

  if (!confirm) return null;
  return (
    <div className="modal-mask show" onClick={(e) => { if (e.target === e.currentTarget) resolve(false); }}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-head">
          <h3>{confirm.title}</h3>
          <button className="modal-close" type="button" aria-label="关闭" onClick={() => resolve(false)}>×</button>
        </div>
        <div className="modal-body">
          <div style={{ whiteSpace: 'pre-wrap' }}>{confirm.msg}</div>
        </div>
        <div className="modal-foot">
          <button className="btn" type="button" onClick={() => resolve(false)}>取消</button>
          <button className="btn btn-danger" type="button" onClick={() => resolve(true)}>确定</button>
        </div>
      </div>
    </div>
  );
}
