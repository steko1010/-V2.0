// 演示数据脚本（一次性）：向本地服务写入示例物料，便于预览效果
// 用法：node seed-demo.js （执行后可删除本文件，示例数据可在页面中手动删除）
const BASE = 'http://localhost:3000';

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${data.message}`);
  return data;
}

const samples = [
  { code: 'M-2026-0001', name: '贴片电阻', model: '0805-10K-1%', category: '电子件', supplier: '华强电子', manufacturer: '国巨', unit: 'PCS', status: '绿区', cert_expire_date: '2027-01-15', rohs: '有', reach: '有', msds: '有', datasheet: '有', applied_by: '张三', applied_at: '2026-07-01', remark: '通用料，多个项目复用' },
  { code: 'M-2026-0002', name: '贴片电容', model: '0805-100nF-10%', category: '电子件', supplier: '华强电子', manufacturer: '村田', unit: 'PCS', status: '绿区', cert_expire_date: '2026-09-10', rohs: '有', reach: '有', msds: '有', datasheet: '有', applied_by: '李四', applied_at: '2026-08-01', remark: '' },
  { code: 'M-2026-0003', name: '贴片电感', model: '0805-1uH', category: '电子件', supplier: '顺络电子', manufacturer: '顺络', unit: 'PCS', status: '黄区', cert_expire_date: '', rohs: '有', reach: '待补', msds: '待补', datasheet: '有', applied_by: '王五', applied_at: '2026-08-05', remark: '新供应商送样测试中' },
  { code: 'M-2026-0004', name: '电源连接器', model: 'XH2.54-2P', category: '连接器', supplier: '立创连接', manufacturer: 'JST', unit: 'PCS', status: '黄区', cert_expire_date: '', rohs: '待补', reach: '待补', msds: '待补', datasheet: '无', applied_by: '张三', applied_at: '2026-08-08', remark: '' },
  { code: 'M-2026-0005', name: 'DC电源线', model: 'DC-5521-1.5M', category: '线材', supplier: '科力线材', manufacturer: '科力', unit: 'PCS', status: '红区', cert_expire_date: '2026-06-30', rohs: '有', reach: '有', msds: '有', datasheet: '有', applied_by: '赵六', applied_at: '2026-05-12', remark: '认证已过期，需安排重新送检' },
  { code: 'M-2026-0006', name: 'Type-C接口', model: 'TYPE-C-16P', category: '连接器', supplier: '立创连接', manufacturer: '立讯精密', unit: 'PCS', status: '黄区', cert_expire_date: '', rohs: '待补', reach: '待补', msds: '待补', datasheet: '待补', applied_by: '王五', applied_at: '2026-08-10', remark: '新项目选型阶段' },
  { code: 'M-2026-0007', name: '锂电池', model: '18650-2600mAh', category: '电池', supplier: '动力电池', manufacturer: '力神', unit: 'PCS', status: '绿区', cert_expire_date: '2026-10-01', rohs: '有', reach: '有', msds: '有', datasheet: '有', applied_by: '李四', applied_at: '2026-06-20', remark: 'UN38.3 认证' },
  { code: 'M-2026-0008', name: '散热风扇', model: '4010-5V', category: '结构件', supplier: '静音风扇', manufacturer: '建准', unit: 'PCS', status: '红区', cert_expire_date: '2026-01-01', rohs: '有', reach: '有', msds: '无', datasheet: '有', applied_by: '张三', applied_at: '2025-11-03', remark: '型号停产，认证失效' },
  { code: 'M-2026-0009', name: '触摸显示屏', model: '7寸-1024x600', category: '显示', supplier: '视界科技', manufacturer: 'BOE', unit: 'PCS', status: '绿区', cert_expire_date: '2026-12-31', rohs: '有', reach: '有', msds: '有', datasheet: '有', applied_by: '赵六', applied_at: '2026-07-18', remark: '' },
  { code: 'M-2026-0010', name: '薄膜按键', model: 'FK-66KEY', category: '结构件', supplier: '按键之家', manufacturer: '按键之家', unit: 'PCS', status: '红区', cert_expire_date: '', rohs: '有', reach: '无', msds: '无', datasheet: '无', applied_by: '王五', applied_at: '2025-09-15', remark: '已被触摸屏方案替代' },
];

async function main() {
  const existing = await call('GET', '/api/materials?pageSize=1');
  if (existing.total > 0) {
    console.log(`物料库中已有 ${existing.total} 条数据，跳过演示数据写入。`);
    return;
  }
  for (const s of samples) {
    const r = await call('POST', '/api/materials', s);
    console.log(`已写入: ${r.name} (${r.code})`);
  }
  console.log('演示数据写入完成 ✅');
}

main().catch((e) => { console.error('写入失败:', e.message); process.exit(1); });
