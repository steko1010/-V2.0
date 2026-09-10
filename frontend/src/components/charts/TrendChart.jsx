// 趋势折线图（迁移自 audits.js 的 renderTrend，React SVG 实现）
// labels: string[] 横轴标签（年 '2026' 或月 '2026-03'）；series: [{ name, values: number[] }]
const TREND_COLORS = ['#2563eb', '#d97706', '#0d9488', '#dc2626', '#7c3aed', '#ca8a04'];

// 纵轴刻度取整：使刻度数为 1~4 之间且为 1/2/5 的倍数
function niceStep(maxV) {
  const raw = maxV / 4;
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const f = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return f * pow;
}

export default function TrendChart({ labels = [], series = [] }) {
  if (!labels.length || !series.length) {
    return (
      <div className="empty" style={{ padding: '24px 0' }}>
        <div className="big">📭</div>
        <div>暂无数据</div>
      </div>
    );
  }
  const W = 760, H = 260, PL = 44, PR = 16, PT = 18, PB = 30;
  const iw = W - PL - PR, ih = H - PT - PB;
  const maxV = Math.max(1, ...series.map((s) => Math.max(...s.values)));
  const step = niceStep(maxV);
  const maxAxis = Math.ceil(maxV / step) * step;
  const x = (i) => (labels.length === 1 ? PL + iw / 2 : PL + (i / (labels.length - 1)) * iw);
  const y = (v) => PT + ih - (v / maxAxis) * ih;

  const gridLines = [];
  for (let v = 0; v <= maxAxis; v += step) gridLines.push(v);

  // 横轴标签抽稀：点位多（如月度跨年）时最多显示约 12 个，且始终保留最后一个
  const labelEvery = Math.max(1, Math.ceil(labels.length / 12));
  const labelIdx = [];
  for (let i = 0; i < labels.length; i += labelEvery) labelIdx.push(i);
  const lastIdx = labels.length - 1;
  if (lastIdx > 0 && labelIdx[labelIdx.length - 1] !== lastIdx) labelIdx[labelIdx.length - 1] = lastIdx;
  const labelSet = new Set(labelIdx);

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {gridLines.map((v) => (
          <line key={'g' + v} x1={PL} y1={y(v)} x2={W - PR} y2={y(v)} stroke="#e5e7eb" strokeDasharray="3 3" />
        ))}
        {gridLines.map((v) => (
          <text key={'t' + v} x={PL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#9ca3af">{v}</text>
        ))}
        {labels.map((lb, i) => (
          labelSet.has(i)
            ? <text key={lb + i} x={x(i)} y={H - 10} textAnchor="middle" fontSize="12" fill="#6b7280">{lb}</text>
            : null
        ))}
        {series.map((s, si) => {
          const color = TREND_COLORS[si % TREND_COLORS.length];
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
          return (
            <g key={s.name}>
              <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {s.values.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r="4" fill="#fff" stroke={color} strokeWidth="2">
                  <title>{s.name} {labels[i]}：{v} 个问题</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="trend-legend">
        {series.map((s, si) => (
          <span className="trend-legend-item" key={s.name}>
            <i style={{ background: TREND_COLORS[si % TREND_COLORS.length] }} />
            {s.name}
          </span>
        ))}
      </div>
    </>
  );
}
