-- =============================================================================
-- 20261101000000_paypal_ai_billing_kit.sql
-- Standalone PayPal AI Billing Kit — Dedicated Supabase Schema, RLS & Demo Seed
-- Project: paypal-ai-billing-kit (dvzfesfvefggnunkjhom)
-- Zero Health eRecords Dependencies • Zero PHI • Strict Row-Level Security
-- =============================================================================

set search_path = public, extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 0. Standalone Billing Accounts, Organizations & Customer Links
-- ---------------------------------------------------------------------------
create table if not exists public.billing_accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  account_role text not null default 'customer'
    check (account_role in ('provider', 'customer', 'admin')),
  organization_title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  owner_user_id uuid not null references public.billing_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (owner_user_id)
);

create table if not exists public.billing_org_members (
  organization_id uuid not null references public.billing_organizations(id) on delete cascade,
  user_id uuid not null references public.billing_accounts(id) on delete cascade,
  role text not null check (role in ('owner', 'billing_admin', 'provider')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index if not exists billing_org_members_user_idx on public.billing_org_members(user_id);

create table if not exists public.billing_customer_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.billing_organizations(id) on delete cascade,
  provider_user_id uuid not null references public.billing_accounts(id) on delete cascade,
  customer_user_id uuid not null references public.billing_accounts(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked')),
  linked_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (provider_user_id, customer_user_id)
);
create index if not exists billing_customer_links_provider_idx on public.billing_customer_links(provider_user_id, status);
create index if not exists billing_customer_links_customer_idx on public.billing_customer_links(customer_user_id, status);

create or replace function public.billing_is_org_member(p_org uuid, p_roles text[] default array['owner','billing_admin','provider'])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.billing_org_members m
     where m.organization_id = p_org and m.user_id = auth.uid() and m.role = any(p_roles)
  );
$$;
revoke all on function public.billing_is_org_member(uuid, text[]) from public, anon;
grant execute on function public.billing_is_org_member(uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Merchant Configuration & OAuth Account Connections
-- ---------------------------------------------------------------------------
create table if not exists public.billing_merchant_configs (
  organization_id uuid primary key references public.billing_organizations(id) on delete cascade,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'live')),
  paypal_merchant_id text,
  display_name text,
  connection_status text not null default 'not_connected'
    check (connection_status in ('not_connected', 'pending', 'connected', 'revoked', 'error')),
  connection_method text check (connection_method in ('partner_referral', 'platform_credentials', 'login_with_paypal')),
  merchant_email_masked text,
  permissions jsonb not null default '[]'::jsonb,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_account_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.billing_accounts(id) on delete cascade,
  connection_type text not null check (connection_type in ('merchant', 'payer')),
  organization_id uuid references public.billing_organizations(id) on delete cascade,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'live')),
  status text not null default 'connected' check (status in ('pending', 'connected', 'revoked', 'error', 'expired')),
  paypal_payer_id text,
  paypal_email_masked text,
  paypal_verified boolean,
  connected_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, connection_type, environment)
);

create table if not exists public.billing_connection_secrets (
  connection_id uuid primary key references public.billing_account_connections(id) on delete cascade,
  oauth_state text,
  refresh_token_ciphertext text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Unified Service Catalog (Includes title + synchronized default amounts)
-- ---------------------------------------------------------------------------
create table if not exists public.billing_service_catalog (
  code text primary key check (code ~ '^[A-Z0-9_-]{2,32}$'),
  title text not null check (length(title) between 3 and 80),
  description text not null check (length(description) between 3 and 160),
  default_amount_minor bigint not null check (default_amount_minor between 100 and 1000000),
  currency char(3) not null default 'USD',
  active boolean not null default true
);

insert into public.billing_service_catalog (code, title, description, default_amount_minor) values
  ('ADMIN-TELEHEALTH', 'Telehealth Scheduling & Admin', 'Administrative telehealth scheduling and account coordination fee', 15000),
  ('ADMIN-OFFICE', 'Office Visit Administration', 'Standard office visit administrative statement fee', 12500),
  ('ADMIN-RECORDS', 'Records & Document Processing', 'Administrative records preparation and transfer fee', 4500),
  ('ADMIN-FORMS', 'Forms Completion', 'Administrative school, work, or insurance form completion fee', 3500),
  ('ADMIN-COPAY', 'Standard Visit Copay', 'Administrative visit copayment statement', 5000),
  ('ADMIN-NOSHOW', 'Missed Appointment Fee', 'Administrative missed appointment fee', 7500),
  ('ADMIN-LATE', 'Late Cancellation Fee', 'Administrative late cancellation fee', 5000)
on conflict (code) do update set
  title = excluded.title,
  description = excluded.description,
  default_amount_minor = excluded.default_amount_minor;

-- ---------------------------------------------------------------------------
-- 3. Invoices & Line Items (Voided & Refunded Invoices Have 0 Balance Due)
-- ---------------------------------------------------------------------------
create sequence if not exists public.billing_invoice_number_seq start 1010;

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  organization_id uuid not null references public.billing_organizations(id) on delete restrict,
  issuer_user_id uuid not null references public.billing_accounts(id) on delete restrict,
  recipient_user_id uuid not null references public.billing_accounts(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'payment_pending', 'paid', 'partially_refunded', 'refunded', 'void')),
  currency char(3) not null default 'USD' check (currency in ('USD')),
  subtotal_minor bigint not null check (subtotal_minor between 0 and 1000000),
  total_minor bigint not null check (total_minor between 100 and 1000000),
  amount_paid_minor bigint not null default 0 check (amount_paid_minor >= 0),
  amount_refunded_minor bigint not null default 0 check (amount_refunded_minor >= 0),
  balance_due_minor bigint generated always as (
    case
      when status in ('void', 'refunded') then 0
      else greatest(total_minor - amount_paid_minor, 0)
    end
  ) stored,
  due_date date not null,
  source text not null default 'manual' check (source in ('manual', 'ai_proposal', 'seed')),
  ai_proposal_id uuid,
  idempotency_key text,
  paypal_order_id text,
  paypal_invoice_id text,
  sent_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_invoices_refund_le_paid check (amount_refunded_minor <= amount_paid_minor),
  constraint billing_invoices_paid_le_total check (amount_paid_minor <= total_minor),
  unique (issuer_user_id, idempotency_key)
);
create index if not exists billing_invoices_org_status_idx on public.billing_invoices(organization_id, status, due_date);
create index if not exists billing_invoices_recipient_idx on public.billing_invoices(recipient_user_id, status);
create unique index if not exists billing_invoices_paypal_order_uidx on public.billing_invoices(paypal_order_id) where paypal_order_id is not null;

create table if not exists public.billing_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  service_code text not null references public.billing_service_catalog(code),
  description text not null,
  quantity integer not null default 1 check (quantity between 1 and 20),
  unit_amount_minor bigint not null check (unit_amount_minor between 100 and 1000000),
  line_total_minor bigint generated always as (quantity * unit_amount_minor) stored,
  position integer not null default 0
);
create index if not exists billing_invoice_items_invoice_idx on public.billing_invoice_items(invoice_id);

-- ---------------------------------------------------------------------------
-- 4. Payment Attempts, Verified Transactions, Refunds & Webhook Events
-- ---------------------------------------------------------------------------
create table if not exists public.billing_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  payer_user_id uuid not null references public.billing_accounts(id),
  paypal_order_id text not null,
  status text not null default 'created'
    check (status in ('created', 'approved', 'capturing', 'completed', 'failed', 'cancelled', 'expired')),
  amount_minor bigint not null,
  currency char(3) not null default 'USD',
  failure_code text,
  failure_message text,
  request_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (paypal_order_id),
  unique (request_id)
);
create index if not exists billing_payment_attempts_invoice_idx on public.billing_payment_attempts(invoice_id, created_at desc);

create table if not exists public.billing_transactions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.billing_invoices(id) on delete restrict,
  organization_id uuid not null references public.billing_organizations(id),
  payer_user_id uuid not null references public.billing_accounts(id),
  paypal_order_id text not null,
  paypal_capture_id text not null unique,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  paypal_status text not null,
  payer_email_masked text,
  verified_via text not null check (verified_via in ('capture_api', 'order_lookup', 'webhook', 'seed_demo')),
  webhook_reconciled_at timestamptz,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists billing_transactions_invoice_idx on public.billing_transactions(invoice_id);

create table if not exists public.billing_refunds (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.billing_transactions(id) on delete restrict,
  invoice_id uuid not null references public.billing_invoices(id) on delete restrict,
  requested_by uuid not null references public.billing_accounts(id),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  status text not null default 'requested' check (status in ('requested', 'pending', 'completed', 'failed')),
  paypal_refund_id text unique,
  request_id text not null unique,
  failure_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  paypal_event_id text not null unique,
  event_type text not null,
  resource_id text,
  verification_status text not null check (verification_status in ('verified', 'failed')),
  processing_status text not null default 'received' check (processing_status in ('received', 'processed', 'ignored', 'error')),
  processing_error text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- 5. Immutable Append-Only Financial Audit Trail
-- ---------------------------------------------------------------------------
create table if not exists public.billing_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.billing_organizations(id) on delete set null,
  invoice_id uuid references public.billing_invoices(id) on delete set null,
  actor_user_id uuid references public.billing_accounts(id) on delete set null,
  actor_kind text not null check (actor_kind in ('user', 'ai', 'system', 'paypal')),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists billing_audit_events_org_idx on public.billing_audit_events(organization_id, created_at desc);
create index if not exists billing_audit_events_invoice_idx on public.billing_audit_events(invoice_id, created_at);

create or replace function public.billing_audit_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'billing_audit_events is append-only' using errcode = '42501';
end;
$$;
drop trigger if exists trg_billing_audit_immutable on public.billing_audit_events;
create trigger trg_billing_audit_immutable before update or delete on public.billing_audit_events
  for each row execute function public.billing_audit_immutable();

create or replace function public.billing_log(p_org uuid, p_invoice uuid, p_actor uuid, p_kind text, p_type text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.billing_audit_events (organization_id, invoice_id, actor_user_id, actor_kind, event_type, details)
  values (p_org, p_invoice, p_actor, p_kind, p_type, coalesce(p_details, '{}'::jsonb));
$$;
revoke all on function public.billing_log(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.billing_log(uuid, uuid, uuid, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Billing AI Settings, Sessions, Proposals, Messages & Notifications
-- ---------------------------------------------------------------------------
create table if not exists public.billing_ai_settings (
  user_id uuid primary key references public.billing_accounts(id) on delete cascade,
  max_single_action_minor bigint not null default 50000 check (max_single_action_minor between 0 and 50000),
  daily_limit_minor bigint not null default 250000 check (daily_limit_minor between 0 and 250000),
  allow_invoice_drafting boolean not null default true,
  allow_reminder_drafting boolean not null default true,
  allow_checkout_assistance boolean not null default true,
  warn_duplicates boolean not null default true,
  notify_new_invoice boolean not null default true,
  notify_payment_confirmed boolean not null default true,
  notify_payment_failed boolean not null default true,
  notify_overdue boolean not null default true,
  notify_refund boolean not null default true,
  reminder_days_before_due integer not null default 3 check (reminder_days_before_due between 0 and 30),
  require_human_approval boolean not null default true check (require_human_approval = true),
  block_clinical_data boolean not null default true check (block_clinical_data = true),
  paypal_confirmation_required boolean not null default true check (paypal_confirmation_required = true),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_ai_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.billing_accounts(id) on delete cascade,
  role_scope text not null check (role_scope in ('doctor', 'patient')),
  organization_id uuid references public.billing_organizations(id) on delete set null,
  title text,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index if not exists billing_ai_sessions_user_idx on public.billing_ai_sessions(user_id, role_scope, last_activity_at desc);

create table if not exists public.billing_ai_proposals (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.billing_ai_sessions(id) on delete cascade,
  user_id uuid not null references public.billing_accounts(id) on delete cascade,
  kind text not null check (kind in ('create_invoice', 'send_reminder', 'refund', 'void_invoice', 'payment_checkout')),
  payload jsonb not null,
  amount_minor bigint not null default 0 check (amount_minor >= 0),
  currency char(3) not null default 'USD',
  guardrail_result jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'executed', 'failed', 'blocked', 'expired')),
  result_summary text,
  result_ref uuid,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists billing_ai_proposals_user_day_idx on public.billing_ai_proposals(user_id, status, decided_at);

create table if not exists public.billing_ai_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.billing_ai_sessions(id) on delete cascade,
  user_id uuid not null references public.billing_accounts(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) <= 8000),
  proposal_id uuid references public.billing_ai_proposals(id) on delete set null,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);
create index if not exists billing_ai_messages_session_idx on public.billing_ai_messages(session_id, created_at);

create table if not exists public.billing_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.billing_accounts(id) on delete cascade,
  type text not null default 'billing',
  title text not null,
  body text not null,
  read boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  event_key text,
  created_at timestamptz not null default now()
);
create unique index if not exists billing_notifications_user_event_key_uidx
  on public.billing_notifications (user_id, event_key) where event_key is not null;
create index if not exists billing_notifications_user_created_idx
  on public.billing_notifications (user_id, created_at desc);

alter table public.billing_invoices
  drop constraint if exists billing_invoices_ai_proposal_fk;
alter table public.billing_invoices
  add constraint billing_invoices_ai_proposal_fk foreign key (ai_proposal_id) references public.billing_ai_proposals(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 7. Row-Level Security (RLS) — Zero Anon Access; Scoped Select for Authenticated
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'billing_accounts','billing_organizations','billing_org_members','billing_customer_links',
    'billing_merchant_configs','billing_account_connections','billing_connection_secrets',
    'billing_service_catalog','billing_invoices','billing_invoice_items',
    'billing_payment_attempts','billing_transactions','billing_refunds','billing_webhook_events',
    'billing_audit_events','billing_ai_settings','billing_ai_sessions','billing_ai_proposals',
    'billing_ai_messages','billing_notifications']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

grant select on public.billing_accounts, public.billing_organizations, public.billing_org_members,
  public.billing_customer_links, public.billing_merchant_configs, public.billing_account_connections,
  public.billing_service_catalog, public.billing_invoices, public.billing_invoice_items,
  public.billing_payment_attempts, public.billing_transactions, public.billing_refunds,
  public.billing_audit_events, public.billing_ai_settings, public.billing_ai_sessions,
  public.billing_ai_proposals, public.billing_ai_messages, public.billing_notifications
  to authenticated;

grant update (read) on public.billing_notifications to authenticated;

drop policy if exists billing_accounts_select on public.billing_accounts;
create policy billing_accounts_select on public.billing_accounts for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.billing_customer_links l
       where (l.provider_user_id = auth.uid() and l.customer_user_id = public.billing_accounts.id and l.revoked_at is null)
          or (l.customer_user_id = auth.uid() and l.provider_user_id = public.billing_accounts.id and l.revoked_at is null)
    )
  );

drop policy if exists billing_orgs_select on public.billing_organizations;
create policy billing_orgs_select on public.billing_organizations for select to authenticated
  using (
    public.billing_is_org_member(id)
    or exists (
      select 1 from public.billing_invoices i
       where i.organization_id = public.billing_organizations.id
         and i.recipient_user_id = auth.uid()
         and i.status <> 'draft'
    )
  );

drop policy if exists billing_org_members_select on public.billing_org_members;
create policy billing_org_members_select on public.billing_org_members for select to authenticated
  using (user_id = auth.uid() or public.billing_is_org_member(organization_id, array['owner','billing_admin']));

drop policy if exists billing_customer_links_select on public.billing_customer_links;
create policy billing_customer_links_select on public.billing_customer_links for select to authenticated
  using (provider_user_id = auth.uid() or customer_user_id = auth.uid());

drop policy if exists billing_merchant_select on public.billing_merchant_configs;
create policy billing_merchant_select on public.billing_merchant_configs for select to authenticated
  using (public.billing_is_org_member(organization_id));

drop policy if exists billing_conn_select on public.billing_account_connections;
create policy billing_conn_select on public.billing_account_connections for select to authenticated
  using (user_id = auth.uid());

drop policy if exists billing_catalog_select on public.billing_service_catalog;
create policy billing_catalog_select on public.billing_service_catalog for select to authenticated
  using (active);

drop policy if exists billing_invoices_select on public.billing_invoices;
create policy billing_invoices_select on public.billing_invoices for select to authenticated
  using (
    public.billing_is_org_member(organization_id)
    or (recipient_user_id = auth.uid() and status <> 'draft')
  );

drop policy if exists billing_items_select on public.billing_invoice_items;
create policy billing_items_select on public.billing_invoice_items for select to authenticated
  using (exists (select 1 from public.billing_invoices i where i.id = invoice_id));

drop policy if exists billing_attempts_select on public.billing_payment_attempts;
create policy billing_attempts_select on public.billing_payment_attempts for select to authenticated
  using (payer_user_id = auth.uid()
         or exists (select 1 from public.billing_invoices i where i.id = invoice_id and public.billing_is_org_member(i.organization_id)));

drop policy if exists billing_tx_select on public.billing_transactions;
create policy billing_tx_select on public.billing_transactions for select to authenticated
  using (payer_user_id = auth.uid() or public.billing_is_org_member(organization_id));

drop policy if exists billing_refunds_select on public.billing_refunds;
create policy billing_refunds_select on public.billing_refunds for select to authenticated
  using (exists (select 1 from public.billing_invoices i where i.id = invoice_id));

drop policy if exists billing_audit_select on public.billing_audit_events;
create policy billing_audit_select on public.billing_audit_events for select to authenticated
  using (
    (organization_id is not null and public.billing_is_org_member(organization_id, array['owner','billing_admin']))
    or actor_user_id = auth.uid()
    or (invoice_id is not null and exists (select 1 from public.billing_invoices i where i.id = invoice_id and i.recipient_user_id = auth.uid()))
  );

drop policy if exists billing_ai_settings_select on public.billing_ai_settings;
create policy billing_ai_settings_select on public.billing_ai_settings for select to authenticated
  using (user_id = auth.uid());

drop policy if exists billing_ai_sessions_select on public.billing_ai_sessions;
create policy billing_ai_sessions_select on public.billing_ai_sessions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists billing_ai_proposals_select on public.billing_ai_proposals;
create policy billing_ai_proposals_select on public.billing_ai_proposals for select to authenticated
  using (user_id = auth.uid());

drop policy if exists billing_ai_messages_select on public.billing_ai_messages;
create policy billing_ai_messages_select on public.billing_ai_messages for select to authenticated
  using (user_id = auth.uid());

drop policy if exists billing_notifications_select on public.billing_notifications;
create policy billing_notifications_select on public.billing_notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists billing_notifications_update on public.billing_notifications;
create policy billing_notifications_update on public.billing_notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8. Helper & Business Logic RPCs
-- ---------------------------------------------------------------------------
create or replace function public.billing_caller_is_provider()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.billing_accounts p where p.id = auth.uid() and p.account_role in ('provider', 'admin'));
$$;
revoke all on function public.billing_caller_is_provider() from public, anon;
grant execute on function public.billing_caller_is_provider() to authenticated, service_role;

create or replace function public.billing_ensure_org()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_name text;
begin
  if auth.uid() is null or not public.billing_caller_is_provider() then
    raise exception 'Only providers can own a billing organization' using errcode = '42501';
  end if;
  select m.organization_id into v_org from public.billing_org_members m
   where m.user_id = auth.uid() and m.role in ('owner', 'billing_admin') order by (m.role = 'owner') desc limit 1;
  if v_org is not null then return v_org; end if;

  select coalesce(nullif(btrim(organization_title), ''), coalesce(nullif(btrim(full_name), ''), 'Provider') || ' Practice')
    into v_name from public.billing_accounts where id = auth.uid();
  insert into public.billing_organizations (name, owner_user_id) values (left(v_name, 120), auth.uid())
    on conflict (owner_user_id) do update set name = public.billing_organizations.name
    returning id into v_org;
  insert into public.billing_org_members (organization_id, user_id, role) values (v_org, auth.uid(), 'owner')
    on conflict do nothing;
  insert into public.billing_merchant_configs (organization_id) values (v_org) on conflict do nothing;
  perform public.billing_log(v_org, null, auth.uid(), 'user', 'organization_ensured', '{}'::jsonb);
  return v_org;
end;
$$;
revoke all on function public.billing_ensure_org() from public, anon;
grant execute on function public.billing_ensure_org() to authenticated;

create or replace function public.billing_list_billable_patients()
returns table (patient_id uuid, full_name text, email_masked text)
language sql stable security definer set search_path = public as $$
  select distinct c.id,
         coalesce(nullif(btrim(c.full_name), ''), 'Customer'),
         case when c.email is null then null
              else left(split_part(c.email, '@', 1), 1) || '***@' || split_part(c.email, '@', 2) end
    from public.billing_customer_links l
    join public.billing_accounts c on c.id = l.customer_user_id
   where l.provider_user_id = auth.uid() and l.revoked_at is null and l.status = 'active' and public.billing_caller_is_provider()
   order by 2;
$$;
revoke all on function public.billing_list_billable_patients() from public, anon;
grant execute on function public.billing_list_billable_patients() to authenticated;

create or replace function public.billing_counterparty_names(p_ids uuid[])
returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(btrim(p.full_name), ''), 'User')
    from public.billing_accounts p
   where p.id = any(p_ids)
     and exists (
       select 1 from public.billing_invoices i
        where (i.recipient_user_id = p.id or i.issuer_user_id = p.id)
          and (public.billing_is_org_member(i.organization_id) or (i.recipient_user_id = auth.uid() and i.status <> 'draft'))
     );
$$;
revoke all on function public.billing_counterparty_names(uuid[]) from public, anon;
grant execute on function public.billing_counterparty_names(uuid[]) to authenticated;

create or replace function public.billing_effective_ai_settings(p_user uuid)
returns public.billing_ai_settings language plpgsql stable security definer set search_path = public as $$
declare s public.billing_ai_settings;
begin
  select * into s from public.billing_ai_settings where user_id = p_user;
  if not found then
    s.user_id := p_user; s.max_single_action_minor := 50000; s.daily_limit_minor := 250000;
    s.allow_invoice_drafting := true; s.allow_reminder_drafting := true; s.allow_checkout_assistance := true;
    s.warn_duplicates := true; s.require_human_approval := true; s.block_clinical_data := true;
    s.paypal_confirmation_required := true;
    s.notify_new_invoice := true; s.notify_payment_confirmed := true; s.notify_payment_failed := true;
    s.notify_overdue := true; s.notify_refund := true; s.reminder_days_before_due := 3;
  end if;
  return s;
end;
$$;
revoke all on function public.billing_effective_ai_settings(uuid) from public, anon, authenticated;
grant execute on function public.billing_effective_ai_settings(uuid) to service_role;

create or replace function public.billing_ai_guardrail_check(p_user uuid, p_amount_minor bigint, p_exclude_proposal uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.billing_ai_settings;
  v_today bigint;
begin
  s := public.billing_effective_ai_settings(p_user);
  select coalesce(sum(amount_minor), 0) into v_today
    from public.billing_ai_proposals
   where user_id = p_user and status in ('approved', 'executed')
     and decided_at >= date_trunc('day', now())
     and (p_exclude_proposal is null or id <> p_exclude_proposal);
  return jsonb_build_object(
    'single_limit_minor', s.max_single_action_minor,
    'daily_limit_minor', s.daily_limit_minor,
    'used_today_minor', v_today,
    'amount_minor', p_amount_minor,
    'single_ok', p_amount_minor <= s.max_single_action_minor,
    'daily_ok', v_today + p_amount_minor <= s.daily_limit_minor,
    'passed', p_amount_minor <= s.max_single_action_minor and v_today + p_amount_minor <= s.daily_limit_minor
  );
end;
$$;
revoke all on function public.billing_ai_guardrail_check(uuid, bigint, uuid) from public, anon, authenticated;
grant execute on function public.billing_ai_guardrail_check(uuid, bigint, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Invoice Creation, Send, Void, Settings & Proposal Decision RPCs
-- ---------------------------------------------------------------------------
create or replace function public.billing_create_invoice(
  p_recipient uuid,
  p_items jsonb,
  p_due_date date,
  p_send boolean default false,
  p_idempotency_key text default null,
  p_ai_proposal_id uuid default null
) returns public.billing_invoices
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
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
begin
  if v_uid is null or not public.billing_caller_is_provider() then
    raise exception 'Only providers can create invoices' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    select * into v_inv from public.billing_invoices where issuer_user_id = v_uid and idempotency_key = p_idempotency_key;
    if found then return v_inv; end if;
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

  v_org := public.billing_ensure_org();

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
    if not found or v_prop.kind <> 'create_invoice' or v_prop.status <> 'approved' then
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
    due_date, source, ai_proposal_id, idempotency_key, sent_at)
  values (
    'PPB-INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.billing_invoice_number_seq')::text, 4, '0'),
    v_org, v_uid, p_recipient, case when p_send then 'sent' else 'draft' end, v_total, v_total,
    p_due_date, case when p_ai_proposal_id is null then 'manual' else 'ai_proposal' end, p_ai_proposal_id,
    p_idempotency_key, case when p_send then now() end)
  returning * into v_inv;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_cat from public.billing_service_catalog where code = v_item->>'service_code';
    insert into public.billing_invoice_items (invoice_id, service_code, description, quantity, unit_amount_minor, position)
    values (v_inv.id, v_cat.code, v_cat.title || ' — ' || v_cat.description, coalesce((v_item->>'quantity')::int, 1),
            coalesce((v_item->>'unit_amount_minor')::bigint, v_cat.default_amount_minor), v_pos);
    v_pos := v_pos + 1;
  end loop;

  perform public.billing_log(v_org, v_inv.id, v_uid, 'user',
    case when p_send then 'invoice_created_and_sent' else 'invoice_draft_created' end,
    jsonb_build_object('invoice_number', v_inv.invoice_number, 'total_minor', v_total, 'currency', 'USD', 'ai_proposal_id', p_ai_proposal_id));

  if p_ai_proposal_id is not null then
    update public.billing_ai_proposals set status = 'executed', result_ref = v_inv.id,
      result_summary = 'Invoice ' || v_inv.invoice_number || case when p_send then ' sent' else ' saved as draft' end,
      guardrail_result = v_guard
     where id = p_ai_proposal_id;
    perform public.billing_log(v_org, v_inv.id, v_uid, 'ai', 'ai_proposal_executed', jsonb_build_object('proposal_id', p_ai_proposal_id, 'invoice_number', v_inv.invoice_number));
  end if;
  return v_inv;
end;
$$;
revoke all on function public.billing_create_invoice(uuid, jsonb, date, boolean, text, uuid) from public, anon;
grant execute on function public.billing_create_invoice(uuid, jsonb, date, boolean, text, uuid) to authenticated;

create or replace function public.billing_send_invoice(p_invoice uuid)
returns public.billing_invoices language plpgsql security definer set search_path = public as $$
declare v_inv public.billing_invoices;
begin
  select * into v_inv from public.billing_invoices where id = p_invoice for update;
  if not found or not public.billing_is_org_member(v_inv.organization_id) then
    raise exception 'Invoice not found' using errcode = '42501';
  end if;
  if v_inv.status <> 'draft' then return v_inv; end if;
  update public.billing_invoices set status = 'sent', sent_at = now(), updated_at = now() where id = p_invoice returning * into v_inv;
  perform public.billing_log(v_inv.organization_id, v_inv.id, auth.uid(), 'user', 'invoice_sent', jsonb_build_object('invoice_number', v_inv.invoice_number));
  return v_inv;
end;
$$;
revoke all on function public.billing_send_invoice(uuid) from public, anon;
grant execute on function public.billing_send_invoice(uuid) to authenticated;

create or replace function public.billing_void_invoice(p_invoice uuid)
returns public.billing_invoices language plpgsql security definer set search_path = public as $$
declare v_inv public.billing_invoices;
begin
  select * into v_inv from public.billing_invoices where id = p_invoice for update;
  if not found or not public.billing_is_org_member(v_inv.organization_id, array['owner','billing_admin']) then
    raise exception 'Invoice not found' using errcode = '42501';
  end if;
  if v_inv.status not in ('draft', 'sent') or v_inv.amount_paid_minor > 0 then
    raise exception 'Only unpaid invoices can be voided' using errcode = '22023';
  end if;
  update public.billing_invoices set status = 'void', voided_at = now(), updated_at = now() where id = p_invoice returning * into v_inv;
  perform public.billing_log(v_inv.organization_id, v_inv.id, auth.uid(), 'user', 'invoice_voided', jsonb_build_object('invoice_number', v_inv.invoice_number));
  return v_inv;
end;
$$;
revoke all on function public.billing_void_invoice(uuid) from public, anon;
grant execute on function public.billing_void_invoice(uuid) to authenticated;

create or replace function public.billing_update_ai_settings(p jsonb)
returns public.billing_ai_settings language plpgsql security definer set search_path = public as $$
declare s public.billing_ai_settings;
begin
  if auth.uid() is null then raise exception 'auth required' using errcode = '42501'; end if;
  insert into public.billing_ai_settings (user_id) values (auth.uid()) on conflict do nothing;
  update public.billing_ai_settings set
    max_single_action_minor = coalesce((p->>'max_single_action_minor')::bigint, max_single_action_minor),
    daily_limit_minor = coalesce((p->>'daily_limit_minor')::bigint, daily_limit_minor),
    allow_invoice_drafting = coalesce((p->>'allow_invoice_drafting')::boolean, allow_invoice_drafting),
    allow_reminder_drafting = coalesce((p->>'allow_reminder_drafting')::boolean, allow_reminder_drafting),
    allow_checkout_assistance = coalesce((p->>'allow_checkout_assistance')::boolean, allow_checkout_assistance),
    warn_duplicates = coalesce((p->>'warn_duplicates')::boolean, warn_duplicates),
    notify_new_invoice = coalesce((p->>'notify_new_invoice')::boolean, notify_new_invoice),
    notify_payment_confirmed = coalesce((p->>'notify_payment_confirmed')::boolean, notify_payment_confirmed),
    notify_payment_failed = coalesce((p->>'notify_payment_failed')::boolean, notify_payment_failed),
    notify_overdue = coalesce((p->>'notify_overdue')::boolean, notify_overdue),
    notify_refund = coalesce((p->>'notify_refund')::boolean, notify_refund),
    reminder_days_before_due = coalesce((p->>'reminder_days_before_due')::int, reminder_days_before_due),
    updated_at = now()
  where user_id = auth.uid()
  returning * into s;
  perform public.billing_log(null, null, auth.uid(), 'user', 'ai_settings_updated', p - 'require_human_approval' - 'block_clinical_data' - 'paypal_confirmation_required');
  return s;
end;
$$;
revoke all on function public.billing_update_ai_settings(jsonb) from public, anon;
grant execute on function public.billing_update_ai_settings(jsonb) to authenticated;

create or replace function public.billing_decide_ai_proposal(p_proposal uuid, p_decision text)
returns public.billing_ai_proposals language plpgsql security definer set search_path = public as $$
declare v public.billing_ai_proposals; v_guard jsonb;
begin
  select * into v from public.billing_ai_proposals where id = p_proposal and user_id = auth.uid() for update;
  if not found then raise exception 'Proposal not found' using errcode = '42501'; end if;
  if v.status <> 'pending' then return v; end if;
  if p_decision = 'reject' then
    update public.billing_ai_proposals set status = 'rejected', decided_at = now(), result_summary = 'Declined' where id = v.id returning * into v;
    perform public.billing_log(null, null, auth.uid(), 'user', 'ai_proposal_rejected', jsonb_build_object('proposal_id', v.id));
    return v;
  elsif p_decision <> 'approve' then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  v_guard := public.billing_ai_guardrail_check(auth.uid(), v.amount_minor, v.id);
  if not (v_guard->>'passed')::boolean then
    update public.billing_ai_proposals set status = 'blocked', decided_at = now(), guardrail_result = v_guard,
      result_summary = 'Blocked by AI spending limit' where id = v.id returning * into v;
    perform public.billing_log(null, null, auth.uid(), 'system', 'ai_guardrail_blocked', v_guard || jsonb_build_object('proposal_id', v.id));
    return v;
  end if;
  update public.billing_ai_proposals set status = 'approved', decided_at = now(), guardrail_result = v_guard where id = v.id returning * into v;
  perform public.billing_log(null, null, auth.uid(), 'user', 'ai_proposal_approved', v_guard || jsonb_build_object('proposal_id', v.id));
  return v;
end;
$$;
revoke all on function public.billing_decide_ai_proposal(uuid, text) from public, anon;
grant execute on function public.billing_decide_ai_proposal(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Service-Role-Only Capture & Refund Settlement RPCs
-- ---------------------------------------------------------------------------
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
  perform public.billing_log(v_inv.organization_id, v_inv.id, p_payer, 'paypal', 'payment_captured_verified',
    jsonb_build_object('order_id', p_order_id, 'capture_id', p_capture_id, 'amount_minor', p_amount_minor, 'currency', upper(p_currency), 'verified_via', p_verified_via));
  return v_tx;
end;
$$;
revoke all on function public.billing_apply_verified_capture(uuid, uuid, text, text, bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.billing_apply_verified_capture(uuid, uuid, text, text, bigint, text, text, text, text) to service_role;

create or replace function public.billing_apply_refund_result(
  p_refund uuid, p_status text, p_paypal_refund_id text, p_failure text default null
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
  else
    select * into v_inv from public.billing_invoices where id = v_r.invoice_id;
  end if;
  perform public.billing_log(v_inv.organization_id, v_inv.id, v_r.requested_by, 'paypal', 'refund_' || p_status,
    jsonb_build_object('refund_id', v_r.id, 'paypal_refund_id', p_paypal_refund_id, 'amount_minor', v_r.amount_minor));
  return v_r;
end;
$$;
revoke all on function public.billing_apply_refund_result(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.billing_apply_refund_result(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 11. Notifications (DB-Triggered, Deduplicated by event_key)
-- ---------------------------------------------------------------------------
create or replace function public.billing_notify(p_user uuid, p_key text, p_title text, p_body text, p_invoice uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.billing_ai_settings;
begin
  s := public.billing_effective_ai_settings(p_user);
  if (p_kind = 'invoice_sent' and not s.notify_new_invoice)
     or (p_kind = 'payment_confirmed' and not s.notify_payment_confirmed)
     or (p_kind = 'payment_failed' and not s.notify_payment_failed)
     or (p_kind = 'invoice_overdue' and not s.notify_overdue)
     or (p_kind = 'refund_completed' and not s.notify_refund) then
    return;
  end if;
  insert into public.billing_notifications (user_id, type, title, body, read, created_at, metadata, event_key)
  values (p_user, 'billing', p_title, p_body, false, now(),
          jsonb_build_object('kind', p_kind, 'route', '/billing', 'invoiceId', p_invoice),
          p_key)
  on conflict (user_id, event_key) where event_key is not null do nothing;
end;
$$;
revoke all on function public.billing_notify(uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.billing_notify(uuid, text, text, text, uuid, text) to service_role;

create or replace function public.trg_billing_invoice_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    perform public.billing_notify(new.recipient_user_id, 'invoice_sent:' || new.id,
      'New invoice', 'You have received a new invoice (' || new.invoice_number || ') from your provider.', new.id, 'invoice_sent');
  end if;
  if tg_op = 'UPDATE' and new.status = 'paid' and old.status is distinct from 'paid' then
    perform public.billing_notify(new.recipient_user_id, 'payment_confirmed:' || new.id,
      'Payment confirmed', 'Your PayPal payment for invoice ' || new.invoice_number || ' has been confirmed.', new.id, 'payment_confirmed');
    perform public.billing_notify(new.issuer_user_id, 'payment_received:' || new.id,
      'Payment received', 'A customer payment was received for invoice ' || new.invoice_number || '.', new.id, 'payment_confirmed');
  end if;
  if tg_op = 'UPDATE' and new.status in ('refunded', 'partially_refunded') and old.amount_refunded_minor < new.amount_refunded_minor then
    perform public.billing_notify(new.recipient_user_id, 'refund_completed:' || new.id || ':' || new.amount_refunded_minor,
      'Refund completed', 'Your refund for invoice ' || new.invoice_number || ' has been completed.', new.id, 'refund_completed');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_billing_invoice_notify on public.billing_invoices;
create trigger trg_billing_invoice_notify after insert or update of status, amount_refunded_minor on public.billing_invoices
  for each row execute function public.trg_billing_invoice_notify();

create or replace function public.trg_billing_attempt_failed_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'failed' and old.status is distinct from 'failed' then
    perform public.billing_notify(new.payer_user_id, 'payment_failed:' || new.id,
      'Payment not completed', 'Your PayPal payment could not be completed. You can retry safely from Billing.', new.invoice_id, 'payment_failed');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_billing_attempt_failed_notify on public.billing_payment_attempts;
create trigger trg_billing_attempt_failed_notify after update of status on public.billing_payment_attempts
  for each row execute function public.trg_billing_attempt_failed_notify();

create or replace function public.billing_refresh_overdue()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select i.id, i.recipient_user_id, i.invoice_number from public.billing_invoices i
     where i.status = 'sent' and i.due_date < current_date
       and (i.recipient_user_id = auth.uid() or public.billing_is_org_member(i.organization_id))
  loop
    perform public.billing_notify(r.recipient_user_id, 'invoice_overdue:' || r.id,
      'Invoice overdue', 'Invoice ' || r.invoice_number || ' is past due.', r.id, 'invoice_overdue');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.billing_refresh_overdue() from public, anon;
grant execute on function public.billing_refresh_overdue() to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Realtime Publication
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['billing_invoices', 'billing_transactions', 'billing_payment_attempts', 'billing_notifications'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 13. Seed Fictional Demonstration Accounts & Initial Statements
--     1. Dr. Sarah Jenkins (Provider): sarah.jenkins@demo.paypal-billing-kit.local
--     2. Alex Rivera (Customer #1):    alex.rivera@demo.paypal-billing-kit.local
--     3. Jordan Taylor (Customer #2):  jordan.taylor@demo.paypal-billing-kit.local
--     4. Dr. Marcus Vance (Provider B for cross-org RLS test): marcus.vance@demo.paypal-billing-kit.local
--     Shared Demo Password: DemoPayPalKit2026!
-- ---------------------------------------------------------------------------
do $$
declare
  v_sarah uuid := '11111111-1111-4111-8111-111111111101';
  v_alex  uuid := '11111111-1111-4111-8111-111111111102';
  v_jordan uuid := '11111111-1111-4111-8111-111111111103';
  v_marcus uuid := '11111111-1111-4111-8111-111111111104';
  v_org   uuid := '22222222-2222-4222-8222-222222222201';
  v_org_b uuid := '22222222-2222-4222-8222-222222222202';
  v_pw_hash text := extensions.crypt('DemoPayPalKit2026!', extensions.gen_salt('bf'));
  v_inv_pending uuid := '33333333-3333-4333-8333-333333333301';
  v_inv_overdue uuid := '33333333-3333-4333-8333-333333333302';
  v_inv_paid    uuid := '33333333-3333-4333-8333-333333333303';
  v_inv_failed  uuid := '33333333-3333-4333-8333-333333333304';
  v_inv_void    uuid := '33333333-3333-4333-8333-333333333305';
  v_inv_refund  uuid := '33333333-3333-4333-8333-333333333306';
  v_tx_paid     uuid := '44444444-4444-4444-8444-444444444401';
  v_tx_refund   uuid := '44444444-4444-4444-8444-444444444402';
begin
  -- Insert auth.users rows for the 4 fictional accounts
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_sarah, 'authenticated', 'authenticated',
     'sarah.jenkins@demo.paypal-billing-kit.local', v_pw_hash, now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Dr. Sarah Jenkins","account_role":"provider"}'::jsonb,
     now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_alex, 'authenticated', 'authenticated',
     'alex.rivera@demo.paypal-billing-kit.local', v_pw_hash, now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Alex Rivera","account_role":"customer"}'::jsonb,
     now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_jordan, 'authenticated', 'authenticated',
     'jordan.taylor@demo.paypal-billing-kit.local', v_pw_hash, now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Jordan Taylor","account_role":"customer"}'::jsonb,
     now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_marcus, 'authenticated', 'authenticated',
     'marcus.vance@demo.paypal-billing-kit.local', v_pw_hash, now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Dr. Marcus Vance","account_role":"provider"}'::jsonb,
     now(), now(), '', '', '', '')
  on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values
    (v_sarah, v_sarah, jsonb_build_object('sub', v_sarah::text, 'email', 'sarah.jenkins@demo.paypal-billing-kit.local'), 'email', v_sarah::text, now(), now(), now()),
    (v_alex, v_alex, jsonb_build_object('sub', v_alex::text, 'email', 'alex.rivera@demo.paypal-billing-kit.local'), 'email', v_alex::text, now(), now(), now()),
    (v_jordan, v_jordan, jsonb_build_object('sub', v_jordan::text, 'email', 'jordan.taylor@demo.paypal-billing-kit.local'), 'email', v_jordan::text, now(), now(), now()),
    (v_marcus, v_marcus, jsonb_build_object('sub', v_marcus::text, 'email', 'marcus.vance@demo.paypal-billing-kit.local'), 'email', v_marcus::text, now(), now(), now())
  on conflict do nothing;

  insert into public.billing_accounts (id, email, full_name, account_role, organization_title) values
    (v_sarah, 'sarah.jenkins@demo.paypal-billing-kit.local', 'Dr. Sarah Jenkins', 'provider', 'Jenkins Wellness & Telehealth Practice'),
    (v_alex, 'alex.rivera@demo.paypal-billing-kit.local', 'Alex Rivera', 'customer', null),
    (v_jordan, 'jordan.taylor@demo.paypal-billing-kit.local', 'Jordan Taylor', 'customer', null),
    (v_marcus, 'marcus.vance@demo.paypal-billing-kit.local', 'Dr. Marcus Vance', 'provider', 'Vance Independent Clinic')
  on conflict (id) do nothing;

  insert into public.billing_organizations (id, name, owner_user_id) values
    (v_org, 'Jenkins Wellness & Telehealth Practice', v_sarah),
    (v_org_b, 'Vance Independent Clinic', v_marcus)
  on conflict (id) do nothing;

  insert into public.billing_org_members (organization_id, user_id, role) values
    (v_org, v_sarah, 'owner'),
    (v_org_b, v_marcus, 'owner')
  on conflict do nothing;

  insert into public.billing_merchant_configs (organization_id, environment, display_name, connection_status) values
    (v_org, 'sandbox', 'Jenkins Wellness & Telehealth Practice', 'not_connected'),
    (v_org_b, 'sandbox', 'Vance Independent Clinic', 'not_connected')
  on conflict (organization_id) do nothing;

  insert into public.billing_customer_links (organization_id, provider_user_id, customer_user_id, status) values
    (v_org, v_sarah, v_alex, 'active'),
    (v_org, v_sarah, v_jordan, 'active')
  on conflict (provider_user_id, customer_user_id) do nothing;

  -- Seed 6 demonstration statements covering all lifecycle statuses
  insert into public.billing_invoices (
    id, invoice_number, organization_id, issuer_user_id, recipient_user_id,
    status, subtotal_minor, total_minor, amount_paid_minor, amount_refunded_minor,
    due_date, source, sent_at, paid_at, voided_at
  ) values
    -- 1. Pending ($150.00) for Alex Rivera
    (v_inv_pending, 'PPB-INV-2026-1001', v_org, v_sarah, v_alex,
     'sent', 15000, 15000, 0, 0, current_date + 10, 'seed', now() - interval '2 days', null, null),
    -- 2. Overdue ($75.00) for Alex Rivera
    (v_inv_overdue, 'PPB-INV-2026-1002', v_org, v_sarah, v_alex,
     'sent', 7500, 7500, 0, 0, current_date - 5, 'seed', now() - interval '19 days', null, null),
    -- 3. Paid ($125.00) for Alex Rivera (Sample Demo Record)
    (v_inv_paid, 'PPB-INV-2026-1003', v_org, v_sarah, v_alex,
     'paid', 12500, 12500, 12500, 0, current_date - 2, 'seed', now() - interval '12 days', now() - interval '4 days', null),
    -- 4. Failed Attempt ($50.00) for Jordan Taylor
    (v_inv_failed, 'PPB-INV-2026-1004', v_org, v_sarah, v_jordan,
     'sent', 5000, 5000, 0, 0, current_date + 7, 'seed', now() - interval '3 days', null, null),
    -- 5. Voided ($35.00) for Jordan Taylor -> balance_due_minor automatically 0!
    (v_inv_void, 'PPB-INV-2026-1005', v_org, v_sarah, v_jordan,
     'void', 3500, 3500, 0, 0, current_date + 5, 'seed', now() - interval '4 days', null, now() - interval '1 day'),
    -- 6. Refunded ($45.00) for Alex Rivera -> balance_due_minor automatically 0!
    (v_inv_refund, 'PPB-INV-2026-1006', v_org, v_sarah, v_alex,
     'refunded', 4500, 4500, 4500, 4500, current_date - 8, 'seed', now() - interval '15 days', now() - interval '10 days', null)
  on conflict (id) do nothing;

  insert into public.billing_invoice_items (invoice_id, service_code, description, quantity, unit_amount_minor, position) values
    (v_inv_pending, 'ADMIN-TELEHEALTH', 'Telehealth Scheduling & Admin — Administrative telehealth scheduling and account coordination fee', 1, 15000, 0),
    (v_inv_overdue, 'ADMIN-NOSHOW', 'Missed Appointment Fee — Administrative missed appointment fee', 1, 7500, 0),
    (v_inv_paid, 'ADMIN-OFFICE', 'Office Visit Administration — Standard office visit administrative statement fee', 1, 12500, 0),
    (v_inv_failed, 'ADMIN-COPAY', 'Standard Visit Copay — Administrative visit copayment statement', 1, 5000, 0),
    (v_inv_void, 'ADMIN-FORMS', 'Forms Completion — Administrative school, work, or insurance form completion fee', 1, 3500, 0),
    (v_inv_refund, 'ADMIN-RECORDS', 'Records & Document Processing — Administrative records preparation and transfer fee', 1, 4500, 0)
  on conflict do nothing;

  insert into public.billing_payment_attempts (
    invoice_id, payer_user_id, paypal_order_id, status, amount_minor, currency, failure_code, failure_message, request_id
  ) values
    (v_inv_failed, v_jordan, 'DEMO-ORD-DECLINED-1004', 'failed', 5000, 'USD',
     'INSTRUMENT_DECLINED', 'PayPal Sandbox funding instrument was declined during checkout. Please retry.', 'req-demo-1004')
  on conflict (paypal_order_id) do nothing;

  insert into public.billing_transactions (
    id, invoice_id, organization_id, payer_user_id, paypal_order_id, paypal_capture_id,
    amount_minor, currency, paypal_status, payer_email_masked, verified_via, captured_at
  ) values
    (v_tx_paid, v_inv_paid, v_org, v_alex, 'SAMPLE-ORD-1003', 'SAMPLE-DEMO-SETTLEMENT-1003',
     12500, 'USD', 'COMPLETED', 'a***@demo.paypal-billing-kit.local', 'seed_demo', now() - interval '4 days'),
    (v_tx_refund, v_inv_refund, v_org, v_alex, 'SAMPLE-ORD-1006', 'SAMPLE-DEMO-SETTLEMENT-1006',
     4500, 'USD', 'COMPLETED', 'a***@demo.paypal-billing-kit.local', 'seed_demo', now() - interval '10 days')
  on conflict (paypal_capture_id) do nothing;

  insert into public.billing_refunds (
    transaction_id, invoice_id, requested_by, amount_minor, currency, status, paypal_refund_id, request_id, completed_at
  ) values
    (v_tx_refund, v_inv_refund, v_sarah, 4500, 'USD', 'completed', 'SAMPLE-DEMO-REFUND-1006', 'req-refund-1006', now() - interval '9 days')
  on conflict (request_id) do nothing;

  insert into public.billing_audit_events (organization_id, invoice_id, actor_user_id, actor_kind, event_type, details) values
    (v_org, null, v_sarah, 'user', 'organization_ensured', '{"organization":"Jenkins Wellness & Telehealth Practice"}'::jsonb),
    (v_org, v_inv_pending, v_sarah, 'user', 'invoice_created_and_sent', '{"invoice_number":"PPB-INV-2026-1001","total_minor":15000}'::jsonb),
    (v_org, v_inv_void, v_sarah, 'user', 'invoice_voided', '{"invoice_number":"PPB-INV-2026-1005","reason":"Issued in error — voided"}'::jsonb),
    (v_org, v_inv_refund, v_sarah, 'paypal', 'refund_completed', '{"invoice_number":"PPB-INV-2026-1006","amount_minor":4500}'::jsonb);
end $$;

notify pgrst, 'reload schema';
