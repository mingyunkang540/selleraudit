export type ConfigurationPriceKey='normal'|'regular'|'basic'|'medium'|'large'|'live'|'group'
export type ConfigurationPrices=Record<ConfigurationPriceKey,number|null>
export type ProductConfiguration={id:string;productId:string;name:string;prices:ConfigurationPrices;components:{skuId:string;quantity:number}[]}
export type ConfigurationData={configurations:ProductConfiguration[];bindings:{offerId:string;configurationId:string}[]}
export const configurationPriceLabels:Record<ConfigurationPriceKey,string>={normal:'정상가',regular:'상시가',basic:'기본 행사가',medium:'중형 행사가',large:'대형 행사가',live:'원데이/라이브 행사가',group:'공구가'}
