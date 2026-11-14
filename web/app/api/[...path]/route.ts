/**
 * Same-origin proxy to the FastAPI backend.
 *
 * On Vercel the backend is a private Service: only this handler can reach it, through the
 * BACKEND_URL that the service binding injects. Locally it falls back to the dev server.
 * POST /api/chat (the only call that spends LLM quota) is rate-limited here.
 */
import type { NextRequest } from "next/server";
import { check } from "@/lib/ratelimit";

const BACKEND = (process.env.BACKEND_URL ?? process.env.CRASSUS_API ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const GET_PATHS = new Set(["health", "investigations", "flex-tests", "burner-tests", "rank", "safety"]);

function clientIp(req: NextRequest) {
  // Vercel sets x-forwarded-for from the real client connection; first entry is the visitor.
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

async function forward(req: NextRequest, path: string) {
  const url = `${BACKEND}/api/${path}${req.nextUrl.search}`;
  try {
    const r = await fetch(url, {
      method: req.method,
      headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
      body: req.method === "POST" ? await req.text() : undefined,
      cache: "no-store",
    });
    return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json" } });
  } catch (e) {
    return Response.json({ detail: `backend unreachable: ${String(e)}` }, { status: 502 });
  }
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/[...path]">) {
  const { path } = await ctx.params;
  const p = path.join("/");
  if (!GET_PATHS.has(p)) return Response.json({ detail: "not found" }, { status: 404 });
  return forward(req, p);
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/[...path]">) {
  const { path } = await ctx.params;
  if (path.join("/") !== "chat") return Response.json({ detail: "not found" }, { status: 404 });
  const v = check(clientIp(req));
  if (!v.ok) {
    const mins = Math.ceil((v.retryAfterS ?? 3600) / 60);
    const detail = v.reason === "global"
      ? `The copilot's shared daily limit has been reached. It resets in about ${Math.ceil(mins / 60)} h.`
      : `You've reached the copilot limit for this hour. Try again in about ${mins} min.`;
    return Response.json({ detail }, { status: 429, headers: { "retry-after": String(v.retryAfterS ?? 3600) } });
  }
  const res = await forward(req, "chat");
  res.headers.set("x-copilot-remaining", String(v.remaining));
  return res;
}
