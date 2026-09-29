import { NextResponse, type NextRequest } from "next/server";
import { OWNER_COOKIE } from "@/lib/auth";

/** POST-only sign out (a GET link cannot log the owner out cross-site). */
export function POST(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.delete(OWNER_COOKIE);
  return response;
}
