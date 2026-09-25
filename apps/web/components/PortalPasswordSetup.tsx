"use client";

import { useState } from "react";
import { Logo, Notice } from "./ui";

export default function PortalPasswordSetup({ token }: { token: string }) {
  const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (password.length < 8) { setError("Use at least 8 characters for your password."); return; }
    if (password !== confirm) { setError("The passwords don’t match."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }), cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "This password setup link is invalid or expired.");
      const params = new URLSearchParams(window.location.search);
      const callback = params.get("callbackURL");
      let destination = new URL("/login", window.location.origin);
      if (callback) {
        try {
          const requested = new URL(callback, window.location.origin);
          if (requested.origin === window.location.origin) destination = requested;
        } catch { /* An invalid callback falls back to the sign-in page. */ }
      }
      window.location.assign(destination.toString());
    } catch (issue) { setError((issue as Error).message); setBusy(false); }
  }
  return <main className="auth-main" style={{ minHeight: "100vh" }}><section className="auth-box"><Logo/><h1 style={{ marginTop: 30 }}>Set your password</h1><p>Choose a password for your customer portal account. This link can be used once.</p>
    {error && <Notice kind="error" text={error}/>}<form onSubmit={submit} className="stack"><div className="field"><label htmlFor="new-password">New password</label><input autoComplete="new-password" id="new-password" type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)}/></div><div className="field"><label htmlFor="confirm-password">Confirm password</label><input autoComplete="new-password" id="confirm-password" type="password" minLength={8} required value={confirm} onChange={(event) => setConfirm(event.target.value)}/></div><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving password…" : "Set password"}</button></form>
  </section></main>;
}
