"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, body, friendly, money, unwrapItems } from "./api";
import { Badge, Empty, Loading, Notice } from "./ui";

type StockAtLocation = { locationId: string; locationName: string; quantity: string | number; reorderThreshold: string | number | null };
type InventoryItem = {
  id: string;
  name: string;
  sku?: string | null;
  unit?: string;
  quantity: string | number;
  active?: boolean;
  status?: string;
  locations?: StockAtLocation[];
  defaultCostMinor?: number | string | null;
};
type BusinessLocation = { id: string; name: string; status?: string; address?: string };
type StaffMember = { id: string; name: string; role?: string; status?: string };
type Job = { id: string; customerName?: string; serviceName?: string; scheduledDate?: string | null; status: string };
type Vendor = { id: string; name: string; contactName?: string | null; email?: string | null; phone?: string | null; status?: string };
type PurchaseOrderLine = {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  sku?: string | null;
  quantityOrdered: string | number;
  quantityReceived: string | number;
  unitCostMinor: string | number;
  totalMinor: string | number;
};
type PurchaseOrder = {
  id: string;
  orderNumber: string;
  vendorName: string;
  locationName: string;
  status: string;
  currency?: string;
  expectedAt?: string | null;
  totalMinor: string | number;
  items: PurchaseOrderLine[];
};
type DataState = {
  items: InventoryItem[];
  locations: BusinessLocation[];
  staff: StaffMember[];
  jobs: Job[];
  vendors: Vendor[];
  orders: PurchaseOrder[];
};
type OrderDraftLine = { inventoryItemId: string; quantity: string; unitCost: string };

const emptyData: DataState = { items: [], locations: [], staff: [], jobs: [], vendors: [], orders: [] };

function errorText(issue: unknown) {
  return issue instanceof Error ? issue.message : "Something went wrong. Please try again.";
}

function amountInMinor(value: string): number | undefined {
  if (!value.trim()) return undefined;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error("Enter a non-negative amount with up to two decimal places.");
  const minor = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(minor)) throw new Error("That amount is too large.");
  return minor;
}

function quantity(value: string, label = "Quantity") {
  if (!/^\d+(?:\.\d{1,4})?$/.test(value.trim()) || Number(value) <= 0) {
    throw new Error(`${label} must be greater than zero, with up to four decimal places.`);
  }
  return value.trim();
}

function optionalQuantity(value: string, label: string) {
  if (!value.trim()) return undefined;
  if (!/^\d+(?:\.\d{1,4})?$/.test(value.trim())) throw new Error(`${label} must be zero or more, with up to four decimal places.`);
  return value.trim();
}

function inputDate(value?: string | null) {
  if (!value) return "Not set";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function remaining(line: PurchaseOrderLine) {
  return Math.max(0, Number(line.quantityOrdered) - Number(line.quantityReceived));
}

export default function InventoryOperations() {
  const [data, setData] = useState<DataState>(emptyData);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [newItem, setNewItem] = useState(false);
  const [newVendor, setNewVendor] = useState(false);
  const [newOrder, setNewOrder] = useState(false);
  const [receiveItem, setReceiveItem] = useState("");
  const [transferItem, setTransferItem] = useState("");
  const [consumeItem, setConsumeItem] = useState("");

  const reload = useCallback(() => setReloadKey((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    Promise.allSettled([
      api<{ items?: InventoryItem[] }>("/inventory"),
      api<{ items?: BusinessLocation[] }>("/organization/locations"),
      api<{ items?: StaffMember[] }>("/staff"),
      api<{ items?: Job[] }>("/jobs"),
      api<{ items?: Vendor[] }>("/vendors"),
      api<{ items?: PurchaseOrder[] }>("/purchase-orders"),
    ]).then((results) => {
      if (!active) return;
      const [items, locations, staff, jobs, vendors, orders] = results;
      const inventoryResult = items.status === "fulfilled" ? items.value : null;
      if (!inventoryResult) {
        setData(emptyData);
        setLoadError(errorText(items.status === "rejected" ? items.reason : "Could not load inventory."));
        return;
      }
      setData({
        items: unwrapItems(inventoryResult),
        locations: locations.status === "fulfilled" ? unwrapItems(locations.value) : [],
        staff: staff.status === "fulfilled" ? unwrapItems(staff.value) : [],
        jobs: jobs.status === "fulfilled" ? unwrapItems(jobs.value) : [],
        vendors: vendors.status === "fulfilled" ? unwrapItems(vendors.value) : [],
        orders: orders.status === "fulfilled" ? unwrapItems(orders.value) : [],
      });
      const failed = results.flatMap((result, index) => result.status === "rejected" && index !== 0 ? [errorText(result.reason)] : []);
      if (failed.length) setLoadError(`Some supporting lists could not be loaded: ${failed.join(" ")}`);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);

  const activeItems = useMemo(() => data.items.filter((item) => item.active !== false && item.status !== "inactive"), [data.items]);
  const activeLocations = useMemo(() => data.locations.filter((location) => location.status !== "inactive"), [data.locations]);
  const technicians = useMemo(() => data.staff.filter((member) => member.role?.toLowerCase().includes("technician") && member.status !== "deactivated"), [data.staff]);
  const usableJobs = useMemo(() => data.jobs.filter((job) => !["completed", "canceled", "cancelled", "skipped"].includes(job.status.toLowerCase())), [data.jobs]);
  const openOrders = useMemo(() => data.orders.filter((order) => ["ordered", "partially_received"].includes(order.status)), [data.orders]);

  async function submitAction(key: string, action: () => Promise<void>, success: string): Promise<boolean> {
    setError(""); setNotice(""); setSaving(key);
    try { await action(); setNotice(success); reload(); return true; }
    catch (issue) { setError(errorText(issue)); return false; }
    finally { setSaving(""); }
  }

  async function createItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const stock = optionalQuantity(String(values.get("quantity") ?? ""), "Starting quantity");
    const reorderThreshold = optionalQuantity(String(values.get("reorderThreshold") ?? ""), "Reorder level");
    const unitCostMinor = amountInMinor(String(values.get("unitCost") ?? ""));
    await submitAction("item", async () => {
      await api("/inventory", body({
        name: String(values.get("name") ?? "").trim(),
        sku: String(values.get("sku") ?? "").trim() || undefined,
        unit: String(values.get("unit") ?? "").trim() || "unit",
        quantity: stock,
        reorderThreshold,
        locationId: String(values.get("locationId") ?? "") || undefined,
        unitCostMinor,
      }));
      setNewItem(false);
    }, "Inventory item added.");
  }

  async function createVendor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await submitAction("vendor", async () => {
      await api("/vendors", body({
        name: String(values.get("name") ?? "").trim(),
        contactName: String(values.get("contactName") ?? "").trim() || undefined,
        email: String(values.get("email") ?? "").trim(),
        phone: String(values.get("phone") ?? "").trim() || undefined,
        website: String(values.get("website") ?? "").trim(),
        address: String(values.get("address") ?? "").trim() || undefined,
        accountReference: String(values.get("accountReference") ?? "").trim() || undefined,
      }));
      setNewVendor(false);
    }, "Vendor added.");
  }

  async function createOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lines: Array<{ inventoryItemId: string; quantity: string; unitCostMinor?: number }> = [];
    for (const row of orderDraftRows(event.currentTarget)) {
      if (!row.inventoryItemId) continue;
      lines.push({ inventoryItemId: row.inventoryItemId, quantity: quantity(row.quantity), unitCostMinor: amountInMinor(row.unitCost) });
    }
    if (!lines.length) throw new Error("Add at least one item to the purchase order.");
    await submitAction("order", async () => {
      await api("/purchase-orders", body({
        vendorId: String(form.get("vendorId") ?? ""),
        locationId: String(form.get("locationId") ?? "") || undefined,
        expectedAt: String(form.get("expectedAt") ?? "") || undefined,
        status: "ordered",
        notes: String(form.get("notes") ?? "").trim() || undefined,
        lines,
      }));
      setNewOrder(false);
    }, "Purchase order created.");
  }

  async function receiveOrder(event: React.FormEvent<HTMLFormElement>, order: PurchaseOrder): Promise<boolean> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lines = order.items.flatMap((line) => {
      const value = String(form.get(`receive-${line.id}`) ?? "").trim();
      return value ? [{ purchaseOrderItemId: line.id, quantity: quantity(value, "Receive quantity") }] : [];
    });
    if (!lines.length) throw new Error("Enter a quantity for at least one purchase order item.");
      return await submitAction(`receive-order-${order.id}`, async () => {
        await api(`/purchase-orders/${order.id}/receive`, body({ lines }));
      }, `${order.orderNumber} receipt recorded.`);
  }

  if (loading) return <Loading label="Loading inventory and supplies…"/>;

  return <section className="stack" aria-label="Inventory operations">
    {loadError && <Notice kind="error" text={loadError}/>}
    {error && <Notice kind="error" text={error} onClose={() => setError("")}/>}
    {notice && <Notice kind="success" text={notice} onClose={() => setNotice("")}/>}

    <section className="card card-pad" aria-labelledby="inventory-stock-title">
      <div className="card-heading"><div><div className="eyebrow">Supplies</div><h2 id="inventory-stock-title">Stock on hand</h2></div><button className="btn btn-primary btn-sm" type="button" onClick={() => setNewItem((open) => !open)}>{newItem ? "Close" : "Add inventory item"}</button></div>
      <p className="subtle" style={{ fontSize: ".86rem", marginTop: 0 }}>Track supplies across your branches and team vehicles. Receipts, transfers, and job usage keep the balances current.</p>
      {newItem && <form className="card card-pad" style={{ marginBottom: 16 }} onSubmit={createItem}>
        <h3 style={{ marginTop: 0 }}>Add an item</h3>
        <div className="form-grid">
          <div className="field"><label htmlFor="inventory-name">Item name</label><input id="inventory-name" name="name" minLength={2} maxLength={160} required/></div>
          <div className="field"><label htmlFor="inventory-sku">SKU</label><input id="inventory-sku" name="sku" maxLength={100}/></div>
          <div className="field"><label htmlFor="inventory-unit">How it is counted</label><input id="inventory-unit" name="unit" defaultValue="unit" maxLength={40} required/><small>For example: bag, bottle, or roll.</small></div>
          <div className="field"><label htmlFor="inventory-location">Starting branch</label><select id="inventory-location" name="locationId" required disabled={!activeLocations.length}><option value="">Choose a branch</option>{activeLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div>
          <div className="field"><label htmlFor="inventory-quantity">Starting quantity</label><input id="inventory-quantity" name="quantity" type="number" min="0" step="0.0001" defaultValue="0"/><small>Use zero if you will receive stock later.</small></div>
          <div className="field"><label htmlFor="inventory-reorder">Low-stock reminder at</label><input id="inventory-reorder" name="reorderThreshold" type="number" min="0" step="0.0001" placeholder="Optional"/></div>
          <div className="field"><label htmlFor="inventory-cost">Unit cost</label><input id="inventory-cost" name="unitCost" type="number" min="0" step="0.01" placeholder="Optional"/></div>
        </div>
        {!activeLocations.length && <Notice kind="error" text="No active branch is available to hold stock."/>}
        <div className="modal-footer"><button className="btn btn-secondary" type="button" onClick={() => setNewItem(false)}>Cancel</button><button className="btn btn-primary" type="submit" disabled={saving === "item" || !activeLocations.length}>{saving === "item" ? "Saving…" : "Add item"}</button></div>
      </form>}
      {data.items.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Item</th><th>Stock across locations</th><th>Low-stock level</th><th>Status</th><th>Actions</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}>
        <td><strong className="table-primary">{item.name}</strong><span className="table-secondary">{item.sku || `Counted by ${item.unit || "unit"}`}</span></td>
        <td>{Number(item.quantity).toLocaleString()} {item.unit || "unit"}<div className="table-secondary">{(item.locations ?? []).map((stock) => `${stock.locationName}: ${stock.quantity}`).join(" · ") || "No stock locations yet"}</div></td>
        <td>{item.locations?.some((stock) => stock.reorderThreshold != null) ? item.locations.filter((stock) => stock.reorderThreshold != null).map((stock) => `${stock.locationName}: ${stock.reorderThreshold}`).join(" · ") : "Not set"}</td>
        <td><Badge status={item.status}/></td>
        <td><div className="inline-actions"><button className="btn btn-secondary btn-sm" type="button" onClick={() => { setReceiveItem(item.id); setTransferItem(""); setConsumeItem(""); }}>Receive</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => { setTransferItem(item.id); setReceiveItem(""); setConsumeItem(""); }}>Transfer</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => { setConsumeItem(item.id); setReceiveItem(""); setTransferItem(""); }}>Use on job</button></div></td>
      </tr>)}</tbody></table></div> : <Empty title="No inventory items yet" description="Add your first supply to start tracking stock by branch and team vehicle."/>}
    </section>

    {receiveItem && <MovementForm key={`receive-${receiveItem}`} kind="receive" item={activeItems.find((item) => item.id === receiveItem)} locations={activeLocations} staff={technicians} jobs={usableJobs} saving={saving === "movement"} onClose={() => setReceiveItem("")} onSubmit={async (payload) => { await submitAction("movement", async () => { await api(`/inventory/${receiveItem}/receive`, body(payload)); setReceiveItem(""); }, "Stock received."); }}/>}
    {transferItem && <MovementForm key={`transfer-${transferItem}`} kind="transfer" item={activeItems.find((item) => item.id === transferItem)} locations={activeLocations} staff={technicians} jobs={usableJobs} saving={saving === "movement"} onClose={() => setTransferItem("")} onSubmit={async (payload) => { await submitAction("movement", async () => { await api(`/inventory/${transferItem}/transfer`, body(payload)); setTransferItem(""); }, "Stock transfer recorded."); }}/>}
    {consumeItem && <MovementForm key={`consume-${consumeItem}`} kind="consume" item={activeItems.find((item) => item.id === consumeItem)} locations={activeLocations} staff={technicians} jobs={usableJobs} saving={saving === "movement"} onClose={() => setConsumeItem("")} onSubmit={async (payload) => { await submitAction("movement", async () => { await api(`/inventory/${consumeItem}/consume`, body(payload)); setConsumeItem(""); }, "Material usage recorded on the job."); }}/>}

    <section className="two-col">
      <section className="card card-pad" aria-labelledby="inventory-vendors-title">
        <div className="card-heading"><div><div className="eyebrow">Suppliers</div><h2 id="inventory-vendors-title">Vendors</h2></div><button className="btn btn-secondary btn-sm" type="button" onClick={() => setNewVendor((open) => !open)}>{newVendor ? "Close" : "Add vendor"}</button></div>
        {newVendor && <form className="stack" style={{ marginBottom: 16 }} onSubmit={createVendor}><div className="form-grid">
          <div className="field"><label htmlFor="vendor-name">Vendor name</label><input id="vendor-name" name="name" minLength={2} maxLength={160} required/></div>
          <div className="field"><label htmlFor="vendor-contact">Contact name</label><input id="vendor-contact" name="contactName" maxLength={120}/></div>
          <div className="field"><label htmlFor="vendor-email">Email</label><input id="vendor-email" name="email" type="email"/></div>
          <div className="field"><label htmlFor="vendor-phone">Phone</label><input id="vendor-phone" name="phone" type="tel"/></div>
          <div className="field"><label htmlFor="vendor-website">Website</label><input id="vendor-website" name="website" type="url" placeholder="https://"/></div>
          <div className="field"><label htmlFor="vendor-address">Address</label><input id="vendor-address" name="address" maxLength={500}/></div>
          <div className="field"><label htmlFor="vendor-reference">Account reference</label><input id="vendor-reference" name="accountReference" maxLength={160}/></div>
        </div><div className="inline-actions"><button className="btn btn-secondary btn-sm" type="button" onClick={() => setNewVendor(false)}>Cancel</button><button className="btn btn-primary btn-sm" type="submit" disabled={saving === "vendor"}>{saving === "vendor" ? "Saving…" : "Save vendor"}</button></div></form>}
        {data.vendors.length ? <div className="stack" style={{ gap: 4 }}>{data.vendors.map((vendor) => <div className="action-item" key={vendor.id}><div className="action-icon">{vendor.name.slice(0, 1)}</div><div style={{ flex: 1 }}><strong>{vendor.name}</strong><p>{[vendor.contactName, vendor.email, vendor.phone].filter(Boolean).join(" · ") || "No contact details"}</p></div><Badge status={vendor.status}/></div>)}</div> : <p className="subtle" style={{ fontSize: ".86rem" }}>Add suppliers here so the team can keep purchase orders together.</p>}
      </section>

      <section className="card card-pad" aria-labelledby="inventory-po-title">
        <div className="card-heading"><div><div className="eyebrow">Ordering</div><h2 id="inventory-po-title">Purchase orders</h2></div><button className="btn btn-primary btn-sm" type="button" onClick={() => setNewOrder((open) => !open)} disabled={!data.vendors.length || !activeItems.length || !activeLocations.length}>{newOrder ? "Close" : "New order"}</button></div>
        {(!data.vendors.length || !activeItems.length || !activeLocations.length) && <p className="subtle" style={{ fontSize: ".83rem" }}>Add a vendor, inventory item, and active branch before creating an order.</p>}
        {newOrder && <PurchaseOrderEditor vendors={data.vendors.filter((vendor) => vendor.status !== "inactive")} items={activeItems} locations={activeLocations} saving={saving === "order"} onCancel={() => setNewOrder(false)} onSubmit={createOrder}/>}
        {openOrders.length ? <div className="stack" style={{ marginTop: 14 }}>{openOrders.map((order) => <PurchaseOrderCard key={order.id} order={order} saving={saving === `receive-order-${order.id}`} onReceive={(event) => receiveOrder(event, order)}/>)}</div> : <p className="subtle" style={{ fontSize: ".86rem" }}>Open orders will appear here. Fully received orders remain available in order history.</p>}
        {data.orders.filter((order) => !["ordered", "partially_received"].includes(order.status)).length > 0 && <details style={{ marginTop: 12 }}><summary className="link">Show completed and draft orders</summary><div className="stack" style={{ marginTop: 12 }}>{data.orders.filter((order) => !["ordered", "partially_received"].includes(order.status)).map((order) => <div className="action-item" key={order.id}><div><strong>{order.orderNumber} · {order.vendorName}</strong><p>{order.locationName} · {inputDate(order.expectedAt)}</p></div><Badge status={order.status}/><strong>{money(Number(order.totalMinor), order.currency || "USD")}</strong></div>)}</div></details>}
      </section>
    </section>
  </section>;
}

function orderDraftRows(form: HTMLFormElement): OrderDraftLine[] {
  return Array.from(form.querySelectorAll<HTMLElement>("[data-order-line]")).map((row) => ({
    inventoryItemId: (row.querySelector<HTMLInputElement | HTMLSelectElement>("[name='inventoryItemId']")?.value ?? "").trim(),
    quantity: (row.querySelector<HTMLInputElement>("[name='quantity']")?.value ?? "").trim(),
    unitCost: (row.querySelector<HTMLInputElement>("[name='unitCost']")?.value ?? "").trim(),
  }));
}

function MovementForm({ kind, item, locations, staff, jobs, saving, onClose, onSubmit }: {
  kind: "receive" | "transfer" | "consume";
  item?: InventoryItem;
  locations: BusinessLocation[];
  staff: StaffMember[];
  jobs: Job[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [formError, setFormError] = useState("");
  if (!item) return <Notice kind="error" text="This item is no longer active. Refresh inventory and try again."/>;
  const stockLocations = item.locations ?? [];
  const title = kind === "receive" ? "Receive stock" : kind === "transfer" ? "Transfer stock" : "Record material used";
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError("");
    const values = new FormData(event.currentTarget);
    try {
      const stockQuantity = quantity(String(values.get("quantity") ?? ""));
      const locationId = String(values.get("locationId") ?? "");
      const reason = String(values.get("reason") ?? "").trim() || undefined;
      const payload: Record<string, unknown> = { quantity: stockQuantity, reason };
      if (kind === "receive") {
        payload.locationId = locationId;
        payload.unitCostMinor = amountInMinor(String(values.get("unitCost") ?? ""));
      } else {
        payload.inventoryLocationId = locationId;
      }
      if (kind === "transfer") {
        const destination = String(values.get("destination") ?? "");
        if (destination.startsWith("member:")) payload.toMembershipId = destination.slice("member:".length);
        else if (destination.startsWith("branch:")) payload.toLocationId = destination.slice("branch:".length);
        else throw new Error("Choose where the stock is going.");
      }
      if (kind === "consume") payload.jobId = String(values.get("jobId") ?? "");
      await onSubmit(payload);
    } catch (issue) { setFormError(errorText(issue)); }
  }
  return <section className="card card-pad" aria-label={title}>
    <div className="card-heading"><div><div className="eyebrow">{item.name}</div><h2>{title}</h2></div><button className="btn btn-secondary btn-sm" type="button" onClick={onClose}>Cancel</button></div>
    <form onSubmit={submit}><div className="form-grid">
      <div className="field"><label htmlFor={`movement-quantity-${kind}`}>Quantity ({item.unit || "unit"})</label><input id={`movement-quantity-${kind}`} name="quantity" type="number" min="0.0001" step="0.0001" required/></div>
      {kind === "receive" && <div className="field"><label htmlFor="movement-location-receive">Receive at branch</label><select id="movement-location-receive" name="locationId" required><option value="">Choose a branch</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div>}
      {kind !== "receive" && <div className="field"><label htmlFor={`movement-source-${kind}`}>Take stock from</label><select id={`movement-source-${kind}`} name="locationId" required><option value="">Choose a stock location</option>{stockLocations.filter((location) => Number(location.quantity) > 0).map((location) => <option key={location.locationId} value={location.locationId}>{location.locationName} · {location.quantity} available</option>)}</select></div>}
      {kind === "transfer" && <div className="field"><label htmlFor="movement-destination">Send stock to</label><select id="movement-destination" name="destination" required><option value="">Choose a destination</option><optgroup label="Branches">{locations.map((location) => <option key={location.id} value={`branch:${location.id}`}>{location.name}</option>)}</optgroup><optgroup label="Technicians / vehicles">{staff.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.name}</option>)}</optgroup></select></div>}
      {kind === "consume" && <div className="field"><label htmlFor="movement-job">Job</label><select id="movement-job" name="jobId" required><option value="">Choose the job</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.customerName || "Customer"} · {job.serviceName || "Service"}{job.scheduledDate ? ` · ${job.scheduledDate}` : ""} · ${friendly(job.status)}</option>)}</select></div>}
      {kind === "receive" && <div className="field"><label htmlFor="movement-unit-cost">Unit cost</label><input id="movement-unit-cost" name="unitCost" type="number" min="0" step="0.01" placeholder="Optional"/></div>}
      <div className="field full"><label htmlFor={`movement-reason-${kind}`}>{kind === "consume" ? "Notes (optional)" : "Reason (optional)"}</label><input id={`movement-reason-${kind}`} name="reason" maxLength={500} placeholder={kind === "receive" ? "For example, delivery reference" : kind === "transfer" ? "For example, restock vehicle" : "For example, materials used during service"}/></div>
    </div>{formError && <div style={{ marginTop: 14 }}><Notice kind="error" text={formError}/></div>}<div className="modal-footer"><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : title}</button></div></form>
  </section>;
}

function PurchaseOrderEditor({ vendors, items, locations, saving, onCancel, onSubmit }: {
  vendors: Vendor[];
  items: InventoryItem[];
  locations: BusinessLocation[];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const [rowCount, setRowCount] = useState(1);
  const [formError, setFormError] = useState("");
  return <form className="card card-pad" onSubmit={(event) => { event.preventDefault(); setFormError(""); onSubmit(event).catch((issue) => setFormError(errorText(issue))); }}>
    <h3 style={{ marginTop: 0 }}>New purchase order</h3>
    <div className="form-grid">
      <div className="field"><label htmlFor="po-vendor">Vendor</label><select id="po-vendor" name="vendorId" required><option value="">Choose a vendor</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></div>
      <div className="field"><label htmlFor="po-location">Deliver to branch</label><select id="po-location" name="locationId" required><option value="">Choose a branch</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div>
      <div className="field"><label htmlFor="po-expected">Expected delivery</label><input id="po-expected" type="date" name="expectedAt"/></div>
      <div className="field full"><label htmlFor="po-notes">Notes for this order</label><textarea id="po-notes" name="notes" maxLength={2000}/></div>
    </div>
    <h4>Items</h4>
    <div className="stack" style={{ gap: 10 }}>{Array.from({ length: rowCount }, (_, index) => <div className="form-grid" data-order-line key={index}>
      <div className="field"><label htmlFor={`po-item-${index}`}>Inventory item</label><select id={`po-item-${index}`} name="inventoryItemId" required={index === 0}><option value="">Choose an item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}{item.sku ? ` · ${item.sku}` : ""}</option>)}</select></div>
      <div className="field"><label htmlFor={`po-quantity-${index}`}>Quantity</label><input id={`po-quantity-${index}`} name="quantity" type="number" min="0.0001" step="0.0001" required={index === 0}/></div>
      <div className="field"><label htmlFor={`po-cost-${index}`}>Unit cost</label><input id={`po-cost-${index}`} name="unitCost" type="number" min="0" step="0.01" placeholder="Use saved cost"/></div>
    </div>)}</div>
    <div className="inline-actions" style={{ marginTop: 12 }}><button className="btn btn-secondary btn-sm" type="button" onClick={() => setRowCount((count) => count + 1)}>Add another item</button>{rowCount > 1 && <button className="btn btn-secondary btn-sm" type="button" onClick={() => setRowCount((count) => count - 1)}>Remove last row</button>}</div>
    {formError && <div style={{ marginTop: 14 }}><Notice kind="error" text={formError}/></div>}
    <div className="modal-footer"><button className="btn btn-secondary" type="button" onClick={onCancel}>Cancel</button><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Create purchase order"}</button></div>
  </form>;
}

function PurchaseOrderCard({ order, saving, onReceive }: { order: PurchaseOrder; saving: boolean; onReceive: (event: React.FormEvent<HTMLFormElement>) => Promise<boolean> }) {
  const [formError, setFormError] = useState("");
  const [receiving, setReceiving] = useState(false);
  return <article className="card card-pad">
    <div className="card-heading"><div><strong>{order.orderNumber}</strong><p className="subtle" style={{ margin: "4px 0 0", fontSize: ".83rem" }}>{order.vendorName} · {order.locationName} · expected {inputDate(order.expectedAt)}</p></div><div style={{ textAlign: "right" }}><Badge status={order.status}/><div style={{ marginTop: 6 }}><strong>{money(Number(order.totalMinor), order.currency || "USD")}</strong></div></div></div>
    <div className="stack" style={{ gap: 4 }}>{order.items.map((line) => <div className="action-item" key={line.id}><div style={{ flex: 1 }}><strong>{line.inventoryItemName}</strong><p>Ordered {line.quantityOrdered} · received {line.quantityReceived} · {money(Number(line.unitCostMinor), order.currency || "USD")} each</p></div><span>{remaining(line)} remaining</span></div>)}</div>
    <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} type="button" onClick={() => setReceiving((open) => !open)}>{receiving ? "Close receipt" : "Receive items"}</button>
    {receiving && <form className="stack" style={{ marginTop: 14 }} onSubmit={(event) => { event.preventDefault(); setFormError(""); onReceive(event).then((succeeded) => { if (succeeded) setReceiving(false); }).catch((issue) => setFormError(errorText(issue))); }}>
      <p className="subtle" style={{ fontSize: ".84rem", margin: 0 }}>Enter what arrived in this delivery. Leave lines blank when none arrived; received amounts cannot exceed the order.</p>
      {order.items.filter((line) => remaining(line) > 0).map((line) => <div className="form-grid" key={line.id}><div><strong>{line.inventoryItemName}</strong><p className="table-secondary">{remaining(line)} remaining</p></div><div className="field"><label htmlFor={`receive-${line.id}`}>Quantity received</label><input id={`receive-${line.id}`} name={`receive-${line.id}`} type="number" min="0.0001" max={remaining(line)} step="0.0001" placeholder="Not received"/></div></div>)}
      {!order.items.some((line) => remaining(line) > 0) && <p>All order items have been received.</p>}
      {formError && <Notice kind="error" text={formError}/>}
      <div className="inline-actions"><button className="btn btn-secondary btn-sm" type="button" onClick={() => setReceiving(false)}>Cancel</button><button className="btn btn-primary btn-sm" type="submit" disabled={saving || !order.items.some((line) => remaining(line) > 0)}>{saving ? "Recording…" : "Record delivery"}</button></div>
    </form>}
  </article>;
}
