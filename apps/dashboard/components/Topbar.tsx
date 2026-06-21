import { NotificationBell } from "@/components/NotificationBell";

/**
 * Slim header bar hosting the in-app notification center, aligned right. The
 * shell has no other topbar markup, so this renders once at the top of .main
 * on every page.
 */
export function Topbar() {
  return (
    <header className="topbar">
      <NotificationBell />
    </header>
  );
}
