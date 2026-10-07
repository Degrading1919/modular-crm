import { beforeAll,afterAll,expect,it,vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and,eq } from "drizzle-orm";
import { schema,seedDevelopment,seedIds,type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor";
const {getDbMock}=vi.hoisted(()=>({getDbMock:vi.fn()}));
vi.mock("../lib/db",()=>({getDb:getDbMock}));
process.env.DATABASE_URL??="postgres://localhost:5433/modular_crm_test";
const {handleRecords}=await import("../lib/api/records");
const {handleWorkflow}=await import("../lib/api/workflows");
const {handleSecureEstimateLink}=await import("../lib/api/secure-estimate-links");
const {getDocument}=await import("../lib/api/documents");
const {handlePortal}=await import("../lib/api/portal");
let pg:PGlite,db:Database;
const owner:SessionActor={kind:"staff",role:"owner",userId:"demo-happy-owner",tenantId:seedIds.happyTenant,tenantName:"Happy Yards",packKey:null,email:"owner@happyyards.test",name:"Owner",permissions:permissionsForRole("owner"),allLocations:true,locationIds:new Set([seedIds.augusta]),membershipId:seedIds.oliviaMembership,organizationId:seedIds.happyOrganization,defaultLocationId:seedIds.augusta};
const portal:SessionActor={kind:"customer",userId:"demo-happy-customer",tenantId:seedIds.happyTenant,tenantName:"Happy Yards",packKey:null,email:"customer@happyyards.test",name:"Customer",customerIds:new Set([seedIds.carter]),locationIds:new Set([seedIds.carterLocation]),customerLocationIds:new Map([[seedIds.carter,new Set([seedIds.carterLocation])]])};
const request=(path:string,data:unknown={},method="POST")=>new Request(`http://localhost/api/v1/${path}`,{method,headers:{"content-type":"application/json"},body:method==="GET"?undefined:JSON.stringify(data)});
const lines=[{description:"Cleanup",quantity:"2",unitAmountMinor:1000,taxable:true,discountMinor:100},{description:"Supplies",quantity:"1",unitAmountMinor:500,taxable:false},{description:"Optional upgrade",quantity:"1",unitAmountMinor:1000,taxable:true,optional:true}];
beforeAll(async()=>{pg=new PGlite();const raw=drizzle(pg,{schema});await migrate(raw,{migrationsFolder:fileURLToPath(new URL("../../../packages/db/drizzle",import.meta.url))});db=raw as unknown as Database;getDbMock.mockReturnValue(db);await seedDevelopment(db);},120_000);
afterAll(async()=>{await pg?.close();});
it("chooses optional lines, freezes approval, converts once and agrees with documents",async()=>{
  const created=await handleRecords(request("estimates",{customerId:seedIds.carter,title:"Itemized quote",lines,taxRateBasisPoints:750,discount:{type:"percent",value:1000}}),["estimates"],owner);
  expect(created!.status).toBe(201);const id=(await created!.json()).item.id;
  const [revision]=await db.select().from(schema.estimateRevisions).where(eq(schema.estimateRevisions.estimateId,id));
  const quotedItems=await db.select().from(schema.estimateItems).where(eq(schema.estimateItems.estimateRevisionId,revision!.id));
  const optional=quotedItems.find(line=>line.metadata.optional===true)!;
  await handleWorkflow(request(`estimates/${id}/send`),["estimates",id,"send"],owner);
  const [sentRevision]=await db.select().from(schema.estimateRevisions).where(eq(schema.estimateRevisions.id,revision!.id));
  await expect(handleWorkflow(request(`estimates/${id}/approve`),["estimates",id,"approve"],portal)).rejects.toMatchObject({status:422});
  await expect(handleWorkflow(request(`estimates/${id}/approve`,{acceptedOptionalIds:[crypto.randomUUID()]}),["estimates",id,"approve"],portal)).rejects.toMatchObject({status:422});
  const approved=await handleWorkflow(request(`estimates/${id}/approve`,{acceptedOptionalIds:[]}),["estimates",id,"approve"],portal);
  expect((await approved!.json()).item.totalMinor).toBe(2288);
  const [frozen]=await db.select().from(schema.estimateRevisions).where(eq(schema.estimateRevisions.id,revision!.id));expect(frozen).toEqual(sentRevision);
  const [approval]=await db.select().from(schema.estimateApprovals).where(eq(schema.estimateApprovals.estimateId,id));
  expect(approval!.pricingSnapshot).toMatchObject({subtotalMinor:2500,discountMinor:340,taxMinor:128,totalMinor:2288,items:[{description:"Cleanup"},{description:"Supplies"}]});
  expect((approval!.pricingSnapshot.items as unknown[])).toHaveLength(2);
  expect(optional).toBeDefined();
  await db.update(schema.organizations).set({settings:{defaultTaxRateBasisPoints:1000}}).where(eq(schema.organizations.id,seedIds.happyOrganization));
  const invoice=await handleWorkflow(request(`estimates/${id}/invoice`),["estimates",id,"invoice"],owner);expect(invoice!.status).toBe(201);const invoiceId=(await invoice!.json()).item.id;
  const retry=await handleWorkflow(request(`estimates/${id}/invoice`),["estimates",id,"invoice"],owner);expect(await retry!.json()).toMatchObject({duplicate:true,item:{id:invoiceId,totalMinor:2288}});
  expect(await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId,invoiceId))).toHaveLength(2);
  for(const kind of ["estimate","invoice"]) {const document=await getDocument(owner,kind,kind==="estimate"?id:invoiceId);expect(document.lines.map(line=>line.description)).toEqual(["Cleanup","Supplies"]);expect(Number(document.totals.find(total=>total.label==="Total")!.amountMinor)).toBe(2288);}
  await expect(handleWorkflow(request(`estimates/${id}/invoice`),["estimates",id,"invoice"],{...owner,permissions:new Set()} as SessionActor)).rejects.toMatchObject({status:403});
  await expect(handleWorkflow(request(`estimates/${id}/invoice`),["estimates",id,"invoice"],{...owner,allLocations:false,locationIds:new Set([seedIds.northAugusta])} as SessionActor)).rejects.toMatchObject({status:404});
});
it("edits all draft lines with optimistic locking and rejects issued changes, wrong scope and catalog identity",async()=>{
  const created=await handleRecords(request("invoices",{customerId:seedIds.carter,description:"Draft lines",lines:lines.slice(0,2),taxRateBasisPoints:750}),["invoices"],owner);const invoice=(await created!.json()).item;
  const revised=await handleRecords(request(`invoices/${invoice.id}`,{description:"Reordered",lines:[lines[1],lines[0]],taxRateBasisPoints:750,dueDate:null,expectedUpdatedAt:invoice.updatedAt},"PATCH"),["invoices",invoice.id],owner);
  expect(revised!.status).toBe(200);
  expect((await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId,invoice.id)).orderBy(schema.invoiceItems.sortOrder)).map(line=>line.description)).toEqual(["Supplies","Cleanup"]);
  await expect(handleRecords(request(`invoices/${invoice.id}`,{description:"Stale",lines:lines.slice(0,1),dueDate:null,expectedUpdatedAt:invoice.updatedAt},"PATCH"),["invoices",invoice.id],owner)).rejects.toMatchObject({status:409});
  await handleWorkflow(request(`invoices/${invoice.id}/issue`),["invoices",invoice.id,"issue"],owner);
  const [current]=await db.select().from(schema.invoices).where(eq(schema.invoices.id,invoice.id));
  await expect(handleRecords(request(`invoices/${invoice.id}`,{description:"Issued change",lines:lines.slice(0,1),dueDate:null,expectedUpdatedAt:current!.updatedAt.toISOString()},"PATCH"),["invoices",invoice.id],owner)).rejects.toMatchObject({status:409});
  await expect(handleRecords(request("invoices",{customerId:seedIds.riverfront,description:"Outside branch",lines:lines.slice(0,2)}),["invoices"],{...owner,allLocations:false,locationIds:new Set([seedIds.augusta])} as SessionActor)).rejects.toMatchObject({status:404});
  await expect(handleRecords(request("invoices",{customerId:seedIds.carter,description:"Unknown catalog",lines:[{...lines[0],serviceId:crypto.randomUUID()}]}),["invoices"],owner)).rejects.toMatchObject({status:404});
});
it("secure link includes optional choices and rejects changed-choice replay without duplicate effects",async()=>{
  const created=await handleRecords(request("estimates",{customerId:seedIds.carter,title:"Secure choices",lines,taxRateBasisPoints:750}),["estimates"],owner);const id=(await created!.json()).item.id;
  const sent=await handleWorkflow(request(`estimates/${id}/send`),["estimates",id,"send"],owner);const token=(await sent!.json()).actionUrl.split("/").at(-1);
  const path=["public","estimate-links",token];const publicView=await handleSecureEstimateLink(request(path.join("/"),{},"GET"),path);const view=(await publicView!.json()).item;
  const optional=view.items.find((line:{optional:boolean})=>line.optional);expect(optional).toMatchObject({description:"Optional upgrade",optional:true});
  const first=await handleSecureEstimateLink(request([...path,"approve"].join("/"),{acceptedOptionalIds:[optional.id]}),[...path,"approve"]);expect(first!.status).toBe(200);
  expect((await (await handleSecureEstimateLink(request([...path,"approve"].join("/"),{acceptedOptionalIds:[optional.id]}),[...path,"approve"]))!.json()).duplicate).toBe(true);
  await expect(handleSecureEstimateLink(request([...path,"approve"].join("/"),{acceptedOptionalIds:[]}),[...path,"approve"])).rejects.toMatchObject({status:409});
  expect(await db.select().from(schema.estimateApprovals).where(and(eq(schema.estimateApprovals.estimateId,id),eq(schema.estimateApprovals.decision,"approved")))).toHaveLength(1);
});
it("shows branch-wide estimates only when every property is granted, while retaining tenant and branch isolation",async()=>{
  const response=await handleRecords(request("estimates",{customerId:seedIds.carter,title:"Portal branch scope",lines:lines.slice(0,2)}),["estimates"],owner);const id=(await response!.json()).item.id;
  await handleWorkflow(request(`estimates/${id}/send`),["estimates",id,"send"],owner);
  const list=await handlePortal(request("portal/estimates",{},"GET"),["portal","estimates"],portal);expect((await list!.json()).items.map((item:{id:string})=>item.id)).toContain(id);
  const [hidden]=await db.insert(schema.serviceLocations).values({tenantId:owner.tenantId,customerId:seedIds.carter,organizationLocationId:seedIds.augusta,name:"Unshared property",addressLine1:"9 Private Lane",city:"",region:"",postalCode:""}).returning();
  try {
    const denied=await handlePortal(request("portal/estimates",{},"GET"),["portal","estimates"],portal);expect((await denied!.json()).items.map((item:{id:string})=>item.id)).not.toContain(id);
    await expect(handleWorkflow(request(`estimates/${id}/approve`,{acceptedOptionalIds:[]}),["estimates",id,"approve"],portal)).rejects.toMatchObject({status:404});
  }finally{await db.delete(schema.serviceLocations).where(eq(schema.serviceLocations.id,hidden!.id));}
  await db.update(schema.estimates).set({organizationLocationId:seedIds.northAugusta}).where(eq(schema.estimates.id,id));
  const outside=await handlePortal(request("portal/estimates",{},"GET"),["portal","estimates"],portal);expect((await outside!.json()).items.map((item:{id:string})=>item.id)).not.toContain(id);
  const otherTenant={...portal,tenantId:seedIds.cleanTenant};const isolated=await handlePortal(request("portal/estimates",{},"GET"),["portal","estimates"],otherTenant);expect((await isolated!.json()).items.map((item:{id:string})=>item.id)).not.toContain(id);
});
it("uses the selected customer's business tax default without exposing another tenant or unauthorized branch",async()=>{
  const [org]=await db.select().from(schema.organizations).where(eq(schema.organizations.id,seedIds.franchiseEastOrganization));
  await db.update(schema.organizations).set({settings:{...org!.settings,defaultTaxRateBasisPoints:650}}).where(eq(schema.organizations.id,org!.id));
  const [customer]=await db.insert(schema.customers).values({tenantId:owner.tenantId,organizationId:seedIds.franchiseEastOrganization,owningLocationId:seedIds.franchiseEastLocation,displayName:"Child business tax fixture"}).returning();
  const path=["billing","defaults"],url=`billing/defaults?customerId=${customer!.id}`;
  try {
    const response=await handleWorkflow(request(url,{},"GET"),path,owner);expect(await response!.json()).toMatchObject({item:{defaultTaxRateBasisPoints:650}});
    await expect(handleWorkflow(request(url,{},"GET"),path,{...owner,allLocations:false,locationIds:new Set([seedIds.augusta])} as SessionActor)).rejects.toMatchObject({status:404});
    await expect(handleWorkflow(request(url,{},"GET"),path,{...owner,tenantId:seedIds.cleanTenant})).rejects.toMatchObject({status:404});
    await expect(handleWorkflow(request(url,{},"GET"),path,{...owner,permissions:new Set()} as SessionActor)).rejects.toMatchObject({status:403});
  }finally{await db.update(schema.organizations).set({settings:org!.settings}).where(eq(schema.organizations.id,org!.id));await db.delete(schema.customers).where(eq(schema.customers.id,customer!.id));}
});
