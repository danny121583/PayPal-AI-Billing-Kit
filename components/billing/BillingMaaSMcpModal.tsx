import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  CheckCircle2,
  Cpu,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react-native';
import BillingModalShell from './BillingModalShell';
import BillingBrandIcon from './BillingBrandIcon';
import { ModalActionButtons } from '../ui/ModalActionButtons';
import {
  UNIFIED_MCP_TOOL_REGISTRY,
  UNIFIED_MCP_REGISTRY_SUMMARY,
  type UnifiedMcpToolMetadata,
} from '../../packages/paypal-billing-kit/src/mcpRegistry';

export interface BillingMaaSMcpModalProps {
  visible: boolean;
  demoSessionId: string;
  onClose: () => void;
}

const MAAS_CLOUDFLARE_ENDPOINT =
  'https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp';

const READ_ONLY_TOOLS = UNIFIED_MCP_TOOL_REGISTRY.filter(
  (t) => t.classification === 'read_only'
);
const PROPOSAL_ONLY_TOOLS = UNIFIED_MCP_TOOL_REGISTRY.filter(
  (t) => t.classification === 'proposal_only'
);
const CONFIRMED_WRITE_TOOLS = UNIFIED_MCP_TOOL_REGISTRY.filter(
  (t) => t.classification === 'confirmed_demo_write'
);

function getSourceBadgeLabel(source: UnifiedMcpToolMetadata['source']): string {
  if (source === 'official_paypal_mcp') return 'OFFICIAL MCP';
  if (source === 'paypal_rest_adapter') return 'PAYPAL REST';
  return 'APP';
}

export default function BillingMaaSMcpModal({
  visible,
  demoSessionId,
  onClose,
}: BillingMaaSMcpModalProps) {
  const [testingTool, setTestingTool] = useState(false);
  const [liveOutput, setLiveOutput] = useState<string | null>(null);

  if (!visible) return null;

  const publicOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://paypal-ai-billing-kit.vercel.app';

  const handleRunLivePing = async () => {
    setTestingTool(true);
    setLiveOutput(null);
    try {
      const response = await fetch(MAAS_CLOUDFLARE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Demo-Session-Id': demoSessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'get_invoice_details',
            arguments: {
              invoice_number: 'PPB-INV-2026-1003',
              demo_session_id: demoSessionId,
            },
          },
        }),
      });
      const json = await response.json();
      setLiveOutput(
        JSON.stringify(
          json?.result?.structuredContent || json,
          null,
          2
        ).slice(0, 2800)
      );
    } catch (err: any) {
      setLiveOutput(
        `Error invoking MCP endpoint: ${err?.message || 'Unknown error'}`
      );
    } finally {
      setTestingTool(false);
    }
  };

  return (
    <BillingModalShell
      visible={visible}
      onClose={onClose}
      title="Unified MCP Agent Interface"
      subtitle={`Connect AI agents to ${UNIFIED_MCP_REGISTRY_SUMMARY.totalTools} unified application & PayPal Sandbox tools (26 baseline + 4 Sandbox card & PDF tools) through Model Context Protocol (MCP).`}
      testID="billing-maas-mcp-modal"
      closeTestID="billing-maas-mcp-close-btn"
      closeAccessibilityLabel="Close MCP Agent Interface modal"
      footer={
        <ModalActionButtons
          actions={[
            {
              label: 'Close',
              onPress: onClose,
              variant: 'cancel',
              testID: 'billing-maas-mcp-cancel-btn',
            },
            {
              label: testingTool
                ? 'Calling MCP Endpoint...'
                : 'Test Live MCP Tool Call',
              onPress: () => void handleRunLivePing(),
              variant: 'primary',
              loading: testingTool,
              disabled: testingTool,
              icon: <Sparkles size={15} color="#FFFFFF" />,
              testID: 'billing-maas-mcp-test-btn',
            },
          ]}
        />
      }
    >
      <View style={styles.guardrailBanner}>
        <BillingBrandIcon size={20} testID="maas-modal-brand-icon" />
        <ShieldCheck size={16} color="#065F46" />
        <Text style={styles.guardrailBannerText}>
          Zero secrets exposed. Every external agent call is scoped to an
          isolated demo_session_id with $500 single-action and $2,500 daily
          guardrails + conversational authorization.
        </Text>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHeaderRow}>
          <Cpu size={15} color="#B45309" />
          <Text style={styles.sectionTitle}>Live Public Endpoints</Text>
        </View>
        <Text style={styles.label}>Active Visitor Demo Session ID</Text>
        <Text style={styles.codeBox} selectable testID="maas-active-session-id">
          {demoSessionId}
        </Text>

        <Text style={styles.label}>Dedicated Cloudflare Worker Unified MCP Gateway (Global Edge)</Text>
        <Text style={styles.codeBox} selectable testID="maas-cloudflare-endpoint">
          {MAAS_CLOUDFLARE_ENDPOINT}
        </Text>

        <Text style={styles.label}>Vercel Web App MCP Gateway (POST & GET)</Text>
        <Text style={styles.codeBox} selectable testID="maas-vercel-endpoint">
          {`${publicOrigin}/api/mcp`}
        </Text>

        <Text style={styles.label}>OpenAPI 3.1.0 Schema (ChatGPT Actions / Evaluators)</Text>
        <Text style={styles.codeBox} selectable testID="maas-openapi-endpoint">
          {`https://paypal-ai-billing-mcp.apd1034.workers.dev/api/openapi.json`}
        </Text>

        <Text style={styles.label}>Interactive MCP Documentation & Explorer</Text>
        <Text style={styles.codeBox} selectable testID="maas-docs-endpoint">
          {`https://paypal-ai-billing-mcp.apd1034.workers.dev/docs/mcp`}
        </Text>

        <Text style={styles.label}>Downloadable PDF Receipt Endpoint (Paid/Refunded Invoices)</Text>
        <Text style={styles.codeBox} selectable testID="maas-pdf-receipt-endpoint">
          {`https://paypal-ai-billing-mcp.apd1034.workers.dev/api/receipts/PPB-INV-2026-1003.pdf`}
        </Text>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHeaderRow}>
          <Terminal size={15} color="#1D4ED8" />
          <Text style={styles.sectionTitle} testID="maas-tool-count-title">
            {`${UNIFIED_MCP_REGISTRY_SUMMARY.totalTools} Exposed Tools by Permission Tier`}
          </Text>
        </View>

        <View style={styles.sourceSummaryRow} testID="maas-source-summary-row">
          <View style={[styles.sourcePill, styles.sourcePillApp]}>
            <Text style={styles.sourcePillAppText}>
              {`${UNIFIED_MCP_REGISTRY_SUMMARY.bySource.native_app} Native Application`}
            </Text>
          </View>
          <View style={[styles.sourcePill, styles.sourcePillOfficial]}>
            <Text style={styles.sourcePillOfficialText}>
              {`${UNIFIED_MCP_REGISTRY_SUMMARY.bySource.official_paypal_mcp} Official PayPal MCP`}
            </Text>
          </View>
          <View style={[styles.sourcePill, styles.sourcePillAdapter]}>
            <Text style={styles.sourcePillAdapterText}>
              {`${UNIFIED_MCP_REGISTRY_SUMMARY.bySource.paypal_rest_adapter} PayPal REST Adapter`}
            </Text>
          </View>
        </View>

        <Text style={styles.tierLabel}>
          {`1. Read-Only Discovery, Receipts & PayPal Sandbox Inspection (${READ_ONLY_TOOLS.length} Tools)`}
        </Text>
        <View style={styles.chipWrap}>
          {READ_ONLY_TOOLS.map((t) => (
            <View key={t.name} style={[styles.toolChip, styles.toolChipRead]}>
              <Text style={styles.toolChipReadText}>
                {`${t.name} [${getSourceBadgeLabel(t.source)}]`}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.tierLabel}>
          {`2. Proposal-Only — Human Approval or Conversational Instruction (${PROPOSAL_ONLY_TOOLS.length} Tools)`}
        </Text>
        <View style={styles.chipWrap}>
          {PROPOSAL_ONLY_TOOLS.map((t) => (
            <View key={t.name} style={[styles.toolChip, styles.toolChipProposal]}>
              <Text style={styles.toolChipProposalText}>
                {`${t.name} [${getSourceBadgeLabel(t.source)}]`}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.tierLabel}>
          {`3. Confirmed Financial Workflows & Conversational Writes (${CONFIRMED_WRITE_TOOLS.length} Tools)`}
        </Text>
        <View style={styles.chipWrap}>
          {CONFIRMED_WRITE_TOOLS.map((t) => (
            <View key={t.name} style={[styles.toolChip, styles.toolChipWrite]}>
              <Text style={styles.toolChipWriteText}>
                {`${t.name} [${getSourceBadgeLabel(t.source)}]`}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {liveOutput ? (
        <View
          style={[styles.sectionCard, styles.liveResultCard]}
          testID="maas-live-test-result"
        >
          <View style={styles.sectionHeaderRow}>
            <CheckCircle2 size={15} color="#047857" />
            <Text style={[styles.sectionTitle, { color: '#065F46' }]}>
              Live MCP JSON-RPC 2.0 Response (`get_invoice_details` #PPB-INV-2026-1003)
            </Text>
          </View>
          <Text style={styles.outputPre} selectable>
            {liveOutput}
          </Text>
        </View>
      ) : null}
    </BillingModalShell>
  );
}

const styles = StyleSheet.create({
  sectionCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  guardrailBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  guardrailBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: '#065F46',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  sourceSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
    marginBottom: 4,
  },
  sourcePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  sourcePillApp: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  sourcePillAppText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  sourcePillOfficial: {
    backgroundColor: '#F5F3FF',
    borderColor: '#DDD6FE',
  },
  sourcePillOfficialText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#6D28D9',
  },
  sourcePillAdapter: {
    backgroundColor: '#ECFEFF',
    borderColor: '#A5F3FC',
  },
  sourcePillAdapterText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0E7490',
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginTop: 6,
  },
  codeBox: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tierLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
    marginTop: 8,
    marginBottom: 4,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  toolChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  toolChipRead: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  toolChipReadText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E40AF',
  },
  toolChipProposal: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  toolChipProposalText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
  },
  toolChipWrite: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  toolChipWriteText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  liveResultCard: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  outputPre: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#064E3B',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 8,
    padding: 10,
  },
});
