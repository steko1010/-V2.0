import { useUi } from '../../stores/ui';

// 全局 toast 提示容器（对应旧版 <div id="toast">）
export default function ToastHost() {
  const toast = useUi((s) => s.toast);
  const cls = 'show' + (toast && toast.type === 'error' ? ' error' : toast && toast.type === 'success' ? ' success' : '');
  return <div id="toast" className={toast ? cls : ''}>{toast ? toast.msg : ''}</div>;
}
