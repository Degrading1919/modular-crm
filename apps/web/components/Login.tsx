"use client";

import Link from "next/link";
import { useState } from "react";
import { api, body } from "./api";
import { Logo, Notice } from "./ui";

const demoAccounts = [
  { label: "Business owner", email: "owner@happyyards.test", role: "owner" },
  { label: "Office manager", email: "manager@happyyards.test", role: "office" },
  { label: "Field technician", email: "tech@happyyards.test", role: "technician" },
  { label: "Customer", email: "customer@happyyards.test", role: "customer" },
];

export default function Login({ register = false }: { register?: boolean }) {
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(register ? "/auth/register" : "/auth/login", body(register ? { name, businessName, email, password } : { email, password }));
      const session = await api<{ user?: { role?: string } }>("/auth/me");
      const role = session.user?.role?.toLowerCase() || "owner";
      window.location.href = register ? "/onboarding" : role.includes("technician") ? "/field/today" : role.includes("customer") ? "/portal/home" : "/app/dashboard";
    } catch (issue) {
      setError((issue as Error).message);
      setSaving(false);
    }
  }

  return <div className="auth-page">
    <section className="auth-visual" aria-label="About Modular CRM">
      <Link href="/"><Logo light/></Link>
      <div className="auth-visual-content">
        <div className="eyebrow" style={{ color: "var(--mint)" }}>For service businesses</div>
        <h2 className="auth-headline">Run the day from one workspace.</h2>
        <p>Keep customers, estimates, jobs, and payments together.</p>
      </div>
      <p className="auth-proof">One workspace for the work before, during, and after each visit.</p>
    </section>

    <main className="auth-main">
      <div className="auth-box">
        <div className="eyebrow">{register ? "Get started" : "Welcome back"}</div>
        <h1>{register ? "Create your workspace" : "Sign in to Modular"}</h1>
        <p>{register ? "Add your details, then choose how you want to run your business." : "Sign in to manage customers, work, and payments."}</p>
        {error && <div id="auth-error" style={{ marginBottom: 18 }}><Notice kind="error" text={error}/></div>}
        <form onSubmit={submit} aria-busy={saving}>
          {register && <>
            <div className="field"><label htmlFor="register-name">Your name</label><input id="register-name" required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)}/></div>
            <div className="field"><label htmlFor="register-business">Business name</label><input id="register-business" required autoComplete="organization" value={businessName} onChange={(event) => setBusinessName(event.target.value)}/></div>
          </>}
          <div className="field"><label htmlFor="login-email">Email address</label><input id="login-email" required type="email" autoComplete="email" value={email} aria-describedby={error ? "auth-error" : undefined} onChange={(event) => setEmail(event.target.value)}/></div>
          <div className="field"><label htmlFor="login-password">Password</label><input id="login-password" required type="password" autoComplete={register ? "new-password" : "current-password"} minLength={register ? 8 : undefined} value={password} aria-describedby={error ? "auth-error" : undefined} onChange={(event) => setPassword(event.target.value)}/></div>
          <button className="btn btn-primary btn-block" type="submit" disabled={saving}>{saving ? "Signing in…" : register ? "Create account" : "Sign in"}</button>
        </form>
        <p className="auth-switch">{register ? "Already have an account?" : "New to Modular?"} <Link className="link" href={register ? "/login" : "/create-account"}>{register ? "Sign in" : "Create an account"}</Link></p>
        {!register && process.env.NODE_ENV !== "production" && <>
          <div className="auth-divider">LOCAL DEMO ACCOUNTS</div>
          <div className="demo-accounts">{demoAccounts.map((account) => <button type="button" className="demo-account" key={account.role} onClick={() => { setEmail(account.email); setPassword("Demo12345!"); }}><span><strong>{account.label}</strong><br/><span className="subtle">{account.email}</span></span><span aria-hidden="true">Use</span></button>)}</div>
          <p className="demo-password">Demo password: <strong>Demo12345!</strong></p>
        </>}
      </div>
    </main>
  </div>;
}
