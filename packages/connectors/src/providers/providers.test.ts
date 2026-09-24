import { describe, expect, it, vi } from "vitest";
import { ConnectorError } from "../types.ts";
import { createTwilioConfiguredScope } from "./twilio.ts";
import { createOpenAiConfiguredScope } from "./openai.ts";
import { createGoogleMapsConfiguredScope } from "./google-maps.ts";
import { createMapboxConfiguredScope } from "./mapbox.ts";
import type { ProviderFetch } from "./http.ts";
import { createMockConnectorRegistry } from "../mocks.ts";

const control = (credentials: Record<string, string>) => ({ tenantId: "tenant-1", now: () => new Date("2026-01-01T00:00:00Z"), ensureAvailable: vi.fn(), credentials });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const twilioCredentials = { accountSid: `AC${"a".repeat(32)}`, authToken: "token-secret", sender: "+15555550100" };

describe("credentials-ready API-key providers", () => {
  it("registers these providers as configured-only capabilities", () => {
    const registry = createMockConnectorRegistry({ includePlannedProviders: true });
    const credentials: Record<string, Record<string, string>> = {
      twilio: twilioCredentials,
      "google-maps": { apiKey: "google-key" },
      mapbox: { accessToken: "mapbox-token" },
      openai: { apiKey: "openai-key" },
    };
    for (const [key, values] of Object.entries(credentials)) {
      const definition = registry.listCatalog().find((item) => item.key === key)!;
      expect(definition).toMatchObject({ availability: "credentials_ready", credentialSetup: true });
      expect(() => registry.beginAuthorization("tenant-1", key)).toThrow(ConnectorError);
      expect(registry.connectConfigured("tenant-1", key, values).state).toBe("connected");
    }
    expect(registry.getCapability("tenant-1", "sms")).toBeDefined();
    expect(registry.getCapability("tenant-1", "ai")).toBeDefined();
  });

  it("sends Twilio SMS with explicit sender credentials and normalizes authorization failures", async () => {
    const twilioControl = control(twilioCredentials);
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).toContain("To=%2B15555550123");
      expect(String(init?.body)).toContain("From=%2B15555550100");
      expect(new Headers(init?.headers).get("authorization")).toMatch(/^Basic /);
      return json({ sid: `SM${"b".repeat(32)}`, status: "queued" }, 201);
    }) as ProviderFetch;
    const sms = createTwilioConfiguredScope(twilioControl, fetcher).sms!;
    await expect(sms.sendSms({ to: "+15555550123", body: "On the way", idempotencyKey: "sms-1" })).resolves.toEqual({ reference: `SM${"b".repeat(32)}`, status: "sent" });
    expect(twilioControl.ensureAvailable).toHaveBeenCalledOnce();

    const denied = createTwilioConfiguredScope(control(twilioCredentials), vi.fn(async () => new Response("private provider details", { status: 401 })) as ProviderFetch).sms!;
    await expect(denied.sendSms({ to: "+15555550123", body: "Hello", idempotencyKey: "sms-2" })).rejects.toMatchObject({ code: "authorization_expired", message: "Reconnect this provider" });
  });

  it("validates and extracts OpenAI Responses API structured output", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { model: string; text: { format: { type: string; strict: boolean; schema: unknown } } };
      expect(request.model).toBe("gpt-4.1-mini");
      expect(request.text.format).toMatchObject({ type: "json_schema", strict: true });
      return json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ headline: "Clear work, done right", description: "Reliable service from Acme." }) }] }] });
    }) as ProviderFetch;
    const ai = createOpenAiConfiguredScope(control({ apiKey: "secret-openai-key" }), fetcher).ai!;
    await expect(ai.proposeStructuredContent({ businessName: "Acme", industry: "Plumbing" })).resolves.toEqual({ headline: "Clear work, done right", description: "Reliable service from Acme." });

    const malformed = createOpenAiConfiguredScope(control({ apiKey: "secret-openai-key" }), vi.fn(async () => json({ output: [{ type: "message", content: [{ type: "output_text", text: "{\"headline\":\"Only headline\"}" }] }] })) as ProviderFetch).ai!;
    await expect(malformed.proposeStructuredContent({ businessName: "Acme", industry: "Plumbing" })).rejects.toMatchObject({ code: "provider_error" });
  });

  it("parses Google geocoding, road matrix and waypoint order", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("geocode/json")) return json({ status: "OK", results: [{ formatted_address: "1 Main St", geometry: { location: { lat: 40, lng: -73 } } }] });
      if (url.includes("computeRouteMatrix")) return json([
        { originIndex: 0, destinationIndex: 0, condition: "ROUTE_EXISTS", distanceMeters: 0, duration: "0s" },
        { originIndex: 0, destinationIndex: 1, condition: "ROUTE_EXISTS", distanceMeters: 2_000, duration: "300s" },
        { originIndex: 1, destinationIndex: 0, condition: "ROUTE_EXISTS", distanceMeters: 2_100, duration: "330s" },
        { originIndex: 1, destinationIndex: 1, condition: "ROUTE_EXISTS", distanceMeters: 0, duration: "0s" },
      ]);
      return json({ routes: [{ distanceMeters: 3_000, duration: "600s", optimizedIntermediateWaypointIndex: [1, 0] }] });
    }) as ProviderFetch;
    const scope = createGoogleMapsConfiguredScope(control({ apiKey: "google-key" }), fetcher);
    await expect(scope.geocoding!.geocode("1 Main St")).resolves.toMatchObject({ formattedAddress: "1 Main St", coordinates: { latitude: 40, longitude: -73 } });
    await expect(scope.routing!.travelMatrix([{ latitude: 40, longitude: -73 }, { latitude: 41, longitude: -74 }])).resolves.toEqual([
      [{ distanceKm: 0, durationMinutes: 0 }, { distanceKm: 2, durationMinutes: 5 }],
      [{ distanceKm: 2.1, durationMinutes: 6 }, { distanceKm: 0, durationMinutes: 0 }],
    ]);
    await expect(scope.routing!.optimizeRoute({ start: { latitude: 40, longitude: -73 }, stops: [
      { id: "a", coordinates: { latitude: 40.1, longitude: -73.1 } },
      { id: "b", coordinates: { latitude: 40.2, longitude: -73.2 } },
    ], end: { latitude: 40.3, longitude: -73.3 } })).resolves.toEqual({ stopIds: ["b", "a"], distanceKm: 3, durationMinutes: 10 });
  });

  it("uses Mapbox routing and optimization while enforcing Optimization v1's documented stop ceiling", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("search/geocode")) return json({ features: [{ geometry: { coordinates: [-73, 40] }, properties: { full_address: "1 Main St", match_code: { match_type: "exact" } } }] });
      return json({ code: "Ok", waypoints: [{ waypoint_index: 0 }, { waypoint_index: 2 }, { waypoint_index: 1 }, { waypoint_index: 3 }], trips: [{ distance: 1_500, duration: 420 }] });
    }) as ProviderFetch;
    const scope = createMapboxConfiguredScope(control({ accessToken: "mapbox-token" }), fetcher);
    await expect(scope.geocoding!.geocode("1 Main St")).resolves.toMatchObject({ coordinates: { latitude: 40, longitude: -73 }, confidence: 0.95 });
    await expect(scope.routing!.optimizeRoute({ start: { latitude: 40, longitude: -73 }, stops: [
      { id: "a", coordinates: { latitude: 40.1, longitude: -73.1 } },
      { id: "b", coordinates: { latitude: 40.2, longitude: -73.2 } },
    ], end: { latitude: 40.3, longitude: -73.3 } })).resolves.toEqual({ stopIds: ["b", "a"], distanceKm: 1.5, durationMinutes: 7 });
    await expect(scope.routing!.optimizeRoute({ start: { latitude: 40, longitude: -73 }, stops: Array.from({ length: 12 }, (_, index) => ({ id: String(index), coordinates: { latitude: 40, longitude: -73 } })) })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("normalizes fetch aborts and does not expose provider response details", async () => {
    const scope = createMapboxConfiguredScope(control({ accessToken: "secret-token" }), vi.fn(async () => { throw new DOMException("secret low level detail", "AbortError"); }) as ProviderFetch);
    try {
      await scope.geocoding!.geocode("Some address");
      throw new Error("Expected timeout");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectorError);
      expect(error).toMatchObject({ code: "timeout", message: "The provider request timed out" });
      expect((error as Error).message).not.toContain("secret");
    }
  });
});
