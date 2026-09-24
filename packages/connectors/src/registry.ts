import { ConnectorError, type CapabilityKey, type ConnectorCapabilities, type ConnectorManifest, type InstallationView, type MockScenario, type OAuthCredentialSet, type OAuthProviderAdapter, type ScopedCapabilities } from "./types.ts";

export type ConnectorDefinition = Readonly<{
  manifest: ConnectorManifest;
  createScope?: (control: { ensureAvailable: () => void; tenantId: string; now: () => Date }) => ScopedCapabilities;
  createConfiguredScope?: (control: {
    ensureAvailable: () => void;
    tenantId: string;
    now: () => Date;
    credentials: Readonly<Record<string, string>>;
  }) => ScopedCapabilities;
  /** Complete provider-specific OAuth behavior; generic routes own state, callback and token storage. */
  oauth?: OAuthProviderAdapter;
}>;
type Installation = { tenantId: string; connectorKey: string; state: InstallationView["state"]; scenario: MockScenario; stateNonce?: string; capabilities?: ScopedCapabilities; connectedAt?: string; lastErrorCode?: string; webhookEvents: Set<string> };

export const CAPABILITY_LABELS: Readonly<Record<CapabilityKey, string>> = {
  payments: "Accept payments", email: "Send email", sms: "Send text messages", accounting: "Sync accounting", calendar: "Connect my calendar", routing: "Plan efficient routes", geocoding: "Find service addresses", storage: "Store files", payroll: "Export payroll", crm_import: "Import my customers", ai: "Draft content",
};

export function validateConnectorManifest(manifest: ConnectorManifest): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.key) || !manifest.name || !manifest.provider || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Invalid connector manifest identity");
  if (!manifest.capabilities.length || new Set(manifest.capabilities).size !== manifest.capabilities.length) throw new Error(`Connector ${manifest.key} needs unique capabilities`);
  for (const capability of manifest.capabilities) if (!(capability in CAPABILITY_LABELS)) throw new Error(`Unknown capability ${capability}`);
  if (manifest.availability === "mock_complete" && manifest.authType !== "local_mock") throw new Error("Mock-complete connector must use local mock auth");
  if (manifest.platformManaged && (manifest.availability !== "credentials_ready" || manifest.authType !== "service_account" || manifest.credentialSetup)) throw new Error("Platform-managed connectors require server-owned service-account configuration");
  if (manifest.credentialSetup && (manifest.availability !== "credentials_ready" || !["api_key", "service_account"].includes(manifest.authType))) throw new Error("Tenant credential setup requires a credentials-ready API-key or service-account connector");
  if (manifest.credentialSetup && (!manifest.credentialFields?.length || manifest.credentialFields.length > 8)) throw new Error("Credential setup requires 1–8 declared credential fields");
  if (manifest.credentialFields && (new Set(manifest.credentialFields.map((field) => field.key)).size !== manifest.credentialFields.length
    || manifest.credentialFields.some((field) => !/^[a-z][a-zA-Z0-9_]{0,63}$/.test(field.key) || !field.label.trim()
      || field.label.length > 100 || (field.helpText?.length ?? 0) > 240 || (field.maxLength ?? 8192) < 1 || (field.maxLength ?? 8192) > 8192))) {
    throw new Error(`Connector ${manifest.key} has invalid credential field metadata`);
  }
}

function validAuthorizationEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)))
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
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
    if (definition.oauth && (definition.manifest.authType !== "oauth2" || definition.manifest.availability !== "credentials_ready")) {
      throw new Error("OAuth adapters require a credentials-ready OAuth manifest");
    }
    if (this.definitions.has(definition.manifest.key)) throw new Error(`Connector already registered: ${definition.manifest.key}`);
    this.definitions.set(definition.manifest.key, definition);
  }
  getDefinition(connectorKey: string): ConnectorDefinition | undefined { return this.definitions.get(connectorKey); }
  /** Returns an adapter only after its complete flow and public app configuration are present. */
  getOAuthAdapter(connectorKey: string): OAuthProviderAdapter | undefined {
    const definition = this.definitions.get(connectorKey);
    const manifest = definition?.manifest;
    const adapter = definition?.oauth;
    try {
      if (!manifest || manifest.availability !== "credentials_ready" || manifest.authType !== "oauth2" || !adapter
        || !validAuthorizationEndpoint(adapter.authorizationEndpoint) || !adapter.clientId.trim()
        || typeof adapter.exchangeCode !== "function" || typeof adapter.createScope !== "function"
        || (adapter.isConfigured && !adapter.isConfigured())) return undefined;
    } catch { return undefined; }
    return adapter;
  }
  /** Readiness suitable for a safe marketplace response; no configuration detail is returned. */
  isOAuthAvailable(connectorKey: string): boolean { return Boolean(this.getOAuthAdapter(connectorKey)); }
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
    if (definition.manifest.availability === "credentials_ready") throw new ConnectorError("connector_unavailable", "Use the live provider connection flow for this service", false);
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
  connectConfigured(tenantId: string, connectorKey: string, credentials: Readonly<Record<string, string>>): InstallationView {
    const definition = this.definitions.get(connectorKey);
    const manifest = definition?.manifest;
    if (!definition || !manifest || manifest.availability !== "credentials_ready" || manifest.credentialSetup !== true
      || !["api_key", "service_account"].includes(manifest.authType)) {
      throw new ConnectorError("connector_unavailable", "This service is not ready for a live connection", false);
    }
    const fields = manifest.credentialFields ?? [];
    const keys = Object.keys(credentials);
    if (keys.length !== fields.length || keys.some((key) => !fields.some((field) => field.key === key))
      || fields.some((field) => typeof credentials[field.key] !== "string" || !credentials[field.key]!.trim()
        || credentials[field.key]!.length > (field.maxLength ?? 8192))) {
      throw new ConnectorError("invalid_request", "Connector credential fields do not match the manifest", false);
    }
    if (!definition.createConfiguredScope) throw new ConnectorError("connector_unavailable", "The live connection flow for this service is not available yet", false);
    const installation = this.getOrCreate(tenantId, connectorKey);
    const safeCredentials = Object.freeze({ ...credentials });
    const capabilities = definition.createConfiguredScope({
      tenantId, credentials: safeCredentials, now: this.now,
      ensureAvailable: () => this.ensureAvailable(installation),
    });
    installation.state = "connected";
    installation.scenario = "success";
    installation.lastErrorCode = undefined;
    installation.connectedAt = this.now().toISOString();
    installation.capabilities = capabilities;
    return this.getInstallation(tenantId, connectorKey);
  }
  /** Activates a server-configured connector without exposing its credentials in tenant setup. */
  connectPlatformManaged(tenantId: string, connectorKey: string): InstallationView {
    const definition = this.definitions.get(connectorKey);
    const manifest = definition?.manifest;
    if (!definition || !manifest?.platformManaged || manifest.availability !== "credentials_ready" || manifest.authType !== "service_account" || !definition.createConfiguredScope) {
      throw new ConnectorError("connector_unavailable", "This platform connection is not configured", false);
    }
    const installation = this.getOrCreate(tenantId, connectorKey);
    const capabilities = definition.createConfiguredScope({
      tenantId, credentials: Object.freeze({}), now: this.now,
      ensureAvailable: () => this.ensureAvailable(installation),
    });
    installation.state = "connected";
    installation.scenario = "success";
    installation.lastErrorCode = undefined;
    installation.connectedAt = this.now().toISOString();
    installation.capabilities = capabilities;
    return this.getInstallation(tenantId, connectorKey);
  }
  createOAuthScope(tenantId: string, connectorKey: string, tokens: OAuthCredentialSet, enabledCapabilities: readonly CapabilityKey[]): ScopedCapabilities {
    const definition = this.definitions.get(connectorKey);
    const adapter = this.getOAuthAdapter(connectorKey);
    if (!definition || !adapter) throw new ConnectorError("connector_unavailable", "The live connection flow for this service is not available yet", false);
    const installation = this.getOrCreate(tenantId, connectorKey);
    try {
      return adapter.createScope({ tenantId, now: this.now, tokens, enabledCapabilities,
        ensureAvailable: () => this.ensureAvailable(installation) });
    } catch {
      throw new ConnectorError("provider_error", "The service connection could not be configured.", false);
    }
  }
  installOAuthScope(tenantId: string, connectorKey: string, capabilities: ScopedCapabilities): InstallationView {
    const installation = this.getOrCreate(tenantId, connectorKey);
    installation.state = "connected";
    installation.scenario = "success";
    installation.lastErrorCode = undefined;
    installation.connectedAt = this.now().toISOString();
    installation.capabilities = capabilities;
    return this.getInstallation(tenantId, connectorKey);
  }
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
