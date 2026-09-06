-- HRM ENTERPRISE V2.1 - SO DU PHEP DOC LAP THEO NAM HOC
-- Chay mot lan sau schema-v2-enterprise.sql. Khong xoa du lieu cu.

begin;

create table if not exists public.leave_balances (
  cccd text not null references public.people(cccd) on delete cascade,
  academic_year text not null,
  period_start date not null,
  period_end date not null,
  entitlement numeric(5,1) not null check (entitlement >= 0),
  used_days numeric(5,1) not null default 0 check (used_days >= 0),
  reserved_days numeric(5,1) not null default 0 check (reserved_days >= 0),
  carryover_days numeric(5,1) not null default 0 check (carryover_days = 0),
  updated_at timestamptz not null default now(),
  primary key (cccd,academic_year),
  check (period_end >= period_start),
  check (used_days + reserved_days <= entitlement)
);
create index if not exists leave_balances_year_idx on public.leave_balances(academic_year);

-- Tao so du tu cac don hien co. Moi nam hoc luon carryover_days = 0.
with request_years as (
  select distinct cccd,
    case when extract(month from from_date)>=7 then extract(year from from_date)::int
         else extract(year from from_date)::int-1 end as start_year
  from public.leave_requests
), current_year as (
  select p.cccd,
    case when extract(month from current_date)>=7 then extract(year from current_date)::int
         else extract(year from current_date)::int-1 end as start_year
  from public.people p where p.active
), person_years as (
  select * from request_years union select * from current_year
), calculated as (
  select py.cccd,py.start_year,p.start_date,
    py.start_year||'–'||(py.start_year+1) as academic_year,
    make_date(py.start_year,7,1) as period_start,
    make_date(py.start_year+1,6,30) as period_end
  from person_years py join public.people p on p.cccd=py.cccd
), totals as (
  select c.*,
    least(12 + floor(greatest(0,extract(year from age(c.period_start,c.start_date)))/5),18)::numeric(5,1) as entitlement,
    coalesce(sum(case when r.status in ('hr_confirmed','hr_confirmed_partial_returned') then r.days else 0 end),0)::numeric(5,1) as used_days,
    coalesce(sum(case when r.status in ('pending','approved','approved_partial_returned') then r.days else 0 end),0)::numeric(5,1) as reserved_days
  from calculated c left join public.leave_requests r
    on r.cccd=c.cccd and r.from_date between c.period_start and c.period_end
  group by c.cccd,c.start_year,c.start_date,c.academic_year,c.period_start,c.period_end
)
insert into public.leave_balances(cccd,academic_year,period_start,period_end,entitlement,used_days,reserved_days,carryover_days)
select cccd,academic_year,period_start,period_end,entitlement,
  least(used_days,entitlement),
  least(reserved_days,greatest(0,entitlement-least(used_days,entitlement))),0
from totals
on conflict (cccd,academic_year) do update set
  period_start=excluded.period_start,period_end=excluded.period_end,
  entitlement=excluded.entitlement,used_days=excluded.used_days,
  reserved_days=excluded.reserved_days,carryover_days=0,updated_at=now();

create or replace function public.hrm_reserve_leave(p_cccd text,p_year text,p_days numeric)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.leave_balances set reserved_days=reserved_days+p_days,updated_at=now()
  where cccd=p_cccd and academic_year=p_year and p_days>0
    and entitlement-used_days-reserved_days>=p_days;
  return found;
end;$$;

create or replace function public.hrm_release_reserved_leave(p_cccd text,p_year text,p_days numeric)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.leave_balances set reserved_days=greatest(0,reserved_days-p_days),updated_at=now()
  where cccd=p_cccd and academic_year=p_year and p_days>0;
  return found;
end;$$;

create or replace function public.hrm_confirm_reserved_leave(p_cccd text,p_year text,p_days numeric)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.leave_balances
  set reserved_days=reserved_days-p_days,used_days=used_days+p_days,updated_at=now()
  where cccd=p_cccd and academic_year=p_year and p_days>0 and reserved_days>=p_days;
  return found;
end;$$;

create or replace function public.hrm_reduce_used_leave(p_cccd text,p_year text,p_days numeric)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.leave_balances set used_days=greatest(0,used_days-p_days),updated_at=now()
  where cccd=p_cccd and academic_year=p_year and p_days>0;
  return found;
end;$$;

revoke execute on function public.hrm_reserve_leave(text,text,numeric) from public,anon,authenticated;
revoke execute on function public.hrm_release_reserved_leave(text,text,numeric) from public,anon,authenticated;
revoke execute on function public.hrm_confirm_reserved_leave(text,text,numeric) from public,anon,authenticated;
revoke execute on function public.hrm_reduce_used_leave(text,text,numeric) from public,anon,authenticated;
grant execute on function public.hrm_reserve_leave(text,text,numeric) to service_role;
grant execute on function public.hrm_release_reserved_leave(text,text,numeric) to service_role;
grant execute on function public.hrm_confirm_reserved_leave(text,text,numeric) to service_role;
grant execute on function public.hrm_reduce_used_leave(text,text,numeric) to service_role;

alter table public.leave_balances enable row level security;

commit;

select academic_year,count(*) as employees,sum(entitlement) as entitlement,
       sum(used_days) as used,sum(reserved_days) as reserved,sum(carryover_days) as carryover
from public.leave_balances group by academic_year order by academic_year;
