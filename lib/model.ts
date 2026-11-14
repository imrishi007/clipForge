import captionPresets from './caption-presets.json';
import { z } from 'zod';
import { type EditingPreset, professionalPresets } from './presets';
const captionWordSchema = z.object({
  startMs: z.number().int().min(0), endMs: z.number().int().positive(), text: z.string().min(1).max(200).regex(/^\S+$/u),
});
export const captionSchema = z.object({
  id: z.string(), startMs: z.number().int().min(0), endMs: z.number().int().positive(),
  text: z.string().max(2000), words: z.array(captionWordSchema).max(64).optional(),
}).superRefine((caption, ctx) => {
  if (caption.endMs <= caption.startMs) ctx.addIssue({ code: 'custom', message: 'Caption end must follow start' });
  const words = caption.words ?? [];
  if (words.some((word, index) => word.startMs < (words[index - 1]?.endMs ?? caption.startMs) ||
    word.endMs <= word.startMs || word.endMs > caption.endMs)) {
    ctx.addIssue({ code: 'custom', message: 'Word timings must be ordered inside the caption' });
  }
  if (words.length && caption.text.trim().split(/\s+/u).join(' ') !== words.map(word => word.text).join(' ')) {
    ctx.addIssue({ code: 'custom', message: 'Caption text must match aligned words' });
  }
});
export const editSchema=z.object({schemaVersion:z.literal(1),revision:z.number().int().min(0),sourceInMs:z.number().int().min(0),sourceOutMs:z.number().int().positive(),cutFadeMs:z.number().int().min(0).max(250).optional(),sourceSegments:z.array(z.object({startMs:z.number().int().min(0),endMs:z.number().int().positive()})).max(32).optional(),ratio:z.enum(['9:16','4:5','1:1','16:9']),resolution:z.enum(['540','720','1080']),fps:z.union([z.literal(24),z.literal(30),z.literal(60)]),preserveSourceFps:z.boolean().optional(),quality:z.enum(['high','standard','compact']).optional(),cropMode:z.enum(['fill','fit']),focalX:z.number().min(0).max(1),focalY:z.number().min(0).max(1),framingKeyframes:z.array(z.object({timeMs:z.number().int().min(0),x:z.number().min(0).max(1),y:z.number().min(0).max(1),cut:z.boolean().optional()})).max(96).optional(),zoomPercent:z.number().int().min(100).max(150).optional(),saturation:z.number().min(0).max(2).optional(),volume:z.number().min(0).max(2),loudnessGainDb:z.number().min(-24).max(24).optional(),reduceRumble:z.boolean().optional(),fadeIn:z.number().min(0).max(5),fadeOut:z.number().min(0).max(5),captions:z.array(captionSchema),fontSize:z.number().min(16).max(120),fontFamily:z.enum(['Nirmala UI','Arial','Noto Sans Devanagari']),color:z.string().regex(/^#[0-9a-fA-F]{6}$/),outline:z.number().min(0).max(6),captionY:z.number().min(10).max(90),bold:z.boolean(),captionBackground:z.boolean(),captionAnimation:z.enum(['none','fade','pop']).optional(),captionHighlight:z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),captionShadow:z.number().min(0).max(8).optional()}).superRefine((d,ctx)=>{if(d.sourceOutMs<=d.sourceInMs)ctx.addIssue({code:'custom',message:'End must follow start'});const ranges=d.sourceSegments??[];if(ranges.length&&(ranges[0].startMs!==d.sourceInMs||ranges.at(-1)?.endMs!==d.sourceOutMs||ranges.some((r,i)=>r.startMs>=r.endMs||(i>0&&r.startMs<ranges[i-1].endMs))))ctx.addIssue({code:'custom',message:'Source segments must be ordered and cannot overlap'});const duration=editDuration(d);const frames=d.framingKeyframes??[];if(frames.some((f,i)=>f.timeMs>duration||(i>0&&f.timeMs<=frames[i-1].timeMs)))ctx.addIssue({code:'custom',message:'Framing keyframes must be ordered and inside the clip'});if(d.captions.some(c=>c.endMs>duration))ctx.addIssue({code:'custom',message:'Caption exceeds clip duration'});});
export type EditDocument=z.infer<typeof editSchema>;
export type Caption=z.infer<typeof captionSchema>;
export type Project={id:string;title:string;mode:'demo'|'real';storage:'local'|'server';category:string;folder:string;favorite:boolean;archived:boolean;createdAt:string;updatedAt:string;permissionNotes:string;preferences:Record<string,string>;media?:Media;clips:Clip[]};
export type Media={id:string;name:string;durationMs:number;width:number;height:number;hasAudio:boolean;url:string;thumbnail?:string;bytes?:number;fps?:string;codec?:string;sourceAvailable?:boolean;previewStatus?:string;previewUrl?:string;originalUrl?:string;previewSize?:number;previewProgress?:number|null};
export type Clip={id:string;projectId:string;title:string;favorite:boolean;status:'draft'|'saved'|'rejected';notes:string;sourceKind:'manual'|'demo_ai'|'ai_highlight';score?:number;edit:EditDocument};
export type Campaign={id:string;title:string;platform:string;permissionNotes:string;minSeconds:number;maxSeconds:number;ratio:string;branding:string;disclaimer:string;dueAt:string;clipIds:string[];submissions:{clipId:string;url:string;status:string;views:number;payout:number}[]};
export type Settings={theme:'auto'|'system'|'light'|'dark';language:string;defaultDuration:number;defaultRatio:string;defaultCaption:string;performanceProfile?:'lite'|'balanced'|'quality';exportEncoder?:'libx264'|'h264_nvenc'|'h264_qsv'|'h264_amf'};
export type ExportJob={id:string;projectId:string;clipId:string;title:string;status:'queued'|'running'|'succeeded'|'failed'|'cancelled';progress:number|null;stage:string;error?:string;createdAt:string;editRevision:number;bytes?:number;metadata?:{width:number;height:number;durationMs:number;hasAudio:boolean};logs:string[]};
export const defaultEdit=(durationMs=12000):EditDocument=>({schemaVersion:1,revision:0,sourceInMs:0,sourceOutMs:Math.min(durationMs,40000),ratio:'9:16',resolution:'1080',fps:30,cropMode:'fill',focalX:.5,focalY:.5,volume:1,fadeIn:0,fadeOut:0,captions:[],fontSize:52,fontFamily:'Nirmala UI',color:'#FFFFFF',outline:2,captionY:78,bold:true,captionBackground:false});
export function timecode(ms:number){const s=Math.max(0,ms)/1000;return `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}.${Math.round(ms%1000).toString().padStart(3,'0')}`;}
export function dimensions(ratio:EditDocument['ratio'],size:EditDocument['resolution']){const w=Number(size);const [a,b]=ratio.split(':').map(Number);return {width:w,height:Math.round(w*b/a/2)*2};}
export function validateRange(start:number,end:number,duration:number){return Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&end<=duration;}
export const templates: EditingPreset[] = [...captionPresets as EditingPreset[], ...professionalPresets];

export function editDuration(edit: Pick<EditDocument,'sourceSegments'|'sourceInMs'|'sourceOutMs'>) {
  return edit.sourceSegments?.length ? edit.sourceSegments.reduce((total, segment) => total + segment.endMs - segment.startMs, 0)
    : edit.sourceOutMs - edit.sourceInMs;
}
