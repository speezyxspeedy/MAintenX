/**
 * MaintenX IndexedDB Storage Engine
 * Persistent, local-first Computerized Maintenance Management System storage
 */

const DB_NAME = 'MaintenX_DB';
const DB_VERSION = 2;

export const STORES = {
  ASSETS: 'assets',
  TECHNICIANS: 'technicians',
  WORK_ORDERS: 'work_orders',
  MAINTENANCE_PLANS: 'maintenance_plans',
  MAINTENANCE_RECORDS: 'maintenance_records',
  SPARE_PARTS: 'spare_parts',
  STOCK_MOVEMENTS: 'stock_movements',
  DOWNTIME_EVENTS: 'downtime_events',
  NOTIFICATIONS: 'notifications',
  SETTINGS: 'settings',
  AUDIT_LOGS: 'audit_logs'
};

class DatabaseManager {
  constructor() {
    this.db = null;
    this._initPromise = null;
  }

  /**
   * Initializes and opens IndexedDB with all object stores and indices
   */
  async init() {
    if (this.db) return this.db;
    if (this._initPromise) return this._initPromise;

    this._initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;

        // 1. Assets Store
        if (!db.objectStoreNames.contains(STORES.ASSETS)) {
          const store = db.createObjectStore(STORES.ASSETS, { keyPath: 'id' });
          store.createIndex('asset_code', 'asset_code', { unique: true });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('location', 'location', { unique: false });
          store.createIndex('created_at', 'created_at', { unique: false });
        }

        // 2. Technicians Store
        if (!db.objectStoreNames.contains(STORES.TECHNICIANS)) {
          const store = db.createObjectStore(STORES.TECHNICIANS, { keyPath: 'id' });
          store.createIndex('specialization', 'specialization', { unique: false });
          store.createIndex('availability', 'availability', { unique: false });
        }

        // 3. Work Orders Store
        if (!db.objectStoreNames.contains(STORES.WORK_ORDERS)) {
          const store = db.createObjectStore(STORES.WORK_ORDERS, { keyPath: 'id' });
          store.createIndex('asset_id', 'asset_id', { unique: false });
          store.createIndex('technician_id', 'technician_id', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('priority', 'priority', { unique: false });
          store.createIndex('scheduled_at', 'scheduled_at', { unique: false });
        }

        // 4. Maintenance Plans Store
        if (!db.objectStoreNames.contains(STORES.MAINTENANCE_PLANS)) {
          const store = db.createObjectStore(STORES.MAINTENANCE_PLANS, { keyPath: 'id' });
          store.createIndex('asset_id', 'asset_id', { unique: false });
          store.createIndex('frequency', 'frequency', { unique: false });
          store.createIndex('next_due_date', 'next_due_date', { unique: false });
        }

        // 5. Maintenance Records (Repair History) Store
        if (!db.objectStoreNames.contains(STORES.MAINTENANCE_RECORDS)) {
          const store = db.createObjectStore(STORES.MAINTENANCE_RECORDS, { keyPath: 'id' });
          store.createIndex('asset_id', 'asset_id', { unique: false });
          store.createIndex('work_order_id', 'work_order_id', { unique: false });
          store.createIndex('repair_date', 'repair_date', { unique: false });
        }

        // 6. Spare Parts Store
        if (!db.objectStoreNames.contains(STORES.SPARE_PARTS)) {
          const store = db.createObjectStore(STORES.SPARE_PARTS, { keyPath: 'id' });
          store.createIndex('part_number', 'part_number', { unique: false });
          store.createIndex('quantity', 'quantity', { unique: false });
          store.createIndex('category', 'category', { unique: false });
        }

        // 7. Stock Movements Store
        if (!db.objectStoreNames.contains(STORES.STOCK_MOVEMENTS)) {
          const store = db.createObjectStore(STORES.STOCK_MOVEMENTS, { keyPath: 'id' });
          store.createIndex('part_id', 'part_id', { unique: false });
          store.createIndex('work_order_id', 'work_order_id', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 8. Downtime Events Store
        if (!db.objectStoreNames.contains(STORES.DOWNTIME_EVENTS)) {
          const store = db.createObjectStore(STORES.DOWNTIME_EVENTS, { keyPath: 'id' });
          store.createIndex('asset_id', 'asset_id', { unique: false });
          store.createIndex('work_order_id', 'work_order_id', { unique: false });
          store.createIndex('started_at', 'started_at', { unique: false });
        }

        // 9. Notifications Store
        if (!db.objectStoreNames.contains(STORES.NOTIFICATIONS)) {
          const store = db.createObjectStore(STORES.NOTIFICATIONS, { keyPath: 'id' });
          store.createIndex('is_read', 'is_read', { unique: false });
          store.createIndex('created_at', 'created_at', { unique: false });
          store.createIndex('type', 'type', { unique: false });
        }

        // 10. Settings Store
        if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
          db.createObjectStore(STORES.SETTINGS, { keyPath: 'id' });
        }

        // 11. Audit Logs Store (RBAC & Traceability)
        if (!db.objectStoreNames.contains(STORES.AUDIT_LOGS)) {
          const store = db.createObjectStore(STORES.AUDIT_LOGS, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('user_role', 'user_role', { unique: false });
          store.createIndex('action', 'action', { unique: false });
        }
      };

      request.onsuccess = async () => {
        this.db = request.result;
        await this._ensureDefaultSettings();
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.error('[DatabaseManager] Failed to open IndexedDB:', e);
        reject(request.error);
      };
    });

    return this._initPromise;
  }

  /**
   * Initializes default organizational and system settings if not present
   */
  async _ensureDefaultSettings() {
    const existing = await this.getById(STORES.SETTINGS, 'default');
    if (!existing) {
      await this.add(STORES.SETTINGS, {
        id: 'default',
        organization_name: 'Industrial Facility & Works',
        facility_location: 'Central Plant & Workshop',
        currency_symbol: '$',
        theme: 'dark',
        maintenance_warning_days: [7, 3, 1],
        scheduled_operating_hours_per_day: 24, // For availability calculation (24 = 24/7, 8 = single shift)
        notification_preferences: {
          upcoming_maintenance: true,
          overdue_maintenance: true,
          critical_work_orders: true,
          low_stock_parts: true,
          equipment_downtime: true,
          browser_notifications: false
        },
        active_role: 'Administrator', // Current persona in RBAC
        updated_at: new Date().toISOString()
      });
    }
  }

  /**
   * Safe transaction helper with auto-completion
   */
  async _transaction(storeName, mode, callback) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;

      try {
        result = callback(store, tx);
      } catch (err) {
        reject(err);
        return;
      }

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Transaction aborted'));
    });
  }

  /**
   * Fetch all records from an object store
   */
  async getAll(storeName) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Fetch single record by primary key
   */
  async getById(storeName, id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Fetch records matching an index query
   */
  async getByIndex(storeName, indexName, queryValue) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(queryValue);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Insert new record
   */
  async add(storeName, item) {
    await this.init();
    if (!item.id) {
      item.id = this.generateId(storeName);
    }
    const now = new Date().toISOString();
    if (!item.created_at) item.created_at = now;
    item.updated_at = now;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.add(item);
      request.onsuccess = () => resolve(item);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update existing record
   */
  async update(storeName, item) {
    await this.init();
    item.updated_at = new Date().toISOString();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(item);
      request.onsuccess = () => resolve(item);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete record by ID
   */
  async delete(storeName, id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear an entire object store
   */
  async clearStore(storeName) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all operational data (workspace reset)
   */
  async clearAllData() {
    await this.init();
    const storesToClear = Object.values(STORES);
    for (const store of storesToClear) {
      await this.clearStore(store);
    }
    await this._ensureDefaultSettings();
    return true;
  }

  /**
   * Generates readable, unique IDs by entity type
   * Example: MX-2026-0001, WO-2026-001, PM-101
   */
  generateId(storeName) {
    const year = new Date().getFullYear();
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const timeCode = Date.now().toString(36).slice(-4).toUpperCase();

    switch (storeName) {
      case STORES.ASSETS:
        return `MX-${year}-${randomSuffix}`;
      case STORES.WORK_ORDERS:
        return `WO-${year}-${randomSuffix}`;
      case STORES.MAINTENANCE_PLANS:
        return `PM-${randomSuffix}`;
      case STORES.MAINTENANCE_RECORDS:
        return `REC-${year}-${randomSuffix}`;
      case STORES.TECHNICIANS:
        return `TECH-${randomSuffix}`;
      case STORES.SPARE_PARTS:
        return `PRT-${randomSuffix}`;
      case STORES.STOCK_MOVEMENTS:
        return `MOV-${Date.now()}-${randomSuffix}`;
      case STORES.DOWNTIME_EVENTS:
        return `DWT-${year}-${randomSuffix}`;
      case STORES.NOTIFICATIONS:
        return `NOTIF-${Date.now()}-${randomSuffix}`;
      case STORES.AUDIT_LOGS:
        return `AUDIT-${Date.now()}-${randomSuffix}`;
      default:
        return `ID-${timeCode}-${randomSuffix}`;
    }
  }

  /**
   * Creates a full JSON snapshot of all database object stores
   */
  async exportFullBackup() {
    await this.init();
    const backup = {
      app: 'MaintenX CMMS',
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      counts: {},
      data: {}
    };

    for (const storeName of Object.values(STORES)) {
      const items = await this.getAll(storeName);
      backup.data[storeName] = items;
      backup.counts[storeName] = items.length;
    }

    return backup;
  }

  /**
   * Validates and imports a JSON backup snapshot
   */
  async importFullBackup(backupData, replaceExisting = false) {
    if (!backupData || !backupData.data) {
      throw new Error('Invalid backup schema: Missing data payload.');
    }

    if (replaceExisting) {
      await this.clearAllData();
    }

    for (const storeName of Object.values(STORES)) {
      const items = backupData.data[storeName] || [];
      for (const item of items) {
        if (item.id) {
          const exists = await this.getById(storeName, item.id);
          if (exists) {
            await this.update(storeName, item);
          } else {
            await this.add(storeName, item);
          }
        }
      }
    }

    return true;
  }
}

export const db = new DatabaseManager();
