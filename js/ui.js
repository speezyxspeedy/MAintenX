/**
 * MaintenX UI Framework
 * Modals, Toasts, Confirmation Dialogs, Escaping, Theme, and Presentation Utilities
 */

import { db, STORES } from './database.js';

class UIManager {
  constructor() {
    this.currencySymbol = '$';
  }

  async init() {
    const settings = await db.getById(STORES.SETTINGS, 'default');
    if (settings) {
      if (settings.currency_symbol) this.currencySymbol = settings.currency_symbol;
      if (settings.theme) this.setTheme(settings.theme, false);
    }
  }

  /**
   * Escape user input to prevent HTML/XSS injection
   */
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Safe CSV cell sanitizer against spreadsheet formula injection (=, +, -, @)
   */
  sanitizeCsvCell(val) {
    if (val === null || val === undefined) return '""';
    let str = String(val).replace(/"/g, '""');
    // If starts with sensitive spreadsheet characters, prepend a single quote
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    return `"${str}"`;
  }

  /**
   * Format ISO date into localized clean date string
   */
  formatDate(isoStr) {
    if (!isoStr) return 'N/A';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return isoStr;
    }
  }

  /**
   * Format ISO date and time into clean string
   */
  formatDateTime(isoStr) {
    if (!isoStr) return 'N/A';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoStr;
    }
  }

  /**
   * Format monetary value
   */
  formatCurrency(num) {
    const val = Number(num) || 0;
    return `${this.currencySymbol}${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Format minutes into readable human duration (e.g. "4h 25m" or "45 mins")
   */
  formatDuration(minutes) {
    const mins = Math.max(0, Math.round(Number(minutes) || 0));
    if (mins < 60) return `${mins} mins`;
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hours}h ${rem}m` : `${hours} hrs`;
  }

  /**
   * Display transient toast message
   */
  showToast(message, type = 'info', duration = 3500) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✓';
    if (type === 'danger') icon = '✕';
    if (type === 'warning') icon = '⚠';

    toast.innerHTML = `
      <span style="font-weight:bold; font-size:1.1rem; line-height:1;">${icon}</span>
      <div style="flex:1;">${this.escapeHtml(message)}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  /**
   * Reusable modal dialog opener
   */
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      const firstInput = modal.querySelector('input:not([type=hidden]), select, textarea');
      if (firstInput) firstInput.focus();
    }
  }

  /**
   * Close modal by ID
   */
  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.style.display = 'none';
      if (!document.querySelector('.modal-overlay[style*="display: flex"]')) {
        document.body.style.overflow = '';
      }
    }
  }

  /**
   * Confirmation dialog promise
   */
  confirmDialog({ title = 'Confirm Action', message, confirmText = 'Confirm', cancelText = 'Cancel', isDanger = false }) {
    return new Promise((resolve) => {
      let modal = document.getElementById('global-confirm-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'global-confirm-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
          <div class="modal-dialog modal-sm">
            <div class="modal-header">
              <h3 class="modal-title" id="confirm-modal-title">Confirm</h3>
              <button class="btn-icon" id="confirm-modal-x" style="width:28px;height:28px;">✕</button>
            </div>
            <div class="modal-body">
              <p id="confirm-modal-msg" style="color:var(--text-muted);"></p>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" id="confirm-modal-cancel">Cancel</button>
              <button class="btn" id="confirm-modal-ok">Confirm</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
      }

      document.getElementById('confirm-modal-title').textContent = title;
      document.getElementById('confirm-modal-msg').textContent = message;

      const okBtn = document.getElementById('confirm-modal-ok');
      const cancelBtn = document.getElementById('confirm-modal-cancel');
      const xBtn = document.getElementById('confirm-modal-x');

      okBtn.textContent = confirmText;
      okBtn.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';
      cancelBtn.textContent = cancelText;

      const cleanup = (confirmed) => {
        modal.style.display = 'none';
        document.body.style.overflow = '';
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        xBtn.onclick = null;
        resolve(confirmed);
      };

      okBtn.onclick = () => cleanup(true);
      cancelBtn.onclick = () => cleanup(false);
      xBtn.onclick = () => cleanup(false);

      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      okBtn.focus();
    });
  }

  /**
   * Theme switcher: 'dark' | 'light'
   */
  async setTheme(themeName, persist = true) {
    const valid = themeName === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', valid);
    const themeIcon = document.getElementById('theme-toggle-icon');
    if (themeIcon) {
      themeIcon.textContent = valid === 'dark' ? '☀️' : '🌙';
    }

    if (persist) {
      const settings = (await db.getById(STORES.SETTINGS, 'default')) || { id: 'default' };
      settings.theme = valid;
      await db.update(STORES.SETTINGS, settings);
    }
  }

  async toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    await this.setTheme(next, true);
    this.showToast(`Switched to ${next} mode`, 'info', 1800);
  }
}

export const ui = new UIManager();
