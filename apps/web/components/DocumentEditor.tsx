"use client";
import { useEffect, useState } from "react";
import { priceDocument, type DocumentDiscount, type DocumentLineInput, type DocumentPricing } from "@modular-crm/domain";
import { api, body, money, patch } from "./api";
import { Modal, Notice, useResource } from "./ui";
import SearchPicker, { type PickerRecord } from "./SearchPicker";

const emptyLine = (): DocumentLineInput => ({description:"",quantity:"1",unitAmountMinor:Number.NaN,discountMinor:0,taxable:false,optional:false});
export function MoneyTotals({pricing,currency="USD"}:{pricing:Pick<DocumentPricing,"subtotalMinor"|"discountMinor"|"taxMinor"|"totalMinor">;currency?:string}) {
  return <dl className="record-facts" aria-label="Price breakdown">{[["Subtotal",pricing.subtotalMinor],["Discount",-pricing.discountMinor],["Tax",pricing.taxMinor],["Total",pricing.totalMinor]].map(([label,value])=><div className="detail-list" key={String(label)}><dt>{label}</dt><dd>{money(Number(value),currency)}</dd></div>)}</dl>;
}
export function DocumentEditor({kind,record,onClose,onSaved}:{kind:"estimate"|"invoice";record?:Record<string,any>;onClose:()=>void;onSaved:(item:Record<string,any>&{id:string})=>void}) {
  const revision=record?.currentRevisionData;
  const initialPricing=revision?.pricing ?? record?.billingSnapshot;
  const initialLines=revision?.items ?? record?.lines;
  const [lines,setLines]=useState<DocumentLineInput[]>(()=>initialLines?.length ? initialLines.map((line:Record<string,any>)=>({description:line.description,quantity:String(line.quantity),unitAmountMinor:Number(line.unitAmountMinor ?? line.unitCents),discountMinor:Number(line.metadata?.lineDiscountMinor ?? line.discountMinor ?? 0),serviceId:line.serviceId,taxable:line.metadata?.taxable===true,optional:line.metadata?.optional===true,charge:line.metadata?.charge})) : [emptyLine()]);
  const primaryServiceId=lines.find(line=>line.serviceId)?.serviceId;
  const [serviceTypes,setServiceTypes]=useState<Record<string,string>>(()=>Object.fromEntries((initialLines??[]).filter((line:Record<string,any>)=>line.serviceId&&line.serviceType).map((line:Record<string,any>)=>[line.serviceId,line.serviceType])));
  const recurring=!!primaryServiceId&&serviceTypes[primaryServiceId]==="recurring";
  const [title,setTitle]=useState(revision?.title ?? record?.billingSnapshot?.description ?? "");
  const [notes,setNotes]=useState(revision?.notes ?? "");
  const [dueDate,setDueDate]=useState(String(record?.dueDate ?? "").slice(0,10));
  const [tax,setTax]=useState(initialPricing?.taxRateBasisPoints ?? 0);
  const [discount,setDiscount]=useState<DocumentDiscount>(initialPricing?.discount ?? {type:"amount",value:0});
  const [customer,setCustomer]=useState<PickerRecord|null>(null);
  const [error,setError]=useState("");const [saving,setSaving]=useState(false);
  const defaults=useResource<{item:{defaultTaxRateBasisPoints:number}}>(!record ? `/billing/defaults${customer ? `?customerId=${customer.id}` : ""}` : null,{item:{defaultTaxRateBasisPoints:0}});
  useEffect(()=>{if(!record && !defaults.loading && !defaults.error) setTax(defaults.data.item.defaultTaxRateBasisPoints);},[record,defaults.loading,defaults.error,defaults.data.item.defaultTaxRateBasisPoints]);
  let pricing:DocumentPricing|undefined,pricingError="";
  try {pricing=priceDocument(lines,tax,discount);}catch(cause){pricingError=(cause as Error).message;}
  function change(index:number,key:keyof DocumentLineInput,value:unknown){setLines(previous=>previous.map((line,i)=>i===index?{...line,[key]:value}:line));}
  function move(index:number,direction:number){setLines(previous=>{const updated=[...previous];[updated[index],updated[index+direction]]=[updated[index+direction]!,updated[index]!];return updated;});}
  async function submit(event:React.FormEvent){event.preventDefault();setError("");if(!pricing){setError(pricingError);return;}if(!record && !customer){setError("Choose a customer.");return;}setSaving(true);try{
    const payload={lines:lines.map(line=>({...line,...(kind==="estimate"?{charge:line.charge ?? (recurring?"every_visit":"once")}:{})})),taxRateBasisPoints:tax,discount,...(kind==="estimate"?{title,notes}:{description:title,dueDate:dueDate||null}),...(!record?{customerId:customer!.id}:kind==="invoice"?{expectedUpdatedAt:record.updatedAt}:{})};
    const created=await api<{item:Record<string,any>&{id:string}}>(`/${kind}s${record?`/${record.id}`:""}`,record?patch(payload):body({...payload,...(kind==="invoice"&&!dueDate?{dueDate:undefined}:{})}));onSaved(created.item);
  }catch(cause){setError((cause as Error).message);}finally{setSaving(false);}}
  return <Modal title={record?kind==="estimate"?"Revise estimate":"Edit invoice":`New ${kind}`} onClose={onClose}><form onSubmit={submit}>
    {!record&&<SearchPicker label="Customer" endpoint="/customers" required selected={customer} describe={item=>String(item.name)} onSelect={setCustomer}/>}
    <div className="field"><label htmlFor="document-title">{kind==="estimate"?"What is included?":"Description"}</label><input id="document-title" required maxLength={500} value={title} onChange={e=>setTitle(e.target.value)}/></div>
    {lines.map((line,index)=><fieldset className="card card-pad" style={{marginTop:12,minWidth:0}} key={index}><legend>Line {index+1}</legend>
      <SearchPicker label={index===0 ? "Service" : `Catalog service ${index+1}`} endpoint="/services" selected={null} describe={item=>`${item.name} · ${item.basePriceCents == null ? "Enter a price" : money(Number(item.basePriceCents))}`} onSelect={item=>{if(item){setServiceTypes(previous=>({...previous,[item.id]:String(item.serviceType)}));setLines(previous=>previous.map((value,i)=>i===index?{...value,serviceId:item.id,description:String(item.name),...(item.basePriceCents == null ? {} : {unitAmountMinor:Number(item.basePriceCents)})}:value));}}}/>
      <div className="form-grid">{([['Line description','description'],['Quantity','quantity'],['Unit price','unitAmountMinor'],['Line discount','discountMinor']] as const).map(([label,key])=><div className="field" key={key}><label htmlFor={`line-${index}-${key}`}>{label}</label><input id={`line-${index}-${key}`} required type={key==="description"?"text":"number"} min={key==="quantity"?"0.0001":"0"} step={key==="quantity"?"0.0001":key==="description"?undefined:"0.01"} value={key==="unitAmountMinor"||key==="discountMinor"?(Number.isFinite(Number(line[key])) ? Number(line[key])/100 : ""):line[key]} onChange={e=>change(index,key,key==="unitAmountMinor"||key==="discountMinor"?e.target.value === "" ? Number.NaN : Math.round(Number(e.target.value)*100):e.target.value)}/></div>)}</div>
      <label><input type="checkbox" checked={!!line.taxable} onChange={e=>change(index,"taxable",e.target.checked)}/> Taxable</label>{kind==="estimate"&&<label style={{marginLeft:12}}><input type="checkbox" checked={!!line.optional} onChange={e=>change(index,"optional",e.target.checked)}/> Optional add-on</label>}
      {kind==="estimate"&&<div className="field" style={{marginTop:12}}><label htmlFor={`line-${index}-charge`}>Charge</label><select id={`line-${index}-charge`} value={line.charge ?? (recurring?"every_visit":"once")} onChange={e=>change(index,"charge",e.target.value)}><option value="once">Once</option><option value="every_visit">Every visit</option></select></div>}
      <div className="inline-actions" style={{marginTop:10}}><button type="button" className="btn btn-secondary btn-sm" disabled={!index} onClick={()=>move(index,-1)}>Move up</button><button type="button" className="btn btn-secondary btn-sm" disabled={index===lines.length-1} onClick={()=>move(index,1)}>Move down</button><button type="button" className="btn btn-secondary btn-sm" disabled={lines.length===1} onClick={()=>setLines(lines.filter((_,i)=>i!==index))}>Remove line</button></div>
    </fieldset>)}
    <button type="button" className="btn btn-secondary" style={{marginTop:12}} disabled={lines.length>=100} onClick={()=>setLines([...lines,emptyLine()])}>Add a line</button>
    <div className="form-grid" style={{marginTop:12}}><div className="field"><label htmlFor="document-tax">Tax rate (%)</label><input id="document-tax" type="number" min="0" max="100" step="0.01" value={tax/100} onChange={e=>setTax(Math.round(Number(e.target.value)*100))}/></div><div className="field"><label htmlFor="document-discount-type">Document discount</label><select id="document-discount-type" value={discount.type} onChange={e=>setDiscount({type:e.target.value as DocumentDiscount["type"],value:0})}><option value="amount">Amount</option><option value="percent">Percent</option></select></div><div className="field"><label htmlFor="document-discount">Discount {discount.type==="percent"?"(%)":"amount"}</label><input id="document-discount" type="number" min="0" max={discount.type==="percent"?100:undefined} step="0.01" value={discount.value/100} onChange={e=>setDiscount({...discount,value:Math.round(Number(e.target.value)*100)})}/></div></div>
    {kind==="invoice"?<div className="field"><label htmlFor="document-due">Due date</label><input id="document-due" type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></div>:<div className="field"><label htmlFor="document-notes">Description</label><textarea id="document-notes" value={notes} onChange={e=>setNotes(e.target.value)}/></div>}
    {pricing&&<MoneyTotals pricing={pricing} currency={record?.currency}/ >}{kind==="estimate"&&lines.some(line=>line.optional)&&<p className="subtle">This preview includes all optional add-ons. The customer chooses which to include before approval.</p>}
    {error&&<Notice kind="error" text={error}/ >}{defaults.error&&<Notice kind="error" text={defaults.error}/ >}
    <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving||defaults.loading||!!defaults.error}>{saving?"Saving…":record?kind==="estimate"?"Save new revision":"Save changes":`Create ${kind}`}</button></div>
  </form></Modal>;
}
