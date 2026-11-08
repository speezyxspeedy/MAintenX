/**
 * MaintenX Smart Notification & Alert Engine
 * Evaluates operational conditions across assets, schedules, work orders, and inventory to generate truthful alerts.
 */

import { db, STORES } from './database.js';
import { ui } from './ui.js';

class NotificationManager {
  constructor() {
    this.unreadCount = 0;
  }

  async init() {
    await this.evaluateAlertRules();
    await this.updateUnreadCount();
  }

  /**
   * Evaluates business rules against real stored records in IndexedDB
   * Never generates synthetic or fake notifications.
   */
  async evaluateAlertRules() {
    const settings = (await db.getById(STORES.SETTINGS, 'default')) || {};
    const warningDays = (settings.maintenance_warning_days && settings.maintenance_warning_days[0]) || 7;
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // 1. Check Maintenance Plans (Overdue & Due Soon)
    const plans = await db.getAll(STORES.MAINTENANCE_PLANS);
    const assets = await db.getAll(STORES.ASSETS);
    const assetMap = new Map(assets.map(a => [a.id, a]));

    for (const plan of plans) {
      if (!plan.next_due_date) continue;
      const dueDate = new Date(plan.next_due_date);
      const diffDays = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
      const asset = assetMap.get(plan.asset_id) || { name: 'Equipment' };

      if (diffDays < 0) {
        await this._createUniqueAlert({
          type: 'OVERDUE_MAINTENANCE',
          title: `Overdue Maintenance: ${asset.name}`,
          description: `Scheduled maintenance was due on ${plan.next_due_date} (${Math.abs(diffDays)} days overdue).`,
          entity_id: plan.id,
          priority: 'critical'
        });
      } else if (diffDays <= warningDays) {
        await this._createUniqueAlert({
          type: 'UPCOMING_MAINTENANCE',
          title: `Maintenance Due Soon: ${asset.name}`,
          description: `Scheduled maintenance is due in ${diffDays} day${diffDays === 1 ? '' : 's'} (${plan.next_due_date}).`,
          entity_id: plan.id,
          priority: 'warning'
        });
      }
    }

    // 2. Check Critical Open Work Orders
    const workOrders = await db.getAll(STORES.WORK_ORDERS);
    for (const wo of workOrders) {
      if (wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED' && wo.priority === 'CRITICAL') {
        const asset = assetMap.get(wo.asset_id) || { name: 'Asset' };
        await this._createUniqueAlert({
          type: 'CRITICAL_WORK_ORDER',
          title: `Critical Work Order: ${wo.title}`,
          description: `High severity issue on ${asset.name}. Assigned to ${wo.technician_name || 'Unassigned'}.`,
          entity_id: wo.id,
          priority: 'critical'
        });
      }
    }

    // 3. Check Low Stock Spare Parts
    const parts = await db.getAll(STORES.SPARE_PARTS);
    for (const part of parts) {
      if (Number(part.quantity) <= Number(part.minimum_stock)) {
        await this._createUniqueAlert({
          type: 'LOW_STOCK',
          title: `Low Stock: ${part.name}`,
          description: `Current quantity (${part.quantity}) is at or below minimum threshold (${part.minimum_stock}). Restock recommended.`,
          entity_id: part.id,
          priority: 'warning'
        });
      }
    }

    // 4. Check Assets Out of Service
    for (const asset of assets) {
      if (asset.status === 'OUT OF SERVICE') {
        await this._createUniqueAlert({
          type: 'ASSET_OUT_OF_SERVICE',
          title: `Equipment Offline: ${asset.name}`,
          description: `Asset ${asset.asset_code || asset.id} is marked Out of Service at location ${asset.location || 'Unknown'}.`,
          entity_id: asset.id,
          priority: 'critical'
        });
      }
    }
  }

  /**
   * Avoids duplicate alert creation for the same event on the same day
   */
  async _createUniqueAlert({ type, title, description, entity_id, priority }) {
    const today = new Date().toISOString().split('T')[0];
    const existing = await db.getAll(STORES.NOTIFICATIONS);
    const duplicate = existing.find(n => n.type === type && n.entity_id === entity_id && n.created_at.startsWith(today));

    if (!duplicate) {
      const notif = {
        id: db.generateId(STORES.NOTIFICATIONS),
        type,
        title,
        description,
        entity_id,
        priority: priority || 'info',
        is_read: false,
        created_at: new Date().toISOString()
      };
      await db.add(STORES.NOTIFICATIONS, notif);
      this._triggerBrowserNotification(notif);
    }
  }

  /**
   * Request browser notification permission with explicit user consent
   */
  async requestBrowserPermission() {
    if (!('Notification' in window)) {
      ui.showToast('Browser notifications are not supported in this environment.', 'warning');
      return false;
    }

    if (Notification.permission === 'granted') {
      ui.showToast('Browser notifications already enabled.', 'info');
      return true;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      ui.showToast('Browser notifications successfully enabled!', 'success');
      const settings = (await db.getById(STORES.SETTINGS, 'default')) || { id: 'default' };
      if (!settings.notification_preferences) settings.notification_preferences = {};
      settings.notification_preferences.browser_notifications = true;
      await db.update(STORES.SETTINGS, settings);
      return true;
    } else {
      ui.showToast('Browser notification permission was denied.', 'warning');
      return false;
    }
  }

  _triggerBrowserNotification(notif) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(`MaintenX: ${notif.title}`, {
          body: notif.description,
          icon: '/assets/logo.svg'
        });
      } catch (e) {
        console.warn('[NotificationManager] Browser notification dispatch failed:', e);
      }
    }
  }

  async getNotifications() {
    const list = await db.getAll(STORES.NOTIFICATIONS);
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  async markAsRead(id) {
    const notif = await db.getById(STORES.NOTIFICATIONS, id);
    if (notif) {
      notif.is_read = true;
      await db.update(STORES.NOTIFICATIONS, notif);
      await this.updateUnreadCount();
    }
  }

  async markAllAsRead() {
    const list = await db.getAll(STORES.NOTIFICATIONS);
    for (const n of list) {
      if (!n.is_read) {
        n.is_read = true;
        await db.update(STORES.NOTIFICATIONS, n);
      }
    }
    await this.updateUnreadCount();
  }

  async clearAll() {
    await db.clearStore(STORES.NOTIFICATIONS);
    await this.updateUnreadCount();
  }

  async updateUnreadCount() {
    const list = await db.getAll(STORES.NOTIFICATIONS);
    const unread = list.filter(n => !n.is_read).length;
    this.unreadCount = unread;

    const badge = document.getElementById('notif-unread-count');
    if (badge) {
      badge.textContent = unread > 0 ? (unread > 99 ? '99+' : unread) : '';
      badge.style.display = unread > 0 ? 'flex' : 'none';
    }

    const navBadge = document.getElementById('nav-notif-badge');
    if (navBadge) {
      navBadge.textContent = unread > 0 ? unread : '';
      navBadge.style.display = unread > 0 ? 'inline-block' : 'none';
    }
  }
}

export const notifications = new NotificationManager();
