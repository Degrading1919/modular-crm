import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { observeRequest } from "@modular-crm/config/observability";
import { handleAuthHttp } from "@/lib/api/auth-http";

const handlers = toNextJsHandler(auth);
export const GET = (request: Request) => observeRequest(request, "api.auth", () => handlers.GET(request));
export const POST = (request: Request) => observeRequest(request, "api.auth", async () => {
  return handleAuthHttp(request, handlers.POST);
});
