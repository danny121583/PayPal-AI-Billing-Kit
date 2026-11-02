# 01 — Standalone Product Objectives, UI/UX Architecture & Navigation Plan

## 1. Product Objectives

**PayPal AI Billing Kit** (`/Users/danny/Desktop/PayPal-AI-Billing-Kit`) serves two aligned goals:
1. **Flagship PayPal AI Hackathon 2026 Submission:** Deliver a polished, self-contained application that looks and behaves like the approved Health eRecords 2.0 Orange Billing Dashboard—allowing judges to experience both the **Provider (Merchant)** and **Customer (Payer)** sides of AI-assisted invoicing, conversational mistake recovery, and real PayPal Sandbox checkout.
2. **Reusable Open-Source Billing Product:** Package the PayPal Orders v2, Captures v2, Refunds v2, Webhooks v1, OAuth 2.0 Account Linking, and AI Guardrail Engine (`AI Proposes -> Human Approves -> PayPal Confirms`) into a clean, domain-agnostic library (`packages/paypal-billing-kit`) and drop-in UI kit that any developer can integrate without healthcare-specific coupling.

---

## 2. Recommended Standalone Application Architecture

### Evaluation of Candidate Frontend Architectures

| Criterion | Option A: **Expo Universal App (React Native Web + Expo Go Mobile)** *(RECOMMENDED)* | Option B: Vite + React DOM (HTML/CSS Rewrite) | Option C: Progressive Web App (PWA Only) | Option D: Native-Only Expo App |
| :--- | :--- | :--- | :--- | :--- |
| **Visual Fidelity to Approved Billing Dashboard** | **100% Exact Parity** — Directly runs the existing `react-native` `StyleSheet` components (`DoctorBillingView`, `PatientBillingView`, `BillingInvoiceCard`, `BillingModalShell`, `LinearGradient` `#F59E0B` header, `lucide-react-native` icons) with zero visual drift. | Requires rewriting ~3,200 lines of React Native `View`/`Text`/`Pressable`/`StyleSheet` into HTML/CSS, risking subtle spacing, font, and modal regressions. | Same rewrite cost as Option B if not using React Native Web. | Cannot be evaluated by judges in a desktop browser without installing Expo Go. |
| **Judge Accessibility (Zero-Install Browser + Mobile)** | **Runs in any desktop/mobile browser (`npx expo start --web` / static Vercel/Netlify deploy)** AND **runs natively in Expo Go on iOS/Android**. | Browser only. | Browser + Add-to-Home-Screen only. | Mobile simulator/device only. |
| **PayPal Checkout Compatibility** | Supports standard browser redirect/popup on Web AND `expo-web-browser` / `Linking` on Mobile. | Browser redirect/JS SDK only. | Browser redirect/JS SDK only. | Mobile deep-link only. |
| **Development Time & Risk** | **Lowest Risk & Fastest Delivery** — Adapts the 11 proven billing components directly while stripping Health eRecords imports. | High rewrite effort. | Medium-high effort. | Low effort, but poor judge ergonomics on desktop. |

### Recommended Architecture
Use a **Standalone Expo Router Universal Workspace (Web + iOS/Android Expo Go)** structured as a clean monorepo:
- **`apps/billing-dashboard`** (or root Expo app): Opens **directly into the Orange Billing Dashboard (`app/index.tsx`)** on both Web (`http://localhost:4040` / hosted URL) and Mobile (Expo Go).
- **`packages/paypal-billing-kit`**: Zero-dependency TypeScript SDK extracted and generalized from `packages/paypal-agent-kit` (`PayPalOrdersClient`, `PayPalWebhookVerifier`, `BillingGuardrailEngine`, `OutboundPayloadSanitizer`).
- **`supabase/`**: Standalone database migration (`0001_paypal_ai_billing_kit.sql`) and 3 standalone Edge Functions (`paypal-billing`, `paypal-webhook`, `billing-ai-assistant`).

---

## 3. Standalone Visual Direction & Navigation Specification

### Visual Elements Retained from the Approved Dashboard
1. **Orange Rounded Header (`#F59E0B`):** Clean title (`Provider Billing` or `Customer Billing`), subtitle (`Manage invoices, PayPal Sandbox & Billing AI`), and top-right circular icon buttons.
2. **PayPal Sandbox Connection Card (`PayPalConnectCard`):** Shows connection status, masked Sandbox Merchant/Payer email & ID, OAuth 2.0 Connect/Disconnect actions, and explicit safeguard notice that Payer identity verification never grants auto-charge permission.
3. **Billing AI Entry Card:** Indigo bot badge (`#4F46E5`) + `"Billing AI"` title and role-aware subtitle opening the conversational AI bottom sheet.
4. **Financial Overview Metrics Grid (`6` Provider KPI cards / `3` Customer Hero stats):** Clickable cards opening `BillingMetricDetailModal` filtered to the selected metric.
5. **Status Filter Chips:** Horizontal pill bar (`All Statements`, `Pending`, `Overdue`, `Paid`, `Failed Attempts`, `Refunded`, `Void`).
6. **Invoice Cards & Detail Modal:** Rounded white cards (`borderRadius: 16`) with status badges, line items, receipt numbers, `Invoice Details`, `Ask Billing AI`, and Customer `Pay with PayPal` button.
7. **Modals (`BillingModalShell`):** `Create Invoice`, `Billing AI Assistant`, `Billing AI Settings & Guardrails`, `Invoice Detail`, and `Metric Detail`.

### Standalone Navigation Changes (Section 2 Requirements)
- **Remove the Home button:** No `HomeIcon` button in the header and no 5-tab Health eRecords bottom bar (`Home`, `Chat`, `Upload`, `Logs`, `Profile` are completely excluded). The application boots directly into the Billing Dashboard.
- **Keep Search (`billing-header-search-btn`):** Toggles the live search input bar filtering across invoice number (`#INV-...`), customer/provider name, service code, description, and status.
- **Keep Settings (`billing-header-settings-btn`):** Opens `BillingAISettingsModal`.
- **Keep the Header Plus (`+`) Icon (`billing-header-create-btn`):** Primary entry point for Providers to open `BillingCreateInvoiceModal`.
- **Remove the Large Duplicate `Add Invoice` Button:** Remove the full-width orange `Add Invoice` bar (`doctor-add-invoice-inline-btn` in `DoctorBillingView.tsx` lines 116–128) so invoice creation is cleanly triggered from the header `+` icon (or via Billing AI).

---

## 4. Provider & Customer Dual-Role Experience (Judge Demo Switcher)

To let hackathon judges experience both sides of a transaction effortlessly without exposing real customer data:

### Role Switcher Bar (Top of Dashboard Below Header)
A compact, segmented **Demo Role Switcher** pill bar at the top of the dashboard:
- **`Provider View (Dr. Sarah Jenkins • Merchant)`**
- **`Customer View (Alex Rivera • Payer)`** *(with optional dropdown to switch between synthetic customers `Alex Rivera` and `Jordan Taylor`)*

### How the Dual-Role Switcher Works Safely
1. **Isolated Demo Accounts in the Standalone Supabase Project:**
   - The standalone Supabase database seeds 3 synthetic demo accounts (`provider.demo@paypal-kit.local`, `alex.rivera@paypal-kit.local`, `jordan.taylor@paypal-kit.local`).
   - Switching between **Provider View** and **Customer View** switches the active authenticated Supabase session (or uses pre-signed role-scoped tokens via a dedicated `demo-session-switch` helper in Demo Mode) so **real PostgreSQL Row-Level Security (RLS)** is exercised on every query!
2. **Real-Time Cross-Role Continuity:**
   - When the judge is in **Provider View** and creates/sends an invoice to `Alex Rivera` (either manually via `+` or via Billing AI), then taps **Customer View (`Alex Rivera`)**, the newly issued invoice and unread notification badge appear immediately.
   - When the judge pays the invoice via PayPal Sandbox in **Customer View**, the invoice transitions to `PAID`, a receipt is generated, and switching back to **Provider View** shows the updated `Paid Invoices` KPI, `$0.00` balance, and `Payment received` alert.
