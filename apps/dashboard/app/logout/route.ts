// Logout route handler.
//
// Clears the httpOnly "sk_session" cookie and best-effort invalidates the
// session token on the API, then redirects to /login. Linked from the Sidebar
// "Sign out" affordance. Supports GET so it works as a plain <a href> link.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { logout, SESSION_COOKIE } from "@/lib/auth";

async function handle(request: Request): Promise<NextResponse> {
  const token = cookies().get(SESSION_COOKIE)?.value ?? null;
  if (token) {
    // Best effort: never block sign-out on an API error.
    await logout(token).catch(() => undefined);
  }

  const res = NextResponse.redirect(new URL("/login", request.url));
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
