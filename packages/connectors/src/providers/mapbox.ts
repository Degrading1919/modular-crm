import { ConnectorError, type Coordinates, type ScopedCapabilities } from "../types.ts";
import type { ProviderFetch } from "./http.ts";
import { requestJson, validateCoordinates } from "./http.ts";

type MapboxControl = { tenantId: string; now: () => Date; ensureAvailable: () => void; credentials: Readonly<Record<string, string>> };
type MapboxGeocodeResponse = { features?: readonly { geometry?: { coordinates?: readonly unknown[] }; properties?: { full_address?: unknown; name?: unknown; match_code?: { match_type?: unknown } } }[] };
type MatrixResponse = { code?: unknown; distances?: readonly (readonly (number | null)[])[]; durations?: readonly (readonly (number | null)[])[] };
type RouteResponse = { code?: unknown; routes?: readonly { distance?: unknown; duration?: unknown }[] };
type OptimizationResponse = { code?: unknown; waypoints?: readonly { waypoint_index?: unknown }[]; trips?: readonly { distance?: unknown; duration?: unknown }[] };

function accessToken(control: MapboxControl): string {
  const token = control.credentials.accessToken?.trim();
  if (!token || token.length > 1_024) throw new ConnectorError("invalid_request", "Mapbox access token is invalid", false);
  return token;
}
function coordinates(points: readonly Coordinates[]): string {
  return points.map((point) => `${point.longitude},${point.latitude}`).join(";");
}
function metrics(distanceMeters: unknown, durationSeconds: unknown) {
  if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters) || typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds)) {
    throw new ConnectorError("provider_error", "Mapbox returned invalid route details", false);
  }
  return { distanceKm: Math.round(distanceMeters / 100) / 10, durationMinutes: Math.max(0, Math.round(durationSeconds / 60)) };
}
function withToken(path: string, token: string): URL {
  const url = new URL(path);
  url.searchParams.set("access_token", token);
  return url;
}

/** Optimization API v1 performs duration-oriented TSP optimization, with a documented 12-coordinate limit. */
export function createMapboxConfiguredScope(control: MapboxControl, fetcher: ProviderFetch = fetch): ScopedCapabilities {
  const token = accessToken(control);
  return {
    geocoding: { async geocode(address) {
      control.ensureAvailable();
      const query = address.trim();
      if (!query || query.length > 512) throw new ConnectorError("invalid_request", "Enter a valid service address", false);
      const url = withToken("https://api.mapbox.com/search/geocode/v6/forward", token);
      url.searchParams.set("q", query);
      url.searchParams.set("limit", "1");
      url.searchParams.set("types", "address");
      const result = await requestJson<MapboxGeocodeResponse>(fetcher, url.toString(), { method: "GET" });
      const feature = result.features?.[0];
      const pair = feature?.geometry?.coordinates;
      const label = feature?.properties?.full_address ?? feature?.properties?.name;
      if (typeof pair?.[0] !== "number" || typeof pair?.[1] !== "number" || typeof label !== "string") {
        throw new ConnectorError("provider_error", "Mapbox could not find this address", false);
      }
      const matchType = feature?.properties?.match_code?.match_type;
      return { formattedAddress: label, coordinates: { longitude: pair[0], latitude: pair[1] }, confidence: matchType === "exact" ? 0.95 : 0.75 };
    } },
    routing: {
      async travelMatrix(points) {
        control.ensureAvailable();
        if (!points.length || points.length > 25) throw new ConnectorError("invalid_request", "Mapbox route matrix supports between 1 and 25 locations", false);
        points.forEach(validateCoordinates);
        const url = withToken(`https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coordinates(points)}`, token);
        url.searchParams.set("annotations", "distance,duration");
        const result = await requestJson<MatrixResponse>(fetcher, url.toString(), { method: "GET" });
        if (result.code !== "Ok" || result.distances?.length !== points.length || result.durations?.length !== points.length) {
          throw new ConnectorError("provider_error", "Mapbox returned an incomplete route matrix", false);
        }
        return points.map((_, i) => points.map((__, j) => {
          const distance = result.distances?.[i]?.[j];
          const duration = result.durations?.[i]?.[j];
          if (typeof distance !== "number" || typeof duration !== "number" || !Number.isFinite(distance) || !Number.isFinite(duration)) {
            throw new ConnectorError("provider_error", "Mapbox could not route every location pair", false);
          }
          return { distanceKm: Math.round(distance / 100) / 10, durationMinutes: Math.max(0, Math.round(duration / 60)) };
        }));
      },
      async optimizeRoute(input) {
        control.ensureAvailable();
        validateCoordinates(input.start);
        input.stops.forEach((stop) => validateCoordinates(stop.coordinates));
        if (input.end) validateCoordinates(input.end);
        if (!input.stops.length && !input.end) return { stopIds: [], distanceKm: 0, durationMinutes: 0 };

        // Optimization v1 cannot encode locked waypoint constraints. Keep their sequence and
        // calculate a normal Directions route instead of claiming it optimized those stops.
        const locked = input.stops.some((stop) => stop.locked);
        // The provider requires a destination; absent an explicit end, the final supplied stop stays last.
        const fixedLast = !input.end && input.stops.length ? input.stops.length - 1 : -1;
        const optimizableStops = input.stops.slice(0, fixedLast < 0 ? undefined : fixedLast);
        const destination = input.end ?? (fixedLast >= 0 ? input.stops[fixedLast]!.coordinates : input.start);
        // For a no-end route, the last stop was excluded from intermediates and is the destination.
        const stopPoints = fixedLast >= 0 ? [input.start, ...optimizableStops.map((stop) => stop.coordinates), destination] : [input.start, ...input.stops.map((stop) => stop.coordinates), ...(input.end ? [input.end] : [])];
        if (stopPoints.length > 25) throw new ConnectorError("invalid_request", "Mapbox directions supports up to 25 coordinates", false);
        let ordered = input.stops.map((stop) => stop.id);
        let routeMetrics: ReturnType<typeof metrics>;

        if (locked) {
          const url = withToken(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates(stopPoints)}`, token);
          url.searchParams.set("overview", "false");
          url.searchParams.set("steps", "false");
          const result = await requestJson<RouteResponse>(fetcher, url.toString(), { method: "GET" });
          const route = result.code === "Ok" ? result.routes?.[0] : undefined;
          if (!route) throw new ConnectorError("provider_error", "Mapbox could not calculate this route", false);
          routeMetrics = metrics(route.distance, route.duration);
        } else {
          if (stopPoints.length > 12) throw new ConnectorError("invalid_request", "Mapbox route optimization supports up to 12 coordinates", false);
          const url = withToken(`https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordinates(stopPoints)}`, token);
          url.searchParams.set("source", "first");
          url.searchParams.set("destination", "last");
          url.searchParams.set("roundtrip", "false");
          url.searchParams.set("overview", "false");
          const result = await requestJson<OptimizationResponse>(fetcher, url.toString(), { method: "GET" });
          const trip = result.code === "Ok" ? result.trips?.[0] : undefined;
          if (!trip || !result.waypoints || result.waypoints.length !== stopPoints.length) throw new ConnectorError("provider_error", "Mapbox could not optimize this route", false);
          const atPosition = new Array<number>(stopPoints.length);
          result.waypoints.forEach((waypoint, inputIndex) => {
            const position = waypoint.waypoint_index;
            if (typeof position !== "number" || !Number.isInteger(position) || position < 0 || position >= stopPoints.length) throw new ConnectorError("provider_error", "Mapbox returned invalid stop ordering", false);
            atPosition[position] = inputIndex;
          });
          const stopOrder = atPosition.filter((index) => index !== undefined && index > 0 && index <= input.stops.length).map((index) => input.stops[index - 1]!.id);
          if (stopOrder.length !== input.stops.length) throw new ConnectorError("provider_error", "Mapbox returned incomplete stop ordering", false);
          ordered = stopOrder;
          routeMetrics = metrics(trip.distance, trip.duration);
        }
        return { stopIds: ordered, ...routeMetrics };
      },
    },
  };
}
