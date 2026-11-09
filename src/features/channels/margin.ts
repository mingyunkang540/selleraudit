export function expectedMargin(salePrice:number|null,cost:number|null,couponExpense:number|null=0,channelFee:number|null=0):number|null{
 return salePrice===null||cost===null||couponExpense===null||channelFee===null?null:salePrice-cost-couponExpense-channelFee
}
