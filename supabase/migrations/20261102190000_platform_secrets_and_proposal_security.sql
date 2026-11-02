-- Migration: Platform Secrets Table (service_role only) for Edge Functions
-- Allows Edge Functions on dvzfesfvefggnunkjhom to read GEMINI_API_KEY and PayPal Sandbox credentials
-- securely with zero public/anon/authenticated access.

create table if not exists public.billing_platform_secrets (
  secret_key text primary key,
  secret_value text not null,
  updated_at timestamptz not null default now()
);

alter table public.billing_platform_secrets enable row level security;
alter table public.billing_platform_secrets force row level security;

revoke all on public.billing_platform_secrets from public, anon, authenticated;
grant all on public.billing_platform_secrets to service_role;

-- Update billing_apply_verified_capture and billing_apply_refund_result to emit billing_notify rows
create or replace function public.billing_apply_verified_capture(
  p_invoice uuid,
  p_payer uuid,
  p_order_id text,
  p_capture_id text,
  p_amount_minor bigint,
  p_currency text,
  p_paypal_status text,
  p_payer_email_masked text,
  p_verified_via text
) returns public.billing_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.billing_invoices;
  v_tx public.billing_transactions;
  v_amount_usd text;
begin
  select * into v_tx from public.billing_transactions where paypal_capture_id = p_capture_id;
  if found then
    if p_verified_via = 'webhook' and v_tx.webhook_reconciled_at is null then
      update public.billing_transactions set webhook_reconciled_at = now() where id = v_tx.id returning * into v_tx;
      perform public.billing_log(v_tx.organization_id, v_tx.invoice_id, null, 'paypal', 'webhook_reconciled', jsonb_build_object('capture_id', p_capture_id));
    end if;
    return v_tx;
  end if;
  if p_paypal_status <> 'COMPLETED' then
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
    p_paypal_status, p_payer_email_masked, p_verified_via, case when p_verified_via = 'webhook' then now() end)
  returning * into v_tx;

  update public.billing_invoices
     set amount_paid_minor = amount_paid_minor + p_amount_minor, status = 'paid', paid_at = now(),
         paypal_order_id = coalesce(paypal_order_id, p_order_id), updated_at = now()
   where id = v_inv.id;
  update public.billing_payment_attempts set status = 'completed', updated_at = now() where paypal_order_id = p_order_id;

  v_amount_usd := '$' || trim(to_char(p_amount_minor::numeric / 100.0, '999999990.00'));

  perform public.billing_notify(
    v_inv.recipient_user_id,
    'paid:' || p_capture_id || ':recipient',
    'PayPal Payment Confirmed (' || v_amount_usd || ')',
    'Statement #' || v_inv.invoice_number || ' was settled via PayPal Sandbox (Capture ' || p_capture_id || '). Remaining balance is $0.00.',
    v_inv.id,
    'payment_confirmed'
  );

  perform public.billing_notify(
    v_inv.issuer_user_id,
    'paid:' || p_capture_id || ':issuer',
    'Customer Payment Captured (' || v_amount_usd || ')',
    'Statement #' || v_inv.invoice_number || ' was paid via PayPal Sandbox (Capture ' || p_capture_id || ').',
    v_inv.id,
    'payment_confirmed'
  );

  perform public.billing_log(v_inv.organization_id, v_inv.id, p_payer, 'paypal', 'payment_captured_verified',
    jsonb_build_object('order_id', p_order_id, 'capture_id', p_capture_id, 'amount_minor', p_amount_minor, 'currency', upper(p_currency), 'verified_via', p_verified_via));
  return v_tx;
end;
$$;

create or replace function public.billing_apply_refund_result(
  p_refund uuid,
  p_status text,
  p_paypal_refund_id text,
  p_failure text default null
) returns public.billing_refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r public.billing_refunds;
  v_inv public.billing_invoices;
  v_amount_usd text;
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

    v_amount_usd := '$' || trim(to_char(v_r.amount_minor::numeric / 100.0, '999999990.00'));

    perform public.billing_notify(
      v_inv.recipient_user_id,
      'refund:' || coalesce(p_paypal_refund_id, v_r.id::text) || ':recipient',
      'PayPal Refund Issued (' || v_amount_usd || ')',
      'A refund of ' || v_amount_usd || ' USD was processed for Statement #' || v_inv.invoice_number || ' (Refund ID ' || coalesce(p_paypal_refund_id, 'N/A') || ').',
      v_inv.id,
      'refund_completed'
    );
  else
    select * into v_inv from public.billing_invoices where id = v_r.invoice_id;
  end if;
  perform public.billing_log(v_inv.organization_id, v_inv.id, v_r.requested_by, 'paypal', 'refund_' || p_status,
    jsonb_build_object('refund_id', v_r.id, 'paypal_refund_id', p_paypal_refund_id, 'amount_minor', v_r.amount_minor));
  return v_r;
end;
$$;
