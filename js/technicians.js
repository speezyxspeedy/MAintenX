/**
 * MaintenX Technician Directory Module
 * Management of in-house engineers, specialist contractors, availability, and task workloads.
 */

import { db, STORES } from './database.js';
import { ui } from './ui.js';
import { authRBAC, PERMISSIONS } from './auth-rbac.js';

export const SPECIALIZATIONS = [
  'Electrical',
  'Mechanical',
  'IT Support',
  'HVAC',
  'Plumbing',
  'General Maintenance'
];

export const AVAILABILITY_STATUSES = [
  'AVAILABLE',
  'ON JOB',
  'ON LEAVE',
  'OFF DUTY'
];

class TechnicianManager {
  constructor() {
    this.searchQuery = '';
    this.currentSpecialization = 'ALL';
  }

  async getAllTechnicians() {
    return await db.getAll(STORES.TECHNICIANS);
  }

  async getFilteredTechnicians() {
    let techs = await this.getAllTechnicians();

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase().trim();
      techs = techs.filter(t =>
        (t.name && t.name.toLowerCase().includes(q)) ||
        (t.specialization && t.specialization.toLowerCase().includes(q)) ||
        (t.skills && t.skills.toLowerCase().includes(q)) ||
        (t.contact && t.contact.toLowerCase().includes(q))
      );
    }

    if (this.currentSpecialization !== 'ALL') {
      techs = techs.filter(t => t.specialization === this.currentSpecialization);
    }

    return techs;
  }

  async getTechnicianWithStats(id) {
    const tech = await db.getById(STORES.TECHNICIANS, id);
    if (!tech) return null;

    const allWorkOrders = await db.getAll(STORES.WORK_ORDERS);
    const assignedOrders = allWorkOrders.filter(w => w.technician_id === id);
    const completedOrders = assignedOrders.filter(w => w.status === 'COMPLETED');
    const openOrders = assignedOrders.filter(w => w.status !== 'COMPLETED' && w.status !== 'CANCELLED');

    return {
      technician: tech,
      assignedCount: assignedOrders.length,
      completedCount: completedOrders.length,
      openCount: openOrders.length,
      assignedOrders,
      completedOrders
    };
  }

  async saveTechnician(formData, existingId = null) {
    if (!authRBAC.can(PERMISSIONS.TECHNICIAN_MANAGE)) {
      ui.showToast('Access denied: You lack permission to manage technicians.', 'danger');
      return null;
    }

    if (existingId) {
      const existing = await db.getById(STORES.TECHNICIANS, existingId);
      if (!existing) throw new Error('Technician not found');

      const updated = {
        ...existing,
        ...formData,
        id: existingId,
        updated_at: new Date().toISOString()
      };
      await db.update(STORES.TECHNICIANS, updated);
      await authRBAC.log({
        action: 'TECHNICIAN_UPDATE',
        entityType: 'TECHNICIAN',
        entityId: existingId,
        details: `Updated technician "${updated.name}" (${updated.specialization})`
      });
      ui.showToast(`Technician "${updated.name}" updated.`, 'success');
      return updated;
    } else {
      const newId = db.generateId(STORES.TECHNICIANS);
      const newTech = {
        id: newId,
        ...formData,
        availability: formData.availability || 'AVAILABLE',
        created_at: new Date().toISOString()
      };
      await db.add(STORES.TECHNICIANS, newTech);
      await authRBAC.log({
        action: 'TECHNICIAN_CREATE',
        entityType: 'TECHNICIAN',
        entityId: newId,
        details: `Added new technician "${newTech.name}" with specialization ${newTech.specialization}`
      });
      ui.showToast(`Technician "${newTech.name}" added to directory.`, 'success');
      return newTech;
    }
  }

  async deleteTechnician(id) {
    if (!authRBAC.can(PERMISSIONS.TECHNICIAN_MANAGE)) {
      ui.showToast('Access denied: You lack permission to delete technicians.', 'danger');
      return false;
    }

    const tech = await db.getById(STORES.TECHNICIANS, id);
    if (!tech) return false;

    const confirmed = await ui.confirmDialog({
      title: 'Remove Technician',
      message: `Are you sure you want to remove "${tech.name}" from the technician directory?`,
      confirmText: 'Remove',
      isDanger: true
    });

    if (confirmed) {
      await db.delete(STORES.TECHNICIANS, id);
      await authRBAC.log({
        action: 'TECHNICIAN_DELETE',
        entityType: 'TECHNICIAN',
        entityId: id,
        details: `Removed technician "${tech.name}"`
      });
      ui.showToast(`Technician "${tech.name}" removed.`, 'info');
      return true;
    }
    return false;
  }
}

export const technicianDirectory = new TechnicianManager();
