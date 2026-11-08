/**
 * MaintenX Maintenance Scheduler Engine
 * Frequency math, due status calculation, next cycle projection, and calendar view matrix.
 */

export const FREQUENCIES = [
  'Daily',
  'Weekly',
  'Monthly',
  'Quarterly',
  'Half-Yearly',
  'Yearly',
  'Custom Interval'
];

export class SchedulerEngine {
  /**
   * Projects next maintenance date based on frequency from a base date
   */
  static calculateNextDate(baseDateStr, frequency, customDays = 30) {
    const base = baseDateStr ? new Date(baseDateStr) : new Date();
    if (isNaN(base.getTime())) return new Date().toISOString().split('T')[0];

    const next = new Date(base.getTime());

    switch (frequency) {
      case 'Daily':
        next.setDate(next.getDate() + 1);
        break;
      case 'Weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'Monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'Quarterly':
        next.setMonth(next.getMonth() + 3);
        break;
      case 'Half-Yearly':
        next.setMonth(next.getMonth() + 6);
        break;
      case 'Yearly':
        next.setFullYear(next.getFullYear() + 1);
        break;
      case 'Custom Interval':
        next.setDate(next.getDate() + (Number(customDays) || 30));
        break;
      default:
        next.setMonth(next.getMonth() + 1);
        break;
    }

    return next.toISOString().split('T')[0];
  }

  /**
   * Evaluates due state: 'OVERDUE' | 'DUE TODAY' | 'DUE SOON' | 'UP TO DATE'
   */
  static evaluateDueStatus(nextDueDateStr, warningDays = 7) {
    if (!nextDueDateStr) return { status: 'UP TO DATE', badgeClass: 'badge-operational', diffDays: 0 };

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const due = new Date(nextDueDateStr);
    due.setHours(0, 0, 0, 0);

    const diffMs = due.getTime() - now.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        status: 'OVERDUE',
        badgeClass: 'badge-overdue',
        diffDays,
        label: `${Math.abs(diffDays)}d Overdue`
      };
    } else if (diffDays === 0) {
      return {
        status: 'DUE TODAY',
        badgeClass: 'badge-due-soon',
        diffDays: 0,
        label: 'Due Today'
      };
    } else if (diffDays <= warningDays) {
      return {
        status: 'DUE SOON',
        badgeClass: 'badge-due-soon',
        diffDays,
        label: `Due in ${diffDays}d`
      };
    } else {
      return {
        status: 'UP TO DATE',
        badgeClass: 'badge-operational',
        diffDays,
        label: `In ${diffDays}d`
      };
    }
  }

  /**
   * Generates calendar days matrix for a given year & month (0-indexed month)
   */
  static getMonthMatrix(year, month) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const startingDayOfWeek = firstDay.getDay(); // 0 (Sun) to 6 (Sat)
    const totalDays = lastDay.getDate();

    const matrix = [];
    let currentWeek = [];

    // Previous month padding
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthLastDay - i;
      const d = new Date(year, month - 1, dayNum);
      currentWeek.push({
        date: d.toISOString().split('T')[0],
        dayNumber: dayNum,
        isCurrentMonth: false
      });
    }

    // Current month days
    for (let day = 1; day <= totalDays; day++) {
      const d = new Date(year, month, day);
      currentWeek.push({
        date: d.toISOString().split('T')[0],
        dayNumber: day,
        isCurrentMonth: true
      });

      if (currentWeek.length === 7) {
        matrix.push(currentWeek);
        currentWeek = [];
      }
    }

    // Next month padding
    if (currentWeek.length > 0) {
      let nextDay = 1;
      while (currentWeek.length < 7) {
        const d = new Date(year, month + 1, nextDay);
        currentWeek.push({
          date: d.toISOString().split('T')[0],
          dayNumber: nextDay,
          isCurrentMonth: false
        });
        nextDay++;
      }
      matrix.push(currentWeek);
    }

    return matrix;
  }
}
