import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { WalletConnect } from "@/components/WalletConnect";

export const metadata: Metadata = {
  title: "Create account · SettleKit Portal",
  description: "Create your SettleKit customer portal account.",
};

export default function SignupPage() {
  return (
    <section className="auth-card">
      <h1 className="auth-title">Create your account</h1>
      <p className="auth-lede">
        Set up your customer portal to manage access, subscriptions, keys, and
        receipts — or use a one-time magic link instead of a password.
      </p>

      <AuthForm mode="signup" />

      <div className="auth-divider">or</div>
      <WalletConnect />

      <p className="auth-switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </section>
  );
}
