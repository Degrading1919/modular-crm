import { ConnectorError, type Coordinates, type ScopedCapabilities } from "../types.ts";
import type { ProviderFetch } from "./http.ts";
import { parseDurationSeconds, requestJson, validateCoordinates } from "./http.ts";

type GoogleControl = { tenantId: string; now: () => Date; ensureAvailable: () => void; credentials: Readonly<Record<string, string>> };
type GoogleGeocodeResponse = { status?: unknown; results?: readonly { formatted_address?: unknown; partial_match?: unknown; geometry?: { location?: { lat?: unknown; lng?: unknown } } }[] };
type MatrixElement = { originIndex?: unknown; destinationIndex?: unknown; condition?: unknown; status?: { code?: unknown }; distanceMeters?: unknown; duration?: unknown };
type RoutesResponse = { routes?: readonly { distanceMeters?: unknown; duration?: unknown; optimizedIntermediateWaypointIndex?: readonly unknown[] }[] };

function apiKey(control: GoogleControl): string {
  const key = control.credentials.apiKey?.trim();
  if (!key || key.length > 512) throw new ConnectorError("invalid_request", "Google Maps API key is invalid", false);
  return key;
}
function latLng(point: Coordinates) { return { location: { latLng: { latitude: point.latitude, longitude: point.longitude } } }; }
function routeMetrics(route: RoutesResponse["routes"] extends readonly (infer T)[] | undefined ? T : never) {
  if (!route || typeof route.distanceMeters !== "number" || !Number.isFinite(route.distanceMeters) || typeof route.duration !== "string") {
    throw new ConnectorError("provider_error", "Google Maps returned invalid route details", false);
  }
  return { distanceKm: Math.round(route.distanceMeters / 100) / 10, durationMinutes: Math.max(0, Math.round(parseDurationSeconds(route.duration) / 60)) };
}

/** Google Routes can reorder intermediate waypoints, but this adapter does not submit fleet/time-window constraints. */
export function createGoogleMapsConfiguredScope(control: GoogleControl, fetcher: ProviderFetch = fetch): ScopedCapabilities {
  const key = apiKey(control);
  const headers = { "content-type": "application/json", "X-Goog-Api-Key": key };

  async function computeRoute(body: Record<string, unknown>, fieldMask: string): Promise<RoutesResponse> {
    const result = await requestJson<RoutesResponse>(fetcher, "https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST", headers: { ...headers, "X-Goog-FieldMask": fieldMask }, body: JSON.stringify(body),
    });
    return result;
  }

  return {
    geocoding: { async geocode(address) {
      control.ensureAvailable();
      const query = address.trim();
      if (!query || query.length > 512) throw new ConnectorError("invalid_request", "Enter a valid service address", false);
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("address", query);
      url.searchParams.set("key", key);
      const result = await requestJson<GoogleGeocodeResponse>(fetcher, url.toString(), { method: "GET" });
      if (result.status !== "OK" || !result.results?.length) {
        throw new ConnectorError("provider_error", "Google Maps could not find this address", false);
      }
      const first = result.results[0]!;
      const latitude = first.geometry?.location?.lat;
      const longitude = first.geometry?.location?.lng;
      if (typeof first.formatted_address !== "string" || typeof latitude !== "number" || typeof longitude !== "number") {
        throw new ConnectorError("provider_error", "Google Maps returned invalid address details", false);
      }
      return { formattedAddress: first.formatted_address, coordinates: { latitude, longitude }, confidence: first.partial_match === true ? 0.65 : 0.95 };
    } },
    routing: {
      async travelMatrix(points) {
        control.ensureAvailable();
        if (!points.length || points.length > 25) throw new ConnectorError("invalid_request", "Route matrix supports between 1 and 25 locations", false);
        points.forEach(validateCoordinates);
        const result = await requestJson<MatrixElement[]>(fetcher, "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
          method: "POST", headers: { ...headers, "X-Goog-FieldMask": "originIndex,destinationIndex,distanceMeters,duration,condition,status" },
          body: JSON.stringify({
            origins: points.map(latLng), destinations: points.map(latLng), travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE",
          }),
        });
        if (!Array.isArray(result) || result.length !== points.length * points.length) throw new ConnectorError("provider_error", "Google Maps returned an incomplete route matrix", false);
        const matrix: { distanceKm: number; durationMinutes: number }[][] = Array.from({ length: points.length }, () => Array(points.length));
        for (const item of result) {
          const i = item.originIndex;
          const j = item.destinationIndex;
          if (typeof i !== "number" || typeof j !== "number" || i < 0 || j < 0 || i >= points.length || j >= points.length
            || item.status?.code && item.status.code !== 0 || item.condition !== "ROUTE_EXISTS"
            || typeof item.distanceMeters !== "number" || !Number.isFinite(item.distanceMeters) || typeof item.duration !== "string") {
            throw new ConnectorError("provider_error", "Google Maps could not route every location pair", false);
          }
          matrix[i]![j] = { distanceKm: Math.round(item.distanceMeters / 100) / 10, durationMinutes: Math.max(0, Math.round(parseDurationSeconds(item.duration) / 60)) };
        }
        if (matrix.some((row) => row.some((leg) => !leg))) throw new ConnectorError("provider_error", "Google Maps returned an incomplete route matrix", false);
        return matrix;
      },
      async optimizeRoute(input) {
        control.ensureAvailable();
        validateCoordinates(input.start);
        input.stops.forEach((stop) => validateCoordinates(stop.coordinates));
        if (input.end) validateCoordinates(input.end);
        if (input.stops.length > 25) throw new ConnectorError("invalid_request", "Google Maps supports up to 25 route stops", false);
        if (!input.stops.length && !input.end) return { stopIds: [], distanceKm: 0, durationMinutes: 0 };

        // The Routes API requires a destination. For an open route without an explicit end,
        // the last supplied stop is held at the end and only prior stops can be reordered.
        const fixedLast = !input.end && input.stops.length > 0 ? input.stops.length - 1 : -1;
        const optimizable = input.stops.slice(0, fixedLast < 0 ? undefined : fixedLast);
        const hasLockedStops = input.stops.some((stop) => stop.locked);
        const orderedIndices = optimizable.map((_, index) => index);
        const intermediates = optimizable.map((stop) => ({ ...latLng(stop.coordinates), ...(stop.locked ? { via: true } : {}) }));
        const destination = input.end ?? input.stops[fixedLast >= 0 ? fixedLast : input.stops.length - 1]!.coordinates;
        const shouldOptimize = !hasLockedStops && optimizable.length > 1;
        const result = await computeRoute({
          origin: latLng(input.start), destination: latLng(destination), intermediates,
          travelMode: "DRIVE", ...(shouldOptimize ? { optimizeWaypointOrder: true } : {}),
        }, "routes.distanceMeters,routes.duration,routes.optimizedIntermediateWaypointIndex");
        const route = result.routes?.[0];
        if (!route) throw new ConnectorError("provider_error", "Google Maps could not calculate this route", false);
        let reordered = orderedIndices;
        if (shouldOptimize) {
          if (!Array.isArray(route.optimizedIntermediateWaypointIndex) || route.optimizedIntermediateWaypointIndex.length !== optimizable.length) {
            throw new ConnectorError("provider_error", "Google Maps returned invalid stop ordering", false);
          }
          reordered = route.optimizedIntermediateWaypointIndex.map((index) => {
            if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= optimizable.length) throw new ConnectorError("provider_error", "Google Maps returned invalid stop ordering", false);
            return index;
          });
        }
        const stopIds = reordered.map((index) => optimizable[index]!.id);
        if (fixedLast >= 0) stopIds.push(input.stops[fixedLast]!.id);
        return { stopIds, ...routeMetrics(route) };
      },
    },
  };
}
