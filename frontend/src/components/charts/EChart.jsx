import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

// ECharts React 封装：容器尺寸变化自动 resize；option 变化自动重绘。
// 按需引入核心模块（旧版页面从 CDN 引入 echarts，SPA 内改为本地依赖，离线可用且体积更小）。
export default function EChart({ option, height = 320 }) {
  const elRef = useRef(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const chart = echarts.init(el);
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => chart.resize());
      ro.observe(el);
    }
    return () => {
      if (ro) ro.disconnect();
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el || !option) return;
    const chart = echarts.getInstanceByDom(el);
    if (chart) chart.setOption(option, true);
  }, [option]);

  return <div ref={elRef} style={{ width: '100%', height }} />;
}
