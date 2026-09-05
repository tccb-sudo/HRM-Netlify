-- Run once in Supabase SQL Editor.
create table if not exists public.employees (
  cccd text not null check (cccd ~ '^\d{12}$'), name text not null,
  department text not null, role text not null check (role in ('employee','lecturer','manager','manager_lecturer','hr')),
  email text default '', start_date date,
  primary key (cccd, department)
);

create table if not exists public.leave_requests (
  id text primary key, cccd text not null, employee_name text not null, department text not null,
  from_date date not null, to_date date not null, days numeric(5,1) not null check (days >= 0),
  reason text not null, status text not null default 'pending', approver_cccd text, approver_note text default '',
  hr_cccd text, hr_note text default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  attachment text default '', history jsonb not null default '[]'::jsonb,
  half_day text not null default 'none' check (half_day in ('none','morning','afternoon')),
  return_info jsonb
);
create index if not exists leave_requests_cccd_idx on public.leave_requests(cccd);
create index if not exists leave_requests_department_idx on public.leave_requests(department);
create index if not exists leave_requests_dates_idx on public.leave_requests(from_date,to_date);
create index if not exists leave_requests_status_idx on public.leave_requests(status);

create table if not exists public.holiday_settings (
  year integer not null, type text not null check (type in ('summer','tet')),
  from_date date not null, to_date date not null, note text default '', created_by text, created_at timestamptz default now(),
  primary key (year,type)
);
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key, created_at timestamptz not null default now(),
  action text not null, cccd text, detail text default ''
);
create table if not exists public.notifications (
  id bigint generated always as identity primary key, recipient_email text not null,
  subject text not null, status text not null, created_at timestamptz not null default now()
);

alter table public.employees enable row level security;
alter table public.leave_requests enable row level security;
alter table public.holiday_settings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;
-- No anon/authenticated policies are intentionally created.
-- Browser access is blocked; Apps Script uses the service-role key server-side.

