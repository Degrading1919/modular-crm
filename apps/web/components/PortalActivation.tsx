"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, body } from "./api";
import { Logo, Notice } from "./ui";

export default function PortalActivation() {
  const [state, setState] = useState<"activating" | "active" | "error">("activating");
  const [message, setMessage] = useState("");
  const activationStarted = useRef(false);
  useEffect(() => {
    if (activationStarted.current) return;
    activationStarted.current = true;
    const params = new URLSearchParams(window.location.search);
    const accessId = params.get("accessId"); const token = params.get("token");
    if (!accessId || !token) { setMessage("This invitation link is incomplete. Ask your service team to send another."); setState("error"); return; }
    api("/auth/portal-activate", body({ accessId, token }))
      .then(() => setState("active"))
      .catch((error) => { setMessage((error as Error).message); setState("error"); });
  }, []);
  return <main className="auth-main" style={{ minHeight: "100vh" }}><section className="auth-box"><Logo/><h1 style={{ marginTop: 30 }}>{state === "active" ? "Your portal is ready" : state === "error" ? "Invitation unavailable" : "Activating your portal…"}</h1>
    {state === "activating" && <p>Please wait while we confirm your service address access.</p>}
    {state === "active" && <><p>Your invitation is active. Sign in with the email address that received the invitation.</p><Link className="btn btn-primary" href="/login">Sign in</Link></>}
    {state === "error" && <><Notice kind="error" text={message}/><p>Ask your service team to send a new invitation if this one has expired.</p><Link className="btn btn-secondary" href="/login">Go to sign in</Link></>}
  </section></main>;
}
