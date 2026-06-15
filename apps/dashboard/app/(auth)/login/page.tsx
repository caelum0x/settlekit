import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";

export const metadata = {
  title: "Sign in — SettleKit",
};

export default function LoginPage() {
  return (
    <>
      <div className="auth-heading">
        <h1 className="page-title">Sign in</h1>
        <p className="page-desc">
          Access your merchant dashboard to manage products, payouts, and access
          delivery.
        </p>
      </div>
      <AuthForm mode="login" />
      <p className="auth-alt">
        New to SettleKit? <Link href="/signup">Create an account</Link>
      </p>
    </>
  );
}
