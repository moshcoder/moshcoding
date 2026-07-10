"use client";
import { useEffect, useState } from "react";

type Me = { authEnabled: boolean; user: { email: string | null; name: string | null } | null };

export default function AuthSlot() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then(setMe).catch(() => {});
  }, []);

  if (!me || !me.authEnabled) return null;

  if (me.user) {
    return (
      <span className="auth-slot">
        <a className="auth-btn" href="/dashboard">Dashboard</a>
        <span className="who" title={me.user.email ?? ""}>{me.user.email || me.user.name || "signed in"}</span>
        <button
          className="auth-btn"
          onClick={async () => {
            await fetch("/auth/logout", { method: "POST" });
            location.reload();
          }}
        >
          Log out
        </button>
      </span>
    );
  }
  return (
    <span className="auth-slot">
      <a className="auth-btn" href="/login">Log in</a>
      <a className="auth-btn primary" href="/signup">Claim your page</a>
    </span>
  );
}
