import { ConnectorRegistry, type ConnectorDefinition } from "./registry.ts";
import { ConnectorError, type CapabilityKey, type ConnectorCategory, type ConnectorManifest, type Coordinates, type ScopedCapabilities } from "./types.ts";
import { createTwilioConfiguredScope } from "./providers/twilio.ts";
import { createOpenAiConfiguredScope } from "./providers/openai.ts";
import { createGoogleMapsConfiguredScope } from "./providers/google-maps.ts";
import { createMapboxConfiguredScope } from "./providers/mapbox.ts";
import { createGoogleWorkspaceConnector } from "./providers/google-workspace.ts";
import { createMicrosoft365ConnectorDefinition } from "./providers/microsoft-365.ts";

function manifest(key: string, name: string, description: string, category: ConnectorCategory, capabilities: readonly CapabilityKey[], resources: readonly string[] = [], webhookSupport = false): ConnectorManifest {
  return { key, name, description, provider: "Modular CRM Test", icon: "flask", categories: [category], capabilities, authType: "local_mock", requiredScopes: [], environments: ["local", "test"], setupComplexity: "easy", discoverableResources: resources, webhookSupport, syncModes: [], version: "1.0.0", availability: "mock_complete" };
}

function checkedAmount(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new ConnectorError("invalid_request", "Amount must be a positive integer in minor units", false);
}
function checkedCurrency(currency: string): void {
  if (!/^[A-Z]{3}$/.test(currency)) throw new ConnectorError("invalid_request", "Currency must be an uppercase ISO code", false);
}
function checkedKey(key: string): void {
  if (!key.trim()) throw new ConnectorError("invalid_request", "Idempotency key is required", false);
}

function createPayments(ensureAvailable: () => void): ScopedCapabilities {
  let nextMethod = 0;
  let nextPayment = 0;
  let nextRefund = 0;
  const methods = new Map<string, { customerId: string; testToken: string }>();
  const payments = new Map<string, { reference: string; status: "succeeded" | "failed"; amountMinor: number; currency: string; refundedMinor: number }>();
  const charges = new Map<string, { request: string; result: { reference: string; status: "succeeded" | "failed"; amountMinor: number; currency: string } }>();
  const refunds = new Map<string, { request: string; result: { reference: string; paymentReference: string; amountMinor: number; status: "succeeded" } }>();
  return { payments: {
    async createPaymentMethod(input) {
      ensureAvailable();
      if (!input.customerId.trim()) throw new ConnectorError("invalid_request", "Customer is required", false);
      const reference = `mock_pm_${++nextMethod}`;
      methods.set(reference, { customerId: input.customerId, testToken: input.testToken ?? "approved" });
      return { reference, label: "Test payment method" };
    },
    async charge(input) {
      ensureAvailable(); checkedAmount(input.amountMinor); checkedCurrency(input.currency); checkedKey(input.idempotencyKey);
      const request = `${input.paymentMethodReference}:${input.amountMinor}:${input.currency}`;
      const existing = charges.get(input.idempotencyKey);
      if (existing) { if (existing.request !== request) throw new ConnectorError("invalid_request", "Idempotency key was already used for a different payment", false); return existing.result; }
      const method = methods.get(input.paymentMethodReference);
      if (!method) throw new ConnectorError("invalid_request", "Payment method reference was not found", false);
      const status = method.testToken === "decline" ? "failed" : "succeeded";
      const result = { reference: `mock_pay_${++nextPayment}`, status, amountMinor: input.amountMinor, currency: input.currency } as const;
      payments.set(result.reference, { ...result, refundedMinor: 0 });
      charges.set(input.idempotencyKey, { request, result });
      return result;
    },
    async refund(input) {
      ensureAvailable(); checkedAmount(input.amountMinor); checkedKey(input.idempotencyKey);
      const request = `${input.paymentReference}:${input.amountMinor}`;
      const existing = refunds.get(input.idempotencyKey);
      if (existing) { if (existing.request !== request) throw new ConnectorError("invalid_request", "Idempotency key was already used for a different refund", false); return existing.result; }
      const payment = payments.get(input.paymentReference);
      if (!payment || payment.status !== "succeeded" || payment.refundedMinor + input.amountMinor > payment.amountMinor) throw new ConnectorError("invalid_request", "Refund exceeds the successful payment", false);
      payment.refundedMinor += input.amountMinor;
      const result = { reference: `mock_ref_${++nextRefund}`, paymentReference: input.paymentReference, amountMinor: input.amountMinor, status: "succeeded" as const };
      refunds.set(input.idempotencyKey, { request, result });
      return result;
    },
    async getPayment(reference) {
      ensureAvailable();
      const item = payments.get(reference);
      return item ? { reference: item.reference, status: item.status, amountMinor: item.amountMinor, currency: item.currency } : undefined;
    },
  } };
}

function createMessaging(ensureAvailable: () => void): ScopedCapabilities {
  const emails = new Map<string, { reference: string; status: "sent" }>();
  const sms = new Map<string, { reference: string; status: "sent" }>();
  return {
    email: { async sendEmail(input) { ensureAvailable(); checkedKey(input.idempotencyKey); if (!input.to.includes("@") || !input.subject.trim()) throw new ConnectorError("invalid_request", "Email address and subject are required", false); const prior = emails.get(input.idempotencyKey); if (prior) return prior; const result = { reference: `mock_email_${emails.size + 1}`, status: "sent" as const }; emails.set(input.idempotencyKey, result); return result; } },
    sms: { async sendSms(input) { ensureAvailable(); checkedKey(input.idempotencyKey); if (!/^\+?[0-9]{7,15}$/.test(input.to) || !input.body.trim()) throw new ConnectorError("invalid_request", "Phone number and message are required", false); const prior = sms.get(input.idempotencyKey); if (prior) return prior; const result = { reference: `mock_sms_${sms.size + 1}`, status: "sent" as const }; sms.set(input.idempotencyKey, result); return result; } },
  };
}

function distanceKm(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav)) * 10) / 10;
}
function leg(a: Coordinates, b: Coordinates) {
  const km = distanceKm(a, b) * 1.25; // local road detour factor
  return { distanceKm: Math.round(km * 10) / 10, durationMinutes: Math.max(3, Math.round(km / 40 * 60)) };
}
function createRouting(ensureAvailable: () => void): ScopedCapabilities {
  return {
    geocoding: { async geocode(address) {
      ensureAvailable(); if (address.trim().length < 5) throw new ConnectorError("invalid_request", "Enter a service address", false);
      let hash = 2166136261;
      for (const char of address.trim().toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
      return { formattedAddress: address.trim(), coordinates: { latitude: 33.3 + (hash % 5000) / 100000, longitude: -82.1 + (Math.floor(hash / 5000) % 5000) / 100000 }, confidence: 0.95 };
    } },
    routing: {
      async travelMatrix(points) { ensureAvailable(); return points.map((from) => points.map((to) => leg(from, to))); },
      async optimizeRoute(input) {
        ensureAvailable();
        const remaining = [...input.stops];
        const ordered: typeof remaining = [];
        let current = input.start;
        for (let position = 0; position < input.stops.length; position++) {
          const fixed = input.stops[position];
          let index = fixed?.locked ? remaining.findIndex((stop) => stop.id === fixed.id) : remaining.findIndex((stop) => !stop.locked);
          if (index < 0) throw new ConnectorError("invalid_request", "Route has conflicting locked stops", false);
          if (!fixed?.locked) for (let i = 0; i < remaining.length; i++) if (!remaining[i]!.locked && distanceKm(current, remaining[i]!.coordinates) < distanceKm(current, remaining[index]!.coordinates)) index = i;
          const [next] = remaining.splice(index, 1);
          ordered.push(next!);
          current = next!.coordinates;
        }
        const points = [input.start, ...ordered.map((stop) => stop.coordinates), ...(input.end ? [input.end] : [])];
        const legs = points.slice(1).map((point, index) => leg(points[index]!, point));
        return { stopIds: ordered.map((stop) => stop.id), distanceKm: Math.round(legs.reduce((sum, item) => sum + item.distanceKm, 0) * 10) / 10, durationMinutes: legs.reduce((sum, item) => sum + item.durationMinutes, 0) };
      },
    },
  };
}

function createStorage(ensureAvailable: () => void, now: () => Date): ScopedCapabilities {
  const objects = new Map<string, { content: Uint8Array; contentType: string }>();
  const links = new Map<string, { key: string; expiresAt: number }>();
  const validateObjectKey = (key: string) => { if (!key || key.includes("..") || key.startsWith("/")) throw new ConnectorError("invalid_request", "Invalid object key", false); };
  return { storage: {
    async putObject(input) { ensureAvailable(); validateObjectKey(input.key); if (!input.contentType.trim()) throw new ConnectorError("invalid_request", "Content type is required", false); objects.set(input.key, { content: new Uint8Array(input.content), contentType: input.contentType }); return { key: input.key, size: input.content.length }; },
    async getObject(key) { ensureAvailable(); validateObjectKey(key); const item = objects.get(key); return item ? { content: new Uint8Array(item.content), contentType: item.contentType } : undefined; },
    async deleteObject(key) { ensureAvailable(); validateObjectKey(key); objects.delete(key); },
    async createDownloadLink(key, expiresAt) { ensureAvailable(); validateObjectKey(key); if (!objects.has(key)) throw new ConnectorError("invalid_request", "Object was not found", false); const expiry = new Date(expiresAt).getTime(); if (!Number.isFinite(expiry) || expiry <= now().getTime()) throw new ConnectorError("invalid_request", "Expiration must be in the future", false); const link = `mock-storage://${encodeURIComponent(key)}?expires=${encodeURIComponent(expiresAt)}`; links.set(link, { key, expiresAt: expiry }); return link; },
    async getObjectByDownloadLink(link) { ensureAvailable(); const entry = links.get(link); if (!entry || entry.expiresAt <= now().getTime()) throw new ConnectorError("invalid_request", "Link is invalid or expired", false); const item = objects.get(entry.key); return item ? { content: new Uint8Array(item.content), contentType: item.contentType } : undefined; },
  } };
}

function createAccounting(ensureAvailable: () => void): ScopedCapabilities {
  const refs = new Map<string, string>();
  const sync = (kind: string, id: string, key: string) => { checkedKey(key); if (!id.trim()) throw new ConnectorError("invalid_request", "Record ID is required", false); const idempotencyKey = `${kind}:${key}`; let reference = refs.get(idempotencyKey); if (!reference) { reference = `mock_${kind}_${refs.size + 1}`; refs.set(idempotencyKey, reference); } return { externalReference: reference }; };
  return { accounting: {
    async discoverResources() { ensureAvailable(); return [{ id: "mock-books", label: "Test accounting company" }]; },
    async syncCustomer(input) { ensureAvailable(); return sync("customer", input.customerId, input.idempotencyKey); },
    async syncInvoice(input) { ensureAvailable(); checkedAmount(input.totalMinor); checkedCurrency(input.currency); return sync("invoice", input.invoiceId, input.idempotencyKey); },
    async syncPayment(input) { ensureAvailable(); checkedAmount(input.amountMinor); return sync("payment", input.paymentId, input.idempotencyKey); },
  } };
}

function createCalendar(ensureAvailable: () => void): ScopedCapabilities {
  const events = new Map<string, { reference: string; calendarId: string; title: string; startsAt: string; endsAt: string }>();
  const idempotency = new Map<string, string>();
  return { calendar: {
    async discoverCalendars() { ensureAvailable(); return [{ id: "mock-calendar", label: "Test calendar" }]; },
    async createEvent(input) {
      ensureAvailable(); checkedKey(input.idempotencyKey);
      if (input.calendarId !== "mock-calendar" || new Date(input.startsAt).getTime() >= new Date(input.endsAt).getTime()) throw new ConnectorError("invalid_request", "Choose a calendar and valid time range", false);
      const previous = idempotency.get(input.idempotencyKey); if (previous) return { reference: previous };
      const reference = `mock_event_${events.size + 1}`;
      events.set(reference, { reference, calendarId: input.calendarId, title: input.title, startsAt: input.startsAt, endsAt: input.endsAt });
      idempotency.set(input.idempotencyKey, reference);
      return { reference };
    },
    async cancelEvent(reference) { ensureAvailable(); events.delete(reference); },
    async listEvents(calendarId) { ensureAvailable(); return [...events.values()].filter((event) => event.calendarId === calendarId).map(({ reference, title, startsAt, endsAt }) => ({ reference, title, startsAt, endsAt })); },
  } };
}

function createPayroll(ensureAvailable: () => void): ScopedCapabilities {
  const exports = new Map<string, { reference: string; rowCount: number }>();
  return { payroll: { async exportGrossPay(input) { ensureAvailable(); checkedKey(input.idempotencyKey); const prior = exports.get(input.idempotencyKey); if (prior) return prior; for (const row of input.rows) { checkedAmount(row.grossMinor); checkedCurrency(row.currency); } const result = { reference: `mock_payroll_${exports.size + 1}`, rowCount: input.rows.length }; exports.set(input.idempotencyKey, result); return result; } } };
}

function createAi(ensureAvailable: () => void): ScopedCapabilities {
  return { ai: { async proposeStructuredContent(input) { ensureAvailable(); const businessName = input.businessName.trim(); if (!businessName) throw new ConnectorError("invalid_request", "Business name is required", false); return { headline: `${businessName} makes service simple`, description: `Reliable ${input.industry.trim() || "local"} service from ${businessName}.` }; } } };
}

function createImport(ensureAvailable: () => void): ScopedCapabilities {
  const imports = new Map<string, { reference: string; customers: readonly { name: string; email?: string; phone?: string }[] }>();
  return { crm_import: { async importCustomers(input) { ensureAvailable(); checkedKey(input.idempotencyKey); const prior = imports.get(input.idempotencyKey); if (prior) return prior; const customers = input.rows.map((row) => ({ name: row.name ?? row.customer_name ?? "", ...(row.email ? { email: row.email } : {}), ...(row.phone ? { phone: row.phone } : {}) })).filter((item) => item.name.trim()); const result = { reference: `mock_import_${imports.size + 1}`, customers }; imports.set(input.idempotencyKey, result); return result; } } };
}

export const MOCK_CONNECTOR_DEFINITIONS: readonly ConnectorDefinition[] = [
  { manifest: manifest("mock-payments", "Test payments", "Try payment, failure and refund flows without real money.", "get_paid", ["payments"], ["business"], true), createScope: ({ ensureAvailable }) => createPayments(ensureAvailable) },
  { manifest: manifest("mock-communication", "Test messages", "Send test emails and text messages.", "communication", ["email", "sms"], ["sender"], true), createScope: ({ ensureAvailable }) => createMessaging(ensureAvailable) },
  { manifest: manifest("mock-routing", "Test maps and routes", "Geocode addresses and plan deterministic routes.", "maps_routing", ["geocoding", "routing"]), createScope: ({ ensureAvailable }) => createRouting(ensureAvailable) },
  { manifest: manifest("mock-storage", "Test files", "Keep protected files in memory for local use.", "files", ["storage"]), createScope: ({ ensureAvailable, now }) => createStorage(ensureAvailable, now) },
  { manifest: manifest("mock-accounting", "Test accounting", "Try customer, invoice and payment sync.", "accounting", ["accounting"], ["company"]), createScope: ({ ensureAvailable }) => createAccounting(ensureAvailable) },
  { manifest: manifest("mock-calendar", "Test calendar", "Try scheduling and cancellation.", "calendar", ["calendar"], ["calendar"]), createScope: ({ ensureAvailable }) => createCalendar(ensureAvailable) },
  { manifest: manifest("mock-payroll", "Test payroll export", "Export calculated gross pay in a safe test flow.", "payroll", ["payroll"]), createScope: ({ ensureAvailable }) => createPayroll(ensureAvailable) },
  { manifest: manifest("mock-ai", "Test writing assistant", "Draft structured site content deterministically.", "ai", ["ai"]), createScope: ({ ensureAvailable }) => createAi(ensureAvailable) },
  { manifest: manifest("mock-import", "Test customer import", "Import sample customer records through a test source.", "import", ["crm_import"]), createScope: ({ ensureAvailable }) => createImport(ensureAvailable) },
];

const planned = (key: string, name: string, provider: string, category: ConnectorCategory, capabilities: CapabilityKey[], authType: ConnectorManifest["authType"]): ConnectorDefinition => ({ manifest: { key, name, description: `${name} connection is planned.`, provider, icon: "plug", categories: [category], capabilities, authType, requiredScopes: [], environments: ["production"], setupComplexity: "guided", discoverableResources: [], webhookSupport: false, syncModes: [], version: "0.1.0", availability: "planned" } });
export const PLANNED_PROVIDER_DEFINITIONS: readonly ConnectorDefinition[] = [
  planned("stripe", "Stripe", "Stripe", "get_paid", ["payments"], "oauth2"),
  planned("square", "Square", "Square", "get_paid", ["payments"], "oauth2"),
  planned("quickbooks", "QuickBooks Online", "Intuit", "accounting", ["accounting"], "oauth2"),
  planned("xero", "Xero", "Xero", "accounting", ["accounting"], "oauth2"),
  {
    manifest: { key: "twilio", name: "Twilio", description: "Send text messages from your business messaging account.", provider: "Twilio", icon: "plug", categories: ["communication"], capabilities: ["sms"], authType: "api_key", requiredScopes: [], environments: ["test", "production"], setupComplexity: "guided", discoverableResources: ["sender"], webhookSupport: false, syncModes: [], version: "0.1.0", availability: "credentials_ready", credentialSetup: true, credentialFields: [
      { key: "accountSid", label: "Twilio account ID", inputType: "password", helpText: "The account ID for the messaging account that owns the sender.", maxLength: 34 },
      { key: "authToken", label: "Twilio auth token", inputType: "password", helpText: "Stored securely and used only by the server to send messages.", maxLength: 256 },
      { key: "sender", label: "Verified sender or messaging service ID", inputType: "password", helpText: "Use an E.164 sender number or a Messaging Service ID.", maxLength: 128 },
    ] },
    createConfiguredScope: createTwilioConfiguredScope,
  },
  {
    manifest: { key: "google-maps", name: "Google Maps Platform", description: "Find service addresses and calculate road distances, travel times and waypoint order.", provider: "Google", icon: "plug", categories: ["maps_routing"], capabilities: ["geocoding", "routing"], authType: "api_key", requiredScopes: [], environments: ["test", "production"], setupComplexity: "guided", discoverableResources: [], webhookSupport: false, syncModes: [], version: "0.1.0", availability: "credentials_ready", credentialSetup: true, credentialFields: [
      { key: "apiKey", label: "Google Maps API key", inputType: "password", helpText: "Enable the Geocoding API and Routes API for this key.", maxLength: 512 },
    ] },
    createConfiguredScope: createGoogleMapsConfiguredScope,
  },
  {
    manifest: { key: "mapbox", name: "Mapbox", description: "Find service addresses and calculate road routes with optional stop optimization.", provider: "Mapbox", icon: "plug", categories: ["maps_routing"], capabilities: ["geocoding", "routing"], authType: "api_key", requiredScopes: [], environments: ["test", "production"], setupComplexity: "guided", discoverableResources: [], webhookSupport: false, syncModes: [], version: "0.1.0", availability: "credentials_ready", credentialSetup: true, credentialFields: [
      { key: "accessToken", label: "Mapbox access token", inputType: "password", helpText: "Use a token with Geocoding and Navigation API access.", maxLength: 1_024 },
    ] },
    createConfiguredScope: createMapboxConfiguredScope,
  },
  {
    manifest: { key: "openai", name: "OpenAI", description: "Draft structured website copy with an optional writing assistant.", provider: "OpenAI", icon: "plug", categories: ["ai"], capabilities: ["ai"], authType: "api_key", requiredScopes: [], environments: ["test", "production"], setupComplexity: "guided", discoverableResources: [], webhookSupport: false, syncModes: [], version: "0.1.0", availability: "credentials_ready", credentialSetup: true, credentialFields: [
      { key: "apiKey", label: "OpenAI API key", inputType: "password", helpText: "Stored securely and used only to draft requested content.", maxLength: 512 },
    ] },
    createConfiguredScope: createOpenAiConfiguredScope,
  },
];

export const OAUTH_CONNECTOR_DEFINITIONS: readonly ConnectorDefinition[] = [
  createGoogleWorkspaceConnector(),
  createMicrosoft365ConnectorDefinition(),
];

export function createMockConnectorRegistry(options: { includePlannedProviders?: boolean; now?: () => Date } = {}): ConnectorRegistry {
  const registry = new ConnectorRegistry(options.now);
  for (const definition of MOCK_CONNECTOR_DEFINITIONS) registry.register(definition);
  for (const definition of OAUTH_CONNECTOR_DEFINITIONS) registry.register(definition);
  if (options.includePlannedProviders) for (const definition of PLANNED_PROVIDER_DEFINITIONS) registry.register(definition);
  return registry;
}
