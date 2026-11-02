-- =============================================================================
-- 20261102000000_public_demo_sessions_and_maas.sql
-- Standalone PayPal AI Billing Kit — Isolated Public Demo Sessions, Reset & MaaS RPCs
-- Project: paypal-ai-billing-kit (dvzfesfvefggnunkjhom)
-- =============================================================================

set search_path = public, extensions;

-- 0. Allow transaction-local demo session reset & FK ON DELETE SET NULL on billing_audit_events
create or replace function public.billing_audit_immutable()
returns trigger language plpgsql as $$
begin
  if current_setting('app.allow_demo_reset', true) = 'true' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'UPDATE' and new.invoice_id is null and old.invoice_id is not null then
    return new;
  end if;
  raise exception 'billing_audit_events is append-only' using errcode = '42501';
end;
$$;

-- 1. Add demo_session_id to session-scoped tables for multi-visitor isolation
alter table public.billing_invoices
  add column if not exists demo_session_id text not null default 'canonical';
create index if not exists billing_invoices_demo_session_idx
  on public.billing_invoices(demo_session_id, created_at desc);

alter table public.billing_ai_sessions
  add column if not exists demo_session_id text not null default 'canonical';
create index if not exists billing_ai_sessions_demo_session_idx
  on public.billing_ai_sessions(user_id, role_scope, demo_session_id, last_activity_at desc);

alter table public.billing_ai_proposals
  add column if not exists demo_session_id text not null default 'canonical';

alter table public.billing_notifications
  add column if not exists demo_session_id text not null default 'canonical';

alter table public.billing_audit_events
  add column if not exists demo_session_id text not null default 'canonical';

-- 2. Per-visitor overrides for canonical seed invoices so visitors never mutate shared canonical rows
create table if not exists public.billing_demo_session_overrides (
  demo_session_id text not null check (length(btrim(demo_session_id)) between 1 and 120),
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  status text not null check (status in ('draft', 'sent', 'payment_pending', 'paid', 'partially_refunded', 'refunded', 'void')),
  amount_paid_minor bigint not null default 0 check (amount_paid_minor >= 0),
  amount_refunded_minor bigint not null default 0 check (amount_refunded_minor >= 0),
  voided_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (demo_session_id, invoice_id)
);

alter table public.billing_demo_session_overrides enable row level security;
alter table public.billing_demo_session_overrides force row level security;
revoke all on public.billing_demo_session_overrides from public, anon, authenticated;
grant all on public.billing_demo_session_overrides to service_role;
grant select on public.billing_demo_session_overrides to authenticated;

drop policy if exists billing_demo_overrides_select on public.billing_demo_session_overrides;
create policy billing_demo_overrides_select on public.billing_demo_session_overrides
  for select to authenticated
  using (exists (select 1 from public.billing_invoices i where i.id = invoice_id));

-- 3. Clean up any non-seed test invoices from canonical baseline and restore canonical seed states
select set_config('app.allow_demo_reset', 'true', true);
delete from public.billing_invoices where source <> 'seed' and demo_session_id = 'canonical';

update public.billing_invoices set status = 'sent', amount_paid_minor = 0, amount_refunded_minor = 0, paid_at = null, voided_at = null
 where invoice_number in ('PPB-INV-2026-1001', 'PPB-INV-2026-1002', 'PPB-INV-2026-1004');
update public.billing_invoices set status = 'paid', amount_paid_minor = 12500, amount_refunded_minor = 0, voided_at = null
 where invoice_number = 'PPB-INV-2026-1003';
update public.billing_invoices set status = 'void', amount_paid_minor = 0, amount_refunded_minor = 0, paid_at = null
 where invoice_number = 'PPB-INV-2026-1005';
update public.billing_invoices set status = 'refunded', amount_paid_minor = 4500, amount_refunded_minor = 4500, voided_at = null
 where invoice_number = 'PPB-INV-2026-1006';
select set_config('app.allow_demo_reset', 'false', true);

-- 4. Update billing_create_invoice to support p_demo_session_id and abuse-prevention row cap
create or replace function public.billing_create_invoice(
  p_recipient uuid,
  p_items jsonb,
  p_due_date date,
  p_send boolean default false,
  p_idempotency_key text default null,
  p_ai_proposal_id uuid default null,
  p_demo_session_id text default 'canonical'
) returns public.billing_invoices
language plpgsql security definer set search_path = public as $$
declare
  v_is_service boolean := (auth.uid() is null);
  v_uid uuid := coalesce(auth.uid(), '11111111-1111-4111-8111-111111111101'::uuid);
  v_org uuid;
  v_inv public.billing_invoices;
  v_item jsonb;
  v_cat public.billing_service_catalog;
  v_qty int;
  v_unit bigint;
  v_total bigint := 0;
  v_pos int := 0;
  v_prop public.billing_ai_proposals;
  v_guard jsonb;
  v_sess text := coalesce(nullif(btrim(p_demo_session_id), ''), 'canonical');
  v_session_count int := 0;
begin
  if not v_is_service and not public.billing_caller_is_provider() then
    raise exception 'Only providers can create invoices' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    select * into v_inv from public.billing_invoices where issuer_user_id = v_uid and idempotency_key = p_idempotency_key;
    if found then return v_inv; end if;
  end if;
  select count(*) into v_session_count from public.billing_invoices where demo_session_id = v_sess and source <> 'seed';
  if v_session_count >= 35 then
    raise exception 'Demo session invoice limit reached (35 custom invoices per session). Please click Reset Demo to clear your session.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.billing_customer_links l
                  where l.provider_user_id = v_uid and l.customer_user_id = p_recipient and l.revoked_at is null and l.status = 'active') then
    raise exception 'Recipient is not an authorized customer of this provider' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'Invoice must have between 1 and 20 line items' using errcode = '22023';
  end if;
  if p_due_date is null or p_due_date < current_date or p_due_date > current_date + 365 then
    raise exception 'Due date must be within the next 365 days' using errcode = '22023';
  end if;

  if v_is_service then
    select id into v_org from public.billing_organizations where owner_user_id = v_uid limit 1;
    v_org := coalesce(v_org, '00000000-0000-4000-8000-000000000001'::uuid);
  else
    v_org := public.billing_ensure_org();
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_cat from public.billing_service_catalog where code = v_item->>'service_code' and active;
    if not found then raise exception 'Unknown service code %', v_item->>'service_code' using errcode = '22023'; end if;
    v_qty := coalesce((v_item->>'quantity')::int, 1);
    v_unit := coalesce((v_item->>'unit_amount_minor')::bigint, v_cat.default_amount_minor);
    if v_qty not between 1 and 20 or v_unit not between 100 and 1000000 then
      raise exception 'Invalid quantity or amount' using errcode = '22023';
    end if;
    v_total := v_total + v_qty * v_unit;
  end loop;
  if v_total not between 100 and 1000000 then
    raise exception 'Invoice total must be between $1.00 and $10,000.00' using errcode = '22023';
  end if;

  if p_ai_proposal_id is not null then
    select * into v_prop from public.billing_ai_proposals where id = p_ai_proposal_id and user_id = v_uid for update;
    if not found or v_prop.kind <> 'create_invoice' or (v_prop.status <> 'approved' and not (v_is_service and v_prop.status = 'pending')) then
      raise exception 'AI proposal must be approved by its owner before execution' using errcode = '42501';
    end if;
    v_guard := public.billing_ai_guardrail_check(v_uid, v_total, p_ai_proposal_id);
    if not (v_guard->>'passed')::boolean then
      update public.billing_ai_proposals set status = 'blocked', guardrail_result = v_guard where id = v_prop.id;
      raise exception 'AI guardrail limit exceeded' using errcode = '42501';
    end if;
  end if;

  insert into public.billing_invoices (
    invoice_number, organization_id, issuer_user_id, recipient_user_id, status, subtotal_minor, total_minor,
    due_date, source, ai_proposal_id, idempotency_key, sent_at, demo_session_id)
  values (
    'PPB-INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.billing_invoice_number_seq')::text, 4, '0'),
    v_org, v_uid, p_recipient, case when p_send then 'sent' else 'draft' end, v_total, v_total,
    p_due_date, case when p_ai_proposal_id is null then 'manual' else 'ai_proposal' end, p_ai_proposal_id,
    p_idempotency_key, case when p_send then now() end, v_sess)
  returning * into v_inv;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_cat from public.billing_service_catalog where code = v_item->>'service_code';
    insert into public.billing_invoice_items (invoice_id, service_code, description, quantity, unit_amount_minor, position)
    values (v_inv.id, v_cat.code, v_cat.title || ' — ' || v_cat.description, coalesce((v_item->>'quantity')::int, 1),
            coalesce((v_item->>'unit_amount_minor')::bigint, v_cat.default_amount_minor), v_pos);
    v_pos := v_pos + 1;
  end loop;

  insert into public.billing_audit_events (organization_id, invoice_id, actor_user_id, actor_kind, event_type, details, demo_session_id)
  values (
    v_org, v_inv.id, v_uid, 'user',
    case when p_send then 'invoice_created_and_sent' else 'invoice_draft_created' end,
    jsonb_build_object('invoice_number', v_inv.invoice_number, 'total_minor', v_total, 'currency', 'USD', 'ai_proposal_id', p_ai_proposal_id),
    v_sess
  );

  if p_ai_proposal_id is not null then
    update public.billing_ai_proposals set status = 'executed', result_ref = v_inv.id,
      result_summary = 'Invoice ' || v_inv.invoice_number || case when p_send then ' sent' else ' saved as draft' end,
      guardrail_result = v_guard
     where id = p_ai_proposal_id;
    insert into public.billing_audit_events (organization_id, invoice_id, actor_user_id, actor_kind, event_type, details, demo_session_id)
    values (v_org, v_inv.id, v_uid, 'ai', 'ai_proposal_executed', jsonb_build_object('proposal_id', p_ai_proposal_id, 'invoice_number', v_inv.invoice_number), v_sess);
  end if;
  return v_inv;
end;
$$;
revoke all on function public.billing_create_invoice(uuid, jsonb, date, boolean, text, uuid, text) from public, anon;
grant execute on function public.billing_create_invoice(uuid, jsonb, date, boolean, text, uuid, text) to authenticated;

-- 5. Session-aware void RPC (protects canonical seed rows when called with a visitor demo_session_id)
create or replace function public.billing_void_invoice(p_invoice uuid, p_demo_session_id text default 'canonical')
returns public.billing_invoices language plpgsql security definer set search_path = public as $$
declare
  v_inv public.billing_invoices;
  v_ovr public.billing_demo_session_overrides;
  v_sess text := coalesce(nullif(btrim(p_demo_session_id), ''), 'canonical');
  v_eff_status text;
  v_eff_paid bigint;
begin
  select * into v_inv from public.billing_invoices where id = p_invoice for update;
  if not found or not public.billing_is_org_member(v_inv.organization_id, array['owner','billing_admin']) then
    raise exception 'Invoice not found' using errcode = '42501';
  end if;

  select * into v_ovr from public.billing_demo_session_overrides
   where demo_session_id = v_sess and invoice_id = p_invoice;

  v_eff_status := coalesce(v_ovr.status, v_inv.status);
  v_eff_paid := coalesce(v_ovr.amount_paid_minor, v_inv.amount_paid_minor);

  if v_eff_status not in ('draft', 'sent') or v_eff_paid > 0 then
    raise exception 'Only unpaid invoices can be voided' using errcode = '22023';
  end if;

  if v_inv.source = 'seed' and v_sess <> 'canonical' then
    insert into public.billing_demo_session_overrides (demo_session_id, invoice_id, status, amount_paid_minor, amount_refunded_minor, voided_at, updated_at)
    values (v_sess, v_inv.id, 'void', 0, 0, now(), now())
    on conflict (demo_session_id, invoice_id) do update
      set status = 'void', voided_at = now(), updated_at = now();
    v_inv.status := 'void';
    v_inv.voided_at := now();
  else
    update public.billing_invoices set status = 'void', voided_at = now(), updated_at = now() where id = p_invoice returning * into v_inv;
  end if;

  insert into public.billing_audit_events (organization_id, invoice_id, actor_user_id, actor_kind, event_type, details, demo_session_id)
  values (v_inv.organization_id, v_inv.id, auth.uid(), 'user', 'invoice_voided', jsonb_build_object('invoice_number', v_inv.invoice_number), v_sess);

  return v_inv;
end;
$$;
revoke all on function public.billing_void_invoice(uuid, text) from public, anon;
grant execute on function public.billing_void_invoice(uuid, text) to authenticated;

-- 6. Send payment reminder RPC
create or replace function public.billing_send_reminder(p_invoice uuid, p_demo_session_id text default 'canonical')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inv public.billing_invoices;
  v_sess text := coalesce(nullif(btrim(p_demo_session_id), ''), 'canonical');
begin
  select * into v_inv from public.billing_invoices where id = p_invoice;
  if not found or not public.billing_is_org_member(v_inv.organization_id) then
    raise exception 'Invoice not found or unauthorized' using errcode = '42501';
  end if;
  if v_inv.status not in ('sent', 'payment_pending') or v_inv.balance_due_minor <= 0 then
    raise exception 'Reminders can only be sent for open unpaid invoices' using errcode = '22023';
  end if;

  insert into public.billing_notifications (user_id, type, title, body, read, created_at, metadata, event_key, demo_session_id)
  values (
    v_inv.recipient_user_id,
    'billing',
    'Payment Reminder: ' || v_inv.invoice_number,
    'Friendly reminder from your provider regarding statement #' || v_inv.invoice_number || ' ($' || trim(to_char(v_inv.balance_due_minor / 100.0, '999990.00')) || ' USD due ' || v_inv.due_date || ').',
    false,
    now(),
    jsonb_build_object('kind', 'invoice_overdue', 'route', '/billing', 'invoiceId', v_inv.id, 'invoiceNumber', v_inv.invoice_number),
    'reminder:' || v_inv.id || ':' || extract(epoch from now())::bigint,
    v_sess
  );

  insert into public.billing_audit_events (organization_id, invoice_id, actor_user_id, actor_kind, event_type, details, demo_session_id)
  values (
    v_inv.organization_id, v_inv.id, auth.uid(), 'user', 'payment_reminder_sent',
    jsonb_build_object('invoice_number', v_inv.invoice_number, 'balance_due_minor', v_inv.balance_due_minor),
    v_sess
  );

  return jsonb_build_object('sent', true, 'invoice_number', v_inv.invoice_number, 'recipient_user_id', v_inv.recipient_user_id);
end;
$$;
revoke all on function public.billing_send_reminder(uuid, text) from public, anon;
grant execute on function public.billing_send_reminder(uuid, text) to authenticated, service_role;

-- 7. Simulate Demo Settlement RPC (explicitly badged as seed_demo / Sample Demo Record when live PayPal credentials are not configured)
create or replace function public.billing_simulate_demo_settlement(p_invoice uuid, p_demo_session_id text default 'canonical')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inv public.billing_invoices;
  v_sess text := coalesce(nullif(btrim(p_demo_session_id), ''), 'canonical');
  v_order_id text := 'SAMPLE-ORD-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_capture_id text := 'SAMPLE-DEMO-SETTLEMENT-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
begin
  select * into v_inv from public.billing_invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found' using errcode = '22023'; end if;
  if auth.uid() is not null and v_inv.recipient_user_id <> auth.uid() and not public.billing_is_org_member(v_inv.organization_id) then
    raise exception 'Not authorized for this invoice' using errcode = '42501';
  end if;
  if v_inv.balance_due_minor <= 0 or v_inv.status in ('paid', 'void', 'refunded') then
    raise exception 'Invoice has no remaining balance due' using errcode = '22023';
  end if;

  if v_inv.source = 'seed' and v_sess <> 'canonical' then
    insert into public.billing_demo_session_overrides (demo_session_id, invoice_id, status, amount_paid_minor, amount_refunded_minor, paid_at, updated_at)
    values (v_sess, v_inv.id, 'paid', v_inv.total_minor, 0, now(), now())
    on conflict (demo_session_id, invoice_id) do update
      set status = 'paid', amount_paid_minor = v_inv.total_minor, paid_at = now(), updated_at = now();
  else
    update public.billing_invoices
       set status = 'paid', amount_paid_minor = total_minor, paid_at = now(), updated_at = now()
     where id = v_inv.id returning * into v_inv;
  end if;

  insert into public.billing_notifications (user_id, type, title, body, read, created_at, metadata, event_key, demo_session_id)
  values
    (v_inv.recipient_user_id, 'billing', 'Sample Demo Payment Recorded',
     'Sample demo settlement recorded for #' || v_inv.invoice_number || ' (Not a live PayPal capture).',
     false, now(), jsonb_build_object('kind', 'payment_confirmed', 'route', '/billing', 'invoiceId', v_inv.id),
     'demo_paid_cust:' || v_inv.id || ':' || v_sess, v_sess),
    (v_inv.issuer_user_id, 'billing', 'Sample Demo Payment Received',
     'Customer completed a sample demo settlement for #' || v_inv.invoice_number || '.',
     false, now(), jsonb_build_object('kind', 'payment_confirmed', 'route', '/billing', 'invoiceId', v_inv.id),
     'demo_paid_prov:' || v_inv.id || ':' || v_sess, v_sess)
  on conflict do nothing;

  insert into public.billing_audit_events (organization_id, invoice_id, actor_user_id, actor_kind, event_type, details, demo_session_id)
  values (
    v_inv.organization_id, v_inv.id, coalesce(auth.uid(), v_inv.recipient_user_id), 'system',
    'demo_settlement_simulated',
    jsonb_build_object('invoice_number', v_inv.invoice_number, 'amount_minor', v_inv.total_minor, 'capture_id', v_capture_id, 'order_id', v_order_id, 'is_live_paypal', false, 'note', 'Sample Demo Record — Not a Live PayPal Capture'),
    v_sess
  );

  return jsonb_build_object(
    'settled', true,
    'is_live_paypal', false,
    'verification_mode', 'seed_demo',
    'invoice_id', v_inv.id,
    'invoice_number', v_inv.invoice_number,
    'amount_minor', v_inv.total_minor,
    'paypal_order_id', v_order_id,
    'paypal_capture_id', v_capture_id,
    'label', 'Sample Demo Record — Not a Live PayPal Capture'
  );
end;
$$;
revoke all on function public.billing_simulate_demo_settlement(uuid, text) from public, anon;
grant execute on function public.billing_simulate_demo_settlement(uuid, text) to authenticated, service_role;

-- 8. Reset Demo Session RPC (restores visitor session or canonical baseline without affecting other visitors)
create or replace function public.billing_reset_demo_session(p_demo_session_id text default 'canonical')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sess text := coalesce(nullif(btrim(p_demo_session_id), ''), 'canonical');
  v_del_invoices int := 0;
  v_del_overrides int := 0;
  v_del_sessions int := 0;
begin
  perform set_config('app.allow_demo_reset', 'true', true);

  delete from public.billing_demo_session_overrides where demo_session_id = v_sess;
  get diagnostics v_del_overrides = row_count;

  delete from public.billing_invoices where demo_session_id = v_sess and source <> 'seed';
  get diagnostics v_del_invoices = row_count;

  delete from public.billing_ai_sessions where demo_session_id = v_sess;
  get diagnostics v_del_sessions = row_count;

  delete from public.billing_ai_proposals where demo_session_id = v_sess;
  delete from public.billing_notifications where demo_session_id = v_sess;
  delete from public.billing_audit_events where demo_session_id = v_sess and actor_kind <> 'paypal';

  delete from public.billing_invoices where demo_session_id = 'canonical' and source <> 'seed';
  update public.billing_invoices set status = 'sent', amount_paid_minor = 0, amount_refunded_minor = 0, paid_at = null, voided_at = null
   where invoice_number in ('PPB-INV-2026-1001', 'PPB-INV-2026-1002', 'PPB-INV-2026-1004') and source = 'seed';
  update public.billing_invoices set status = 'paid', amount_paid_minor = 12500, amount_refunded_minor = 0, voided_at = null
   where invoice_number = 'PPB-INV-2026-1003' and source = 'seed';
  update public.billing_invoices set status = 'void', amount_paid_minor = 0, amount_refunded_minor = 0, paid_at = null
   where invoice_number = 'PPB-INV-2026-1005' and source = 'seed';
  update public.billing_invoices set status = 'refunded', amount_paid_minor = 4500, amount_refunded_minor = 4500, voided_at = null
   where invoice_number = 'PPB-INV-2026-1006' and source = 'seed';

  perform set_config('app.allow_demo_reset', 'false', true);

  return jsonb_build_object(
    'reset', true,
    'demo_session_id', v_sess,
    'deleted_session_invoices', v_del_invoices,
    'deleted_session_overrides', v_del_overrides,
    'deleted_ai_sessions', v_del_sessions,
    'canonical_seed_invoices', 6
  );
end;
$$;
revoke all on function public.billing_reset_demo_session(text) from public, anon;
grant execute on function public.billing_reset_demo_session(text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- 9. Simulate Demo Refund RPC
create or replace function public.billing_simulate_demo_refund(
  p_invoice uuid,
  p_amount_minor bigint default null,
  p_demo_session_id text default 'canonical'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inv public.billing_invoices;
  v_ovr public.billing_demo_session_overrides;
  v_sess text := coalesce(nullif(btrim(p_demo_session_id), ''), 'canonical');
  v_eff_status text;
  v_eff_paid bigint;
  v_eff_refunded bigint;
  v_refund_amt bigint;
  v_new_refunded bigint;
  v_new_status text;
  v_refund_ref text := 'SAMPLE-DEMO-REFUND-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
begin
  select * into v_inv from public.billing_invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found' using errcode = '22023'; end if;
  if auth.uid() is not null and not public.billing_is_org_member(v_inv.organization_id, array['owner','billing_admin','provider']) then
    raise exception 'Only the issuing provider can refund an invoice' using errcode = '42501';
  end if;

  select * into v_ovr from public.billing_demo_session_overrides
   where demo_session_id = v_sess and invoice_id = p_invoice;

  v_eff_status := coalesce(v_ovr.status, v_inv.status);
  v_eff_paid := coalesce(v_ovr.amount_paid_minor, v_inv.amount_paid_minor);
  v_eff_refunded := coalesce(v_ovr.amount_refunded_minor, v_inv.amount_refunded_minor);

  if v_eff_paid <= v_eff_refunded or v_eff_status not in ('paid', 'partially_refunded') then
    raise exception 'Invoice does not have unrefunded paid funds eligible for refund' using errcode = '22023';
  end if;

  v_refund_amt := coalesce(p_amount_minor, v_eff_paid - v_eff_refunded);
  if v_refund_amt <= 0 or v_refund_amt > (v_eff_paid - v_eff_refunded) then
    raise exception 'Refund amount must be between $0.01 and the remaining paid amount' using errcode = '22023';
  end if;

  v_new_refunded := v_eff_refunded + v_refund_amt;
  v_new_status := case when v_new_refunded >= v_eff_paid then 'refunded' else 'partially_refunded' end;

  if v_inv.source = 'seed' and v_sess <> 'canonical' then
    insert into public.billing_demo_session_overrides (demo_session_id, invoice_id, status, amount_paid_minor, amount_refunded_minor, paid_at, updated_at)
    values (v_sess, v_inv.id, v_new_status, v_eff_paid, v_new_refunded, coalesce(v_ovr.paid_at, v_inv.paid_at, now()), now())
    on conflict (demo_session_id, invoice_id) do update
      set status = v_new_status, amount_refunded_minor = v_new_refunded, updated_at = now();
  else
    update public.billing_invoices
       set status = v_new_status, amount_refunded_minor = v_new_refunded, updated_at = now()
     where id = v_inv.id;
  end if;

  insert into public.billing_notifications (user_id, type, title, body, read, created_at, metadata, event_key, demo_session_id)
  values (
    v_inv.recipient_user_id, 'billing', 'Refund Completed: ' || v_inv.invoice_number,
    'A refund of $' || trim(to_char(v_refund_amt / 100.0, '999990.00')) || ' USD was processed for statement #' || v_inv.invoice_number || '.',
    false, now(), jsonb_build_object('kind', 'refund_completed', 'route', '/billing', 'invoiceId', v_inv.id),
    'demo_refund:' || v_inv.id || ':' || v_sess || ':' || v_new_refunded, v_sess
  ) on conflict do nothing;

  insert into public.billing_audit_events (organization_id, invoice_id, actor_user_id, actor_kind, event_type, details, demo_session_id)
  values (
    v_inv.organization_id, v_inv.id, coalesce(auth.uid(), v_inv.issuer_user_id), 'user',
    'refund_completed',
    jsonb_build_object('invoice_number', v_inv.invoice_number, 'amount_minor', v_refund_amt, 'refund_id', v_refund_ref, 'status', v_new_status),
    v_sess
  );

  return jsonb_build_object(
    'refunded', true,
    'invoice_id', v_inv.id,
    'invoice_number', v_inv.invoice_number,
    'refund_amount_minor', v_refund_amt,
    'total_refunded_minor', v_new_refunded,
    'status', v_new_status,
    'paypal_refund_id', v_refund_ref
  );
end;
$$;
revoke all on function public.billing_simulate_demo_refund(uuid, bigint, text) from public, anon;
grant execute on function public.billing_simulate_demo_refund(uuid, bigint, text) to authenticated, service_role;
