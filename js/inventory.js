/**
 * MaintenX Spare Parts Inventory & Stock Movement Engine
 * Tracks maintenance materials, prevents negative stock, enforces min-levels, and logs all movements.
 */

import { db, STORES } from './database.js';
import { ui } from './ui.js';
import { authRBAC, PERMISSIONS } from './auth-rbac.js';
import { notifications } from './notifications.js';

export const PART_CATEGORIES = [
  'Electrical & Electronic',
  'Mechanical & Bearings',
  'Filters & Belts',
  'Hydraulics & Pneumatics',
  'Lubricants & Fluids',
  'Fasteners & Hardware',
  'Cables & Connectors',
  'Sensors & Instruments',
  'Consumables & PPE',
  'Other'
];

class InventoryManager {
  constructor() {
    this.searchQuery = '';
    this.currentCategory = 'ALL';
    this.showLowStockOnly = false;
  }

  async getAllParts() {
    return await db.getAll(STORES.SPARE_PARTS);
  }

  async getFilteredParts() {
    let parts = await this.getAllParts();

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase().trim();
      parts = parts.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.part_number && p.part_number.toLowerCase().includes(q)) ||
        (p.supplier && p.supplier.toLowerCase().includes(q)) ||
        (p.storage_location && p.storage_location.toLowerCase().includes(q))
      );
    }

    if (this.currentCategory !== 'ALL') {
      parts = parts.filter(p => p.category === this.currentCategory);
    }

    if (this.showLowStockOnly) {
      parts = parts.filter(p => Number(p.quantity) <= Number(p.minimum_stock));
    }

    return parts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  async savePart(formData, existingId = null) {
    const qty = Math.max(0, Number(formData.quantity) || 0);
    const minStock = Math.max(0, Number(formData.minimum_stock) || 0);
    const unitCost = Math.max(0, Number(formData.unit_cost) || 0);

    const payload = {
      ...formData,
      quantity: qty,
      minimum_stock: minStock,
      unit_cost: unitCost
    };

    if (existingId) {
      if (!authRBAC.can(PERMISSIONS.INVENTORY_ADD_PART)) {
        ui.showToast('Access denied: You lack permission to edit inventory.', 'danger');
        return null;
      }
      const existing = await db.getById(STORES.SPARE_PARTS, existingId);
      if (!existing) throw new Error('Part not found');

      const updated = {
        ...existing,
        ...payload,
        id: existingId,
        updated_at: new Date().toISOString()
      };
      await db.update(STORES.SPARE_PARTS, updated);
      await authRBAC.log({
        action: 'PART_UPDATE',
        entityType: 'INVENTORY',
        entityId: existingId,
        details: `Updated spare part "${updated.name}" (${updated.part_number})`
      });
      ui.showToast(`Spare part "${updated.name}" updated.`, 'success');
      await notifications.evaluateAlertRules();
      await notifications.updateUnreadCount();
      return updated;
    } else {
      if (!authRBAC.can(PERMISSIONS.INVENTORY_ADD_PART)) {
        ui.showToast('Access denied: You lack permission to add new spare parts.', 'danger');
        return null;
      }

      const newId = db.generateId(STORES.SPARE_PARTS);
      const newPart = {
        id: newId,
        ...payload,
        created_at: new Date().toISOString()
      };

      await db.add(STORES.SPARE_PARTS, newPart);

      // Log initial stock movement if quantity > 0
      if (qty > 0) {
        await this._recordMovement({
          part_id: newId,
          part_name: newPart.name,
          work_order_id: null,
          movement_type: 'INITIAL_STOCK',
          quantity: qty,
          notes: 'Initial inventory registration'
        });
      }

      await authRBAC.log({
        action: 'PART_CREATE',
        entityType: 'INVENTORY',
        entityId: newId,
        details: `Registered new spare part "${newPart.name}" with initial stock ${qty}`
      });
      ui.showToast(`Part "${newPart.name}" added to inventory.`, 'success');
      await notifications.evaluateAlertRules();
      await notifications.updateUnreadCount();
      return newPart;
    }
  }

  /**
   * Restock (add) quantity to a spare part
   */
  async restockPart(partId, quantityToAdd, notes = '') {
    if (!authRBAC.can(PERMISSIONS.INVENTORY_RESTOCK)) {
      ui.showToast('Access denied: You lack permission to adjust stock.', 'danger');
      return false;
    }

    const qty = Number(quantityToAdd);
    if (isNaN(qty) || qty <= 0) {
      ui.showToast('Please enter a valid positive restock quantity.', 'warning');
      return false;
    }

    const part = await db.getById(STORES.SPARE_PARTS, partId);
    if (!part) return false;

    part.quantity = Number(part.quantity) + qty;
    await db.update(STORES.SPARE_PARTS, part);

    await this._recordMovement({
      part_id: partId,
      part_name: part.name,
      work_order_id: null,
      movement_type: 'RESTOCK',
      quantity: qty,
      notes: notes || 'Manual stock replenishment'
    });

    await authRBAC.log({
      action: 'STOCK_RESTOCK',
      entityType: 'INVENTORY',
      entityId: partId,
      details: `Restocked ${qty} units of "${part.name}". New total: ${part.quantity}`
    });

    ui.showToast(`Restocked ${qty} units of ${part.name}.`, 'success');
    await notifications.evaluateAlertRules();
    await notifications.updateUnreadCount();
    return true;
  }

  /**
   * Consume spare parts for a work order or maintenance task
   * Strictly enforces positive inventory and prevents stock from going negative.
   */
  async consumePart(partId, quantityToConsume, workOrderId = null, notes = '') {
    if (!authRBAC.can(PERMISSIONS.INVENTORY_CONSUME)) {
      ui.showToast('Access denied: You lack permission to consume parts.', 'danger');
      return false;
    }

    const qty = Number(quantityToConsume);
    if (isNaN(qty) || qty <= 0) {
      ui.showToast('Please enter a valid consumption quantity.', 'warning');
      return false;
    }

    const part = await db.getById(STORES.SPARE_PARTS, partId);
    if (!part) {
      ui.showToast('Part not found.', 'danger');
      return false;
    }

    if (Number(part.quantity) < qty) {
      ui.showToast(`Insufficient stock! Available: ${part.quantity}, Requested: ${qty}`, 'danger');
      return false;
    }

    const confirmed = await ui.confirmDialog({
      title: 'Confirm Spare Part Consumption',
      message: `Consume ${qty} unit(s) of "${part.name}"? Current stock will decrease from ${part.quantity} to ${part.quantity - qty}.`,
      confirmText: 'Consume Part',
      isDanger: false
    });

    if (!confirmed) return false;

    part.quantity = Number(part.quantity) - qty;
    await db.update(STORES.SPARE_PARTS, part);

    await this._recordMovement({
      part_id: partId,
      part_name: part.name,
      work_order_id: workOrderId,
      movement_type: 'CONSUMED',
      quantity: qty,
      notes: notes || (workOrderId ? `Consumed for Work Order ${workOrderId}` : 'Routine maintenance consumption')
    });

    await authRBAC.log({
      action: 'STOCK_CONSUME',
      entityType: 'INVENTORY',
      entityId: partId,
      details: `Consumed ${qty} units of "${part.name}". Remaining: ${part.quantity}`
    });

    ui.showToast(`Consumed ${qty} units of ${part.name}.`, 'info');
    await notifications.evaluateAlertRules();
    await notifications.updateUnreadCount();
    return true;
  }

  async _recordMovement({ part_id, part_name, work_order_id, movement_type, quantity, notes }) {
    const movement = {
      id: db.generateId(STORES.STOCK_MOVEMENTS),
      part_id,
      part_name,
      work_order_id,
      movement_type,
      quantity,
      notes,
      timestamp: new Date().toISOString()
    };
    await db.add(STORES.STOCK_MOVEMENTS, movement);
  }

  async getMovements(limit = 100) {
    const all = await db.getAll(STORES.STOCK_MOVEMENTS);
    return all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
  }

  async deletePart(id) {
    if (!authRBAC.can(PERMISSIONS.INVENTORY_DELETE_PART)) {
      ui.showToast('Access denied: You lack permission to delete parts.', 'danger');
      return false;
    }

    const part = await db.getById(STORES.SPARE_PARTS, id);
    if (!part) return false;

    const confirmed = await ui.confirmDialog({
      title: 'Delete Spare Part',
      message: `Are you sure you want to delete "${part.name}" (${part.part_number}) from the inventory?`,
      confirmText: 'Delete',
      isDanger: true
    });

    if (confirmed) {
      await db.delete(STORES.SPARE_PARTS, id);
      await authRBAC.log({
        action: 'PART_DELETE',
        entityType: 'INVENTORY',
        entityId: id,
        details: `Deleted spare part "${part.name}"`
      });
      ui.showToast(`Part "${part.name}" deleted.`, 'info');
      return true;
    }
    return false;
  }
}

export const inventory = new InventoryManager();
