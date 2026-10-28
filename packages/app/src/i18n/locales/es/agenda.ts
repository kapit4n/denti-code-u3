export const agenda = {
  'agenda.title': 'Agenda',
  'agenda.loadingClinic': 'Cargando la clínica…',
  'agenda.clinicError':
    'No se pudo cargar la clínica, así que la agenda no se puede dibujar en su zona horaria.',
  'agenda.unassigned': 'Sin asignar',
  'agenda.noChair': 'Sin sillón asignado',
  'agenda.duration': '{count} min',

  'agenda.filter.dentists': 'Odontólogos',
  'agenda.filter.chairs': 'Sillones',
  'agenda.filter.all': 'Todos',
  'agenda.filter.inactive': 'de baja',
  'agenda.filter.clear': 'Quitar filtros',
  'agenda.filter.error': 'No se pudieron cargar los filtros.',

  'agenda.calendar.day': 'Día',
  'agenda.calendar.week': 'Semana',
  'agenda.calendar.month': 'Mes',
  'agenda.calendar.today': 'Hoy',
  'agenda.calendar.moveError': 'No se pudo mover la cita.',
  'agenda.calendar.loadError': 'No se pudo cargar la agenda.',
  'agenda.calendar.empty': 'No hay citas en este rango.',
  'agenda.calendar.emptyFiltered': 'No hay citas que coincidan con estos filtros en este rango.',

  'agenda.status.SCHEDULED': 'Programada',
  'agenda.status.CONFIRMED': 'Confirmada',
  'agenda.status.ARRIVED': 'Llegó',
  'agenda.status.IN_TREATMENT': 'En tratamiento',
  'agenda.status.COMPLETED': 'Completada',
  'agenda.status.CANCELLED': 'Cancelada',
  'agenda.status.NO_SHOW': 'No asistió',

  'agenda.transition.cancel': 'Cancelar',
  'agenda.transition.markNoShow': 'Marcar como no asistió',
  'agenda.transition.unconfirm': 'Quitar confirmación',
  'agenda.transition.checkIn': 'Registrar llegada',
  'agenda.transition.startTreatment': 'Iniciar tratamiento',
  'agenda.transition.complete': 'Completar',
  'agenda.transition.putBack': 'Volver a programar',

  'agenda.panel.when': 'Cuándo',
  'agenda.panel.dentist': 'Odontólogo',
  'agenda.panel.chair': 'Sillón',
  'agenda.panel.cancelReason': '¿Por qué se cancela?',
  'agenda.panel.cancelReasonPlaceholder': 'El paciente llamó para cancelar',
  'agenda.panel.cancelReasonHint':
    'La cancelación queda en el registro. Esto es lo que lee recepción cuando el paciente vuelve a llamar.',
  'agenda.panel.confirmCancellation': 'Cancelar la cita',
  'agenda.panel.keep': 'Mantenerla',
  'agenda.panel.finished': 'Esta cita ya terminó. Su registro se conserva tal como está.',
  'agenda.panel.updateError': 'No se pudo actualizar la cita.',

  'agenda.booking.newForPatient': 'Nueva cita para {patient}',
  'agenda.booking.new': 'Nueva cita',
  'agenda.booking.chooseTime': 'Elige la fecha y hora a la que viene el paciente.',
  'agenda.booking.dateTime': 'Fecha y hora',
  'agenda.booking.hintFromSlot':
    'Desde el hueco que pulsaste en la agenda, en la hora propia de la clínica, {timeZone}.',
  'agenda.booking.hintTyped': 'La hora propia de la clínica, {timeZone}.',
  'agenda.booking.clinician': 'Odontólogo',
  'agenda.booking.chooseClinician': 'Elige un odontólogo',
  'agenda.booking.loadingClinicians': 'Cargando odontólogos…',
  'agenda.booking.noClinician':
    'Esta clínica no tiene ningún odontólogo activo, así que todavía no se puede reservar nada.',
  'agenda.booking.duration': 'Duración',
  'agenda.booking.minutes': '{minutes} min',
  'agenda.booking.chair': 'Sillón',
  'agenda.booking.noChairOption': 'Sin sillón',
  'agenda.booking.notes': 'Notas',
  'agenda.booking.notesPlaceholder':
    'Lo que el odontólogo debe saber antes de que llegue el paciente',
  'agenda.booking.booking': 'Reservando…',
  'agenda.booking.book': 'Reservar cita',
  'agenda.booking.loadingResources': 'Cargando odontólogos y sillones…',
  'agenda.booking.invalidTime':
    'Esa hora no existe en esa fecha en {timeZone}: ese día cambian los relojes. Elige otra hora.',
  'agenda.booking.error': 'No se pudo reservar la cita.',

  'agenda.failure.conflict': 'Esa hora ya está reservada para este odontólogo o sillón.',
  'agenda.failure.conflictOne':
    'Esa hora se cruza con una cita ya reservada, {span}. Muévela o elige otro hueco.',
  'agenda.failure.conflictMany':
    'Esa hora se cruza con {count} citas ya reservadas: {spans}. Mueve una de ellas o elige otro hueco.',
  'agenda.failure.notFound': 'Esa cita ya no existe.',
  'agenda.failure.network':
    'No se pudo conectar con el servidor. Revisa la conexión e inténtalo de nuevo.',
} as const;
