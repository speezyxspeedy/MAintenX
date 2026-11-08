/**
 * MaintenX Downtime Tracker & Asset Availability Engine
 * Accurately logs outages, calculates Mean Time to Repair (MTTR), and evaluates availability formulas.
 */

import { db, STORES } from './database.js';
import { ui } from './ui.js';
import { authRBAC, PERMISSIONS } from './auth-rbac.js';

export const DOWNTIME_REASONS = [
  'Mechanical Breakdown',
  'Electrical Failure',
  'Software / Firmware Fault',
  'Operator Error',
  'Component Wear & Tear',
  'Emergency Stop Triggered',
  'Hydraulic / Pneumatic Leak',
  'Thermal Overload / Overheating',
  'Scheduled Major Overhaul',
  'Awaiting Spare Parts',
  'Other Failure'
];

class DowntimeManager {
  constructor() {
    this.searchQuery = '';
  }

  async getAllEvents() {
    return await db.getAll(STORES.DOWNTIME_EVENTS);
  }

  /**
   * Starts a new downtime outage event for an asset
   */
  async startDowntime({ asset_id, work_order_id, reason, started_at, notes }) {
    if (!authRBAC.can(PERMISSIONS.DOWNTIME_LOG)) {
      ui.showToast('Access denied: You lack permission to log downtime.', 'danger');
      return null;
    }

    const asset = await db.getById(STORES.ASSETS, asset_id);
    if (!asset) {
      ui.showToast('Selected asset does not exist.', 'danger');
      return null;
    }

    // Check if asset already has an active (unresolved) outage
    const existing = await db.getAll(STORES.DOWNTIME_EVENTS);
    const activeOutage = existing.find(e => e.asset_id === asset_id && !e.ended_at);
    if (activeOutage) {
      ui.showToast(`Asset "${asset.name}" already has an ongoing active downtime event!`, 'warning');
      return activeOutage;
    }

    const newId = db.generateId(STORES.DOWNTIME_EVENTS);
    const event = {
      id: newId,
      asset_id,
      asset_name: asset.name,
      asset_code: asset.asset_code || asset.id,
      category: asset.category,
      work_order_id: work_order_id || null,
      reason: reason || 'Mechanical Breakdown',
      notes: notes || '',
      started_at: started_at || new Date().toISOString(),
      ended_at: null,
      duration_minutes: 0,
      created_at: new Date().toISOString()
    };

    await db.add(STORES.DOWNTIME_EVENTS, event);

    // Update asset status to OUT OF SERVICE or UNDER REPAIR
    asset.status = 'UNDER REPAIR';
    await db.update(STORES.ASSETS, asset);

    await authRBAC.log({
      action: 'DOWNTIME_START',
      entityType: 'DOWNTIME',
      entityId: newId,
      details: `Logged outage for "${asset.name}" due to "${event.reason}"`
    });

    ui.showToast(`Downtime started for ${asset.name}.`, 'warning');
    return event;
  }

  /**
   * Resolves an ongoing downtime event and restores asset to operational
   */
  async endDowntime(eventId, ended_at = null, resolutionNotes = '') {
    if (!authRBAC.can(PERMISSIONS.DOWNTIME_RESOLVE)) {
      ui.showToast('Access denied: You lack permission to resolve downtime.', 'danger');
      return false;
    }

    const event = await db.getById(STORES.DOWNTIME_EVENTS, eventId);
    if (!event) return false;

    const endTime = ended_at ? new Date(ended_at) : new Date();
    const startTime = new Date(event.started_at);

    if (endTime < startTime) {
      ui.showToast('Recovery time cannot precede outage start time.', 'danger');
      return false;
    }

    const durationMinutes = Math.max(1, Math.round((endTime - startTime) / (1000 * 60)));

    event.ended_at = endTime.toISOString();
    event.duration_minutes = durationMinutes;
    if (resolutionNotes) {
      event.notes = (event.notes ? event.notes + ' | ' : '') + `Resolution: ${resolutionNotes}`;
    }

    await db.update(STORES.DOWNTIME_EVENTS, event);

    // Restore asset status if no other active downtime
    const asset = await db.getById(STORES.ASSETS, event.asset_id);
    if (asset) {
      asset.status = 'OPERATIONAL';
      await db.update(STORES.ASSETS, asset);
    }

    await authRBAC.log({
      action: 'DOWNTIME_RESOLVE',
      entityType: 'DOWNTIME',
      entityId: eventId,
      details: `Resolved outage for "${event.asset_name}". Duration: ${ui.formatDuration(durationMinutes)}`
    });

    ui.showToast(`Outage resolved (${ui.formatDuration(durationMinutes)}). Asset restored to OPERATIONAL.`, 'success');
    return true;
  }

  /**
   * Calculates availability, MTTR, and failure statistics over a given day window
   * Formula: Availability % = ((Total Scheduled Time - Downtime) / Total Scheduled Time) * 100
   */
  async calculateMetrics(periodDays = 30) {
    const settings = (await db.getById(STORES.SETTINGS, 'default')) || {};
    const dailyOperatingHours = Number(settings.scheduled_operating_hours_per_day) || 24;
    const assets = await db.getAll(STORES.ASSETS);
    const events = await db.getAll(STORES.DOWNTIME_EVENTS);

    const now = new Date();
    const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);

    // Filter events within window
    const windowEvents = events.filter(e => {
      const start = new Date(e.started_at);
      return start >= periodStart;
    });

    // Total downtime across active assets
    let totalDowntimeMinutes = 0;
    let longestEventMinutes = 0;
    const downtimeByAsset = {};
    const downtimeByCategory = {};
    const downtimeByReason = {};

    windowEvents.forEach(e => {
      // If ongoing, compute duration up to now
      const duration = e.duration_minutes || (e.started_at ? Math.max(1, Math.round((now - new Date(e.started_at)) / 60000)) : 0);
      totalDowntimeMinutes += duration;
      if (duration > longestEventMinutes) longestEventMinutes = duration;

      downtimeByAsset[e.asset_name] = (downtimeByAsset[e.asset_name] || 0) + duration;
      const cat = e.category || 'General';
      downtimeByCategory[cat] = (downtimeByCategory[cat] || 0) + duration;
      downtimeByReason[e.reason] = (downtimeByReason[e.reason] || 0) + duration;
    });

    const activeAssetCount = assets.filter(a => a.status !== 'RETIRED').length || 1;
    const totalScheduledMinutes = activeAssetCount * periodDays * dailyOperatingHours * 60;

    let availabilityPercentage = 100;
    if (totalScheduledMinutes > 0) {
      availabilityPercentage = Math.max(0, Math.min(100, ((totalScheduledMinutes - totalDowntimeMinutes) / totalScheduledMinutes) * 100));
    }

    const failureCount = windowEvents.length;
    const mttrMinutes = failureCount > 0 ? Math.round(totalDowntimeMinutes / failureCount) : 0;

    return {
      periodDays,
      dailyOperatingHours,
      activeAssetCount,
      totalScheduledMinutes,
      totalDowntimeMinutes,
      totalDowntimeHours: (totalDowntimeMinutes / 60).toFixed(1),
      availabilityPercentage: availabilityPercentage.toFixed(2),
      failureCount,
      mttrMinutes,
      longestEventMinutes,
      downtimeByAsset,
      downtimeByCategory,
      downtimeByReason,
      events: windowEvents.sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
    };
  }
}

export const downtimeTracker = new DowntimeManager();
