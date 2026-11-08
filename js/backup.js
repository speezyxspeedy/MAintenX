/**
 * MaintenX Backup, Restore & Demo Workspace Engine
 * Handles JSON backups with schema validation, relationship checks, and realistic industrial demo dataset seeding.
 */

import { db, STORES } from './database.js';
import { ui } from './ui.js';
import { authRBAC, PERMISSIONS } from './auth-rbac.js';
import { notifications } from './notifications.js';

class BackupManager {
  /**
   * Triggers download of complete JSON snapshot
   */
  async downloadFullBackup() {
    if (!authRBAC.can(PERMISSIONS.DATA_BACKUP_RESTORE)) {
      ui.showToast('Access denied: You lack permission to export backups.', 'danger');
      return;
    }

    const backup = await db.exportFullBackup();
    const jsonStr = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    link.href = url;
    link.download = `MaintenX_Full_Backup_${dateStr}.json`;
    link.click();
    URL.revokeObjectURL(url);

    await authRBAC.log({
      action: 'DATA_BACKUP_EXPORT',
      entityType: 'BACKUP',
      entityId: `BACKUP-${dateStr}`,
      details: `Exported full database backup (${Object.values(backup.counts).reduce((a, b) => a + b, 0)} total records)`
    });

    ui.showToast('Full database backup successfully downloaded.', 'success');
  }

  /**
   * Parses and validates uploaded JSON file before prompting user confirmation
   */
  async processBackupFile(file) {
    if (!authRBAC.can(PERMISSIONS.DATA_BACKUP_RESTORE)) {
      ui.showToast('Access denied: You lack permission to restore backups.', 'danger');
      return null;
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          if (!parsed.data || typeof parsed.data !== 'object') {
            throw new Error('Invalid JSON format: root "data" object missing.');
          }

          // Compute preview counts
          const previewCounts = {};
          for (const key of Object.values(STORES)) {
            previewCounts[key] = Array.isArray(parsed.data[key]) ? parsed.data[key].length : 0;
          }

          resolve({
            version: parsed.version || '1.0.0',
            exported_at: parsed.exported_at || 'Unknown',
            counts: previewCounts,
            payload: parsed
          });
        } catch (err) {
          ui.showToast(`Invalid backup file: ${err.message}`, 'danger');
          reject(err);
        }
      };
      reader.onerror = () => {
        ui.showToast('Failed to read file.', 'danger');
        reject(reader.error);
      };
      reader.readAsText(file);
    });
  }

  /**
   * Commits backup restore with optional replacement
   */
  async commitRestore(backupData, replaceExisting = false) {
    try {
      await db.importFullBackup(backupData, replaceExisting);
      await authRBAC.log({
        action: 'DATA_BACKUP_RESTORE',
        entityType: 'BACKUP',
        entityId: 'RESTORE_COMMIT',
        details: `Restored workspace backup (replaceExisting: ${replaceExisting})`
      });
      await notifications.evaluateAlertRules();
      await notifications.updateUnreadCount();
      ui.showToast('Workspace successfully restored from backup!', 'success');
      return true;
    } catch (err) {
      ui.showToast(`Restore failed: ${err.message}`, 'danger');
      return false;
    }
  }

  /**
   * Wipes all operational records with safety confirmation code
   */
  async resetWorkspace(enteredCode) {
    if (!authRBAC.can(PERMISSIONS.WORKSPACE_RESET)) {
      ui.showToast('Access denied: Only Administrators can reset the workspace.', 'danger');
      return false;
    }

    if (enteredCode !== 'CONFIRM-RESET') {
      ui.showToast('Incorrect confirmation code. Type "CONFIRM-RESET" to wipe.', 'danger');
      return false;
    }

    await db.clearAllData();
    await authRBAC.log({
      action: 'WORKSPACE_RESET',
      entityType: 'SYSTEM',
      entityId: 'RESET_ALL',
      details: 'All operational records cleared and workspace reset.'
    });

    await notifications.updateUnreadCount();
    ui.showToast('Workspace completely reset. Database cleared.', 'info');
    return true;
  }

  /**
   * Loads realistic industrial demo dataset:
   * 20 assets, 5 technicians, 12 work orders, 8 maintenance plans, 10 repair history records, 15 spare parts, and downtime events.
   */
  async loadDemoWorkspace() {
    ui.showToast('Loading realistic industrial demo workspace...', 'info');

    // 1. Technicians (5 personnel)
    const technicians = [
      { id: 'TECH-101', name: 'Marcus Vance', specialization: 'Mechanical', contact: 'm.vance@maintenx.local', skills: 'Hydraulics, Bearings, CNC Spindles, Alignment', availability: 'AVAILABLE' },
      { id: 'TECH-102', name: 'Elena Rostova', specialization: 'Electrical', contact: 'e.rostova@maintenx.local', skills: 'PLCs, 3-Phase Motors, VFDs, Instrumentation', availability: 'ON JOB' },
      { id: 'TECH-103', name: 'David Chen', specialization: 'IT Support', contact: 'd.chen@maintenx.local', skills: 'Lab PCs, Server Racks, Managed Switches, Storage', availability: 'AVAILABLE' },
      { id: 'TECH-104', name: 'Sarah Jenkins', specialization: 'HVAC', contact: 's.jenkins@maintenx.local', skills: 'Chillers, Air Compressors, Refrigeration, Ducts', availability: 'AVAILABLE' },
      { id: 'TECH-105', name: 'Tomasz Kowalski', specialization: 'General Maintenance', contact: 't.kowalski@maintenx.local', skills: 'Forklifts, Pneumatics, Welding, Gym Gear', availability: 'AVAILABLE' }
    ];

    for (const t of technicians) await db.add(STORES.TECHNICIANS, t);

    // 2. Assets (20 diverse equipment assets across categories and locations)
    const assets = [
      { id: 'MX-2026-0001', asset_code: 'MX-2026-0001', name: 'Haas VF-4SS CNC Machining Center', category: 'Industrial Machinery', brand: 'Haas Automation', model: 'VF-4SS', serial_number: 'HAAS-VF4-99214', purchase_date: '2023-04-15', purchase_cost: 98000, manufacturer: 'Haas Automation', supplier: 'Industrial Tooling Corp', location: 'Machine Shop Bay 2', department: 'Production', assigned_technician: 'Marcus Vance', installation_date: '2023-05-01', warranty_expiry: '2027-05-01', maintenance_frequency: 'Monthly', status: 'OPERATIONAL', description: 'High-speed vertical CNC machining center for precision milling.' },
      { id: 'MX-2026-0002', asset_code: 'MX-2026-0002', name: 'Carrier 120-Ton Rooftop Chiller Unit', category: 'HVAC', brand: 'Carrier', model: 'AquaForce 30XA', serial_number: 'CAR-30XA-4401', purchase_date: '2021-08-10', purchase_cost: 45000, manufacturer: 'Carrier HVAC', supplier: 'Climate Systems Ltd', location: 'Roof Plant Deck', department: 'Facilities', assigned_technician: 'Sarah Jenkins', installation_date: '2021-09-01', warranty_expiry: '2026-09-01', maintenance_frequency: 'Quarterly', status: 'OPERATIONAL', description: 'Main facility chilled water plant serving central air handlers.' },
      { id: 'MX-2026-0003', asset_code: 'MX-2026-0003', name: 'Kaeser SK 25 Rotary Screw Compressor', category: 'Industrial Machinery', brand: 'Kaeser', model: 'SK 25 Sigma', serial_number: 'KAE-SK25-8812', purchase_date: '2022-11-20', purchase_cost: 16500, manufacturer: 'Kaeser Kompressoren', supplier: 'Air Power Works', location: 'Compressor Room East', department: 'Pneumatics & Utilities', assigned_technician: 'Marcus Vance', installation_date: '2022-12-05', warranty_expiry: '2025-12-05', maintenance_frequency: 'Monthly', status: 'UNDER REPAIR', description: 'Central 7.5 bar compressed air supplier for workshop automation.' },
      { id: 'MX-2026-0004', asset_code: 'MX-2026-0004', name: 'Dell PowerEdge R750 Lab Server', category: 'Computers & IT Equipment', brand: 'Dell Technologies', model: 'PowerEdge R750', serial_number: 'DELL-SRV-7782A', purchase_date: '2024-01-10', purchase_cost: 12500, manufacturer: 'Dell Inc', supplier: 'Enterprise IT Solutions', location: 'Server Rack 04, Room 102', department: 'Information Technology', assigned_technician: 'David Chen', installation_date: '2024-01-20', warranty_expiry: '2028-01-20', maintenance_frequency: 'Monthly', status: 'OPERATIONAL', description: 'Virtualization host for design workstation CAD simulation tools.' },
      { id: 'MX-2026-0005', asset_code: 'MX-2026-0005', name: 'Toyota 8FBE20 Electric Forklift', category: 'Vehicles', brand: 'Toyota Material Handling', model: '8FBE20', serial_number: 'TMH-8F-10294', purchase_date: '2022-03-14', purchase_cost: 32000, manufacturer: 'Toyota', supplier: 'Apex Lift Trucks', location: 'Warehouse Loading Dock', department: 'Logistics', assigned_technician: 'Tomasz Kowalski', installation_date: '2022-03-25', warranty_expiry: '2026-03-25', maintenance_frequency: 'Monthly', status: 'OPERATIONAL', description: '3-wheel electric 2.0-ton counterbalance forklift.' },
      { id: 'MX-2026-0006', asset_code: 'MX-2026-0006', name: 'Schneider Electric Square D 480V Switchgear', category: 'Electrical Equipment', brand: 'Schneider Electric', model: 'QED-2', serial_number: 'SCH-SWG-33901', purchase_date: '2020-05-18', purchase_cost: 38000, manufacturer: 'Schneider Electric', supplier: 'Power Distribution Inc', location: 'Main Electrical Vault', department: 'Facilities', assigned_technician: 'Elena Rostova', installation_date: '2020-06-15', warranty_expiry: '2025-06-15', maintenance_frequency: 'Half-Yearly', status: 'OPERATIONAL', description: 'Primary 480V/277V facility substation panel and circuit breakers.' },
      { id: 'MX-2026-0007', asset_code: 'MX-2026-0007', name: 'Life Fitness Integrity Series Treadmill #1', category: 'Gym Equipment', brand: 'Life Fitness', model: 'Integrity D', serial_number: 'LF-TM-2022-04', purchase_date: '2023-06-10', purchase_cost: 7200, manufacturer: 'Life Fitness', supplier: 'Commercial Gym Supply', location: 'Wellness Center Gym', department: 'Employee Wellness', assigned_technician: 'Tomasz Kowalski', installation_date: '2023-06-18', warranty_expiry: '2026-06-18', maintenance_frequency: 'Weekly', status: 'OPERATIONAL', description: 'Commercial cardiovascular treadmill with heart rate telemetry.' },
      { id: 'MX-2026-0008', asset_code: 'MX-2026-0008', name: 'Agilent 8890 Gas Chromatograph', category: 'Laboratory Equipment', brand: 'Agilent Technologies', model: '8890 GC System', serial_number: 'AGL-GC-8890-41', purchase_date: '2023-09-05', purchase_cost: 54000, manufacturer: 'Agilent', supplier: 'Bio-Scientific Instruments', location: 'Quality Assurance Lab 3', department: 'Quality Control', assigned_technician: 'Elena Rostova', installation_date: '2023-09-20', warranty_expiry: '2027-09-20', maintenance_frequency: 'Monthly', status: 'OPERATIONAL', description: 'High precision gas chromatography for materials composition analysis.' },
      { id: 'MX-2026-0009', asset_code: 'MX-2026-0009', name: 'Miller Dynasty 400 TIG Welder', category: 'Tools & Instruments', brand: 'Miller Electric', model: 'Dynasty 400', serial_number: 'MIL-DYN-400-11', purchase_date: '2022-07-22', purchase_cost: 9500, manufacturer: 'Miller', supplier: 'WeldTech Supply', location: 'Welding Fabrication Booth 1', department: 'Fabrication', assigned_technician: 'Marcus Vance', installation_date: '2022-08-01', warranty_expiry: '2025-08-01', maintenance_frequency: 'Quarterly', status: 'OPERATIONAL', description: 'Heavy-duty AC/DC TIG and stick arc welding power source.' },
      { id: 'MX-2026-0010', asset_code: 'MX-2026-0010', name: 'Canon imageRUNNER ADVANCE DX C5870i', category: 'Office Equipment', brand: 'Canon', model: 'DX C5870i', serial_number: 'CAN-IR-5870-98', purchase_date: '2023-02-11', purchase_cost: 6800, manufacturer: 'Canon Inc', supplier: 'Office Solutions Direct', location: 'Central Admin Office 2nd Fl', department: 'Administration', assigned_technician: 'David Chen', installation_date: '2023-02-18', warranty_expiry: '2026-02-18', maintenance_frequency: 'Quarterly', status: 'OUT OF SERVICE', description: 'High volume color multifunction production laser copier and scanner.' },
      { id: 'MX-2026-0011', asset_code: 'MX-2026-0011', name: 'Bridgeport Series 1 Knee Mill', category: 'Industrial Machinery', brand: 'Bridgeport', model: 'Series 1 Standard', serial_number: 'BP-2019-883', purchase_date: '2019-10-04', purchase_cost: 14000, manufacturer: 'Bridgeport Machines', supplier: 'Precision Machinery Co', location: 'Prototype Toolroom', department: 'Tooling', assigned_technician: 'Marcus Vance', installation_date: '2019-10-15', warranty_expiry: '2022-10-15', maintenance_frequency: 'Monthly', status: 'OPERATIONAL', description: 'Manual vertical milling machine with digital 3-axis readout.' },
      { id: 'MX-2026-0012', asset_code: 'MX-2026-0012', name: 'Fluke 1738 Three-Phase Power Logger', category: 'Tools & Instruments', brand: 'Fluke', model: '1738 Advanced', serial_number: 'FLU-1738-0092', purchase_date: '2024-03-01', purchase_cost: 7800, manufacturer: 'Fluke Corporation', supplier: 'Calibrate & Test Ltd', location: 'Electrical Maintenance Crib', department: 'Electrical', assigned_technician: 'Elena Rostova', installation_date: '2024-03-05', warranty_expiry: '2027-03-05', maintenance_frequency: 'Yearly', status: 'OPERATIONAL', description: 'Energy logger and power quality harmonic distortion analyzer.' },
      { id: 'MX-2026-0013', asset_code: 'MX-2026-0013', name: 'Grundfos CR 32-4 Booster Pump', category: 'Industrial Machinery', brand: 'Grundfos', model: 'CR 32-4 A-F-A-E-HQQE', serial_number: 'GRU-CR32-5502', purchase_date: '2021-12-05', purchase_cost: 8400, manufacturer: 'Grundfos', supplier: 'Hydraulic Systems Direct', location: 'Water Utility Basement', department: 'Facilities', assigned_technician: 'Tomasz Kowalski', installation_date: '2021-12-20', warranty_expiry: '2024-12-20', maintenance_frequency: 'Quarterly', status: 'UNDER MAINTENANCE', description: 'Vertical multistage centrifugal pump for facility water pressure boost.' },
      { id: 'MX-2026-0014', asset_code: 'MX-2026-0014', name: 'Cisco Catalyst 9300 48-Port PoE+ Switch', category: 'Computers & IT Equipment', brand: 'Cisco Systems', model: 'C9300-48P', serial_number: 'CIS-9300-1102A', purchase_date: '2023-01-15', purchase_cost: 5900, manufacturer: 'Cisco', supplier: 'Enterprise IT Solutions', location: 'Data Closet MDF North', department: 'IT Infrastructure', assigned_technician: 'David Chen', installation_date: '2023-01-22', warranty_expiry: '2028-01-22', maintenance_frequency: 'Quarterly', status: 'OPERATIONAL', description: 'Gigabit core network switch supporting VoIP phones and access points.' },
      { id: 'MX-2026-0015', asset_code: 'MX-2026-0015', name: 'Thermo Scientific Precision Lab Incubator', category: 'Laboratory Equipment', brand: 'Thermo Fisher', model: 'Precision 370', serial_number: 'TF-PR370-2210', purchase_date: '2022-09-12', purchase_cost: 6200, manufacturer: 'Thermo Fisher', supplier: 'Lab Tech Instruments', location: 'Biology Cleanroom Lab', department: 'R&D', assigned_technician: 'Sarah Jenkins', installation_date: '2022-09-25', warranty_expiry: '2025-09-25', maintenance_frequency: 'Monthly', status: 'OPERATIONAL', description: 'Microbiological thermal incubator with microprocessor controls.' },
      { id: 'MX-2026-0016', asset_code: 'MX-2026-0016', name: 'Hammer Strength Iso-Lateral Chest Press', category: 'Gym Equipment', brand: 'Hammer Strength', model: 'IL-CP', serial_number: 'HS-CP-8831', purchase_date: '2022-06-20', purchase_cost: 4800, manufacturer: 'Life Fitness / Hammer', supplier: 'Commercial Gym Supply', location: 'Wellness Center Gym', department: 'Employee Wellness', assigned_technician: 'Tomasz Kowalski', installation_date: '2022-06-28', warranty_expiry: '2027-06-28', maintenance_frequency: 'Monthly', status: 'OPERATIONAL', description: 'Plate-loaded strength training isolation equipment.' },
      { id: 'MX-2026-0017', asset_code: 'MX-2026-0017', name: 'Genie GS-1930 Scissor Lift', category: 'Vehicles', brand: 'Genie Terex', model: 'GS-1930', serial_number: 'GEN-1930-5521', purchase_date: '2021-04-18', purchase_cost: 18500, manufacturer: 'Genie', supplier: 'Apex Lift Trucks', location: 'Maintenance Workshop Garage', department: 'Facilities', assigned_technician: 'Tomasz Kowalski', installation_date: '2021-04-30', warranty_expiry: '2025-04-30', maintenance_frequency: 'Monthly', status: 'OPERATIONAL', description: 'Electric self-propelled slab scissor lift with 25ft working height.' },
      { id: 'MX-2026-0018', asset_code: 'MX-2026-0018', name: 'Mitutoyo Crysta-Apex V574 CMM', category: 'Tools & Instruments', brand: 'Mitutoyo', model: 'Crysta-Apex V574', serial_number: 'MIT-CMM-574-09', purchase_date: '2023-11-10', purchase_cost: 65000, manufacturer: 'Mitutoyo', supplier: 'Precision Metrology Inc', location: 'Metrology Lab QA', department: 'Quality Assurance', assigned_technician: 'Elena Rostova', installation_date: '2023-11-28', warranty_expiry: '2026-11-28', maintenance_frequency: 'Quarterly', status: 'OPERATIONAL', description: 'CNC coordinate measuring machine with scanning touch probe.' },
      { id: 'MX-2026-0019', asset_code: 'MX-2026-0019', name: 'Eaton 9PX 11000VA RT6U Online UPS', category: 'Electrical Equipment', brand: 'Eaton', model: '9PX11KTF5', serial_number: 'EAT-9PX-9921', purchase_date: '2023-05-12', purchase_cost: 9200, manufacturer: 'Eaton Power', supplier: 'Enterprise IT Solutions', location: 'Server Room 102 Power Rack', department: 'Information Technology', assigned_technician: 'David Chen', installation_date: '2023-05-20', warranty_expiry: '2026-05-20', maintenance_frequency: 'Quarterly', status: 'OPERATIONAL', description: 'Double-conversion online uninterruptible power supply.' },
      { id: 'MX-2026-0020', asset_code: 'MX-2026-0020', name: 'Doosan Puma 2600SY II Turning Center (Retired)', category: 'Industrial Machinery', brand: 'Doosan', model: 'Puma 2600SY', serial_number: 'DOO-2600-119', purchase_date: '2016-02-14', purchase_cost: 115000, manufacturer: 'DN Solutions / Doosan', supplier: 'Industrial Tooling Corp', location: 'Decommissioning Yard Bay 9', department: 'Production', assigned_technician: 'Marcus Vance', installation_date: '2016-03-01', warranty_expiry: '2019-03-01', maintenance_frequency: 'Monthly', status: 'RETIRED', description: 'Decommissioned CNC turning center scheduled for salvage/scrap.' }
    ];

    for (const a of assets) await db.add(STORES.ASSETS, a);

    // 3. Spare Parts (15 parts with varying quantities & minimum levels)
    const spareParts = [
      { id: 'PRT-201', name: 'Kaeser Synthetic Compressor Oil (5 Gal)', category: 'Lubricants & Fluids', part_number: 'KAE-OIL-SYN-05', compatible_assets: 'MX-2026-0003', quantity: 2, minimum_stock: 4, unit_cost: 165.00, supplier: 'Air Power Works', storage_location: 'Fluids Cabinet B-2' },
      { id: 'PRT-202', name: 'Pleated MERV 13 Air Filter 24x24x2', category: 'Filters & Belts', part_number: 'FLT-MERV13-2424', compatible_assets: 'MX-2026-0002', quantity: 18, minimum_stock: 12, unit_cost: 22.50, supplier: 'Climate Systems Ltd', storage_location: 'Rack 14, Bin C' },
      { id: 'PRT-203', name: 'SKF 6205-2RSH Deep Groove Ball Bearing', category: 'Mechanical & Bearings', part_number: 'SKF-6205-2RS', compatible_assets: 'MX-2026-0001, MX-2026-0013', quantity: 14, minimum_stock: 6, unit_cost: 18.75, supplier: 'Motion Industries', storage_location: 'Drawer 04-A' },
      { id: 'PRT-204', name: 'Parker O-Ring Kit #2 (NBR 70)', category: 'Hydraulics & Pneumatics', part_number: 'PAR-ORK-70', compatible_assets: 'MX-2026-0003, MX-2026-0005', quantity: 3, minimum_stock: 5, unit_cost: 45.00, supplier: 'Hydraulic Systems Direct', storage_location: 'Bin 08-D' },
      { id: 'PRT-205', name: 'Schneider 30A 3-Pole Thermal Circuit Breaker', category: 'Electrical & Electronic', part_number: 'SCH-EDB34030', compatible_assets: 'MX-2026-0006', quantity: 8, minimum_stock: 4, unit_cost: 120.00, supplier: 'Power Distribution Inc', storage_location: 'Elec Cabinet E-1' },
      { id: 'PRT-206', name: 'CAT6A Shielded Patch Cable 2m Blue (10-Pk)', category: 'Cables & Connectors', part_number: 'CBL-C6A-2M-BL', compatible_assets: 'MX-2026-0004, MX-2026-0014', quantity: 25, minimum_stock: 10, unit_cost: 38.00, supplier: 'Enterprise IT Solutions', storage_location: 'IT Storage Bin 1' },
      { id: 'PRT-207', name: 'Commercial Treadmill Walking Belt (Life Fitness)', category: 'Filters & Belts', part_number: 'LF-BLT-TM2022', compatible_assets: 'MX-2026-0007', quantity: 1, minimum_stock: 2, unit_cost: 210.00, supplier: 'Commercial Gym Supply', storage_location: 'Gym Spares Rack' },
      { id: 'PRT-208', name: 'Hydraulic Fluid ISO VG 46 (20L Drum)', category: 'Lubricants & Fluids', part_number: 'HYD-VG46-20L', compatible_assets: 'MX-2026-0005, MX-2026-0017', quantity: 6, minimum_stock: 3, unit_cost: 85.00, supplier: 'Apex Lift Trucks', storage_location: 'Chemical Shed Bay 1' },
      { id: 'PRT-209', name: 'Omron 24VDC Relay with Socket', category: 'Electrical & Electronic', part_number: 'OMR-MY4N-24V', compatible_assets: 'MX-2026-0001, MX-2026-0006', quantity: 20, minimum_stock: 8, unit_cost: 14.50, supplier: 'Power Distribution Inc', storage_location: 'Drawer 02-B' },
      { id: 'PRT-210', name: 'Gas Chromatograph Septa & Liner Pack', category: 'Sensors & Instruments', part_number: 'AGL-SEP-5183', compatible_assets: 'MX-2026-0008', quantity: 4, minimum_stock: 2, unit_cost: 95.00, supplier: 'Bio-Scientific Instruments', storage_location: 'Cleanroom Shelf 2' },
      { id: 'PRT-211', name: 'TIG Torch Collet & Gas Lens Kit 2.4mm', category: 'Consumables & PPE', part_number: 'MIL-TIG-24K', compatible_assets: 'MX-2026-0009', quantity: 12, minimum_stock: 6, unit_cost: 32.00, supplier: 'WeldTech Supply', storage_location: 'Welding Locker 3' },
      { id: 'PRT-212', name: 'Canon GPR-61 Black Drum Unit', category: 'Consumables & PPE', part_number: 'CAN-DRUM-GPR61', compatible_assets: 'MX-2026-0010', quantity: 0, minimum_stock: 2, unit_cost: 185.00, supplier: 'Office Solutions Direct', storage_location: 'Copy Room Cabinet' },
      { id: 'PRT-213', name: 'Grundfos Mechanical Shaft Seal HQQE', category: 'Mechanical & Bearings', part_number: 'GRU-SEAL-HQQE', compatible_assets: 'MX-2026-0013', quantity: 2, minimum_stock: 2, unit_cost: 145.00, supplier: 'Hydraulic Systems Direct', storage_location: 'Plumbing Crib Shelf 4' },
      { id: 'PRT-214', name: 'High-Temperature Silicone Lubricant Spray (12-Pk)', category: 'Lubricants & Fluids', part_number: 'LUB-SIL-12PK', compatible_assets: 'MX-2026-0007, MX-2026-0016', quantity: 5, minimum_stock: 3, unit_cost: 58.00, supplier: 'Motion Industries', storage_location: 'Fluids Cabinet B-1' },
      { id: 'PRT-215', name: 'Eaton Replacement Battery Cartridge (9PX UPS)', category: 'Electrical & Electronic', part_number: 'EAT-RBC-9PX', compatible_assets: 'MX-2026-0019', quantity: 1, minimum_stock: 2, unit_cost: 420.00, supplier: 'Enterprise IT Solutions', storage_location: 'Server Power Storage' }
    ];

    for (const p of spareParts) await db.add(STORES.SPARE_PARTS, p);

    // 4. Maintenance Plans (8 recurring preventive schedules)
    const today = new Date();
    const plusDays = (d) => {
      const dt = new Date(today);
      dt.setDate(dt.getDate() + d);
      return dt.toISOString().split('T')[0];
    };
    const minusDays = (d) => {
      const dt = new Date(today);
      dt.setDate(dt.getDate() - d);
      return dt.toISOString().split('T')[0];
    };

    const plans = [
      { id: 'PM-1001', asset_id: 'MX-2026-0001', asset_name: 'Haas VF-4SS CNC Machining Center', asset_code: 'MX-2026-0001', title: 'CNC Spindle, Coolant & Way Lube Inspection', frequency: 'Monthly', last_maintenance_date: minusDays(35), next_due_date: minusDays(5), technician_id: 'TECH-101', technician_name: 'Marcus Vance', estimated_cost: 250, checklist: ['Inspect way lube level', 'Check spindle vibration', 'Inspect pneumatic line pressure', 'Test E-stop button', 'Clean chip screens'] },
      { id: 'PM-1002', asset_id: 'MX-2026-0002', asset_name: 'Carrier 120-Ton Rooftop Chiller Unit', asset_code: 'MX-2026-0002', title: 'Chiller Refrigerant & Filter Servicing', frequency: 'Quarterly', last_maintenance_date: minusDays(85), next_due_date: plusDays(5), technician_id: 'TECH-104', technician_name: 'Sarah Jenkins', estimated_cost: 380, checklist: ['Replace air filters', 'Check refrigerant head pressure', 'Inspect blower belt tension', 'Test float switch cutoffs'] },
      { id: 'PM-1003', asset_id: 'MX-2026-0004', asset_name: 'Dell PowerEdge R750 Lab Server', asset_code: 'MX-2026-0004', title: 'Server Chassis De-Dusting & SMART Health Check', frequency: 'Monthly', last_maintenance_date: minusDays(28), next_due_date: plusDays(2), technician_id: 'TECH-103', technician_name: 'David Chen', estimated_cost: 85, checklist: ['Check chassis fans', 'Inspect power supply redundancy', 'Test NVMe drive SMART health', 'Apply firmware updates'] },
      { id: 'PM-1004', asset_id: 'MX-2026-0005', asset_name: 'Toyota 8FBE20 Electric Forklift', asset_code: 'MX-2026-0005', title: 'Forklift Mast, Hydraulic & Brake Inspection', frequency: 'Monthly', last_maintenance_date: minusDays(20), next_due_date: plusDays(10), technician_id: 'TECH-105', technician_name: 'Tomasz Kowalski', estimated_cost: 160, checklist: ['Check mast chain tension', 'Check hydraulic fluid level', 'Test deadman switch', 'Inspect tire wear'] },
      { id: 'PM-1005', asset_id: 'MX-2026-0006', asset_name: 'Schneider Electric Square D 480V Switchgear', asset_code: 'MX-2026-0006', title: 'Thermal Imaging & Contact Resistance Audit', frequency: 'Half-Yearly', last_maintenance_date: minusDays(170), next_due_date: plusDays(10), technician_id: 'TECH-102', technician_name: 'Elena Rostova', estimated_cost: 650, checklist: ['Infrared scan main lugs', 'Inspect ground fault sensors', 'Vacuum busbar compartments', 'Torque critical connections'] },
      { id: 'PM-1006', asset_id: 'MX-2026-0007', asset_name: 'Life Fitness Integrity Series Treadmill #1', asset_code: 'MX-2026-0007', title: 'Treadmill Belt Alignment & Deck Lube', frequency: 'Weekly', last_maintenance_date: minusDays(9), next_due_date: minusDays(2), technician_id: 'TECH-105', technician_name: 'Tomasz Kowalski', estimated_cost: 45, checklist: ['Check belt tracking', 'Apply silicone deck lube', 'Inspect power cord and emergency clip', 'Test speed calibration'] },
      { id: 'PM-1007', asset_id: 'MX-2026-0008', asset_name: 'Agilent 8890 Gas Chromatograph', asset_code: 'MX-2026-0008', title: 'Inlet Septa Replacement & Baseline Leak Check', frequency: 'Monthly', last_maintenance_date: minusDays(32), next_due_date: minusDays(2), technician_id: 'TECH-102', technician_name: 'Elena Rostova', estimated_cost: 140, checklist: ['Replace inlet septum', 'Replace glass liner and O-ring', 'Perform electronic leak test', 'Verify carrier gas flow rates'] },
      { id: 'PM-1008', asset_id: 'MX-2026-0013', asset_name: 'Grundfos CR 32-4 Booster Pump', asset_code: 'MX-2026-0013', title: 'Mechanical Seal & Vibration Audit', frequency: 'Quarterly', last_maintenance_date: minusDays(88), next_due_date: plusDays(2), technician_id: 'TECH-105', technician_name: 'Tomasz Kowalski', estimated_cost: 195, checklist: ['Inspect mechanical seal for weeping', 'Measure vibration on drive coupling', 'Test check valve seating', 'Grease motor bearings'] }
    ];

    for (const p of plans) await db.add(STORES.MAINTENANCE_PLANS, p);

    // 5. Work Orders (12 work orders with various priorities and statuses)
    const workOrders = [
      { id: 'WO-2026-0101', asset_id: 'MX-2026-0003', asset_name: 'Kaeser SK 25 Rotary Screw Compressor', asset_code: 'MX-2026-0003', title: 'Pressure Relief Valve Tripping & Oil Foaming', description: 'Compressor discharges oil mist and drops pressure below 5.0 bar under peak workshop demand.', work_type: 'Emergency Breakdown', priority: 'CRITICAL', status: 'IN PROGRESS', technician_id: 'TECH-101', technician_name: 'Marcus Vance', scheduled_at: today.toISOString().split('T')[0], labor_cost: 150, parts_cost: 165, actual_cost: 315, estimated_cost: 400, used_parts: [{ part_name: 'Kaeser Synthetic Compressor Oil', quantity: 1, unit_cost: 165, total_cost: 165 }] },
      { id: 'WO-2026-0102', asset_id: 'MX-2026-0010', asset_name: 'Canon imageRUNNER ADVANCE DX C5870i', asset_code: 'MX-2026-0010', title: 'Drum Unit Error Code E020 & Severe Paper Jam', description: 'Black drum unit failed calibration cycle. Admin floor cannot produce documentation.', work_type: 'Corrective Repair', priority: 'HIGH', status: 'WAITING FOR PARTS', technician_id: 'TECH-103', technician_name: 'David Chen', scheduled_at: minusDays(1), labor_cost: 0, parts_cost: 0, actual_cost: 0, estimated_cost: 280, used_parts: [] },
      { id: 'WO-2026-0103', asset_id: 'MX-2026-0001', asset_name: 'Haas VF-4SS CNC Machining Center', asset_code: 'MX-2026-0001', title: 'Monthly Spindle Vibration & Tool Changer Audit', description: 'Carried over from PM-1001 overdue schedule.', work_type: 'Preventive Maintenance', priority: 'HIGH', status: 'ASSIGNED', technician_id: 'TECH-101', technician_name: 'Marcus Vance', scheduled_at: plusDays(1), labor_cost: 0, parts_cost: 0, actual_cost: 0, estimated_cost: 250, used_parts: [] },
      { id: 'WO-2026-0104', asset_id: 'MX-2026-0007', asset_name: 'Life Fitness Integrity Series Treadmill #1', asset_code: 'MX-2026-0007', title: 'Weekly Belt Alignment & Lube Service', description: 'Perform scheduled PM and check running deck wear.', work_type: 'Preventive Maintenance', priority: 'MEDIUM', status: 'OPEN', technician_id: null, technician_name: 'Unassigned', scheduled_at: today.toISOString().split('T')[0], labor_cost: 0, parts_cost: 0, actual_cost: 0, estimated_cost: 50, used_parts: [] },
      { id: 'WO-2026-0105', asset_id: 'MX-2026-0002', asset_name: 'Carrier 120-Ton Rooftop Chiller Unit', asset_code: 'MX-2026-0002', title: 'Quarterly Air Filter Replacement & Refrigerant Check', description: 'Routine HVAC quarterly preventive service.', work_type: 'Preventive Maintenance', priority: 'MEDIUM', status: 'ASSIGNED', technician_id: 'TECH-104', technician_name: 'Sarah Jenkins', scheduled_at: plusDays(5), labor_cost: 0, parts_cost: 0, actual_cost: 0, estimated_cost: 380, used_parts: [] },
      { id: 'WO-2026-0106', asset_id: 'MX-2026-0005', asset_name: 'Toyota 8FBE20 Electric Forklift', asset_code: 'MX-2026-0005', title: 'Hydraulic Tilt Cylinder Slow Return', description: 'Operator notes mast tilts backward sluggishly under heavy pallet loads.', work_type: 'Corrective Repair', priority: 'MEDIUM', status: 'OPEN', technician_id: 'TECH-105', technician_name: 'Tomasz Kowalski', scheduled_at: plusDays(3), labor_cost: 0, parts_cost: 0, actual_cost: 0, estimated_cost: 180, used_parts: [] },
      { id: 'WO-2026-0107', asset_id: 'MX-2026-0013', asset_name: 'Grundfos CR 32-4 Booster Pump', asset_code: 'MX-2026-0013', title: 'Pump Packing Weep & Noise Investigation', description: 'Small puddle observed underneath pump base flange.', work_type: 'Corrective Repair', priority: 'HIGH', status: 'IN PROGRESS', technician_id: 'TECH-105', technician_name: 'Tomasz Kowalski', scheduled_at: today.toISOString().split('T')[0], labor_cost: 100, parts_cost: 145, actual_cost: 245, estimated_cost: 250, used_parts: [{ part_name: 'Grundfos Mechanical Shaft Seal HQQE', quantity: 1, unit_cost: 145, total_cost: 145 }] },
      { id: 'WO-2026-0108', asset_id: 'MX-2026-0006', asset_name: 'Schneider Electric Square D 480V Switchgear', asset_code: 'MX-2026-0006', title: 'Substation Feeder Breaker Trip Test', description: 'Semi-annual testing of trip units and shunt release mechanism.', work_type: 'Safety Inspection', priority: 'LOW', status: 'COMPLETED', technician_id: 'TECH-102', technician_name: 'Elena Rostova', scheduled_at: minusDays(12), labor_cost: 240, parts_cost: 0, actual_cost: 240, estimated_cost: 240, completed_at: minusDays(12) },
      { id: 'WO-2026-0109', asset_id: 'MX-2026-0004', asset_name: 'Dell PowerEdge R750 Lab Server', asset_code: 'MX-2026-0004', title: 'Secondary Power Supply Fault Replacement', description: 'Dell iDRAC reported Amber LED on redundant PSU slot 2.', work_type: 'Corrective Repair', priority: 'HIGH', status: 'COMPLETED', technician_id: 'TECH-103', technician_name: 'David Chen', scheduled_at: minusDays(18), labor_cost: 120, parts_cost: 280, actual_cost: 400, estimated_cost: 350, completed_at: minusDays(17) },
      { id: 'WO-2026-0110', asset_id: 'MX-2026-0009', asset_name: 'Miller Dynasty 400 TIG Welder', asset_code: 'MX-2026-0009', title: 'Coolant Flow Sensor Calibration and Torch Flush', description: 'Arc error code indicating low water cooler flow rate.', work_type: 'Corrective Repair', priority: 'MEDIUM', status: 'COMPLETED', technician_id: 'TECH-101', technician_name: 'Marcus Vance', scheduled_at: minusDays(25), labor_cost: 160, parts_cost: 64, actual_cost: 224, estimated_cost: 200, completed_at: minusDays(24) },
      { id: 'WO-2026-0111', asset_id: 'MX-2026-0017', asset_name: 'Genie GS-1930 Scissor Lift', asset_code: 'MX-2026-0017', title: 'Annual ANSI/OSHA Structural & Limit Switch Audit', description: 'Mandatory yearly inspection certificate renewal.', work_type: 'Safety Inspection', priority: 'HIGH', status: 'COMPLETED', technician_id: 'TECH-105', technician_name: 'Tomasz Kowalski', scheduled_at: minusDays(40), labor_cost: 320, parts_cost: 85, actual_cost: 405, estimated_cost: 400, completed_at: minusDays(39) },
      { id: 'WO-2026-0112', asset_id: 'MX-2026-0011', asset_name: 'Bridgeport Series 1 Knee Mill', asset_code: 'MX-2026-0011', title: 'X-Axis Lead Screw Backlash Nut Adjustment', description: 'Table showed 0.015" excessive backlash in dial indicator test.', work_type: 'Corrective Repair', priority: 'LOW', status: 'COMPLETED', technician_id: 'TECH-101', technician_name: 'Marcus Vance', scheduled_at: minusDays(50), labor_cost: 180, parts_cost: 35, actual_cost: 215, estimated_cost: 200, completed_at: minusDays(49) }
    ];

    for (const w of workOrders) await db.add(STORES.WORK_ORDERS, w);

    // 6. Maintenance Records (10 historical repairs with labor and parts breakdown)
    const records = [
      { id: 'REC-2026-301', asset_id: 'MX-2026-0004', asset_name: 'Dell PowerEdge R750 Lab Server', asset_code: 'MX-2026-0004', work_order_id: 'WO-2026-0109', technician_id: 'TECH-103', technician_name: 'David Chen', repair_date: minusDays(17), issue_description: 'Dell iDRAC reported Amber LED on redundant PSU slot 2.', root_cause: 'Internal capacitor dry-out caused voltage fluctuation', work_performed: 'Swapped hot-plug 1400W Titanium PSU unit, verified AC load balance, updated iDRAC logs.', parts_replaced: '1x Dell 1400W Platinum PSU', labour_cost: 120, parts_cost: 280, total_cost: 400, downtime_minutes: 0, completion_status: 'COMPLETED' },
      { id: 'REC-2026-302', asset_id: 'MX-2026-0006', asset_name: 'Schneider Electric Square D 480V Switchgear', asset_code: 'MX-2026-0006', work_order_id: 'WO-2026-0108', technician_id: 'TECH-102', technician_name: 'Elena Rostova', repair_date: minusDays(12), issue_description: 'Semi-annual testing of trip units and shunt release mechanism.', root_cause: 'Routine safety audit compliance', work_performed: 'Secondary current injection testing performed. Trip curves aligned with engineering coordination study.', parts_replaced: 'None', labour_cost: 240, parts_cost: 0, total_cost: 240, downtime_minutes: 45, completion_status: 'COMPLETED' },
      { id: 'REC-2026-303', asset_id: 'MX-2026-0009', asset_name: 'Miller Dynasty 400 TIG Welder', asset_code: 'MX-2026-0009', work_order_id: 'WO-2026-0110', technician_id: 'TECH-101', technician_name: 'Marcus Vance', repair_date: minusDays(24), issue_description: 'Arc error code indicating low water cooler flow rate.', root_cause: 'Contaminated coolant clogged inline radiator filter mesh', work_performed: 'Flushed Coolmate radiator loop with deionized water, cleaned filter screen, replaced 2.4mm collet.', parts_replaced: '2x TIG Torch Collet 2.4mm', labour_cost: 160, parts_cost: 64, total_cost: 224, downtime_minutes: 120, completion_status: 'COMPLETED' },
      { id: 'REC-2026-304', asset_id: 'MX-2026-0017', asset_name: 'Genie GS-1930 Scissor Lift', asset_code: 'MX-2026-0017', work_order_id: 'WO-2026-0111', technician_id: 'TECH-105', technician_name: 'Tomasz Kowalski', repair_date: minusDays(39), issue_description: 'Annual ANSI/OSHA Structural & Limit Switch Audit.', root_cause: 'Scheduled annual safety certification', work_performed: 'Pressure relief tested at 2500 PSI, pothole guard interlocks checked, emergency lowering valve exercised.', parts_replaced: '1x Hydraulic Fluid ISO VG 46 (20L)', labour_cost: 320, parts_cost: 85, total_cost: 405, downtime_minutes: 180, completion_status: 'COMPLETED' },
      { id: 'REC-2026-305', asset_id: 'MX-2026-0011', asset_name: 'Bridgeport Series 1 Knee Mill', asset_code: 'MX-2026-0011', work_order_id: 'WO-2026-0112', technician_id: 'TECH-101', technician_name: 'Marcus Vance', repair_date: minusDays(49), issue_description: 'Table showed 0.015" excessive backlash in dial indicator test.', root_cause: 'Bronze split nut wear on X-axis acme screw', work_performed: 'Preload adjustment screw tightened on split nut assembly; reduced backlash to under 0.003".', parts_replaced: '1x Bronze Nut Spacer', labour_cost: 180, parts_cost: 35, total_cost: 215, downtime_minutes: 240, completion_status: 'COMPLETED' },
      { id: 'REC-2026-306', asset_id: 'MX-2026-0001', asset_name: 'Haas VF-4SS CNC Machining Center', asset_code: 'MX-2026-0001', work_order_id: null, technician_id: 'TECH-101', technician_name: 'Marcus Vance', repair_date: minusDays(65), issue_description: 'Preventive Maintenance: Quarterly Precision Axis Calibration', root_cause: 'Scheduled preventive servicing', work_performed: 'Checked way lube dosing, cleaned way covers, verified drawbar force gauge reading (2400 lbs).', parts_replaced: 'Way lube oil, coolant filters', labour_cost: 200, parts_cost: 75, total_cost: 275, downtime_minutes: 90, completion_status: 'COMPLETED' },
      { id: 'REC-2026-307', asset_id: 'MX-2026-0002', asset_name: 'Carrier 120-Ton Rooftop Chiller Unit', asset_code: 'MX-2026-0002', work_order_id: null, technician_id: 'TECH-104', technician_name: 'Sarah Jenkins', repair_date: minusDays(85), issue_description: 'Quarterly Air Filter & Chilled Water Loop Check', root_cause: 'Scheduled seasonal maintenance', work_performed: 'Swapped all primary MERV 13 intake filters, verified condenser fan motor amps and superheat values.', parts_replaced: '6x Pleated MERV 13 Filters', labour_cost: 220, parts_cost: 135, total_cost: 355, downtime_minutes: 60, completion_status: 'COMPLETED' },
      { id: 'REC-2026-308', asset_id: 'MX-2026-0007', asset_name: 'Life Fitness Integrity Series Treadmill #1', asset_code: 'MX-2026-0007', work_order_id: null, technician_id: 'TECH-105', technician_name: 'Tomasz Kowalski', repair_date: minusDays(15), issue_description: 'Treadmill Squeaking & Belt Slippage', root_cause: 'Drive roller bearing dust contamination', work_performed: 'Cleaned front roller bearing assembly, applied synthetic silicone deck lube, adjusted rear tension bolts.', parts_replaced: '1x Silicone Lube Spray', labour_cost: 75, parts_cost: 15, total_cost: 90, downtime_minutes: 45, completion_status: 'COMPLETED' },
      { id: 'REC-2026-309', asset_id: 'MX-2026-0005', asset_name: 'Toyota 8FBE20 Electric Forklift', asset_code: 'MX-2026-0005', work_order_id: null, technician_id: 'TECH-105', technician_name: 'Tomasz Kowalski', repair_date: minusDays(35), issue_description: 'Battery Watering & Terminal Oxidation Clean', root_cause: 'Lead-acid industrial battery routine maintenance', work_performed: 'Equalization charge performed, topped up cells with distilled water, applied anti-corrosion terminal sealant.', parts_replaced: 'Terminal pads and seal', labour_cost: 90, parts_cost: 20, total_cost: 110, downtime_minutes: 120, completion_status: 'COMPLETED' },
      { id: 'REC-2026-310', asset_id: 'MX-2026-0008', asset_name: 'Agilent 8890 Gas Chromatograph', asset_code: 'MX-2026-0008', work_order_id: null, technician_id: 'TECH-102', technician_name: 'Elena Rostova', repair_date: minusDays(32), issue_description: 'Monthly QA Metrology Verification', root_cause: 'Scheduled analytical calibration', work_performed: 'Inlet septum replaced, split vent trap inspected, test hydrocarbon mix run showed 99.8% recovery.', parts_replaced: '1x Agilent Septa Pack', labour_cost: 140, parts_cost: 95, total_cost: 235, downtime_minutes: 60, completion_status: 'COMPLETED' }
    ];

    for (const r of records) await db.add(STORES.MAINTENANCE_RECORDS, r);

    // 7. Downtime Events (Outages, availability calculations)
    const downtimeEvents = [
      { id: 'DWT-2026-501', asset_id: 'MX-2026-0003', asset_name: 'Kaeser SK 25 Rotary Screw Compressor', asset_code: 'MX-2026-0003', category: 'Industrial Machinery', work_order_id: 'WO-2026-0101', reason: 'Mechanical Breakdown', started_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), ended_at: null, duration_minutes: 240, notes: 'Ongoing compressor outage affecting production pneumatic tools.' },
      { id: 'DWT-2026-502', asset_id: 'MX-2026-0010', asset_name: 'Canon imageRUNNER ADVANCE DX C5870i', asset_code: 'MX-2026-0010', category: 'Office Equipment', work_order_id: 'WO-2026-0102', reason: 'Awaiting Spare Parts', started_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(), ended_at: null, duration_minutes: 1560, notes: 'Awaiting Canon replacement drum unit delivery.' },
      { id: 'DWT-2026-503', asset_id: 'MX-2026-0009', asset_name: 'Miller Dynasty 400 TIG Welder', asset_code: 'MX-2026-0009', category: 'Tools & Instruments', work_order_id: 'WO-2026-0110', reason: 'Component Wear & Tear', started_at: minusDays(24) + 'T08:30:00Z', ended_at: minusDays(24) + 'T10:30:00Z', duration_minutes: 120, notes: 'Coolant loop flushed and tested operational.' },
      { id: 'DWT-2026-504', asset_id: 'MX-2026-0011', asset_name: 'Bridgeport Series 1 Knee Mill', asset_code: 'MX-2026-0011', category: 'Industrial Machinery', work_order_id: 'WO-2026-0112', reason: 'Mechanical Breakdown', started_at: minusDays(49) + 'T11:00:00Z', ended_at: minusDays(49) + 'T15:00:00Z', duration_minutes: 240, notes: 'Lead screw bronze nut adjusted.' },
      { id: 'DWT-2026-505', asset_id: 'MX-2026-0017', asset_name: 'Genie GS-1930 Scissor Lift', asset_code: 'MX-2026-0017', category: 'Vehicles', work_order_id: 'WO-2026-0111', reason: 'Scheduled Major Overhaul', started_at: minusDays(39) + 'T09:00:00Z', ended_at: minusDays(39) + 'T12:00:00Z', duration_minutes: 180, notes: 'Mandatory annual OSHA safety proof load test.' }
    ];

    for (const d of downtimeEvents) await db.add(STORES.DOWNTIME_EVENTS, d);

    // Initial audit log entry
    await authRBAC.log({
      action: 'DEMO_WORKSPACE_LOAD',
      entityType: 'WORKSPACE',
      entityId: 'DEMO_SEED',
      details: 'Loaded realistic industrial demo CMMS dataset (20 assets, 5 techs, 12 WOs, 8 plans, 15 parts, 10 records).'
    });

    await notifications.evaluateAlertRules();
    await notifications.updateUnreadCount();

    ui.showToast('Demo workspace successfully populated with 20 equipment assets!', 'success', 4000);
    return true;
  }
}

export const backupManager = new BackupManager();
