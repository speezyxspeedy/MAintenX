/**
 * MaintenX Asset Registry Module
 * Comprehensive lifecycle management for industrial machinery, IT hardware, tools, and facility equipment.
 */

import { db, STORES } from './database.js';
import { ui } from './ui.js';
import { authRBAC, PERMISSIONS } from './auth-rbac.js';
import { QRGenerator } from './qr-generator.js';

export const ASSET_CATEGORIES = [
  'Computers & IT Equipment',
  'Industrial Machinery',
  'Electrical Equipment',
  'HVAC',
  'Vehicles',
  'Gym Equipment',
  'Laboratory Equipment',
  'Office Equipment',
  'Tools & Instruments',
  'Other'
];

export const ASSET_STATUSES = [
  'OPERATIONAL',
  'UNDER MAINTENANCE',
  'UNDER REPAIR',
  'OUT OF SERVICE',
  'RETIRED'
];

class AssetRegistryManager {
  constructor() {
    this.currentFilterCategory = 'ALL';
    this.currentFilterStatus = 'ALL';
    this.searchQuery = '';
    this.currentSort = 'name_asc';
  }

  async getAllAssets() {
    return await db.getAll(STORES.ASSETS);
  }

  async getFilteredAssets() {
    let assets = await this.getAllAssets();

    // Text search
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase().trim();
      assets = assets.filter(a =>
        (a.name && a.name.toLowerCase().includes(q)) ||
        (a.asset_code && a.asset_code.toLowerCase().includes(q)) ||
        (a.serial_number && a.serial_number.toLowerCase().includes(q)) ||
        (a.location && a.location.toLowerCase().includes(q)) ||
        (a.brand && a.brand.toLowerCase().includes(q))
      );
    }

    // Category filter
    if (this.currentFilterCategory !== 'ALL') {
      assets = assets.filter(a => a.category === this.currentFilterCategory);
    }

    // Status filter
    if (this.currentFilterStatus !== 'ALL') {
      assets = assets.filter(a => a.status === this.currentFilterStatus);
    }

    // Sorting
    assets.sort((a, b) => {
      if (this.currentSort === 'name_asc') return (a.name || '').localeCompare(b.name || '');
      if (this.currentSort === 'name_desc') return (b.name || '').localeCompare(a.name || '');
      if (this.currentSort === 'code_asc') return (a.asset_code || '').localeCompare(b.asset_code || '');
      if (this.currentSort === 'cost_desc') return (Number(b.purchase_cost) || 0) - (Number(a.purchase_cost) || 0);
      if (this.currentSort === 'date_desc') return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      return 0;
    });

    return assets;
  }

  async saveAsset(formData, existingId = null) {
    if (existingId) {
      if (!authRBAC.can(PERMISSIONS.ASSET_EDIT)) {
        ui.showToast('Access denied: You lack permission to edit assets.', 'danger');
        return null;
      }
      const existing = await db.getById(STORES.ASSETS, existingId);
      if (!existing) throw new Error('Asset not found');

      const updated = {
        ...existing,
        ...formData,
        id: existingId,
        updated_at: new Date().toISOString()
      };
      await db.update(STORES.ASSETS, updated);
      await authRBAC.log({
        action: 'ASSET_UPDATE',
        entityType: 'ASSET',
        entityId: existingId,
        details: `Updated asset "${updated.name}" (${updated.asset_code})`
      });
      ui.showToast(`Asset "${updated.name}" updated successfully.`, 'success');
      return updated;
    } else {
      if (!authRBAC.can(PERMISSIONS.ASSET_CREATE)) {
        ui.showToast('Access denied: You lack permission to register new assets.', 'danger');
        return null;
      }

      const newId = db.generateId(STORES.ASSETS);
      const newAsset = {
        id: newId,
        asset_code: formData.asset_code || newId,
        ...formData,
        status: formData.status || 'OPERATIONAL',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      await db.add(STORES.ASSETS, newAsset);
      await authRBAC.log({
        action: 'ASSET_CREATE',
        entityType: 'ASSET',
        entityId: newId,
        details: `Registered equipment "${newAsset.name}" with ID ${newAsset.asset_code}`
      });
      ui.showToast(`Asset "${newAsset.name}" registered successfully.`, 'success');
      return newAsset;
    }
  }

  async deleteAsset(id) {
    if (!authRBAC.can(PERMISSIONS.ASSET_DELETE)) {
      ui.showToast('Access denied: Only Administrators can delete assets.', 'danger');
      return false;
    }

    const asset = await db.getById(STORES.ASSETS, id);
    if (!asset) return false;

    const confirmed = await ui.confirmDialog({
      title: 'Delete Asset Permanently',
      message: `Are you sure you want to delete "${asset.name}" (${asset.asset_code || asset.id})? This will permanently remove its record from local storage.`,
      confirmText: 'Delete Asset',
      isDanger: true
    });

    if (confirmed) {
      await db.delete(STORES.ASSETS, id);
      await authRBAC.log({
        action: 'ASSET_DELETE',
        entityType: 'ASSET',
        entityId: id,
        details: `Permanently deleted asset "${asset.name}" (${asset.asset_code})`
      });
      ui.showToast(`Asset "${asset.name}" deleted.`, 'info');
      return true;
    }
    return false;
  }

  async archiveAsset(id) {
    if (!authRBAC.can(PERMISSIONS.ASSET_ARCHIVE)) {
      ui.showToast('Access denied: Insufficient permissions to archive assets.', 'danger');
      return false;
    }

    const asset = await db.getById(STORES.ASSETS, id);
    if (!asset) return false;

    asset.status = 'RETIRED';
    await db.update(STORES.ASSETS, asset);
    await authRBAC.log({
      action: 'ASSET_ARCHIVE',
      entityType: 'ASSET',
      entityId: id,
      details: `Archived/Retired asset "${asset.name}" (${asset.asset_code})`
    });
    ui.showToast(`Asset "${asset.name}" moved to RETIRED status.`, 'info');
    return true;
  }

  /**
   * Generates complete dossier data for Asset Detail modal
   */
  async getAssetDossier(id) {
    const asset = await db.getById(STORES.ASSETS, id);
    if (!asset) return null;

    const plans = (await db.getAll(STORES.MAINTENANCE_PLANS)).filter(p => p.asset_id === id);
    const workOrders = (await db.getAll(STORES.WORK_ORDERS)).filter(w => w.asset_id === id);
    const repairs = (await db.getAll(STORES.MAINTENANCE_RECORDS)).filter(r => r.asset_id === id);
    const downtime = (await db.getAll(STORES.DOWNTIME_EVENTS)).filter(d => d.asset_id === id);

    const totalMaintenanceCost = repairs.reduce((acc, r) => acc + (Number(r.total_cost) || 0), 0);
    const totalDowntimeMinutes = downtime.reduce((acc, d) => acc + (Number(d.duration_minutes) || 0), 0);

    return {
      asset,
      plans,
      workOrders,
      repairs,
      downtime,
      totalMaintenanceCost,
      totalDowntimeMinutes
    };
  }

  renderStatusBadge(status) {
    let cls = 'badge-operational';
    if (status === 'UNDER MAINTENANCE') cls = 'badge-maintenance';
    if (status === 'UNDER REPAIR') cls = 'badge-under-repair';
    if (status === 'OUT OF SERVICE') cls = 'badge-out-of-service';
    if (status === 'RETIRED') cls = 'badge-retired';

    return `<span class="badge ${cls}"><span class="badge-dot"></span>${ui.escapeHtml(status || 'OPERATIONAL')}</span>`;
  }
}

export const assetRegistry = new AssetRegistryManager();
