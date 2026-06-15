import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = {
  title: "Sign in · SettleKit Portal",
  description: "Sign in to your SettleKit customer portal.",
};

export default function LoginPage() {
  return (
    <section className="auth-card">
      <h1 className="auth-title">Sign in</h1>
      <p className="auth-lede">
        Access everything you bought — subscriptions, license keys, API keys,
        downloads, and receipts.
      </p>

      <AuthForm mode="login" />

      <p className="auth-switch">
        New to SettleKit? <Link href="/signup">Create an account</Link>
      </p>
    </section>
  );
}
