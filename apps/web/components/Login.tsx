"use client";

import Link from "next/link";
import { useState } from "react";
import { api, body } from "./api";
import { Icon, Logo, Notice } from "./ui";

const demoAccounts = [
  { label: "Business owner", email: "owner@happyyards.test", role: "owner" },
  { label: "Office manager", email: "manager@happyyards.test", role: "office" },
  { label: "Field technician", email: "tech@happyyards.test", role: "technician" },
  { label: "Customer", email: "customer@happyyards.test", role: "customer" },
];

export default function Login({ register = false }: { register?: boolean }) {
  const [name, setName] = useState(""); const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await api(register ? "/auth/register" : "/auth/login", body(register ? { name, businessName, email, password } : { email, password }));
      const session = await api<{ user?: { role?: string } }>("/auth/me");
      const role = session.user?.role?.toLowerCase() || "owner";
      window.location.href = register ? "/onboarding" : role.includes("technician") ? "/field/today" : role.includes("customer") ? "/portal/home" : "/app/dashboard";
    } catch (issue) { setError((issue as Error).message); setSaving(false); }
  }
  return <div className="auth-page"><div className="auth-visual"><Link href="/"><Logo light/></Link><div className="auth-visual-content"><div className="eyebrow" style={{ color: "var(--mint)" }}>Your whole business, working together</div><h1>More time for the work that matters.</h1><p>Customers, jobs, routes, payments, and your website in one clear place.</p></div><div className="auth-proof"><span className="proof-icon"><Icon name="shield" size={18}/></span> Built for the rhythm of a local service business</div></div><main className="auth-main"><div className="auth-box"><div className="eyebrow">{register ? "Get started" : "Welcome back"}</div><h2>{register ? "Create your workspace" : "Sign in to Modular"}</h2><p>{register ? "A few details and you can start building your business." : "Everything your business needs is ready when you are."}</p>{error && <div style={{ marginBottom: 18 }}><Notice kind="error" text={error}/></div>}<form onSubmit={submit}>{register && <><div className="field"><label htmlFor="register-name">Your name</label><input id="register-name" required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)}/></div><div className="field"><label htmlFor="register-business">Business name</label><input id="register-business" required value={businessName} onChange={(event) => setBusinessName(event.target.value)}/></div></>}<div className="field"><label htmlFor="login-email">Email address</label><input id="login-email" required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)}/></div><div className="field"><label htmlFor="login-password">Password</label><input id="login-password" required type="password" autoComplete={register ? "new-password" : "current-password"} minLength={register ? 8 : undefined} value={password} onChange={(event) => setPassword(event.target.value)}/></div><button className="btn btn-primary btn-block" type="submit" disabled={saving}>{saving ? "One moment…" : register ? "Create account" : "Sign in"} <Icon name="arrow" size={17}/></button></form><p style={{ marginTop: 19, marginBottom: 0, fontSize: ".83rem" }}>{register ? "Already have an account?" : "New to Modular?"} <Link className="link" href={register ? "/login" : "/create-account"}>{register ? "Sign in" : "Create an account"}</Link></p>{!register && <><div className="auth-divider">LOCAL DEMO ACCOUNTS</div><div className="demo-accounts">{demoAccounts.map((account) => <button type="button" className="demo-account" key={account.role} onClick={() => { setEmail(account.email); setPassword("Demo12345!"); }}><span><strong>{account.label}</strong><br/><span className="subtle">{account.email}</span></span><Icon name="arrow" size={15}/></button>)}</div><p style={{ fontSize: ".75rem", marginTop: 10, marginBottom: 0 }}>Demo password: <strong>Demo12345!</strong></p></>}</div></main></div>;
}

