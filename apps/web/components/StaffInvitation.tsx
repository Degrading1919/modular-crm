"use client";
import { useState } from "react";
import { api, body } from "./api";
import { Logo, Notice } from "./ui";
export default function StaffInvitation() {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function accept(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const params = new URLSearchParams(window.location.search);
      await api("/auth/login", body({ email, password }));
      await api("/staff-invitations/accept", body({ membershipId: params.get("membershipId"), token: params.get("token") }));
      const identity = await api<{ user: { role: string } }>("/auth/me");
      window.location.href = identity.user.role === "technician" ? "/field/today" : "/app/dashboard";
    } catch (issue) { setError((issue as Error).message); setBusy(false); }
  }
  return <main className="auth-main" style={{ minHeight: "100vh" }}><section className="auth-box"><Logo/><h1>Join your team</h1><p>Sign in with the account that received the invitation. Accepting gives you access to this business.</p><form onSubmit={accept} className="stack"><div className="field"><label htmlFor="invite-email">Email address</label><input id="invite-email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}/></div><div className="field"><label htmlFor="invite-password">Password</label><input id="invite-password" type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}/></div>{error && <Notice kind="error" text={error}/>}<button className="btn btn-primary" disabled={busy}>{busy ? "Joining…" : "Accept invitation"}</button></form></section></main>;
}
