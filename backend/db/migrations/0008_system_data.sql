-- =============================================================================
-- 0008 System data: the permission catalog and admission stage catalog.
-- (Roles are created per company by the provisioning script and are fully
-- configurable afterwards.)
-- =============================================================================

insert into permissions (key, category, description, is_sensitive) values
  ('dashboard.view',            'Dashboard', 'View the company dashboard', false),
  ('dashboard.consolidated',    'Dashboard', 'View the consolidated dashboard across companies the user belongs to', false),
  ('staff.workload.view',       'Dashboard', 'View workload and on-time indicators for all staff', false),

  ('students.read.all',         'Students', 'View all students that originate from (or are linked to) this company', false),
  ('students.read.processing',  'Students', 'View all students this company processes for another brand', false),
  ('students.read.assigned',    'Students', 'View students assigned to the user', false),
  ('students.contact.view',     'Students', 'See phone, email and date of birth', true),
  ('students.create',           'Students', 'Register new leads/students', false),
  ('students.update',           'Students', 'Edit student profile details', false),
  ('students.assign',           'Students', 'Assign or reassign counsellors and processing staff', false),
  ('students.merge',            'Students', 'Merge duplicate student records', true),
  ('students.archive',          'Students', 'Archive or restore student records', true),
  ('students.stage.change',     'Workflow', 'Change a student''s admission stage (also needs the stage-specific permission)', false),

  ('stage.sales',               'Workflow', 'Move students into Lead/Counselling and Registration', false),
  ('stage.documents',           'Workflow', 'Move students into document, attestation and translation stages', false),
  ('stage.admission',           'Workflow', 'Move students into university application / admission letter stages', false),
  ('stage.visa',                'Workflow', 'Move students into visa and travel stages; update visa details', false),
  ('stage.finance',             'Workflow', 'Move students into Fee Clearance', false),
  ('stage.hold',                'Workflow', 'Put students On Hold, Cancel/Withdraw, or resume them', false),

  ('notes.read',                'Notes', 'Read internal notes and follow-ups', false),
  ('notes.write',               'Notes', 'Add internal notes and follow-ups', false),
  ('notes.restricted',          'Notes', 'Read and write restricted notes', true),

  ('documents.read',            'Documents', 'View the document checklist and statuses', false),
  ('documents.file.view',       'Documents', 'Open/download private document files', true),
  ('documents.upload',          'Documents', 'Upload document files', false),
  ('documents.review',          'Documents', 'Review documents (approve, reject, mark expired)', false),
  ('documents.custody',         'Documents', 'Record where physical originals are', false),

  ('tasks.read.all',            'Tasks', 'View all tasks of the company', false),
  ('tasks.read.own',            'Tasks', 'View tasks assigned to or created by the user', false),
  ('tasks.create',              'Tasks', 'Create tasks', false),
  ('tasks.assign',              'Tasks', 'Assign/reassign tasks and change due dates', false),
  ('tasks.update.own',          'Tasks', 'Update own tasks', false),
  ('tasks.update.all',          'Tasks', 'Update any task of the company', false),

  ('payments.read',             'Finance', 'View the payment ledger and balances', true),
  ('payments.record',           'Finance', 'Record charges, receipts and waivers', true),
  ('payments.verify',           'Finance', 'Verify or reject recorded entries', true),
  ('payments.reverse',          'Finance', 'Record refunds and reversals', true),
  ('payments.disbursement',     'Finance', 'Record third-party disbursements (e.g. university fees paid)', true),

  ('reports.view',              'Reports', 'View reports', false),
  ('reports.export',            'Reports', 'Export non-personal report data to CSV', false),
  ('reports.export.pii',        'Reports', 'Export reports that include student contact details', true),
  ('reports.export.finance',    'Reports', 'Export financial reports', true),

  ('audit.read',                'Administration', 'Read the audit log', true),
  ('users.manage',              'Administration', 'Create staff accounts and manage company memberships', true),
  ('roles.manage',              'Administration', 'Configure roles and permissions', true),
  ('settings.manage',           'Administration', 'Manage company settings and fee categories', false),
  ('reference.manage',          'Administration', 'Manage countries, courses, universities, lead sources and legal entities', false),
  ('workflow.manage',           'Administration', 'Configure workflows, stages and document requirements', false);

insert into stages (key, name, sort_order, kind, permission_key) values
  ('lead',                   'Lead / Counselling',      10, 'normal',    'stage.sales'),
  ('registration',           'Registration',            20, 'normal',    'stage.sales'),
  ('document_collection',    'Document Collection',     30, 'normal',    'stage.documents'),
  ('document_review',        'Document Review',         40, 'normal',    'stage.documents'),
  ('attestation',            'Attestation / Apostille', 50, 'normal',    'stage.documents'),
  ('translation',            'Translation',             60, 'normal',    'stage.documents'),
  ('university_application', 'University Application', 70, 'normal',    'stage.admission'),
  ('admission_letter',       'Admission Letter',        80, 'normal',    'stage.admission'),
  ('visa_processing',        'Visa Processing',         90, 'normal',    'stage.visa'),
  ('fee_clearance',          'Fee Clearance',          100, 'normal',    'stage.finance'),
  ('travel_preparation',     'Travel Preparation',     110, 'normal',    'stage.visa'),
  ('travel_completed',       'Travel Completed',       120, 'completed', 'stage.visa'),
  ('on_hold',                'On Hold',                900, 'hold',      'stage.hold'),
  ('cancelled',              'Cancelled / Withdrawn',  910, 'cancelled', 'stage.hold');
