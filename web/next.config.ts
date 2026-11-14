import type { NextConfig } from "next";

// /api/* is handled by app/api/[...path]/route.ts, which proxies to the FastAPI backend
// (BACKEND_URL on Vercel, http://127.0.0.1:8000 locally) and rate-limits the copilot.
const config: NextConfig = {};
export default config;
