/**
 * Visits: starting one, closing one, reading one.
 *
 * This route is parsing and nothing else, which is the arrangement ADR 0011 fixed for
 * the calendar and ADR 0018 for the appointment writes: the rules live in
 * `packages/domain` as use cases, so the web app, the desktop app and any future
 * client get the same answer, and what arrives here from them is a `DomainError` that
 * `sendProblem` turns into a status a person can act on.
 *
 * **There are two creation doors, and they are two endpoints rather than one body
 * with a branch in it** (ADR 0024):
 *
 *  - `POST /api/v1/visits` takes an `appointmentId` and nothing else about the
 *    appointment — no patient, no dentist, no chair, no time. Those are read from the
 *    booking, so there is no request that can produce a visit disagreeing with the
 *    appointment it came from. A body that could restate them would be a body that
 *    could restate them wrongly, and the clinical record would then be evidence of
 *    something that did not happen (ADR 0021).
 *  - `POST /api/v1/visits/walk-in` takes a patient and a clinician instead, because
 *    there is no booking to read them from. Separate, so each endpoint validates
 *    exactly what it accepts and neither can be handed half of the other's shape.
 *
 * **No `clinicId` in either body.** It comes from the request scope: a client that
 * could choose its own clinic would be a cross-tenant write (ADR 0014).
 *
 * What the appointment door answers with is the visit *and* the appointment as the
 * database now holds them, because the caller almost always has both in view — the
 * agenda is showing the booking while the clinician starts the visit — and answering
 * with only one of them would leave the other to be guessed at. The walk-in answers
 * with the visit alone: there is no second row, so the wrapper would be a shape with
 * one field in it.
 *
 * **The notes, the treatment records and the prescriptions are here rather than in
 * files of their own** because none of them has an address but these: each belongs to
 * a visit, each table has no clinic of its own, and `GET /visits/:visitId/notes`,
 * `GET /visits/:visitId/treatments` and `GET /visits/:visitId/prescriptions` say whose
 * these are without a query parameter. One route, one subject (ADR 0023).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type {
  ChairRepository,
  ChargeRepository,
  ClinicalNoteRepository,
  ClinicRepository,
  Clock,
  DentistRepository,
  IdGenerator,
  PaymentRepository,
  PrescriptionRepository,
  TreatmentRecordRepository,
  TreatmentRepository,
  UnitOfWork,
  VisitAttachmentRepository,
} from '@denti-code-u3/domain';
import {
  addClinicalNote,
  addVisitAttachment,
  addVisitCharge,
  addVisitPrescription,
  completeVisitRecord,
  getVisit,
  listClinicalNotes,
  listTreatmentRecords,
  listVisitAttachments,
  listVisitCharges,
  listVisitPayments,
  listVisitPrescriptions,
  listVisitsForPatient,
  payVisitCharges,
  recordVisitTreatment,
  reopenVisitRecord,
  startVisit,
  startWalkInVisit,
  type VisitRepository,
} from '@denti-code-u3/domain';
import {
  createChargeSchema,
  createClinicalNoteSchema,
  createPaymentSchema,
  createPrescriptionSchema,
  createVisitAttachmentSchema,
  recordVisitTreatmentSchema,
  startVisitSchema,
  startWalkInVisitSchema,
  uuidSchema,
} from '@denti-code-u3/validation';
import {
  asAppointmentId,
  asChairId,
  asChargeId,
  asClinicalNoteId,
  asDentistId,
  asInvoiceId,
  asPatientId,
  asPaymentId,
  asPrescriptionId,
  asTreatmentId,
  asVisitAttachmentId,
  asVisitId,
  asVisitTreatmentExecutionId,
  type ClinicId,
  type PatientId,
  type VisitId,
} from '@denti-code-u3/types';

import { sendProblem } from '../problem.js';

export interface VisitsDependencies {
  /**
   * The transaction the bridge runs in.
   *
   * Required, and there is no non-transactional alternative wired anywhere: starting a
   * visit from a booking writes two rows, and a route that could be given repositories
   * directly would be one refactor away from writing them separately (ADR 0021). The
   * walk-in does not use it, because it writes one row and there is nothing to make
   * atomic — the same reason the two closing endpoints are handed the repository.
   */
  readonly unitOfWork: UnitOfWork;

  /**
   * The plain repository the walk-in and the two closing endpoints use.
   *
   * A repository here and a transaction there is not an inconsistency: `startVisit`
   * writes a visit *and* an appointment, and each of the others writes one row whose
   * status and end time travel in the same statement. Giving all of them the same shape
   * would mean either wrapping one statement in a transaction nobody needs or, worse,
   * handing the two-row operation a plain repository and losing the guarantee that made
   * it atomic in the first place (ADR 0022).
   */
  readonly visits: VisitRepository;

  /**
   * The notes written on a visit.
   *
   * A repository rather than the transaction, for the same reason the closures get
   * one: filing a note writes one row, and a `UnitOfWork` around a single insert is
   * ceremony. What makes it *safe* as a plain repository is the use case's read — it
   * resolves the visit in this clinic before anything is written, and `clinical_notes`
   * has no clinic column of its own to check against (ADR 0014).
   */
  readonly clinicalNotes: ClinicalNoteRepository;

  /**
   * The files attached to a visit.
   *
   * A plain repository rather than the transaction, for the same reason the notes
   * are: attaching a file writes one row, the use case reads the visit in this
   * clinic before the insert, and `visit_attachments` has no clinic column of its
   * own to check against (ADR 0014).
   */
  readonly attachments: VisitAttachmentRepository;

  /**
   * The treatment records written on a visit, and the catalogue they name.
   *
   * Both are plain repositories rather than the transaction, for the same reason the
   * notes are: the use case reads the visit and the treatment in this clinic before it
   * writes, so each write is one row guarded by a read-then-write pair of statements
   * (ADR 0014). That is safe for a record the way it is safe for a note — nothing about
   * the pair needs atomicity a transaction could buy.
   */
  readonly treatmentRecords: TreatmentRecordRepository;
  readonly treatments: TreatmentRepository;

  /**
   * The prescriptions written on a visit.
   *
   * A plain repository rather than the transaction, for the same reason the notes are:
   * prescribing writes one row, the use case reads the visit in this clinic before the
   * insert, and `prescriptions` has no clinic column of its own to check against
   * (ADR 0014).
   */
  readonly prescriptions: PrescriptionRepository;

  /**
   * The charges raised on a visit.
   *
   * A plain repository rather than the transaction, for the same reason the notes
   * are: raising a charge writes one row, and the use case reads the visit in this
   * clinic before the insert. Unlike its clinical siblings, the charge carries its
   * own `clinic_id`, so the read side scopes on that column rather than through the
   * visit — but the visit is still read first, because a foreign visit's charges are
   * not this clinic's to list (ADR 0014).
   */
  readonly charges: ChargeRepository;

  /**
   * Money received against a visit's bill.
   *
   * A plain repository is *not* enough for the write: a settlement raises an
   * invoice, records the payment, allocates it and stamps the charges — four
   * rows the moment they must become one, so `POST /payments` goes through the
   * same `unitOfWork` the bridge does, and reading it doesn't. The register
   * read is a four-table join scoped by the visit, and it is handed a plain
   * repository for the same reason the charges read is (ADR 0014). The
   * currency, the patient and the clinic are the visit's and the clinic's own —
   * nothing about a settlement is the caller's to say except the method, the
   * amount and an optional reference.
   */
  readonly payments: PaymentRepository;

  /**
   * The clinic's own record, whose currency a price is denominated in.
   *
   * A new charge is not complete until its currency is known, and nothing else in the
   * request or the visit can say what it is. The repository read here has one job:
   * the clinic exists (it must — the visit's own tenancy proves it), and the currency
   * the row is priced in comes from the clinic's record, never from the caller.
   */
  readonly clinics: ClinicRepository;

  /**
   * The two resources a walk-in names, because there is no booking to name them from.
   *
   * Required rather than optional for the same reason the appointment routes require
   * theirs (ADR 0020): a door that could be wired without them is a door where the
   * "who may be named" rule silently does not run. The appointment door does not need
   * them — it reads the booking's names and does not re-check them, because the
   * treatment happened under whoever the booking said.
   */
  readonly dentists: DentistRepository;
  readonly chairs: ChairRepository;

  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export async function registerVisitsRoutes(
  app: FastifyInstance,
  {
    unitOfWork,
    visits,
    clinicalNotes,
    attachments,
    treatmentRecords,
    treatments,
    prescriptions,
    charges,
    payments,
    clinics,
    dentists,
    chairs,
    clock,
    ids,
  }: VisitsDependencies,
): Promise<void> {
  /**
   * `POST /api/v1/visits` — start a visit from an appointment.
   *
   * 201 with the visit and its appointment, so a client can put both on screen without
   * guessing the visit's start time or re-fetching the booking to learn its new status.
   *
   * 409 when the appointment already has a visit, which is the one answer here that
   * arrives from the database rather than from the domain: two clinicians pressing the
   * same button at the same moment both pass the domain's check, and the unique index
   * is the only place they were ever both visible.
   */
  app.post('/api/v1/visits', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const parsed = startVisitSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendInvalidBody(reply, request, 'The visit could not be started', parsed.error);
    }

    try {
      const started = await startVisit(clinicId, asAppointmentId(parsed.data.appointmentId), {
        unitOfWork,
        clock,
        newId: () => asVisitId(ids.nextId()),
      });

      return reply.status(201).send(started);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `POST /api/v1/visits/walk-in` — start a visit for a patient who arrived with no
   * booking (ADR 0024).
   *
   * 201 with the visit: one row, so the answer is the row rather than a wrapper around
   * it — which is what the two closing endpoints answer with too.
   *
   * 409 for a clinician or chair marked inactive, the same refusal a booking gets and
   * for the same reason: the request names a resource for care that is about to
   * happen, and product question 17 answered that an inactive one may not be named.
   *
   * 422 for a patient, clinician or chair this clinic does not hold. That answer comes
   * from the composite tenant foreign keys, translated by the repository — the walk-in
   * does not read the patient first, exactly as the booking does not (ADR 0014), and
   * without the translation the same refusal would arrive as a 500.
   *
   * **No appointment is created**, so nothing appears on the agenda and the dashboard's
   * `inTreatment` total does not grow: both read the book, and a walk-in is not in it.
   * The patient's timeline and profile are where this record shows up.
   */
  app.post('/api/v1/visits/walk-in', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const parsed = startWalkInVisitSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendInvalidBody(
        reply,
        request,
        'The walk-in visit could not be started',
        parsed.error,
      );
    }

    try {
      const visit = await startWalkInVisit(
        clinicId,
        {
          patientId: asPatientId(parsed.data.patientId),
          dentistId: asDentistId(parsed.data.dentistId),
          ...(parsed.data.chairId ? { chairId: asChairId(parsed.data.chairId) } : {}),
        },
        {
          visits,
          dentists,
          chairs,
          clock,
          newId: () => asVisitId(ids.nextId()),
        },
      );

      return reply.status(201).send(visit);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `POST /api/v1/visits/:visitId/complete` — the clinician finished with the patient.
   *
   * 200 with the visit as it now stands, including the end time the clock produced. The
   * body is empty in both directions: nothing about the visit is the caller's to say,
   * and the end time is a fact the server is the only party that can know.
   *
   * **A second endpoint rather than a status body**, because completing and reopening
   * are not two values of one field — completing sets `endedAt` and reopening clears it
   * — and because a single `POST /visits/:id/status` would also accept `CANCELLED`, whose
   * rule exists in the transition table with no use case and no door behind it
   * (ADR 0022).
   *
   * **The appointment is not touched.** The booking is completed through its own
   * endpoint, and until the front desk does that the agenda still reads `IN_TREATMENT`.
   * That is a decision with a price, and the test in `visits.integration.test.ts` says
   * so beside the assertion.
   */
  app.post('/api/v1/visits/:visitId/complete', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    try {
      const completed = await completeVisitRecord(path.clinicId, path.visitId, {
        visits,
        clock,
      });

      return reply.status(200).send(completed);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `POST /api/v1/visits/:visitId/reopen` — amend a closed visit.
   *
   * 200 with the visit as it now stands: open again, and with no end time, because a
   * status and an end time that disagree would tell the patient profile two stories
   * about the same row.
   *
   * **Nothing records that this happened** beyond the row's `updated_at`, and that is
   * deliberate rather than an omission to be fixed quietly: an audit trail records who,
   * and there is no user model to record. The roadmap's "(audited)" is deferred with the
   * open question that says what would be needed (ADR 0022).
   */
  app.post('/api/v1/visits/:visitId/reopen', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    try {
      const reopened = await reopenVisitRecord(path.clinicId, path.visitId, { visits, clock });

      return reply.status(200).send(reopened);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `GET /api/v1/visits/:visitId` — one visit.
   *
   * 404 for an id this clinic does not hold, which is also the answer for an id that is
   * nowhere: `findById` cannot tell them apart and must not (ADR 0014).
   *
   * **No filterable collection.** Not `GET /visits?from=&to=&dentistIds=`, because no
   * question about visits is answered by a window and a set of filters — a visit is a
   * clinical record with no schedule (ADR 0023).
   */
  app.get('/api/v1/visits/:visitId', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    try {
      const visit = await getVisit(path.clinicId, path.visitId, { visits });

      return reply.status(200).send(visit);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `GET /api/v1/visits/:visitId/notes` — what the clinician wrote on this visit.
   *
   * 200 with `{ notes: [...] }`, oldest first, and `[]` for a visit that holds none.
   *
   * **404 for a visit this clinic does not hold, and that is the whole reason the
   * use case reads the visit first.** `clinical_notes` has no clinic column, so a
   * scoped query alone would answer `[]` for another clinic's visit — an empty list
   * that reads as "no notes were taken". The visit is the subject; if the subject is
   * not in this clinic, the answer is the same `NOT_FOUND` the visit itself gives
   * (ADR 0014).
   */
  app.get('/api/v1/visits/:visitId/notes', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    try {
      const notes = await listClinicalNotes(path.clinicId, path.visitId, {
        visits,
        notes: clinicalNotes,
      });

      return reply.status(200).send({ notes });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `POST /api/v1/visits/:visitId/notes` — file a note.
   *
   * 201 with the note as it was written. The body carries `body` and nothing else:
   * the visit is the path, the clinic is the request scope, the time is the clock's
   * and the author would be the authenticated user's — there is no user model yet,
   * so `authorId` is written as null and that open question travels with the audit
   * trail (ADR 0022).
   *
   * 422 for an empty or over-long body, refused here rather than stored: a note of
   * nothing is a row that costs a reader's attention and answers no question.
   *
   * 404 for a visit this clinic does not hold — and for the race where the visit is
   * deleted between the use case's read and the insert, which the repository
   * translates from the foreign key so that the same refusal arrives the same way.
   */
  app.post('/api/v1/visits/:visitId/notes', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    const parsed = createClinicalNoteSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendInvalidBody(reply, request, 'The note could not be saved', parsed.error);
    }

    try {
      const note = await addClinicalNote(path.clinicId, path.visitId, parsed.data.body, {
        visits,
        notes: clinicalNotes,
        clock,
        newId: () => asClinicalNoteId(ids.nextId()),
      });

      return reply.status(201).send(note);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `GET /api/v1/visits/:visitId/attachments` — the files attached to this visit.
   *
   * 200 with `{ attachments: [...] }`, oldest first, and `[]` for a visit with none.
   *
   * **404 for a visit this clinic does not hold, for the same reason the notes list
   * 404s.** `visit_attachments` has no clinic column, so a scoped query alone would
   * answer `[]` for another clinic's visit — an empty list that reads as "no files
   * were attached" (ADR 0014).
   */
  app.get('/api/v1/visits/:visitId/attachments', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    try {
      const files = await listVisitAttachments(path.clinicId, path.visitId, {
        visits,
        attachments,
      });

      return reply.status(200).send({ attachments: files });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `POST /api/v1/visits/:visitId/attachments` — attach a file to a visit.
   *
   * 201 with the *reference*, not the bytes: the body carries the file's name,
   * type and size, the visit is the path, the clinic is the request scope and the
   * time is the clock's. Storage itself is the open question (Q10) — this endpoint
   * files the row the workspace renders, and a storage implementation becomes a
   * second write rather than a redesign.
   *
   * 422 for a blank file name or a negative size, refused here rather than stored.
   * 404 for a visit this clinic does not hold — and for the race where the visit is
   * deleted between the use case's read and the insert, which the repository
   * translates from the foreign key so that the same refusal arrives the same way.
   */
  app.post('/api/v1/visits/:visitId/attachments', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    const parsed = createVisitAttachmentSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendInvalidBody(reply, request, 'The file could not be attached', parsed.error);
    }

    try {
      const attachment = await addVisitAttachment(
        path.clinicId,
        path.visitId,
        parsed.data.fileName,
        parsed.data.contentType ?? null,
        parsed.data.sizeBytes ?? null,
        {
          visits,
          attachments,
          clock,
          newId: () => asVisitAttachmentId(ids.nextId()),
        },
      );

      return reply.status(201).send(attachment);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `GET /api/v1/visits/:visitId/treatments` — what was actually done in this visit.
   *
   * 200 with `{ treatments: [...] }`, oldest first, and `[]` for a visit that recorded
   * none. Each record names its catalogue treatment but carries the *fact*, not the
   * catalogue: the price and duration of a procedure as it stands today say nothing
   * about the one performed on this visit, and the clinical record is not where money
   * is argued about.
   *
   * **404 for a visit this clinic does not hold, for the same reason the notes list
   * 404s.** `visit_treatment_executions` has no clinic column, so a scoped query alone
   * would answer `[]` for another clinic's visit — an empty list that reads as "nothing
   * was done" (ADR 0014).
   */
  app.get('/api/v1/visits/:visitId/treatments', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    try {
      const treatments = await listTreatmentRecords(path.clinicId, path.visitId, {
        visits,
        treatmentRecords,
      });

      return reply.status(200).send({ treatments });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `POST /api/v1/visits/:visitId/treatments` — record a treatment performed.
   *
   * 201 with the record as it was written. The body carries `treatmentId` and the two
   * optional clinical fields; the visit is the path, the clinic is the request scope,
   * and the time is the clock's — a record of *when* is not the caller's to say.
   *
   * 422 when the treatment is not in this clinic's catalogue, judged by the use case's
   * read and translated from the foreign key for the race where the treatment vanishes
   * between that read and the insert. A blank tooth or notes is dropped to `null`; a
   * tooth that is not a real FDI number is refused with the odontogram's own error.
   *
   * 404 for a visit this clinic does not hold — and for the race where the visit is
   * deleted between the read and the insert, answered by the domain the way its read
   * would.
   */
  app.post('/api/v1/visits/:visitId/treatments', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    const parsed = recordVisitTreatmentSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendInvalidBody(reply, request, 'The treatment could not be recorded', parsed.error);
    }

    try {
      const recorded = await recordVisitTreatment(
        path.clinicId,
        path.visitId,
        {
          treatmentId: asTreatmentId(parsed.data.treatmentId),
          ...(parsed.data.tooth !== undefined ? { tooth: parsed.data.tooth } : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        },
        {
          visits,
          treatments,
          treatmentRecords,
          clock,
          newId: () => asVisitTreatmentExecutionId(ids.nextId()),
        },
      );

      return reply.status(201).send(recorded);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `GET /api/v1/visits/:visitId/prescriptions` — what the patient was sent home with.
   *
   * 200 with `{ prescriptions: [...] }`, in the order the course was handed over, and
   * `[]` for a visit that wrote none. Each prescription names its visit and inherits the
   * patient and clinician from it — who the record is about is not stored twice.
   *
   * **404 for a visit this clinic does not hold, for the same reason the notes list
   * 404s.** `prescriptions` has no clinic column, so a scoped query alone would answer
   * `[]` for another clinic's visit — an empty list that reads as "nothing was
   * prescribed" (ADR 0014).
   */
  app.get('/api/v1/visits/:visitId/prescriptions', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    try {
      const list = await listVisitPrescriptions(path.clinicId, path.visitId, {
        visits,
        prescriptions,
      });

      return reply.status(200).send({ prescriptions: list });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `POST /api/v1/visits/:visitId/prescriptions` — prescribe a medication.
   *
   * 201 with the prescription as it was written. The body carries only the course —
   * the medication, its route and how long — because the visit is the path, the clinic
   * is the request scope, the time is the clock's, and who the record is about is
   * inherited from the visit rather than accepted from the request (ADR 0014, ADR 0021):
   * a body that could name the patient or clinician could name them differently from
   * the visit the course is filed on.
   *
   * 422 for a course that says nothing (blank medication, dosage or frequency), a route
   * this product does not know, or a course that is not whole days within a year.
   *
   * 404 for a visit this clinic does not hold — and for the race where the visit is
   * deleted between the read and the insert, answered by the domain the way its read
   * would.
   */
  app.post('/api/v1/visits/:visitId/prescriptions', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    const parsed = createPrescriptionSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendInvalidBody(reply, request, 'The prescription could not be written', parsed.error);
    }

    try {
      const prescription = await addVisitPrescription(
        path.clinicId,
        path.visitId,
        {
          medication: parsed.data.medication,
          dosage: parsed.data.dosage,
          route: parsed.data.route,
          frequency: parsed.data.frequency,
          durationDays: parsed.data.durationDays,
          ...(parsed.data.instructions !== undefined
            ? { instructions: parsed.data.instructions }
            : {}),
        },
        {
          visits,
          prescriptions,
          clock,
          newId: () => asPrescriptionId(ids.nextId()),
        },
      );

      return reply.status(201).send(prescription);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `GET /api/v1/visits/:visitId/charges` — the bill this visit has grown.
   *
   * 200 with `{ charges: [...] }`, in the order the bill grew, and `[]` for a visit
   * that raised none.
   *
   * **404 for a visit this clinic does not hold, for the same reason the notes list
   * 404s.** The charge carries its own `clinic_id`, so a scoped query could in
   * principle answer on its own — but the visit is the subject, and a foreign visit's
   * charges are not this clinic's to list. The visit read is what keeps the "is this
   * our patient's bill" and the "we cannot see this visit" answers apart (ADR 0014).
   */
  app.get('/api/v1/visits/:visitId/charges', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    try {
      const list = await listVisitCharges(path.clinicId, path.visitId, {
        visits,
        charges,
      });

      return reply.status(200).send({ charges: list });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `POST /api/v1/visits/:visitId/charges` — raise a charge on the visit.
   *
   * 201 with the charge as it was written. The body carries only the description and
   * the price; the visit is the path, the clinic is the request scope, the currency
   * is the clinic's own record, the time is the clock's, and whose the charge is is
   * inherited from the visit rather than accepted from the request (ADR 0014,
   * ADR 0021) — a body that could restate the patient or the visit could restate them
   * differently from the record it is filed on.
   *
   * 422 for a charge that says nothing or is not priced lawfully (a blank or
   * over-long description, a non-positive quantity, a negative price or discount).
   *
   * 404 for a visit this clinic does not hold — and for the race where the visit is
   * deleted between the read and the insert, answered by the domain the way its read
   * would.
   */
  app.post('/api/v1/visits/:visitId/charges', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    const parsed = createChargeSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendInvalidBody(reply, request, 'The charge could not be raised', parsed.error);
    }

    try {
      const charge = await addVisitCharge(
        path.clinicId,
        path.visitId,
        {
          description: parsed.data.description,
          ...(parsed.data.quantity !== undefined ? { quantity: parsed.data.quantity } : {}),
          unitPriceMinor: parsed.data.unitPriceMinor,
          ...(parsed.data.discountMinor !== undefined
            ? { discountMinor: parsed.data.discountMinor }
            : {}),
        },
        {
          visits,
          charges,
          clinics,
          clock,
          newId: () => asChargeId(ids.nextId()),
        },
      );

      return reply.status(201).send(charge);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `GET /api/v1/visits/:visitId/payments` — money received against this bill.
   *
   * 200 with `{ payments: [...] }`, newest received first, and `[]` for a
   * visit nothing has settled yet. Each payment is a full row: the method, the
   * amount, an optional reference and the moment the money arrived. The visit's
   * *bill* — what is still owed — is the charges list's reading, because "still
   * owed" is a property of the charges until the Milestone 9 ledger exists to
   * own it; this register only ever records what was paid.
   *
   * **404 for a visit this clinic does not hold, for the same reason the charges
   * list 404s.** A payment carries no `visit_id` — the money reaches the visit
   * through its allocations, its invoice and the charges that invoice folded in —
   * so the join alone could answer `[]` for a foreign visit. The visit is the
   * subject; if the subject is not in this clinic, the answer is the same
   * `NOT_FOUND` the visit itself gives (ADR 0014).
   */
  app.get('/api/v1/visits/:visitId/payments', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    try {
      const list = await listVisitPayments(path.clinicId, path.visitId, {
        visits,
        payments,
      });

      return reply.status(200).send({ payments: list });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `POST /api/v1/visits/:visitId/payments` — settle all or part of the bill.
   *
   * 201 with the payment as it was recorded. The body carries the method, the
   * amount and an optional reference and nothing else: the visit is the path,
   * the clinic is the request scope, whose the money is is inherited from the
   * visit, and when it arrived is the clock's. The currency is the clinic's own
   * record, never the caller's (ADR 0014, ADR 0021).
   *
   * The settlement runs in the same `unitOfWork` the bridge uses, and that is
   * not ceremony: it raises an invoice, records the payment, allocates it and
   * stamps the charges — four rows that must become one, or a crash could leave
   * a bill raised with nothing marking it paid (ADR 0021).
   *
   * 422 for an unlawful amount — not a positive integer, or more than the visit's
   * un-invoiced charges are worth — a method this product does not know, or a
   * reference past its ceiling.
   *
   * 404 for a visit this clinic does not hold.
   *
   * **A payment settles the un-invoiced bill.** Charges already folded into an
   * invoice are another document's business; collecting the rest of that invoice
   * is the Milestone 9 ledger's, and until it exists a second payment on the same
   * visit answers the same "nothing left" the empty bill does. That boundary is
   * an open question recorded in `docs/open-questions.md`, not a gap this route
   * is meant to hide.
   */
  app.post('/api/v1/visits/:visitId/payments', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    const parsed = createPaymentSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendInvalidBody(reply, request, 'The payment could not be recorded', parsed.error);
    }

    try {
      const payment = await payVisitCharges(
        path.clinicId,
        path.visitId,
        {
          method: parsed.data.method,
          amountMinor: parsed.data.amountMinor,
          ...(parsed.data.reference != null ? { reference: parsed.data.reference } : {}),
        },
        {
          unitOfWork,
          clock,
          newInvoiceId: () => asInvoiceId(ids.nextId()),
          newPaymentId: () => asPaymentId(ids.nextId()),
        },
      );

      return reply.status(201).send(payment);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `GET /api/v1/patients/:patientId/visits` — the clinical timeline.
   *
   * Nested under the patient because a patient's history has no other sensible address:
   * the path says whose history it is without a second query field.
   *
   * **200 with `[]` for a patient who has never been treated** — and also for a patient
   * another clinic holds, because a list endpoint cannot refuse to answer "does this
   * patient exist here" without leaking "does this patient exist somewhere". It answers
   * exactly one question: which visits may I read (ADR 0014, ADR 0023).
   *
   * **Uncapped.** A silently truncated clinical timeline is worse than a long one; a
   * clinician reading "these are this patient's visits" has to be able to trust that it
   * is all of them.
   */
  app.get('/api/v1/patients/:patientId/visits', async (request, reply) => {
    const path = readPatientId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request, 'The patient id in the path is not valid');
    }

    try {
      const list = await listVisitsForPatient(path.clinicId, path.patientId, { visits });

      return reply.status(200).send({ visits: list });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
}

type ParsedPatientPath =
  | { readonly valid: true; readonly patientId: PatientId; readonly clinicId: ClinicId }
  | { readonly valid: false };

/**
 * The patient half of the timeline route, and the same guard as `readVisitId` above:
 * the clinic is the request's and the id is a uuid before either reaches a query.
 *
 * It returns its own type rather than a widened `ParsedVisitPath` with two optional ids,
 * because a path where both ids are optional would let a handler reach a query with
 * neither — and the whole point of the guard is that it cannot be reached half-parsed.
 */
function readPatientId(params: unknown, clinicId: ClinicId): ParsedPatientPath {
  const candidate = (params as { patientId?: unknown } | undefined)?.patientId;

  if (typeof candidate !== 'string' || !uuidSchema.safeParse(candidate).success) {
    return { valid: false };
  }
  return { valid: true, patientId: asPatientId(candidate), clinicId };
}

type ParsedVisitPath =
  | { readonly valid: true; readonly visitId: VisitId; readonly clinicId: ClinicId }
  | { readonly valid: false };

/**
 * The clinic comes from the request scope and never from the path or the body, so it is
 * read here and handed on branded: a path that has not been through this guard cannot
 * reach a query (ADR 0014).
 *
 * The id is validated with the same `uuidSchema` the appointments route uses, so a
 * hand-typed id in the URL is a 422 rather than PostgreSQL's `22P02` arriving as a 500.
 *
 * **`clinicId` is a required parameter, and the first version of this helper defaulted it
 * to an empty string.** Both handlers called it with the path alone, so every completion
 * looked for a visit in the empty clinic: `clinic_id = ''` is not a uuid, and the
 * `22P02` arrived as a **500** — the precise failure the `uuidSchema` guard one line
 * above exists to prevent, written by the guard's own author. An empty-string default for
 * a brand that means "a clinic somebody named" is a hole with a lid on it.
 */
function readVisitId(params: unknown, clinicId: ClinicId): ParsedVisitPath {
  const candidate = (params as { visitId?: unknown } | undefined)?.visitId;

  if (typeof candidate !== 'string' || !uuidSchema.safeParse(candidate).success) {
    return { valid: false };
  }
  return { valid: true, visitId: asVisitId(candidate), clinicId };
}

/** 422 for an unreadable path id, matching the body-validation shape. */
/**
 * 422 for a path id that is not a uuid.
 *
 * `message` is overridable because the timeline route's failure is about a *patient* id,
 * and "The visit id in the path is not a uuid" on `/patients/:patientId/visits` would
 * name a parameter the request does not contain. The first draft hardcoded it and the
 * mismatch was correct rather than cosmetic: a client parsing the message to find out
 * which field it got wrong would look for a field it never sent.
 */
function sendInvalidVisitId(
  reply: FastifyReply,
  request: FastifyRequest,
  message = 'The visit id in the path is not a uuid',
): FastifyReply {
  return reply.status(422).send({
    error: {
      code: 'VALIDATION_ERROR',
      message,
      details: { issues: [{ path: ['visitId'], code: 'invalid_uuid' }] },
      requestId: request.id,
    },
  });
}

/**
 * 422 for a body the schema refused, in the envelope every endpoint uses.
 *
 * Shared by the two creation doors because they were each about to inline the same
 * eight lines, and the message is a parameter because "the visit could not be started"
 * and "the walk-in visit could not be started" name different requests — a client
 * parsing the message to find out which door it knocked on would otherwise be told the
 * wrong one.
 */
function sendInvalidBody(
  reply: FastifyReply,
  request: FastifyRequest,
  message: string,
  error: { readonly issues: unknown },
): FastifyReply {
  return reply.status(422).send({
    error: {
      code: 'VALIDATION_ERROR',
      message,
      details: { issues: error.issues },
      requestId: request.id,
    },
  });
}
