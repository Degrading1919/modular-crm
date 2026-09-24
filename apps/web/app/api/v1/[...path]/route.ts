import { handleV1 } from "@/lib/api/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, context: Context) { return handleV1(request, (await context.params).path); }
export async function POST(request: Request, context: Context) { return handleV1(request, (await context.params).path); }
export async function PATCH(request: Request, context: Context) { return handleV1(request, (await context.params).path); }
export async function DELETE(request: Request, context: Context) { return handleV1(request, (await context.params).path); }
