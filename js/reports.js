/**
 * MaintenX Reports & Data Export Engine
 * Generates 8 audit-grade industrial maintenance reports with CSV, JSON, and Printable HTML outputs.
 * Enforces spreadsheet formula injection sanitization.
 */

import { db, STORES } from './database.js';
import { ui } from './ui.js';
import { downtimeTracker } from './downtime.js';
import { SchedulerEngine } from './scheduler.js';

class ReportManager {
  /**
   * Generates selected report data model with summary metrics and record rows
   */
  async generateReport(reportType, dateFrom = null, dateTo = null) {
    const generatedAt = new Date().toISOString();
    const settings = (await db.getById(STORES.SETTINGS, 'default')) || {};
    const orgName = settings.organization_name || 'Industrial Facility & Works';

    switch (reportType) {
      case 'ASSET_REGISTRY': {
        const assets = await db.getAll(STORES.ASSETS);
        const totalCost = assets.reduce((acc, a) => acc + (Number(a.purchase_cost) || 0), 0);
        return {
          id: 'RPT-ASSET',
          title: 'Equipment & Asset Registry Report',
          orgName,
          generatedAt,
          summary: [
            { label: 'Total Assets', value: assets.length },
            { label: 'Operational Assets', value: assets.filter(a => a.status === 'OPERATIONAL').length },
            { label: 'Under Repair / Maint.', value: assets.filter(a => a.status === 'UNDER REPAIR' || a.status === 'UNDER MAINTENANCE').length },
            { label: 'Total Capital Value', value: ui.formatCurrency(totalCost) }
          ],
          headers: ['Asset Code', 'Name', 'Category', 'Location', 'Brand / Model', 'Serial No', 'Purchase Date', 'Cost', 'Status'],
          rows: assets.map(a => [
            a.asset_code || a.id,
            a.name,
            a.category,
            a.location || 'N/A',
            `${a.brand || ''} ${a.model || ''}`.trim() || 'N/A',
            a.serial_number || 'N/A',
            ui.formatDate(a.purchase_date),
            ui.formatCurrency(a.purchase_cost),
            a.status
          ])
        };
      }

      case 'MAINTENANCE_SCHEDULE': {
        const plans = await db.getAll(STORES.MAINTENANCE_PLANS);
        const overdue = plans.filter(p => SchedulerEngine.evaluateDueStatus(p.next_due_date).status === 'OVERDUE').length;
        return {
          id: 'RPT-SCHEDULE',
          title: 'Preventive Maintenance Schedule Report',
          orgName,
          generatedAt,
          summary: [
            { label: 'Total Plans', value: plans.length },
            { label: 'Overdue Cycles', value: overdue },
            { label: 'Active Frequencies', value: new Set(plans.map(p => p.frequency)).size }
          ],
          headers: ['Plan Title', 'Asset Code', 'Frequency', 'Last Serviced', 'Next Due Date', 'Due Status', 'Technician', 'Est. Cost'],
          rows: plans.map(p => {
            const status = SchedulerEngine.evaluateDueStatus(p.next_due_date);
            return [
              p.title,
              p.asset_code || p.asset_id,
              p.frequency,
              ui.formatDate(p.last_maintenance_date),
              ui.formatDate(p.next_due_date),
              status.status,
              p.technician_name || 'Unassigned',
              ui.formatCurrency(p.estimated_cost)
            ];
          })
        };
      }

      case 'WORK_ORDERS': {
        let orders = await db.getAll(STORES.WORK_ORDERS);
        if (dateFrom) orders = orders.filter(o => new Date(o.created_at) >= new Date(dateFrom));
        if (dateTo) orders = orders.filter(o => new Date(o.created_at) <= new Date(dateTo + 'T23:59:59'));

        const completed = orders.filter(o => o.status === 'COMPLETED').length;
        const totalActualCost = orders.reduce((acc, o) => acc + (Number(o.actual_cost) || 0), 0);

        return {
          id: 'RPT-WO',
          title: 'Work Orders Audit & Execution Report',
          orgName,
          generatedAt,
          dateRange: dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : 'All Historical Records',
          summary: [
            { label: 'Total Work Orders', value: orders.length },
            { label: 'Completed Jobs', value: completed },
            { label: 'Open / In-Progress', value: orders.length - completed },
            { label: 'Total Work Order Spend', value: ui.formatCurrency(totalActualCost) }
          ],
          headers: ['WO ID', 'Title', 'Asset', 'Priority', 'Status', 'Technician', 'Scheduled', 'Actual Cost'],
          rows: orders.map(o => [
            o.id,
            o.title,
            o.asset_name,
            o.priority,
            o.status,
            o.technician_name || 'Unassigned',
            ui.formatDate(o.scheduled_at),
            ui.formatCurrency(o.actual_cost)
          ])
        };
      }

      case 'REPAIR_HISTORY': {
        let records = await db.getAll(STORES.MAINTENANCE_RECORDS);
        if (dateFrom) records = records.filter(r => new Date(r.repair_date) >= new Date(dateFrom));
        if (dateTo) records = records.filter(r => new Date(r.repair_date) <= new Date(dateTo));

        const totalCost = records.reduce((acc, r) => acc + (Number(r.total_cost) || 0), 0);
        const totalLabor = records.reduce((acc, r) => acc + (Number(r.labour_cost) || 0), 0);
        const totalParts = records.reduce((acc, r) => acc + (Number(r.parts_cost) || 0), 0);

        return {
          id: 'RPT-REPAIR',
          title: 'Asset Repair & Corrective History Report',
          orgName,
          generatedAt,
          dateRange: dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : 'All Historical Records',
          summary: [
            { label: 'Repairs Logged', value: records.length },
            { label: 'Total Maintenance Spend', value: ui.formatCurrency(totalCost) },
            { label: 'Labor Expenditure', value: ui.formatCurrency(totalLabor) },
            { label: 'Parts Expenditure', value: ui.formatCurrency(totalParts) }
          ],
          headers: ['Date', 'Asset', 'Technician', 'Work Performed', 'Root Cause', 'Labor Cost', 'Parts Cost', 'Total Cost', 'Downtime'],
          rows: records.map(r => [
            ui.formatDate(r.repair_date),
            r.asset_name,
            r.technician_name || 'N/A',
            r.work_performed,
            r.root_cause || 'N/A',
            ui.formatCurrency(r.labour_cost),
            ui.formatCurrency(r.parts_cost),
            ui.formatCurrency(r.total_cost),
            ui.formatDuration(r.downtime_minutes)
          ])
        };
      }

      case 'DOWNTIME': {
        const metrics = await downtimeTracker.calculateMetrics(30);
        return {
          id: 'RPT-DOWNTIME',
          title: 'Asset Availability & Downtime Analysis Report',
          orgName,
          generatedAt,
          dateRange: 'Past 30 Days Operating Cycle',
          summary: [
            { label: 'Fleet Availability %', value: `${metrics.availabilityPercentage}%` },
            { label: 'Total Downtime', value: `${metrics.totalDowntimeHours} hrs` },
            { label: 'Failure Incidents', value: metrics.failureCount },
            { label: 'MTTR (Mean Time to Repair)', value: ui.formatDuration(metrics.mttrMinutes) }
          ],
          headers: ['Event ID', 'Asset Code', 'Asset Name', 'Outage Started', 'Outage Ended', 'Duration', 'Reason', 'Resolution / Notes'],
          rows: metrics.events.map(e => [
            e.id,
            e.asset_code || 'N/A',
            e.asset_name,
            ui.formatDateTime(e.started_at),
            e.ended_at ? ui.formatDateTime(e.ended_at) : 'ONGOING OUTAGE',
            ui.formatDuration(e.duration_minutes),
            e.reason,
            e.notes || 'N/A'
          ])
        };
      }

      case 'SPARE_PARTS': {
        const parts = await db.getAll(STORES.SPARE_PARTS);
        const lowStock = parts.filter(p => Number(p.quantity) <= Number(p.minimum_stock)).length;
        const totalValue = parts.reduce((acc, p) => acc + (Number(p.quantity) * Number(p.unit_cost) || 0), 0);

        return {
          id: 'RPT-PARTS',
          title: 'Spare Parts Inventory & Valuation Report',
          orgName,
          generatedAt,
          summary: [
            { label: 'Total Line Items', value: parts.length },
            { label: 'Low Stock Alerts', value: lowStock },
            { label: 'Total Stock Valuation', value: ui.formatCurrency(totalValue) }
          ],
          headers: ['Part Number', 'Name', 'Category', 'Location', 'In Stock', 'Min Level', 'Unit Cost', 'Inventory Value'],
          rows: parts.map(p => [
            p.part_number,
            p.name,
            p.category,
            p.storage_location || 'Bin A-1',
            p.quantity,
            p.minimum_stock,
            ui.formatCurrency(p.unit_cost),
            ui.formatCurrency(Number(p.quantity) * Number(p.unit_cost))
          ])
        };
      }

      case 'MAINTENANCE_COST': {
        const records = await db.getAll(STORES.MAINTENANCE_RECORDS);
        const costByCat = {};
        records.forEach(r => {
          const cat = r.asset_category || 'Industrial Equipment';
          costByCat[cat] = (costByCat[cat] || 0) + (Number(r.total_cost) || 0);
        });

        const totalCost = records.reduce((acc, r) => acc + (Number(r.total_cost) || 0), 0);
        return {
          id: 'RPT-COST',
          title: 'Maintenance Cost & Financial Expenditure Report',
          orgName,
          generatedAt,
          summary: [
            { label: 'Total Expenditure', value: ui.formatCurrency(totalCost) },
            { label: 'Number of Interventions', value: records.length },
            { label: 'Average Cost per Job', value: ui.formatCurrency(records.length ? totalCost / records.length : 0) }
          ],
          headers: ['Date', 'Asset Name', 'Work Order Ref', 'Technician', 'Labor Expense', 'Parts Expense', 'Total Job Cost'],
          rows: records.map(r => [
            ui.formatDate(r.repair_date),
            r.asset_name,
            r.work_order_id || 'PM Routine',
            r.technician_name || 'In-House',
            ui.formatCurrency(r.labour_cost),
            ui.formatCurrency(r.parts_cost),
            ui.formatCurrency(r.total_cost)
          ])
        };
      }

      case 'TECHNICIAN_ACTIVITY': {
        const techs = await db.getAll(STORES.TECHNICIANS);
        const workOrders = await db.getAll(STORES.WORK_ORDERS);
        const records = await db.getAll(STORES.MAINTENANCE_RECORDS);

        return {
          id: 'RPT-TECH',
          title: 'Technician Activity & Workload Report',
          orgName,
          generatedAt,
          summary: [
            { label: 'Active Technicians', value: techs.length },
            { label: 'Completed Jobs', value: workOrders.filter(w => w.status === 'COMPLETED').length },
            { label: 'In-Progress Jobs', value: workOrders.filter(w => w.status === 'IN PROGRESS').length }
          ],
          headers: ['Technician Name', 'Specialization', 'Availability', 'Assigned Work Orders', 'Completed Jobs', 'Total Labor Billed'],
          rows: techs.map(t => {
            const assigned = workOrders.filter(w => w.technician_id === t.id).length;
            const completed = workOrders.filter(w => w.technician_id === t.id && w.status === 'COMPLETED').length;
            const labor = records.filter(r => r.technician_id === t.id).reduce((acc, r) => acc + (Number(r.labour_cost) || 0), 0);
            return [
              t.name,
              t.specialization,
              t.availability || 'AVAILABLE',
              assigned,
              completed,
              ui.formatCurrency(labor)
            ];
          })
        };
      }

      default:
        throw new Error('Unsupported report type');
    }
  }

  /**
   * Export report data to CSV file with formula injection protection
   */
  exportCsv(reportData) {
    const csvRows = [];
    csvRows.push([ui.sanitizeCsvCell(reportData.title)]);
    csvRows.push([ui.sanitizeCsvCell(`Organization: ${reportData.orgName}`)]);
    csvRows.push([ui.sanitizeCsvCell(`Generated: ${ui.formatDateTime(reportData.generatedAt)}`)]);
    if (reportData.dateRange) csvRows.push([ui.sanitizeCsvCell(`Reporting Range: ${reportData.dateRange}`)]);
    csvRows.push([]);

    // Summary metrics row
    if (reportData.summary && reportData.summary.length > 0) {
      csvRows.push(['Metric Summary']);
      reportData.summary.forEach(s => {
        csvRows.push([ui.sanitizeCsvCell(s.label), ui.sanitizeCsvCell(s.value)]);
      });
      csvRows.push([]);
    }

    // Headers & data rows
    csvRows.push(reportData.headers.map(h => ui.sanitizeCsvCell(h)).join(','));
    reportData.rows.forEach(row => {
      csvRows.push(row.map(cell => ui.sanitizeCsvCell(cell)).join(','));
    });

    const csvContent = csvRows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${reportData.id}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    ui.showToast(`Exported "${reportData.title}" to CSV`, 'success');
  }

  /**
   * Export report data to JSON
   */
  exportJson(reportData) {
    const jsonStr = JSON.stringify(reportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${reportData.id}_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    ui.showToast(`Exported "${reportData.title}" to JSON`, 'success');
  }

  /**
   * Opens clean printable HTML view for browser print-to-PDF
   */
  renderPrintableHtml(reportData) {
    const summaryCards = (reportData.summary || []).map(s => `
      <div style="border:1px solid #CBD5E1; padding:10px 14px; border-radius:6px; background:#F8FAFC; min-width:140px;">
        <div style="font-size:11px; text-transform:uppercase; color:#64748B; font-weight:bold;">${ui.escapeHtml(s.label)}</div>
        <div style="font-size:18px; font-weight:bold; color:#0F172A; margin-top:4px;">${ui.escapeHtml(s.value)}</div>
      </div>
    `).join('');

    const tableHeaders = reportData.headers.map(h => `<th style="padding:8px 12px; background:#F1F5F9; border-bottom:2px solid #CBD5E1; text-align:left; font-size:11px; color:#475569; text-transform:uppercase;">${ui.escapeHtml(h)}</th>`).join('');

    const tableRows = reportData.rows.map(r => `
      <tr style="border-bottom:1px solid #E2E8F0;">
        ${r.map(cell => `<td style="padding:8px 12px; font-size:12px; color:#0F172A;">${ui.escapeHtml(cell)}</td>`).join('')}
      </tr>
    `).join('');

    return `
      <div id="printable-report" style="background:#FFFFFF; color:#0F172A; padding:24px; font-family:sans-serif; max-width:100%;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #0F172A; padding-bottom:14px; margin-bottom:18px;">
          <div>
            <h2 style="margin:0; font-size:22px; color:#0F172A; font-weight:800;">${ui.escapeHtml(reportData.title)}</h2>
            <div style="font-size:13px; color:#475569; margin-top:4px;">${ui.escapeHtml(reportData.orgName)} &bull; MaintenX CMMS</div>
          </div>
          <div style="text-align:right; font-size:12px; color:#64748B;">
            <div>Generated: <strong>${ui.escapeHtml(ui.formatDateTime(reportData.generatedAt))}</strong></div>
            ${reportData.dateRange ? `<div>Period: ${ui.escapeHtml(reportData.dateRange)}</div>` : ''}
          </div>
        </div>

        <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px;">
          ${summaryCards}
        </div>

        <table style="width:100%; border-collapse:collapse; text-align:left;">
          <thead>
            <tr>${tableHeaders}</tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>

        <div style="margin-top:24px; border-top:1px dashed #CBD5E1; padding-top:10px; font-size:11px; color:#94A3B8; text-align:center;">
          Generated automatically by MaintenX Industrial Maintenance Management System &bull; Confidential
        </div>
      </div>
    `;
  }
}

export const reportManager = new ReportManager();
