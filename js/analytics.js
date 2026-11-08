/**
 * MaintenX Analytics & Business Intelligence Engine
 * Computes KPIs, cost breakdowns, MTTR, downtime distributions, and renders native SVG/Canvas visualizations.
 * 100% computed from real stored IndexedDB records.
 */

import { db, STORES } from './database.js';
import { ui } from './ui.js';
import { SchedulerEngine } from './scheduler.js';

class AnalyticsManager {
  /**
   * Aggregates all high-level KPIs across the workspace
   */
  async getDashboardMetrics() {
    const assets = await db.getAll(STORES.ASSETS);
    const workOrders = await db.getAll(STORES.WORK_ORDERS);
    const plans = await db.getAll(STORES.MAINTENANCE_PLANS);
    const repairs = await db.getAll(STORES.MAINTENANCE_RECORDS);
    const downtime = await db.getAll(STORES.DOWNTIME_EVENTS);
    const parts = await db.getAll(STORES.SPARE_PARTS);

    // Asset status counts
    const totalAssets = assets.length;
    const operationalAssets = assets.filter(a => a.status === 'OPERATIONAL').length;
    const underRepairAssets = assets.filter(a => a.status === 'UNDER REPAIR').length;
    const underMaintenanceAssets = assets.filter(a => a.status === 'UNDER MAINTENANCE').length;
    const outOfServiceAssets = assets.filter(a => a.status === 'OUT OF SERVICE').length;
    const retiredAssets = assets.filter(a => a.status === 'RETIRED').length;

    const operationalRate = totalAssets > 0 ? ((operationalAssets / totalAssets) * 100).toFixed(1) : 100;

    // Maintenance Plans Overdue check
    let overdueMaintenanceCount = 0;
    let dueSoonMaintenanceCount = 0;
    plans.forEach(p => {
      const state = SchedulerEngine.evaluateDueStatus(p.next_due_date, 7);
      if (state.status === 'OVERDUE') overdueMaintenanceCount++;
      if (state.status === 'DUE SOON' || state.status === 'DUE TODAY') dueSoonMaintenanceCount++;
    });

    // Work Orders
    const openWorkOrders = workOrders.filter(w => w.status !== 'COMPLETED' && w.status !== 'CANCELLED').length;
    const completedWorkOrders = workOrders.filter(w => w.status === 'COMPLETED').length;
    const criticalWorkOrders = workOrders.filter(w => w.priority === 'CRITICAL' && w.status !== 'COMPLETED' && w.status !== 'CANCELLED').length;

    // Cost & Downtime
    const totalMaintenanceCost = repairs.reduce((acc, r) => acc + (Number(r.total_cost) || 0), 0);
    const totalDowntimeMinutes = downtime.reduce((acc, d) => acc + (Number(d.duration_minutes) || 0), 0);

    // Low stock parts
    const lowStockCount = parts.filter(p => Number(p.quantity) <= Number(p.minimum_stock)).length;

    return {
      totalAssets,
      operationalAssets,
      underRepairAssets,
      underMaintenanceAssets,
      outOfServiceAssets,
      retiredAssets,
      operationalRate,
      overdueMaintenanceCount,
      dueSoonMaintenanceCount,
      openWorkOrders,
      completedWorkOrders,
      criticalWorkOrders,
      totalMaintenanceCost,
      totalDowntimeMinutes,
      totalDowntimeHours: (totalDowntimeMinutes / 60).toFixed(1),
      lowStockCount
    };
  }

  /**
   * Aggregates breakdown of maintenance costs by equipment category
   */
  async getCostByCategory() {
    const repairs = await db.getAll(STORES.MAINTENANCE_RECORDS);
    const assets = await db.getAll(STORES.ASSETS);
    const assetMap = new Map(assets.map(a => [a.id, a]));

    const categoryCostMap = {};
    repairs.forEach(r => {
      const asset = assetMap.get(r.asset_id);
      const cat = (asset && asset.category) || 'General';
      categoryCostMap[cat] = (categoryCostMap[cat] || 0) + (Number(r.total_cost) || 0);
    });

    return Object.entries(categoryCostMap).map(([category, cost]) => ({
      category,
      cost
    })).sort((a, b) => b.cost - a.cost);
  }

  /**
   * Monthly trend analysis of maintenance cost and downtime minutes (last 6 months)
   */
  async getMonthlyTrends(monthsCount = 6) {
    const repairs = await db.getAll(STORES.MAINTENANCE_RECORDS);
    const downtime = await db.getAll(STORES.DOWNTIME_EVENTS);

    const now = new Date();
    const months = [];

    for (let i = monthsCount - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString(undefined, { month: 'short' });
      months.push({ key, label, cost: 0, downtimeMinutes: 0 });
    }

    const monthMap = new Map(months.map(m => [m.key, m]));

    repairs.forEach(r => {
      if (r.repair_date) {
        const key = r.repair_date.slice(0, 7);
        if (monthMap.has(key)) {
          monthMap.get(key).cost += (Number(r.total_cost) || 0);
        }
      }
    });

    downtime.forEach(d => {
      if (d.started_at) {
        const key = d.started_at.slice(0, 7);
        if (monthMap.has(key)) {
          monthMap.get(key).downtimeMinutes += (Number(d.duration_minutes) || 0);
        }
      }
    });

    return months;
  }

  /**
   * Technician productivity and workload metrics
   */
  async getTechnicianPerformance() {
    const techs = await db.getAll(STORES.TECHNICIANS);
    const workOrders = await db.getAll(STORES.WORK_ORDERS);
    const repairs = await db.getAll(STORES.MAINTENANCE_RECORDS);

    return techs.map(t => {
      const assigned = workOrders.filter(w => w.technician_id === t.id);
      const completed = assigned.filter(w => w.status === 'COMPLETED');
      const pending = assigned.filter(w => w.status !== 'COMPLETED' && w.status !== 'CANCELLED');
      const techRepairs = repairs.filter(r => r.technician_id === t.id);
      const totalLaborGenerated = techRepairs.reduce((acc, r) => acc + (Number(r.labour_cost) || 0), 0);

      return {
        id: t.id,
        name: t.name,
        specialization: t.specialization,
        assignedCount: assigned.length,
        completedCount: completed.length,
        pendingCount: pending.length,
        totalLaborGenerated
      };
    });
  }

  /**
   * Native SVG Donut Chart Renderer
   */
  renderDonutChart(data, { width = 240, height = 240, innerRadius = 60, outerRadius = 90 } = {}) {
    const total = data.reduce((acc, item) => acc + item.value, 0);
    if (total === 0) {
      return `<div style="text-align:center; color:var(--text-dim); font-size:0.875rem;">No data available</div>`;
    }

    const cx = width / 2;
    const cy = height / 2;
    let currentAngle = -Math.PI / 2;
    const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#64748B'];

    let paths = '';
    data.forEach((slice, idx) => {
      if (slice.value <= 0) return;
      const sliceAngle = (slice.value / total) * 2 * Math.PI;
      const endAngle = currentAngle + sliceAngle;

      const x1 = cx + outerRadius * Math.cos(currentAngle);
      const y1 = cy + outerRadius * Math.sin(currentAngle);
      const x2 = cx + outerRadius * Math.cos(endAngle);
      const y2 = cy + outerRadius * Math.sin(endAngle);

      const x3 = cx + innerRadius * Math.cos(endAngle);
      const y3 = cy + innerRadius * Math.sin(endAngle);
      const x4 = cx + innerRadius * Math.cos(currentAngle);
      const y4 = cy + innerRadius * Math.sin(currentAngle);

      const largeArc = sliceAngle > Math.PI ? 1 : 0;
      const color = slice.color || colors[idx % colors.length];

      const d = `M ${x1} ${y1} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4} Z`;
      paths += `<path d="${d}" fill="${color}" opacity="0.9"><title>${slice.label}: ${slice.value}</title></path>`;

      currentAngle = endAngle;
    });

    let legend = `<div style="display:flex; flex-direction:column; gap:6px; font-size:0.75rem; justify-content:center;">`;
    data.forEach((slice, idx) => {
      const color = slice.color || colors[idx % colors.length];
      const pct = ((slice.value / total) * 100).toFixed(0);
      legend += `
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="width:10px; height:10px; border-radius:2px; background:${color}; flex-shrink:0;"></span>
          <span style="color:var(--text-muted);">${slice.label}</span>
          <span style="font-weight:600; margin-left:auto; color:var(--text-main);">${slice.value} (${pct}%)</span>
        </div>
      `;
    });
    legend += `</div>`;

    return `
      <div style="display:flex; align-items:center; justify-content:center; gap:1.5rem; flex-wrap:wrap; width:100%;">
        <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
          ${paths}
          <text x="${cx}" y="${cy}" font-size="16" font-weight="bold" fill="var(--text-main)" text-anchor="middle" dominant-baseline="middle">${total}</text>
        </svg>
        ${legend}
      </div>
    `;
  }

  /**
   * Native SVG Bar Chart Renderer (for trends or category comparisons)
   */
  renderBarChart(data, { width = 500, height = 220, barColor = '#3B82F6', valueFormatter = v => v } = {}) {
    if (!data || data.length === 0) {
      return `<div style="text-align:center; color:var(--text-dim); font-size:0.875rem;">No chart data</div>`;
    }

    const padding = { top: 20, right: 20, bottom: 35, left: 50 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const maxVal = Math.max(...data.map(d => d.value), 10);
    const barWidth = Math.max(16, (chartW / data.length) * 0.6);
    const gap = chartW / data.length;

    let bars = '';
    let gridLines = '';
    const ticks = 4;

    for (let i = 0; i <= ticks; i++) {
      const yVal = (maxVal / ticks) * i;
      const yPos = padding.top + chartH - (yVal / maxVal) * chartH;
      gridLines += `
        <line x1="${padding.left}" y1="${yPos}" x2="${width - padding.right}" y2="${yPos}" stroke="var(--border-subtle)" stroke-dasharray="3 3"/>
        <text x="${padding.left - 8}" y="${yPos + 4}" font-size="10" fill="var(--text-dim)" text-anchor="end">${valueFormatter(Math.round(yVal))}</text>
      `;
    }

    data.forEach((d, i) => {
      const x = padding.left + i * gap + (gap - barWidth) / 2;
      const barH = (d.value / maxVal) * chartH;
      const y = padding.top + chartH - barH;

      bars += `
        <g>
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="4" fill="${d.color || barColor}" opacity="0.88">
            <title>${d.label}: ${valueFormatter(d.value)}</title>
          </rect>
          <text x="${x + barWidth / 2}" y="${height - 10}" font-size="10" fill="var(--text-muted)" text-anchor="middle">${d.label}</text>
        </g>
      `;
    });

    return `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="overflow:visible;">
        ${gridLines}
        ${bars}
      </svg>
    `;
  }
}

export const analytics = new AnalyticsManager();
