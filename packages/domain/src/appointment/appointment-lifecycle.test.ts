import { describe, expect, it } from 'vitest';
import {
  allowedAppointmentTransitions,
  assertAppointmentTransition,
  canTransitionAppointment,
  isScheduleEditable,
  isTerminalAppointmentStatus,
  occupiesChairTime,
} from './appointment-lifecycle.js';
import { DomainError } from '../shared/errors.js';

describe('appointment lifecycle', () => {
  describe('allowed transitions', () => {
    it('allows the patient to progress from scheduled through in-treatment to completed', () => {
      expect(canTransitionAppointment('SCHEDULED', 'CONFIRMED')).toBe(true);
      expect(canTransitionAppointment('CONFIRMED', 'ARRIVED')).toBe(true);
      expect(canTransitionAppointment('ARRIVED', 'IN_TREATMENT')).toBe(true);
      expect(canTransitionAppointment('IN_TREATMENT', 'COMPLETED')).toBe(true);
    });

    it('allows a scheduled appointment to be cancelled or marked as no-show', () => {
      expect(canTransitionAppointment('SCHEDULED', 'CANCELLED')).toBe(true);
      expect(canTransitionAppointment('SCHEDULED', 'NO_SHOW')).toBe(true);
    });

    it('forbids arriving at a clinic that has not started the appointment', () => {
      expect(canTransitionAppointment('SCHEDULED', 'IN_TREATMENT')).toBe(false);
      expect(canTransitionAppointment('SCHEDULED', 'COMPLETED')).toBe(false);
    });

    it('treats a completed appointment as terminal', () => {
      expect(allowedAppointmentTransitions('COMPLETED')).toEqual([]);
      expect(canTransitionAppointment('COMPLETED', 'CANCELLED')).toBe(false);
      expect(canTransitionAppointment('COMPLETED', 'IN_TREATMENT')).toBe(false);
    });

    it('allows re-booking a cancelled or no-show appointment as scheduled', () => {
      expect(canTransitionAppointment('CANCELLED', 'SCHEDULED')).toBe(true);
      expect(canTransitionAppointment('NO_SHOW', 'SCHEDULED')).toBe(true);
    });

    it('does not allow a completed appointment to be cancelled', () => {
      expect(canTransitionAppointment('COMPLETED', 'CANCELLED')).toBe(false);
    });
  });

  describe('assertAppointmentTransition', () => {
    it('accepts a legal transition', () => {
      expect(() => assertAppointmentTransition('SCHEDULED', 'CONFIRMED')).not.toThrow();
    });

    it('throws a DomainError with a stable code on an illegal transition', () => {
      expect(() => assertAppointmentTransition('COMPLETED', 'ARRIVED')).toThrow(DomainError);

      try {
        assertAppointmentTransition('COMPLETED', 'ARRIVED');
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe('ILLEGAL_TRANSITION');
        expect((error as DomainError).details).toMatchObject({
          entity: 'Appointment',
          from: 'COMPLETED',
          to: 'ARRIVED',
        });
      }
    });
  });

  describe('terminal status', () => {
    it('marks completed as terminal and cancelled/no-show as re-bookable', () => {
      expect(isTerminalAppointmentStatus('COMPLETED')).toBe(true);
      expect(isTerminalAppointmentStatus('CANCELLED')).toBe(false);
      expect(isTerminalAppointmentStatus('NO_SHOW')).toBe(false);
      expect(isTerminalAppointmentStatus('SCHEDULED')).toBe(false);
    });
  });

  describe('schedule editability', () => {
    it('allows rescheduling only before the patient arrives', () => {
      expect(isScheduleEditable('SCHEDULED')).toBe(true);
      expect(isScheduleEditable('CONFIRMED')).toBe(true);
      expect(isScheduleEditable('ARRIVED')).toBe(false);
      expect(isScheduleEditable('IN_TREATMENT')).toBe(false);
      expect(isScheduleEditable('COMPLETED')).toBe(false);
    });
  });

  describe('chair occupancy', () => {
    it('counts only statuses that consume chair time', () => {
      expect(occupiesChairTime('ARRIVED')).toBe(true);
      expect(occupiesChairTime('IN_TREATMENT')).toBe(true);
      expect(occupiesChairTime('COMPLETED')).toBe(true);
      expect(occupiesChairTime('SCHEDULED')).toBe(false);
      expect(occupiesChairTime('CONFIRMED')).toBe(false);
      expect(occupiesChairTime('CANCELLED')).toBe(false);
      expect(occupiesChairTime('NO_SHOW')).toBe(false);
    });
  });
});
