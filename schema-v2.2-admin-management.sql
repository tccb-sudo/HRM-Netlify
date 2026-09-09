-- HRM ENTERPRISE V2.2 - GIAO DICH QUAN TRI DON NGHI
-- Chay mot lan sau schema-v2.1-leave-balances.sql.

begin;

create or replace function public.hrm_admin_delete_leave(p_request_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.leave_requests%rowtype; y text;
begin
  select * into r from public.leave_requests where id=p_request_id for update;
  if not found then raise exception 'Không tìm thấy đơn nghỉ'; end if;
  y:=coalesce(r.academic_year,case when extract(month from r.from_date)>=7
    then extract(year from r.from_date)::int||'–'||(extract(year from r.from_date)::int+1)
    else (extract(year from r.from_date)::int-1)||'–'||extract(year from r.from_date)::int end);
  if r.status in ('pending','approved','approved_partial_returned') then
    update public.leave_balances set reserved_days=greatest(0,reserved_days-r.days),updated_at=now()
    where cccd=r.cccd and academic_year=y;
  elsif r.status in ('hr_confirmed','hr_confirmed_partial_returned') then
    update public.leave_balances set used_days=greatest(0,used_days-r.days),updated_at=now()
    where cccd=r.cccd and academic_year=y;
  end if;
  delete from public.leave_requests where id=p_request_id;
  return to_jsonb(r);
end;$$;

create or replace function public.hrm_admin_update_leave(
  p_request_id text,p_from_date date,p_to_date date,p_days numeric,
  p_reason text,p_attachment text,p_half_day text,p_academic_year text,
  p_history_item jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.leave_requests%rowtype; old_y text; ok boolean:=true;
begin
  select * into r from public.leave_requests where id=p_request_id for update;
  if not found then raise exception 'Không tìm thấy đơn nghỉ'; end if;
  if p_days<=0 or p_to_date<p_from_date then raise exception 'Khoảng ngày không hợp lệ'; end if;
  old_y:=coalesce(r.academic_year,case when extract(month from r.from_date)>=7
    then extract(year from r.from_date)::int||'–'||(extract(year from r.from_date)::int+1)
    else (extract(year from r.from_date)::int-1)||'–'||extract(year from r.from_date)::int end);

  -- Hoan phan phan bo cu; neu bat ky buoc sau loi, PostgreSQL tu rollback toan bo.
  if r.status in ('pending','approved','approved_partial_returned') then
    update public.leave_balances set reserved_days=greatest(0,reserved_days-r.days),updated_at=now()
    where cccd=r.cccd and academic_year=old_y;
    update public.leave_balances set reserved_days=reserved_days+p_days,updated_at=now()
    where cccd=r.cccd and academic_year=p_academic_year
      and entitlement-used_days-reserved_days>=p_days;
    ok:=found;
  elsif r.status in ('hr_confirmed','hr_confirmed_partial_returned') then
    update public.leave_balances set used_days=greatest(0,used_days-r.days),updated_at=now()
    where cccd=r.cccd and academic_year=old_y;
    update public.leave_balances set used_days=used_days+p_days,updated_at=now()
    where cccd=r.cccd and academic_year=p_academic_year
      and entitlement-used_days-reserved_days>=p_days;
    ok:=found;
  end if;
  if not ok then raise exception 'Không đủ số dư phép trong năm học mới'; end if;

  update public.leave_requests set from_date=p_from_date,to_date=p_to_date,days=p_days,
    reason=p_reason,attachment=coalesce(p_attachment,''),half_day=p_half_day,
    academic_year=p_academic_year,
    history=coalesce(history,'[]'::jsonb)||jsonb_build_array(p_history_item),updated_at=now()
  where id=p_request_id returning * into r;
  return to_jsonb(r);
end;$$;

revoke execute on function public.hrm_admin_delete_leave(text) from public,anon,authenticated;
revoke execute on function public.hrm_admin_update_leave(text,date,date,numeric,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.hrm_admin_delete_leave(text) to service_role;
grant execute on function public.hrm_admin_update_leave(text,date,date,numeric,text,text,text,text,jsonb) to service_role;

commit;
