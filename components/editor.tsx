'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useStore} from 'zustand';
import {useState,useEffect,useRef,useCallback} from 'react';
import {ArrowLeft,Play,Pause,SkipBack,SkipForward,Undo2,Redo2,Scissors,Save,Download,Plus,Trash2,Volume2,Film,Type,Crop,SlidersHorizontal,Maximize,MousePointer2,ZoomIn,ZoomOut,HelpCircle,Eye,Check} from 'lucide-react';
import {type Project,type Clip,type EditDocument,type Caption,templates,editSchema,timecode,dimensions,validateRange,editDuration} from '@/lib/model';
import {api,mediaUrl,newClip} from '@/lib/repository';
import {createEditSession,trimEdit,splitEdit,toSrt,parseSrt,downloadText,previewGain,previewVolume} from '@/lib/editing';
import {useWorkspace} from './workspace-context';
import {Field,Modal,Alert,Thumbnail} from './ui';
import {editorShortcuts} from '@/lib/shortcuts';
import {SceneCuts} from './scene-cuts';
import {FramingControls} from './framing-controls';
import {CaptionMotion, CaptionPreview, CaptionWords, TranscriptCaptionButton} from './caption-tools';
import {framingAt} from '@/lib/framing';
import {presetPatch} from '@/lib/presets';
import {sourceAt,timelineAt,timelineSegments,cutFadeGain} from '@/lib/segments';
import {SegmentControls} from './segment-controls';
import {AudioWaveform, NormalizeAudio} from './audio-tools';
import {useEditPreview} from './use-edit-preview';

export function Editor({project:p,clip:c}:{project:Project;clip:Clip}){const w=useWorkspace();const router=useRouter();const [sessionStore]=useState(()=>createEditSession(c.edit));const session=useStore(sessionStore);const edit=session.edit;const [tab,setTab]=useState('Captions');const [time,setTime]=useState(0);const [playing,setPlaying]=useState(false);const [safe,setSafe]=useState(true);const [loop,setLoop]=useState(false);const [speed,setSpeed]=useState(1);const [zoom,setZoom]=useState(1);const [selection,setSelection]=useState<string|null>(null);const [saveState,setSaveState]=useState('Saved');const [exportOpen,setExportOpen]=useState(false);const [help,setHelp]=useState(false);const [confirmDelete,setConfirmDelete]=useState(false);const [videoError,setVideoError]=useState(false);const [exportBusy,setExportBusy]=useState(false);const [exportError,setExportError]=useState('');const program=useRef<HTMLVideoElement>(null);const source=useRef<HTMLVideoElement>(null);const srtInput=useRef<HTMLInputElement>(null);const saving=useRef<Promise<void>|null>(null);const owners=useRef({p,c,w});useEffect(()=>{owners.current={p,c,w};},[p,c,w]);
const preview = useEditPreview(p.media, w.data.settings.performanceProfile, w.online);
const currentMedia = preview.media;
const candidateUrl = currentMedia?.previewUrl || currentMedia?.originalUrl || currentMedia?.url || '';
const [programUrl, setProgramUrl] = useState(candidateUrl);
const requestedTime = useRef<number|null>(null);
useEffect(() => {
  if (!playing && candidateUrl !== programUrl) {
    setProgramUrl(candidateUrl);
    setVideoError(false);
  }
}, [playing, candidateUrl, programUrl]);
const save = useCallback(async () => {
  if (saving.current) await saving.current;
  while (sessionStore.getState().dirty) {
    if (saving.current) {
      await saving.current;
      continue;
    }
    const snapshot = sessionStore.getState().edit;
    const checked = editSchema.safeParse(snapshot);
    if (!checked.success) {
      setSaveState(checked.error.issues[0].message);
      return;
    }
    const { p: owner, c: clip, w: workspace } = owners.current;
    setSaveState('Saving…');
    saving.current = workspace.saveEdit(owner, clip, snapshot).then((result) => {
      sessionStore.getState().markSaved(result.revision, snapshot);
      setSaveState('Saved');
    }).catch((error) => {
      setSaveState(`Not saved: ${error.message}`);
      throw error;
    }).finally(() => { saving.current = null; });
    await saving.current;
  }
}, [sessionStore]);
useEffect(()=>{if(!session.dirty)return;setSaveState('Unsaved changes');const timer=setTimeout(()=>void save().catch(()=>{}),700);return()=>clearTimeout(timer);},[edit,session.dirty,save]);
useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(sessionStore.getState().dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>{window.removeEventListener('beforeunload',warn);void save().catch(()=>{});};},[save,sessionStore]);
const audioGraph=useRef<{context:AudioContext;gain:GainNode;rumble:BiquadFilterNode;dry:GainNode;wet:GainNode;video:HTMLVideoElement}|null>(null);
const duration=editDuration(edit);const sourceDuration=p.media?.durationMs||duration;const change=session.change;
function seek(ms: number) {
  const active = sessionStore.getState().edit;
  const position = Math.max(0, Math.min(editDuration(active), ms));
  setTime(position);
  const absolute = sourceAt(active, position) / 1000;
  if (program.current && Number.isFinite(program.current.duration)) {
    requestedTime.current = absolute;
    program.current.currentTime = absolute;
  }
  if (source.current && Number.isFinite(source.current.duration)) source.current.currentTime = absolute;
}
const applyPreviewGain = useCallback((video: HTMLVideoElement, position: number) => {
  const active = sessionStore.getState().edit;
  const graph = audioGraph.current;
  if (graph?.video === video) {
    video.volume = 1;
    graph.gain.gain.value = previewGain(active, position / 1000);
  } else video.volume = previewVolume(active, position / 1000);
}, [sessionStore]);
function togglePlay() {
  const video = program.current;
  if (!video || videoError) return;
  if (!video.paused) { video.pause(); return; }
  if (time >= duration - 30) seek(0);
  if (p.media?.hasAudio && !audioGraph.current && window.AudioContext) {
    const context = new AudioContext();
    try {
      const gain = context.createGain();
      const rumble = context.createBiquadFilter();
      rumble.type = 'highpass';
      rumble.frequency.value = 85;
      rumble.Q.value = 20 * Math.log10(Math.SQRT1_2);
      const input = context.createMediaElementSource(video);
      const dry = context.createGain(), wet = context.createGain();
      wet.gain.value = sessionStore.getState().edit.reduceRumble ? 1 : 0;
      dry.gain.value = 1 - wet.gain.value;
      input.connect(dry).connect(gain);
      input.connect(rumble).connect(wet).connect(gain);
      gain.connect(context.destination);
      audioGraph.current = { context, gain, rumble, dry, wet, video };
    } catch {
      void context.close();
    }
  }
  applyPreviewGain(video, time >= duration - 30 ? 0 : time);
  void audioGraph.current?.context.resume().catch(() => {});
  void video.play().catch(error => w.notify(`Playback unavailable: ${error.message}`));
}
function onTime() {
  const video = program.current;
  if (!video || video.readyState < 1) return;
  if (requestedTime.current !== null && video.seeking && Math.abs(video.currentTime - requestedTime.current) > .05) return;
  requestedTime.current = null;
  const current = sessionStore.getState().edit;
  const { position, skipTo } = timelineAt(current, video.currentTime * 1000);
  if (skipTo !== undefined) {
    video.currentTime = skipTo / 1000;
  } else if (position >= editDuration(current) && !video.paused) {
    if (loop) seek(0);
    else { video.pause(); seek(editDuration(current)); }
    return;
  }
  applyPreviewGain(video, position);
  setTime(position);
  if (video.paused && source.current && Math.abs(source.current.currentTime - video.currentTime) > .12) source.current.currentTime = video.currentTime;
}
useEffect(() => {
  const video = program.current;
  if (!video) return;
  video.playbackRate = speed;
  const active = sessionStore.getState().edit;
  const seconds = timelineAt(active, video.currentTime * 1000).position / 1000;
  const graph = audioGraph.current;
  if (graph?.video === video) {
    graph.gain.gain.value = previewGain(active, seconds);
    graph.wet.gain.value = active.reduceRumble ? 1 : 0;
    graph.dry.gain.value = 1 - graph.wet.gain.value;
  }
  else video.volume = previewVolume(active, seconds);
}, [sessionStore, speed, edit.volume, edit.loudnessGainDb, edit.fadeIn, edit.fadeOut, edit.reduceRumble]);
useEffect(() => () => { void audioGraph.current?.context.close(); audioGraph.current = null; }, []);
useEffect(() => {
  const video = program.current;
  if (!video || !Number.isFinite(video.duration)) return;
  const active = sessionStore.getState().edit;
  const point = timelineAt(active, video.currentTime * 1000);
  if (point.skipTo !== undefined) video.currentTime = point.skipTo / 1000;
  if (video.currentTime * 1000 > active.sourceOutMs) video.currentTime = active.sourceOutMs / 1000;
  setTime(point.position);
}, [sessionStore, edit.sourceInMs, edit.sourceOutMs, edit.sourceSegments]);
useEffect(() => {
  const video = program.current;
  if (!video || !playing || !video.requestVideoFrameCallback) return;
  let callback: number;
  const frame: VideoFrameRequestCallback = (_, metadata) => {
    const point = timelineAt(sessionStore.getState().edit, metadata.mediaTime * 1000);
    if (point.skipTo !== undefined) video.currentTime = point.skipTo / 1000;
    if (sessionStore.getState().edit.cutFadeMs) applyPreviewGain(video, point.position);
    setTime(Math.min(duration, point.position));
    callback = video.requestVideoFrameCallback(frame);
  };
  callback = video.requestVideoFrameCallback(frame);
  return () => video.cancelVideoFrameCallback(callback);
}, [playing, duration, sessionStore, applyPreviewGain]);
function range(start:number,end:number){if(!validateRange(start,end,sourceDuration)){w.notify('Trim boundaries must fit inside the source.');return;}try{change(trimEdit(edit,start,end));}catch(e){w.notify((e as Error).message);}}
async function split(){try{const at=Math.round(time);const [left,right]=splitEdit(sessionStore.getState().edit,at);change(left);await save();const current=sessionStore.getState().edit;await w.saveClip(p,{...newClip(p,right.sourceInMs,right.sourceOutMs),title:`${c.title} · part 2`,edit:right});w.notify('Split into two independent clips.');change({...current});}catch(e){w.notify((e as Error).message);}}
function removeSelected(){if(selection){change({captions:edit.captions.filter(x=>x.id!==selection)});setSelection(null);}else setConfirmDelete(true);}
useEffect(()=>{const handler=(e:KeyboardEvent)=>{const target=e.target as HTMLElement;if(target.closest('input,textarea,select,[contenteditable=true],dialog'))return;if(e.code==='Space'){e.preventDefault();togglePlay();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)session.redo();else session.undo();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void save().catch(()=>{});}else if(e.key==='ArrowRight'){e.preventDefault();seek(time+(e.shiftKey?5000:1000/edit.fps));}else if(e.key==='ArrowLeft'){e.preventDefault();seek(time-(e.shiftKey?5000:1000/edit.fps));}else if(e.key.toLowerCase()==='s'&&!e.ctrlKey&&!e.metaKey){void split();}else if(e.key==='Delete')removeSelected();};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);});
function updateCaption(id: string, patch: Partial<Caption>) {
  change({ captions: sessionStore.getState().edit.captions.map(caption => {
    if (caption.id !== id) return caption;
    const updated = { ...caption, ...patch };
    if (patch.words === undefined && (patch.text !== undefined && patch.text !== caption.text ||
      updated.words?.some(word => word.startMs < updated.startMs || word.endMs > updated.endMs))) {
      updated.words = [];
    }
    return updated;
  }) });
}
function addCaption(){const start=Math.min(Math.round(time),Math.max(0,duration-500));const caption={id:crypto.randomUUID(),startMs:start,endMs:Math.min(duration,start+3000),text:'Your words here'};change({captions:[...edit.captions,caption]});setSelection(caption.id);setTab('Captions');}
async function render(){setExportBusy(true);setExportError('');try{await save();if(sessionStore.getState().dirty)await save();if(sessionStore.getState().dirty)throw Error('Resolve edit validation errors before exporting.');await api.render(c.id);router.push('/exports');}catch(e){setExportError((e as Error).message);}finally{setExportBusy(false);}}
const focal=framingAt(edit,time);const dynamicFraming=!!edit.framingKeyframes?.length;const activeCaption=edit.captions.find(x=>time>=x.startMs&&time<x.endMs);const dims=dimensions(edit.ratio,edit.resolution);const currentCaption=edit.captions.find(x=>x.id===selection);const available=p.storage==='server'&&p.media?.sourceAvailable!==false&&w.online&&w.diagnostics.ffmpeg===true&&w.diagnostics.ffprobe===true;const monitorStyle={aspectRatio:edit.ratio.replace(':','/')} as React.CSSProperties;
return <div className="editor"><div className="editor-command"><Link href={`/projects/${p.id}`} className="editor-back" onClick={e=>{e.preventDefault();void save().then(()=>router.push(`/projects/${p.id}`)).catch(()=>{});}}><ArrowLeft size={16}/><span>{p.title}</span></Link><span className="editor-divider"/><strong>{c.title}</strong>{p.mode==='demo'&&<span className="badge demo">Demo Mode</span>}<div className="editor-save">{['queued','running'].includes(currentMedia?.previewStatus??'')&&<span role="status">
  {currentMedia?.previewProgress!=null?`Preparing proxy · ${Math.floor(currentMedia.previewProgress)}%`:'Preparing proxy'}
</span>}{['failed','cancelled'].includes(currentMedia?.previewStatus??'')&&<button onClick={preview.retry}>Retry preview</button>}<span className={saveState.startsWith('Not')?'danger-text':''}>{saveState==='Saved'&&<Check size={12}/>} {saveState}</span><button onClick={()=>void save().catch(()=>{})}><Save size={14}/>Save</button><button className="primary" onClick={()=>setExportOpen(true)}><Download size={14}/>Export</button></div></div><div className="editor-work"><aside className="media-bin"><div className="panel-title"><Film size={14}/>Project media</div><div className="media-bin-content"><Thumbnail src={mediaUrl(currentMedia?.thumbnail)}/><h3>{p.media?.name||'Source media'}</h3><small>{p.media?.width} × {p.media?.height} · {timecode(sourceDuration).slice(0,5)}</small><div className="bin-heading">CLIPS <span>{p.clips.length}</span></div>{p.clips.map(other=><Link className={`bin-clip ${other.id===c.id?'selected':''}`} key={other.id} href={`/editor/${p.id}/${other.id}`} onClick={e=>{e.preventDefault();void save().then(()=>router.push(`/editor/${p.id}/${other.id}`)).catch(()=>{});}}><Film size={14}/><div>{other.title}<small>{(editDuration(other.edit)/1000).toFixed(1)}s · {other.edit.ratio}</small></div></Link>)}<div className="bin-note"><span className="status-dot"/>Non-destructive editing<p>Your original footage stays untouched.</p></div></div></aside><section className="monitors"><div className="monitor-pair"><div className="source-monitor"><div className="panel-title">Source <span>{p.media?.name}</span></div><div className="source-screen">{p.media?.url&&!videoError?<video ref={source} src={mediaUrl(programUrl||p.media.url)} muted preload="metadata" poster={mediaUrl(p.media.thumbnail)} onLoadedMetadata={()=>{if(source.current)source.current.currentTime=edit.sourceInMs/1000;}}/>:<Thumbnail src={mediaUrl(currentMedia?.thumbnail)}/>}</div><div className="monitor-caption"><span>Source {timecode(sourceAt(edit,time))}</span><span>{currentMedia?.previewSize && programUrl===currentMedia.previewUrl ? `${currentMedia.previewSize}p proxy` : 'Fit'}</span></div></div><div className="program-monitor"><div className="panel-title">Program <span>{edit.ratio} · {edit.fps} fps</span><button className="icon-button" aria-label="Toggle safe zones" onClick={()=>setSafe(!safe)}><Maximize size={13}/></button></div><div className="program-stage"><div className="program-screen" style={monitorStyle}>{p.media?.url&&!videoError?<video ref={program} crossOrigin="anonymous" src={mediaUrl(programUrl||p.media.url)} poster={mediaUrl(p.media.thumbnail)} playsInline preload="metadata" onLoadedMetadata={()=>{if(program.current){program.current.playbackRate=speed;applyPreviewGain(program.current,time);}seek(time);}} onError={()=>setVideoError(true)} onTimeUpdate={onTime} onPlay={()=>setPlaying(true)} onPause={()=>{setPlaying(false);if(source.current&&program.current)source.current.currentTime=program.current.currentTime;}} style={{objectFit:edit.cropMode==='fill'?'cover':'contain',objectPosition:edit.cropMode==='fill'?`${focal.x*100}% ${focal.y*100}%`:'center',transform:`scale(${(edit.zoomPercent??100)/100})`,filter:`saturate(${edit.saturation??1})${edit.cutFadeMs&&edit.sourceSegments?.length ? ` brightness(${cutFadeGain(edit,time)})` : ''}`}}/>:<><Thumbnail src={mediaUrl(currentMedia?.thumbnail)}/><div className="preview-unavailable">{p.mode==='demo'?'Sample video not generated':'Source needs relinking'}<small>{p.mode==='demo'?'Run npm run fixtures':'Open project to relink'}</small></div></>}{safe&&<div className="safe-zone"><span>SAFE AREA</span></div>}{activeCaption&&<CaptionPreview caption={activeCaption} edit={edit} time={time}/>}</div></div><div className="monitor-caption"><span>{timecode(time)}</span><span>/ {timecode(duration)}</span></div></div></div><div className="transport"><button aria-label="Go to start" onClick={()=>seek(0)}><SkipBack size={15}/></button><button aria-label={playing?'Pause':'Play'} onClick={togglePlay} disabled={videoError||!p.media?.url}>{playing?<Pause size={19}/>:<Play size={19}/>}</button><button aria-label="Go to end" onClick={()=>seek(duration)}><SkipForward size={15}/></button><select aria-label="Playback speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.5,1,1.5,2].map(x=><option value={x} key={x}>{x}×</option>)}</select><label><input type="checkbox" checked={loop} onChange={e=>setLoop(e.target.checked)}/>Loop</label><button aria-label="Toggle safe-area guides" className={safe?'selected':''} onClick={()=>setSafe(!safe)}><Maximize size={15}/></button></div></section><aside className="inspector"><div className="inspector-tabs">{[['Edit',SlidersHorizontal],['Captions',Type],['Crop',Crop],['Audio',Volume2],['Effects',Eye]].map(([label,Icon])=>{const I=Icon as typeof Type;return <button key={label as string} title={label as string} aria-label={`${label} inspector`} className={tab===label?'active':''} onClick={()=>setTab(label as string)}><I size={16}/><span>{label as string}</span></button>;})}</div><div className="inspector-body">{tab==='Edit'&&<><h3>Clip boundaries</h3><Field label="Source in (seconds)"><input type="number" step={1/edit.fps} min={0} max={edit.sourceOutMs/1000-.04} value={edit.sourceInMs/1000} onChange={e=>range(Math.round(Number(e.target.value)*1000),edit.sourceOutMs)}/></Field><Field label="Source out (seconds)"><input type="number" step={1/edit.fps} min={edit.sourceInMs/1000+.04} max={sourceDuration/1000} value={edit.sourceOutMs/1000} onChange={e=>range(edit.sourceInMs,Math.round(Number(e.target.value)*1000))}/></Field><button onClick={()=>void split()} disabled={time<1||time>=duration}>Split at playhead <Scissors size={14}/></button><hr/><SceneCuts key={p.media?.id} project={p} start={edit.sourceInMs} end={edit.sourceOutMs} seek={relative=>seek(timelineAt(edit,edit.sourceInMs+relative).position)} trim={(start,end)=>{range(start,end);seek(0);}}/><hr/><h3>Editing preset</h3>{[...templates,...w.data.customTemplates].map(t=><button className="preset-row" key={t.name} onClick={()=>change(presetPatch(t))}><span>Aa</span>{t.name}</button>)}<hr/><SegmentControls project={p} clipId={c.id} edit={edit} time={time} seek={seek} change={change}/></>}{tab==='Captions'&&<><div className="row-between inspector-heading"><h3>Captions <span className="count">{edit.captions.length}</span></h3><button className="icon-button" aria-label="Add caption" onClick={addCaption}><Plus size={15}/></button></div><p className="hint">{p.mode==='demo'?'Curated demo text · editable':c.sourceKind==='ai_highlight'?'Transcript draft · review before export':'Manually authored captions'}</p>{p.storage==='server'&&p.mode==='real'&&p.media?.sourceAvailable!==false&&!edit.sourceSegments?.length&&<TranscriptCaptionButton clipId={c.id} edit={edit} replace={captions=>{
  const active=sessionStore.getState().edit;
  change({captions,captionHighlight:active.captionHighlight??'#F5D68C'});
  setSelection(captions[0]?.id??null);
}}/>}<div className="caption-list">{edit.captions.map((cap,i)=><button key={cap.id} className={selection===cap.id?'selected':''} onClick={()=>{setSelection(cap.id);seek(cap.startMs);}}><span>{String(i+1).padStart(2,'0')}</span><div><small>{timecode(cap.startMs).slice(0,5)} – {timecode(cap.endMs).slice(0,5)}</small><p>{cap.text}</p></div></button>)}</div>{currentCaption?<div className="caption-edit"><textarea aria-label="Caption text" value={currentCaption.text} rows={3} onChange={e=>updateCaption(currentCaption.id,{text:e.target.value})}/><div className="form-grid"><Field label="In (seconds)"><input type="number" step="0.01" value={currentCaption.startMs/1000} onChange={e=>updateCaption(currentCaption.id,{startMs:Math.round(Number(e.target.value)*1000)})}/></Field><Field label="Out (seconds)"><input type="number" step="0.01" value={currentCaption.endMs/1000} onChange={e=>updateCaption(currentCaption.id,{endMs:Math.round(Number(e.target.value)*1000)})}/></Field></div><CaptionWords key={currentCaption.id} caption={currentCaption} update={patch=>updateCaption(currentCaption.id,patch)} seek={seek}/><button className="danger-text" onClick={removeSelected}><Trash2 size={13}/>Remove caption</button></div>:<button className="full-width" onClick={addCaption}><Plus size={14}/>Add a caption</button>}<div className="subtitle-actions"><input ref={srtInput} type="file" accept=".srt" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void file.text().then(text=>{change({captions:parseSrt(text,duration)});}).catch(e=>w.notify(e.message));}}/><button onClick={()=>srtInput.current?.click()}>Import SRT</button><button onClick={()=>downloadText(toSrt(edit.captions),`${c.title.replace(/[^a-zA-Z0-9_-]/g,'_')}.srt`)} disabled={!edit.captions.length}>Save SRT</button></div><hr/><h3>Text style</h3><Field label="Font"><select value={edit.fontFamily} onChange={e=>change({fontFamily:e.target.value as EditDocument['fontFamily']})}><option>Nirmala UI</option><option>Arial</option><option>Noto Sans Devanagari</option></select></Field><div className="form-grid"><Field label="Size (1080 reference)"><input type="number" min="16" max="120" value={edit.fontSize} onChange={e=>change({fontSize:Number(e.target.value)})}/></Field><Field label="Text color"><input type="color" value={edit.color} onChange={e=>change({color:e.target.value})}/></Field></div><Field label={`Outline · ${edit.outline}px`}><input type="range" min="0" max="6" value={edit.outline} onChange={e=>change({outline:Number(e.target.value)})}/></Field><Field label={`Vertical position · ${edit.captionY}%`}><input type="range" min="10" max="90" value={edit.captionY} onChange={e=>change({captionY:Number(e.target.value)})}/></Field><label className="checkbox"><input type="checkbox" checked={edit.bold} onChange={e=>change({bold:e.target.checked})}/>Bold</label><label className="checkbox"><input type="checkbox" checked={edit.captionBackground} onChange={e=>change({captionBackground:e.target.checked})}/>Caption background</label><CaptionMotion edit={edit} change={change}/><p className="hint">Hindi captions use a Devanagari-capable font. Font must be installed on the render machine.</p></>}{tab==='Crop'&&<><h3>Frame your story</h3><Field label="Aspect ratio"><select value={edit.ratio} onChange={e=>change({ratio:e.target.value as EditDocument['ratio']})}>{['9:16','4:5','1:1','16:9'].map(r=><option key={r}>{r}</option>)}</select></Field><Field label="Sizing"><select value={edit.cropMode} onChange={e=>change({cropMode:e.target.value as 'fill'|'fit'})}><option value="fill">Fill frame (crop)</option><option value="fit">Fit (letterbox)</option></select></Field><div className="segmented crop-presets">{[['Left',0],['Center',.5],['Right',1]].map(([label,x])=><button key={label} className={!dynamicFraming&&edit.focalX===x?'selected':''} disabled={dynamicFraming} onClick={()=>change({focalX:Number(x)})}>{label}</button>)}</div><Field label={`Horizontal focal point · ${Math.round(edit.focalX*100)}%`}><input type="range" min="0" max="1" step=".01" disabled={dynamicFraming} value={edit.focalX} onChange={e=>change({focalX:Number(e.target.value)})}/></Field><Field label={`Vertical focal point · ${Math.round(edit.focalY*100)}%`}><input type="range" min="0" max="1" step=".01" disabled={dynamicFraming} value={edit.focalY} onChange={e=>change({focalY:Number(e.target.value)})}/></Field></>}<div hidden={tab!=='Crop'}><FramingControls project={p} clipId={c.id} edit={edit} time={time} seek={seek} change={change}/></div>{tab==='Audio'&&<><h3>Source audio</h3><Field label={`Gain · ${Math.round(edit.volume*100)}%`}><input type="range" min="0" max="2" step=".01" value={edit.volume} onChange={e=>change({volume:Number(e.target.value)})}/></Field><button onClick={()=>change({volume:edit.volume?0:1})}>{edit.volume?'Mute source':'Unmute source'}</button>{p.storage==='server'&&p.media?.hasAudio&&p.media.sourceAvailable!==false&&edit.sourceOutMs-edit.sourceInMs<=180000&&
  <NormalizeAudio clipId={c.id} edit={edit} change={change}/>}<hr/><Field label="Fade in (seconds)"><input type="number" min="0" max="5" step=".1" value={edit.fadeIn} onChange={e=>change({fadeIn:Number(e.target.value)})}/></Field><Field label="Fade out (seconds)"><input type="number" min="0" max="5" step=".1" value={edit.fadeOut} onChange={e=>change({fadeOut:Number(e.target.value)})}/></Field>{p.media?.hasAudio&&<label className="checkbox"><input type="checkbox" checked={!!edit.reduceRumble}
  onChange={event=>change({reduceRumble:event.target.checked})}/>Reduce low-frequency rumble</label>}<Alert>Music tracks and automatic ducking are planned.</Alert></>}{tab==='Effects'&&<><h3>Clip zoom</h3><Field label="Zoom (%)"><input type="range" min={100} max={150} step={5} value={edit.zoomPercent??100} onChange={e=>change({zoomPercent:Number(e.target.value)})}/></Field><p className="hint">{edit.zoomPercent??100}% · Centered on the framed image. Applies to preview and export.</p><Field label={`Saturation · ${Math.round((edit.saturation??1)*100)}%`}><input type="range" min={0} max={2} step=".02"
  value={edit.saturation??1} onChange={e=>change({saturation:Number(e.target.value)})}/></Field><button disabled={(edit.zoomPercent??100)===100} onClick={()=>change({zoomPercent:100})}>Reset zoom</button></>}</div></aside></div><section className="timeline"><div className="timeline-toolbar"><span className="time-readout">{timecode(time)}</span><span className="editor-divider"/><button title="Selection tool" className="selected" onClick={()=>setSelection(null)}><MousePointer2 size={15}/></button><button aria-label="Undo" disabled={!session.past.length} onClick={session.undo}><Undo2 size={15}/></button><button aria-label="Redo" disabled={!session.future.length} onClick={session.redo}><Redo2 size={15}/></button><button aria-label="Split clip" disabled={time<=0||time>=duration} onClick={()=>void split()}><Scissors size={15}/></button><button aria-label="Add timeline caption" onClick={addCaption}><Type size={15}/></button><button aria-label="Delete selected element" onClick={removeSelected}><Trash2 size={14}/></button><div className="timeline-zoom"><button aria-label="Zoom out timeline" onClick={()=>setZoom(Math.max(1,zoom-.5))}><ZoomOut size={14}/></button><input aria-label="Timeline zoom" type="range" min="1" max="8" step=".5" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/><button aria-label="Zoom in timeline" onClick={()=>setZoom(Math.min(8,zoom+.5))}><ZoomIn size={14}/></button><button aria-label="Keyboard shortcuts" onClick={()=>setHelp(true)}><HelpCircle size={15}/></button></div></div><div className="timeline-content"><div className="track-labels"><div>TRACKS</div><div><Type size={13}/>C1 <span>Captions</span></div><div><Film size={13}/>V1 <span>Source video</span></div><div><Volume2 size={13}/>A1 <span>Source audio</span></div></div><div className="track-scroll"><div className="track-canvas" style={{width:`${zoom*100}%`}}><div className="timeline-ruler">{Array.from({length:11},(_,i)=><span key={i} style={{left:`${i*10}%`}}>{timecode(duration*i/10).slice(0,5)}</span>)}</div><input aria-label="Timeline playhead" className="scrubber" type="range" min="0" max={duration} step={1000/edit.fps} value={time} onChange={e=>seek(Number(e.target.value))}/><div className="track caption-track">{edit.captions.map(cap=><button key={cap.id} onClick={()=>{setSelection(cap.id);setTab('Captions');seek(cap.startMs);}} className={selection===cap.id?'chosen':''} style={{left:`${cap.startMs/duration*100}%`,width:`${(cap.endMs-cap.startMs)/duration*100}%`}}>{cap.text}</button>)}</div><div className="track video-track">{timelineSegments(edit).map(segment=><button className="video-segment" key={segment.startMs} title={`${timecode(segment.startMs)}–${timecode(segment.endMs)} source`}
  style={{left:`${segment.timelineStart/duration*100}%`,width:`${(segment.timelineEnd-segment.timelineStart)/duration*100}%`}}
  onClick={()=>{setTab('Edit');setSelection(null);if(edit.sourceSegments?.length)seek(segment.timelineStart);}}>
  <Film size={14}/>{p.media?.name||c.title}<span>{((segment.endMs-segment.startMs)/1000).toFixed(2)}s</span>
</button>)}</div><div className="track audio-track"><button className={edit.volume===0?'muted-track':''} onClick={()=>setTab('Audio')}><Volume2 size={14}/>{p.media?.hasAudio?'Source audio':'No source audio'}<span>{Math.round(edit.volume*100)}%</span></button><AudioWaveform clipId={c.id} project={p} edit={edit}/></div><div className="playhead" style={{left:`${time/duration*100}%`}}/></div></div></div><div className="trim-strip"><span>Source trim</span><label>IN<input aria-label="Drag source in" type="range" min="0" max={Math.max(0,edit.sourceOutMs-1000/edit.fps)} step={1000/edit.fps} value={edit.sourceInMs} onChange={e=>range(Math.round(Number(e.target.value)),edit.sourceOutMs)}/><b>{timecode(edit.sourceInMs)}</b></label><label>OUT<input aria-label="Drag source out" type="range" min={edit.sourceInMs+1000/edit.fps} max={sourceDuration} step={1000/edit.fps} value={edit.sourceOutMs} onChange={e=>range(edit.sourceInMs,Math.round(Number(e.target.value)))}/><b>{timecode(edit.sourceOutMs)}</b></label><small>Frame snapping · {edit.fps} fps</small></div></section>{exportOpen&&<Modal title="Export your clip" onClose={()=>setExportOpen(false)}>{exportError&&<Alert>{exportError}</Alert>}<div className="export-summary"><Film size={26}/><div><h3>{c.title}</h3><p>{(duration/1000).toFixed(2)} seconds · {edit.captions.length} captions</p></div></div><div className="form-grid"><Field label="Resolution profile"><select value={edit.resolution} onChange={e=>change({resolution:e.target.value as EditDocument['resolution']})}><option value="540">Quick preview · 540 wide</option><option value="720">HD · 720 wide</option><option value="1080">Full HD · 1080 wide</option></select></Field><Field label="Frame rate"><select value={edit.preserveSourceFps?'source':edit.fps} onChange={e=>{
  if(e.target.value==='source')change({preserveSourceFps:true});
  else change({fps:Number(e.target.value) as EditDocument['fps'],preserveSourceFps:false});
}}><option value="source" disabled={!p.media?.fps||p.media.fps==='0/1'}>Match source</option>{[24,30,60].map(x=><option value={x} key={x}>{x} fps</option>)}</select></Field>
<Field label="Encoding quality"><select value={edit.quality??'standard'} onChange={e=>change({quality:e.target.value as EditDocument['quality']})}>
  <option value="high">High</option><option value="standard">Standard</option><option value="compact">Compact</option>
</select></Field></div><dl className="export-spec"><dt>Format</dt><dd>MP4 · H.264 / AAC</dd><dt>Dimensions</dt><dd>{dims.width} × {dims.height}</dd><dt>Captions</dt><dd>{edit.captions.length?'Burned in':'None'}</dd><dt>Watermark</dt><dd>None</dd></dl>{!available&&<Alert>{p.storage!=='server'?'This is a browser-only project. Import your video with the media service connected to render real MP4s.':!w.online?'The media service is offline. Start npm run api.':'FFmpeg / ffprobe are unavailable. Install them and restart the API.'}</Alert>}<p className="hint">A sequential local worker renders the saved edit. The MP4 is validated before it becomes downloadable.</p><div className="dialog-actions"><button onClick={()=>setExportOpen(false)}>Back to editor</button><button className="primary" disabled={!available||exportBusy} onClick={()=>void render()}><Download size={15}/>{exportBusy?'Queueing…':'Render MP4'}</button></div></Modal>}{help&&<Modal title="Editor shortcuts" onClose={()=>setHelp(false)}><table><tbody>{editorShortcuts.map(([key,action])=><tr key={key}><td><kbd>{key}</kbd></td><td>{action}</td></tr>)}</tbody></table><p className="hint">Shortcuts are suspended while typing or using a dialog.</p></Modal>}{confirmDelete&&<Modal title="Delete this clip?" onClose={()=>setConfirmDelete(false)}><p>The source video remains untouched.</p><div className="dialog-actions"><button onClick={()=>setConfirmDelete(false)}>Keep clip</button><button className="danger" onClick={()=>void w.removeClip(p,c).then(()=>router.push(`/projects/${p.id}/clips`)).catch(e=>w.notify(e.message))}>Delete clip</button></div></Modal>}</div>;}
