/**
 * MaintenX Work Order Management Module
 * Comprehensive lifecycle: triage, technician dispatch, spare parts consumption, and job completion.
 */

import { db, STORES } from './database.js';
import { ui } from './ui.js';
import { authRBAC, PERMISSIONS } from './auth-rbac.js';
import { inventory } from './inventory.js';
import { notifications } from './notifications.js';

export const WORK_ORDER_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'IN PROGRESS',
  'WAITING FOR PARTS',
  'ON HOLD',
  'COMPLETED',
  'CANCELLED'
];

export const WORK_ORDER_PRIORITIES = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
];

export const WORK_ORDER_TYPES = [
  'Corrective Repair',
  'Preventive Maintenance',
  'Safety Inspection',
  'Emergency Breakdown',
  'Calibration / Calibration Check',
  'Facility Modification'
];

class WorkOrderManager {
  constructor() {
    this.searchQuery = '';
    this.statusFilter = 'ALL';
    this.priorityFilter = 'ALL';
    this.viewMode = 'kanban'; // 'kanban' | 'table'
  }

  async getAllWorkOrders() {
    return await db.getAll(STORES.WORK_ORDERS);
  }

  async getFilteredWorkOrders() {
    let orders = await this.getAllWorkOrders();

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase().trim();
      orders = orders.filter(o =>
        (o.id && o.id.toLowerCase().includes(q)) ||
        (o.title && o.title.toLowerCase().includes(q)) ||
        (o.asset_name && o.asset_name.toLowerCase().includes(q)) ||
        (o.technician_name && o.technician_name.toLowerCase().includes(q)) ||
        (o.description && o.description.toLowerCase().includes(q))
      );
    }

    if (this.statusFilter !== 'ALL') {
      orders = orders.filter(o => o.status === this.statusFilter);
    }

    if (this.priorityFilter !== 'ALL') {
      orders = orders.filter(o => o.priority === this.priorityFilter);
    }

    return orders.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }

  async createWorkOrder(formData) {
    if (!authRBAC.can(PERMISSIONS.WORK_ORDER_CREATE)) {
      ui.showToast('Access denied: You lack permission to create work orders.', 'danger');
      return null;
    }

    const asset = await db.getById(STORES.ASSETS, formData.asset_id);
    if (!asset) {
      ui.showToast('Selected asset not found.', 'danger');
      return null;
    }

    let techName = 'Unassigned';
    if (formData.technician_id) {
      const tech = await db.getById(STORES.TECHNICIANS, formData.technician_id);
      if (tech) techName = tech.name;
    }

    const newId = db.generateId(STORES.WORK_ORDERS);
    const order = {
      id: newId,
      asset_id: asset.id,
      asset_name: asset.name,
      asset_code: asset.asset_code || asset.id,
      title: formData.title,
      description: formData.description || '',
      work_type: formData.work_type || 'Corrective Repair',
      priority: formData.priority || 'MEDIUM',
      status: formData.technician_id ? 'ASSIGNED' : 'OPEN',
      technician_id: formData.technician_id || null,
      technician_name: techName,
      scheduled_at: formData.scheduled_at || new Date().toISOString().split('T')[0],
      started_at: null,
      completed_at: null,
      estimated_cost: Number(formData.estimated_cost) || 0,
      actual_cost: 0,
      labor_cost: 0,
      parts_cost: 0,
      used_parts: [],
      notes_history: [
        {
          timestamp: new Date().toISOString(),
          author: authRBAC.getCurrentRole(),
          text: `Work order created with priority ${formData.priority || 'MEDIUM'}`
        }
      ],
      created_at: new Date().toISOString()
    };

    await db.add(STORES.WORK_ORDERS, order);

    // If critical priority or emergency breakdown, change asset status
    if (order.priority === 'CRITICAL' || order.work_type === 'Emergency Breakdown') {
      asset.status = 'UNDER REPAIR';
      await db.update(STORES.ASSETS, asset);
    }

    await authRBAC.log({
      action: 'WORK_ORDER_CREATE',
      entityType: 'WORK_ORDER',
      entityId: newId,
      details: `Created work order "${order.title}" for ${asset.name}`
    });

    ui.showToast(`Work Order ${newId} created.`, 'success');
    await notifications.evaluateAlertRules();
    await notifications.updateUnreadCount();
    return order;
  }

  async updateStatus(workOrderId, newStatus, optionalNote = '') {
    if (!authRBAC.can(PERMISSIONS.WORK_ORDER_UPDATE_STATUS)) {
      ui.showToast('Access denied: You lack permission to update work orders.', 'danger');
      return false;
    }

    const order = await db.getById(STORES.WORK_ORDERS, workOrderId);
    if (!order) return false;

    const oldStatus = order.status;
    order.status = newStatus;

    if (newStatus === 'IN PROGRESS' && !order.started_at) {
      order.started_at = new Date().toISOString();
    }

    order.notes_history = order.notes_history || [];
    order.notes_history.push({
      timestamp: new Date().toISOString(),
      author: authRBAC.getCurrentRole(),
      text: `Status changed from ${oldStatus} to ${newStatus}${optionalNote ? ': ' + optionalNote : ''}`
    });

    await db.update(STORES.WORK_ORDERS, order);

    await authRBAC.log({
      action: 'WORK_ORDER_STATUS',
      entityType: 'WORK_ORDER',
      entityId: workOrderId,
      details: `Transitioned work order ${workOrderId} from ${oldStatus} to ${newStatus}`
    });

    ui.showToast(`Work Order ${workOrderId} moved to ${newStatus}.`, 'info');
    await notifications.evaluateAlertRules();
    await notifications.updateUnreadCount();
    return true;
  }

  /**
   * Add consumed spare part directly to work order
   */
  async consumePartForOrder(workOrderId, partId, quantity) {
    const order = await db.getById(STORES.WORK_ORDERS, workOrderId);
    if (!order) return false;

    const part = await db.getById(STORES.SPARE_PARTS, partId);
    if (!part) return false;

    const success = await inventory.consumePart(
      partId,
      quantity,
      workOrderId,
      `Work order: ${order.title}`
    );

    if (!success) return false;

    const itemCost = Number(part.unit_cost) * Number(quantity);
    order.used_parts = order.used_parts || [];
    order.used_parts.push({
      part_id: partId,
      part_name: part.name,
      part_number: part.part_number,
      quantity: Number(quantity),
      unit_cost: Number(part.unit_cost),
      total_cost: itemCost
    });

    order.parts_cost = (Number(order.parts_cost) || 0) + itemCost;
    order.actual_cost = (Number(order.labor_cost) || 0) + order.parts_cost;

    order.notes_history.push({
      timestamp: new Date().toISOString(),
      author: authRBAC.getCurrentRole(),
      text: `Consumed ${quantity}x ${part.name} ($${itemCost.toFixed(2)})`
    });

    await db.update(STORES.WORK_ORDERS, order);
    ui.showToast(`Parts logged to Work Order ${workOrderId}.`, 'success');
    return true;
  }

  /**
   * Completes a work order, registers the permanent maintenance repair record, and closes downtime
   */
  async completeWorkOrder(workOrderId, { work_performed, root_cause, labor_hours, labor_hourly_rate, downtime_minutes, technician_id }) {
    if (!authRBAC.can(PERMISSIONS.WORK_ORDER_UPDATE_STATUS)) {
      ui.showToast('Access denied: You lack permission to complete work orders.', 'danger');
      return false;
    }

    const order = await db.getById(STORES.WORK_ORDERS, workOrderId);
    if (!order) return false;

    const hours = Number(labor_hours) || 0;
    const rate = Number(labor_hourly_rate) || 50;
    const laborCost = hours * rate;
    const partsCost = Number(order.parts_cost) || 0;
    const totalCost = laborCost + partsCost;

    order.status = 'COMPLETED';
    order.completed_at = new Date().toISOString();
    order.labor_cost = laborCost;
    order.actual_cost = totalCost;

    order.notes_history.push({
      timestamp: new Date().toISOString(),
      author: authRBAC.getCurrentRole(),
      text: `Work order marked COMPLETED. Total cost: $${totalCost.toFixed(2)}`
    });

    await db.update(STORES.WORK_ORDERS, order);

    // Create permanent Maintenance Record (Repair History)
    const recId = db.generateId(STORES.MAINTENANCE_RECORDS);
    const repairRecord = {
      id: recId,
      asset_id: order.asset_id,
      asset_name: order.asset_name,
      asset_code: order.asset_code,
      work_order_id: order.id,
      technician_id: technician_id || order.technician_id,
      technician_name: order.technician_name,
      repair_date: new Date().toISOString().split('T')[0],
      issue_description: order.description || order.title,
      root_cause: root_cause || 'Wear and normal degradation',
      work_performed: work_performed || 'Inspected, serviced, and tested operation.',
      parts_replaced: (order.used_parts || []).map(p => `${p.quantity}x ${p.part_name}`).join(', ') || 'None',
      labour_cost: laborCost,
      parts_cost: partsCost,
      total_cost: totalCost,
      downtime_minutes: Number(downtime_minutes) || 0,
      completion_status: 'COMPLETED',
      created_at: new Date().toISOString()
    };

    await db.add(STORES.MAINTENANCE_RECORDS, repairRecord);

    // Restore asset status to OPERATIONAL
    const asset = await db.getById(STORES.ASSETS, order.asset_id);
    if (asset && asset.status !== 'RETIRED') {
      asset.status = 'OPERATIONAL';
      await db.update(STORES.ASSETS, asset);
    }

    await authRBAC.log({
      action: 'WORK_ORDER_COMPLETE',
      entityType: 'WORK_ORDER',
      entityId: workOrderId,
      details: `Completed work order ${workOrderId} on ${order.asset_name}. Total Cost: $${totalCost.toFixed(2)}`
    });

    ui.showToast(`Work order ${workOrderId} completed and recorded to repair history.`, 'success');
    await notifications.evaluateAlertRules();
    await notifications.updateUnreadCount();
    return true;
  }

  async cancelWorkOrder(workOrderId, reason) {
    if (!authRBAC.can(PERMISSIONS.WORK_ORDER_UPDATE_STATUS)) {
      ui.showToast('Access denied.', 'danger');
      return false;
    }

    const order = await db.getById(STORES.WORK_ORDERS, workOrderId);
    if (!order) return false;

    order.status = 'CANCELLED';
    order.notes_history = order.notes_history || [];
    order.notes_history.push({
      timestamp: new Date().toISOString(),
      author: authRBAC.getCurrentRole(),
      text: `Work order cancelled. Reason: ${reason}`
    });

    await db.update(STORES.WORK_ORDERS, order);

    await authRBAC.log({
      action: 'WORK_ORDER_CANCEL',
      entityType: 'WORK_ORDER',
      entityId: workOrderId,
      details: `Cancelled work order ${workOrderId}. Reason: ${reason}`
    });

    ui.showToast(`Work order ${workOrderId} cancelled.`, 'info');
    return true;
  }

  renderPriorityBadge(priority) {
    let cls = 'badge-low';
    if (priority === 'MEDIUM') cls = 'badge-medium';
    if (priority === 'HIGH') cls = 'badge-waiting-parts';
    if (priority === 'CRITICAL') cls = 'badge-critical';

    return `<span class="badge ${cls}"><span class="badge-dot"></span>${ui.escapeHtml(priority || 'LOW')}</span>`;
  }

  renderStatusBadge(status) {
    let cls = 'badge-maintenance';
    if (status === 'COMPLETED') cls = 'badge-completed';
    if (status === 'CANCELLED') cls = 'badge-retired';
    if (status === 'WAITING FOR PARTS' || status === 'ON HOLD') cls = 'badge-due-soon';
    if (status === 'OPEN') cls = 'badge-maintenance';

    return `<span class="badge ${cls}"><span class="badge-dot"></span>${ui.escapeHtml(status || 'OPEN')}</span>`;
  }
}

export const workOrders = new WorkOrderManager();
