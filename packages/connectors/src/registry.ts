import { ConnectorError, type CapabilityKey, type ConnectorCapabilities, type ConnectorManifest, type InstallationView, type MockScenario, type ScopedCapabilities } from "./types.ts";

export type ConnectorDefinition = Readonly<{ manifest: ConnectorManifest; createScope?: (control: { ensureAvailable: () => void; tenantId: string; now: () => Date }) => ScopedCapabilities }>;
type Installation = { tenantId: string; connectorKey: string; state: InstallationView["state"]; scenario: MockScenario; stateNonce?: string; capabilities?: ScopedCapabilities; connectedAt?: string; lastErrorCode?: string; webhookEvents: Set<string> };

export const CAPABILITY_LABELS: Readonly<Record<CapabilityKey, string>> = {
  payments: "Accept payments", email: "Send email", sms: "Send text messages", accounting: "Sync accounting", calendar: "Connect my calendar", routing: "Plan efficient routes", geocoding: "Find service addresses", storage: "Store files", payroll: "Export payroll", crm_import: "Import my customers", ai: "Draft content",
};

export function validateConnectorManifest(manifest: ConnectorManifest): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.key) || !manifest.name || !manifest.provider || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Invalid connector manifest identity");
  if (!manifest.capabilities.length || new Set(manifest.capabilities).size !== manifest.capabilities.length) throw new Error(`Connector ${manifest.key} needs unique capabilities`);
  for (const capability of manifest.capabilities) if (!(capability in CAPABILITY_LABELS)) throw new Error(`Unknown capability ${capability}`);
  if (manifest.availability === "mock_complete" && manifest.authType !== "local_mock") throw new Error("Mock-complete connector must use local mock auth");
}

function installationKey(tenantId: string, connectorKey: string): string { return `${encodeURIComponent(tenantId)}:${encodeURIComponent(connectorKey)}`; }

export class ConnectorRegistry {
  private readonly definitions = new Map<string, ConnectorDefinition>();
  private readonly installations = new Map<string, Installation>();
  private readonly primary = new Map<string, string>();
  private nonce = 0;
  constructor(private readonly now: () => Date = () => new Date()) {}

  register(definition: ConnectorDefinition): void {
    validateConnectorManifest(definition.manifest);
    if (this.definitions.has(definition.manifest.key)) throw new Error(`Connector already registered: ${definition.manifest.key}`);
    this.definitions.set(definition.manifest.key, definition);
  }
  listCatalog(capability?: CapabilityKey): readonly ConnectorManifest[] {
    return [...this.definitions.values()].map((definition) => definition.manifest).filter((manifest) => !capability || manifest.capabilities.includes(capability)).sort((a, b) => a.name.localeCompare(b.name));
  }
  listByCapability(): Readonly<Record<CapabilityKey, readonly ConnectorManifest[]>> {
    return Object.fromEntries(Object.keys(CAPABILITY_LABELS).map((key) => [key, this.listCatalog(key as CapabilityKey)])) as Record<CapabilityKey, readonly ConnectorManifest[]>;
  }
  private getOrCreate(tenantId: string, connectorKey: string): Installation {
    if (!tenantId.trim()) throw new Error("Tenant ID is required");
    if (!this.definitions.has(connectorKey)) throw new ConnectorError("connector_unavailable", `Unknown connector ${connectorKey}`, false);
    const key = installationKey(tenantId, connectorKey);
    let installation = this.installations.get(key);
    if (!installation) { installation = { tenantId, connectorKey, state: "not_connected", scenario: "success", webhookEvents: new Set() }; this.installations.set(key, installation); }
    return installation;
  }
  beginAuthorization(tenantId: string, connectorKey: string): { state: string; authorizationUrl?: string } {
    const installation = this.getOrCreate(tenantId, connectorKey);
    const definition = this.definitions.get(connectorKey)!;
    if (!definition.createScope) throw new ConnectorError("connector_unavailable", `${definition.manifest.name} is not available yet`, false);
    const state = `mock-state-${++this.nonce}`;
    installation.stateNonce = state;
    installation.state = "authorizing";
    return { state };
  }
  completeAuthorization(tenantId: string, connectorKey: string, input: { state: string; code: string }): InstallationView {
    const installation = this.getOrCreate(tenantId, connectorKey);
    if (installation.state !== "authorizing" || !installation.stateNonce || installation.stateNonce !== input.state || input.code !== "mock-approved") throw new ConnectorError("invalid_request", "Invalid authorization response", false);
    const definition = this.definitions.get(connectorKey)!;
    installation.stateNonce = undefined;
    installation.state = "connected";
    installation.scenario = "success";
    installation.connectedAt = this.now().toISOString();
    installation.capabilities = definition.createScope!({ tenantId, now: this.now, ensureAvailable: () => this.ensureAvailable(installation) });
    return this.getInstallation(tenantId, connectorKey);
  }
  connectMock(tenantId: string, connectorKey: string): InstallationView {
    const state = this.beginAuthorization(tenantId, connectorKey).state;
    return this.completeAuthorization(tenantId, connectorKey, { state, code: "mock-approved" });
  }
  connectLocal(tenantId: string, connectorKey: string): InstallationView { return this.connectMock(tenantId, connectorKey); }
  disconnect(tenantId: string, connectorKey: string): InstallationView {
    const installation = this.getOrCreate(tenantId, connectorKey);
    installation.state = "not_connected";
    installation.capabilities = undefined;
    installation.stateNonce = undefined;
    installation.lastErrorCode = undefined;
    for (const [key, value] of this.primary) if (value === connectorKey && key.startsWith(`${encodeURIComponent(tenantId)}:`)) this.primary.delete(key);
    return this.getInstallation(tenantId, connectorKey);
  }
  setScenario(tenantId: string, connectorKey: string, scenario: MockScenario): void {
    const installation = this.getOrCreate(tenantId, connectorKey);
    if (!installation.capabilities) throw new ConnectorError("not_connected", "Connect this service before setting a test scenario", false);
    installation.scenario = scenario;
    installation.state = scenario === "authorization_expired" ? "expired" : "connected";
    installation.lastErrorCode = scenario === "success" ? undefined : scenario;
  }
  private ensureAvailable(installation: Installation): void {
    if (installation.state === "not_connected" || installation.state === "authorizing" || installation.state === "disabled") throw new ConnectorError("not_connected", "Connect this service first", false);
    if (installation.scenario === "authorization_expired") throw new ConnectorError("authorization_expired", "Reconnect this service", false);
    if (installation.scenario === "provider_error") throw new ConnectorError("provider_error", "Service temporarily unavailable", true);
    if (installation.scenario === "timeout") throw new ConnectorError("timeout", "Service timed out", true);
  }
  getInstallation(tenantId: string, connectorKey: string): InstallationView {
    const installation = this.getOrCreate(tenantId, connectorKey);
    const health = installation.state === "connected" && installation.scenario === "success" ? "healthy" : installation.state === "not_connected" ? "unavailable" : "degraded";
    return Object.freeze({ tenantId, connectorKey, state: installation.state, health, ...(installation.lastErrorCode ? { lastErrorCode: installation.lastErrorCode } : {}), ...(installation.connectedAt ? { connectedAt: installation.connectedAt } : {}) });
  }
  listInstallations(tenantId: string): readonly InstallationView[] {
    return [...this.installations.values()].filter((item) => item.tenantId === tenantId).map((item) => this.getInstallation(tenantId, item.connectorKey));
  }
  healthCheck(tenantId: string, connectorKey: string): InstallationView { return this.getInstallation(tenantId, connectorKey); }
  setPrimary(tenantId: string, capability: CapabilityKey, connectorKey: string): void {
    const installation = this.getOrCreate(tenantId, connectorKey);
    if (installation.state !== "connected" || !installation.capabilities?.[capability]) throw new ConnectorError("not_connected", "Capability is not connected", false);
    this.primary.set(`${encodeURIComponent(tenantId)}:${capability}`, connectorKey);
  }
  getCapability<K extends CapabilityKey>(tenantId: string, capability: K): ConnectorCapabilities[K] | undefined {
    const preferred = this.primary.get(`${encodeURIComponent(tenantId)}:${capability}`);
    const candidates = [...this.installations.values()].filter((item) => item.tenantId === tenantId && item.state === "connected" && item.capabilities?.[capability]);
    candidates.sort((a, b) => (a.connectorKey === preferred ? -1 : b.connectorKey === preferred ? 1 : a.connectorKey.localeCompare(b.connectorKey)));
    return candidates[0]?.capabilities?.[capability] as ConnectorCapabilities[K] | undefined;
  }
  /** A signature and event ID are checked before any side effect. The signature scheme is mock-only. */
  handleMockWebhook(input: { tenantId: string; connectorKey: string; eventId: string; signature: string; payload: Record<string, unknown> }): { accepted: boolean; duplicate: boolean; payload?: Record<string, unknown> } {
    const installation = this.getOrCreate(input.tenantId, input.connectorKey);
    if (installation.state !== "connected") throw new ConnectorError("not_connected", "Connect this service first", false);
    if (input.signature !== mockWebhookSignature(input.tenantId, input.connectorKey, input.eventId)) throw new ConnectorError("invalid_webhook_signature", "Webhook signature invalid", false);
    if (installation.webhookEvents.has(input.eventId)) return { accepted: true, duplicate: true };
    installation.webhookEvents.add(input.eventId);
    return { accepted: true, duplicate: false, payload: input.payload };
  }
}

export function mockWebhookSignature(tenantId: string, connectorKey: string, eventId: string): string { return `mock:${encodeURIComponent(tenantId)}:${encodeURIComponent(connectorKey)}:${encodeURIComponent(eventId)}`; }
