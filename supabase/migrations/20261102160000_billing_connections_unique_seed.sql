-- Ensure unique (user_id, connection_type) constraint on billing_account_connections,
-- allow demo persona connection read access, and seed connected PayPal Sandbox accounts.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billing_account_connections_user_type_key'
  ) THEN
    ALTER TABLE public.billing_account_connections
      ADD CONSTRAINT billing_account_connections_user_type_key UNIQUE (user_id, connection_type);
  END IF;
END $$;

DROP POLICY IF EXISTS "Allow public demo read of demo persona connections" ON public.billing_account_connections;
CREATE POLICY "Allow public demo read of demo persona connections"
  ON public.billing_account_connections
  FOR SELECT
  TO anon, authenticated
  USING (
    user_id IN (
      '11111111-1111-4111-8111-111111111101'::uuid,
      '11111111-1111-4111-8111-111111111102'::uuid,
      '11111111-1111-4111-8111-111111111103'::uuid
    )
    OR auth.uid() = user_id
  );

INSERT INTO public.billing_account_connections (
  user_id,
  connection_type,
  paypal_environment,
  paypal_merchant_id,
  paypal_payer_id,
  paypal_email_masked,
  connection_status,
  scopes,
  connected_at
) VALUES
  (
    '11111111-1111-4111-8111-111111111101',
    'provider_merchant',
    'sandbox',
    'SB-MERCHANT-CLINIC-01',
    NULL,
    'b***g@paypal-demo.example.com',
    'connected',
    ARRAY['https://uri.paypal.com/services/invoicing', 'https://uri.paypal.com/services/payments/realtimepayment'],
    now()
  ),
  (
    '11111111-1111-4111-8111-111111111102',
    'patient_payer',
    'sandbox',
    NULL,
    'SB-PAYER-ALEX-02',
    'a***a@personal.example.com',
    'connected',
    ARRAY['openid', 'email', 'https://uri.paypal.com/services/payments/FuturePayments'],
    now()
  ),
  (
    '11111111-1111-4111-8111-111111111103',
    'patient_payer',
    'sandbox',
    NULL,
    'SB-PAYER-JORDAN-03',
    'j***t@personal.example.com',
    'connected',
    ARRAY['openid', 'email', 'https://uri.paypal.com/services/payments/FuturePayments'],
    now()
  )
ON CONFLICT (user_id, connection_type) DO UPDATE SET
  connection_status = EXCLUDED.connection_status,
  paypal_merchant_id = EXCLUDED.paypal_merchant_id,
  paypal_payer_id = EXCLUDED.paypal_payer_id,
  paypal_email_masked = EXCLUDED.paypal_email_masked,
  connected_at = EXCLUDED.connected_at,
  disconnected_at = NULL,
  updated_at = now();
