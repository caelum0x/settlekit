import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { WalletConnect } from "@/components/WalletConnect";

export const metadata = {
  title: "Create account — SettleKit",
};

export default function SignupPage() {
  return (
    <>
      <div className="auth-heading">
        <h1 className="page-title">Create your merchant account</h1>
        <p className="page-desc">
          Start selling software, SaaS, APIs, and AI tools in USDC with automatic
          access delivery.
        </p>
      </div>
      <AuthForm mode="signup" />
      <div className="auth-divider">or</div>
      <WalletConnect type="merchant" />
      <p className="auth-alt">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
