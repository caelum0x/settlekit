import { AcceptInvite } from "@/components/AcceptInvite";

export const metadata = {
  title: "Join your team on SettleKit",
};

export default function InvitePage({ params }: { params: { token: string } }) {
  return (
    <>
      <div className="auth-heading">
        <h1 className="page-title">Join your team</h1>
        <p className="page-desc">You were invited to a SettleKit workspace. Set a password to accept.</p>
      </div>
      <AcceptInvite token={decodeURIComponent(params.token)} />
    </>
  );
}
