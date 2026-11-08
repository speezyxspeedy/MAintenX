/**
 * MaintenX Role-Based Access Control (RBAC) & Audit Logging Engine
 * Enforces role boundaries, tracks user actions, and maintains an immutable audit trail in IndexedDB.
 */

import { db, STORES } from './database.js';

export const ROLES = {
  ADMINISTRATOR: 'Administrator',
  MAINTENANCE_MANAGER: 'Maintenance Manager',
  TECHNICIAN: 'Technician',
  OPERATOR: 'Operator / Requester',
  AUDITOR: 'Auditor (Read-Only)'
};

export const PERMISSIONS = {
  // Asset Management
  ASSET_CREATE: 'asset:create',
  ASSET_EDIT: 'asset:edit',
  ASSET_DELETE: 'asset:delete',
  ASSET_ARCHIVE: 'asset:archive',
  ASSET_VIEW: 'asset:view',

  // Work Orders
  WORK_ORDER_CREATE: 'work_order:create',
  WORK_ORDER_ASSIGN: 'work_order:assign',
  WORK_ORDER_UPDATE_STATUS: 'work_order:update_status',
  WORK_ORDER_DELETE: 'work_order:delete',

  // Preventive Maintenance
  MAINTENANCE_PLAN_CREATE: 'maintenance_plan:create',
  MAINTENANCE_PLAN_EDIT: 'maintenance_plan:edit',
  MAINTENANCE_PLAN_EXECUTE: 'maintenance_plan:execute',
  MAINTENANCE_PLAN_DELETE: 'maintenance_plan:delete',

  // Spare Parts & Stock
  INVENTORY_ADD_PART: 'inventory:add_part',
  INVENTORY_RESTOCK: 'inventory:restock',
  INVENTORY_CONSUME: 'inventory:consume',
  INVENTORY_DELETE_PART: 'inventory:delete_part',

  // Technicians
  TECHNICIAN_MANAGE: 'technician:manage',

  // Downtime
  DOWNTIME_LOG: 'downtime:log',
  DOWNTIME_RESOLVE: 'downtime:resolve',

  // System & Administration
  SETTINGS_EDIT: 'settings:edit',
  DATA_BACKUP_RESTORE: 'data:backup_restore',
  WORKSPACE_RESET: 'workspace:reset',
  AUDIT_LOG_VIEW: 'audit_log:view'
};

const ROLE_PERMISSIONS = {
  [ROLES.ADMINISTRATOR]: Object.values(PERMISSIONS),
  [ROLES.MAINTENANCE_MANAGER]: [
    PERMISSIONS.ASSET_CREATE,
    PERMISSIONS.ASSET_EDIT,
    PERMISSIONS.ASSET_ARCHIVE,
    PERMISSIONS.ASSET_VIEW,
    PERMISSIONS.WORK_ORDER_CREATE,
    PERMISSIONS.WORK_ORDER_ASSIGN,
    PERMISSIONS.WORK_ORDER_UPDATE_STATUS,
    PERMISSIONS.MAINTENANCE_PLAN_CREATE,
    PERMISSIONS.MAINTENANCE_PLAN_EDIT,
    PERMISSIONS.MAINTENANCE_PLAN_EXECUTE,
    PERMISSIONS.INVENTORY_ADD_PART,
    PERMISSIONS.INVENTORY_RESTOCK,
    PERMISSIONS.INVENTORY_CONSUME,
    PERMISSIONS.TECHNICIAN_MANAGE,
    PERMISSIONS.DOWNTIME_LOG,
    PERMISSIONS.DOWNTIME_RESOLVE,
    PERMISSIONS.AUDIT_LOG_VIEW,
    PERMISSIONS.SETTINGS_EDIT
  ],
  [ROLES.TECHNICIAN]: [
    PERMISSIONS.ASSET_VIEW,
    PERMISSIONS.WORK_ORDER_CREATE,
    PERMISSIONS.WORK_ORDER_UPDATE_STATUS,
    PERMISSIONS.MAINTENANCE_PLAN_EXECUTE,
    PERMISSIONS.INVENTORY_CONSUME,
    PERMISSIONS.DOWNTIME_LOG,
    PERMISSIONS.DOWNTIME_RESOLVE
  ],
  [ROLES.OPERATOR]: [
    PERMISSIONS.ASSET_VIEW,
    PERMISSIONS.WORK_ORDER_CREATE,
    PERMISSIONS.DOWNTIME_LOG
  ],
  [ROLES.AUDITOR]: [
    PERMISSIONS.ASSET_VIEW,
    PERMISSIONS.AUDIT_LOG_VIEW
  ]
};

class AuthRBACManager {
  constructor() {
    this.currentRole = ROLES.ADMINISTRATOR;
    this.currentUser = 'System Admin (Default)';
  }

  async init() {
    const settings = await db.getById(STORES.SETTINGS, 'default');
    if (settings && settings.active_role) {
      this.currentRole = settings.active_role;
    }
  }

  getCurrentRole() {
    return this.currentRole;
  }

  async setRole(roleName) {
    if (Object.values(ROLES).includes(roleName)) {
      const prevRole = this.currentRole;
      this.currentRole = roleName;
      const settings = (await db.getById(STORES.SETTINGS, 'default')) || { id: 'default' };
      settings.active_role = roleName;
      await db.update(STORES.SETTINGS, settings);

      await this.log({
        action: 'ROLE_SWITCH',
        entityType: 'AUTH',
        entityId: roleName,
        details: `Switched active persona from ${prevRole} to ${roleName}`
      });

      window.dispatchEvent(new CustomEvent('maintenx:role-changed', { detail: { role: roleName } }));
      return true;
    }
    return false;
  }

  can(permission) {
    const allowed = ROLE_PERMISSIONS[this.currentRole] || [];
    return allowed.includes(permission);
  }

  /**
   * Records a non-repudiable audit log entry in IndexedDB
   */
  async log({ action, entityType, entityId, details }) {
    try {
      const logEntry = {
        id: db.generateId(STORES.AUDIT_LOGS),
        user_role: this.currentRole,
        action,
        entity_type: entityType,
        entity_id: entityId,
        details: typeof details === 'object' ? JSON.stringify(details) : details,
        timestamp: new Date().toISOString()
      };
      await db.add(STORES.AUDIT_LOGS, logEntry);
    } catch (e) {
      console.warn('[AuditLogger] Failed to save audit log:', e);
    }
  }

  async getAuditLogs(limit = 200) {
    const all = await db.getAll(STORES.AUDIT_LOGS);
    return all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
  }
}

export const authRBAC = new AuthRBACManager();
