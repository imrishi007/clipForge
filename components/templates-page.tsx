'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { templates } from '@/lib/model';
import { presetPatch } from '@/lib/presets';
import { Alert, Empty, Field, Modal, PageHeader } from './ui';
import { useWorkspace } from './workspace-context';

export function TemplatesPage() {
  const workspace = useWorkspace();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState('');
  const [draft, setDraft] = useState<(typeof templates)[number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const presets = [...templates, ...workspace.data.customTemplates];
  const editableProjects = workspace.data.projects.filter((project) => !project.archived && project.clips.some((clip) => clip.status !== 'rejected'));

  async function apply(preset: (typeof templates)[number]) {
    const project = editableProjects.find((item) => item.clips.some((clip) => clip.id === target));
    const clip = project?.clips.find((item) => item.id === target);
    if (!project || !clip) return;
    setBusy(true);
    setError('');
    try {
      await workspace.saveEdit(project, clip, { ...clip.edit, ...presetPatch(preset) });
      router.push(`/editor/${project.id}/${clip.id}`);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function savePreset(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const name = draft.name.trim();
    if (!name || presets.some((preset) => preset.name.toLowerCase() === name.toLowerCase())) {
      setError('Choose a unique preset name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await workspace.custom({ ...draft, name });
      setDraft(null);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const visible = presets.filter((preset) => preset.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <PageHeader title="Templates" description="Preview an editing style and apply it to a clip."
      action={<button className="primary" onClick={() => { setError(''); setDraft({ ...templates[0], name: '', description: 'Custom editing preset' }); }}><Plus size={15}/>New preset</button>}/>
    {!draft && error && <Alert>{error}</Alert>}
    <div className="filterbar">
      <input aria-label="Search templates" placeholder="Search templates…" value={query} onChange={(event) => setQuery(event.target.value)}/>
      <select aria-label="Clip to style" value={target} onChange={(event) => setTarget(event.target.value)}>
        <option value="">Choose a clip to style</option>
        {editableProjects.map((project) => <optgroup key={project.id} label={project.title}>
          {project.clips.filter((clip) => clip.status !== 'rejected').map((clip) => <option key={clip.id} value={clip.id}>{clip.title}</option>)}
        </optgroup>)}
      </select>
    </div>
    {visible.length ? <div className="clip-grid">{visible.map((preset) => <article className="preset-card" key={preset.name}>
      <div className="preset-preview" style={{ color: preset.color, fontWeight: preset.bold ? 700 : 400, fontSize: `${preset.fontSize / 2.5}px` }}>
        <span className={preset.captionBackground ? 'preset-preview-box' : undefined}><span style={{ color: preset.captionHighlight ?? undefined }}>Every</span> story starts here.<br/>हर पल में एक कहानी है।</span>
      </div>
      <div className="preset-card-body"><h3>{preset.name}</h3><button aria-label={`Apply ${preset.name}`} disabled={!target || busy} onClick={() => void apply(preset)}>Apply to clip</button></div>
    </article>)}</div> : <Empty title="No matching templates" description="Search for a different preset name."/>}
    {draft && <Modal title="New caption preset" onClose={() => { setError(''); setDraft(null); }}>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={savePreset}>
        <Field label="Preset name"><input required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></Field>
        <div className="form-grid">
          <Field label="Caption size"><input required type="number" min={16} max={120} value={draft.fontSize} onChange={(event) => setDraft({ ...draft, fontSize: Number(event.target.value) })}/></Field>
          <Field label="Text color"><input type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })}/></Field>
        </div>
        <label className="checkbox"><input type="checkbox" checked={draft.bold} onChange={(event) => setDraft({ ...draft, bold: event.target.checked })}/>Bold</label>
        <label className="checkbox"><input type="checkbox" checked={draft.captionBackground} onChange={(event) => setDraft({ ...draft, captionBackground: event.target.checked })}/>Caption background</label>
        <div className="form-grid">
          <Field label="Preset caption motion"><select value={draft.captionAnimation ?? 'none'} onChange={event =>
            setDraft({ ...draft, captionAnimation: event.target.value as typeof draft.captionAnimation })}>
            <option value="none">Still</option><option value="fade">Soft fade</option><option value="pop">Pop in</option>
          </select></Field>
          <Field label="Preset framing"><select value={draft.cropMode ?? 'fill'} onChange={event =>
            setDraft({ ...draft, cropMode: event.target.value as typeof draft.cropMode })}>
            <option value="fill">Fill frame</option><option value="fit">Fit frame</option>
          </select></Field>
          {([['zoomPercent', 'Preset zoom', 100, 150, 1], ['saturation', 'Preset saturation', 0, 2, .02],
            ['volume', 'Preset source gain', 0, 2, .05], ['fadeOut', 'Preset fade out (seconds)', 0, 5, .01]] as const)
            .map(([key, label, min, max, step]) => <Field key={key} label={label}><input type="number" required
              min={min} max={max} step={step} value={draft[key] ?? (key === 'zoomPercent' ? 100 : key === 'fadeOut' ? 0 : 1)}
              onChange={event => setDraft({ ...draft, [key]: Number(event.target.value) })}/></Field>)}
        </div>
        <div className="dialog-actions"><button className="primary" disabled={busy}>Save preset</button></div>
      </form>
    </Modal>}
  </>;
}
