'use client';
import {useEffect,useId,useRef} from 'react';
import {X,FolderOpen,Film} from 'lucide-react';
export function PageHeader({eyebrow,title,description,action}:{eyebrow?:string;title:string;description?:string;action?:React.ReactNode}){return <><div className="eyebrow">{eyebrow||'YOUR WORKSPACE'}</div><div className="page-heading"><div><h1>{title}</h1>{description&&<p>{description}</p>}</div>{action}</div></>;}
export function Empty({title,description,children}:{title:string;description:string;children?:React.ReactNode}){return <div className="empty-state"><FolderOpen size={28}/><h3>{title}</h3><p>{description}</p>{children}</div>;}
export function Alert({children}:{children:React.ReactNode}){return <div className="inline-alert" role="status">{children}</div>;}
export function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){const ref=useRef<HTMLDialogElement>(null);const titleId=useId();useEffect(()=>{const d=ref.current;d?.showModal();return()=>d?.close();},[]);return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={onClose}><div className="modal-heading"><h2 id={titleId}>{title}</h2><button aria-label="Close dialog" onClick={onClose}><X size={16}/></button></div>{children}</dialog>;}
export function Thumbnail({src,alt='Video thumbnail',className=''}:{src?:string;alt?:string;className?:string}){return <div className={`thumbnail ${className}`}>{src?<img src={src} alt={alt}/>:<div className="thumbnail-placeholder"><Film size={24}/><span>YOUR FOOTAGE</span></div>}</div>;}
export function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}</label>;}
