// 横向条形图（迁移自 audits.js / dashboard.js 的 renderBars）
// rows: [{ name, value }]
export default function BarList({ rows = [], color = '#2563eb' }) {
  if (!rows || !rows.length) {
    return (
      <div className="empty" style={{ padding: '24px 0' }}>
        <div className="big">📭</div>
        <div>暂无数据</div>
      </div>
    );
  }
  const max = Math.max(...rows.map((r) => r.value || 0));
  return (
    <div className="bar-list">
      {rows.map((r) => {
        const pct = max ? Math.round(((r.value || 0) / max) * 100) : 0;
        return (
          <div className="bar-row" key={r.name}>
            <div className="bar-label" title={r.name}>{r.name}</div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: pct + '%', background: color }} />
            </div>
            <div className="bar-value">{r.value || 0}{r.hint ? <span className="bar-hint">{r.hint}</span> : null}</div>
          </div>
        );
      })}
    </div>
  );
}
