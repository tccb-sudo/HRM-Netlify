-- HRM ENTERPRISE V2 - CO CAU TO CHUC DA CAP
-- Chay toan bo tep nay mot lan trong Supabase SQL Editor.
-- Script co tinh lap lai (idempotent) va khong xoa du lieu V1.

begin;

create table if not exists public.organizations (
  id text primary key,
  code text not null unique,
  name text not null,
  org_type text not null check (org_type in (
    'university','school','faculty','center','office','department','division','subject'
  )),
  parent_id text references public.organizations(id) on delete restrict,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (id <> parent_id)
);
create index if not exists organizations_parent_idx on public.organizations(parent_id);
create index if not exists organizations_active_idx on public.organizations(active);

create table if not exists public.people (
  cccd text primary key check (cccd ~ '^\d{12}$'),
  name text not null,
  email text default '',
  start_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  cccd text not null references public.people(cccd) on delete cascade,
  org_id text not null references public.organizations(id) on delete restrict,
  worker_type text not null default 'employee' check (worker_type in ('employee','lecturer')),
  is_primary boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (cccd,org_id)
);
create index if not exists memberships_org_idx on public.organization_memberships(org_id);
create unique index if not exists memberships_one_primary_idx
  on public.organization_memberships(cccd) where is_primary and active;

create table if not exists public.role_assignments (
  id bigint generated always as identity primary key,
  cccd text not null references public.people(cccd) on delete cascade,
  org_id text not null references public.organizations(id) on delete cascade,
  role text not null check (role in ('unit_manager','organization_hr','university_hr','system_admin')),
  include_descendants boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (cccd,org_id,role)
);
create index if not exists role_assignments_cccd_idx on public.role_assignments(cccd);
create index if not exists role_assignments_org_idx on public.role_assignments(org_id);

alter table public.leave_requests add column if not exists org_id text references public.organizations(id);
alter table public.leave_requests add column if not exists hr_org_id text references public.organizations(id);
alter table public.leave_requests add column if not exists academic_year text;
create index if not exists leave_requests_org_idx on public.leave_requests(org_id);
create index if not exists leave_requests_hr_org_idx on public.leave_requests(hr_org_id);

-- Don vi goc va cac don vi cap 2 da thong nhat.
insert into public.organizations(id,code,name,org_type,parent_id,sort_order) values
  ('ump','UMP','Đại học Y Dược TP.HCM','university',null,10),
  ('school-pharmacy','SOP','Trường Dược','school','ump',20),
  ('school-medicine','SOM','Trường Y','school','ump',30),
  ('faculty-dentistry','FOD','Khoa Răng Hàm Mặt','faculty','ump',40),
  ('center-hr-training','CHRT','Trung tâm Đào tạo nguồn nhân lực','center','ump',50),
  ('office-general-admin','OGA','Phòng Hành chính Tổng hợp','office','ump',60),
  ('office-human-resources','OHR','Phòng Tổ chức Cán bộ','office','ump',70)
on conflict (id) do update set
  code=excluded.code,name=excluded.name,org_type=excluded.org_type,
  parent_id=excluded.parent_id,sort_order=excluded.sort_order,updated_at=now();

-- Chuyen du lieu nhan vien V1 sang people (giu nguyen bang employees de doi chieu).
insert into public.people(cccd,name,email,start_date)
select distinct on (cccd) cccd,name,coalesce(email,''),start_date
from public.employees
order by cccd,case when coalesce(email,'')<>'' then 0 else 1 end
on conflict (cccd) do update set
  name=excluded.name,
  email=case when excluded.email<>'' then excluded.email else public.people.email end,
  start_date=coalesce(excluded.start_date,public.people.start_date),
  updated_at=now();

-- Moi phong/bo mon hien tai duoc dua vao nhanh Truong Duoc.
insert into public.organizations(id,code,name,org_type,parent_id,sort_order)
select distinct
  'legacy-'||substr(md5(department),1,16),
  'LEG-'||upper(substr(md5(department),1,8)),
  department,
  case when lower(department) like '%bộ môn%' then 'subject' else 'department' end,
  'school-pharmacy',100
from public.employees
where coalesce(department,'')<>''
on conflict (id) do update set name=excluded.name,parent_id='school-pharmacy',updated_at=now();

insert into public.organization_memberships(cccd,org_id,worker_type,is_primary)
select e.cccd,'legacy-'||substr(md5(e.department),1,16),
  case when e.role in ('lecturer','manager_lecturer') then 'lecturer' else 'employee' end,
  row_number() over (partition by e.cccd order by e.department)=1
from public.employees e
where coalesce(e.department,'')<>''
on conflict (cccd,org_id) do update set
  worker_type=excluded.worker_type,active=true;

insert into public.role_assignments(cccd,org_id,role,include_descendants)
select distinct e.cccd,'legacy-'||substr(md5(e.department),1,16),'unit_manager',false
from public.employees e where e.role in ('manager','manager_lecturer')
on conflict (cccd,org_id,role) do update set active=true;

-- HR V1 duoc mac dinh la HR cua Truong Duoc, phu trach tat ca don vi con.
insert into public.role_assignments(cccd,org_id,role,include_descendants)
select distinct e.cccd,'school-pharmacy','organization_hr',true
from public.employees e where e.role='hr'
on conflict (cccd,org_id,role) do update set include_descendants=true,active=true;

-- Gan org_id cho don cu theo ten don vi V1.
update public.leave_requests r
set org_id='legacy-'||substr(md5(r.department),1,16)
where r.org_id is null and coalesce(r.department,'')<>'';

update public.leave_requests
set academic_year=(case
  when extract(month from from_date)>=7
    then extract(year from from_date)::int||'–'||(extract(year from from_date)::int+1)
  else (extract(year from from_date)::int-1)||'–'||extract(year from from_date)::int
end)
where academic_year is null;

alter table public.organizations enable row level security;
alter table public.people enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.role_assignments enable row level security;
-- Khong tao policy anon/authenticated. Apps Script dung service-role o may chu.

commit;

-- KIEM TRA SAU MIGRATION
select id,code,name,org_type,parent_id from public.organizations order by sort_order,name;
select count(*) as people_count from public.people;
select count(*) as membership_count from public.organization_memberships;
select role,count(*) from public.role_assignments group by role order by role;

-- BAT BUOC MOT LAN: thay 012345678901 bang CCCD cua HR Dai hoc/quan tri dau tien,
-- sau do chay rieng lenh duoi trong SQL Editor:
-- insert into public.role_assignments(cccd,org_id,role,include_descendants)
-- values ('012345678901','ump','system_admin',true)
-- on conflict (cccd,org_id,role) do update set active=true,include_descendants=true;
