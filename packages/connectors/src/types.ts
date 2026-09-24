export type CapabilityKey = "payments" | "email" | "sms" | "accounting" | "calendar" | "routing" | "geocoding" | "storage" | "payroll" | "crm_import" | "ai";
export type ConnectorCategory = "get_paid" | "accounting" | "calendar" | "communication" | "maps_routing" | "files" | "payroll" | "import" | "ai";
export type ConnectorState = "not_connected" | "authorizing" | "connected" | "needs_attention" | "expired" | "disabled" | "error";
export type MockScenario = "success" | "authorization_expired" | "provider_error" | "timeout";
/** Provider token response fields accepted by the server-side OAuth boundary. */
export type OAuthTokenResponse = Readonly<{
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  grantedScopes?: readonly string[];
  providerAccountId?: string;
}>;
/** Normalized OAuth credentials passed only to server-side capability factories. */
export type OAuthCredentialSet = Readonly<{
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  grantedScopes: readonly string[];
  providerAccountId?: string;
}>;
export type OAuthProviderAdapter = Readonly<{
  authorizationEndpoint: string;
  /** Public OAuth client identifier. Client secrets must remain inside the provider implementation. */
  clientId: string;
  /** Defaults to true. The shared server boundary generates and stores the verifier. */
  supportsPkce?: boolean;
  /** Provider scopes to request; when omitted the manifest's declared scopes are used. */
  scopesForCapabilities?: (capabilities: readonly CapabilityKey[]) => readonly string[];
  /** Safe, provider-defined authorization parameters such as access_type=offline. */
  authorizationParams?: Readonly<Record<string, string>>;
  /** Optional provider configuration gate; never returns configuration details. */
  isConfigured?: () => boolean;
  exchangeCode: (input: { code: string; redirectUri: string; codeVerifier?: string; signal: AbortSignal }) => Promise<OAuthTokenResponse>;
  refreshTokens?: (input: { refreshToken: string; signal: AbortSignal }) => Promise<OAuthTokenResponse>;
  revoke?: (input: { accessToken: string; refreshToken?: string; signal: AbortSignal }) => Promise<void>;
  createScope: (control: {
    ensureAvailable: () => void;
    tenantId: string;
    now: () => Date;
    tokens: OAuthCredentialSet;
    enabledCapabilities: readonly CapabilityKey[];
  }) => ScopedCapabilities;
}>;
export type ConnectorManifest = Readonly<{
  key: string;
  name: string;
  description: string;
  provider: string;
  icon: string;
  categories: readonly ConnectorCategory[];
  capabilities: readonly CapabilityKey[];
  authType: "oauth2" | "api_key" | "service_account" | "local_mock";
  requiredScopes: readonly string[];
  environments: readonly ("local" | "test" | "production")[];
  setupComplexity: "easy" | "guided" | "technical";
  discoverableResources: readonly string[];
  webhookSupport: boolean;
  syncModes: readonly ("import" | "export" | "bidirectional")[];
  version: string;
  availability: "mock_complete" | "local_ready" | "credentials_ready" | "planned";
  /** Environment-owned integration; never shown as an owner-controlled marketplace connection. */
  platformManaged?: true;
  /** Explicitly enables tenant-owned API key/service-account credential setup. */
  credentialSetup?: true;
  /** Server-enforced credential fields that the owner setup form may submit. */
  credentialFields?: readonly Readonly<{
    key: string;
    label: string;
    inputType: "password" | "textarea";
    helpText?: string;
    maxLength?: number;
  }>[];
}>;
export type InstallationView = Readonly<{
  tenantId: string;
  connectorKey: string;
  state: ConnectorState;
  health: "healthy" | "degraded" | "unavailable";
  lastErrorCode?: string;
  connectedAt?: string;
}>;

export class ConnectorError extends Error {
  constructor(readonly code: "authorization_expired" | "provider_error" | "timeout" | "connector_unavailable" | "invalid_request" | "not_connected" | "invalid_webhook_signature", message: string, readonly retryable: boolean) { super(message); this.name = "ConnectorError"; }
}

export interface PaymentCapability {
  createPaymentMethod(input: { customerId: string; testToken?: string }): Promise<{ reference: string; label: string }>;
  charge(input: { paymentMethodReference: string; amountMinor: number; currency: string; idempotencyKey: string }): Promise<{ reference: string; status: "succeeded" | "failed"; amountMinor: number; currency: string }>;
  refund(input: { paymentReference: string; amountMinor: number; idempotencyKey: string }): Promise<{ reference: string; paymentReference: string; amountMinor: number; status: "succeeded" }>;
  getPayment(reference: string): Promise<{ reference: string; status: "succeeded" | "failed"; amountMinor: number; currency: string } | undefined>;
}
/** A provider may accept a message without returning a provider-side message identifier. */
export interface EmailCapability { sendEmail(input: { to: string; subject: string; body: string; idempotencyKey: string }): Promise<{ reference?: string; status: "sent" }> }
export interface SmsCapability { sendSms(input: { to: string; body: string; idempotencyKey: string }): Promise<{ reference: string; status: "sent" }> }
export type Coordinates = { latitude: number; longitude: number };
export interface GeocodingCapability { geocode(address: string): Promise<{ formattedAddress: string; coordinates: Coordinates; confidence: number }> }
export interface RoutingCapability {
  travelMatrix(points: readonly Coordinates[]): Promise<readonly (readonly { distanceKm: number; durationMinutes: number }[])[]>;
  optimizeRoute(input: { start: Coordinates; stops: readonly { id: string; coordinates: Coordinates; locked?: boolean }[]; end?: Coordinates }): Promise<{ stopIds: readonly string[]; distanceKm: number; durationMinutes: number }>;
}
export interface StorageCapability {
  putObject(input: { key: string; content: Uint8Array; contentType: string }): Promise<{ key: string; size: number }>;
  getObject(key: string): Promise<{ content: Uint8Array; contentType: string } | undefined>;
  deleteObject(key: string): Promise<void>;
  createDownloadLink(key: string, expiresAt: string): Promise<string>;
  getObjectByDownloadLink(link: string): Promise<{ content: Uint8Array; contentType: string } | undefined>;
}
export interface AccountingCapability {
  discoverResources(): Promise<readonly { id: string; label: string }[]>;
  syncCustomer(input: { customerId: string; name: string; idempotencyKey: string }): Promise<{ externalReference: string }>;
  syncInvoice(input: { invoiceId: string; customerReference: string; totalMinor: number; currency: string; idempotencyKey: string }): Promise<{ externalReference: string }>;
  syncPayment(input: { paymentId: string; invoiceReference: string; amountMinor: number; idempotencyKey: string }): Promise<{ externalReference: string }>;
}
export interface CalendarCapability {
  discoverCalendars(): Promise<readonly { id: string; label: string }[]>;
  createEvent(input: { calendarId: string; title: string; startsAt: string; endsAt: string; idempotencyKey: string }): Promise<{ reference: string }>;
  cancelEvent(reference: string): Promise<void>;
  listEvents(calendarId: string): Promise<readonly { reference: string; title: string; startsAt: string; endsAt: string }[]>;
}
export interface PayrollCapability { exportGrossPay(input: { periodId: string; rows: readonly { staffId: string; grossMinor: number; currency: string }[]; idempotencyKey: string }): Promise<{ reference: string; rowCount: number }> }
export interface AiCapability { proposeStructuredContent(input: { businessName: string; industry: string }): Promise<{ headline: string; description: string }> }
export interface CrmImportCapability { importCustomers(input: { rows: readonly Record<string, string>[]; idempotencyKey: string }): Promise<{ reference: string; customers: readonly { name: string; email?: string; phone?: string }[] }> }
export type ConnectorCapabilities = {
  payments: PaymentCapability;
  email: EmailCapability;
  sms: SmsCapability;
  accounting: AccountingCapability;
  calendar: CalendarCapability;
  routing: RoutingCapability;
  geocoding: GeocodingCapability;
  storage: StorageCapability;
  payroll: PayrollCapability;
  crm_import: CrmImportCapability;
  ai: AiCapability;
};
export type ScopedCapabilities = Partial<ConnectorCapabilities>;
