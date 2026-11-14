'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import {editDuration, dimensions, timecode, type Campaign, type ExportJob } from '@/lib/model';
import { api } from '@/lib/repository';
import { Alert, Empty, Field, Modal, PageHeader } from './ui';
import { useWorkspace } from './workspace-context';

const platforms = ['Instagram Reels', 'YouTube Shorts', 'TikTok', 'Other'];
const statuses = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected' };
type Submission = Campaign['submissions'][number];

function newCampaign(): Campaign {
  return { id: crypto.randomUUID(), title: '', platform: platforms[0], permissionNotes: '', minSeconds: 0,
    maxSeconds: 60, ratio: '9:16', branding: '', disclaimer: '', dueAt: '', clipIds: [], submissions: [] };
}

export function CampaignsPage({ id }: { id?: string }) {
  const workspace = useWorkspace();
  const router = useRouter();
  const campaign = workspace.data.campaigns.find((item) => item.id === id);
  const [draft, setDraft] = useState<Campaign | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exports, setExports] = useState<ExportJob[]>([]);

  useEffect(() => {
    if (!id || !workspace.online) return;
    let active = true;
    void api.jobs().then((jobs) => { if (active) setExports(jobs); }).catch(() => { if (active) setExports([]); });
    return () => { active = false; };
  }, [id, workspace.online]);

  const clips = workspace.data.projects.flatMap((project) => project.clips.map((clip) => ({ project, clip })));
  async function persist(next: Campaign, onSaved?: (saved: Campaign) => void) {
    setBusy(true);
    setError('');
    try {
      const saved = await workspace.saveCampaign(next);
      onSaved?.(saved);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function saveRequirements(event: React.FormEvent) {
    event.preventDefault();
    if (!draft?.title.trim()) return;
    if (draft.maxSeconds < draft.minSeconds) {
      setError('Maximum duration must be at least the minimum.');
      return;
    }
    void persist({ ...draft, title: draft.title.trim() }, (saved) => {
      setDraft(null);
      router.push(`/campaigns/${saved.id}`);
    });
  }

  function saveSubmission(event: React.FormEvent) {
    event.preventDefault();
    if (!campaign || !submission) return;
    if (submission.url && !/^https?:\/\//i.test(submission.url)) {
      setError('Enter an HTTP or HTTPS link.');
      return;
    }
    const submissions = [...campaign.submissions.filter((item) => item.clipId !== submission.clipId), submission];
    void persist({ ...campaign, submissions }, () => setSubmission(null));
  }

  if (id && !campaign) return <Empty title="Campaign unavailable" description="Open the campaign library or reconnect the media service."><Link href="/campaigns" className="button">Campaigns</Link></Empty>;
  const attachable = clips.filter(({ clip }) => clip.status !== 'rejected' && !campaign?.clipIds.includes(clip.id));
  return <>
    {campaign ? <>
      <Link href="/campaigns">All campaigns</Link>
      <PageHeader title={campaign.title} description={`${campaign.platform} · ${campaign.ratio} · ${campaign.minSeconds}–${campaign.maxSeconds} seconds`}
        action={<button onClick={() => { setError(''); setDraft(campaign); }}>Edit requirements</button>}/>
      <section className="campaign-panel" aria-label="Campaign requirements">
        <h2>Requirements</h2>
        {campaign.dueAt && <p>Due {campaign.dueAt}</p>}
        {campaign.permissionNotes && <p>{campaign.permissionNotes}</p>}
        {campaign.branding && <p>Branding: {campaign.branding}</p>}
        {campaign.disclaimer && <p>Disclaimer: {campaign.disclaimer}</p>}
      </section>
      <div className="section-heading"><h2>Linked clips</h2></div>
      <div className="filterbar">
        <select aria-label="Clip to attach" value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">Choose a clip</option>
          {attachable.map(({ project, clip }) => <option key={clip.id} value={clip.id}>{project.title} · {clip.title}</option>)}
        </select>
        <button disabled={!target || busy} onClick={() => void persist({ ...campaign, clipIds: [...campaign.clipIds, target] }, () => setTarget(''))}>Attach clip</button>
      </div>
      <ul className="export-list">{campaign.clipIds.map((clipId) => {
        const linked = clips.find(({ clip }) => clip.id === clipId);
        const saved = campaign.submissions.find((item) => item.clipId === clipId);
        const job = exports.find((item) => item.clipId === clipId && item.status === 'succeeded' && item.metadata && item.editRevision === linked?.clip.edit.revision);
        const edit = linked?.clip.edit;
        const metadata = job?.metadata;
        const duration = metadata?.durationMs ?? (edit ? editDuration(edit) : null);
        const size = metadata && edit ? dimensions(campaign.ratio as typeof edit.ratio, edit.resolution) : null;
        const matchesRatio = metadata && size ? metadata.width === size.width && metadata.height === size.height : edit?.ratio === campaign.ratio;
        return <li className="campaign-panel export-row" key={clipId}>
          <div>
            {linked ? <h3><Link href={`/editor/${linked.project.id}/${clipId}`}>{linked.clip.title}</Link></h3> : <h3>Clip unavailable</h3>}
            {duration !== null && <>
              <p className="muted">{metadata ? 'Validated MP4' : 'Edit settings'} · {timecode(duration)}</p>
              <p>{duration >= campaign.minSeconds * 1000 && duration <= campaign.maxSeconds * 1000 ? 'Duration meets requirements' : 'Duration outside required range'}</p>
              <p>{matchesRatio ? 'Aspect meets requirements' : 'Aspect differs from requirements'}</p>
            </>}
            {campaign.branding && <p>Branding: Manual review required</p>}
            {campaign.disclaimer && <p>Disclaimer: Manual review required</p>}
            {saved && <p>{statuses[saved.status as keyof typeof statuses] ?? saved.status} · {saved.views} views · {saved.payout} estimated payout {/^https?:\/\//i.test(saved.url) && <a href={saved.url} target="_blank" rel="noreferrer">Open submission</a>}</p>}
          </div>
          <button disabled={busy} onClick={() => { setError(''); setSubmission(saved ?? { clipId, url: '', status: 'draft', views: 0, payout: 0 }); }}>Edit submission</button>
        </li>;
      })}</ul>
      {!campaign.clipIds.length && <Empty title="No clips linked" description="Attach a clip to check its duration and framing against this campaign."/>}
    </> : <>
      <PageHeader title="Campaigns" description="Track requirements, linked clips and submissions."
        action={<button className="primary" onClick={() => { setError(''); setDraft(newCampaign()); }}><Plus size={15}/>New campaign</button>}/>
      {workspace.data.campaigns.length ? <ul className="export-list">{workspace.data.campaigns.map((item) => <li className="campaign-panel export-row" key={item.id}>
        <div><h3><Link href={`/campaigns/${item.id}`}>{item.title}</Link></h3><p className="muted">{item.platform} · {item.ratio} · {item.clipIds.length} linked clips</p></div>
        <Link className="button" href={`/campaigns/${item.id}`}>Open campaign</Link>
      </li>)}</ul> : <Empty title="No campaigns yet" description="Create a campaign to track the requirements for a group of clips."/>}
    </>}
    {error && !draft && !submission && <Alert>{error}</Alert>}
    {draft && <Modal title={campaign ? 'Edit requirements' : 'New campaign'} onClose={() => setDraft(null)}>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={saveRequirements}>
        <div className="form-grid">
          <Field label="Campaign name"><input required maxLength={180} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></Field>
          <Field label="Platform"><select value={draft.platform} onChange={(event) => setDraft({ ...draft, platform: event.target.value })}>{platforms.map((platform) => <option key={platform}>{platform}</option>)}</select></Field>
          <Field label="Minimum seconds"><input required type="number" min={0} step="0.1" value={draft.minSeconds} onChange={(event) => setDraft({ ...draft, minSeconds: Number(event.target.value) })}/></Field>
          <Field label="Maximum seconds"><input required type="number" min={0.1} step="0.1" value={draft.maxSeconds} onChange={(event) => setDraft({ ...draft, maxSeconds: Number(event.target.value) })}/></Field>
          <Field label="Aspect ratio"><select value={draft.ratio} onChange={(event) => setDraft({ ...draft, ratio: event.target.value })}>{['9:16', '4:5', '1:1', '16:9'].map((ratio) => <option key={ratio}>{ratio}</option>)}</select></Field>
          <Field label="Due date"><input type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })}/></Field>
        </div>
        <Field label="Source permission"><textarea value={draft.permissionNotes} onChange={(event) => setDraft({ ...draft, permissionNotes: event.target.value })}/></Field>
        <Field label="Required branding"><input value={draft.branding} onChange={(event) => setDraft({ ...draft, branding: event.target.value })}/></Field>
        <Field label="Required disclaimer"><input value={draft.disclaimer} onChange={(event) => setDraft({ ...draft, disclaimer: event.target.value })}/></Field>
        <div className="dialog-actions"><button className="primary" disabled={busy}>Save campaign</button></div>
      </form>
    </Modal>}
    {submission && <Modal title="Edit submission" onClose={() => setSubmission(null)}>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={saveSubmission}>
        <Field label="Submission link"><input type="url" maxLength={2000} value={submission.url} onChange={(event) => setSubmission({ ...submission, url: event.target.value })}/></Field>
        <Field label="Submission status"><select value={submission.status} onChange={(event) => setSubmission({ ...submission, status: event.target.value })}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <div className="form-grid">
          <Field label="Views"><input type="number" min={0} step={1} value={submission.views} onChange={(event) => setSubmission({ ...submission, views: Number(event.target.value) })}/></Field>
          <Field label="Estimated payout"><input type="number" min={0} step="0.01" value={submission.payout} onChange={(event) => setSubmission({ ...submission, payout: Number(event.target.value) })}/></Field>
        </div>
        <div className="dialog-actions"><button className="primary" disabled={busy}>Save submission</button></div>
      </form>
    </Modal>}
  </>;
}
