/**
 * MaintenX Repair History & Maintenance Records Module
 * Chronological timelines, labor and parts cost auditing, root cause tracking, and historical export.
 */

import { db, STORES } from './database.js';
import { ui } from './ui.js';

class RepairHistoryManager {
  constructor() {
    this.searchQuery = '';
    this.selectedAssetId = 'ALL';
  }

  async getAllRecords() {
    return await db.getAll(STORES.MAINTENANCE_RECORDS);
  }

  async getFilteredRecords() {
    let records = await this.getAllRecords();

    if (this.selectedAssetId !== 'ALL') {
      records = records.filter(r => r.asset_id === this.selectedAssetId);
    }

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase().trim();
      records = records.filter(r =>
        (r.asset_name && r.asset_name.toLowerCase().includes(q)) ||
        (r.work_performed && r.work_performed.toLowerCase().includes(q)) ||
        (r.root_cause && r.root_cause.toLowerCase().includes(q)) ||
        (r.technician_name && r.technician_name.toLowerCase().includes(q)) ||
        (r.parts_replaced && r.parts_replaced.toLowerCase().includes(q))
      );
    }

    return records.sort((a, b) => new Date(b.repair_date || 0) - new Date(a.repair_date || 0));
  }

  async getSummaryMetrics() {
    const records = await this.getAllRecords();
    let totalSpend = 0;
    let totalLabor = 0;
    let totalParts = 0;
    let totalDowntimeMins = 0;

    records.forEach(r => {
      totalSpend += (Number(r.total_cost) || 0);
      totalLabor += (Number(r.labour_cost) || 0);
      totalParts += (Number(r.parts_cost) || 0);
      totalDowntimeMins += (Number(r.downtime_minutes) || 0);
    });

    const avgCost = records.length > 0 ? (totalSpend / records.length) : 0;

    return {
      recordCount: records.length,
      totalSpend,
      totalLabor,
      totalParts,
      avgCost,
      totalDowntimeMins,
      totalDowntimeHours: (totalDowntimeMins / 60).toFixed(1)
    };
  }

  /**
   * Export repair history to CSV with spreadsheet formula injection protection
   */
  async exportCsv() {
    const records = await this.getFilteredRecords();
    const headers = [
      'Record ID',
      'Date',
      'Asset Name',
      'Asset Code',
      'Work Order ID',
      'Technician',
      'Issue Description',
      'Root Cause',
      'Work Performed',
      'Parts Replaced',
      'Labor Cost ($)',
      'Parts Cost ($)',
      'Total Cost ($)',
      'Downtime (Minutes)',
      'Status'
    ];

    const rows = records.map(r => [
      ui.sanitizeCsvCell(r.id),
      ui.sanitizeCsvCell(r.repair_date),
      ui.sanitizeCsvCell(r.asset_name),
      ui.sanitizeCsvCell(r.asset_code),
      ui.sanitizeCsvCell(r.work_order_id || 'N/A'),
      ui.sanitizeCsvCell(r.technician_name || 'N/A'),
      ui.sanitizeCsvCell(r.issue_description),
      ui.sanitizeCsvCell(r.root_cause),
      ui.sanitizeCsvCell(r.work_performed),
      ui.sanitizeCsvCell(r.parts_replaced),
      ui.sanitizeCsvCell(r.labour_cost || 0),
      ui.sanitizeCsvCell(r.parts_cost || 0),
      ui.sanitizeCsvCell(r.total_cost || 0),
      ui.sanitizeCsvCell(r.downtime_minutes || 0),
      ui.sanitizeCsvCell(r.completion_status)
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `MaintenX_Repair_History_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    ui.showToast('Repair history exported to CSV.', 'success');
  }
}

export const repairHistory = new RepairHistoryManager();
