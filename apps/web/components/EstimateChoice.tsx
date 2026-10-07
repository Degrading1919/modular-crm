"use client";
import { useState } from "react";
import { priceDocument, type DocumentLineInput } from "@modular-crm/domain";
import { api,body,money } from "./api";
import { MoneyTotals } from "./DocumentEditor";
import { Notice } from "./ui";
type Line = DocumentLineInput & {id:string};
export function EstimateChoice({estimate,onDone}:{estimate:Record<string,any>;onDone:()=>void}) {
  const [selected,setSelected]=useState<string[]>([]);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  const lines:Line[] = estimate.lines ?? [];
  let pricing,errorMessage="";
  try {if(estimate.pricing?.version===1) pricing=priceDocument(lines.filter(line=>!line.optional||selected.includes(line.id)).map(line=>({...line,quantity:String(line.quantity),unitAmountMinor:Number(line.unitAmountMinor),discountMinor:Number(line.discountMinor??0)})),estimate.pricing.taxRateBasisPoints,estimate.pricing.discount);}catch(cause){errorMessage=(cause as Error).message;}
  async function decide(choice:string){if(!window.confirm(`${choice==="approve"?"Approve":"Decline"} estimate ${estimate.number||""}?`))return;setBusy(true);setError("");try{await api(`/portal/estimates/${estimate.id}/${choice}`,body(choice==="approve"?{acceptedOptionalIds:selected}:{}));onDone();}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}
  return <><div className="stack">{lines.map(line=><div key={line.id}>{line.optional?<label><input type="checkbox" checked={selected.includes(line.id)} onChange={e=>setSelected(e.target.checked?[...selected,line.id]:selected.filter(id=>id!==line.id))}/> Optional add-on: {line.description}</label>:<strong>{line.description}</strong>}<p>{line.quantity} × {money(Number(line.unitAmountMinor),estimate.currency)}{line.taxable?" · Taxable":""}</p></div>)}</div>{pricing?<MoneyTotals pricing={pricing} currency={estimate.currency}/>:<strong>{money(estimate.totalCents,estimate.currency)}</strong>}{errorMessage&&<p>{errorMessage}</p>}{error&&<Notice kind="error" text={error}/ >}<div className="inline-actions"><button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>decide("decline")}>Decline</button><button type="button" className="btn btn-primary btn-sm" disabled={busy||!!errorMessage} onClick={()=>decide("approve")}>Approve estimate</button></div></>;
}
