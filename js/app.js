/**
 * MaintenX CMMS Core Application Router & View Orchestrator
 * Connects all domain modules, binds event listeners, renders views, and handles global search.
 */

import { db, STORES } from './database.js';
import { ui } from './ui.js';
import { authRBAC, ROLES, PERMISSIONS } from './auth-rbac.js';
import { notifications } from './notifications.js';
import { assetRegistry, ASSET_CATEGORIES, ASSET_STATUSES } from './assets.js';
import { technicianDirectory, SPECIALIZATIONS, AVAILABILITY_STATUSES } from './technicians.js';
import { workOrders, WORK_ORDER_STATUSES, WORK_ORDER_PRIORITIES, WORK_ORDER_TYPES } from './work-orders.js';
import { maintenanceManager, PM_TEMPLATES } from './maintenance.js';
import { SchedulerEngine, FREQUENCIES } from './scheduler.js';
import { repairHistory } from './repairs.js';
import { inventory, PART_CATEGORIES } from './inventory.js';
import { downtimeTracker, DOWNTIME_REASONS } from './downtime.js';
import { analytics } from './analytics.js';
import { reportManager } from './reports.js';
import { backupManager } from './backup.js';
import { QRGenerator } from './qr-generator.js';

class MaintenXApp {
  constructor() {
    this.currentView = 'overview';
    this.activeSearchQuery = '';
  }

  async init() {
    try {
      await db.init();
      await authRBAC.init();
      await ui.init();
      await notifications.init();

      this._bindGlobalEvents();
      this._updateRoleSelector();
      this._setupServiceWorker();

      // Check if database is empty on first run, prompt or auto-suggest loading demo
      const existingAssets = await db.getAll(STORES.ASSETS);
      if (existingAssets.length === 0) {
        // Automatically seed demo data so the app opens with a fully realized, rich industrial CMMS workspace
        await backupManager.loadDemoWorkspace();
      }

      await this.navigate(this.currentView);
    } catch (e) {
      console.error('[MaintenX] Initialization error:', e);
      ui.showToast('Failed to initialize local database.', 'danger');
    }
  }

  _setupServiceWorker() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('/sw.js').then(() => {
        console.log('[MaintenX] Service Worker registered for offline operations.');
      }).catch(err => {
        console.warn('[MaintenX] Service Worker registration skipped:', err);
      });
    }
  }

  _updateRoleSelector() {
    const roleSelect = document.getElementById('header-role-select');
    if (roleSelect) {
      roleSelect.value = authRBAC.getCurrentRole();
    }
  }

  _bindGlobalEvents() {
    // 1. Navigation items
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = el.getAttribute('data-nav');
        this.navigate(targetView);
        // Mobile sidebar auto-close
        document.querySelector('.app-sidebar')?.classList.remove('open');
      });
    });

    // 2. Mobile hamburger
    const mobileToggle = document.getElementById('mobile-menu-toggle');
    if (mobileToggle) {
      mobileToggle.addEventListener('click', () => {
        document.querySelector('.app-sidebar')?.classList.toggle('open');
      });
    }

    // 3. Theme Toggle
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => ui.toggleTheme());
    }

    // 4. Role Selector
    const roleSelect = document.getElementById('header-role-select');
    if (roleSelect) {
      roleSelect.addEventListener('change', async (e) => {
        await authRBAC.setRole(e.target.value);
        ui.showToast(`Switched active persona to ${e.target.value}`, 'info');
        this.navigate(this.currentView);
      });
    }

    // 5. Notifications Bell Button
    const notifBtn = document.getElementById('notifications-btn');
    if (notifBtn) {
      notifBtn.addEventListener('click', () => this.openNotificationsModal());
    }

    // 6. Global Search Keyboard Shortcut (Ctrl+K or Cmd+K)
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.openGlobalSearch();
      }
    });

    const searchInput = document.getElementById('header-search-input');
    if (searchInput) {
      searchInput.addEventListener('click', () => this.openGlobalSearch());
      searchInput.addEventListener('focus', () => this.openGlobalSearch());
    }

    // 7. Quick Action (+) Button
    const quickActionBtn = document.getElementById('quick-action-btn');
    if (quickActionBtn) {
      quickActionBtn.addEventListener('click', () => this.openQuickActionMenu());
    }

    // Modal background click to close
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
        document.body.style.overflow = '';
      }
    });

    // Modal close buttons [data-close-modal]
    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-close-modal]');
      if (closeBtn) {
        const modalId = closeBtn.getAttribute('data-close-modal');
        ui.closeModal(modalId);
      }
    });
  }

  async navigate(viewName) {
    this.currentView = viewName;

    // Update active nav item in sidebar
    document.querySelectorAll('.nav-item').forEach(item => {
      if (item.getAttribute('data-nav') === viewName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    const contentArea = document.getElementById('main-content-area');
    if (!contentArea) return;

    contentArea.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--text-dim);">Loading ${viewName}...</div>`;

    switch (viewName) {
      case 'overview':
        await this.renderOverview(contentArea);
        break;
      case 'assets':
        await this.renderAssetRegistry(contentArea);
        break;
      case 'calendar':
        await this.renderMaintenanceCalendar(contentArea);
        break;
      case 'work-orders':
        await this.renderWorkOrders(contentArea);
        break;
      case 'preventive':
        await this.renderPreventiveMaintenance(contentArea);
        break;
      case 'repairs':
        await this.renderRepairHistory(contentArea);
        break;
      case 'inventory':
        await this.renderSpareParts(contentArea);
        break;
      case 'technicians':
        await this.renderTechnicians(contentArea);
        break;
      case 'downtime':
        await this.renderDowntimeTracker(contentArea);
        break;
      case 'reports':
        await this.renderReports(contentArea);
        break;
      case 'settings':
        await this.renderSettings(contentArea);
        break;
      default:
        await this.renderOverview(contentArea);
        break;
    }

    // Refresh unread counts
    await notifications.updateUnreadCount();
  }

  /* ==========================================================================
     1. OVERVIEW / DASHBOARD VIEW
     ========================================================================== */
  async renderOverview(container) {
    const metrics = await analytics.getDashboardMetrics();
    const costTrends = await analytics.getMonthlyTrends(6);
    const costByCategory = await analytics.getCostByCategory();
    const recentWorkOrders = (await db.getAll(STORES.WORK_ORDERS)).slice(0, 5);
    const activeOutages = (await db.getAll(STORES.DOWNTIME_EVENTS)).filter(e => !e.ended_at);

    let outagesBanner = '';
    if (activeOutages.length > 0) {
      outagesBanner = `
        <div class="alert-banner critical">
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <span style="font-size:1.25rem;">⚠️</span>
            <div>
              <strong>${activeOutages.length} Active Outage${activeOutages.length === 1 ? '' : 's'} in Progress:</strong>
              ${activeOutages.map(o => `<span>${ui.escapeHtml(o.asset_name)} (${ui.escapeHtml(o.reason)})</span>`).join(', ')}
            </div>
          </div>
          <button class="btn btn-sm btn-secondary" id="dash-view-downtime-btn">View Downtime Tracker</button>
        </div>
      `;
    }

    const donutData = [
      { label: 'Operational', value: metrics.operationalAssets, color: '#10B981' },
      { label: 'Under Repair', value: metrics.underRepairAssets, color: '#EF4444' },
      { label: 'Under Maint.', value: metrics.underMaintenanceAssets, color: '#3B82F6' },
      { label: 'Out of Service', value: metrics.outOfServiceAssets, color: '#F59E0B' },
      { label: 'Retired', value: metrics.retiredAssets, color: '#64748B' }
    ].filter(d => d.value > 0);

    const barData = costTrends.map(m => ({
      label: m.label,
      value: m.cost,
      color: '#3B82F6'
    }));

    container.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div class="page-title-group">
            <h1>Industrial Maintenance Overview</h1>
            <p>Operational health, real-time outage status, and scheduled work orders.</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary" id="dash-load-demo-btn">
              <span>↻</span> Reload Demo Data
            </button>
            <button class="btn btn-primary" id="dash-quick-wo-btn">
              <span>+</span> Create Work Order
            </button>
          </div>
        </div>

        ${outagesBanner}

        <!-- 8 Key Metrics Cards -->
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-header">
              <span class="stat-title">Total Assets</span>
              <span class="stat-icon" style="background:var(--primary-subtle); color:var(--primary);">🏭</span>
            </div>
            <div class="stat-value">${metrics.totalAssets}</div>
            <div class="stat-sub"><span style="color:var(--success); font-weight:600;">${metrics.operationalRate}%</span> Fleet Operational</div>
          </div>

          <div class="stat-card">
            <div class="stat-header">
              <span class="stat-title">Overdue Maint.</span>
              <span class="stat-icon" style="background:var(--danger-subtle); color:var(--danger);">⏱️</span>
            </div>
            <div class="stat-value" style="color:${metrics.overdueMaintenanceCount > 0 ? 'var(--danger)' : 'inherit'};">${metrics.overdueMaintenanceCount}</div>
            <div class="stat-sub">${metrics.dueSoonMaintenanceCount} Due within warning window</div>
          </div>

          <div class="stat-card">
            <div class="stat-header">
              <span class="stat-title">Open Work Orders</span>
              <span class="stat-icon" style="background:var(--warning-subtle); color:var(--warning);">📋</span>
            </div>
            <div class="stat-value">${metrics.openWorkOrders}</div>
            <div class="stat-sub">${metrics.criticalWorkOrders} High/Critical Priority</div>
          </div>

          <div class="stat-card">
            <div class="stat-header">
              <span class="stat-title">Completed Jobs</span>
              <span class="stat-icon" style="background:var(--success-subtle); color:var(--success);">✓</span>
            </div>
            <div class="stat-value">${metrics.completedWorkOrders}</div>
            <div class="stat-sub">Archived with full repair history</div>
          </div>

          <div class="stat-card">
            <div class="stat-header">
              <span class="stat-title">Total Maintenance Spend</span>
              <span class="stat-icon" style="background:rgba(139, 92, 246, 0.15); color:var(--accent-purple);">$</span>
            </div>
            <div class="stat-value">${ui.formatCurrency(metrics.totalMaintenanceCost)}</div>
            <div class="stat-sub">Labor + Consumed spare parts</div>
          </div>

          <div class="stat-card">
            <div class="stat-header">
              <span class="stat-title">Total Downtime</span>
              <span class="stat-icon" style="background:var(--danger-subtle); color:var(--danger);">⏳</span>
            </div>
            <div class="stat-value">${metrics.totalDowntimeHours} <span style="font-size:1rem;">hrs</span></div>
            <div class="stat-sub">${ui.formatDuration(metrics.totalDowntimeMinutes)} total downtime logged</div>
          </div>

          <div class="stat-card">
            <div class="stat-header">
              <span class="stat-title">Low Stock Alerts</span>
              <span class="stat-icon" style="background:var(--warning-subtle); color:var(--warning);">📦</span>
            </div>
            <div class="stat-value" style="color:${metrics.lowStockCount > 0 ? 'var(--warning)' : 'inherit'};">${metrics.lowStockCount}</div>
            <div class="stat-sub">Parts below minimum threshold</div>
          </div>

          <div class="stat-card">
            <div class="stat-header">
              <span class="stat-title">Active Outages</span>
              <span class="stat-icon" style="background:var(--danger-subtle); color:var(--danger);">⚡</span>
            </div>
            <div class="stat-value">${activeOutages.length}</div>
            <div class="stat-sub">${activeOutages.length === 0 ? 'All production systems running' : 'Action required'}</div>
          </div>
        </div>

        <!-- Visual Analytics Row -->
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap:1.5rem;">
          <div class="card">
            <div class="card-header">
              <div class="card-title"><span>📊</span> Asset Health Distribution</div>
            </div>
            <div class="card-body">
              ${analytics.renderDonutChart(donutData, { width: 220, height: 220, innerRadius: 55, outerRadius: 85 })}
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title"><span>📈</span> 6-Month Maintenance Cost Trend</div>
            </div>
            <div class="card-body">
              ${analytics.renderBarChart(barData, { width: 480, height: 220, valueFormatter: v => `$${v}` })}
            </div>
          </div>
        </div>

        <!-- Recent Work Orders Summary Table -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span>📋</span> Active Work Orders</div>
            <button class="btn btn-sm btn-secondary" id="dash-view-all-wo-btn">View All Work Orders</button>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>WO ID</th>
                  <th>Title</th>
                  <th>Equipment</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Assigned Tech</th>
                  <th>Scheduled</th>
                </tr>
              </thead>
              <tbody>
                ${recentWorkOrders.length === 0 ? `<tr><td colspan="7" style="text-align:center; color:var(--text-dim); padding:2rem;">No active work orders</td></tr>` : recentWorkOrders.map(wo => `
                  <tr>
                    <td style="font-family:var(--font-mono); font-weight:600;">${wo.id}</td>
                    <td><strong>${ui.escapeHtml(wo.title)}</strong></td>
                    <td>${ui.escapeHtml(wo.asset_name || 'N/A')}</td>
                    <td>${workOrders.renderPriorityBadge(wo.priority)}</td>
                    <td>${workOrders.renderStatusBadge(wo.status)}</td>
                    <td>${ui.escapeHtml(wo.technician_name || 'Unassigned')}</td>
                    <td>${ui.formatDate(wo.scheduled_at)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Event hooks
    document.getElementById('dash-view-downtime-btn')?.addEventListener('click', () => this.navigate('downtime'));
    document.getElementById('dash-view-all-wo-btn')?.addEventListener('click', () => this.navigate('work-orders'));
    document.getElementById('dash-quick-wo-btn')?.addEventListener('click', () => this.openWorkOrderModal());
    document.getElementById('dash-load-demo-btn')?.addEventListener('click', async () => {
      const confirmed = await ui.confirmDialog({
        title: 'Reload Demo Data',
        message: 'This will reset and re-populate the workspace with realistic 20-asset demo data. Continue?',
        confirmText: 'Reload Demo',
        isDanger: false
      });
      if (confirmed) {
        await backupManager.loadDemoWorkspace();
        await this.navigate('overview');
      }
    });
  }

  /* ==========================================================================
     2. ASSET REGISTRY VIEW
     ========================================================================== */
  async renderAssetRegistry(container) {
    const assets = await assetRegistry.getFilteredAssets();

    container.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div class="page-title-group">
            <h1>Equipment & Asset Registry</h1>
            <p>Master registry of industrial machines, IT assets, laboratory instruments, and tools.</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary" id="asset-export-csv-btn">
              <span>📥</span> Export CSV
            </button>
            <button class="btn btn-primary" id="asset-add-new-btn">
              <span>+</span> Register Equipment
            </button>
          </div>
        </div>

        <div class="card">
          <div class="toolbar">
            <div class="toolbar-group">
              <input type="text" class="input-control" id="asset-search-input" placeholder="Search name, code, serial, location..." style="min-width:260px;" value="${ui.escapeHtml(assetRegistry.searchQuery)}">
              <select class="select-control" id="asset-category-filter">
                <option value="ALL">All Categories</option>
                ${ASSET_CATEGORIES.map(c => `<option value="${c}" ${assetRegistry.currentFilterCategory === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
              <select class="select-control" id="asset-status-filter">
                <option value="ALL">All Statuses</option>
                ${ASSET_STATUSES.map(s => `<option value="${s}" ${assetRegistry.currentFilterStatus === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="toolbar-group">
              <span style="font-size:0.8125rem; color:var(--text-dim);">${assets.length} asset${assets.length === 1 ? '' : 's'} found</span>
            </div>
          </div>

          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Asset ID</th>
                  <th>Equipment Name</th>
                  <th>Category</th>
                  <th>Location</th>
                  <th>Serial / Model</th>
                  <th>Status</th>
                  <th>Value</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${assets.length === 0 ? `<tr><td colspan="8" style="text-align:center; padding:3rem; color:var(--text-dim);">No assets matched your search or filters</td></tr>` : assets.map(a => `
                  <tr>
                    <td style="font-family:var(--font-mono); font-weight:700; color:var(--primary); cursor:pointer;" data-view-asset="${a.id}">${a.asset_code || a.id}</td>
                    <td>
                      <div style="font-weight:600; cursor:pointer;" data-view-asset="${a.id}">${ui.escapeHtml(a.name)}</div>
                      <div style="font-size:0.75rem; color:var(--text-dim);">${ui.escapeHtml(a.brand || '')}</div>
                    </td>
                    <td><span style="font-size:0.8125rem; color:var(--text-muted);">${ui.escapeHtml(a.category)}</span></td>
                    <td>${ui.escapeHtml(a.location || 'N/A')}</td>
                    <td style="font-family:var(--font-mono); font-size:0.8125rem;">${ui.escapeHtml(a.serial_number || 'N/A')}</td>
                    <td>${assetRegistry.renderStatusBadge(a.status)}</td>
                    <td style="font-feature-settings:'tnum'; font-weight:600;">${ui.formatCurrency(a.purchase_cost)}</td>
                    <td style="text-align:right;">
                      <div style="display:inline-flex; gap:0.35rem;">
                        <button class="btn btn-sm btn-secondary" title="View Details" data-view-asset="${a.id}">Dossier</button>
                        <button class="btn btn-sm btn-secondary" title="Print QR Label" data-qr-asset="${a.id}">QR Tag</button>
                        <button class="btn btn-sm btn-secondary" title="Edit Asset" data-edit-asset="${a.id}">Edit</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Event bindings
    const searchInput = document.getElementById('asset-search-input');
    searchInput?.addEventListener('input', (e) => {
      assetRegistry.searchQuery = e.target.value;
      this.renderAssetRegistry(container);
    });

    const catFilter = document.getElementById('asset-category-filter');
    catFilter?.addEventListener('change', (e) => {
      assetRegistry.currentFilterCategory = e.target.value;
      this.renderAssetRegistry(container);
    });

    const statusFilter = document.getElementById('asset-status-filter');
    statusFilter?.addEventListener('change', (e) => {
      assetRegistry.currentFilterStatus = e.target.value;
      this.renderAssetRegistry(container);
    });

    document.getElementById('asset-add-new-btn')?.addEventListener('click', () => this.openAssetFormModal());
    document.getElementById('asset-export-csv-btn')?.addEventListener('click', async () => {
      const report = await reportManager.generateReport('ASSET_REGISTRY');
      reportManager.exportCsv(report);
    });

    container.querySelectorAll('[data-view-asset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-view-asset');
        this.openAssetDetailModal(id);
      });
    });

    container.querySelectorAll('[data-edit-asset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-edit-asset');
        this.openAssetFormModal(id);
      });
    });

    container.querySelectorAll('[data-qr-asset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-qr-asset');
        this.openAssetQrModal(id);
      });
    });
  }

  /* ==========================================================================
     3. MAINTENANCE CALENDAR VIEW
     ========================================================================== */
  async renderMaintenanceCalendar(container) {
    const plans = await maintenanceManager.getAllPlans();
    const assets = await db.getAll(STORES.ASSETS);
    const assetMap = new Map(assets.map(a => [a.id, a]));

    const year = maintenanceManager.calendarYear;
    const month = maintenanceManager.calendarMonth;
    const matrix = SchedulerEngine.getMonthMatrix(year, month);
    const monthName = new Date(year, month).toLocaleString(undefined, { month: 'long', year: 'numeric' });

    // Build map of events by date
    const eventsByDate = {};
    plans.forEach(plan => {
      if (plan.next_due_date) {
        if (!eventsByDate[plan.next_due_date]) eventsByDate[plan.next_due_date] = [];
        const state = SchedulerEngine.evaluateDueStatus(plan.next_due_date);
        let cls = 'scheduled';
        if (state.status === 'OVERDUE') cls = 'overdue';
        if (state.status === 'DUE SOON' || state.status === 'DUE TODAY') cls = 'due-soon';

        eventsByDate[plan.next_due_date].push({
          plan,
          cls,
          label: `${state.status === 'OVERDUE' ? '⚠️ ' : ''}${plan.title}`
        });
      }
    });

    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayStr = new Date().toISOString().split('T')[0];

    container.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div class="page-title-group">
            <h1>Maintenance Calendar</h1>
            <p>Interactive schedule of upcoming, due, and overdue maintenance cycles.</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary" id="cal-today-btn">Today</button>
            <div style="display:inline-flex; gap:0.25rem;">
              <button class="btn btn-secondary btn-icon" id="cal-prev-btn">◀</button>
              <button class="btn btn-secondary btn-icon" id="cal-next-btn">▶</button>
            </div>
            <button class="btn btn-primary" id="cal-new-plan-btn">
              <span>+</span> New Maintenance Plan
            </button>
          </div>
        </div>

        <div class="calendar-wrapper">
          <div class="calendar-header">
            <h2 style="font-size:1.25rem; font-weight:700;">${monthName}</h2>
            <div style="display:flex; align-items:center; gap:1rem; font-size:0.75rem;">
              <span style="display:flex; align-items:center; gap:4px;"><span style="width:10px;height:10px;border-radius:2px;background:var(--danger);"></span> Overdue</span>
              <span style="display:flex; align-items:center; gap:4px;"><span style="width:10px;height:10px;border-radius:2px;background:var(--warning);"></span> Due Soon</span>
              <span style="display:flex; align-items:center; gap:4px;"><span style="width:10px;height:10px;border-radius:2px;background:var(--primary);"></span> Scheduled</span>
            </div>
          </div>

          <div class="calendar-grid">
            ${dayHeaders.map(d => `<div class="calendar-day-header">${d}</div>`).join('')}
            ${matrix.flat().map(cell => {
              const events = eventsByDate[cell.date] || [];
              const isToday = cell.date === todayStr;
              return `
                <div class="calendar-cell ${cell.isCurrentMonth ? '' : 'other-month'} ${isToday ? 'today' : ''}" data-date="${cell.date}">
                  <div class="calendar-cell-date" style="${isToday ? 'color:var(--primary); font-weight:700;' : ''}">${cell.dayNumber}</div>
                  <div style="display:flex; flex-direction:column; gap:2px; overflow-y:auto; max-height:85px;">
                    ${events.map(ev => `
                      <div class="calendar-event ${ev.cls}" data-execute-plan="${ev.plan.id}" title="${ui.escapeHtml(ev.plan.title)} (${ev.plan.frequency})">
                        ${ui.escapeHtml(ev.label)}
                      </div>
                    `).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;

    // Events
    document.getElementById('cal-prev-btn')?.addEventListener('click', () => {
      maintenanceManager.calendarMonth--;
      if (maintenanceManager.calendarMonth < 0) {
        maintenanceManager.calendarMonth = 11;
        maintenanceManager.calendarYear--;
      }
      this.renderMaintenanceCalendar(container);
    });

    document.getElementById('cal-next-btn')?.addEventListener('click', () => {
      maintenanceManager.calendarMonth++;
      if (maintenanceManager.calendarMonth > 11) {
        maintenanceManager.calendarMonth = 0;
        maintenanceManager.calendarYear++;
      }
      this.renderMaintenanceCalendar(container);
    });

    document.getElementById('cal-today-btn')?.addEventListener('click', () => {
      const d = new Date();
      maintenanceManager.calendarYear = d.getFullYear();
      maintenanceManager.calendarMonth = d.getMonth();
      this.renderMaintenanceCalendar(container);
    });

    document.getElementById('cal-new-plan-btn')?.addEventListener('click', () => this.openPlanModal());

    container.querySelectorAll('[data-execute-plan]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const planId = el.getAttribute('data-execute-plan');
        this.openExecutePlanModal(planId);
      });
    });
  }

  /* ==========================================================================
     4. WORK ORDERS VIEW (KANBAN & TABLE)
     ========================================================================== */
  async renderWorkOrders(container) {
    const orders = await workOrders.getFilteredWorkOrders();

    const kanbanColumns = [
      { status: 'OPEN', label: 'Open / Unassigned', color: '#64748B' },
      { status: 'ASSIGNED', label: 'Assigned', color: '#3B82F6' },
      { status: 'IN PROGRESS', label: 'In Progress', color: '#8B5CF6' },
      { status: 'WAITING FOR PARTS', label: 'Waiting for Parts', color: '#F59E0B' },
      { status: 'COMPLETED', label: 'Completed', color: '#10B981' }
    ];

    container.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div class="page-title-group">
            <h1>Work Order Management</h1>
            <p>Corrective repair dispatch, priority escalation, spare parts consumption, and job sign-off.</p>
          </div>
          <div class="page-actions">
            <div style="display:inline-flex; border:1px solid var(--border-medium); border-radius:var(--radius-md); overflow:hidden;">
              <button class="btn btn-sm ${workOrders.viewMode === 'kanban' ? 'btn-primary' : 'btn-secondary'}" id="wo-view-kanban-btn">Kanban</button>
              <button class="btn btn-sm ${workOrders.viewMode === 'table' ? 'btn-primary' : 'btn-secondary'}" id="wo-view-table-btn">Table</button>
            </div>
            <button class="btn btn-primary" id="wo-add-new-btn">
              <span>+</span> Create Work Order
            </button>
          </div>
        </div>

        <div class="toolbar" style="border-radius:var(--radius-lg); margin-bottom:1rem;">
          <div class="toolbar-group">
            <input type="text" class="input-control" id="wo-search-input" placeholder="Search orders by ID, title, asset..." style="min-width:260px;" value="${ui.escapeHtml(workOrders.searchQuery)}">
            <select class="select-control" id="wo-priority-filter">
              <option value="ALL">All Priorities</option>
              ${WORK_ORDER_PRIORITIES.map(p => `<option value="${p}" ${workOrders.priorityFilter === p ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
            <select class="select-control" id="wo-status-filter">
              <option value="ALL">All Statuses</option>
              ${WORK_ORDER_STATUSES.map(s => `<option value="${s}" ${workOrders.statusFilter === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="toolbar-group">
            <span style="font-size:0.8125rem; color:var(--text-dim);">${orders.length} orders</span>
          </div>
        </div>

        ${workOrders.viewMode === 'kanban' ? `
          <div class="kanban-board">
            ${kanbanColumns.map(col => {
              const colOrders = orders.filter(o => o.status === col.status);
              return `
                <div class="kanban-column">
                  <div class="kanban-column-header">
                    <span style="display:flex; align-items:center; gap:6px;">
                      <span style="width:8px; height:8px; border-radius:50%; background:${col.color};"></span>
                      ${col.label}
                    </span>
                    <span class="nav-badge">${colOrders.length}</span>
                  </div>
                  <div class="kanban-cards-list">
                    ${colOrders.length === 0 ? `<div style="text-align:center; padding:2rem; font-size:0.75rem; color:var(--text-dim);">No work orders</div>` : colOrders.map(wo => `
                      <div class="kanban-card" data-open-wo="${wo.id}">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                          <span style="font-family:var(--font-mono); font-size:0.75rem; font-weight:700; color:var(--primary);">${wo.id}</span>
                          ${workOrders.renderPriorityBadge(wo.priority)}
                        </div>
                        <div style="font-weight:600; font-size:0.875rem; line-height:1.3;">${ui.escapeHtml(wo.title)}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted);">${ui.escapeHtml(wo.asset_name)}</div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.35rem; font-size:0.75rem; color:var(--text-dim); border-top:1px dashed var(--border-subtle); padding-top:0.35rem;">
                          <span>👤 ${ui.escapeHtml(wo.technician_name || 'Unassigned')}</span>
                          <span>${ui.formatDate(wo.scheduled_at)}</span>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <div class="card">
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>WO ID</th>
                    <th>Title</th>
                    <th>Asset</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Technician</th>
                    <th>Scheduled</th>
                    <th>Cost</th>
                    <th style="text-align:right;">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${orders.length === 0 ? `<tr><td colspan="9" style="text-align:center; padding:3rem; color:var(--text-dim);">No work orders found</td></tr>` : orders.map(wo => `
                    <tr>
                      <td style="font-family:var(--font-mono); font-weight:700; color:var(--primary); cursor:pointer;" data-open-wo="${wo.id}">${wo.id}</td>
                      <td><strong>${ui.escapeHtml(wo.title)}</strong></td>
                      <td>${ui.escapeHtml(wo.asset_name)}</td>
                      <td>${workOrders.renderPriorityBadge(wo.priority)}</td>
                      <td>${workOrders.renderStatusBadge(wo.status)}</td>
                      <td>${ui.escapeHtml(wo.technician_name || 'Unassigned')}</td>
                      <td>${ui.formatDate(wo.scheduled_at)}</td>
                      <td>${ui.formatCurrency(wo.actual_cost)}</td>
                      <td style="text-align:right;">
                        <button class="btn btn-sm btn-secondary" data-open-wo="${wo.id}">Manage</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `}
      </div>
    `;

    // Event hooks
    document.getElementById('wo-view-kanban-btn')?.addEventListener('click', () => {
      workOrders.viewMode = 'kanban';
      this.renderWorkOrders(container);
    });

    document.getElementById('wo-view-table-btn')?.addEventListener('click', () => {
      workOrders.viewMode = 'table';
      this.renderWorkOrders(container);
    });

    document.getElementById('wo-search-input')?.addEventListener('input', (e) => {
      workOrders.searchQuery = e.target.value;
      this.renderWorkOrders(container);
    });

    document.getElementById('wo-priority-filter')?.addEventListener('change', (e) => {
      workOrders.priorityFilter = e.target.value;
      this.renderWorkOrders(container);
    });

    document.getElementById('wo-status-filter')?.addEventListener('change', (e) => {
      workOrders.statusFilter = e.target.value;
      this.renderWorkOrders(container);
    });

    document.getElementById('wo-add-new-btn')?.addEventListener('click', () => this.openWorkOrderModal());

    container.querySelectorAll('[data-open-wo]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-open-wo');
        this.openWorkOrderDetailModal(id);
      });
    });
  }

  /* ==========================================================================
     5. PREVENTIVE MAINTENANCE MODULE
     ========================================================================== */
  async renderPreventiveMaintenance(container) {
    const plans = await maintenanceManager.getFilteredPlans();

    container.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div class="page-title-group">
            <h1>Preventive Maintenance Engine</h1>
            <p>Recurring inspection schedules, multi-point checklists, and automated cycle projection.</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary" id="pm-templates-btn">
              <span>📋</span> Standard PM Templates
            </button>
            <button class="btn btn-primary" id="pm-new-plan-btn">
              <span>+</span> New Maintenance Plan
            </button>
          </div>
        </div>

        <div class="card">
          <div class="toolbar">
            <div class="toolbar-group">
              <input type="text" class="input-control" id="pm-search-input" placeholder="Search plan, equipment, tech..." style="min-width:260px;" value="${ui.escapeHtml(maintenanceManager.searchQuery)}">
              <select class="select-control" id="pm-freq-filter">
                <option value="ALL">All Frequencies</option>
                ${FREQUENCIES.map(f => `<option value="${f}" ${maintenanceManager.frequencyFilter === f ? 'selected' : ''}>${f}</option>`).join('')}
              </select>
            </div>
            <div class="toolbar-group">
              <span style="font-size:0.8125rem; color:var(--text-dim);">${plans.length} plans active</span>
            </div>
          </div>

          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Plan ID</th>
                  <th>Plan Title</th>
                  <th>Equipment</th>
                  <th>Frequency</th>
                  <th>Checklist Items</th>
                  <th>Last Completed</th>
                  <th>Next Due</th>
                  <th>Due Status</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${plans.length === 0 ? `<tr><td colspan="9" style="text-align:center; padding:3rem; color:var(--text-dim);">No preventive maintenance plans configured</td></tr>` : plans.map(p => {
                  const state = SchedulerEngine.evaluateDueStatus(p.next_due_date);
                  return `
                    <tr>
                      <td style="font-family:var(--font-mono); font-weight:700; color:var(--primary);">${p.id}</td>
                      <td><strong>${ui.escapeHtml(p.title)}</strong></td>
                      <td>${ui.escapeHtml(p.asset.name)}</td>
                      <td><span class="nav-badge">${p.frequency}</span></td>
                      <td>${p.checklist ? p.checklist.length : 0} inspection checks</td>
                      <td>${ui.formatDate(p.last_maintenance_date)}</td>
                      <td><strong>${ui.formatDate(p.next_due_date)}</strong></td>
                      <td><span class="badge ${state.badgeClass}"><span class="badge-dot"></span>${state.label}</span></td>
                      <td style="text-align:right;">
                        <div style="display:inline-flex; gap:0.35rem;">
                          <button class="btn btn-sm btn-success" data-execute-pm="${p.id}">Execute & Log</button>
                          <button class="btn btn-sm btn-secondary" data-edit-pm="${p.id}">Edit</button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Event hooks
    document.getElementById('pm-search-input')?.addEventListener('input', (e) => {
      maintenanceManager.searchQuery = e.target.value;
      this.renderPreventiveMaintenance(container);
    });

    document.getElementById('pm-freq-filter')?.addEventListener('change', (e) => {
      maintenanceManager.frequencyFilter = e.target.value;
      this.renderPreventiveMaintenance(container);
    });

    document.getElementById('pm-new-plan-btn')?.addEventListener('click', () => this.openPlanModal());
    document.getElementById('pm-templates-btn')?.addEventListener('click', () => this.openTemplatesModal());

    container.querySelectorAll('[data-execute-pm]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-execute-pm');
        this.openExecutePlanModal(id);
      });
    });

    container.querySelectorAll('[data-edit-pm]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-edit-pm');
        this.openPlanModal(id);
      });
    });
  }

  /* ==========================================================================
     6. REPAIR HISTORY VIEW
     ========================================================================== */
  async renderRepairHistory(container) {
    const records = await repairHistory.getFilteredRecords();
    const metrics = await repairHistory.getSummaryMetrics();
    const assets = await db.getAll(STORES.ASSETS);

    container.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div class="page-title-group">
            <h1>Repair History & Maintenance Records</h1>
            <p>Chronological interventions, parts replacement audit, and labor expenditure ledger.</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary" id="repair-export-btn">
              <span>📥</span> Export CSV
            </button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-title">Total Interventions</div>
            <div class="stat-value">${metrics.recordCount}</div>
            <div class="stat-sub">Completed maintenance & repair jobs</div>
          </div>
          <div class="stat-card">
            <div class="stat-title">Total Maintenance Spend</div>
            <div class="stat-value">${ui.formatCurrency(metrics.totalSpend)}</div>
            <div class="stat-sub">${ui.formatCurrency(metrics.totalLabor)} Labor + ${ui.formatCurrency(metrics.totalParts)} Parts</div>
          </div>
          <div class="stat-card">
            <div class="stat-title">Average Cost / Repair</div>
            <div class="stat-value">${ui.formatCurrency(metrics.avgCost)}</div>
            <div class="stat-sub">Per completed intervention</div>
          </div>
          <div class="stat-card">
            <div class="stat-title">Total Repair Downtime</div>
            <div class="stat-value">${metrics.totalDowntimeHours} hrs</div>
            <div class="stat-sub">${metrics.totalDowntimeMins} cumulative minutes</div>
          </div>
        </div>

        <div class="card">
          <div class="toolbar">
            <div class="toolbar-group">
              <input type="text" class="input-control" id="repair-search-input" placeholder="Search work performed, tech, parts..." style="min-width:260px;" value="${ui.escapeHtml(repairHistory.searchQuery)}">
              <select class="select-control" id="repair-asset-filter">
                <option value="ALL">All Equipment</option>
                ${assets.map(a => `<option value="${a.id}" ${repairHistory.selectedAssetId === a.id ? 'selected' : ''}>${a.name}</option>`).join('')}
              </select>
            </div>
            <div class="toolbar-group">
              <span style="font-size:0.8125rem; color:var(--text-dim);">${records.length} records</span>
            </div>
          </div>

          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Equipment</th>
                  <th>Work Performed</th>
                  <th>Root Cause</th>
                  <th>Technician</th>
                  <th>Labor</th>
                  <th>Parts</th>
                  <th>Total Cost</th>
                  <th>Downtime</th>
                </tr>
              </thead>
              <tbody>
                ${records.length === 0 ? `<tr><td colspan="9" style="text-align:center; padding:3rem; color:var(--text-dim);">No repair records match criteria</td></tr>` : records.map(r => `
                  <tr>
                    <td><strong>${ui.formatDate(r.repair_date)}</strong></td>
                    <td>
                      <div style="font-weight:600;">${ui.escapeHtml(r.asset_name)}</div>
                      <div style="font-family:var(--font-mono); font-size:0.75rem; color:var(--text-dim);">${r.asset_code || ''}</div>
                    </td>
                    <td style="max-width:260px; font-size:0.8125rem;">
                      <div>${ui.escapeHtml(r.work_performed)}</div>
                      ${r.parts_replaced && r.parts_replaced !== 'None' ? `<div style="color:var(--text-dim); font-size:0.75rem; margin-top:2px;">Replaced: ${ui.escapeHtml(r.parts_replaced)}</div>` : ''}
                    </td>
                    <td style="font-size:0.8125rem; color:var(--text-muted);">${ui.escapeHtml(r.root_cause || 'N/A')}</td>
                    <td>${ui.escapeHtml(r.technician_name || 'N/A')}</td>
                    <td>${ui.formatCurrency(r.labour_cost)}</td>
                    <td>${ui.formatCurrency(r.parts_cost)}</td>
                    <td style="font-weight:700; color:var(--primary);">${ui.formatCurrency(r.total_cost)}</td>
                    <td>${ui.formatDuration(r.downtime_minutes)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('repair-search-input')?.addEventListener('input', (e) => {
      repairHistory.searchQuery = e.target.value;
      this.renderRepairHistory(container);
    });

    document.getElementById('repair-asset-filter')?.addEventListener('change', (e) => {
      repairHistory.selectedAssetId = e.target.value;
      this.renderRepairHistory(container);
    });

    document.getElementById('repair-export-btn')?.addEventListener('click', () => repairHistory.exportCsv());
  }

  /* ==========================================================================
     7. SPARE PARTS INVENTORY VIEW
     ========================================================================== */
  async renderSpareParts(container) {
    const parts = await inventory.getFilteredParts();
    const movements = await inventory.getMovements(15);

    container.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div class="page-title-group">
            <h1>Spare Parts & Consumables Inventory</h1>
            <p>Parts catalog, min-level safety alerts, stock consumption, and replenishment audits.</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary" id="part-add-new-btn">
              <span>+</span> Add Spare Part
            </button>
          </div>
        </div>

        <div class="card">
          <div class="toolbar">
            <div class="toolbar-group">
              <input type="text" class="input-control" id="part-search-input" placeholder="Search part name, number, supplier..." style="min-width:260px;" value="${ui.escapeHtml(inventory.searchQuery)}">
              <select class="select-control" id="part-cat-filter">
                <option value="ALL">All Categories</option>
                ${PART_CATEGORIES.map(c => `<option value="${c}" ${inventory.currentCategory === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
              <label style="display:flex; align-items:center; gap:6px; font-size:0.8125rem; color:var(--text-muted); cursor:pointer;">
                <input type="checkbox" id="part-low-stock-check" ${inventory.showLowStockOnly ? 'checked' : ''}>
                Low Stock Only
              </label>
            </div>
            <div class="toolbar-group">
              <span style="font-size:0.8125rem; color:var(--text-dim);">${parts.length} parts</span>
            </div>
          </div>

          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Part Number</th>
                  <th>Part Name</th>
                  <th>Category</th>
                  <th>Location</th>
                  <th>In Stock</th>
                  <th>Min Level</th>
                  <th>Unit Cost</th>
                  <th>Total Value</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${parts.length === 0 ? `<tr><td colspan="9" style="text-align:center; padding:3rem; color:var(--text-dim);">No spare parts match filters</td></tr>` : parts.map(p => {
                  const isLow = Number(p.quantity) <= Number(p.minimum_stock);
                  return `
                    <tr>
                      <td style="font-family:var(--font-mono); font-weight:700;">${ui.escapeHtml(p.part_number)}</td>
                      <td>
                        <strong>${ui.escapeHtml(p.name)}</strong>
                        <div style="font-size:0.75rem; color:var(--text-dim);">${ui.escapeHtml(p.supplier || '')}</div>
                      </td>
                      <td><span style="font-size:0.8125rem; color:var(--text-muted);">${ui.escapeHtml(p.category)}</span></td>
                      <td>${ui.escapeHtml(p.storage_location || 'Bin A-1')}</td>
                      <td>
                        <span style="font-size:1rem; font-weight:700; color:${isLow ? 'var(--danger)' : 'inherit'};">
                          ${p.quantity}
                        </span>
                        ${isLow ? `<span class="badge badge-overdue" style="font-size:0.65rem; margin-left:4px;">Low</span>` : ''}
                      </td>
                      <td>${p.minimum_stock}</td>
                      <td>${ui.formatCurrency(p.unit_cost)}</td>
                      <td style="font-weight:600;">${ui.formatCurrency(Number(p.quantity) * Number(p.unit_cost))}</td>
                      <td style="text-align:right;">
                        <div style="display:inline-flex; gap:0.35rem;">
                          <button class="btn btn-sm btn-success" data-restock-part="${p.id}" title="Add Stock">+ Stock</button>
                          <button class="btn btn-sm btn-secondary" data-consume-part="${p.id}" title="Consume Stock">- Use</button>
                          <button class="btn btn-sm btn-secondary" data-edit-part="${p.id}" title="Edit Part">Edit</button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Recent Stock Movements Audit -->
        <div class="card" style="margin-top:1.5rem;">
          <div class="card-header">
            <div class="card-title"><span>🔄</span> Recent Stock Movements (Audit Trail)</div>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Part Name</th>
                  <th>Movement Type</th>
                  <th>Quantity</th>
                  <th>Work Order Ref</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                ${movements.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:var(--text-dim);">No stock movements recorded yet</td></tr>` : movements.map(m => `
                  <tr>
                    <td>${ui.formatDateTime(m.timestamp)}</td>
                    <td><strong>${ui.escapeHtml(m.part_name || m.part_id)}</strong></td>
                    <td>
                      <span class="badge ${m.movement_type === 'RESTOCK' ? 'badge-operational' : (m.movement_type === 'CONSUMED' ? 'badge-due-soon' : 'badge-maintenance')}">
                        ${m.movement_type}
                      </span>
                    </td>
                    <td style="font-weight:700; font-family:var(--font-mono);">
                      ${m.movement_type === 'CONSUMED' ? `-${m.quantity}` : `+${m.quantity}`}
                    </td>
                    <td>${m.work_order_id ? `<span style="font-family:var(--font-mono); color:var(--primary); font-weight:600;">${m.work_order_id}</span>` : 'N/A'}</td>
                    <td style="font-size:0.8125rem; color:var(--text-muted);">${ui.escapeHtml(m.notes || '')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Event hooks
    document.getElementById('part-search-input')?.addEventListener('input', (e) => {
      inventory.searchQuery = e.target.value;
      this.renderSpareParts(container);
    });

    document.getElementById('part-cat-filter')?.addEventListener('change', (e) => {
      inventory.currentCategory = e.target.value;
      this.renderSpareParts(container);
    });

    document.getElementById('part-low-stock-check')?.addEventListener('change', (e) => {
      inventory.showLowStockOnly = e.target.checked;
      this.renderSpareParts(container);
    });

    document.getElementById('part-add-new-btn')?.addEventListener('click', () => this.openPartModal());

    container.querySelectorAll('[data-restock-part]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-restock-part');
        this.openRestockModal(id);
      });
    });

    container.querySelectorAll('[data-consume-part]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-consume-part');
        this.openConsumeModal(id);
      });
    });

    container.querySelectorAll('[data-edit-part]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-edit-part');
        this.openPartModal(id);
      });
    });
  }

  /* ==========================================================================
     8. TECHNICIAN DIRECTORY VIEW
     ========================================================================== */
  async renderTechnicians(container) {
    const techs = await technicianDirectory.getFilteredTechnicians();
    const statsList = await Promise.all(techs.map(t => technicianDirectory.getTechnicianWithStats(t.id)));

    container.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div class="page-title-group">
            <h1>Technician & Contractor Directory</h1>
            <p>Maintenance workforce roster, assigned job queues, and specialized capabilities.</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary" id="tech-add-btn">
              <span>+</span> Add Technician
            </button>
          </div>
        </div>

        <div class="toolbar" style="border-radius:var(--radius-lg); margin-bottom:1rem;">
          <div class="toolbar-group">
            <input type="text" class="input-control" id="tech-search-input" placeholder="Search technician name, skills..." style="min-width:260px;" value="${ui.escapeHtml(technicianDirectory.searchQuery)}">
            <select class="select-control" id="tech-spec-filter">
              <option value="ALL">All Specializations</option>
              ${SPECIALIZATIONS.map(s => `<option value="${s}" ${technicianDirectory.currentSpecialization === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="toolbar-group">
            <span style="font-size:0.8125rem; color:var(--text-dim);">${techs.length} technicians</span>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap:1.25rem;">
          ${statsList.map(item => {
            const t = item.technician;
            let availBadge = 'badge-operational';
            if (t.availability === 'ON JOB') availBadge = 'badge-maintenance';
            if (t.availability === 'ON LEAVE') availBadge = 'badge-due-soon';
            if (t.availability === 'OFF DUTY') availBadge = 'badge-retired';

            return `
              <div class="card" style="display:flex; flex-direction:column;">
                <div class="card-header">
                  <div>
                    <h3 style="font-size:1.0625rem; font-weight:700;">${ui.escapeHtml(t.name)}</h3>
                    <div style="font-size:0.8125rem; color:var(--primary); font-weight:600;">${ui.escapeHtml(t.specialization)}</div>
                  </div>
                  <span class="badge ${availBadge}"><span class="badge-dot"></span>${t.availability || 'AVAILABLE'}</span>
                </div>
                <div class="card-body" style="flex:1; display:flex; flex-direction:column; gap:0.75rem;">
                  <div style="font-size:0.8125rem; color:var(--text-muted);">
                    <div>📧 ${ui.escapeHtml(t.contact || 'No email provided')}</div>
                  </div>

                  <div style="font-size:0.8125rem;">
                    <div style="font-weight:600; font-size:0.75rem; text-transform:uppercase; color:var(--text-dim); margin-bottom:4px;">Core Skills</div>
                    <div style="display:flex; flex-wrap:wrap; gap:4px;">
                      ${(t.skills || 'General Maintenance').split(',').map(s => `<span class="nav-badge" style="font-size:0.6875rem;">${ui.escapeHtml(s.trim())}</span>`).join('')}
                    </div>
                  </div>

                  <div style="display:flex; gap:1rem; border-top:1px solid var(--border-subtle); padding-top:0.75rem; margin-top:auto;">
                    <div style="flex:1;">
                      <div style="font-size:0.6875rem; color:var(--text-dim); text-transform:uppercase;">Active Queue</div>
                      <div style="font-size:1.25rem; font-weight:700; color:var(--warning);">${item.openCount}</div>
                    </div>
                    <div style="flex:1;">
                      <div style="font-size:0.6875rem; color:var(--text-dim); text-transform:uppercase;">Completed</div>
                      <div style="font-size:1.25rem; font-weight:700; color:var(--success);">${item.completedCount}</div>
                    </div>
                  </div>
                </div>
                <div class="modal-footer" style="padding:0.75rem 1.25rem; background:transparent;">
                  <button class="btn btn-sm btn-secondary" data-edit-tech="${t.id}">Edit</button>
                  <button class="btn btn-sm btn-danger" data-delete-tech="${t.id}">Remove</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    document.getElementById('tech-search-input')?.addEventListener('input', (e) => {
      technicianDirectory.searchQuery = e.target.value;
      this.renderTechnicians(container);
    });

    document.getElementById('tech-spec-filter')?.addEventListener('change', (e) => {
      technicianDirectory.currentSpecialization = e.target.value;
      this.renderTechnicians(container);
    });

    document.getElementById('tech-add-btn')?.addEventListener('click', () => this.openTechnicianModal());

    container.querySelectorAll('[data-edit-tech]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-edit-tech');
        this.openTechnicianModal(id);
      });
    });

    container.querySelectorAll('[data-delete-tech]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-delete-tech');
        const success = await technicianDirectory.deleteTechnician(id);
        if (success) this.renderTechnicians(container);
      });
    });
  }

  /* ==========================================================================
     9. DOWNTIME TRACKER & AVAILABILITY VIEW
     ========================================================================== */
  async renderDowntimeTracker(container) {
    const metrics = await downtimeTracker.calculateMetrics(30);
    const activeOutages = metrics.events.filter(e => !e.ended_at);
    const resolvedEvents = metrics.events.filter(e => e.ended_at);

    container.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div class="page-title-group">
            <h1>Downtime Tracker & Asset Availability</h1>
            <p>Mathematical availability formulas, outage logs, and Mean Time to Repair (MTTR) metrics.</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary" id="downtime-log-btn">
              <span>+</span> Log Equipment Outage
            </button>
          </div>
        </div>

        <!-- Availability Equation Banner -->
        <div class="card" style="background:linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%); border-left:4px solid var(--primary);">
          <div class="card-body">
            <div style="font-size:0.8125rem; text-transform:uppercase; font-weight:700; color:var(--primary); letter-spacing:0.04em;">Industrial CMMS Availability Formula</div>
            <div style="font-size:1.125rem; font-weight:600; margin-top:4px; font-family:var(--font-mono);">
              Availability % = ((Total Scheduled Time - Cumulative Downtime) / Total Scheduled Time) &times; 100
            </div>
            <div style="font-size:0.8125rem; color:var(--text-muted); margin-top:6px;">
              Reporting window: <strong>30 Days</strong> &bull; Scheduled base: <strong>${metrics.dailyOperatingHours} hours/day</strong> across <strong>${metrics.activeAssetCount} active assets</strong> &bull; Total scheduled operating time: <strong>${Math.round(metrics.totalScheduledMinutes / 60)} hrs</strong>.
            </div>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-title">Fleet Availability Rate</div>
            <div class="stat-value" style="color:${Number(metrics.availabilityPercentage) > 95 ? 'var(--success)' : 'var(--warning)'};">${metrics.availabilityPercentage}%</div>
            <div class="stat-sub">Across 30-day operational baseline</div>
          </div>
          <div class="stat-card">
            <div class="stat-title">Total Downtime</div>
            <div class="stat-value">${metrics.totalDowntimeHours} <span style="font-size:1rem;">hrs</span></div>
            <div class="stat-sub">${metrics.totalDowntimeMinutes} minutes cumulative</div>
          </div>
          <div class="stat-card">
            <div class="stat-title">Failure Incidents</div>
            <div class="stat-value">${metrics.failureCount}</div>
            <div class="stat-sub">Breakdowns / unplanned outages</div>
          </div>
          <div class="stat-card">
            <div class="stat-title">MTTR (Mean Time To Repair)</div>
            <div class="stat-value">${ui.formatDuration(metrics.mttrMinutes)}</div>
            <div class="stat-sub">Average outage resolution time</div>
          </div>
        </div>

        <!-- Active Outages Alert Section -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">
              <span style="color:var(--danger);">⚡</span> Active Unresolved Outages (${activeOutages.length})
            </div>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Event ID</th>
                  <th>Equipment</th>
                  <th>Category</th>
                  <th>Outage Started</th>
                  <th>Reason</th>
                  <th>Work Order Ref</th>
                  <th style="text-align:right;">Action</th>
                </tr>
              </thead>
              <tbody>
                ${activeOutages.length === 0 ? `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--success);">✓ No active downtime events. All systems operational.</td></tr>` : activeOutages.map(e => `
                  <tr style="background:rgba(239, 68, 68, 0.04);">
                    <td style="font-family:var(--font-mono); font-weight:700; color:var(--danger);">${e.id}</td>
                    <td><strong>${ui.escapeHtml(e.asset_name)}</strong> (${e.asset_code || ''})</td>
                    <td>${ui.escapeHtml(e.category || 'Machinery')}</td>
                    <td>${ui.formatDateTime(e.started_at)}</td>
                    <td><span class="badge badge-overdue">${ui.escapeHtml(e.reason)}</span></td>
                    <td>${e.work_order_id ? `<span style="font-family:var(--font-mono); color:var(--primary); font-weight:600;">${e.work_order_id}</span>` : 'None linked'}</td>
                    <td style="text-align:right;">
                      <button class="btn btn-sm btn-success" data-resolve-downtime="${e.id}">Resolve Outage</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Resolved Historical Downtime Events -->
        <div class="card" style="margin-top:1.5rem;">
          <div class="card-header">
            <div class="card-title"><span>🕒</span> Resolved Outage History (Past 30 Days)</div>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Event ID</th>
                  <th>Equipment</th>
                  <th>Started</th>
                  <th>Restored</th>
                  <th>Duration</th>
                  <th>Reason</th>
                  <th>Resolution / Notes</th>
                </tr>
              </thead>
              <tbody>
                ${resolvedEvents.length === 0 ? `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-dim);">No past resolved outages in this period</td></tr>` : resolvedEvents.map(e => `
                  <tr>
                    <td style="font-family:var(--font-mono); font-weight:600;">${e.id}</td>
                    <td>${ui.escapeHtml(e.asset_name)}</td>
                    <td>${ui.formatDateTime(e.started_at)}</td>
                    <td>${ui.formatDateTime(e.ended_at)}</td>
                    <td style="font-weight:700;">${ui.formatDuration(e.duration_minutes)}</td>
                    <td><span class="nav-badge">${ui.escapeHtml(e.reason)}</span></td>
                    <td style="font-size:0.8125rem; color:var(--text-muted);">${ui.escapeHtml(e.notes || 'N/A')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('downtime-log-btn')?.addEventListener('click', () => this.openLogDowntimeModal());

    container.querySelectorAll('[data-resolve-downtime]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-resolve-downtime');
        this.openResolveDowntimeModal(id);
      });
    });
  }

  /* ==========================================================================
     10. REPORTS VIEW
     ========================================================================== */
  async renderReports(container) {
    const reportOptions = [
      { id: 'ASSET_REGISTRY', title: '1. Equipment & Asset Registry Report', desc: 'Complete inventory of equipment, locations, capital costs, and operational statuses.' },
      { id: 'MAINTENANCE_SCHEDULE', title: '2. Preventive Maintenance Schedule Report', desc: 'Upcoming, scheduled, and overdue recurring maintenance cycles and technicians.' },
      { id: 'WORK_ORDERS', title: '3. Work Orders Audit & Execution Report', desc: 'Completed and pending work orders, labor hours, and actual expenditures.' },
      { id: 'REPAIR_HISTORY', title: '4. Asset Repair & Corrective History Report', desc: 'Detailed log of all corrective interventions, root cause analysis, and parts replaced.' },
      { id: 'DOWNTIME', title: '5. Asset Availability & Downtime Analysis Report', desc: 'Mathematical availability %, outage hours, breakdown incidents, and MTTR.' },
      { id: 'SPARE_PARTS', title: '6. Spare Parts Inventory & Valuation Report', desc: 'Catalog of spare parts, stock on hand, reorder levels, and total valuation.' },
      { id: 'MAINTENANCE_COST', title: '7. Maintenance Cost & Financial Expenditure Report', desc: 'Comprehensive financial breakdown by asset category, labor, and materials.' },
      { id: 'TECHNICIAN_ACTIVITY', title: '8. Technician Activity & Workload Report', desc: 'Productivity metrics, completed work orders, and labor hours by technician.' }
    ];

    container.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div class="page-title-group">
            <h1>Reports & Data Export Center</h1>
            <p>Generate 8 audit-grade industrial reports with CSV, JSON, and Print-to-PDF support.</p>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title"><span>📑</span> Select Report Type</div>
          </div>
          <div class="card-body">
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap:1rem;">
              ${reportOptions.map(r => `
                <div class="card" style="padding:1.25rem; border:1px solid var(--border-medium); cursor:pointer; transition:all 0.15s ease;" data-select-report="${r.id}">
                  <h3 style="font-size:1rem; font-weight:700; color:var(--text-main);">${r.title}</h3>
                  <p style="font-size:0.8125rem; color:var(--text-muted); margin-top:4px;">${r.desc}</p>
                  <div style="margin-top:1rem; display:flex; gap:0.5rem;">
                    <button class="btn btn-sm btn-primary" data-generate-report="${r.id}">View & Print</button>
                    <button class="btn btn-sm btn-secondary" data-csv-report="${r.id}">CSV</button>
                    <button class="btn btn-sm btn-secondary" data-json-report="${r.id}">JSON</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div id="report-preview-container" style="margin-top:1.5rem; display:none;"></div>
      </div>
    `;

    container.querySelectorAll('[data-generate-report]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const type = btn.getAttribute('data-generate-report');
        await this.previewReport(type);
      });
    });

    container.querySelectorAll('[data-csv-report]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const type = btn.getAttribute('data-csv-report');
        const report = await reportManager.generateReport(type);
        reportManager.exportCsv(report);
      });
    });

    container.querySelectorAll('[data-json-report]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const type = btn.getAttribute('data-json-report');
        const report = await reportManager.generateReport(type);
        reportManager.exportJson(report);
      });
    });
  }

  async previewReport(reportType) {
    const reportData = await reportManager.generateReport(reportType);
    const previewBox = document.getElementById('report-preview-container');
    if (!previewBox) return;

    previewBox.style.display = 'block';
    previewBox.innerHTML = `
      <div class="card">
        <div class="card-header no-print">
          <div class="card-title">Preview: ${reportData.title}</div>
          <div style="display:flex; gap:0.5rem;">
            <button class="btn btn-sm btn-primary" id="report-print-btn">🖨️ Print / Save to PDF</button>
            <button class="btn btn-sm btn-secondary" id="report-csv-download-btn">Download CSV</button>
            <button class="btn btn-sm btn-secondary" id="report-close-preview-btn">Close Preview</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;">
          ${reportManager.renderPrintableHtml(reportData)}
        </div>
      </div>
    `;

    document.getElementById('report-print-btn')?.addEventListener('click', () => window.print());
    document.getElementById('report-csv-download-btn')?.addEventListener('click', () => reportManager.exportCsv(reportData));
    document.getElementById('report-close-preview-btn')?.addEventListener('click', () => {
      previewBox.style.display = 'none';
    });

    previewBox.scrollIntoView({ behavior: 'smooth' });
  }

  /* ==========================================================================
     11. SETTINGS & RBAC & AUDIT LOGS VIEW
     ========================================================================== */
  async renderSettings(container) {
    const settings = (await db.getById(STORES.SETTINGS, 'default')) || {};
    const auditLogs = await authRBAC.getAuditLogs(50);

    container.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <div class="page-title-group">
            <h1>Settings & Security Governance</h1>
            <p>Role-based access control, system parameters, audit trail, and database backup routines.</p>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(440px, 1fr)); gap:1.5rem;">
          <!-- Organization & Operational Settings -->
          <div class="card">
            <div class="card-header">
              <div class="card-title"><span>🏢</span> Facility & Calculation Parameters</div>
            </div>
            <div class="card-body">
              <form id="settings-general-form">
                <div class="form-group" style="margin-bottom:1rem;">
                  <label class="form-label">Organization / Plant Name</label>
                  <input type="text" class="form-control" id="set-org-name" value="${ui.escapeHtml(settings.organization_name || '')}">
                </div>
                <div class="form-group" style="margin-bottom:1rem;">
                  <label class="form-label">Facility Location</label>
                  <input type="text" class="form-control" id="set-fac-loc" value="${ui.escapeHtml(settings.facility_location || '')}">
                </div>
                <div class="form-grid" style="margin-bottom:1rem;">
                  <div class="form-group">
                    <label class="form-label">Currency Symbol</label>
                    <select class="form-control" id="set-currency">
                      <option value="$" ${settings.currency_symbol === '$' ? 'selected' : ''}>$ (USD)</option>
                      <option value="€" ${settings.currency_symbol === '€' ? 'selected' : ''}>€ (EUR)</option>
                      <option value="£" ${settings.currency_symbol === '£' ? 'selected' : ''}>£ (GBP)</option>
                      <option value="₹" ${settings.currency_symbol === '₹' ? 'selected' : ''}>₹ (INR)</option>
                      <option value="¥" ${settings.currency_symbol === '¥' ? 'selected' : ''}>¥ (JPY/CNY)</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Operating Hours / Day (Availability Base)</label>
                    <select class="form-control" id="set-hours">
                      <option value="24" ${settings.scheduled_operating_hours_per_day == 24 ? 'selected' : ''}>24 Hours (Continuous 24/7)</option>
                      <option value="16" ${settings.scheduled_operating_hours_per_day == 16 ? 'selected' : ''}>16 Hours (2 Shifts)</option>
                      <option value="8" ${settings.scheduled_operating_hours_per_day == 8 ? 'selected' : ''}>8 Hours (Single Shift)</option>
                    </select>
                  </div>
                </div>
                <button type="submit" class="btn btn-primary">Save Facility Settings</button>
              </form>
            </div>
          </div>

          <!-- Role-Based Access Control Simulation -->
          <div class="card">
            <div class="card-header">
              <div class="card-title"><span>🛡️</span> Role-Based Access Control (RBAC)</div>
            </div>
            <div class="card-body">
              <p style="font-size:0.875rem; color:var(--text-muted); margin-bottom:1rem;">
                Select active user role to simulate permission governance across the CMMS.
              </p>
              <div style="display:flex; flex-direction:column; gap:0.5rem; margin-bottom:1.5rem;">
                ${Object.values(ROLES).map(role => `
                  <label style="display:flex; align-items:center; justify-content:space-between; padding:0.625rem 0.875rem; border:1px solid ${authRBAC.getCurrentRole() === role ? 'var(--primary)' : 'var(--border-subtle)'}; background:${authRBAC.getCurrentRole() === role ? 'var(--primary-subtle)' : 'var(--bg-surface)'}; border-radius:var(--radius-md); cursor:pointer;">
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                      <input type="radio" name="rbac-role-radio" value="${role}" ${authRBAC.getCurrentRole() === role ? 'checked' : ''}>
                      <span style="font-weight:600; font-size:0.875rem;">${role}</span>
                    </div>
                    <span style="font-size:0.75rem; color:var(--text-dim);">
                      ${role === ROLES.ADMINISTRATOR ? 'Full Authority' : (role === ROLES.MAINTENANCE_MANAGER ? 'Plans, Work Orders, Stock' : (role === ROLES.TECHNICIAN ? 'Field Execution' : (role === ROLES.OPERATOR ? 'Submit Requests' : 'Audit Only')))}
                    </span>
                  </label>
                `).join('')}
              </div>
              <button class="btn btn-secondary" id="request-browser-notif-btn">
                <span>🔔</span> Enable Browser Push Notifications
              </button>
            </div>
          </div>

          <!-- Backup & Disaster Recovery -->
          <div class="card">
            <div class="card-header">
              <div class="card-title"><span>💾</span> Local Data Backup & Restore</div>
            </div>
            <div class="card-body" style="display:flex; flex-direction:column; gap:1rem;">
              <p style="font-size:0.875rem; color:var(--text-muted);">
                All data is stored in your local browser's IndexedDB. Export regular JSON snapshots to prevent data loss if browser cache is cleared.
              </p>
              <div style="display:flex; gap:0.75rem; flex-wrap:wrap;">
                <button class="btn btn-primary" id="backup-download-btn">
                  <span>📥</span> Download Full JSON Backup
                </button>
                <label class="btn btn-secondary" style="margin:0; cursor:pointer;">
                  <span>📤</span> Restore from Backup
                  <input type="file" id="backup-file-input" accept=".json" style="display:none;">
                </label>
              </div>
            </div>
          </div>

          <!-- Workspace Management & Reset -->
          <div class="card">
            <div class="card-header">
              <div class="card-title"><span>⚠️</span> Workspace Management</div>
            </div>
            <div class="card-body" style="display:flex; flex-direction:column; gap:1rem;">
              <div>
                <h4 style="font-size:0.9375rem; font-weight:600;">Load Demo Workspace</h4>
                <p style="font-size:0.8125rem; color:var(--text-muted); margin-top:2px;">Populates 20 assets, 5 technicians, 12 work orders, 8 PM plans, and 15 spare parts.</p>
                <button class="btn btn-secondary btn-sm" id="set-load-demo-btn" style="margin-top:0.5rem;">Load Demo Workspace</button>
              </div>
              <hr style="border:none; border-top:1px solid var(--border-subtle);">
              <div>
                <h4 style="font-size:0.9375rem; font-weight:600; color:var(--danger);">Clear Entire Workspace</h4>
                <p style="font-size:0.8125rem; color:var(--text-muted); margin-top:2px;">Permanently wipe all IndexedDB records. Requires typing confirmation code "CONFIRM-RESET".</p>
                <button class="btn btn-danger btn-sm" id="set-wipe-workspace-btn" style="margin-top:0.5rem;">Reset Workspace</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Audit Trail Table -->
        <div class="card" style="margin-top:1.5rem;">
          <div class="card-header">
            <div class="card-title"><span>📜</span> System Audit Log (Immutable Record of Actions)</div>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User Role</th>
                  <th>Action</th>
                  <th>Entity Type</th>
                  <th>Entity ID</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                ${auditLogs.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-dim);">No audit logs found</td></tr>` : auditLogs.map(log => `
                  <tr>
                    <td style="font-size:0.75rem; font-family:var(--font-mono);">${ui.formatDateTime(log.timestamp)}</td>
                    <td><span class="nav-badge">${log.user_role}</span></td>
                    <td style="font-weight:700; font-size:0.75rem;">${log.action}</td>
                    <td>${log.entity_type}</td>
                    <td style="font-family:var(--font-mono); font-size:0.75rem;">${log.entity_id}</td>
                    <td style="font-size:0.8125rem; color:var(--text-muted);">${ui.escapeHtml(log.details)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Event hooks
    document.getElementById('settings-general-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const updated = {
        ...settings,
        organization_name: document.getElementById('set-org-name').value.trim(),
        facility_location: document.getElementById('set-fac-loc').value.trim(),
        currency_symbol: document.getElementById('set-currency').value,
        scheduled_operating_hours_per_day: Number(document.getElementById('set-hours').value),
        updated_at: new Date().toISOString()
      };
      await db.update(STORES.SETTINGS, updated);
      ui.currencySymbol = updated.currency_symbol;
      ui.showToast('Facility settings updated.', 'success');
    });

    container.querySelectorAll('input[name="rbac-role-radio"]').forEach(radio => {
      radio.addEventListener('change', async (e) => {
        await authRBAC.setRole(e.target.value);
        this._updateRoleSelector();
        ui.showToast(`Switched active persona to ${e.target.value}`, 'info');
        this.renderSettings(container);
      });
    });

    document.getElementById('request-browser-notif-btn')?.addEventListener('click', () => {
      notifications.requestBrowserPermission();
    });

    document.getElementById('backup-download-btn')?.addEventListener('click', () => {
      backupManager.downloadFullBackup();
    });

    const fileInput = document.getElementById('backup-file-input');
    fileInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const preview = await backupManager.processBackupFile(file);
      if (preview) {
        const confirmed = await ui.confirmDialog({
          title: 'Confirm Backup Restore',
          message: `Backup contains ${Object.entries(preview.counts).map(([k, v]) => `${v} ${k}`).join(', ')}. Replace existing workspace data?`,
          confirmText: 'Restore & Overwrite',
          cancelText: 'Merge Records'
        });
        await backupManager.commitRestore(preview.payload, confirmed);
        await this.navigate('overview');
      }
    });

    document.getElementById('set-load-demo-btn')?.addEventListener('click', async () => {
      const confirmed = await ui.confirmDialog({
        title: 'Load Realistic Demo Dataset',
        message: 'This will load 20 industrial assets, 5 technicians, and real maintenance records. Continue?',
        confirmText: 'Load Demo',
        isDanger: false
      });
      if (confirmed) {
        await backupManager.loadDemoWorkspace();
        await this.navigate('overview');
      }
    });

    document.getElementById('set-wipe-workspace-btn')?.addEventListener('click', async () => {
      const code = prompt('DANGER: This will permanently delete all records from IndexedDB.\nType "CONFIRM-RESET" to proceed:');
      if (code) {
        const success = await backupManager.resetWorkspace(code);
        if (success) await this.navigate('overview');
      }
    });
  }

  /* ==========================================================================
     MODALS: ASSET FORM & DOSSIER & QR
     ========================================================================== */
  async openAssetFormModal(existingId = null) {
    const existing = existingId ? await db.getById(STORES.ASSETS, existingId) : null;
    const technicians = await db.getAll(STORES.TECHNICIANS);

    let modal = document.getElementById('asset-form-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'asset-form-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog modal-xl">
        <div class="modal-header">
          <h3 class="modal-title">${existing ? 'Edit Equipment Asset' : 'Register New Equipment Asset'}</h3>
          <button class="btn-icon" data-close-modal="asset-form-modal">✕</button>
        </div>
        <form id="asset-form-element">
          <div class="modal-body">
            <div class="form-grid grid-3">
              <div class="form-group">
                <label class="form-label">Equipment Name <span class="required">*</span></label>
                <input type="text" class="form-control" name="name" required value="${ui.escapeHtml(existing?.name || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Asset Code / Tag</label>
                <input type="text" class="form-control" name="asset_code" placeholder="Auto-generated if blank" value="${ui.escapeHtml(existing?.asset_code || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Category <span class="required">*</span></label>
                <select class="form-control" name="category" required>
                  ${ASSET_CATEGORIES.map(c => `<option value="${c}" ${existing?.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
              </div>

              <div class="form-group">
                <label class="form-label">Brand / Make</label>
                <input type="text" class="form-control" name="brand" value="${ui.escapeHtml(existing?.brand || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Model Number</label>
                <input type="text" class="form-control" name="model" value="${ui.escapeHtml(existing?.model || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Serial Number</label>
                <input type="text" class="form-control" name="serial_number" value="${ui.escapeHtml(existing?.serial_number || '')}">
              </div>

              <div class="form-group">
                <label class="form-label">Location / Building</label>
                <input type="text" class="form-control" name="location" value="${ui.escapeHtml(existing?.location || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Department</label>
                <input type="text" class="form-control" name="department" value="${ui.escapeHtml(existing?.department || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Assigned Technician</label>
                <select class="form-control" name="assigned_technician">
                  <option value="">Unassigned</option>
                  ${technicians.map(t => `<option value="${t.name}" ${existing?.assigned_technician === t.name ? 'selected' : ''}>${t.name} (${t.specialization})</option>`).join('')}
                </select>
              </div>

              <div class="form-group">
                <label class="form-label">Purchase Date</label>
                <input type="date" class="form-control" name="purchase_date" value="${existing?.purchase_date || ''}">
              </div>
              <div class="form-group">
                <label class="form-label">Purchase Cost ($)</label>
                <input type="number" step="0.01" class="form-control" name="purchase_cost" value="${existing?.purchase_cost || '0'}">
              </div>
              <div class="form-group">
                <label class="form-label">Warranty Expiry</label>
                <input type="date" class="form-control" name="warranty_expiry" value="${existing?.warranty_expiry || ''}">
              </div>

              <div class="form-group">
                <label class="form-label">Operational Status</label>
                <select class="form-control" name="status">
                  ${ASSET_STATUSES.map(s => `<option value="${s}" ${existing?.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Manufacturer</label>
                <input type="text" class="form-control" name="manufacturer" value="${ui.escapeHtml(existing?.manufacturer || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Supplier / Vendor</label>
                <input type="text" class="form-control" name="supplier" value="${ui.escapeHtml(existing?.supplier || '')}">
              </div>

              <div class="form-group full-width">
                <label class="form-label">Equipment Description & Technical Specifications</label>
                <textarea class="form-control" name="description" rows="2">${ui.escapeHtml(existing?.description || '')}</textarea>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close-modal="asset-form-modal">Cancel</button>
            <button type="submit" class="btn btn-primary">${existing ? 'Update Asset' : 'Register Asset'}</button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('asset-form-element').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      const saved = await assetRegistry.saveAsset(data, existingId);
      if (saved) {
        ui.closeModal('asset-form-modal');
        if (this.currentView === 'assets') this.renderAssetRegistry(document.getElementById('main-content-area'));
      }
    });

    ui.openModal('asset-form-modal');
  }

  async openAssetDetailModal(assetId) {
    const dossier = await assetRegistry.getAssetDossier(assetId);
    if (!dossier) return;
    const a = dossier.asset;

    let modal = document.getElementById('asset-detail-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'asset-detail-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog modal-xl">
        <div class="modal-header">
          <div>
            <h3 class="modal-title">${ui.escapeHtml(a.name)}</h3>
            <span style="font-family:var(--font-mono); font-size:0.8125rem; color:var(--text-dim);">${a.asset_code || a.id} &bull; ${a.category}</span>
          </div>
          <div style="display:flex; align-items:center; gap:0.5rem;">
            ${assetRegistry.renderStatusBadge(a.status)}
            <button class="btn-icon" data-close-modal="asset-detail-modal">✕</button>
          </div>
        </div>
        <div class="modal-body" style="padding-top:0.75rem;">
          <div class="stats-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom:1rem;">
            <div class="stat-card" style="padding:0.875rem;">
              <div class="stat-title">Capital Cost</div>
              <div style="font-size:1.25rem; font-weight:700;">${ui.formatCurrency(a.purchase_cost)}</div>
            </div>
            <div class="stat-card" style="padding:0.875rem;">
              <div class="stat-title">Maint. Spend</div>
              <div style="font-size:1.25rem; font-weight:700; color:var(--primary);">${ui.formatCurrency(dossier.totalMaintenanceCost)}</div>
            </div>
            <div class="stat-card" style="padding:0.875rem;">
              <div class="stat-title">Total Downtime</div>
              <div style="font-size:1.25rem; font-weight:700; color:var(--danger);">${ui.formatDuration(dossier.totalDowntimeMinutes)}</div>
            </div>
            <div class="stat-card" style="padding:0.875rem;">
              <div class="stat-title">Active Plans</div>
              <div style="font-size:1.25rem; font-weight:700;">${dossier.plans.length}</div>
            </div>
          </div>

          <!-- Specs Table -->
          <div class="card" style="margin-bottom:1rem;">
            <div class="card-header" style="padding:0.625rem 1rem;">
              <div style="font-weight:600; font-size:0.875rem;">Technical Specifications</div>
            </div>
            <div style="padding:1rem; display:grid; grid-template-columns: repeat(3, 1fr); gap:0.75rem; font-size:0.8125rem;">
              <div><span style="color:var(--text-dim);">Brand:</span> <strong>${ui.escapeHtml(a.brand || 'N/A')}</strong></div>
              <div><span style="color:var(--text-dim);">Model:</span> <strong>${ui.escapeHtml(a.model || 'N/A')}</strong></div>
              <div><span style="color:var(--text-dim);">Serial No:</span> <strong style="font-family:var(--font-mono);">${ui.escapeHtml(a.serial_number || 'N/A')}</strong></div>
              <div><span style="color:var(--text-dim);">Location:</span> <strong>${ui.escapeHtml(a.location || 'N/A')}</strong></div>
              <div><span style="color:var(--text-dim);">Department:</span> <strong>${ui.escapeHtml(a.department || 'N/A')}</strong></div>
              <div><span style="color:var(--text-dim);">Warranty Expiry:</span> <strong>${ui.formatDate(a.warranty_expiry)}</strong></div>
            </div>
          </div>

          <!-- Maintenance History Timeline -->
          <div class="card">
            <div class="card-header" style="padding:0.625rem 1rem;">
              <div style="font-weight:600; font-size:0.875rem;">Maintenance & Repair Timeline (${dossier.repairs.length} records)</div>
            </div>
            <div style="padding:1rem;">
              ${dossier.repairs.length === 0 ? `<div style="color:var(--text-dim); font-size:0.8125rem;">No maintenance records logged yet.</div>` : `
                <div class="timeline">
                  ${dossier.repairs.map(r => `
                    <div class="timeline-item">
                      <div class="timeline-dot"></div>
                      <div class="timeline-content">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                          <strong>${ui.formatDate(r.repair_date)} &bull; ${ui.escapeHtml(r.issue_description)}</strong>
                          <span style="font-weight:700; color:var(--primary);">${ui.formatCurrency(r.total_cost)}</span>
                        </div>
                        <div style="font-size:0.8125rem; color:var(--text-muted); margin-top:4px;">
                          ${ui.escapeHtml(r.work_performed)}
                        </div>
                        <div style="font-size:0.75rem; color:var(--text-dim); margin-top:4px;">
                          Technician: ${ui.escapeHtml(r.technician_name || 'N/A')} &bull; Parts: ${ui.escapeHtml(r.parts_replaced || 'None')} &bull; Downtime: ${ui.formatDuration(r.downtime_minutes)}
                        </div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="dossier-print-tag-btn">Print Equipment Tag</button>
          <button class="btn btn-secondary" id="dossier-edit-btn">Edit Details</button>
          <button class="btn btn-secondary" data-close-modal="asset-detail-modal">Close</button>
        </div>
      </div>
    `;

    document.getElementById('dossier-print-tag-btn')?.addEventListener('click', () => {
      ui.closeModal('asset-detail-modal');
      this.openAssetQrModal(assetId);
    });

    document.getElementById('dossier-edit-btn')?.addEventListener('click', () => {
      ui.closeModal('asset-detail-modal');
      this.openAssetFormModal(assetId);
    });

    ui.openModal('asset-detail-modal');
  }

  async openAssetQrModal(assetId) {
    const asset = await db.getById(STORES.ASSETS, assetId);
    if (!asset) return;

    let modal = document.getElementById('asset-qr-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'asset-qr-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog modal-sm">
        <div class="modal-header">
          <h3 class="modal-title">Equipment Tag / QR Label</h3>
          <button class="btn-icon" data-close-modal="asset-qr-modal">✕</button>
        </div>
        <div class="modal-body" style="align-items:center; justify-content:center;">
          ${QRGenerator.renderEquipmentLabel(asset)}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-close-modal="asset-qr-modal">Cancel</button>
          <button class="btn btn-primary" id="print-qr-label-btn">🖨️ Print Label</button>
        </div>
      </div>
    `;

    document.getElementById('print-qr-label-btn')?.addEventListener('click', () => {
      window.print();
    });

    ui.openModal('asset-qr-modal');
  }

  /* ==========================================================================
     MODALS: WORK ORDER CREATE & DETAIL
     ========================================================================== */
  async openWorkOrderModal(preselectedAssetId = null) {
    const assets = await db.getAll(STORES.ASSETS);
    const techs = await db.getAll(STORES.TECHNICIANS);

    let modal = document.getElementById('work-order-create-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'work-order-create-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3 class="modal-title">Create Work Order / Repair Request</h3>
          <button class="btn-icon" data-close-modal="work-order-create-modal">✕</button>
        </div>
        <form id="wo-create-form">
          <div class="modal-body">
            <div class="form-group" style="margin-bottom:0.75rem;">
              <label class="form-label">Work Order Title <span class="required">*</span></label>
              <input type="text" class="form-control" name="title" required placeholder="e.g. Spindle Vibration & Lube Leak">
            </div>
            <div class="form-grid" style="margin-bottom:0.75rem;">
              <div class="form-group">
                <label class="form-label">Target Equipment <span class="required">*</span></label>
                <select class="form-control" name="asset_id" required>
                  <option value="">-- Select Asset --</option>
                  ${assets.map(a => `<option value="${a.id}" ${preselectedAssetId === a.id ? 'selected' : ''}>${a.name} (${a.asset_code || a.id})</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Work Order Type</label>
                <select class="form-control" name="work_type">
                  ${WORK_ORDER_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Priority Level <span class="required">*</span></label>
                <select class="form-control" name="priority">
                  ${WORK_ORDER_PRIORITIES.map(p => `<option value="${p}" ${p === 'MEDIUM' ? 'selected' : ''}>${p}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Assign Technician</label>
                <select class="form-control" name="technician_id">
                  <option value="">Unassigned</option>
                  ${techs.map(t => `<option value="${t.id}">${t.name} (${t.specialization})</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Scheduled Date</label>
                <input type="date" class="form-control" name="scheduled_at" value="${new Date().toISOString().split('T')[0]}">
              </div>
              <div class="form-group">
                <label class="form-label">Estimated Budget ($)</label>
                <input type="number" class="form-control" name="estimated_cost" value="100">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Detailed Issue Description</label>
              <textarea class="form-control" name="description" rows="3" placeholder="Symptoms, alarm codes, error messages..."></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close-modal="work-order-create-modal">Cancel</button>
            <button type="submit" class="btn btn-primary">Dispatch Work Order</button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('wo-create-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      const created = await workOrders.createWorkOrder(data);
      if (created) {
        ui.closeModal('work-order-create-modal');
        if (this.currentView === 'work-orders') this.renderWorkOrders(document.getElementById('main-content-area'));
        if (this.currentView === 'overview') this.renderOverview(document.getElementById('main-content-area'));
      }
    });

    ui.openModal('work-order-create-modal');
  }

  async openWorkOrderDetailModal(workOrderId) {
    const order = await db.getById(STORES.WORK_ORDERS, workOrderId);
    if (!order) return;
    const parts = await db.getAll(STORES.SPARE_PARTS);
    const techs = await db.getAll(STORES.TECHNICIANS);

    let modal = document.getElementById('work-order-detail-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'work-order-detail-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog modal-xl">
        <div class="modal-header">
          <div>
            <h3 class="modal-title">${order.id}: ${ui.escapeHtml(order.title)}</h3>
            <span style="font-size:0.8125rem; color:var(--text-dim);">${order.asset_name} &bull; ${order.work_type}</span>
          </div>
          <div style="display:flex; align-items:center; gap:0.5rem;">
            ${workOrders.renderPriorityBadge(order.priority)}
            ${workOrders.renderStatusBadge(order.status)}
            <button class="btn-icon" data-close-modal="work-order-detail-modal">✕</button>
          </div>
        </div>
        <div class="modal-body">
          <div class="stats-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom:1rem;">
            <div class="stat-card" style="padding:0.75rem;">
              <div class="stat-title">Estimated Budget</div>
              <div style="font-size:1.25rem; font-weight:700;">${ui.formatCurrency(order.estimated_cost)}</div>
            </div>
            <div class="stat-card" style="padding:0.75rem;">
              <div class="stat-title">Parts Cost</div>
              <div style="font-size:1.25rem; font-weight:700; color:var(--warning);">${ui.formatCurrency(order.parts_cost)}</div>
            </div>
            <div class="stat-card" style="padding:0.75rem;">
              <div class="stat-title">Total Actual Cost</div>
              <div style="font-size:1.25rem; font-weight:700; color:var(--primary);">${ui.formatCurrency(order.actual_cost)}</div>
            </div>
          </div>

          <!-- Status & Technician Assignment Controls -->
          <div class="card" style="margin-bottom:1rem;">
            <div class="card-header" style="padding:0.625rem 1rem;">
              <div style="font-weight:600; font-size:0.875rem;">Status Management</div>
            </div>
            <div style="padding:1rem; display:flex; gap:1rem; flex-wrap:wrap; align-items:flex-end;">
              <div class="form-group">
                <label class="form-label">Current Status</label>
                <select class="form-control" id="wo-detail-status-select">
                  ${WORK_ORDER_STATUSES.map(s => `<option value="${s}" ${order.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </div>
              <div class="form-group" style="flex:1;">
                <label class="form-label">Status Update Note</label>
                <input type="text" class="form-control" id="wo-status-note" placeholder="Reason or progress update...">
              </div>
              <button class="btn btn-secondary" id="wo-update-status-btn">Update Status</button>
            </div>
          </div>

          <!-- Spare Parts Consumption Section -->
          <div class="card" style="margin-bottom:1rem;">
            <div class="card-header" style="padding:0.625rem 1rem;">
              <div style="font-weight:600; font-size:0.875rem;">Log Consumed Spare Parts</div>
            </div>
            <div style="padding:1rem;">
              <div style="display:flex; gap:0.75rem; align-items:flex-end; margin-bottom:1rem;">
                <div class="form-group" style="flex:2;">
                  <label class="form-label">Select Part from Inventory</label>
                  <select class="form-control" id="wo-part-select">
                    <option value="">-- Choose Spare Part --</option>
                    ${parts.map(p => `<option value="${p.id}">${p.name} (${p.part_number}) - Avail: ${p.quantity} @ ${ui.formatCurrency(p.unit_cost)}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group" style="flex:1;">
                  <label class="form-label">Quantity</label>
                  <input type="number" class="form-control" id="wo-part-qty" value="1" min="1">
                </div>
                <button class="btn btn-secondary" id="wo-add-part-btn">+ Consume Part</button>
              </div>

              <!-- Used Parts Table -->
              <table class="data-table" style="font-size:0.8125rem;">
                <thead>
                  <tr>
                    <th>Part Name</th>
                    <th>Part Number</th>
                    <th>Quantity</th>
                    <th>Unit Cost</th>
                    <th>Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  ${(order.used_parts || []).length === 0 ? `<tr><td colspan="5" style="text-align:center; color:var(--text-dim); padding:1rem;">No spare parts consumed for this order</td></tr>` : order.used_parts.map(p => `
                    <tr>
                      <td><strong>${ui.escapeHtml(p.part_name)}</strong></td>
                      <td style="font-family:var(--font-mono);">${ui.escapeHtml(p.part_number)}</td>
                      <td>${p.quantity}</td>
                      <td>${ui.formatCurrency(p.unit_cost)}</td>
                      <td style="font-weight:700;">${ui.formatCurrency(p.total_cost)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Mark Complete or Cancel -->
          <div class="card">
            <div class="card-header" style="padding:0.625rem 1rem;">
              <div style="font-weight:600; font-size:0.875rem;">Complete & Archive Work Order</div>
            </div>
            <div style="padding:1rem;">
              <form id="wo-complete-form" style="display:flex; flex-direction:column; gap:0.75rem;">
                <div class="form-grid">
                  <div class="form-group">
                    <label class="form-label">Labor Hours Spent</label>
                    <input type="number" step="0.5" class="form-control" name="labor_hours" value="2.0">
                  </div>
                  <div class="form-group">
                    <label class="form-label">Hourly Labor Rate ($)</label>
                    <input type="number" class="form-control" name="labor_hourly_rate" value="65">
                  </div>
                  <div class="form-group">
                    <label class="form-label">Downtime Caused (Minutes)</label>
                    <input type="number" class="form-control" name="downtime_minutes" value="60">
                  </div>
                  <div class="form-group">
                    <label class="form-label">Root Cause Identified</label>
                    <input type="text" class="form-control" name="root_cause" placeholder="e.g. Normal component wear, lubricant breakdown">
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label">Work Performed Summary</label>
                  <textarea class="form-control" name="work_performed" rows="2" required placeholder="Describe actions taken, tests performed, and restoration..."></textarea>
                </div>
                <div style="display:flex; gap:0.75rem; justify-content:flex-end;">
                  <button type="button" class="btn btn-danger" id="wo-cancel-job-btn">Cancel Work Order</button>
                  <button type="submit" class="btn btn-success">Mark Job Complete</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('wo-update-status-btn')?.addEventListener('click', async () => {
      const newStatus = document.getElementById('wo-detail-status-select').value;
      const note = document.getElementById('wo-status-note').value.trim();
      const success = await workOrders.updateStatus(workOrderId, newStatus, note);
      if (success) {
        ui.closeModal('work-order-detail-modal');
        if (this.currentView === 'work-orders') this.renderWorkOrders(document.getElementById('main-content-area'));
      }
    });

    document.getElementById('wo-add-part-btn')?.addEventListener('click', async () => {
      const partId = document.getElementById('wo-part-select').value;
      const qty = Number(document.getElementById('wo-part-qty').value);
      if (!partId || qty <= 0) {
        ui.showToast('Please select a part and valid quantity.', 'warning');
        return;
      }
      const success = await workOrders.consumePartForOrder(workOrderId, partId, qty);
      if (success) {
        this.openWorkOrderDetailModal(workOrderId);
      }
    });

    document.getElementById('wo-complete-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      const success = await workOrders.completeWorkOrder(workOrderId, data);
      if (success) {
        ui.closeModal('work-order-detail-modal');
        if (this.currentView === 'work-orders') this.renderWorkOrders(document.getElementById('main-content-area'));
        if (this.currentView === 'overview') this.renderOverview(document.getElementById('main-content-area'));
      }
    });

    document.getElementById('wo-cancel-job-btn')?.addEventListener('click', async () => {
      const reason = prompt('Enter reason for cancelling this work order:');
      if (reason) {
        await workOrders.cancelWorkOrder(workOrderId, reason);
        ui.closeModal('work-order-detail-modal');
        if (this.currentView === 'work-orders') this.renderWorkOrders(document.getElementById('main-content-area'));
      }
    });

    ui.openModal('work-order-detail-modal');
  }

  /* ==========================================================================
     MODALS: PREVENTIVE MAINTENANCE & EXECUTE CHECKLIST
     ========================================================================== */
  async openPlanModal(existingId = null) {
    const existing = existingId ? await db.getById(STORES.MAINTENANCE_PLANS, existingId) : null;
    const assets = await db.getAll(STORES.ASSETS);
    const techs = await db.getAll(STORES.TECHNICIANS);

    let modal = document.getElementById('pm-plan-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pm-plan-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3 class="modal-title">${existing ? 'Edit Maintenance Plan' : 'Create Preventive Maintenance Plan'}</h3>
          <button class="btn-icon" data-close-modal="pm-plan-modal">✕</button>
        </div>
        <form id="pm-plan-form">
          <div class="modal-body">
            <div class="form-group" style="margin-bottom:0.75rem;">
              <label class="form-label">Plan Title <span class="required">*</span></label>
              <input type="text" class="form-control" name="title" required placeholder="e.g. Monthly CNC Spindle & Lubrication Inspection" value="${ui.escapeHtml(existing?.title || '')}">
            </div>
            <div class="form-grid" style="margin-bottom:0.75rem;">
              <div class="form-group">
                <label class="form-label">Equipment Asset <span class="required">*</span></label>
                <select class="form-control" name="asset_id" required>
                  <option value="">-- Choose Asset --</option>
                  ${assets.map(a => `<option value="${a.id}" ${existing?.asset_id === a.id ? 'selected' : ''}>${a.name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Maintenance Frequency <span class="required">*</span></label>
                <select class="form-control" name="frequency">
                  ${FREQUENCIES.map(f => `<option value="${f}" ${existing?.frequency === f ? 'selected' : ''}>${f}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Custom Days (if Custom Interval)</label>
                <input type="number" class="form-control" name="custom_interval_days" value="${existing?.custom_interval_days || 30}">
              </div>
              <div class="form-group">
                <label class="form-label">Responsible Technician</label>
                <select class="form-control" name="technician_id">
                  <option value="">Unassigned</option>
                  ${techs.map(t => `<option value="${t.id}" ${existing?.technician_id === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Last Serviced Date</label>
                <input type="date" class="form-control" name="last_maintenance_date" value="${existing?.last_maintenance_date || ''}">
              </div>
              <div class="form-group">
                <label class="form-label">Next Due Date (Auto-computed if blank)</label>
                <input type="date" class="form-control" name="next_due_date" value="${existing?.next_due_date || ''}">
              </div>
            </div>
            <div class="form-group" style="margin-bottom:0.75rem;">
              <label class="form-label">Inspection Checklist (One item per line)</label>
              <textarea class="form-control" name="checklist_raw" rows="4" placeholder="Check oil level&#10;Inspect drive belt tension&#10;Clean air filter">${(existing?.checklist || []).join('\n')}</textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close-modal="pm-plan-modal">Cancel</button>
            <button type="submit" class="btn btn-primary">${existing ? 'Update Plan' : 'Create Plan'}</button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('pm-plan-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      const rawChecklist = data.checklist_raw || '';
      data.checklist = rawChecklist.split('\n').map(s => s.trim()).filter(Boolean);
      delete data.checklist_raw;

      const saved = await maintenanceManager.savePlan(data, existingId);
      if (saved) {
        ui.closeModal('pm-plan-modal');
        if (this.currentView === 'preventive') this.renderPreventiveMaintenance(document.getElementById('main-content-area'));
        if (this.currentView === 'calendar') this.renderMaintenanceCalendar(document.getElementById('main-content-area'));
      }
    });

    ui.openModal('pm-plan-modal');
  }

  async openExecutePlanModal(planId) {
    const plan = await db.getById(STORES.MAINTENANCE_PLANS, planId);
    if (!plan) return;
    const checklist = plan.checklist || ['Inspect physical condition and secure wiring'];

    let modal = document.getElementById('pm-execute-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pm-execute-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <div>
            <h3 class="modal-title">Execute Maintenance: ${ui.escapeHtml(plan.title)}</h3>
            <span style="font-size:0.8125rem; color:var(--text-dim);">${plan.asset_name} &bull; ${plan.frequency} Cycle</span>
          </div>
          <button class="btn-icon" data-close-modal="pm-execute-modal">✕</button>
        </div>
        <form id="pm-execute-form">
          <div class="modal-body">
            <div style="font-size:0.875rem; color:var(--text-muted); margin-bottom:0.75rem;">
              Complete the inspection checklist item-by-item to certify servicing and automatically advance the schedule to the next cycle.
            </div>

            <!-- Checklist Items -->
            <div style="display:flex; flex-direction:column; gap:0.5rem; margin-bottom:1rem;">
              ${checklist.map((item, idx) => `
                <div style="display:flex; align-items:center; justify-content:space-between; background:var(--bg-surface); padding:0.625rem 0.875rem; border-radius:var(--radius-md); border:1px solid var(--border-subtle);">
                  <span style="font-size:0.8125rem; font-weight:500;">${idx + 1}. ${ui.escapeHtml(item)}</span>
                  <div style="display:inline-flex; gap:0.5rem;">
                    <label style="font-size:0.75rem; display:flex; align-items:center; gap:3px; color:var(--success); cursor:pointer;">
                      <input type="radio" name="chk_${idx}" value="PASS" checked> Pass
                    </label>
                    <label style="font-size:0.75rem; display:flex; align-items:center; gap:3px; color:var(--warning); cursor:pointer;">
                      <input type="radio" name="chk_${idx}" value="FLAGGED"> Flag
                    </label>
                    <label style="font-size:0.75rem; display:flex; align-items:center; gap:3px; color:var(--danger); cursor:pointer;">
                      <input type="radio" name="chk_${idx}" value="FAIL"> Fail
                    </label>
                  </div>
                </div>
              `).join('')}
            </div>

            <div class="form-grid" style="margin-bottom:0.75rem;">
              <div class="form-group">
                <label class="form-label">Completion Date</label>
                <input type="date" class="form-control" name="completed_date" value="${new Date().toISOString().split('T')[0]}">
              </div>
              <div class="form-group">
                <label class="form-label">Labor Cost ($)</label>
                <input type="number" class="form-control" name="labor_cost" value="65">
              </div>
              <div class="form-group">
                <label class="form-label">Parts / Consumables Cost ($)</label>
                <input type="number" class="form-control" name="parts_cost" value="0">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Service Notes / Observations</label>
              <textarea class="form-control" name="notes" rows="2" placeholder="Wear observations, lubrication details..."></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close-modal="pm-execute-modal">Cancel</button>
            <button type="submit" class="btn btn-success">Complete & Advance Cycle</button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('pm-execute-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());

      const checklistResults = {};
      checklist.forEach((item, idx) => {
        checklistResults[item] = data[`chk_${idx}`] || 'PASS';
      });

      const success = await maintenanceManager.executeMaintenanceCycle(planId, {
        completed_date: data.completed_date,
        checklistResults,
        labor_cost: data.labor_cost,
        parts_cost: data.parts_cost,
        notes: data.notes
      });

      if (success) {
        ui.closeModal('pm-execute-modal');
        if (this.currentView === 'preventive') this.renderPreventiveMaintenance(document.getElementById('main-content-area'));
        if (this.currentView === 'calendar') this.renderMaintenanceCalendar(document.getElementById('main-content-area'));
        if (this.currentView === 'overview') this.renderOverview(document.getElementById('main-content-area'));
      }
    });

    ui.openModal('pm-execute-modal');
  }

  async openTemplatesModal() {
    let modal = document.getElementById('pm-templates-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pm-templates-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog modal-xl">
        <div class="modal-header">
          <h3 class="modal-title">Industry Standard PM Templates</h3>
          <button class="btn-icon" data-close-modal="pm-templates-modal">✕</button>
        </div>
        <div class="modal-body">
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:1rem;">
            ${PM_TEMPLATES.map((tmpl, idx) => `
              <div class="card" style="padding:1rem; border:1px solid var(--border-medium);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <h4 style="font-weight:700;">${ui.escapeHtml(tmpl.name)}</h4>
                  <span class="nav-badge">${tmpl.frequency}</span>
                </div>
                <div style="margin-top:0.75rem; font-size:0.8125rem; color:var(--text-muted);">
                  <div style="font-weight:600; color:var(--text-dim); text-transform:uppercase; font-size:0.6875rem; margin-bottom:4px;">Checklist (${tmpl.checklist.length} items)</div>
                  <ul style="padding-left:1.25rem;">
                    ${tmpl.checklist.map(c => `<li>${ui.escapeHtml(c)}</li>`).join('')}
                  </ul>
                </div>
                <button class="btn btn-sm btn-primary" style="margin-top:1rem; width:100%;" data-use-template="${idx}">Use This Template</button>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-close-modal="pm-templates-modal">Close</button>
        </div>
      </div>
    `;

    modal.querySelectorAll('[data-use-template]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = btn.getAttribute('data-use-template');
        const tmpl = PM_TEMPLATES[idx];
        ui.closeModal('pm-templates-modal');
        this.openPlanModal();
        // Prefill
        setTimeout(() => {
          const form = document.getElementById('pm-plan-form');
          if (form) {
            form.elements['title'].value = tmpl.name;
            form.elements['frequency'].value = tmpl.frequency;
            form.elements['checklist_raw'].value = tmpl.checklist.join('\n');
          }
        }, 100);
      });
    });

    ui.openModal('pm-templates-modal');
  }

  /* ==========================================================================
     MODALS: INVENTORY & DOWNTIME & TECHNICIANS
     ========================================================================== */
  async openPartModal(existingId = null) {
    const existing = existingId ? await db.getById(STORES.SPARE_PARTS, existingId) : null;

    let modal = document.getElementById('part-form-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'part-form-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3 class="modal-title">${existing ? 'Edit Spare Part' : 'Add Spare Part to Inventory'}</h3>
          <button class="btn-icon" data-close-modal="part-form-modal">✕</button>
        </div>
        <form id="part-form-element">
          <div class="modal-body">
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label">Part Name <span class="required">*</span></label>
                <input type="text" class="form-control" name="name" required value="${ui.escapeHtml(existing?.name || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Part Number / SKU <span class="required">*</span></label>
                <input type="text" class="form-control" name="part_number" required value="${ui.escapeHtml(existing?.part_number || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Category</label>
                <select class="form-control" name="category">
                  ${PART_CATEGORIES.map(c => `<option value="${c}" ${existing?.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Storage Bin / Location</label>
                <input type="text" class="form-control" name="storage_location" value="${ui.escapeHtml(existing?.storage_location || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Initial Quantity in Stock</label>
                <input type="number" class="form-control" name="quantity" min="0" value="${existing?.quantity || '10'}">
              </div>
              <div class="form-group">
                <label class="form-label">Minimum Safety Stock Level</label>
                <input type="number" class="form-control" name="minimum_stock" min="0" value="${existing?.minimum_stock || '4'}">
              </div>
              <div class="form-group">
                <label class="form-label">Unit Cost ($)</label>
                <input type="number" step="0.01" class="form-control" name="unit_cost" value="${existing?.unit_cost || '25.00'}">
              </div>
              <div class="form-group">
                <label class="form-label">Supplier / Vendor</label>
                <input type="text" class="form-control" name="supplier" value="${ui.escapeHtml(existing?.supplier || '')}">
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close-modal="part-form-modal">Cancel</button>
            <button type="submit" class="btn btn-primary">${existing ? 'Update Part' : 'Save Part'}</button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('part-form-element').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      const saved = await inventory.savePart(data, existingId);
      if (saved) {
        ui.closeModal('part-form-modal');
        if (this.currentView === 'inventory') this.renderSpareParts(document.getElementById('main-content-area'));
      }
    });

    ui.openModal('part-form-modal');
  }

  async openRestockModal(partId) {
    const part = await db.getById(STORES.SPARE_PARTS, partId);
    if (!part) return;

    let modal = document.getElementById('part-restock-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'part-restock-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog modal-sm">
        <div class="modal-header">
          <h3 class="modal-title">Restock: ${ui.escapeHtml(part.name)}</h3>
          <button class="btn-icon" data-close-modal="part-restock-modal">✕</button>
        </div>
        <form id="part-restock-form">
          <div class="modal-body">
            <div style="font-size:0.875rem; color:var(--text-muted); margin-bottom:0.75rem;">
              Current inventory on hand: <strong>${part.quantity}</strong> units.
            </div>
            <div class="form-group" style="margin-bottom:0.75rem;">
              <label class="form-label">Quantity to Add <span class="required">*</span></label>
              <input type="number" class="form-control" name="quantity" min="1" value="5" required>
            </div>
            <div class="form-group">
              <label class="form-label">Restock Notes / PO Ref</label>
              <input type="text" class="form-control" name="notes" placeholder="e.g. PO #8891 Received">
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close-modal="part-restock-modal">Cancel</button>
            <button type="submit" class="btn btn-success">+ Restock Inventory</button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('part-restock-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const qty = fd.get('quantity');
      const notes = fd.get('notes');
      const success = await inventory.restockPart(partId, qty, notes);
      if (success) {
        ui.closeModal('part-restock-modal');
        if (this.currentView === 'inventory') this.renderSpareParts(document.getElementById('main-content-area'));
      }
    });

    ui.openModal('part-restock-modal');
  }

  async openConsumeModal(partId) {
    const part = await db.getById(STORES.SPARE_PARTS, partId);
    if (!part) return;

    let modal = document.getElementById('part-consume-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'part-consume-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog modal-sm">
        <div class="modal-header">
          <h3 class="modal-title">Consume: ${ui.escapeHtml(part.name)}</h3>
          <button class="btn-icon" data-close-modal="part-consume-modal">✕</button>
        </div>
        <form id="part-consume-form">
          <div class="modal-body">
            <div style="font-size:0.875rem; color:var(--text-muted); margin-bottom:0.75rem;">
              Available stock: <strong>${part.quantity}</strong> units. Cannot exceed available quantity.
            </div>
            <div class="form-group" style="margin-bottom:0.75rem;">
              <label class="form-label">Quantity to Consume <span class="required">*</span></label>
              <input type="number" class="form-control" name="quantity" min="1" max="${part.quantity}" value="1" required>
            </div>
            <div class="form-group">
              <label class="form-label">Usage Notes / Maintenance Reason</label>
              <input type="text" class="form-control" name="notes" placeholder="e.g. Bearing swapped in Bay 2 pump">
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close-modal="part-consume-modal">Cancel</button>
            <button type="submit" class="btn btn-primary">- Deduct Stock</button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('part-consume-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const qty = fd.get('quantity');
      const notes = fd.get('notes');
      const success = await inventory.consumePart(partId, qty, null, notes);
      if (success) {
        ui.closeModal('part-consume-modal');
        if (this.currentView === 'inventory') this.renderSpareParts(document.getElementById('main-content-area'));
      }
    });

    ui.openModal('part-consume-modal');
  }

  async openLogDowntimeModal() {
    const assets = await db.getAll(STORES.ASSETS);
    const workOrders = await db.getAll(STORES.WORK_ORDERS);

    let modal = document.getElementById('log-downtime-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'log-downtime-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3 class="modal-title">Log Equipment Outage & Downtime</h3>
          <button class="btn-icon" data-close-modal="log-downtime-modal">✕</button>
        </div>
        <form id="log-downtime-form">
          <div class="modal-body">
            <div class="form-group" style="margin-bottom:0.75rem;">
              <label class="form-label">Target Equipment <span class="required">*</span></label>
              <select class="form-control" name="asset_id" required>
                <option value="">-- Select Asset --</option>
                ${assets.map(a => `<option value="${a.id}">${a.name} (${a.asset_code || a.id})</option>`).join('')}
              </select>
            </div>
            <div class="form-grid" style="margin-bottom:0.75rem;">
              <div class="form-group">
                <label class="form-label">Failure Reason <span class="required">*</span></label>
                <select class="form-control" name="reason">
                  ${DOWNTIME_REASONS.map(r => `<option value="${r}">${r}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Link Work Order (Optional)</label>
                <select class="form-control" name="work_order_id">
                  <option value="">None</option>
                  ${workOrders.map(w => `<option value="${w.id}">${w.id} - ${w.title}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Outage Notes / Operator Observations</label>
              <textarea class="form-control" name="notes" rows="2" placeholder="Alarm sounds, visual smoke, safety stops triggered..."></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close-modal="log-downtime-modal">Cancel</button>
            <button type="submit" class="btn btn-danger">Start Outage Clock</button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('log-downtime-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      const event = await downtimeTracker.startDowntime(data);
      if (event) {
        ui.closeModal('log-downtime-modal');
        if (this.currentView === 'downtime') this.renderDowntimeTracker(document.getElementById('main-content-area'));
        if (this.currentView === 'overview') this.renderOverview(document.getElementById('main-content-area'));
      }
    });

    ui.openModal('log-downtime-modal');
  }

  async openResolveDowntimeModal(eventId) {
    const event = await db.getById(STORES.DOWNTIME_EVENTS, eventId);
    if (!event) return;

    let modal = document.getElementById('resolve-downtime-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'resolve-downtime-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog modal-sm">
        <div class="modal-header">
          <h3 class="modal-title">Resolve Outage: ${ui.escapeHtml(event.asset_name)}</h3>
          <button class="btn-icon" data-close-modal="resolve-downtime-modal">✕</button>
        </div>
        <form id="resolve-downtime-form">
          <div class="modal-body">
            <div style="font-size:0.875rem; color:var(--text-muted); margin-bottom:0.75rem;">
              Outage started at: <strong>${ui.formatDateTime(event.started_at)}</strong>
            </div>
            <div class="form-group">
              <label class="form-label">Resolution Summary</label>
              <textarea class="form-control" name="resolution_notes" rows="2" required placeholder="What was repaired or reset to make equipment operational?"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close-modal="resolve-downtime-modal">Cancel</button>
            <button type="submit" class="btn btn-success">Confirm Restoration</button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('resolve-downtime-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const notes = e.target.elements['resolution_notes'].value;
      const success = await downtimeTracker.endDowntime(eventId, null, notes);
      if (success) {
        ui.closeModal('resolve-downtime-modal');
        if (this.currentView === 'downtime') this.renderDowntimeTracker(document.getElementById('main-content-area'));
        if (this.currentView === 'overview') this.renderOverview(document.getElementById('main-content-area'));
      }
    });

    ui.openModal('resolve-downtime-modal');
  }

  async openTechnicianModal(existingId = null) {
    const existing = existingId ? await db.getById(STORES.TECHNICIANS, existingId) : null;

    let modal = document.getElementById('tech-form-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tech-form-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3 class="modal-title">${existing ? 'Edit Technician' : 'Add Technician to Roster'}</h3>
          <button class="btn-icon" data-close-modal="tech-form-modal">✕</button>
        </div>
        <form id="tech-form-element">
          <div class="modal-body">
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label">Full Name <span class="required">*</span></label>
                <input type="text" class="form-control" name="name" required value="${ui.escapeHtml(existing?.name || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Specialization <span class="required">*</span></label>
                <select class="form-control" name="specialization">
                  ${SPECIALIZATIONS.map(s => `<option value="${s}" ${existing?.specialization === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Contact Email / Phone</label>
                <input type="text" class="form-control" name="contact" value="${ui.escapeHtml(existing?.contact || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Availability Status</label>
                <select class="form-control" name="availability">
                  ${AVAILABILITY_STATUSES.map(a => `<option value="${a}" ${existing?.availability === a ? 'selected' : ''}>${a}</option>`).join('')}
                </select>
              </div>
              <div class="form-group full-width">
                <label class="form-label">Skills & Certifications (Comma-separated)</label>
                <input type="text" class="form-control" name="skills" placeholder="e.g. Hydraulics, 480V Certified, PLC Programming" value="${ui.escapeHtml(existing?.skills || '')}">
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close-modal="tech-form-modal">Cancel</button>
            <button type="submit" class="btn btn-primary">${existing ? 'Update Technician' : 'Add Technician'}</button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('tech-form-element').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      const saved = await technicianDirectory.saveTechnician(data, existingId);
      if (saved) {
        ui.closeModal('tech-form-modal');
        if (this.currentView === 'technicians') this.renderTechnicians(document.getElementById('main-content-area'));
      }
    });

    ui.openModal('tech-form-modal');
  }

  /* ==========================================================================
     GLOBAL SEARCH & NOTIFICATIONS CENTER & QUICK ACTIONS
     ========================================================================== */
  async openGlobalSearch() {
    let modal = document.getElementById('global-search-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'global-search-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog" style="max-width:620px;">
        <div style="padding:1rem 1.25rem; border-bottom:1px solid var(--border-subtle); display:flex; align-items:center; gap:0.75rem;">
          <span style="color:var(--text-dim); font-size:1.1rem;">🔍</span>
          <input type="text" id="gsearch-input" placeholder="Search assets, work orders, parts, technicians, serials..." style="flex:1; background:transparent; border:none; color:var(--text-main); font-size:1rem; outline:none;" autofocus>
          <span class="search-kbd">ESC</span>
        </div>
        <div id="gsearch-results" style="max-height:380px; overflow-y:auto; padding:0.5rem;">
          <div style="text-align:center; padding:2rem; font-size:0.875rem; color:var(--text-dim);">Type 2 or more characters to search workspace records</div>
        </div>
      </div>
    `;

    const input = document.getElementById('gsearch-input');
    const resultsContainer = document.getElementById('gsearch-results');

    input.addEventListener('input', async (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (q.length < 2) {
        resultsContainer.innerHTML = `<div style="text-align:center; padding:2rem; font-size:0.875rem; color:var(--text-dim);">Type 2 or more characters to search workspace records</div>`;
        return;
      }

      const [assets, orders, parts, techs] = await Promise.all([
        db.getAll(STORES.ASSETS),
        db.getAll(STORES.WORK_ORDERS),
        db.getAll(STORES.SPARE_PARTS),
        db.getAll(STORES.TECHNICIANS)
      ]);

      const matchedAssets = assets.filter(a => (a.name && a.name.toLowerCase().includes(q)) || (a.asset_code && a.asset_code.toLowerCase().includes(q)) || (a.serial_number && a.serial_number.toLowerCase().includes(q))).slice(0, 4);
      const matchedOrders = orders.filter(o => (o.title && o.title.toLowerCase().includes(q)) || (o.id && o.id.toLowerCase().includes(q))).slice(0, 4);
      const matchedParts = parts.filter(p => (p.name && p.name.toLowerCase().includes(q)) || (p.part_number && p.part_number.toLowerCase().includes(q))).slice(0, 4);
      const matchedTechs = techs.filter(t => (t.name && t.name.toLowerCase().includes(q)) || (t.specialization && t.specialization.toLowerCase().includes(q))).slice(0, 4);

      let html = '';

      if (matchedAssets.length > 0) {
        html += `<div class="nav-section-title">Equipment & Assets (${matchedAssets.length})</div>`;
        matchedAssets.forEach(a => {
          html += `
            <div style="padding:0.6rem 0.875rem; border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;" class="hover-row" data-search-goto-asset="${a.id}">
              <div>
                <strong style="color:var(--text-main); font-size:0.875rem;">${ui.escapeHtml(a.name)}</strong>
                <div style="font-size:0.75rem; color:var(--text-dim);">${a.asset_code || ''} &bull; ${a.category} &bull; ${a.location || 'N/A'}</div>
              </div>
              ${assetRegistry.renderStatusBadge(a.status)}
            </div>
          `;
        });
      }

      if (matchedOrders.length > 0) {
        html += `<div class="nav-section-title">Work Orders (${matchedOrders.length})</div>`;
        matchedOrders.forEach(o => {
          html += `
            <div style="padding:0.6rem 0.875rem; border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;" class="hover-row" data-search-goto-wo="${o.id}">
              <div>
                <strong style="color:var(--text-main); font-size:0.875rem;">${ui.escapeHtml(o.title)}</strong>
                <div style="font-size:0.75rem; color:var(--text-dim);">${o.id} &bull; ${o.asset_name}</div>
              </div>
              ${workOrders.renderPriorityBadge(o.priority)}
            </div>
          `;
        });
      }

      if (matchedParts.length > 0) {
        html += `<div class="nav-section-title">Spare Parts (${matchedParts.length})</div>`;
        matchedParts.forEach(p => {
          html += `
            <div style="padding:0.6rem 0.875rem; border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;" class="hover-row" data-search-goto-part="${p.id}">
              <div>
                <strong style="color:var(--text-main); font-size:0.875rem;">${ui.escapeHtml(p.name)}</strong>
                <div style="font-size:0.75rem; color:var(--text-dim);">${p.part_number} &bull; Location: ${p.storage_location || 'N/A'}</div>
              </div>
              <span style="font-weight:700;">${p.quantity} in stock</span>
            </div>
          `;
        });
      }

      if (!html) {
        html = `<div style="text-align:center; padding:2rem; font-size:0.875rem; color:var(--text-dim);">No records match "${ui.escapeHtml(q)}"</div>`;
      }

      resultsContainer.innerHTML = html;

      resultsContainer.querySelectorAll('[data-search-goto-asset]').forEach(el => {
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-search-goto-asset');
          ui.closeModal('global-search-modal');
          this.openAssetDetailModal(id);
        });
      });

      resultsContainer.querySelectorAll('[data-search-goto-wo]').forEach(el => {
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-search-goto-wo');
          ui.closeModal('global-search-modal');
          this.openWorkOrderDetailModal(id);
        });
      });

      resultsContainer.querySelectorAll('[data-search-goto-part]').forEach(el => {
        el.addEventListener('click', () => {
          ui.closeModal('global-search-modal');
          this.navigate('inventory');
        });
      });
    });

    ui.openModal('global-search-modal');
    setTimeout(() => input.focus(), 50);
  }

  async openNotificationsModal() {
    const list = await notifications.getNotifications();

    let modal = document.getElementById('notifications-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'notifications-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog" style="max-width:540px;">
        <div class="modal-header">
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <h3 class="modal-title">Notification Center</h3>
            <span class="nav-badge ${notifications.unreadCount > 0 ? 'danger' : ''}">${notifications.unreadCount} unread</span>
          </div>
          <div style="display:flex; gap:0.5rem;">
            <button class="btn btn-sm btn-secondary" id="notif-mark-all-btn">Mark All Read</button>
            <button class="btn-icon" data-close-modal="notifications-modal">✕</button>
          </div>
        </div>
        <div class="modal-body" style="padding:0.75rem; max-height:450px;">
          ${list.length === 0 ? `<div style="text-align:center; padding:3rem; color:var(--text-dim);">No alerts. All maintenance schedules and assets in good standing.</div>` : list.map(n => `
            <div style="padding:0.875rem; border-bottom:1px solid var(--border-subtle); display:flex; gap:0.75rem; opacity:${n.is_read ? '0.6' : '1'}; background:${n.is_read ? 'transparent' : 'var(--bg-surface)'}; border-radius:var(--radius-sm); margin-bottom:4px;">
              <span style="font-size:1.1rem; flex-shrink:0;">
                ${n.priority === 'critical' ? '🔴' : (n.priority === 'warning' ? '🟠' : 'ℹ️')}
              </span>
              <div style="flex:1;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <strong style="font-size:0.875rem; color:var(--text-main);">${ui.escapeHtml(n.title)}</strong>
                  <span style="font-size:0.6875rem; color:var(--text-dim);">${ui.formatDateTime(n.created_at)}</span>
                </div>
                <div style="font-size:0.8125rem; color:var(--text-muted); margin-top:3px;">
                  ${ui.escapeHtml(n.description)}
                </div>
                ${!n.is_read ? `
                  <button class="btn btn-sm btn-secondary" style="font-size:0.6875rem; padding:1px 6px; margin-top:6px;" data-mark-read="${n.id}">Mark read</button>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
        <div class="modal-footer" style="justify-content:space-between;">
          <button class="btn btn-sm btn-secondary" id="notif-perm-request-btn">🔔 Enable Browser Push</button>
          <button class="btn btn-sm btn-danger" id="notif-clear-all-btn">Clear All</button>
        </div>
      </div>
    `;

    document.getElementById('notif-mark-all-btn')?.addEventListener('click', async () => {
      await notifications.markAllAsRead();
      this.openNotificationsModal();
    });

    document.getElementById('notif-clear-all-btn')?.addEventListener('click', async () => {
      await notifications.clearAll();
      this.openNotificationsModal();
    });

    document.getElementById('notif-perm-request-btn')?.addEventListener('click', () => {
      notifications.requestBrowserPermission();
    });

    modal.querySelectorAll('[data-mark-read]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-mark-read');
        await notifications.markAsRead(id);
        this.openNotificationsModal();
      });
    });

    ui.openModal('notifications-modal');
  }

  async openQuickActionMenu() {
    let modal = document.getElementById('quick-action-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'quick-action-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-dialog modal-sm">
        <div class="modal-header">
          <h3 class="modal-title">Quick Actions</h3>
          <button class="btn-icon" data-close-modal="quick-action-modal">✕</button>
        </div>
        <div class="modal-body" style="display:flex; flex-direction:column; gap:0.5rem; padding:1rem;">
          <button class="btn btn-secondary" style="justify-content:flex-start;" id="qa-new-asset">
            <span>🏭</span> Register New Equipment
          </button>
          <button class="btn btn-secondary" style="justify-content:flex-start;" id="qa-new-wo">
            <span>📋</span> Create Work Order
          </button>
          <button class="btn btn-secondary" style="justify-content:flex-start;" id="qa-log-downtime">
            <span>⚡</span> Log Equipment Outage
          </button>
          <button class="btn btn-secondary" style="justify-content:flex-start;" id="qa-add-part">
            <span>📦</span> Add Spare Part
          </button>
          <button class="btn btn-secondary" style="justify-content:flex-start;" id="qa-new-plan">
            <span>⏱️</span> Schedule Maintenance
          </button>
        </div>
      </div>
    `;

    document.getElementById('qa-new-asset')?.addEventListener('click', () => {
      ui.closeModal('quick-action-modal');
      this.openAssetFormModal();
    });

    document.getElementById('qa-new-wo')?.addEventListener('click', () => {
      ui.closeModal('quick-action-modal');
      this.openWorkOrderModal();
    });

    document.getElementById('qa-log-downtime')?.addEventListener('click', () => {
      ui.closeModal('quick-action-modal');
      this.openLogDowntimeModal();
    });

    document.getElementById('qa-add-part')?.addEventListener('click', () => {
      ui.closeModal('quick-action-modal');
      this.openPartModal();
    });

    document.getElementById('qa-new-plan')?.addEventListener('click', () => {
      ui.closeModal('quick-action-modal');
      this.openPlanModal();
    });

    ui.openModal('quick-action-modal');
  }
}

export const app = new MaintenXApp();

// Boot application upon DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.init());
} else {
  app.init();
}
