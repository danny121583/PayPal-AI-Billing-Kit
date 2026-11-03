-- ============================================================================
-- Migration: 20261103120000_billing_notification_ownership_and_isolation.sql
-- Purpose:   Issue #15 — Strict Customer Notification Ownership, Cross-Customer
--            Isolation, Linked-Statement Verification, and Demo Reset Hygiene.
-- ============================================================================

begin;

-- 1. Enrich billing_notifications with explicit invoice_id, organization_id,
--    and recipient_role columns so notification ownership can be verified
--    directly against billing_invoices without relying solely on untyped JSON.
alter table public.billing_notifications
  add column if not exists invoice_id uuid references public.billing_invoices(id) on delete cascade,
  add column if not exists organization_id uuid references public.billing_organizations(id) on delete cascade,
  add column if not exists recipient_role text check (recipient_role in ('doctor', 'patient'));

-- Backfill invoice_id, organization_id, and recipient_role from metadata where present
update public.billing_notifications n
set
  invoice_id = i.id,
  organization_id = i.organization_id,
  recipient_role = case
    when n.user_id = i.issuer_user_id then 'doctor'
    else 'patient'
  end
from public.billing_invoices i
where n.invoice_id is null
  and (
    (n.metadata ? 'invoiceId' and n.metadata->>'invoiceId' = i.id::text)
    or (n.metadata ? 'invoiceNumber' and upper(n.metadata->>'invoiceNumber') = upper(i.invoice_number))
  );

create index if not exists billing_notifications_user_session_idx
  on public.billing_notifications (user_id, demo_session_id, created_at desc);

create index if not exists billing_notifications_invoice_id_idx
  on public.billing_notifications (invoice_id);

-- 2. Helper function to deterministically reconcile canonical seed notifications
--    so notification user_id strictly matches the authoritative invoice owner:
--    - PPB-INV-2026-1001 ($150.00, Sent/Pending)   -> Alex Rivera (11111111-1111-4111-8111-111111111102)
--    - PPB-INV-2026-1002 ($75.00,  Overdue)        -> Alex Rivera (11111111-1111-4111-8111-111111111102)
--    - PPB-INV-2026-1003 ($125.00, Paid)           -> Alex Rivera (11111111-1111-4111-8111-111111111102)
--    - PPB-INV-2026-1004 ($50.00,  Payment Failed) -> Jordan Taylor (11111111-1111-4111-8111-111111111103)
--    - PPB-INV-2026-1005 ($35.00,  Voided)         -> Jordan Taylor (11111111-1111-4111-8111-111111111103)
--    - PPB-INV-2026-1006 ($45.00,  Refunded)       -> Alex Rivera (11111111-1111-4111-8111-111111111102)
create or replace function public.billing_seed_canonical_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Remove any polluted or cross-customer canonical notifications
  delete from public.billing_notifications
  where demo_session_id = 'canonical';

  insert into public.billing_notifications (
    user_id,
    type,
    invoice_id,
    organization_id,
    recipient_role,
    title,
    body,
    read,
    metadata,
    event_key,
    demo_session_id
  )
  values
    -- Provider (Dr. Sarah Jenkins) practice notifications
    (
      '11111111-1111-4111-8111-111111111101',
      'billing',
      '33333333-3333-4333-8333-333333333303',
      '22222222-2222-4222-8222-222222222201',
      'doctor',
      'Payment received',
      'A customer payment ($125.00 USD) was received for invoice PPB-INV-2026-1003 (Alex Rivera).',
      false,
      jsonb_build_object(
        'kind', 'payment_confirmed',
        'route', '/billing?invoiceId=33333333-3333-4333-8333-333333333303',
        'invoiceId', '33333333-3333-4333-8333-333333333303',
        'invoiceNumber', 'PPB-INV-2026-1003',
        'recipientUserId', '11111111-1111-4111-8111-111111111102'
      ),
      'seed_doc_payment_confirmed:33333333-3333-4333-8333-333333333303',
      'canonical'
    ),
    (
      '11111111-1111-4111-8111-111111111101',
      'billing',
      '33333333-3333-4333-8333-333333333302',
      '22222222-2222-4222-8222-222222222201',
      'doctor',
      'Overdue statement alert',
      'Statement PPB-INV-2026-1002 ($75.00 USD for Alex Rivera) is past due.',
      false,
      jsonb_build_object(
        'kind', 'invoice_overdue',
        'route', '/billing?invoiceId=33333333-3333-4333-8333-333333333302',
        'invoiceId', '33333333-3333-4333-8333-333333333302',
        'invoiceNumber', 'PPB-INV-2026-1002',
        'recipientUserId', '11111111-1111-4111-8111-111111111102'
      ),
      'seed_doc_invoice_overdue:33333333-3333-4333-8333-333333333302',
      'canonical'
    ),
    (
      '11111111-1111-4111-8111-111111111101',
      'billing',
      '33333333-3333-4333-8333-333333333304',
      '22222222-2222-4222-8222-222222222201',
      'doctor',
      'Payment attempt declined',
      'A card payment attempt on statement PPB-INV-2026-1004 ($50.00 USD for Jordan Taylor) was declined.',
      false,
      jsonb_build_object(
        'kind', 'payment_failed',
        'route', '/billing?invoiceId=33333333-3333-4333-8333-333333333304',
        'invoiceId', '33333333-3333-4333-8333-333333333304',
        'invoiceNumber', 'PPB-INV-2026-1004',
        'recipientUserId', '11111111-1111-4111-8111-111111111103'
      ),
      'seed_doc_payment_failed:33333333-3333-4333-8333-333333333304',
      'canonical'
    ),
    -- Customer #1 (Alex Rivera) notifications — ONLY Alex Rivera's statements (1002, 1001, 1003, 1006)
    (
      '11111111-1111-4111-8111-111111111102',
      'billing',
      '33333333-3333-4333-8333-333333333302',
      '22222222-2222-4222-8222-222222222201',
      'patient',
      'Overdue statement reminder',
      'Statement PPB-INV-2026-1002 ($75.00 USD) from Dr. Sarah Jenkins is overdue.',
      false,
      jsonb_build_object(
        'kind', 'invoice_overdue',
        'route', '/billing?invoiceId=33333333-3333-4333-8333-333333333302',
        'invoiceId', '33333333-3333-4333-8333-333333333302',
        'invoiceNumber', 'PPB-INV-2026-1002',
        'recipientUserId', '11111111-1111-4111-8111-111111111102'
      ),
      'seed_alex_invoice_overdue:33333333-3333-4333-8333-333333333302',
      'canonical'
    ),
    (
      '11111111-1111-4111-8111-111111111102',
      'billing',
      '33333333-3333-4333-8333-333333333301',
      '22222222-2222-4222-8222-222222222201',
      'patient',
      'New invoice',
      'You have received a new invoice (PPB-INV-2026-1001 • $150.00 USD) from Dr. Sarah Jenkins.',
      false,
      jsonb_build_object(
        'kind', 'invoice_sent',
        'route', '/billing?invoiceId=33333333-3333-4333-8333-333333333301',
        'invoiceId', '33333333-3333-4333-8333-333333333301',
        'invoiceNumber', 'PPB-INV-2026-1001',
        'recipientUserId', '11111111-1111-4111-8111-111111111102'
      ),
      'seed_alex_invoice_sent:33333333-3333-4333-8333-333333333301',
      'canonical'
    ),
    (
      '11111111-1111-4111-8111-111111111102',
      'billing',
      '33333333-3333-4333-8333-333333333303',
      '22222222-2222-4222-8222-222222222201',
      'patient',
      'Payment confirmed',
      'Your payment ($125.00 USD) for invoice PPB-INV-2026-1003 has been confirmed.',
      false,
      jsonb_build_object(
        'kind', 'payment_confirmed',
        'route', '/billing?invoiceId=33333333-3333-4333-8333-333333333303',
        'invoiceId', '33333333-3333-4333-8333-333333333303',
        'invoiceNumber', 'PPB-INV-2026-1003',
        'recipientUserId', '11111111-1111-4111-8111-111111111102'
      ),
      'seed_alex_payment_confirmed:33333333-3333-4333-8333-333333333303',
      'canonical'
    ),
    (
      '11111111-1111-4111-8111-111111111102',
      'billing',
      '33333333-3333-4333-8333-333333333306',
      '22222222-2222-4222-8222-222222222201',
      'patient',
      'Refund completed',
      'Your $45.00 USD refund for invoice PPB-INV-2026-1006 has been completed.',
      true,
      jsonb_build_object(
        'kind', 'refund_completed',
        'route', '/billing?invoiceId=33333333-3333-4333-8333-333333333306',
        'invoiceId', '33333333-3333-4333-8333-333333333306',
        'invoiceNumber', 'PPB-INV-2026-1006',
        'recipientUserId', '11111111-1111-4111-8111-111111111102'
      ),
      'seed_alex_refund_completed:33333333-3333-4333-8333-333333333306',
      'canonical'
    ),
    -- Customer #2 (Jordan Taylor) notifications — ONLY Jordan Taylor's statement (1004)
    (
      '11111111-1111-4111-8111-111111111103',
      'billing',
      '33333333-3333-4333-8333-333333333304',
      '22222222-2222-4222-8222-222222222201',
      'patient',
      'Payment not completed',
      'Your payment attempt on statement PPB-INV-2026-1004 ($50.00 USD) was declined. Tap to retry.',
      false,
      jsonb_build_object(
        'kind', 'payment_failed',
        'route', '/billing?invoiceId=33333333-3333-4333-8333-333333333304',
        'invoiceId', '33333333-3333-4333-8333-333333333304',
        'invoiceNumber', 'PPB-INV-2026-1004',
        'recipientUserId', '11111111-1111-4111-8111-111111111103'
      ),
      'seed_jordan_payment_failed:33333333-3333-4333-8333-333333333304',
      'canonical'
    )
  on conflict (user_id, event_key) where event_key is not null do update set
    invoice_id = excluded.invoice_id,
    organization_id = excluded.organization_id,
    recipient_role = excluded.recipient_role,
    title = excluded.title,
    body = excluded.body,
    read = excluded.read,
    metadata = excluded.metadata,
    demo_session_id = excluded.demo_session_id;
end;
$$;

-- Execute canonical notification reconciliation immediately
select public.billing_seed_canonical_notifications();

-- Also ensure canonical seed invoice 1004 is restored to its canonical 'sent' (failed attempt) state
update public.billing_invoices
set
  status = 'sent',
  amount_paid_minor = 0,
  amount_refunded_minor = 0,
  paid_at = null,
  voided_at = null,
  due_date = (current_date + 7)
where id = '33333333-3333-4333-8333-333333333304'
  and demo_session_id = 'canonical';

-- 3. Harden billing_notify so future notifications always populate invoice_id,
--    organization_id, and recipient_role and never cross-notify an unrelated customer
create or replace function public.billing_notify(
  p_user uuid,
  p_key text,
  p_title text,
  p_body text,
  p_invoice uuid,
  p_kind text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.billing_ai_settings;
  v_session_id text := 'canonical';
  v_inv_number text := null;
  v_org_id uuid := null;
  v_recipient_id uuid := null;
  v_issuer_id uuid := null;
  v_role text := null;
begin
  s := public.billing_effective_ai_settings(p_user);
  if (p_kind = 'invoice_sent' and not s.notify_new_invoice)
     or (p_kind = 'payment_confirmed' and not s.notify_payment_confirmed)
     or (p_kind = 'payment_failed' and not s.notify_payment_failed)
     or (p_kind = 'invoice_overdue' and not s.notify_overdue)
     or (p_kind = 'refund_completed' and not s.notify_refund) then
    return;
  end if;

  if p_invoice is not null then
    select
      coalesce(nullif(btrim(demo_session_id), ''), 'canonical'),
      invoice_number,
      organization_id,
      recipient_user_id,
      issuer_user_id
    into
      v_session_id,
      v_inv_number,
      v_org_id,
      v_recipient_id,
      v_issuer_id
    from public.billing_invoices
    where id = p_invoice;

    v_session_id := coalesce(v_session_id, 'canonical');

    -- Prevent cross-customer notification creation: p_user must be either the invoice recipient or issuer
    if v_recipient_id is not null and p_user <> v_recipient_id and p_user <> v_issuer_id then
      return;
    end if;

    v_role := case
      when p_user = v_issuer_id then 'doctor'
      else 'patient'
    end;
  end if;

  insert into public.billing_notifications (
    user_id,
    type,
    invoice_id,
    organization_id,
    recipient_role,
    title,
    body,
    read,
    created_at,
    metadata,
    event_key,
    demo_session_id
  )
  values (
    p_user,
    'billing',
    p_invoice,
    v_org_id,
    v_role,
    p_title,
    p_body,
    false,
    now(),
    jsonb_build_object(
      'kind', p_kind,
      'route', case when p_invoice is not null then '/billing?invoiceId=' || p_invoice::text else '/billing' end,
      'invoiceId', p_invoice,
      'invoiceNumber', v_inv_number,
      'recipientUserId', v_recipient_id
    ),
    p_key,
    v_session_id
  )
  on conflict (user_id, event_key) where event_key is not null
  do update set
    invoice_id = excluded.invoice_id,
    organization_id = excluded.organization_id,
    recipient_role = excluded.recipient_role,
    demo_session_id = excluded.demo_session_id,
    metadata = excluded.metadata;
end;
$$;

-- 4. Update billing_reset_demo_session to also re-seed canonical notifications
create or replace function public.billing_reset_demo_session(p_demo_session_id text default 'canonical'::text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  -- Always restore canonical seed notifications and unread counts
  perform public.billing_seed_canonical_notifications();

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

-- 5. Harden RLS policies on billing_notifications to enforce invoice ownership
drop policy if exists billing_notifications_select on public.billing_notifications;
drop policy if exists billing_notifications_select_anon on public.billing_notifications;
create policy billing_notifications_select on public.billing_notifications
  for select using (
    (
      user_id = coalesce(
        auth.uid(),
        '11111111-1111-4111-8111-111111111101'::uuid
      )
      or (
        auth.uid() is null
        and demo_session_id is not null
        and user_id in (
          '11111111-1111-4111-8111-111111111101'::uuid,
          '11111111-1111-4111-8111-111111111102'::uuid,
          '11111111-1111-4111-8111-111111111103'::uuid
        )
      )
    )
    and (
      invoice_id is null
      or exists (
        select 1
        from public.billing_invoices i
        where i.id = billing_notifications.invoice_id
          and (
            i.recipient_user_id = billing_notifications.user_id
            or i.issuer_user_id = billing_notifications.user_id
          )
      )
    )
  );

drop policy if exists billing_notifications_update on public.billing_notifications;
drop policy if exists billing_notifications_update_anon on public.billing_notifications;
create policy billing_notifications_update on public.billing_notifications
  for update using (
    user_id = coalesce(
      auth.uid(),
      '11111111-1111-4111-8111-111111111101'::uuid
    )
    or (
      auth.uid() is null
      and demo_session_id is not null
      and user_id in (
        '11111111-1111-4111-8111-111111111101'::uuid,
        '11111111-1111-4111-8111-111111111102'::uuid,
        '11111111-1111-4111-8111-111111111103'::uuid
      )
    )
  )
  with check (
    invoice_id is null
    or exists (
      select 1
      from public.billing_invoices i
      where i.id = billing_notifications.invoice_id
        and (
          i.recipient_user_id = billing_notifications.user_id
          or i.issuer_user_id = billing_notifications.user_id
        )
    )
  );

-- 6. Authorized Notification Query & Mutation RPCs
create or replace function public.billing_list_authorized_notifications(
  p_user_id uuid,
  p_role_scope text,
  p_demo_session_id text default 'canonical'
)
returns setof public.billing_notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session text := coalesce(nullif(trim(p_demo_session_id), ''), 'canonical');
begin
  if p_user_id is null or p_role_scope not in ('doctor', 'patient') then
    return;
  end if;

  return query
  select n.*
  from public.billing_notifications n
  left join public.billing_invoices i on i.id = coalesce(
    n.invoice_id,
    case
      when (n.metadata->>'invoiceId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (n.metadata->>'invoiceId')::uuid
      else null
    end
  )
  where n.user_id = p_user_id
    and n.demo_session_id in ('canonical', v_session)
    and i.id is not null
    and (
      (p_role_scope = 'patient' and i.recipient_user_id = p_user_id and i.status <> 'draft')
      or (p_role_scope = 'doctor' and i.issuer_user_id = p_user_id)
    )
  order by n.created_at desc;
end;
$$;

create or replace function public.billing_mark_notification_read_authorized(
  p_notification_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  if p_notification_id is null or p_user_id is null then
    return false;
  end if;

  update public.billing_notifications n
  set read = true
  where n.id = p_notification_id
    and n.user_id = p_user_id
    and (
      n.invoice_id is null
      or exists (
        select 1
        from public.billing_invoices i
        where i.id = n.invoice_id
          and (i.recipient_user_id = p_user_id or i.issuer_user_id = p_user_id)
      )
    );

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.billing_mark_all_notifications_read_authorized(
  p_user_id uuid,
  p_demo_session_id text default 'canonical'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session text := coalesce(nullif(trim(p_demo_session_id), ''), 'canonical');
  v_updated integer := 0;
begin
  if p_user_id is null then
    return 0;
  end if;

  update public.billing_notifications n
  set read = true
  where n.user_id = p_user_id
    and n.demo_session_id in ('canonical', v_session)
    and n.read = false;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

commit;
