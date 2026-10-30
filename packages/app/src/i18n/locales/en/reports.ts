export const reports = {
  'reports.title': 'Reports',
  'reports.description':
    'Appointments, production, collections and occupancy for the period you choose.',

  'reports.filters.title': 'Period and filters',
  'reports.filters.description':
    'Dates are read in the clinic’s time zone{timeZone}. The last day is included.',
  'reports.filters.from': 'From',
  'reports.filters.to': 'To',
  'reports.filters.clinician': 'Clinician',
  'reports.filters.allClinicians': 'All clinicians',
  'reports.filters.inactiveSuffix': ' (inactive)',
  'reports.filters.rangeError': 'The start date must be on or before the end date.',

  'reports.export': 'Export CSV',
  'reports.export.saved': 'Saved {name}',
  'reports.export.failure': 'The report could not be saved on this device.',
  'reports.loadError': 'The report could not be built for this period.',

  'reports.summary.aria': 'Report summary',
  'reports.stat.appointments.title': 'Appointments',
  'reports.stat.appointments.description': 'Booked in the period',
  'reports.stat.completed.title': 'Completed',
  'reports.stat.completed.description': 'Finished appointments',
  'reports.stat.cancelled.title': 'Cancelled',
  'reports.stat.cancelled.description': 'Cancelled appointments',
  'reports.stat.noShow.title': 'No-show',
  'reports.stat.noShow.description': 'Patients who did not attend',
  'reports.stat.production.title': 'Production',
  'reports.stat.production.description': 'Net charge value raised',
  'reports.stat.collections.title': 'Collections',
  'reports.stat.collections.description': 'Payments received, clinic-wide',
  'reports.stat.outstanding.title': 'Outstanding',
  'reports.stat.outstanding.description': 'Open invoices, as of now',
  'reports.stat.occupancy.title': 'Occupancy',
  'reports.stat.occupancy.description': '{booked} of {capacity} min',
  'reports.stat.occupancy.noHours': 'No recorded opening hours',

  'reports.performance.title': 'Clinician performance',
  'reports.performance.description':
    'Appointments and production are attributed to the clinician on the row. Collections are not split here: payments carry no clinician.',
  'reports.performance.empty': 'No clinician activity in this period.',

  'reports.column.clinician': 'Clinician',
  'reports.column.appointments': 'Appointments',
  'reports.column.completed': 'Completed',
  'reports.column.cancelled': 'Cancelled',
  'reports.column.noShow': 'No-show',
  'reports.column.bookedMinutes': 'Booked min',
  'reports.column.production': 'Production',
  'reports.column.occupancy': 'Occupancy',
} as const;
