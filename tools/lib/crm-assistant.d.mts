export interface CaptureExtraction { contactName?:string; companyName?:string; email?:string; phone?:string; kind?:'person'|'company'; commitmentTitle?:string; dueAt?:string; waitingOn?:'me'|'them'; opportunityTitle?:string }
export type CrmCompletion = (request:{system:string;user:string})=>Promise<string>
export function crmToday(now?:Date|string,timeZone?:string):string
export function crmDateFromText(text:string,today?:string):string
export function crmCommitmentDate(text:string,title:string,today?:string):string
export function validateCrmExtraction(text:string,value:unknown,today?:string):CaptureExtraction
export function extractCrmCapture(text:string,options?:{complete?:CrmCompletion;now?:Date|string;timeZone?:string}):Promise<{extraction:CaptureExtraction;method:'rules'|'model'}>
export function crmDraftPrompt(context:string,draft:{channel:string;subject:string;body:string}):{system:string;user:string}
export function parseCrmDraft(text:string):{subject:string;body:string}
