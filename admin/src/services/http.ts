export const API_BASE = process.env.UMI_APP_API_BASE || '/api/v1';
const FALLBACK = process.env.UMI_APP_ENABLE_MOCK_FALLBACK === 'true';
export class ApiError extends Error { constructor(message:string, public status?:number){super(message)} }
export const apiUrl = (path: string) => `${API_BASE}${path}`;
export async function request<T>(path:string, init?:RequestInit, fallback?:()=>T):Promise<{value:T; mock:boolean}> {
  try {
    const response=await fetch(apiUrl(path),{...init,headers:{Accept:'application/json',...init?.headers}});
    if(!response.ok){ const body=await response.json().catch(()=>null); throw new ApiError(body?.error?.message||`请求失败 (${response.status})`,response.status); }
    return {value:await response.json() as T,mock:false};
  } catch(error){ if(FALLBACK&&fallback)return {value:fallback(),mock:true}; throw error; }
}
