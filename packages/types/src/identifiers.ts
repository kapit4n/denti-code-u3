/**
 * Branded identifier types.
 *
 * A `PatientId` and an `AppointmentId` are both strings at runtime; branding them
 * makes mixing them a compile-time error instead of a runtime bug that only
 * shows up in production. `asPatientId(...)` is the single, explicit way to
 * obtain one.
 */

declare const brand: unique symbol;

/** Nominal typing helper: `Brand<string, 'PatientId'>`. */
export type Brand<TValue, TBrand extends string> = TValue & {
  readonly [brand]: TBrand;
};

export type ClinicId = Brand<string, 'ClinicId'>;
export type UserId = Brand<string, 'UserId'>;
export type StaffId = Brand<string, 'StaffId'>;
export type DentistId = Brand<string, 'DentistId'>;
export type RoomId = Brand<string, 'RoomId'>;
export type ChairId = Brand<string, 'ChairId'>;
export type PatientId = Brand<string, 'PatientId'>;
export type AppointmentId = Brand<string, 'AppointmentId'>;
export type VisitId = Brand<string, 'VisitId'>;
export type TreatmentId = Brand<string, 'TreatmentId'>;
export type TreatmentPlanId = Brand<string, 'TreatmentPlanId'>;
export type PrescriptionId = Brand<string, 'PrescriptionId'>;
export type InvoiceId = Brand<string, 'InvoiceId'>;
export type PaymentId = Brand<string, 'PaymentId'>;
export type InventoryItemId = Brand<string, 'InventoryItemId'>;
export type ClinicalNoteId = Brand<string, 'ClinicalNoteId'>;

/** Every identifier the clinic domain uses. */
export type ClinicIdentifier =
  | ClinicId
  | UserId
  | StaffId
  | DentistId
  | RoomId
  | ChairId
  | PatientId
  | AppointmentId
  | VisitId
  | TreatmentId
  | TreatmentPlanId
  | PrescriptionId
  | InvoiceId
  | PaymentId
  | InventoryItemId
  | ClinicalNoteId;

export const asClinicId = (value: string): ClinicId => value as ClinicId;
export const asUserId = (value: string): UserId => value as UserId;
export const asStaffId = (value: string): StaffId => value as StaffId;
export const asDentistId = (value: string): DentistId => value as DentistId;
export const asRoomId = (value: string): RoomId => value as RoomId;
export const asChairId = (value: string): ChairId => value as ChairId;
export const asPatientId = (value: string): PatientId => value as PatientId;
export const asAppointmentId = (value: string): AppointmentId => value as AppointmentId;
export const asVisitId = (value: string): VisitId => value as VisitId;
export const asTreatmentId = (value: string): TreatmentId => value as TreatmentId;
export const asTreatmentPlanId = (value: string): TreatmentPlanId => value as TreatmentPlanId;
export const asPrescriptionId = (value: string): PrescriptionId => value as PrescriptionId;
export const asInvoiceId = (value: string): InvoiceId => value as InvoiceId;
export const asPaymentId = (value: string): PaymentId => value as PaymentId;
export const asInventoryItemId = (value: string): InventoryItemId => value as InventoryItemId;
export const asClinicalNoteId = (value: string): ClinicalNoteId => value as ClinicalNoteId;
