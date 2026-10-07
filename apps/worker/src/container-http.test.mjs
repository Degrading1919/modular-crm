import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import { httpStatus } from "../../../containers/http-status.mjs";

it("sends the exact Host and forwarding headers used by the production container smoke", async () => {
  const observed = [];
  const server = createServer((req, res) => {
    observed.push(req.headers);
    res.writeHead(req.headers.host === "unknown.example.test" || req.headers["x-website-origin-key"] === "forged" ? 404 : 200);
    res.end("fixture");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/login`;
  try {
    expect(await httpStatus(url)).toBe(200);
    expect(await httpStatus(url, { host: "unknown.example.test" })).toBe(404);
    expect(observed[1].host).toBe("unknown.example.test");
    expect(await httpStatus(url, { "x-website-host": "unknown.example.test", "x-website-origin-key": "forged" })).toBe(404);
    expect(observed[2]["x-website-host"]).toBe("unknown.example.test");
    expect(observed[2]["x-website-origin-key"]).toBe("forged");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
