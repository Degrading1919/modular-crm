import { request } from "node:http";

// Native fetch overwrites Host with the URL authority. Use the HTTP client when
// testing virtual-host isolation, so the intended header reaches the server.
export function httpStatus(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers, signal: AbortSignal.timeout(2_000) }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.end();
  });
}
