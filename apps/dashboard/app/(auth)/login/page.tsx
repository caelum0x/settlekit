import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { WalletConnect } from "@/components/WalletConnect";

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
      <div className="auth-divider">or</div>
      <WalletConnect type="merchant" />
      <p className="auth-alt">
        New to SettleKit? <Link href="/signup">Create an account</Link>
      </p>
    </>
  );
}
