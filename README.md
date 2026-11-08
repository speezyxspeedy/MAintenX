# MaintenX — Equipment & Preventive Maintenance CMMS
> **Maintain Better. Downtime Less.**

**MaintenX** is a computerized maintenance management system (CMMS) engineered for workshops, factories, gyms, computer labs, offices, schools, and small businesses. It provides complete, local-first management of equipment assets, recurring preventive maintenance schedules, reactive work orders, technician dispatching, spare parts inventory, live downtime tracking, and audit-grade reporting.

All operational data is processed and stored locally in the browser via **IndexedDB** — ensuring 100% data sovereignty, privacy, and zero external cloud database dependencies.

---

## Table of Contents
1. [Core Features](#core-features)
2. [Technology Stack](#technology-stack)
3. [Architecture & Data Storage (IndexedDB)](#architecture--data-storage-indexeddb)
4. [Role-Based Access Control (RBAC) & Audit Logs](#role-based-access-control-rbac--audit-logs)
5. [Directory & Project Structure](#directory--project-structure)
6. [Local Setup & Running Without a Backend](#local-setup--running-without-a-backend)
   - [Windows 11 Setup Guide](#windows-11-setup-guide)
   - [VS Code Live Server Instructions](#vs-code-live-server-instructions)
   - [Node / Vite Development](#node--vite-development)
   - [Python Simple HTTP Server](#python-simple-http-server)
7. [Asset Identification & Printable QR Labels](#asset-identification--printable-qr-labels)
8. [Maintenance Scheduler & Due Date Math](#maintenance-scheduler--due-date-math)
9. [Availability & Downtime Formula Engine](#availability--downtime-formula-engine)
10. [Backup, Restore & Disaster Recovery](#backup-restore--disaster-recovery)
11. [Browser Notification Limitations & PWA Offline Setup](#browser-notification-limitations--pwa-offline-setup)
12. [Privacy & Security Guarantee](#privacy--security-guarantee)

---

## 1. Core Features

### 🏭 Asset Registry & Lifecycle
- **Complete Dossiers**: Manage industrial machinery, HVAC, electrical, vehicles, IT hardware, and gym gear with over 20 specification fields.
- **Status Tracking**: `OPERATIONAL`, `UNDER MAINTENANCE`, `UNDER REPAIR`, `OUT OF SERVICE`, and `RETIRED`.
- **Printable Equipment Tags**: Generates high-contrast QR labels (using native client-side SVG generation) with asset ID, department, specifications, and serial numbers.
- **Search, Filter & Sort**: Instant multi-attribute search across categories, locations, and capital values.

### ⏱️ Preventive Maintenance Engine & Scheduler
- **Recurring Intervals**: Supports `Daily`, `Weekly`, `Monthly`, `Quarterly`, `Half-Yearly`, `Yearly`, and `Custom Interval (Days)`.
- **Automated Next Cycle Math**: Completing a checklist advances the schedule to the exact next cycle date based on actual completion.
- **Interactive Calendar**: Month, week, and list views with visual color-coded flags (Red for Overdue, Amber for Due Soon, Blue for Scheduled).
- **Multi-Point Inspection Checklists**: Standard templates included for Computer Labs, HVAC Units, CNC Centers, Fitness Gear, and Fleet Vehicles.

### 📋 Work Orders & Field Dispatch
- **Lifecycle Pipeline**: Dual-view Kanban board and list table covering `OPEN` → `ASSIGNED` → `IN PROGRESS` → `WAITING FOR PARTS` → `ON HOLD` → `COMPLETED` → `CANCELLED`.
- **Priority Matrix**: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` with automatic outage linkage.
- **Spare Part Consumption**: Decrements inventory on hand, enforces non-negative stock, and calculates parts expense.
- **Job Sign-Off**: Records labor hours, hourly rates, work performed, root cause, and logs permanently into Repair History.

### 📦 Spare Parts Inventory
- Catalog tracking part numbers, compatible equipment, stock on hand, unit costs, and storage locations.
- Automatic low-stock warnings when quantities hit or fall below minimum thresholds.
- Immutable **Stock Movement Log** tracking every restock, consumption, and return.

### ⚡ Downtime Tracker & Availability Analytics
- Outage timer and breakdown logging with reasons (Mechanical, Electrical, Firmware, Operator Error, etc.).
- Fleet Availability formula:
  $$\text{Availability } \% = \frac{\text{Total Scheduled Operating Time} - \text{Cumulative Downtime}}{\text{Total Scheduled Operating Time}} \times 100$$
- Computes **MTTR (Mean Time to Repair)** and failure incident frequencies across 30-day baselines.

### 📑 Reports & Business Intelligence
- 8 audit-grade reports with CSV export, JSON export, and print-to-PDF layout:
  1. Asset Registry Report
  2. Preventive Maintenance Schedule Report
  3. Work Orders Audit & Execution Report
  4. Asset Repair & Corrective History Report
  5. Asset Availability & Downtime Analysis Report
  6. Spare Parts Inventory & Valuation Report
  7. Maintenance Cost & Financial Expenditure Report
  8. Technician Activity & Workload Report
- Built-in **CSV sanitization against spreadsheet formula injection** (`=`, `+`, `-`, `@`).

---

## 2. Technology Stack

- **Markup & Layout**: Pure HTML5 semantic elements with accessible ARIA labeling.
- **Styling**: Vanilla CSS3 with custom properties, responsive breakpoints, dark/light theme switching, and `@media print` stylesheets. Zero Tailwind or Bootstrap overhead.
- **Scripting**: Modern Vanilla JavaScript (ES Modules).
- **Storage**: Browser-native **IndexedDB** (`MaintenX_DB` v2) with 11 relational object stores and indexes.
- **Offline & PWA**: Service Worker (`sw.js`) and Web App Manifest (`manifest.json`).
- **Data Visualizations**: Native SVG and Canvas chart engines (Donut charts, trend bar charts, and timeline graphs).

---

## 3. Architecture & Data Storage (IndexedDB)

All operational records are persisted within client-side IndexedDB:

| Object Store | Primary Key | Key Indexes | Description |
| :--- | :--- | :--- | :--- |
| `assets` | `id` | `asset_code`, `category`, `status`, `location` | Equipment registry and specifications |
| `technicians` | `id` | `specialization`, `availability` | Workforce roster and skills |
| `work_orders` | `id` | `asset_id`, `technician_id`, `status`, `priority` | Corrective and preventive jobs |
| `maintenance_plans` | `id` | `asset_id`, `frequency`, `next_due_date` | Recurring PM schedules and checklists |
| `maintenance_records` | `id` | `asset_id`, `work_order_id`, `repair_date` | Permanent repair history and cost ledger |
| `spare_parts` | `id` | `part_number`, `quantity`, `category` | Replacement parts catalog and stock levels |
| `stock_movements` | `id` | `part_id`, `work_order_id`, `timestamp` | Audit log of additions and deductions |
| `downtime_events` | `id` | `asset_id`, `work_order_id`, `started_at` | Outages, recovery times, and MTTR |
| `notifications` | `id` | `is_read`, `created_at`, `type` | In-app smart alerts and overdue triggers |
| `settings` | `id` | - | Facility name, currency, theme, warning days |
| `audit_logs` | `id` | `timestamp`, `user_role`, `action` | Immutable traceability log of user actions |

---

## 4. Role-Based Access Control (RBAC) & Audit Logs

MaintenX includes a built-in role switcher in the header to simulate permission policies:

1. **Administrator**: Full authority over asset registry, technician rosters, configuration, database resets, and audit logs.
2. **Maintenance Manager**: Plans preventive schedules, approves work orders, manages spare parts, and exports financial reports.
3. **Technician**: Executes assigned work orders, ticks off inspection checklists, logs consumed parts, and resolves outages.
4. **Facility Operator**: Submits repair requests and reports machine breakdowns.
5. **Auditor (Read-Only)**: Inspects equipment dossiers, views availability stats, and exports audit records without editing rights.

Every critical system event (asset updates, stock movements, status transitions, role switches, and workspace resets) writes a non-repudiable timestamped entry into `audit_logs`.

---

## 5. Directory & Project Structure

```
MaintenX/
├── index.html              # Main single-page HTML5 entry
├── manifest.json           # Web App Manifest for PWA installation
├── sw.js                   # Service Worker for offline asset caching
├── package.json            # Vite dev server and build configuration
├── vite.config.ts          # Static bundler configuration
├── tsconfig.json           # TypeScript configuration
├── README.md               # Product architecture & documentation
├── INSTALLATION.md         # Comprehensive setup & deployment guide
├── assets/
│   └── logo.svg            # Precision industrial logo
├── css/
│   └── style.css           # Industrial design system & dark/light theme
└── js/
    ├── app.js              # Application bootstrapper, routing & search
    ├── database.js         # IndexedDB schema, queries & transactions
    ├── auth-rbac.js        # Role-based access control & audit logging
    ├── ui.js               # Modals, toasts, confirm dialogs & formatters
    ├── qr-generator.js     # Client-side QR SVG encoder & equipment tags
    ├── notifications.js    # Smart alert engine & notification drawer
    ├── assets.js           # Equipment registry CRUD & dossier view
    ├── technicians.js      # Workforce roster & workload metrics
    ├── work-orders.js      # Kanban board, repair dispatch & job completion
    ├── maintenance.js      # PM plans, templates & checklist execution
    ├── scheduler.js        # Calendar matrix & next-due math engine
    ├── repairs.js          # Chronological repair history & cost audits
    ├── inventory.js        # Spare parts stock, movements & consumption
    ├── downtime.js         # Outage logging, availability % & MTTR
    ├── analytics.js        # Native SVG donut & bar visualizations
    ├── reports.js          # 8 audit reports with CSV/JSON/Print engines
    └── backup.js           # JSON snapshot export, restore & demo seeder
```

---

## 6. Local Setup & Running Without a Backend

Because MaintenX is a 100% client-side application, it does **not require Node.js, Python, or a database server to run in production**. Any standard HTTP static server will host the application.

### Windows 11 Setup Guide
1. Open PowerShell or Windows Terminal in the project directory.
2. If you have Python installed:
   ```powershell
   python -m http.server 3000
   ```
3. Open Microsoft Edge, Google Chrome, or Mozilla Firefox and navigate to:
   `http://localhost:3000`

### VS Code Live Server Instructions
1. Open the project folder in Visual Studio Code.
2. Install the **Live Server** extension by Ritwick Dey (`ms-vscode.live-server` or `ritwickdey.liveserver`).
3. Right-click `index.html` in the file explorer and click **"Open with Live Server"**.
4. The application opens automatically at `http://127.0.0.1:5500`.

### Node / Vite Development
```bash
npm install
npm run dev
```
Open your browser at `http://localhost:3000`.

---

## 7. Asset Identification & Printable QR Labels

Every asset is assigned a unique tracking identifier (e.g., `MX-2026-0001`).
Clicking **"QR Tag"** or **"Dossier → Print Equipment Tag"** produces an industrial equipment identification tag.
- The QR matrix is generated client-side as pure vector SVG without third-party web services.
- The label complies with ISO plant tagging conventions: Brand, Asset Tag, Location, Serial Number, and QR link.
- One-click print sends the tag to thermal label printers or standard paper via browser print styles.

---

## 8. Maintenance Scheduler & Due Date Math

MaintenX calculates due states dynamically upon load:
- **Overdue**: Current date $> \text{Next Due Date}$.
- **Due Soon**: Current date is within configured warning thresholds (default: 7, 3, or 1 days).
- **Up To Date**: Current date $< (\text{Next Due Date} - 7\text{ days})$.

When an inspection checklist is completed, the system calculates the next cycle:
$$\text{Next Due Date} = \text{Actual Completion Date} + \text{Frequency Interval}$$
Overdue tasks are never automatically closed without human technician certification.

---

## 9. Availability & Downtime Formula Engine

Downtime tracking records outages from trigger to resolution:
- **MTTR (Mean Time to Repair)**: Cumulative outage duration divided by failure count.
- **Availability Formula**:
  $$\text{Fleet Availability} = \frac{(N_{\text{assets}} \times \text{Days} \times \text{Operating Hours} \times 60) - \text{Downtime Minutes}}{(N_{\text{assets}} \times \text{Days} \times \text{Operating Hours} \times 60)} \times 100$$
The reporting window defaults to 30 days and the operating day assumption (24h continuous vs 8h shift) can be toggled in **Settings**.

---

## 10. Backup, Restore & Disaster Recovery

- **Download Full Backup**: Navigating to `Settings` or `Reports` allows exporting a complete JSON snapshot containing all 11 object stores with export timestamps and record tallies.
- **Restore from Backup**: Uploading a valid MaintenX JSON file displays a preview diff modal with confirmation before merging or overwriting records.
- **Workspace Reset**: Type `CONFIRM-RESET` to purge local records cleanly.
- **Demo Workspace**: Click **"Reload Demo Data"** to instantly test the system with 20 equipment assets, 5 technicians, 12 work orders, 8 PM plans, and 15 spare parts.

---

## 11. Browser Notification Limitations & PWA Offline Setup

1. **Permission**: Click the bell icon or open `Settings` to trigger `Notification.requestPermission()`.
2. **Background Push Notice**: Standard browser security prohibits background notifications when the browser is entirely shut down unless backed by a cloud push gateway. While MaintenX operates locally, in-app notifications and active-tab notifications are always evaluated in real time.
3. **PWA Offline Execution**: The included Service Worker (`sw.js`) caches all assets, HTML, CSS, and JS so MaintenX works offline on factory floors without an active internet connection.

---

## 12. Privacy & Security Guarantee

- **No Remote Telemetry**: Zero external tracking, analytics scripts, or remote database calls.
- **Formula Injection Defense**: All exported CSV cells starting with sensitive spreadsheet characters (`=`, `+`, `-`, `@`, `\t`, `\r`) are automatically escaped.
- **Non-Negative Stock**: Inventory cannot be decremented below zero; consumption requires explicit confirmation.
- **Input Sanitization**: All user strings are escaped via `ui.escapeHtml()` before rendering to prevent DOM-based XSS attacks.

---

*MaintenX &bull; Industrial Maintenance Engineering &bull; Local-First Architecture*
