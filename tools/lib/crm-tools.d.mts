export const crmAgentActions:string[]
export const crmTools:Array<{name:string;description:string;inputSchema:Record<string,unknown>}>
export const crmToolActions:Record<string,string>
export const crmActionTool:{name:string;description:string;parameters:Record<string,unknown>}
export function crmAgentResult(result:any, options?:Record<string,unknown>):any
