/**
 * MaintenX Preventive Maintenance Module
 * Plan builder, reusable PM templates, checklist execution, and cycle recalculation.
 */

import { db, STORES } from './database.js';
import { ui } from './ui.js';
import { authRBAC, PERMISSIONS } from './auth-rbac.js';
import { SchedulerEngine, FREQUENCIES } from './scheduler.js';
import { notifications } from './notifications.js';

export const PM_TEMPLATES = [
  {
    name: 'Computer Lab / IT Hardware PM',
    frequency: 'Monthly',
    checklist: [
      'Inspect chassis fans and clear dust filters',
      'Check internal power supply unit voltages and cables',
      'Verify thermal compound and CPU temperature metrics',
      'Test storage health (SMART status) and backup drives',
      'Verify operating system security updates and antivirus',
      'Inspect physical network cables and switch ports'
    ],
    estimated_cost: 45
  },
  {
    name: 'HVAC Air Handling & Chiller PM',
    frequency: 'Quarterly',
    checklist: [
      'Replace primary air filters and vacuum intake grills',
      'Inspect belt tension and pulley alignment on blowers',
      'Check refrigerant pressures and inspect for oil leaks',
      'Clean condensate drain pan and test float switch shutoff',
      'Verify thermostat calibration and damper actuators',
      'Lubricate motor bearings with approved industrial grease'
    ],
    estimated_cost: 180
  },
  {
    name: 'Industrial Motor & CNC Machining Center PM',
    frequency: 'Monthly',
    checklist: [
      'Check spindle vibration levels and acoustic noise',
      'Inspect way lube reservoir level and automatic pump pressure',
      'Verify pneumatic line pressure (min 6.5 bar) and drain water trap',
      'Inspect emergency stop buttons and safety interlock door switches',
      'Clean chips from telescoping way covers and verify seals',
      'Calibrate tool setter probe and verify axis home limits'
    ],
    estimated_cost: 250
  },
  {
    name: 'Commercial Gym & Fitness Equipment PM',
    frequency: 'Weekly',
    checklist: [
      'Inspect selectorized weight cables for fraying or coating splits',
      'Lubricate guide rods with approved silicone lubricant',
      'Check treadmill belt centering, tension, and deck lubrication',
      'Tighten all structural bolts, carabiners, and pulley pivots',
      'Disinfect touchpoints, vinyl upholstery, and monitor consoles'
    ],
    estimated_cost: 60
  },
  {
    name: 'Fleet Vehicle & Forklift Safety Inspection',
    frequency: 'Monthly',
    checklist: [
      'Check brake fluid, engine oil, and hydraulic reservoir levels',
      'Inspect mast chains for stretch, wear, and proper lubrication',
      'Inspect tires for chunking, flat spots, and correct torque',
      'Test horn, reverse beeper, beacon lights, and headlights',
      'Verify seat switch / dead-man safety brake cutout'
    ],
    estimated_cost: 120
  }
];

class MaintenanceManager {
  constructor() {
    this.searchQuery = '';
    this.frequencyFilter = 'ALL';
    this.calendarYear = new Date().getFullYear();
    this.calendarMonth = new Date().getMonth(); // 0-indexed
    this.calendarView = 'month'; // 'month' | 'week' | 'list'
  }

  async getAllPlans() {
    return await db.getAll(STORES.MAINTENANCE_PLANS);
  }

  async getFilteredPlans() {
    let plans = await this.getAllPlans();
    const assets = await db.getAll(STORES.ASSETS);
    const assetMap = new Map(assets.map(a => [a.id, a]));

    plans = plans.map(p => ({
      ...p,
      asset: assetMap.get(p.asset_id) || { name: 'Unknown Equipment' }
    }));

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase().trim();
      plans = plans.filter(p =>
        (p.id && p.id.toLowerCase().includes(q)) ||
        (p.title && p.title.toLowerCase().includes(q)) ||
        (p.asset.name && p.asset.name.toLowerCase().includes(q)) ||
        (p.technician_name && p.technician_name.toLowerCase().includes(q))
      );
    }

    if (this.frequencyFilter !== 'ALL') {
      plans = plans.filter(p => p.frequency === this.frequencyFilter);
    }

    return plans.sort((a, b) => new Date(a.next_due_date || 0) - new Date(b.next_due_date || 0));
  }

  async savePlan(formData, existingId = null) {
    if (!authRBAC.can(PERMISSIONS.MAINTENANCE_PLAN_CREATE)) {
      ui.showToast('Access denied: You lack permission to configure maintenance plans.', 'danger');
      return null;
    }

    const asset = await db.getById(STORES.ASSETS, formData.asset_id);
    if (!asset) {
      ui.showToast('Selected equipment asset not found.', 'danger');
      return null;
    }

    let techName = 'Unassigned';
    if (formData.technician_id) {
      const tech = await db.getById(STORES.TECHNICIANS, formData.technician_id);
      if (tech) techName = tech.name;
    }

    const nextDueDate = formData.next_due_date || SchedulerEngine.calculateNextDate(formData.last_maintenance_date, formData.frequency, formData.custom_interval_days);

    if (existingId) {
      const existing = await db.getById(STORES.MAINTENANCE_PLANS, existingId);
      if (!existing) throw new Error('Plan not found');

      const updated = {
        ...existing,
        ...formData,
        id: existingId,
        next_due_date: nextDueDate,
        technician_name: techName,
        updated_at: new Date().toISOString()
      };
      await db.update(STORES.MAINTENANCE_PLANS, updated);
      await authRBAC.log({
        action: 'PM_PLAN_UPDATE',
        entityType: 'MAINTENANCE_PLAN',
        entityId: existingId,
        details: `Updated PM Plan "${updated.title}" for ${asset.name}`
      });
      ui.showToast(`Maintenance plan updated.`, 'success');
      await notifications.evaluateAlertRules();
      await notifications.updateUnreadCount();
      return updated;
    } else {
      const newId = db.generateId(STORES.MAINTENANCE_PLANS);
      const newPlan = {
        id: newId,
        asset_id: asset.id,
        asset_name: asset.name,
        asset_code: asset.asset_code || asset.id,
        title: formData.title || `${asset.name} - ${formData.frequency} PM`,
        frequency: formData.frequency || 'Monthly',
        custom_interval_days: Number(formData.custom_interval_days) || 30,
        last_maintenance_date: formData.last_maintenance_date || null,
        next_due_date: nextDueDate,
        technician_id: formData.technician_id || null,
        technician_name: techName,
        estimated_cost: Number(formData.estimated_cost) || 0,
        instructions: formData.instructions || '',
        required_parts: formData.required_parts || '',
        checklist: Array.isArray(formData.checklist) ? formData.checklist : [],
        created_at: new Date().toISOString()
      };

      await db.add(STORES.MAINTENANCE_PLANS, newPlan);
      await authRBAC.log({
        action: 'PM_PLAN_CREATE',
        entityType: 'MAINTENANCE_PLAN',
        entityId: newId,
        details: `Created PM Plan "${newPlan.title}" (${newPlan.frequency}) for ${asset.name}`
      });
      ui.showToast(`Maintenance plan created.`, 'success');
      await notifications.evaluateAlertRules();
      await notifications.updateUnreadCount();
      return newPlan;
    }
  }

  /**
   * Executes and completes a maintenance cycle:
   * 1. Records inspection checklist items and completion notes
   * 2. Automatically updates last_maintenance_date to today
   * 3. Projects next_due_date based on frequency cycle
   * 4. Logs to Maintenance History (Repair History)
   */
  async executeMaintenanceCycle(planId, { completed_date, checklistResults, technician_id, labor_cost, parts_cost, notes }) {
    if (!authRBAC.can(PERMISSIONS.MAINTENANCE_PLAN_EXECUTE)) {
      ui.showToast('Access denied: You lack permission to execute maintenance plans.', 'danger');
      return false;
    }

    const plan = await db.getById(STORES.MAINTENANCE_PLANS, planId);
    if (!plan) return false;

    const actualDate = completed_date || new Date().toISOString().split('T')[0];
    const nextDue = SchedulerEngine.calculateNextDate(actualDate, plan.frequency, plan.custom_interval_days);

    plan.last_maintenance_date = actualDate;
    plan.next_due_date = nextDue;
    await db.update(STORES.MAINTENANCE_PLANS, plan);

    // Save inspection checklist summary to permanent history
    const lCost = Number(labor_cost) || 0;
    const pCost = Number(parts_cost) || 0;
    const totalCost = lCost + pCost;

    const checklistSummary = Object.entries(checklistResults || {})
      .map(([item, result]) => `${item}: ${result}`)
      .join(' | ') || 'Checklist verified.';

    const recId = db.generateId(STORES.MAINTENANCE_RECORDS);
    const rec = {
      id: recId,
      asset_id: plan.asset_id,
      asset_name: plan.asset_name,
      asset_code: plan.asset_code,
      work_order_id: null,
      plan_id: plan.id,
      technician_id: technician_id || plan.technician_id,
      technician_name: plan.technician_name,
      repair_date: actualDate,
      issue_description: `Preventive Maintenance (${plan.frequency}): ${plan.title}`,
      root_cause: 'Routine scheduled inspection & preventive servicing',
      work_performed: `${checklistSummary}${notes ? ' Notes: ' + notes : ''}`,
      parts_replaced: plan.required_parts || 'Standard consumables',
      labour_cost: lCost,
      parts_cost: pCost,
      total_cost: totalCost,
      downtime_minutes: 0,
      completion_status: 'COMPLETED',
      created_at: new Date().toISOString()
    };

    await db.add(STORES.MAINTENANCE_RECORDS, rec);

    // Ensure asset is OPERATIONAL
    const asset = await db.getById(STORES.ASSETS, plan.asset_id);
    if (asset && asset.status !== 'RETIRED') {
      asset.status = 'OPERATIONAL';
      await db.update(STORES.ASSETS, asset);
    }

    await authRBAC.log({
      action: 'PM_PLAN_EXECUTE',
      entityType: 'MAINTENANCE_PLAN',
      entityId: planId,
      details: `Completed PM cycle for "${plan.title}". Next due: ${nextDue}`
    });

    ui.showToast(`Maintenance cycle completed! Next due: ${nextDue}`, 'success');
    await notifications.evaluateAlertRules();
    await notifications.updateUnreadCount();
    return true;
  }

  async deletePlan(planId) {
    if (!authRBAC.can(PERMISSIONS.MAINTENANCE_PLAN_DELETE)) {
      ui.showToast('Access denied: You lack permission to delete plans.', 'danger');
      return false;
    }

    const plan = await db.getById(STORES.MAINTENANCE_PLANS, planId);
    if (!plan) return false;

    const confirmed = await ui.confirmDialog({
      title: 'Delete Maintenance Plan',
      message: `Delete recurring schedule "${plan.title}"?`,
      confirmText: 'Delete',
      isDanger: true
    });

    if (confirmed) {
      await db.delete(STORES.MAINTENANCE_PLANS, planId);
      await authRBAC.log({
        action: 'PM_PLAN_DELETE',
        entityType: 'MAINTENANCE_PLAN',
        entityId: planId,
        details: `Deleted PM plan "${plan.title}"`
      });
      ui.showToast(`Maintenance plan deleted.`, 'info');
      return true;
    }
    return false;
  }
}

export const maintenanceManager = new MaintenanceManager();
