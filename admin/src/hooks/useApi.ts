import { useCallback, useEffect, useState } from 'react';
export function useApi<T>(loader:()=>Promise<{value:T;mock:boolean}>, deps:unknown[]=[]){
  const [data,setData]=useState<T>(); const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [mock,setMock]=useState(false);
  const reload=useCallback(()=>{setLoading(true);setError('');loader().then(r=>{setData(r.value);setMock(r.mock)}).catch(e=>setError(e instanceof Error?e.message:'未知错误')).finally(()=>setLoading(false));},deps);
  useEffect(reload,[reload]); return {data,loading,error,mock,reload};
}
