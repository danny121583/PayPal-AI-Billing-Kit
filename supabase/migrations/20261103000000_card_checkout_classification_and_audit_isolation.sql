-- =============================================================================
-- Migration: 20261103000000_card_checkout_classification_and_audit_isolation.sql
-- Purpose:
--   1. Payment-attempt classification (awaiting_buyer_approval, approval_required,
--      payment_declined, buyer_canceled, authorized, captured, refunded, processing_error)
--   2. Reclassify ORDER_NOT_APPROVED (HTTP_422) attempts from 'failed' to 'approval_required'
--      while preserving original failure_code & failure_message metadata for auditing
--   3. Harden billing_log, billing_apply_verified_capture, and billing_apply_refund_result
--      so session-scoped events always record their true demo_session_id
--   4. Preserve append-only immutability on billing_audit_events (zero historical mutations)
-- =============================================================================

-- 1. Expand billing_payment_attempts columns & status check constraint
alter table public.billing_payment_attempts
  add column if not exists attempt_classification text,
  add column if not exists payment_source_type text not null default 'paypal_wallet',
  add column if not exists paypal_error_code text,
  add column if not exists actionable_message text,
  add column if not exists card_brand text,
  add column if not exists card_last_digits text,
  add column if not exists processor_response_code text,
  add column if not exists demo_session_id text not null default 'canonical';

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'billing_payment_attempts'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.billing_payment_attempts drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.billing_payment_attempts
  add constraint billing_payment_attempts_status_check
  check (
    status in (
      'created',
      'approved',
      'capturing',
      'completed',
      'failed',
      'cancelled',
      'expired',
      'awaiting_buyer_approval',
      'approval_required',
      'payment_declined',
      'buyer_canceled',
      'authorized',
      'captured',
      'refunded',
      'processing_error'
    )
  );

alter table public.billing_payment_attempts
  drop constraint if exists billing_payment_attempts_classification_check;

alter table public.billing_payment_attempts
  add constraint billing_payment_attempts_classification_check
  check (
    attempt_classification is null or attempt_classification in (
      'awaiting_buyer_approval',
      'approval_required',
      'payment_declined',
      'buyer_canceled',
      'authorized',
      'captured',
      'refunded',
      'processing_error'
    )
  );

-- Backfill demo_session_id on billing_payment_attempts from parent invoice
update public.billing_payment_attempts a
set demo_session_id = coalesce(i.demo_session_id, 'canonical')
from public.billing_invoices i
where a.invoice_id = i.id
  and a.demo_session_id = 'canonical'
  and i.demo_session_id <> 'canonical';

update public.billing_payment_attempts a
set demo_session_id = coalesce(
  nullif(trim(e.details->>'demo_session_id'), ''),
  'legacy-playwright-probe'
)
from public.billing_audit_events e
where e.event_type = 'paypal_order_created'
  and e.details->>'order_id' = a.paypal_order_id
  and a.demo_session_id = 'canonical'
  and a.paypal_order_id <> 'DEMO-ORD-DECLINED-1004';

-- Reclassify premature capture attempts (HTTP_422 ORDER_NOT_APPROVED, including Order 02M869433T525841J on PPB-INV-2026-1069)
-- Preserves original failure_code ('HTTP_422') and failure_message for audit history
update public.billing_payment_attempts
set
  status = 'approval_required',
  attempt_classification = 'approval_required',
  paypal_error_code = 'ORDER_NOT_APPROVED',
  actionable_message = 'PayPal is waiting for buyer approval. Complete Sandbox checkout before capturing this payment.',
  updated_at = now()
where
  (failure_message ilike '%ORDER_NOT_APPROVED%' or paypal_error_code = 'ORDER_NOT_APPROVED')
  and status in ('failed', 'created', 'approval_required');

-- Backfill remaining classifications
update public.billing_payment_attempts
set
  attempt_classification = 'awaiting_buyer_approval',
  actionable_message = coalesce(
    actionable_message,
    'PayPal is waiting for buyer approval. Complete Sandbox checkout before capturing this payment.'
  )
where status in ('created', 'awaiting_buyer_approval')
  and attempt_classification is null;

update public.billing_payment_attempts
set
  attempt_classification = 'payment_declined',
  paypal_error_code = coalesce(paypal_error_code, failure_code, 'INSTRUMENT_DECLINED'),
  actionable_message = coalesce(
    actionable_message,
    'Payment instrument was declined by PayPal or the card issuer. Please retry with a valid payment method.'
  )
where status in ('failed', 'payment_declined')
  and attempt_classification is null;

update public.billing_payment_attempts
set
  attempt_classification = 'buyer_canceled',
  paypal_error_code = coalesce(paypal_error_code, 'BUYER_CANCELED'),
  actionable_message = coalesce(
    actionable_message,
    'Buyer canceled PayPal Sandbox checkout before authorizing payment.'
  )
where status in ('cancelled', 'buyer_canceled')
  and attempt_classification is null;

update public.billing_payment_attempts
set
  attempt_classification = 'authorized',
  actionable_message = coalesce(
    actionable_message,
    'Payment is authorized in PayPal Sandbox and ready for capture.'
  )
where status in ('approved', 'authorized')
  and attempt_classification is null;

update public.billing_payment_attempts a
set
  attempt_classification = case
    when exists (
      select 1 from public.billing_invoices i
      where i.id = a.invoice_id and i.status = 'refunded'
    ) then 'refunded'
    else 'captured'
  end,
  actionable_message = case
    when exists (
      select 1 from public.billing_invoices i
      where i.id = a.invoice_id and i.status = 'refunded'
    ) then 'Payment was captured and subsequently refunded.'
    else 'Payment capture verified.'
  end
where a.status in ('completed', 'captured', 'refunded')
  and a.attempt_classification is null;

-- 2. Harden public.billing_log to resolve and persist demo_session_id
drop function if exists public.billing_log(uuid, uuid, uuid, text, text, jsonb);

create or replace function public.billing_log(
  p_org uuid,
  p_invoice uuid,
  p_actor uuid,
  p_kind text,
  p_type text,
  p_details jsonb default '{}'::jsonb,
  p_demo_session_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session text;
  v_inv_session text;
  v_prop_session text;
begin
  v_session := nullif(trim(coalesce(p_demo_session_id, '')), '');

  if v_session is null and p_details is not null then
    v_session := nullif(trim(coalesce(p_details->>'demo_session_id', '')), '');
  end if;

  if (v_session is null or v_session = 'canonical') and p_invoice is not null then
    select nullif(trim(demo_session_id), '') into v_inv_session
    from public.billing_invoices
    where id = p_invoice;
    if v_inv_session is not null and v_inv_session <> 'canonical' then
      v_session := v_inv_session;
    end if;
  end if;

  if (v_session is null or v_session = 'canonical') and p_details is not null then
    if (p_details ? 'proposal_id') or (p_details ? 'ai_proposal_id') then
      select nullif(trim(demo_session_id), '') into v_prop_session
      from public.billing_ai_proposals
      where id::text = coalesce(p_details->>'proposal_id', p_details->>'ai_proposal_id')
      limit 1;
      if v_prop_session is not null and v_prop_session <> 'canonical' then
        v_session := v_prop_session;
      end if;
    end if;
  end if;

  insert into public.billing_audit_events (
    organization_id,
    invoice_id,
    actor_user_id,
    actor_kind,
    event_type,
    details,
    demo_session_id
  ) values (
    p_org,
    p_invoice,
    p_actor,
    p_kind,
    p_type,
    coalesce(p_details, '{}'::jsonb),
    coalesce(v_session, 'canonical')
  );
end;
$$;

-- 3. Update billing_apply_verified_capture to record classification='captured' & session isolation
drop function if exists public.billing_apply_verified_capture(uuid, uuid, text, text, integer, text, text, text, text);

create or replace function public.billing_apply_verified_capture(
  p_invoice uuid, p_payer uuid, p_order_id text, p_capture_id text, p_amount_minor bigint,
  p_currency text, p_paypal_status text, p_payer_email_masked text, p_verified_via text
) returns public.billing_transactions
language plpgsql security definer set search_path = public as $$
declare
  v_inv public.billing_invoices;
  v_tx public.billing_transactions;
begin
  select * into v_tx from public.billing_transactions where paypal_capture_id = p_capture_id;
  if found then
    if p_verified_via = 'webhook' and v_tx.webhook_reconciled_at is null then
      update public.billing_transactions set webhook_reconciled_at = now() where id = v_tx.id returning * into v_tx;
      perform public.billing_log(v_tx.organization_id, v_tx.invoice_id, null, 'paypal', 'webhook_reconciled', jsonb_build_object('capture_id', p_capture_id));
    end if;
    return v_tx;
  end if;
  if upper(coalesce(p_paypal_status, '')) <> 'COMPLETED' then
    raise exception 'Capture not completed (%)', p_paypal_status using errcode = '22023';
  end if;
  select * into v_inv from public.billing_invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found' using errcode = '22023'; end if;
  if v_inv.recipient_user_id <> p_payer then raise exception 'Payer mismatch' using errcode = '42501'; end if;
  if upper(p_currency) <> v_inv.currency or p_amount_minor <> v_inv.balance_due_minor then
    raise exception 'Captured amount % % does not match balance due % %', p_amount_minor, p_currency, v_inv.balance_due_minor, v_inv.currency using errcode = '22023';
  end if;

  insert into public.billing_transactions (invoice_id, organization_id, payer_user_id, paypal_order_id, paypal_capture_id,
    amount_minor, currency, paypal_status, payer_email_masked, verified_via, webhook_reconciled_at)
  values (v_inv.id, v_inv.organization_id, p_payer, p_order_id, p_capture_id, p_amount_minor, upper(p_currency),
    'COMPLETED', p_payer_email_masked, p_verified_via, case when p_verified_via = 'webhook' then now() end)
  returning * into v_tx;

  update public.billing_invoices
     set amount_paid_minor = amount_paid_minor + p_amount_minor, status = 'paid', paid_at = now(),
         paypal_order_id = coalesce(paypal_order_id, p_order_id), updated_at = now()
   where id = v_inv.id;

  update public.billing_payment_attempts
     set status = 'captured',
         attempt_classification = 'captured',
         actionable_message = 'Verified PayPal Sandbox capture completed.',
         updated_at = now()
   where paypal_order_id = p_order_id;

  perform public.billing_log(
    v_inv.organization_id, v_inv.id, p_payer, 'paypal', 'payment_captured_verified',
    jsonb_build_object(
      'order_id', p_order_id,
      'capture_id', p_capture_id,
      'amount_minor', p_amount_minor,
      'currency', upper(p_currency),
      'verified_via', p_verified_via,
      'demo_session_id', coalesce(v_inv.demo_session_id, 'canonical')
    ),
    coalesce(v_inv.demo_session_id, 'canonical')
  );
  return v_tx;
end;
$$;
revoke all on function public.billing_apply_verified_capture(uuid, uuid, text, text, bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.billing_apply_verified_capture(uuid, uuid, text, text, bigint, text, text, text, text) to service_role;

-- 4. Update billing_apply_refund_result to record classification='refunded' & session isolation
create or replace function public.billing_apply_refund_result(
  p_refund uuid, p_status text, p_paypal_refund_id text default null, p_failure text default null
) returns public.billing_refunds
language plpgsql security definer set search_path = public as $$
declare v_r public.billing_refunds; v_inv public.billing_invoices;
begin
  select * into v_r from public.billing_refunds where id = p_refund for update;
  if not found then raise exception 'Refund not found'; end if;
  if v_r.status = 'completed' then return v_r; end if;
  update public.billing_refunds set status = p_status, paypal_refund_id = coalesce(p_paypal_refund_id, paypal_refund_id),
    failure_message = p_failure, completed_at = case when p_status = 'completed' then now() end
   where id = p_refund returning * into v_r;
  if p_status = 'completed' then
    update public.billing_invoices
       set amount_refunded_minor = amount_refunded_minor + v_r.amount_minor,
           status = case when amount_refunded_minor + v_r.amount_minor >= amount_paid_minor then 'refunded' else 'partially_refunded' end,
           updated_at = now()
     where id = v_r.invoice_id returning * into v_inv;
    update public.billing_payment_attempts
       set status = 'refunded',
           attempt_classification = 'refunded',
           actionable_message = 'Payment was captured and subsequently refunded via PayPal Sandbox.',
           updated_at = now()
     where invoice_id = v_inv.id
       and status in ('completed', 'captured');
  else
    select * into v_inv from public.billing_invoices where id = v_r.invoice_id;
  end if;
  perform public.billing_log(
    v_inv.organization_id, v_inv.id, v_r.requested_by, 'paypal', 'refund_' || p_status,
    jsonb_build_object(
      'refund_id', v_r.id,
      'paypal_refund_id', p_paypal_refund_id,
      'amount_minor', v_r.amount_minor,
      'demo_session_id', coalesce(v_inv.demo_session_id, 'canonical')
    ),
    coalesce(v_inv.demo_session_id, 'canonical')
  );
  return v_r;
end;
$$;
revoke all on function public.billing_apply_refund_result(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.billing_apply_refund_result(uuid, text, text, text) to service_role;
