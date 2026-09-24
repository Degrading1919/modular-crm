"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, body, date, friendly, money, patch, unwrapItem, unwrapItems } from "./api";
import { Badge, Empty, Icon, Loading, Logo, Modal, Notice, useResource } from "./ui";
import PayrollApp from "./PayrollApp";
import DeveloperApp from "./DeveloperApp";
import FranchiseApp from "./FranchiseApp";
import InventoryOperations from "./InventoryOperations";
import InvoiceRefund from "./InvoiceRefund";
import type { RefundPaymentContext } from "./InvoiceRefund";
import AutomationManager from "./AutomationManager";
import WebsiteDomains from "./WebsiteDomains";
import CapabilitySetup, { featureIsUsable, featureIsVisible, type CapabilityCatalog, type CapabilityFeature } from "./CapabilitySetup";

type Entity = Record<string, any> & { id: string };
type Field = { key: string; label: string; type?: "text" | "email" | "tel" | "date" | "number" | "money" | "textarea" | "select"; options?: string[]; required?: boolean };
type Resource = { title: string; singular: string; subtitle: string; path: string; icon: Parameters<typeof Icon>[0]["name"]; columns: { label: string; key: string; secondary?: string; format?: "money" | "date" | "status" }[]; fields: Field[]; empty: string; actions?: { label: string; path: (id: string) => string; payload?: Record<string, unknown>; confirm?: string }[] };

const resources: Record<string, Resource> = {
  leads: { title: "Leads", singular: "Lead", subtitle: "Keep new opportunities moving toward service.", path: "/leads", icon: "spark", empty: "New inquiries from your website and team will appear here.", columns: [{ label: "Lead", key: "name", secondary: "email" }, { label: "Source", key: "source" }, { label: "Phone", key: "phone" }, { label: "Status", key: "status", format: "status" }, { label: "Created", key: "createdAt", format: "date" }], fields: [{ key: "name", label: "Name", required: true }, { key: "email", label: "Email", type: "email" }, { key: "phone", label: "Phone", type: "tel" }, { key: "source", label: "How they found you" }, { key: "address", label: "Service address" }, { key: "notes", label: "Notes", type: "textarea" }], actions: [{ label: "Convert to customer", path: (id) => `/leads/${id}/convert`, confirm: "Convert this lead to a customer?" }] },
  customers: { title: "Customers", singular: "Customer", subtitle: "People, places, and service history in one view.", path: "/customers", icon: "users", empty: "Add your first customer or invite one from your website.", columns: [{ label: "Customer", key: "name", secondary: "email" }, { label: "Phone", key: "phone" }, { label: "Service address", key: "address" }, { label: "Status", key: "status", format: "status" }, { label: "Next service", key: "nextService", format: "date" }], fields: [{ key: "name", label: "Customer name", required: true }, { key: "email", label: "Email", type: "email" }, { key: "phone", label: "Phone", type: "tel" }, { key: "address", label: "Service address" }, { key: "customerType", label: "Customer type", type: "select", options: ["residential", "commercial"] }] },
  jobs: { title: "Jobs", singular: "Job", subtitle: "Track every visit from scheduling to completion.", path: "/jobs", icon: "briefcase", empty: "Jobs from new service plans and bookings will appear here.", columns: [{ label: "Customer", key: "customerName", secondary: "serviceName" }, { label: "Address", key: "address" }, { label: "Service day", key: "scheduledDate", format: "date" }, { label: "Technician", key: "technicianName" }, { label: "Status", key: "status", format: "status" }], fields: [{ key: "customerId", label: "Customer", required: true }, { key: "serviceId", label: "Service", required: true }, { key: "address", label: "Service address" }, { key: "scheduledDate", label: "Service day", type: "date" }, { key: "notes", label: "Job instructions", type: "textarea" }], actions: [{ label: "Mark scheduled", path: (id) => `/jobs/${id}/transition`, payload: { status: "scheduled" } }] },
  estimates: { title: "Estimates", singular: "Estimate", subtitle: "Create clear proposals and track customer decisions.", path: "/estimates", icon: "receipt", empty: "Create an estimate when a lead needs a custom price.", columns: [{ label: "Estimate", key: "number", secondary: "customerName" }, { label: "Total", key: "totalCents", format: "money" }, { label: "Status", key: "status", format: "status" }, { label: "Expires", key: "expiresAt", format: "date" }], fields: [{ key: "customerId", label: "Customer", required: true }, { key: "serviceId", label: "Service" }, { key: "title", label: "What is included?", required: true }, { key: "totalCents", label: "Total price", type: "money", required: true }, { key: "notes", label: "Description", type: "textarea" }], actions: [{ label: "Send estimate", path: (id) => `/estimates/${id}/send`, confirm: "Send this estimate to the customer?" }] },
  invoices: { title: "Invoices", singular: "Invoice", subtitle: "See what has been billed, paid, and still needs attention.", path: "/invoices", icon: "wallet", empty: "Invoices from completed work will appear here.", columns: [{ label: "Invoice", key: "number", secondary: "customerName" }, { label: "Amount", key: "totalCents", format: "money" }, { label: "Balance", key: "balanceCents", format: "money" }, { label: "Due", key: "dueDate", format: "date" }, { label: "Status", key: "status", format: "status" }], fields: [{ key: "customerId", label: "Customer ID", required: true }, { key: "description", label: "Description", required: true }, { key: "totalCents", label: "Amount", type: "money", required: true }, { key: "dueDate", label: "Due date", type: "date" }], actions: [{ label: "Issue invoice", path: (id) => `/invoices/${id}/issue`, confirm: "Issue this invoice to the customer?" }] },
  "service-plans": { title: "Service plans", singular: "Service plan", subtitle: "Manage repeat visits and customer commitments.", path: "/service-plans", icon: "calendar", empty: "Recurring plans will appear here after signup or estimate approval.", columns: [{ label: "Customer", key: "customerName", secondary: "serviceName" }, { label: "Frequency", key: "frequency" }, { label: "Next service", key: "nextService", format: "date" }, { label: "Status", key: "status", format: "status" }], fields: [{ key: "customerId", label: "Customer ID", required: true }, { key: "serviceId", label: "Service ID", required: true }, { key: "frequency", label: "Frequency", type: "select", options: ["weekly", "twice_weekly", "every_two_weeks", "every_four_weeks"] }, { key: "startDate", label: "Start date", type: "date" }], actions: [{ label: "Pause plan", path: (id) => `/service-plans/${id}/pause`, confirm: "Pause future service for this plan?" }, { label: "Resume plan", path: (id) => `/service-plans/${id}/resume` }] },
  tickets: { title: "Requests & tickets", singular: "Ticket", subtitle: "Resolve customer questions and service follow-ups.", path: "/tickets", icon: "ticket", empty: "Customer requests and team tickets will appear here.", columns: [{ label: "Subject", key: "subject", secondary: "customerName" }, { label: "Type", key: "type" }, { label: "Priority", key: "priority" }, { label: "Status", key: "status", format: "status" }, { label: "Created", key: "createdAt", format: "date" }], fields: [{ key: "subject", label: "Subject", required: true }, { key: "customerId", label: "Customer ID" }, { key: "type", label: "Type", type: "select", options: ["service", "reclean", "billing", "support"] }, { key: "description", label: "Details", type: "textarea", required: true }] },
  services: { title: "Service catalog", singular: "Service", subtitle: "The work you offer and its starting price.", path: "/services", icon: "box", empty: "Add the services your business offers.", columns: [{ label: "Service", key: "name", secondary: "description" }, { label: "Starting price", key: "basePriceCents", format: "money" }, { label: "Duration", key: "durationMinutes" }, { label: "Status", key: "status", format: "status" }], fields: [{ key: "name", label: "Service name", required: true }, { key: "description", label: "Description", type: "textarea" }, { key: "basePriceCents", label: "Starting price", type: "money" }, { key: "durationMinutes", label: "Expected minutes", type: "number" }] },
  staff: { title: "Staff", singular: "Team member", subtitle: "Manage who can help run your business.", path: "/staff", icon: "person", empty: "Invite a team member to share the work.", columns: [{ label: "Team member", key: "name", secondary: "email" }, { label: "Role", key: "role" }, { label: "Location", key: "locationName" }, { label: "Status", key: "status", format: "status" }], fields: [{ key: "name", label: "Name", required: true }, { key: "email", label: "Email", type: "email", required: true }, { key: "role", label: "Role", type: "select", options: ["office", "technician"] }] },
  inventory: { title: "Inventory", singular: "Item", subtitle: "Keep supplies ready without losing track of stock.", path: "/inventory", icon: "box", empty: "Add supplies you want to track, such as bags or treatment products.", columns: [{ label: "Item", key: "name", secondary: "sku" }, { label: "On hand", key: "quantity" }, { label: "Reorder at", key: "reorderThreshold" }, { label: "Location", key: "locationName" }], fields: [{ key: "name", label: "Item name", required: true }, { key: "sku", label: "SKU" }, { key: "quantity", label: "Starting quantity", type: "number" }, { key: "reorderThreshold", label: "Reorder when below", type: "number" }] },
  automations: { title: "Automations", singular: "Automation", subtitle: "Make routine follow-ups happen on time.", path: "/automations", icon: "spark", empty: "Turn on a recommended recipe or make your own rule.", columns: [{ label: "Automation", key: "name", secondary: "description" }, { label: "When", key: "trigger" }, { label: "Status", key: "status", format: "status" }, { label: "Last run", key: "lastRunAt", format: "date" }], fields: [{ key: "name", label: "Rule name", required: true }, { key: "trigger", label: "When this happens", type: "select", options: ["job.completed", "invoice.issued", "payment.failed", "lead.created"] }, { key: "action", label: "Then do this", type: "select", options: ["send_email", "send_sms", "create_ticket"] }] },
  communications: { title: "Communications", singular: "Message", subtitle: "Review updates sent to customers and delivery issues.", path: "/communications", icon: "send", empty: "Updates and reminders sent to customers will appear here.", columns: [{ label: "Recipient", key: "recipient", secondary: "subject" }, { label: "Channel", key: "channel" }, { label: "Template", key: "templateName" }, { label: "Status", key: "status", format: "status" }, { label: "Sent", key: "sentAt", format: "date" }], fields: [{ key: "recipient", label: "Customer email or phone", required: true }, { key: "channel", label: "Channel", type: "select", options: ["email", "sms"] }, { key: "subject", label: "Subject" }, { key: "message", label: "Message", type: "textarea", required: true }] },
  payments: { title: "Payments", singular: "Payment", subtitle: "See collected payments and failed attempts.", path: "/payments", icon: "wallet", empty: "Payment records will appear here after invoices are paid.", columns: [{ label: "Customer", key: "customerName" }, { label: "Amount", key: "amountCents", format: "money" }, { label: "Method", key: "method" }, { label: "Status", key: "status", format: "status" }, { label: "Date", key: "createdAt", format: "date" }], fields: [{ key: "invoiceId", label: "Invoice ID", required: true }, { key: "amountCents", label: "Amount", type: "money", required: true }, { key: "method", label: "Method", type: "select", options: ["cash", "check", "manual"] }] },
  organization: { title: "Locations", singular: "Location", subtitle: "Keep branches organized and see them together.", path: "/organization", icon: "building", empty: "Add another location as your business grows.", columns: [{ label: "Location", key: "name", secondary: "address" }, { label: "Manager", key: "managerName" }, { label: "Staff", key: "staffCount" }, { label: "Status", key: "status", format: "status" }], fields: [{ key: "name", label: "Location name", required: true }, { key: "address", label: "Address" }, { key: "phone", label: "Phone", type: "tel" }] },
};

const nav = [
  { label: "Workspace", items: [{ key: "dashboard", label: "Overview", icon: "grid" }, { key: "leads", label: "Leads", icon: "spark" }, { key: "customers", label: "Customers", icon: "users" }, { key: "schedule", label: "Schedule", icon: "calendar" }, { key: "routes", label: "Routes", icon: "route" }, { key: "jobs", label: "Jobs", icon: "briefcase" }] },
  { label: "Business", items: [{ key: "sales", label: "Sales & services", icon: "receipt" }, { key: "billing", label: "Get paid", icon: "wallet" }, { key: "tickets", label: "Requests", icon: "ticket" }, { key: "reports", label: "Reports", icon: "chart" }, { key: "website", label: "Website", icon: "globe" }, { key: "connections", label: "Connections", icon: "plug" }] },
  { label: "More", items: [{ key: "staff", label: "Staff", icon: "person" }, { key: "payroll", label: "Pay & time", icon: "clock" }, { key: "inventory", label: "Inventory", icon: "box" }, { key: "automations", label: "Automations", icon: "spark" }, { key: "communications", label: "Messages", icon: "send" }, { key: "organization", label: "Locations", icon: "building" }, { key: "franchise", label: "Franchise", icon: "building" }, { key: "import", label: "Import & export", icon: "download" }, { key: "capabilities", label: "My capabilities", icon: "box" }, { key: "settings", label: "Settings", icon: "settings" }, { key: "developer", label: "Developer", icon: "more" }] },
] as const;

const navigationFeatureKeys: Record<string, string[]> = {
  schedule: ["service_scheduling"], routes: ["route_planning"], jobs: ["field_job_tracking"],
  sales: ["service_catalog", "estimate_management", "recurring_service_management"],
  billing: ["invoicing", "payment_collection"], reports: ["advanced_reporting"], website: ["website_publishing"],
  staff: ["staff_access_management"], payroll: ["payroll_inputs"], inventory: ["inventory_tracking"],
  automations: ["automation_workflows"], communications: ["customer_notifications"], organization: ["multi_location_management"],
  franchise: ["multi_location_management"],
  import: ["data_import_export"], settings: ["platform_settings"],
};

const routeFeatureKeys: Record<string, string[]> = {
  schedule: ["service_scheduling"], routes: ["route_planning"], jobs: ["field_job_tracking"],
  sales: ["service_catalog", "estimate_management", "recurring_service_management"],
  billing: ["invoicing", "payment_collection"], reports: ["advanced_reporting"], website: ["website_publishing"],
  estimates: ["estimate_management"], services: ["service_catalog"], "service-plans": ["recurring_service_management"],
  invoices: ["invoicing"], payments: ["payment_collection"], payroll: ["payroll_inputs"], inventory: ["inventory_tracking"],
  automations: ["automation_workflows"], communications: ["customer_notifications"], organization: ["multi_location_management"],
  franchise: ["multi_location_management"],
};

type BusinessUser = { user?: { name?: string; email?: string; role?: string; permissions?: string[] }; tenant?: { name?: string; packKey?: string } };

export default function BusinessApp({ section }: { section: string[] }) {
  const current = section[0] || "dashboard";
  const [menuOpen, setMenuOpen] = useState(false);
  const capabilityResult = useResource<{ item?: CapabilityCatalog }>("/capabilities", { item: { modules: [], features: {} } });
  const capabilityCatalog = unwrapItem(capabilityResult.data) as CapabilityCatalog;
  const features = capabilityCatalog.features ?? {};
  const identity = useResource<BusinessUser>("/auth/me", {});
  const role = identity.data.user?.role?.toLowerCase() || "";
  const displayedName = identity.data.user?.name || "Business owner";
  const tenantName = identity.data.tenant?.name || "My business";
  const canManageFranchise = identity.data.user?.permissions?.includes("organization.franchise_manage") === true;
  const restricted = role.includes("technician") || role.includes("customer");

  async function logout() {
    try { await api("/auth/logout", body({})); } finally { window.location.href = "/login"; }
  }

  if (identity.loading) return <Loading label="Opening your workspace…" />;
  if (identity.error) return <div className="auth-main" style={{ minHeight: "100vh" }}><div className="auth-box"><Logo/><h2 style={{ marginTop: 35 }}>Sign in to continue</h2><p>{identity.error}</p><Link className="btn btn-primary" href="/login">Go to sign in <Icon name="arrow" size={16}/></Link></div></div>;
  if (restricted) return <div className="auth-main" style={{ minHeight: "100vh" }}><div className="auth-box"><Logo/><h2 style={{ marginTop: 35 }}>Your workspace is ready elsewhere</h2><p>Open the part of Modular made for your account.</p><Link className="btn btn-primary" href={role.includes("technician") ? "/field/today" : "/portal/home"}>Open my workspace <Icon name="arrow" size={16}/></Link></div></div>;

  const visibleNav = nav.map((group) => ({ ...group, items: group.items.filter((item) => {
    if (item.key === "franchise" && !canManageFranchise) return false;
    const requiredFeatures = navigationFeatureKeys[item.key];
    if (!requiredFeatures) return true;
    return !capabilityResult.loading && featureIsVisible(features, requiredFeatures);
  }) })).filter((group) => group.items.length > 0);
  const gatedFeatures = routeFeatureKeys[current] ?? [];
  const waitingForCapabilities = gatedFeatures.length > 0 && capabilityResult.loading;
  const routeBlocked = gatedFeatures.length > 0 && !capabilityResult.loading && !featureIsUsable(features, gatedFeatures);
  const routePermissionBlocked = current === "franchise" && !canManageFranchise;

  return <div className="app-layout">
    {menuOpen && <div className="sidebar-overlay" onClick={() => setMenuOpen(false)}/>}
    <aside className={`app-sidebar ${menuOpen ? "open" : ""}`}>
      <div className="sidebar-top"><Link href="/app/dashboard" onClick={() => setMenuOpen(false)}><Logo light/></Link></div>
      <nav className="sidebar-nav" aria-label="Business navigation">{visibleNav.map((group) => <div key={group.label}><div className="nav-label">{group.label}</div>{group.items.map((item) => <Link key={item.key} className={`sidebar-link ${current === item.key ? "active" : ""}`} href={`/app/${item.key}`} onClick={() => setMenuOpen(false)}><Icon name={item.icon}/>{item.label}</Link>)}</div>)}</nav>
      <div className="sidebar-bottom"><button type="button" className="sidebar-link" style={{ width: "100%", border: 0, background: "transparent" }} onClick={logout}><Icon name="arrow"/>Sign out</button><div className="sidebar-account"><div className="avatar">{displayedName.slice(0, 1)}</div><div><strong>{displayedName}</strong><span>{friendly(identity.data.user?.role)}</span></div></div></div>
    </aside>
    <main className="app-main"><header className="topbar"><div className="topbar-left"><button type="button" className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Icon name="menu"/></button><span className="location-chip"><Icon name="building" size={16}/>{tenantName}</span><span className="topbar-date">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</span></div><div className="topbar-right"><Link href="/app/tickets" className="icon-button" aria-label="Requests"><Icon name="bell"/></Link><div className="avatar" title={displayedName}>{displayedName.slice(0, 1)}</div></div></header><div className="content">
      {waitingForCapabilities ? <Loading label="Checking your workspace tools…"/> : routeBlocked ? <CapabilityUnavailable features={features} featureKeys={gatedFeatures}/> : routePermissionBlocked ? <Empty title="You don’t have access to franchise settings" description="Ask a business owner to manage franchise units and royalty statements." action={<Link className="btn btn-primary" href="/app/dashboard">Back to overview</Link>}/> : <>
        {current === "dashboard" && <Dashboard name={displayedName} features={features} />}
        {current === "schedule" && <Schedule />}
        {current === "routes" && <Routes />}
        {current === "sales" && <Hub title="Sales & services" subtitle="Build your pipeline, send estimates, and keep offerings current." features={features} cards={[{ title: "Estimates", text: "Create and follow up on proposals.", href: "/app/estimates", icon: "receipt", featureKeys: ["estimate_management"] }, { title: "Service catalog", text: "Manage what you offer and starting prices.", href: "/app/services", icon: "box", featureKeys: ["service_catalog"] }, { title: "Service plans", text: "See and manage recurring work.", href: "/app/service-plans", icon: "calendar", featureKeys: ["recurring_service_management"] }, { title: "Leads", text: "Move inquiries into active customers.", href: "/app/leads", icon: "spark" }]} />}
        {current === "billing" && <Hub title="Get paid" subtitle="Track invoices, balances, and money collected." features={features} cards={[{ title: "Invoices", text: "Issue invoices and see open balances.", href: "/app/invoices", icon: "receipt", featureKeys: ["invoicing"] }, { title: "Payments", text: "Review completed and failed payments.", href: "/app/payments", icon: "wallet", featureKeys: ["payment_collection"] }, { title: "Connections", text: "Choose how you accept payments.", href: "/app/connections", icon: "plug" }]} />}
        {current === "connections" && <Connections role={role} permissions={identity.data.user?.permissions} />}
        {current === "website" && <><Website /><WebsiteDomains /></>}
        {current === "automations" && <><Header eyebrow="Your business" title="Automations" subtitle="Set up helpful follow-ups and see what happened when each rule ran."/><AutomationManager /></>}
        {current === "reports" && <Reports />}
        {current === "payroll" && <PayrollApp mode="manager" canManageProfiles={identity.data.user?.permissions?.includes("compensation.manage") === true} />}
        {current === "import" && <ImportExport />}
        {current === "capabilities" && <CapabilitySetup mode="manage" canManage={identity.data.user?.permissions?.includes("tenant.billing_manage") === true} onSaved={capabilityResult.reload}/>}
        {current === "settings" && <Settings />}
        {current === "developer" && <DeveloperApp />}
        {current === "franchise" && <FranchiseApp />}
        {current === "inventory" && <><Header eyebrow="Your business" title="Inventory" subtitle="Keep supplies ready across branches, vehicles, and jobs."/><InventoryOperations /></>}
        {resources[current] && current !== "inventory" && current !== "automations" && <ResourcePage resourceKey={current} resource={resources[current]} id={section[1]} features={features} />}
        {!resources[current] && !["dashboard", "schedule", "routes", "sales", "billing", "connections", "website", "automations", "reports", "payroll", "import", "capabilities", "settings", "developer", "franchise", "inventory"].includes(current) && <Empty title="Page not found" description="This area is not part of your workspace." action={<Link className="btn btn-primary" href="/app/dashboard">Back to overview</Link>} />}
      </>}
    </div></main>
  </div>;
}

function Header({ eyebrow, title, subtitle, children }: { eyebrow?: string; title: string; subtitle?: string; children?: React.ReactNode }) {
  return <div className="page-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{children && <div className="page-actions">{children}</div>}</div>;
}

function Hub({ title, subtitle, cards, features }: { title: string; subtitle: string; features: Record<string, CapabilityFeature>; cards: { title: string; text: string; href: string; icon: Parameters<typeof Icon>[0]["name"]; featureKeys?: string[] }[] }) {
  const availableCards = cards.filter((card) => featureIsUsable(features, card.featureKeys ?? []));
  return <><Header eyebrow="Your business" title={title} subtitle={subtitle}/><div className="module-grid">{availableCards.map((card) => <div className="card module-card" key={card.href}><div className="module-icon"><Icon name={card.icon}/></div><h3>{card.title}</h3><p>{card.text}</p><Link className="btn btn-secondary btn-sm" href={card.href}>Open {card.title.toLowerCase()} <Icon name="arrow" size={15}/></Link></div>)}</div>{availableCards.length === 0 && <CapabilityUnavailable features={features} featureKeys={title === "Get paid" ? ["invoicing", "payment_collection"] : ["service_catalog", "estimate_management", "recurring_service_management"]}/>}</>;
}

function CapabilityUnavailable({ features, featureKeys }: { features: Record<string, CapabilityFeature>; featureKeys: readonly string[] }) {
  const names = featureKeys.map((key) => features[key]?.name).filter((name): name is string => Boolean(name));
  const description = names.length ? `Your current setup doesn’t include ${names.join(", ")}. Review your capabilities to see which tools you can add.` : "This tool isn’t ready in your current setup. Review your capabilities to see which tools you can add.";
  return <><Header eyebrow="Your setup" title="This tool isn’t available yet." subtitle={description}/><div className="card card-pad"><h2>Choose tools for your business</h2><p className="subtle" style={{ fontSize: ".86rem" }}>Your workspace keeps working with the tools you already use. You can update your choices at any time.</p><Link className="btn btn-primary" href="/app/capabilities">Review my capabilities <Icon name="arrow" size={16}/></Link></div></>;
}

function Dashboard({ name, features }: { name: string; features: Record<string, CapabilityFeature> }) {
  const result = useResource<Record<string, any>>("/dashboard", {});
  const dashboard = unwrapItem(result.data);
  const metrics = dashboard.metrics || {};
  const attention = dashboard.attention || [];
  const jobs = dashboard.upcomingJobs || [];
  const first = name.split(" ")[0];
  return <><Header eyebrow="Good to see you" title={`Good morning, ${first}.`} subtitle="Here’s what needs your attention today."><Link href="/app/jobs" className="btn btn-primary"><Icon name="plus" size={17}/> New job</Link></Header>
    {result.error && <Notice kind="error" text={result.error}/>}
    <div className="hero-panel"><div><div className="eyebrow" style={{ color: "var(--mint)" }}>Your day at a glance</div><h1>Keep today moving.</h1><p>Review jobs that need a technician, follow up with customers, and keep every route on track.</p></div><Link href="/app/schedule" className="btn btn-lime">Open schedule <Icon name="arrow" size={17}/></Link></div>
    {result.loading ? <Loading/> : <><div className="four-col" style={{ marginTop: 18 }}><Metric label="Jobs today" value={metrics.todaysJobs ?? 0} icon="briefcase" hint="scheduled visits"/><Metric label="Need assignment" value={metrics.unassignedJobs ?? 0} icon="calendar" hint="ready to dispatch"/><Metric label="Open balances" value={money(metrics.openBalanceCents)} icon="wallet" hint="customer invoices"/><Metric label="Active customers" value={metrics.activeCustomers ?? 0} icon="users" hint="currently in service"/></div>
      <div className="two-col"><div><div className="section-title"><h2>Needs attention</h2><Link className="link" href="/app/tickets">All requests</Link></div><div className="card card-pad">{attention.length ? <div className="action-list">{attention.map((item: any, index: number) => <div className="action-item" key={item.id || index}><div className="action-icon"><Icon name="warning" size={18}/></div><div><strong>{item.title}</strong><p>{item.detail}</p></div><Link href={item.href || "/app/tickets"}>Review</Link></div>)}</div> : <Empty title="All caught up" description="We’ll put exceptions and follow-ups here as they come in."/>}</div></div><div><div className="section-title"><h2>Coming up</h2><Link className="link" href="/app/jobs">See all jobs</Link></div><div className="card card-pad">{jobs.length ? jobs.slice(0, 5).map((job: any) => <Link className="job-row" href={`/app/jobs/${job.id}`} key={job.id}><span className="time-pill">{job.scheduledTime || "Today"}</span><span><strong>{job.customerName || job.name}</strong><p>{job.serviceName || "Service"} · {job.address || "Address pending"}</p></span><Badge status={job.status}/></Link>) : <Empty title="No jobs lined up" description="Once you schedule work, today’s jobs will appear here." action={<Link className="btn btn-secondary btn-sm" href="/app/jobs">Manage jobs</Link>}/>}</div></div></div>
      <div className="section-title"><h2>Quick actions</h2></div><div className="module-grid"><QuickAction icon="users" title="Add a customer" text="Start a new customer record." href="/app/customers?new=1"/>{featureIsVisible(features, ["route_planning"]) && <QuickAction icon="route" title="Plan a route" text="Put assigned jobs in order." href="/app/routes"/>}{featureIsVisible(features, ["website_publishing"]) && <QuickAction icon="globe" title="Your website" text="Preview or publish your site." href="/app/website"/>}</div>
    </>}
  </>;
}

function Metric({ label, value, icon, hint }: { label: string; value: string | number; icon: Parameters<typeof Icon>[0]["name"]; hint: string }) {
  return <div className="card metric-card"><div className="metric-icon"><Icon name={icon} size={17}/></div><div className="muted-label">{label}</div><div className="amount metric-value">{value}</div><span className="metric-hint">{hint}</span></div>;
}

function QuickAction({ icon, title, text, href }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; text: string; href: string }) {
  return <Link href={href} className="card module-card"><div className="module-icon"><Icon name={icon}/></div><h3>{title}</h3><p>{text}</p><span className="table-action">Get started <Icon name="arrow" size={13}/></span></Link>;
}

function displayValue(item: Entity, key: string, format?: "money" | "date" | "status") {
  const value = item[key];
  if (format === "status") return <Badge status={value}/>;
  if (format === "money") return <span className="amount">{money(value)}</span>;
  if (format === "date") return date(value);
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return value.line1 || value.addressLine1 || value.name || "See details";
  return value ?? "—";
}

function CustomerExtras({ customer }: { customer: Entity }) {
  const contacts: Entity[] = customer.contacts || [];
  const locations: Entity[] = customer.locations || [];
  const pets: Entity[] = customer.pets || [];
  return <><div className="card card-pad"><h3>People & places</h3>{contacts.length ? contacts.map((contact) => <div className="action-item" key={contact.id}><div><strong>{[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Contact"}</strong><p>{contact.email || contact.phone || "No contact details"}</p></div></div>) : <p className="subtle" style={{ fontSize: ".83rem" }}>No contacts recorded.</p>}{locations.length ? locations.map((location) => <div className="action-item" key={location.id}><div className="action-icon"><Icon name="map" size={17}/></div><div><strong>{location.name || "Service address"}</strong><p>{[location.addressLine1, location.city, location.region, location.postalCode].filter(Boolean).join(", ")}</p></div></div>) : <p className="subtle" style={{ fontSize: ".83rem" }}>No service address recorded.</p>}</div><div className="card card-pad"><h3>Pets & service details</h3>{pets.length ? pets.map((pet) => <div className="action-item" key={pet.id}><div className="action-icon"><Icon name="spark" size={17}/></div><div><strong>{pet.name}</strong><p>{pet.customFields?.size || pet.customFields?.species || "Pet"}{pet.customFields?.safetyFlag ? ` · Safety: ${pet.customFields.safetyFlag}` : ""}</p></div></div>) : <p className="subtle" style={{ fontSize: ".83rem" }}>No pets recorded for this customer.</p>}</div></>;
}

function ResourcePage({ resourceKey, resource, id, features }: { resourceKey: string; resource: Resource; id?: string; features: Record<string, CapabilityFeature> }) {
  const list = useResource<{ items: Entity[] }>(id ? null : resource.path, { items: [] });
  const detail = useResource<{ item: Entity }>(id ? `${resource.path}/${id}` : null, { item: { id: "" } });
  const invoicePayments = useResource<{ items: RefundPaymentContext[] }>(id && resourceKey === "invoices" ? `/invoices/${id}/payments` : null, { items: [] });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("");
  const [descending, setDescending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [secureEstimateUrl, setSecureEstimateUrl] = useState("");
  useEffect(() => { const params = new URLSearchParams(window.location.search); setCreating(params.get("new") === "1"); setQuery(params.get("search") || ""); setFilter("all"); setSort(""); }, [resourceKey]);
  const rows = useMemo(() => {
    const source = unwrapItems(list.data);
    let output = source.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase()) && (filter === "all" || String(row.status).toLowerCase() === filter));
    if (sort) output = [...output].sort((a, b) => String(a[sort] ?? "").localeCompare(String(b[sort] ?? "")) * (descending ? -1 : 1));
    return output;
  }, [list.data, query, filter, sort, descending]);
  const statuses = Array.from(new Set(unwrapItems(list.data).map((row) => row.status).filter(Boolean)));
  const current = unwrapItem(detail.data);

  async function runAction(action: NonNullable<Resource["actions"]>[number]) {
    if (!id) return;
    if (action.confirm && !window.confirm(action.confirm)) return;
    setError(""); setNotice(""); setSecureEstimateUrl("");
    try {
      const result = await api<{ actionUrl?: string }>(action.path(id), body(action.payload || {}));
      if (action.label === "Send estimate" && result.actionUrl) {
        setSecureEstimateUrl(new URL(result.actionUrl, window.location.origin).toString());
        setNotice("Estimate sent. Copy the secure link to share it with your customer.");
      } else setNotice(`${action.label} completed.`);
      detail.reload();
    }
    catch (issue) { setError((issue as Error).message); }
  }

  async function copyEstimateLink() {
    try {
      await navigator.clipboard.writeText(secureEstimateUrl);
      setNotice("Secure estimate link copied.");
    } catch {
      setError("Clipboard access was unavailable. Select and copy the link manually.");
    }
  }

  return <><Header eyebrow={id ? resource.title : "Your business"} title={id ? (current.name || current.subject || current.number || current.customerName || resource.singular) : resource.title} subtitle={id ? `View ${resource.singular.toLowerCase()} details and next steps.` : resource.subtitle}>{id ? <Link href={`/app/${resourceKey}`} className="btn btn-secondary"><Icon name="arrow" size={16} className="rotate-left"/> Back to {resource.title.toLowerCase()}</Link> : <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={17}/> New {resource.singular.toLowerCase()}</button>}</Header>
    {(list.error || detail.error || error) && <Notice kind="error" text={list.error || detail.error || error} onClose={() => setError("")}/>}{notice && <Notice kind="success" text={notice} onClose={() => setNotice("")}/>}
    {secureEstimateUrl && <div className="card card-pad" style={{ marginBottom: 16 }}><h2>Share this estimate</h2><p className="subtle" style={{ fontSize: ".86rem" }}>This private link lets your customer review and respond to the current estimate.</p><div className="inline-actions"><input aria-label="Secure estimate link" readOnly value={secureEstimateUrl} onFocus={(event) => event.currentTarget.select()} style={{ minWidth: 0, flex: 1 }}/><button type="button" className="btn btn-secondary" onClick={copyEstimateLink}>Copy link</button><a className="btn btn-secondary" href={secureEstimateUrl} target="_blank" rel="noreferrer">Preview</a></div></div>}
    {id ? (detail.loading ? <Loading/> : <div className="detail-grid"><div className="card card-pad"><div className="card-heading"><h2>Details</h2><Badge status={current.status}/></div><dl>{Object.entries(current).filter(([key, value]) => !["id", "tenantId", "createdAt", "updatedAt", "metadata", "customFields"].includes(key) && value != null && typeof value !== "object").map(([key, value]) => <div className="detail-list" key={key}><dt>{friendly(key.replace(/([A-Z])/g, " $1"))}</dt><dd>{/Cents$/.test(key) ? money(Number(value)) : /Date$|At$/.test(key) ? date(String(value)) : String(value)}</dd></div>)}</dl><div className="inline-actions" style={{ marginTop: 22 }}>{resource.actions?.filter((action) => !(action.label === "Send estimate" && current.status !== "draft") && !(action.label === "Issue invoice" && current.status !== "draft") && !(action.label === "Pause plan" && current.status !== "active") && !(action.label === "Resume plan" && current.status !== "paused") && !(action.label === "Convert to customer" && current.status === "converted") && !(action.label === "Mark scheduled" && !["draft", "unscheduled"].includes(current.status))).map((action) => <button key={action.label} type="button" className="btn btn-secondary" onClick={() => runAction(action)}>{action.label}</button>)}{resourceKey === "invoices" && current.status !== "paid" && featureIsUsable(features, ["payment_collection"]) && <PaymentAction invoice={current} onDone={() => { detail.reload(); invoicePayments.reload(); }}/>}</div></div><div className="stack">{resourceKey === "customers" && <CustomerExtras customer={current}/>}<div className="card card-pad"><h3>At a glance</h3><p className="subtle" style={{ fontSize: ".86rem" }}>Created {date(current.createdAt)}. Changes and activity stay with this record.</p><Link className="link" href={`/app/${resourceKey}`}>See all {resource.title.toLowerCase()}</Link></div>{resourceKey === "invoices" && <section className="card card-pad" aria-label="Payment history"><h3>Payment history</h3>{invoicePayments.error && <Notice kind="error" text={invoicePayments.error}/ >}{invoicePayments.loading ? <Loading label="Loading payment history…"/> : unwrapItems(invoicePayments.data).length ? <div className="stack" style={{ gap: 8 }}>{unwrapItems(invoicePayments.data).map((payment) => <div className="action-item" key={payment.id}><div><strong>{money(payment.amountCents, current.currency || "USD")}</strong><p className="subtle" style={{ margin: "3px 0 0", fontSize: ".82rem" }}>{friendly(payment.sourceType)} · {friendly(payment.status)} · {date(payment.createdAt)}</p><p className="subtle" style={{ margin: "3px 0 0", fontSize: ".82rem" }}>Refunded {money(payment.refundedCents, current.currency || "USD")}</p></div></div>)}</div> : <p className="subtle" style={{ fontSize: ".84rem" }}>No payments have been recorded for this invoice.</p>}{featureIsUsable(features, ["payment_collection"]) && <div style={{ marginTop: 16 }}><InvoiceRefund invoiceId={id} balanceCents={Number(current.balanceCents ?? 0)} currency={current.currency || "USD"} payments={unwrapItems(invoicePayments.data)} onRefunded={() => { detail.reload(); invoicePayments.reload(); }}/></div>}</section>}{resourceKey === "customers" && <div className="card card-pad"><h3>Keep the relationship moving</h3><p className="subtle" style={{ fontSize: ".86rem" }}>See service plans, jobs, and billing from their workspaces.</p><div className="stack" style={{ gap: 8 }}><Link className="btn btn-secondary btn-sm" href="/app/service-plans">Service plans</Link><Link className="btn btn-secondary btn-sm" href="/app/jobs">Jobs</Link><Link className="btn btn-secondary btn-sm" href="/app/invoices">Invoices</Link></div></div>}</div></div>) : <div className="card"><div className="table-tools"><div className="search-box"><Icon name="search" size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${resource.title.toLowerCase()}`} aria-label={`Search ${resource.title.toLowerCase()}`}/></div><select className="filter-select" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter by status"><option value="all">All statuses</option>{statuses.map((status) => <option value={status} key={status}>{friendly(status)}</option>)}</select></div>{list.loading ? <Loading/> : rows.length ? <><div className="data-table-wrap"><table className="data-table"><thead><tr>{resource.columns.map((column) => <th key={column.key}><button type="button" className="table-header-button" onClick={() => { if (sort === column.key) setDescending(!descending); else { setSort(column.key); setDescending(false); } }}>{column.label}{sort === column.key ? (descending ? " ↓" : " ↑") : ""}</button></th>)}<th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}>{resource.columns.map((column, index) => <td key={column.key}>{index === 0 ? <Link href={`/app/${resourceKey}/${row.id}`}><span className="table-primary">{displayValue(row, column.key, column.format)}</span>{column.secondary && <span className="table-secondary">{row[column.secondary] || ""}</span>}</Link> : displayValue(row, column.key, column.format)}</td>)}<td><Link className="table-action" href={`/app/${resourceKey}/${row.id}`}>View</Link></td></tr>)}</tbody></table></div><div className="table-card-fallback">{rows.map((row) => <Link key={row.id} className="table-card" href={`/app/${resourceKey}/${row.id}`}><strong>{row[resource.columns[0].key] || resource.singular}</strong><p className="subtle" style={{ margin: "5px 0 9px", fontSize: ".8rem" }}>{row[resource.columns[0].secondary || ""] || row.address || ""}</p><Badge status={row.status}/></Link>)}</div></> : <Empty title={query || filter !== "all" ? "No matching records" : `No ${resource.title.toLowerCase()} yet`} description={query || filter !== "all" ? "Try another search or status." : resource.empty} action={query || filter !== "all" ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button> : <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>Add {resource.singular.toLowerCase()}</button>}/>}</div>}
    {id && ["estimates", "invoices", "payments", "customers"].includes(resourceKey) || (id && resourceKey === "jobs" && current.status === "completed") ? <div className="card card-pad" style={{ marginTop: 16 }}><div className="card-heading"><div><h3 style={{ margin: 0 }}>Documents</h3><p className="subtle" style={{ fontSize: ".84rem", margin: "4px 0 0" }}>View or print a customer-ready copy.</p></div></div><div className="inline-actions">{resourceKey === "estimates" && <Link className="btn btn-secondary btn-sm" href={`/app/documents/estimate/${id}`}>View estimate</Link>}{resourceKey === "invoices" && <Link className="btn btn-secondary btn-sm" href={`/app/documents/invoice/${id}`}>View invoice</Link>}{resourceKey === "payments" && ["succeeded", "refunded", "partially_refunded"].includes(String(current.status)) && <Link className="btn btn-secondary btn-sm" href={`/app/documents/receipt/${id}`}>View receipt</Link>}{resourceKey === "customers" && <Link className="btn btn-secondary btn-sm" href={`/app/documents/statement/${id}`}>Create account statement</Link>}{resourceKey === "jobs" && <Link className="btn btn-secondary btn-sm" href={`/app/documents/completion/${id}`}>View completion report</Link>}</div></div> : null}
    {creating && <CreateRecord resource={resource} onClose={() => setCreating(false)} onCreated={(created) => { setCreating(false); list.reload(); setNotice(`${resource.singular} created.`); if (created.id) window.history.replaceState(null, "", `/app/${resourceKey}`); }}/>} 
  </>;
}

function CreateRecord({ resource, onClose, onCreated }: { resource: Resource; onClose: () => void; onCreated: (item: Entity) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const customers = useResource<{ items: Entity[] }>(resource.fields.some((field) => field.key === "customerId") ? "/customers" : null, { items: [] });
  const services = useResource<{ items: Entity[] }>(resource.fields.some((field) => field.key === "serviceId") ? "/services" : null, { items: [] });
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setSaving(true);
    const payload: Record<string, unknown> = {};
    for (const field of resource.fields) {
      const value = values[field.key];
      if (value === undefined || value === "") continue;
      payload[field.key] = field.type === "money" ? Math.round(Number(value) * 100) : field.type === "number" ? Number(value) : value;
    }
    try { const response = await api<{ item: Entity }>(resource.path, body(payload)); onCreated(unwrapItem(response)); }
    catch (issue) { setError((issue as Error).message); }
    finally { setSaving(false); }
  }
  return <Modal title={`New ${resource.singular.toLowerCase()}`} onClose={onClose}><form onSubmit={submit}><div className="form-grid">{resource.fields.map((field) => <div className={`field ${field.type === "textarea" ? "full" : ""}`} key={field.key}><label htmlFor={`new-${field.key}`}>{field.key === "customerId" ? "Customer" : field.key === "serviceId" ? "Service" : field.label}</label>{field.key === "customerId" || field.key === "serviceId" ? <select id={`new-${field.key}`} value={values[field.key] || ""} required={field.required} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}><option value="">Choose {field.key === "customerId" ? "customer" : "service"}</option>{unwrapItems(field.key === "customerId" ? customers.data : services.data).map((item) => <option key={item.id} value={item.id}>{item.name || item.title}</option>)}</select> : field.type === "textarea" ? <textarea id={`new-${field.key}`} required={field.required} value={values[field.key] || ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}/> : field.type === "select" ? <select id={`new-${field.key}`} value={values[field.key] || ""} required={field.required} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}><option value="">Choose one</option>{field.options?.map((option) => <option key={option} value={option}>{friendly(option)}</option>)}</select> : <input id={`new-${field.key}`} type={field.type === "money" || field.type === "number" ? "number" : field.type || "text"} min={field.type === "money" || field.type === "number" ? 0 : undefined} step={field.type === "money" ? ".01" : undefined} required={field.required} value={values[field.key] || ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}/>}</div>)}</div>{(customers.error || services.error) && <div style={{ marginTop: 15 }}><Notice kind="error" text={customers.error || services.error}/></div>}{error && <div style={{ marginTop: 15 }}><Notice kind="error" text={error}/></div>}<div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : `Create ${resource.singular.toLowerCase()}`}</button></div></form></Modal>;
}

function PaymentAction({ invoice, onDone }: { invoice: Entity; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(((invoice.balanceCents ?? invoice.totalCents ?? 0) / 100).toFixed(2)));
  const [paymentKey, setPaymentKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { await api(`/invoices/${invoice.id}/pay`, body({ amountCents: Math.round(Number(amount) * 100), method: "test", idempotencyKey: paymentKey })); setOpen(false); onDone(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setSaving(false); }
  }
  return <><button type="button" className="btn btn-primary" onClick={() => { setPaymentKey(crypto.randomUUID()); setOpen(true); }}>Record payment</button>{open && <Modal title="Record a payment" onClose={() => setOpen(false)}><form onSubmit={submit}><p className="subtle">Use the local demo payment provider to update this invoice.</p><div className="field"><label htmlFor="pay-amount">Amount</label><input id="pay-amount" type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => { setAmount(event.target.value); setPaymentKey(crypto.randomUUID()); }}/></div>{error && <div style={{ marginTop: 15 }}><Notice kind="error" text={error}/></div>}<div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Processing…" : "Record payment"}</button></div></form></Modal>}</>;
}

function Schedule() {
  const jobs = useResource<{ items: Entity[] }>("/jobs", { items: [] });
  const staff = useResource<{ items: Entity[] }>("/staff", { items: [] });
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedJob, setSelectedJob] = useState<Entity | null>(null);
  const [technicianId, setTechnicianId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const all = unwrapItems(jobs.data);
  const today = all.filter((job) => String(job.scheduledDate || "").startsWith(selectedDate));
  const unassigned = all.filter((job) => !job.technicianId && !job.technicianName && !["completed", "skipped", "canceled"].includes(job.status));
  const availableStaff = unwrapItems(staff.data).filter((person) => /technician|field/i.test(person.role || ""));
  async function assign(event: React.FormEvent) {
    event.preventDefault(); if (!selectedJob) return;
    setSaving(true); setError("");
    try { await api(`/jobs/${selectedJob.id}/assign`, body({ technicianId, scheduledDate: selectedDate })); setSelectedJob(null); setNotice("Job assigned. The route planner can now include it."); jobs.reload(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setSaving(false); }
  }
  return <><Header eyebrow="Operations" title="Schedule" subtitle="Put the right work on the right day and keep the team in sync."><Link className="btn btn-secondary" href="/app/routes">Plan routes <Icon name="arrow" size={16}/></Link><Link className="btn btn-primary" href="/app/jobs?new=1"><Icon name="plus" size={17}/> New job</Link></Header>
    {jobs.error && <Notice kind="error" text={jobs.error}/>} {notice && <Notice kind="success" text={notice} onClose={() => setNotice("")}/>}
    <div className="two-col" style={{ gridTemplateColumns: "minmax(0,1.7fr) minmax(270px,.9fr)" }}><div className="card card-pad"><div className="card-heading"><h2>Work for {date(selectedDate)}</h2><div className="field"><label htmlFor="schedule-date" className="sr-only">Schedule date</label><input id="schedule-date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}/></div></div>{jobs.loading ? <Loading/> : today.length ? today.map((job) => <div className="action-item" key={job.id}><div className="action-icon"><Icon name="briefcase" size={18}/></div><div><Link className="table-primary" href={`/app/jobs/${job.id}`}>{job.customerName || job.name || "Job"}</Link><p>{job.serviceName || "Service"} · {job.address || "Address pending"}</p><p>{job.technicianName || "Needs technician"}</p></div><Badge status={job.status}/></div>) : <Empty title="No work on this day" description="Choose another day or add a job to begin scheduling." action={<Link href="/app/jobs?new=1" className="btn btn-secondary btn-sm">Add a job</Link>}/>}</div><div className="stack"><div className="card card-pad"><div className="card-heading"><h2>Needs assignment</h2><Badge status={`${unassigned.length} open`}/></div>{unassigned.length ? <div className="stack" style={{ maxHeight: 440, overflowY: "auto", gap: 8 }}>{unassigned.map((job) => <div className="action-item" key={job.id}><div><strong>{job.customerName || job.name || "Job"}</strong><p>{job.serviceName || "Service"} · {job.address || "Address pending"}</p></div><button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: "auto" }} aria-label={`Assign ${job.serviceName || "job"} for ${job.customerName || job.name || "customer"}`} onClick={() => { setSelectedJob(job); setTechnicianId(""); }}>Assign</button></div>)}</div> : <p className="subtle" style={{ fontSize: ".85rem" }}>Every active job has an assignment.</p>}</div><div className="card card-pad"><h3>Routing tip</h3><p className="subtle" style={{ fontSize: ".85rem" }}>Once jobs are assigned, build a route to reduce drive time and publish the order to the technician.</p><Link href="/app/routes" className="link">Open route planner</Link></div></div></div>
    {selectedJob && <Modal title={`Assign ${selectedJob.customerName || "job"}`} onClose={() => setSelectedJob(null)}><form onSubmit={assign}><p className="subtle">Choose a technician and service day. They’ll see this job after its route is published.</p><div className="form-grid"><div className="field"><label htmlFor="assign-tech">Technician</label><select id="assign-tech" value={technicianId} required onChange={(event) => setTechnicianId(event.target.value)}><option value="">Choose a technician</option>{availableStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div><div className="field"><label htmlFor="assign-date">Service day</label><input id="assign-date" type="date" value={selectedDate} required onChange={(event) => setSelectedDate(event.target.value)}/></div></div>{staff.error && <Notice kind="error" text={staff.error}/>} {error && <Notice kind="error" text={error}/>}<div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setSelectedJob(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving || !availableStaff.length}>{saving ? "Assigning…" : "Assign job"}</button></div></form></Modal>}
  </>;
}

function Routes() {
  const result = useResource<{ items: Entity[] }>("/routes", { items: [] });
  const staff = useResource<{ items: Entity[] }>("/staff", { items: [] });
  const [open, setOpen] = useState(false);
  const [dateValue, setDateValue] = useState(new Date().toISOString().slice(0, 10));
  const [technicianId, setTechnicianId] = useState("");
  const [selected, setSelected] = useState<Entity | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = unwrapItems(result.data);
  const technicians = unwrapItems(staff.data).filter((person) => /technician|field/i.test(person.role || ""));
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/routes", body({ date: dateValue, technicianId })); setOpen(false); setNotice("Route created. Optimize it before publishing."); result.reload(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  async function action(route: Entity, name: "optimize" | "publish") {
    if (name === "publish" && !window.confirm("Publish this route to the technician?")) return;
    setBusy(true); setError("");
    try { await api(`/routes/${route.id}/${name}`, body({})); setNotice(name === "optimize" ? "Route order optimized." : "Route published to the technician."); result.reload(); setSelected(null); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  async function moveStop(route: Entity, index: number, direction: -1 | 1) {
    const stops = [...(route.stops || [])]; const next = index + direction;
    if (next < 0 || next >= stops.length) return;
    [stops[index], stops[next]] = [stops[next], stops[index]];
    setBusy(true); setError("");
    try { await api(`/routes/${route.id}`, patch({ stopIds: stops.map((stop: Entity) => stop.id) })); setSelected({ ...route, stops }); result.reload(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  return <><Header eyebrow="Operations" title="Routes" subtitle="Turn assigned jobs into a clear, efficient day in the field."><button className="btn btn-primary" type="button" onClick={() => setOpen(true)}><Icon name="plus" size={17}/> Create route</button></Header>{result.error && <Notice kind="error" text={result.error}/>} {error && <Notice kind="error" text={error} onClose={() => setError("")}/>} {notice && <Notice kind="success" text={notice} onClose={() => setNotice("")}/>}
    {result.loading ? <Loading/> : rows.length ? <div className="module-grid">{rows.map((route) => <div className="card card-pad" key={route.id}><div className="card-heading"><div className="module-icon"><Icon name="route"/></div><Badge status={route.status}/></div><h2 style={{ margin: "14px 0 5px" }}>{route.technicianName || "Unassigned route"}</h2><p className="subtle" style={{ fontSize: ".85rem" }}>{date(route.date)} · {(route.stops || []).length} stops</p><div className="inline-actions" style={{ fontSize: ".78rem", color: "var(--muted)", marginBottom: 20 }}><span>{Number(route.distanceMiles || 0).toFixed(1)} miles</span><span>·</span><span>{route.driveMinutes || 0} min drive</span></div><div className="inline-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(route)}>View stops</button>{route.status !== "published" && <button type="button" className="btn btn-secondary btn-sm" onClick={() => action(route, "optimize")} disabled={busy}>Optimize</button>}{route.status !== "published" && <button type="button" className="btn btn-primary btn-sm" onClick={() => action(route, "publish")} disabled={busy}>Publish</button>}</div></div>)}</div> : <div className="card"><Empty title="No routes yet" description="Assign jobs to a technician, then create a route for their service day." action={<Link className="btn btn-secondary btn-sm" href="/app/schedule">Open schedule</Link>}/></div>}
    {open && <Modal title="Create a route" onClose={() => setOpen(false)}><form onSubmit={create}><p className="subtle">We’ll gather the assigned work for this technician and day.</p><div className="form-grid"><div className="field"><label htmlFor="route-date">Service day</label><input id="route-date" type="date" value={dateValue} required onChange={(event) => setDateValue(event.target.value)}/></div><div className="field"><label htmlFor="route-tech">Technician</label><select id="route-tech" value={technicianId} required onChange={(event) => setTechnicianId(event.target.value)}><option value="">Choose technician</option>{technicians.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div></div>{staff.error && <Notice kind="error" text={staff.error}/>} {error && <Notice kind="error" text={error}/>}<div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" type="submit" disabled={busy || !technicians.length}>{busy ? "Creating…" : "Create route"}</button></div></form></Modal>}
    {selected && <Modal title={`${selected.technicianName || "Route"} · ${date(selected.date)}`} onClose={() => setSelected(null)}><p className="subtle">Use arrows to change stop order before publication. Select a point on the map to inspect its stop.</p><RouteMap stops={selected.stops || []}/><div className="stack" style={{ gap: 8 }}>{(selected.stops || []).length ? selected.stops.map((stop: Entity, index: number) => <div className="route-stop" key={stop.id}><span className="route-stop-number">{index + 1}</span><div style={{ flex: 1 }}><strong>{stop.customerName || stop.name || "Stop"}</strong><p className="subtle" style={{ fontSize: ".78rem", margin: 0 }}>{stop.address || "Address pending"}</p></div><div className="inline-actions"><button type="button" className="icon-button" aria-label={`Move stop ${index + 1} up`} disabled={busy || index === 0 || selected.status === "published"} onClick={() => moveStop(selected, index, -1)}>↑</button><button type="button" className="icon-button" aria-label={`Move stop ${index + 1} down`} disabled={busy || index === selected.stops.length - 1 || selected.status === "published"} onClick={() => moveStop(selected, index, 1)}>↓</button></div></div>) : <Empty title="No assigned stops" description="Assign jobs to this technician on this day, then optimize again." action={<Link href="/app/schedule" className="btn btn-secondary btn-sm">Open schedule</Link>}/>}</div><div className="modal-footer">{selected.status !== "published" && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => action(selected, "optimize")}>Optimize route</button>}{selected.status !== "published" && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => action(selected, "publish")}>Publish route</button>}</div></Modal>}
  </>;
}

function RouteMap({ stops }: { stops: Entity[] }) {
  const [active, setActive] = useState<string | null>(null);
  const points = stops.map((stop, index) => ({ stop, index, latitude: Number(stop.latitude ?? stop.lat ?? stop.location?.latitude), longitude: Number(stop.longitude ?? stop.lng ?? stop.location?.longitude) })).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && (point.latitude !== 0 || point.longitude !== 0));
  if (!points.length) return <div className="route-map-empty"><Icon name="map" size={21}/><span>Stop map will appear when service addresses have verified locations.</span></div>;
  const minLat = Math.min(...points.map((point) => point.latitude)); const maxLat = Math.max(...points.map((point) => point.latitude));
  const minLng = Math.min(...points.map((point) => point.longitude)); const maxLng = Math.max(...points.map((point) => point.longitude));
  const latitudeSpan = Math.max(maxLat - minLat, .002); const longitudeSpan = Math.max(maxLng - minLng, .002);
  const project = (point: typeof points[number]) => ({ x: 30 + ((point.longitude - minLng) / longitudeSpan) * 340, y: 190 - ((point.latitude - minLat) / latitudeSpan) * 150 });
  const routePoints = points.map((point) => `${project(point).x},${project(point).y}`).join(" ");
  const selected = points.find((point) => point.stop.id === active);
  return <div className="route-map"><svg viewBox="0 0 400 220" role="img" aria-label="Map showing the route stop positions"><defs><pattern id="route-map-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#dbe7d6" strokeWidth="1"/></pattern></defs><rect x="0" y="0" width="400" height="220" fill="#f3f8ee"/><rect x="0" y="0" width="400" height="220" fill="url(#route-map-grid)"/><polyline points={routePoints} fill="none" stroke="#2e7950" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 0"/>{points.map((point) => { const coordinate = project(point); return <g key={point.stop.id} role="button" tabIndex={0} aria-label={`Stop ${point.index + 1}: ${point.stop.customerName || point.stop.name || "Customer"}`} onClick={() => setActive(point.stop.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setActive(point.stop.id); }} style={{ cursor: "pointer" }}><circle cx={coordinate.x} cy={coordinate.y} r="15" fill={active === point.stop.id ? "#c9e993" : "#173d35"} stroke="#fff" strokeWidth="3"/><text x={coordinate.x} y={coordinate.y + 4} textAnchor="middle" fill={active === point.stop.id ? "#173d35" : "#fff"} fontSize="11" fontWeight="800">{point.index + 1}</text></g>; })}<text x="377" y="22" textAnchor="middle" fill="#467357" fontSize="12" fontWeight="800">N ↑</text></svg>{selected && <div className="route-map-caption"><strong>Stop {selected.index + 1}: {selected.stop.customerName || selected.stop.name || "Customer"}</strong><span>{selected.stop.address || "Address pending"}</span></div>}</div>;
}

function Connections({ role, permissions }: { role: string; permissions?: string[] }) {
  const result = useResource<{ items: Entity[] }>("/connections", { items: [] });
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState("");
  const items = unwrapItems(result.data);
  const groups = Array.from(new Set(items.map((item) => item.capability || "Other")));
  const mayManageCredentials = role ? role === "owner" && (!permissions || permissions.includes("connectors.configure")) : !permissions || permissions.includes("connectors.configure");
  useEffect(() => {
    if (result.loading || typeof window === "undefined") return;
    const query = new URLSearchParams(window.location.search);
    const key = query.get("connection");
    const status = query.get("status");
    if (!key || !["connected", "denied", "failed"].includes(status || "")) return;
    const item = items.find((candidate) => candidate.key === key && candidate.mode === "oauth_setup");
    if (!item) return;
    if (status === "connected") setNotice(`${item.name} is connected.`);
    else setError(status === "denied" ? `${item.name} connection was cancelled.` : `${item.name} could not be connected. Try again.`);
    query.delete("connection"); query.delete("status");
    const search = query.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
    result.reload();
  }, [result.loading, items, result.reload]);
  async function change(item: Entity, action: "connect" | "disconnect" | "reconnect") {
    if (action === "disconnect" && !window.confirm(`Disconnect ${item.name}? Existing business records will stay in Modular.`)) return;
    const isLiveSetup = item.mode === "live_setup";
    const busyKey = isLiveSetup || item.mode === "oauth_setup" ? `${item.key}:${action}` : item.key;
    setBusy(busyKey); setError(""); setNotice("");
    try {
      const endpointAction = item.mode === "oauth_setup" && action !== "disconnect" ? "connect" : action;
      const response = await api<{ authorizationUrl?: string; item?: { authorizationUrl?: string } }>(`/connections/${encodeURIComponent(item.key)}/${endpointAction}`, body({}));
      const authorizationUrl = response?.item?.authorizationUrl ?? response?.authorizationUrl;
      if (authorizationUrl) {
        const target = new URL(authorizationUrl);
        if (target.protocol !== "https:" || target.username || target.password) throw new Error("The connection service returned an invalid sign-in address. Please try again.");
        window.location.assign(target.toString()); return;
      }
      setNotice(action === "disconnect" ? isLiveSetup ? `${item.name} was disconnected and its saved details were removed.` : `${item.name} was disconnected.` : isLiveSetup ? `${item.name} connection started.` : `${item.name} is connected.`);
      result.reload();
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(""); }
  }
  return <><Header eyebrow="Tools that work together" title="Connections" subtitle="Choose what your business needs. You can add or change a connection later."/>{result.error && <Notice kind="error" text={result.error}/>} {error && <Notice kind="error" text={error} onClose={() => setError("")}/>} {notice && <Notice kind="success" text={notice} onClose={() => setNotice("")}/>}{result.loading ? <Loading/> : groups.length ? groups.map((group) => <section key={group}><div className="section-title"><h2>{friendly(group)}</h2></div><div className="module-grid">{items.filter((item) => (item.capability || "Other") === group).map((item) => item.mode === "live_setup" ? <LiveConnectorCard key={item.key} item={item} busy={busy} mayManage={mayManageCredentials} onBusy={setBusy} onError={setError} onNotice={setNotice} onReload={result.reload} onChange={change}/> : item.mode === "oauth_setup" ? <OAuthConnectorCard key={item.key} item={item} busy={busy} mayManage={mayManageCredentials} onChange={change}/> : <div className="card module-card" key={item.key}><div className="module-icon"><Icon name={/payment/i.test(group) ? "wallet" : /calendar/i.test(group) ? "calendar" : /accounting/i.test(group) ? "chart" : /rout|map/i.test(group) ? "route" : "plug"}/></div><div className="inline-actions" style={{ justifyContent: "space-between", width: "100%" }}><h3>{item.name}</h3><Badge status={item.status}/></div><p>{item.description || `Connect ${item.name} to support ${friendly(group).toLowerCase()}.`}</p>{item.mode === "mock" && <span className="muted-label">Demo connection · no real messages or charges</span>}<div className="inline-actions">{item.status === "connected" ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy === item.key} onClick={() => change(item, "disconnect")}>Disconnect</button> : <button type="button" className="btn btn-primary btn-sm" disabled={busy === item.key} onClick={() => change(item, "connect")}>{busy === item.key ? "Connecting…" : item.status === "needs_attention" ? "Reconnect" : "Connect"}</button>}</div></div>)}</div></section>) : <div className="card"><Empty title="No connections available" description="When your business tools are available, they will appear here by what they help you do."/></div>}</>;
}

function OAuthConnectorCard({ item, busy, mayManage, onChange }: { item: Entity; busy: string; mayManage: boolean; onChange: (item: Entity, action: "connect" | "disconnect" | "reconnect") => Promise<void> }) {
  const canConnect = item.oauthAvailable === true;
  const actionBusy = busy === `${item.key}:connect` || busy === `${item.key}:reconnect` || busy === `${item.key}:disconnect`;
  return <div className="card module-card" data-connector-key={item.key}>
    <div className="module-icon"><Icon name="plug"/></div>
    <div className="inline-actions" style={{ justifyContent: "space-between", width: "100%" }}><h3>{item.name}</h3><Badge status={item.status}/></div>
    <p>{item.description || `Connect ${item.name} to support ${friendly(item.capability).toLowerCase()}.`}</p>
    {!canConnect && item.status !== "connected" && <p className="muted-label" role="status">Connection setup is not ready yet. You’ll be able to connect {item.name} here when it’s available.</p>}
    {item.status === "authorizing" && <p className="muted-label" role="status">Waiting for sign-in to finish. Return here after approving access to refresh the connection status.</p>}
    {!mayManage && <p className="muted-label" role="status">Only a business owner can change this connection.</p>}
    <div className="inline-actions">
      {item.status === "connected"
        ? <button type="button" className="btn btn-secondary btn-sm" disabled={actionBusy || !mayManage} onClick={() => onChange(item, "disconnect")}>{busy === `${item.key}:disconnect` ? "Disconnecting…" : "Disconnect"}</button>
        : canConnect && mayManage && <button type="button" className="btn btn-primary btn-sm" disabled={actionBusy} onClick={() => onChange(item, "connect")}>{actionBusy ? "Connecting…" : item.status === "needs_attention" ? "Reconnect" : `Connect with ${item.providerName || item.name.replace(/\s+(Calendar|Payments|Accounting)$/i, "")}`}</button>}
    </div>
  </div>;
}
type ConnectorCredentialField = { key: string; label: string; inputType: "password" | "textarea"; helpText?: string; maxLength?: number };

function LiveConnectorCard({ item, busy, mayManage, onBusy, onError, onNotice, onReload, onChange }: {
  item: Entity; busy: string; mayManage: boolean; onBusy: (value: string) => void; onError: (value: string) => void;
  onNotice: (value: string) => void; onReload: () => void; onChange: (item: Entity, action: "connect" | "disconnect" | "reconnect") => Promise<void>;
}) {
  const fields = (item.credentialFields ?? []) as ConnectorCredentialField[];
  const [values, setValues] = useState<Record<string, string>>({});
  const saveBusy = busy === `${item.key}:save`;
  const actionBusy = busy === `${item.key}:connect` || busy === `${item.key}:reconnect` || busy === `${item.key}:disconnect`;
  const configured = item.credentialConfigured === true;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fields.some((field) => !values[field.key]?.trim() || values[field.key]!.length > (field.maxLength ?? 8192))) {
      onError("Enter each requested connection detail within its listed length."); return;
    }
    onBusy(`${item.key}:save`); onError(""); onNotice("");
    try {
      await api(`/connections/${encodeURIComponent(item.key)}/credentials`, body({ credentials: values }));
      setValues({});
      onNotice(`${item.name} details saved. They are stored securely and won’t be shown again.`);
      onReload();
    } catch (issue) { onError((issue as Error).message); }
    finally { onBusy(""); }
  }

  return <div className="card module-card" data-connector-key={item.key}>
    <div className="module-icon"><Icon name="plug"/></div>
    <div className="inline-actions" style={{ justifyContent: "space-between", width: "100%" }}><h3>{item.name}</h3><Badge status={item.status}/></div>
    <p>{item.description || `Connect ${item.name} to support ${friendly(item.capability).toLowerCase()}.`}</p>
    <div className="stack" style={{ gap: 12, marginTop: 12 }}>
      <p className="muted-label" role="status">{configured ? "Connection details saved. For your security, saved details are never shown here." : "This service needs connection details before you can connect it."}</p>
      {mayManage && fields.length > 0 && <form aria-label={`Set up ${item.name}`} onSubmit={save} className="stack" style={{ gap: 12 }}>
        {fields.map((field) => {
          const id = `credential-${item.key}-${field.key}`;
          return <div className="field" key={field.key}>
            <label htmlFor={id}>{field.label}</label>
            {field.inputType === "textarea"
              ? <textarea id={id} name={field.key} required maxLength={field.maxLength ?? 8192} disabled={saveBusy || actionBusy} value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} aria-describedby={field.helpText ? `${id}-help` : undefined}/>
              : <input id={id} name={field.key} type="password" autoComplete="new-password" required maxLength={field.maxLength ?? 8192} disabled={saveBusy || actionBusy} value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} aria-describedby={field.helpText ? `${id}-help` : undefined}/>}
            {field.helpText && <small id={`${id}-help`} className="subtle">{field.helpText}</small>}
          </div>;
        })}
        <button type="submit" className="btn btn-secondary btn-sm" disabled={saveBusy || actionBusy}>{saveBusy ? "Saving securely…" : configured ? "Save new details" : "Save connection details"}</button>
      </form>}
      {!mayManage && <p className="subtle" role="status">Only a business owner can change these connection details.</p>}
      <div className="inline-actions">
        {item.status === "connected"
          ? <button type="button" className="btn btn-secondary btn-sm" disabled={actionBusy || !mayManage} onClick={() => onChange(item, "disconnect")}>{busy === `${item.key}:disconnect` ? "Disconnecting…" : "Disconnect and remove details"}</button>
          : <button type="button" className="btn btn-primary btn-sm" disabled={actionBusy || !configured || !mayManage} onClick={() => onChange(item, item.status === "needs_attention" ? "reconnect" : "connect")}>{busy === `${item.key}:connect` || busy === `${item.key}:reconnect` ? "Connecting…" : item.status === "needs_attention" ? "Reconnect" : "Connect"}</button>}
        {configured && item.status !== "connected" && <button type="button" className="btn btn-secondary btn-sm" disabled={actionBusy || saveBusy || !mayManage} onClick={() => onChange(item, "disconnect")}>{busy === `${item.key}:disconnect` ? "Removing…" : "Remove saved details"}</button>}
      </div>
    </div>
  </div>;
}
function Website() {
  const result = useResource<{ item: Entity }>("/website", { item: { id: "" } });
  const item = unwrapItem(result.data);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [saving, setSaving] = useState(false);
  useEffect(() => { if (!result.loading && !result.error) setValues({ businessName: item.businessName || "", tagline: item.tagline || "", description: item.description || "", phone: item.phone || "", email: item.email || "", serviceArea: item.serviceArea || "", template: item.template || "fresh" }); }, [result.loading, result.error, item.businessName, item.tagline, item.description, item.phone, item.email, item.serviceArea, item.template]);
  async function save(event?: React.FormEvent) {
    event?.preventDefault(); setSaving(true); setError("");
    try { await api("/website", patch(values)); setNotice("Website draft saved."); result.reload(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setSaving(false); }
  }
  async function publish() {
    setSaving(true); setError("");
    try { await api("/website", patch(values)); await api("/website/publish", body({})); setNotice("Your website is published and ready for visitors."); result.reload(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setSaving(false); }
  }
  const slug = item.slug || "happy-yards";
  return <><Header eyebrow="Online presence" title="Your website" subtitle="A polished home for your business, built from information you already know."><Badge status={item.status || "draft"}/>{item.status === "published" && <Link className="btn btn-secondary" href={`/site/${slug}`} target="_blank">View live site <Icon name="external" size={16}/></Link>}</Header>{result.error && <Notice kind="error" text={result.error}/>} {error && <Notice kind="error" text={error} onClose={() => setError("")}/>} {notice && <Notice kind="success" text={notice} onClose={() => setNotice("")}/>}{result.loading ? <Loading/> : <div className="detail-grid"><form className="card card-pad" onSubmit={save}><div className="card-heading"><h2>Site content</h2><span className="muted-label">Changes save as a draft</span></div><div className="form-grid">{[{ key: "businessName", label: "Business name" }, { key: "tagline", label: "Headline" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "serviceArea", label: "Where you work" }].map((field) => <div className="field" key={field.key}><label htmlFor={`site-${field.key}`}>{field.label}</label><input id={`site-${field.key}`} value={values[field.key] || ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}/></div>)}<div className="field full"><label htmlFor="site-description">A short description of your business</label><textarea id="site-description" value={values.description || ""} onChange={(event) => setValues({ ...values, description: event.target.value })}/></div><div className="field"><label htmlFor="site-template">Website style</label><select id="site-template" value={values.template || "fresh"} onChange={(event) => setValues({ ...values, template: event.target.value })}><option value="fresh">Fresh & friendly</option><option value="classic">Classic local business</option></select></div></div><div className="inline-actions" style={{ marginTop: 25 }}><button type="submit" className="btn btn-secondary" disabled={saving}>{saving ? "Saving…" : "Save draft"}</button><button type="button" className="btn btn-primary" onClick={publish} disabled={saving}>{saving ? "Publishing…" : item.status === "published" ? "Publish updates" : "Publish website"}</button></div></form><div className="stack"><div className="card card-pad"><div className="eyebrow">Live preview</div><h2 style={{ margin: "14px 0 7px" }}>{values.businessName || "Your business"}</h2><h3 style={{ color: "#39754c", marginBottom: 8 }}>{values.tagline || "A better day starts here."}</h3><p className="subtle" style={{ fontSize: ".86rem" }}>{values.description || "Your description will appear here."}</p><div className="divider"/><p className="muted-label">Serving {values.serviceArea || "your community"}</p><p className="muted-label">{values.phone || values.email || "Contact details will appear here"}</p></div><div className="card card-pad"><h3>Included website address</h3><p className="subtle" style={{ fontSize: ".85rem" }}>{item.domain || `${slug}.modular.local`}</p><p className="subtle" style={{ fontSize: ".8rem" }}>Custom domain controls are available below.</p></div><div className="card card-pad"><h3>Signup is connected</h3><p className="subtle" style={{ fontSize: ".85rem" }}>New service requests flow into Leads or Customers based on eligibility and pricing.</p><Link href={`/site/${slug}/signup`} className="link">Test customer signup</Link></div></div></div>}</>;
}

const reportTypes = [{ key: "financial", label: "Money", icon: "wallet" }, { key: "customers", label: "Customers", icon: "users" }, { key: "jobs", label: "Jobs", icon: "briefcase" }, { key: "routes", label: "Routes", icon: "route" }, { key: "staff", label: "Staff", icon: "person" }, { key: "inventory", label: "Inventory", icon: "box" }, { key: "locations", label: "Locations", icon: "building" }] as const;

function Reports() {
  const [type, setType] = useState<string>("financial");
  const [range, setRange] = useState("month");
  const result = useResource<Record<string, any>>(`/reports?type=${encodeURIComponent(type)}&range=${range}`, {});
  const report = unwrapItem(result.data);
  const [error, setError] = useState("");
  async function download() {
    setError("");
    try { const response = await fetch(`/api/v1/reports/export?type=${encodeURIComponent(type)}&range=${range}`, { credentials: "include" }); if (!response.ok) throw new Error("The export could not be created. Please try again."); const blob = await response.blob(); const href = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = href; anchor.download = `${type}-report.csv`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(href); }
    catch (issue) { setError((issue as Error).message); }
  }
  return <><Header eyebrow="A clearer picture" title="Reports" subtitle="See what is happening across customers, service, and revenue."><button type="button" className="btn btn-secondary" onClick={download}><Icon name="download" size={16}/> Download CSV</button></Header><div className="report-tabs" role="tablist" aria-label="Report categories">{reportTypes.map((option) => <button role="tab" aria-selected={type === option.key} className={type === option.key ? "active" : ""} key={option.key} type="button" onClick={() => setType(option.key)}><Icon name={option.icon} size={16}/>{option.label}</button>)}</div><div className="inline-actions" style={{ margin: "18px 0" }}><label htmlFor="report-range" className="field-label">Time period</label><select id="report-range" className="filter-select" value={range} onChange={(event) => setRange(event.target.value)}><option value="week">This week</option><option value="month">This month</option><option value="quarter">This quarter</option><option value="year">This year</option></select></div>{result.error && <Notice kind="error" text={result.error}/>} {error && <Notice kind="error" text={error}/>} {result.loading ? <Loading/> : <><div className="four-col">{(report.metrics || []).map((metric: any, index: number) => <Metric key={metric.key || index} label={metric.label} value={metric.value ?? "—"} icon={reportTypes.find((entry) => entry.key === type)?.icon || "chart"} hint={metric.change || "Current period"}/>)}</div><div className="section-title"><h2>{report.title || `${friendly(type)} details`}</h2></div><div className="card">{(report.rows || []).length ? <div className="data-table-wrap"><table className="data-table"><thead><tr>{Object.keys(report.rows[0]).map((key) => <th key={key}>{friendly(key.replace(/([A-Z])/g, " $1"))}</th>)}</tr></thead><tbody>{report.rows.map((row: Entity, index: number) => <tr key={row.id || index}>{Object.entries(row).map(([key, value]) => <td key={key}>{/Cents$/.test(key) ? money(Number(value)) : String(value ?? "—")}</td>)}</tr>)}</tbody></table></div> : <Empty title="No report activity yet" description="As you use Modular, this report will fill with real business data."/>}</div></>}</>;
}

function Settings() {
  const result = useResource<{ item: Entity }>("/settings", { item: { id: "" } });
  const item = unwrapItem(result.data);
  const [values, setValues] = useState<Record<string, string>>({}); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [saving, setSaving] = useState(false);
  useEffect(() => { if (!result.loading && !result.error) setValues({ businessName: item.businessName || "", phone: item.phone || "", email: item.email || "", timezone: item.timezone || "America/New_York", address: item.address || "" }); }, [result.loading, result.error, item.businessName, item.phone, item.email, item.timezone, item.address]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { await api("/settings", patch(values)); setNotice("Business settings saved."); result.reload(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setSaving(false); }
  }
  return <><Header eyebrow="Your workspace" title="Settings" subtitle="Keep the business details your team and customers rely on current."/>{result.error && <Notice kind="error" text={result.error}/>} {error && <Notice kind="error" text={error}/>} {notice && <Notice kind="success" text={notice}/>} {result.loading ? <Loading/> : <div className="detail-grid"><form className="card card-pad" onSubmit={submit}><h2>Business profile</h2><div className="form-grid">{[{ key: "businessName", label: "Business name", type: "text" }, { key: "phone", label: "Phone", type: "tel" }, { key: "email", label: "Email", type: "email" }, { key: "timezone", label: "Time zone", type: "text" }, { key: "address", label: "Business address", type: "text" }].map((field) => <div className="field" key={field.key}><label htmlFor={`settings-${field.key}`}>{field.label}</label><input id={`settings-${field.key}`} type={field.type} value={values[field.key] || ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}/></div>)}</div><div style={{ marginTop: 24 }}><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save business profile"}</button></div></form><div className="stack"><div className="card card-pad"><h3>Bring your data</h3><p className="subtle" style={{ fontSize: ".85rem" }}>Upload a spreadsheet of customers. We’ll help match columns before importing.</p><Link href="/app/import" className="link">Import customers</Link></div><div className="card card-pad"><h3>Team and access</h3><p className="subtle" style={{ fontSize: ".85rem" }}>Invite staff and choose an owner, office, or technician role.</p><Link href="/app/staff" className="link">Manage staff</Link></div></div></div>}</>;
}

function ImportExport() {
  const [csv, setCsv] = useState(""); const [fileName, setFileName] = useState(""); const [preview, setPreview] = useState<Record<string, any> | null>(null); const [mapping, setMapping] = useState<Record<string, string>>({}); const [importResult, setImportResult] = useState<Record<string, any> | null>(null); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  async function choose(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; setFileName(file.name); setCsv(await file.text()); setPreview(null); setImportResult(null); setError(""); }
  async function inspect() { setBusy(true); setError(""); try { const response = await api<{ item: Record<string, any> }>("/imports", body({ csv, preview: true })); const item = unwrapItem(response); setPreview(item); setMapping(item.mapping || {}); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } }
  async function commit() { if (!preview) return; if ((preview.duplicates || []).length && !window.confirm(`${preview.duplicates.length} possible duplicate customers need review. Import only rows the preview marked safe?`)) return; setBusy(true); setError(""); try { const response = await api<{ item: Record<string, any> }>("/imports", body({ csv, mapping, confirmed: true, idempotencyKey: `${fileName}-${csv.length}-${Object.keys(mapping).length}` })); const item = unwrapItem(response); setNotice(`Import complete: ${item.imported ?? 0} added, ${item.skipped ?? 0} skipped.`); setImportResult(item); setPreview(null); setCsv(""); setFileName(""); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } }
  async function exportCustomers() { setError(""); try { const response = await fetch("/api/v1/exports/customers", { credentials: "include" }); if (!response.ok) throw new Error("Customer export was unavailable. Please try again."); const blob = await response.blob(); const href = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = href; anchor.download = "customers.csv"; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(href); } catch (issue) { setError((issue as Error).message); } }
  return <><Header eyebrow="Your data" title="Import & export" subtitle="Bring existing customers in and take your records with you whenever you need them."/>{error && <Notice kind="error" text={error} onClose={() => setError("")}/>} {notice && <Notice kind="success" text={notice} onClose={() => setNotice("")}/>}<div className="detail-grid"><div className="card card-pad"><h2>Import customers from CSV</h2><p className="subtle" style={{ fontSize: ".87rem" }}>Choose a CSV file. We’ll preview matches and possible duplicates before adding anyone.</p><div className="field"><label htmlFor="csv-file">Customer file</label><input id="csv-file" type="file" accept=".csv,text/csv" onChange={choose}/></div>{fileName && <p className="muted-label" style={{ marginTop: 12 }}>Selected: {fileName}</p>}{csv && !preview && <button type="button" className="btn btn-primary" disabled={busy} onClick={inspect} style={{ marginTop: 16 }}>{busy ? "Checking…" : "Review import"}</button>}{preview && <div style={{ marginTop: 24 }}><div className="notice notice-info">{preview.rowCount ?? preview.previewRows?.length ?? 0} rows found. Check matches before importing.</div><div className="section-title"><h3>Column matches</h3></div><div className="form-grid">{(preview.columns || Object.keys(mapping)).map((column: string) => { const confidence = preview.columnMappings?.find((item: { source: string }) => item.source === column); return <div className="field" key={column}><label htmlFor={`map-${column}`}>{column}</label><select id={`map-${column}`} value={mapping[column] || ""} onChange={(event) => setMapping({ ...mapping, [column]: event.target.value })}><option value="">Ignore column</option>{["name", "email", "phone", "address", "status", "notes"].map((target) => <option key={target} value={target}>{friendly(target)}</option>)}</select>{confidence && <small className="subtle" data-testid={`mapping-confidence-${column}`}>{confidence.confidence === "high" ? "Matched automatically" : `Please confirm: ${confidence.reason}`}</small>}</div>; })}</div>{(preview.errors || []).length > 0 && <div className="notice notice-error" style={{ marginTop: 15 }}><strong>Rows that need attention</strong><ul>{preview.errors.map((item: { row: number; message: string }, index: number) => <li key={index}>Row {item.row}: {item.message}</li>)}</ul></div>}{(preview.duplicates || []).length > 0 && <div className="notice notice-info" style={{ marginTop: 15 }}>{preview.duplicates.length} possible duplicates were found. They will be skipped unless reviewed.</div>}{(preview.previewRows || []).length > 0 && <><div className="section-title"><h3>First rows</h3></div><div className="csv-preview">{preview.previewRows.slice(0, 5).map((row: Record<string, unknown>, index: number) => <div key={index}>{Object.values(row).slice(0, 4).map(String).join(" · ")}</div>)}</div></>}<div className="inline-actions" style={{ marginTop: 22 }}><button type="button" className="btn btn-secondary" onClick={() => setPreview(null)}>Back</button><button type="button" className="btn btn-primary" disabled={busy} onClick={commit}>{busy ? "Importing…" : "Import reviewed customers"}</button></div></div>}{importResult && <div className="card card-pad" aria-label="Import summary"><h3>Import summary</h3><p>{importResult.imported ?? 0} added · {importResult.skipped ?? 0} skipped</p>{(importResult.duplicates || []).length > 0 && <p>{importResult.duplicates.length} possible duplicate rows were skipped.</p>}{(importResult.errorRows || []).length > 0 && <><h4>Error rows</h4><ul>{importResult.errorRows.map((item: { row: number; message: string }, index: number) => <li key={index}>Row {item.row}: {item.message}</li>)}</ul></>}</div>}</div><div className="stack"><div className="card card-pad"><div className="module-icon"><Icon name="download"/></div><h3 style={{ marginTop: 15 }}>Export customers</h3><p className="subtle" style={{ fontSize: ".85rem" }}>Download a CSV of customer contact and service data.</p><button type="button" className="btn btn-secondary btn-sm" onClick={exportCustomers}><Icon name="download" size={15}/> Download CSV</button></div><div className="card card-pad"><h3>What happens during import?</h3><p className="subtle" style={{ fontSize: ".85rem" }}>Columns are matched where the meaning is clear. Possible duplicate contacts appear for review, and the import is safe to retry.</p></div></div></div></>;
}
