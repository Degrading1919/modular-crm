import { describe,expect,it } from "vitest";
import { priceDocument, type DocumentLineInput } from "../src/document-pricing.ts";
const line=(price=1,extra:Partial<DocumentLineInput>={})=>({description:"Work",quantity:"1",unitAmountMinor:price,taxable:true,...extra});
describe("document pricing",()=>{
  it("rounds tax once per document half-up, not once per line",()=>{
    const result=priceDocument([line(),line()],5000);
    expect(result).toMatchObject({subtotalMinor:2,taxMinor:1,totalMinor:3});
    expect(result.items.map(item=>item.taxMinor)).toEqual([1,0]);
  });
  it("extends fractional quantities half-up and allocates discounts exactly before tax",()=>{
    const result=priceDocument([line(101,{quantity:"1.5",discountMinor:2}),line(100,{taxable:false}),line(100)],750,{type:"amount",value:7});
    expect(result).toMatchObject({subtotalMinor:352,discountMinor:9,taxMinor:18,totalMinor:361});
    expect(result.items.reduce((sum,item)=>sum+item.totalMinor,0)).toBe(result.totalMinor);
    expect(result.items.reduce((sum,item)=>sum+item.documentDiscountMinor,0)).toBe(7);
    expect(result.items[1]!.taxMinor).toBe(0);
  });
  it("applies a percent discount to net lines using basis points",()=>{
    expect(priceDocument([line(10000,{discountMinor:1000})],750,{type:"percent",value:1000})).toMatchObject({subtotalMinor:10000,discountMinor:1900,taxMinor:608,totalMinor:8708});
  });
  it("rejects invalid quantities, unsafe totals and discounts rather than guessing",()=>{
    for(const quantity of ["0","-1","1.00001","NaN"])expect(()=>priceDocument([line(100,{quantity})])).toThrow();
    expect(()=>priceDocument([line(Number.MAX_SAFE_INTEGER,{quantity:"2"})])).toThrow();
    expect(()=>priceDocument([line(1,{discountMinor:2})])).toThrow();
    expect(()=>priceDocument([line()],0,{type:"amount",value:2})).toThrow();
    expect(()=>priceDocument([line()],10001)).toThrow();
  });
});
