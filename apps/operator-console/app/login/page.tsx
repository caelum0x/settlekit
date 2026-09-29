import { PageHeader, Notice } from "@/components/ui";
import { safeNextPath } from "@/lib/auth";
import { loadConsoleConfig, ownerLoginEnabled } from "@/lib/config";
import { login } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Readonly<Record<string, string>> = {
  invalid: "That password is not correct.",
  throttled: "Too many attempts. Wait a few minutes and try again.",
  disabled: "Owner login is not configured on this server.",
};

export default function LoginPage({ searchParams }: { readonly searchParams: { readonly next?: string; readonly error?: string } }) {
  const next = safeNextPath(searchParams.next);
  const error = searchParams.error ? ERRORS[searchParams.error] : undefined;
  const enabled = ownerLoginEnabled(loadConsoleConfig());
  return (
    <div style={{ maxWidth: 420 }}>
      <PageHeader title="Owner sign in" lead="The console acts with the operator's owner API key, which stays on this server. Only the business owner signs in here." />
      {!enabled ? (
        <Notice tone="warn" title="Login disabled.">Set CONSOLE_OWNER_PASSWORD and a CONSOLE_SESSION_SECRET of at least 32 characters.</Notice>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <form className="form card" action={login}>
        <input type="hidden" name="next" value={next} />
        <label>
          Owner password
          <input type="password" name="password" autoComplete="current-password" required aria-invalid={error === ERRORS.invalid} />
        </label>
        <button type="submit" disabled={!enabled}>Sign in</button>
      </form>
      <p className="muted small">Looking for public numbers? See the <a href="/proof">live proof</a>.</p>
    </div>
  );
}
