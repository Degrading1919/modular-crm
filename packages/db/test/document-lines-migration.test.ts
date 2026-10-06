import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect,it } from "vitest";

it("upgrades the real prior schema without changing existing untaxed totals or duplicating lines",async()=>{
  const pg=new PGlite();
  try {
    const folder=new URL("../drizzle/",import.meta.url);
    const journal=JSON.parse(await readFile(new URL("meta/_journal.json",folder),"utf8")) as {entries:{idx:number;tag:string}[]};
    for(const entry of journal.entries.filter(item=>item.idx<17)) await pg.exec(await readFile(new URL(`${entry.tag}.sql`,folder),"utf8"));
    const tenant=crypto.randomUUID(),org=crypto.randomUUID(),customer=crypto.randomUUID(),invoice=crypto.randomUUID(),estimate=crypto.randomUUID(),revision=crypto.randomUUID();
    await pg.query("insert into tenants (id,name,slug,status) values ($1,'Historical business',$2,'active')",[tenant,tenant]);
    await pg.query("insert into organizations (id,tenant_id,legal_name,display_name,organization_type) values ($1,$2,'Historical business','Historical business','business')",[org,tenant]);
    await pg.query("insert into customers (id,tenant_id,organization_id,display_name) values ($1,$2,$3,'Customer')",[customer,tenant,org]);
    await pg.query("insert into invoices (id,tenant_id,organization_id,customer_id,status,invoice_number,subtotal_minor,total_minor,balance_minor) values ($1,$2,$3,$4,'issued','LEGACY',12345,12345,12345)",[invoice,tenant,org,customer]);
    await pg.query("insert into estimates (id,tenant_id,customer_id,status,total_minor) values ($1,$2,$3,'approved',6789)",[estimate,tenant,customer]);
    await pg.query("insert into estimate_revisions (id,tenant_id,estimate_id,revision_number,subtotal_minor,total_minor,snapshot) values ($1,$2,$3,1,6789,6789,'{\"title\":\"Historical quote\"}')",[revision,tenant,estimate]);
    await pg.query("insert into estimate_items (tenant_id,estimate_revision_id,description,quantity,unit_amount_minor,total_minor) values ($1,$2,'Historical quote',1,6789,6789)",[tenant,revision]);
    await pg.query("insert into estimate_approvals (tenant_id,estimate_id,estimate_revision_id,decision,actor_type) values ($1,$2,$3,'approved','staff')",[tenant,estimate,revision]);
    const before=(await pg.query("select total_minor,balance_minor,tax_minor from invoices where id=$1",[invoice])).rows;
    await pg.exec(await readFile(fileURLToPath(new URL("0017_rich_rachel_grey.sql",folder)),"utf8"));
    expect((await pg.query("select total_minor,balance_minor,tax_minor from invoices where id=$1",[invoice])).rows).toEqual(before);
    const invoiceLines=(await pg.query("select quantity,unit_amount_minor,total_minor,tax_minor from invoice_items where invoice_id=$1",[invoice])).rows;
    expect(invoiceLines).toHaveLength(1);expect(invoiceLines[0]).toMatchObject({quantity:"1.0000",unit_amount_minor:12345,total_minor:12345,tax_minor:0});
    expect((await pg.query("select * from estimate_items where estimate_revision_id=$1",[revision])).rows).toHaveLength(1);
    const approved=(await pg.query<{pricing_snapshot:Record<string,unknown>}>("select pricing_snapshot from estimate_approvals where estimate_id=$1",[estimate])).rows[0]!.pricing_snapshot;
    expect(approved).toMatchObject({subtotalMinor:6789,taxMinor:0,totalMinor:6789,items:[{description:"Historical quote",unitAmountMinor:6789,totalMinor:6789,taxable:false}]});
  }finally{await pg.close();}
},120_000);
