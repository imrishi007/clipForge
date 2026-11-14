'use client';
import {createContext,useContext,useEffect,useState,useRef,useCallback} from 'react';
import {api,readLocal,writeLocal,defaults,request,sampleProject,type Snapshot} from '@/lib/repository';
import type {Project,Clip,Campaign,EditDocument,Settings} from '@/lib/model';
type Context={data:Snapshot;ready:boolean;online:boolean;diagnostics:Record<string,unknown>;message:string;notify:(s:string)=>void;refresh:()=>Promise<void>;saveProject:(p:Project)=>Promise<Project>;removeProject:(p:Project)=>Promise<void>;duplicate:(p:Project)=>Promise<Project>;saveClip:(p:Project,c:Clip)=>Promise<Clip>;saveEdit:(p:Project,c:Clip,e:EditDocument)=>Promise<EditDocument>;removeClip:(p:Project,c:Clip)=>Promise<void>;saveCampaign:(c:Campaign)=>Promise<Campaign>;saveSettings:(s:Settings)=>Promise<void>;sample:()=>Promise<Project>;custom:(t:Snapshot['customTemplates'][number])=>Promise<void>};
const WorkspaceContext=createContext<Context|null>(null);
export function WorkspaceProvider({children}:{children:React.ReactNode}){const [data,setData]=useState<Snapshot>({projects:[],campaigns:[],settings:defaults,customTemplates:[]});const ref=useRef(data);const [ready,setReady]=useState(false);const [online,setOnline]=useState(false);const [diagnostics,setDiagnostics]=useState<Record<string,unknown>>({});const [message,setMessage]=useState('');const persistQueue=useRef(Promise.resolve());
const commit=useCallback(async(next:Snapshot)=>{ref.current=next;setData(next);persistQueue.current=persistQueue.current.catch(()=>{}).then(()=>writeLocal(next));await persistQueue.current;},[]);
const refresh=useCallback(async()=>{try{const [health,projects,campaigns]=await Promise.all([api.health(),api.projects(),api.campaigns()]);setDiagnostics(health);setOnline(true);await commit({...ref.current,projects:[...ref.current.projects.filter(p=>p.storage==='local'),...projects],campaigns:[...ref.current.campaigns.filter(c=>c.id.startsWith('local-')),...campaigns]});}catch{setOnline(false);}},[commit]);
useEffect(()=>{let live=true;readLocal().then(local=>{if(!live)return;ref.current=local;setData(local);setReady(true);void refresh();}).catch(e=>{setMessage(`Local storage error: ${e.message}`);setReady(true);});return()=>{live=false;};},[refresh]);
useEffect(()=>{if(!message)return;const id=setTimeout(()=>setMessage(''),6000);return()=>clearTimeout(id);},[message]);
async function saveProject(p:Project){let saved={...p,updatedAt:new Date().toISOString()};if(p.storage==='server'){const {title,category,folder,favorite,archived,permissionNotes,preferences}=p;const exists=ref.current.projects.some(x=>x.id===p.id);saved=await request<Project>(exists?`/api/projects/${p.id}`:'/api/projects',{method:exists?'PATCH':'POST',body:JSON.stringify({title,category,folder,favorite,archived,permissionNotes,preferences})});}await commit({...ref.current,projects:[saved,...ref.current.projects.filter(x=>x.id!==p.id&&x.id!==saved.id)]});return saved;}
async function removeProject(p:Project){if(p.storage==='server')await request(`/api/projects/${p.id}`,{method:'DELETE'});if(p.media?.url.startsWith('blob:'))URL.revokeObjectURL(p.media.url);await commit({...ref.current,projects:ref.current.projects.filter(x=>x.id!==p.id)});}
async function duplicate(p:Project){if(p.storage==='server'){const copy=await request<Project>(`/api/projects/${p.id}/duplicate`,{method:'POST'});await commit({...ref.current,projects:[copy,...ref.current.projects]});return copy;}const copy=structuredClone(p);copy.id=crypto.randomUUID();copy.title+=' copy';copy.clips=copy.clips.map(c=>({...c,id:crypto.randomUUID(),projectId:copy.id}));return saveProject(copy);}
async function saveClip(p:Project,c:Clip){let saved=c;if(p.storage==='server'){const exists=ref.current.projects.find(x=>x.id===p.id)?.clips.some(x=>x.id===c.id);const {title,edit,favorite,status,notes}=c;saved=await request<Clip>(exists?`/api/clips/${c.id}`:`/api/projects/${p.id}/clips`,{method:exists?'PATCH':'POST',body:JSON.stringify({title,edit,favorite,status,notes})});}const current=ref.current.projects.find(x=>x.id===p.id)||p;await commit({...ref.current,projects:ref.current.projects.map(x=>x.id===p.id?{...current,clips:[...current.clips.filter(v=>v.id!==c.id),saved]}:x)});return saved;}
async function saveEdit(p:Project,c:Clip,e:EditDocument){const edit=p.storage==='server'?await api.saveEdit(c.id,e):{...e,revision:e.revision+1};await commit({...ref.current,projects:ref.current.projects.map(x=>x.id===p.id?{...x,updatedAt:new Date().toISOString(),clips:x.clips.map(v=>v.id===c.id?{...v,edit}:v)}:x)});return edit;}
async function removeClip(p:Project,c:Clip){if(p.storage==='server')await request(`/api/clips/${c.id}`,{method:'DELETE'});await commit({...ref.current,projects:ref.current.projects.map(x=>x.id===p.id?{...x,clips:x.clips.filter(v=>v.id!==c.id)}:x)});}
async function saveCampaign(c: Campaign) {
  const existing = ref.current.campaigns.some((item) => item.id === c.id);
  let saved = c;
  if (!c.id.startsWith('local-') && (online || existing)) {
    const { id, ...body } = c;
    saved = await request<Campaign>(existing ? `/api/campaigns/${id}` : '/api/campaigns', {
      method: existing ? 'PUT' : 'POST', body: JSON.stringify(body),
    });
  } else if (!existing) {
    saved = { ...c, id: `local-${crypto.randomUUID()}` };
  }
  await commit({ ...ref.current, campaigns: [saved, ...ref.current.campaigns.filter((item) => item.id !== c.id && item.id !== saved.id)] });
  return saved;
}
async function saveSettings(settings:Settings){if(online)await request('/api/settings',{method:'PUT',body:JSON.stringify(settings)});await commit({...ref.current,settings});}
async function sample(){const existing=ref.current.projects.find(p=>p.id==='sample-studio');return existing||saveProject(sampleProject());}
return <WorkspaceContext.Provider value={{data,ready,online,diagnostics,message,notify:setMessage,refresh,saveProject,removeProject,duplicate,saveClip,saveEdit,removeClip,saveCampaign,saveSettings,sample,custom:async t=>commit({...ref.current,customTemplates:[...ref.current.customTemplates,t]})}}>{children}</WorkspaceContext.Provider>;}
export function useWorkspace(){const ctx=useContext(WorkspaceContext);if(!ctx)throw Error('Workspace provider missing');return ctx;}
