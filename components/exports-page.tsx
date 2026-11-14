'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { type ExportJob, timecode } from '@/lib/model';
import { api, mediaUrl, updateExportJob } from '@/lib/repository';
import { Alert, Empty, PageHeader } from './ui';

export function ExportsPage() {
  const [jobs, setJobs] = useState<ExportJob[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [pending, setPending] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let delay = 4000;
      try {
        const current = await api.jobs();
        if (disposed) return;
        setJobs(current);
        setError('');
        if (current.some((job) => job.status === 'queued' || job.status === 'running')) delay = 1000;
      } catch (error) {
        if (disposed) return;
        setError(`Export history is unavailable. ${(error as Error).message}`);
      }
      timer = setTimeout(poll, delay);
    }
    if (pending === null) void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [pending, reload]);

  async function changeJob(id: string, action: 'cancel' | 'retry') {
    setPending(id);
    try {
      const result = await updateExportJob(id, action);
      setJobs((current) => current?.map((job) => job.id === id ? result : job) ?? null);
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setPending(null);
    }
  }

  const [actionError, setActionError] = useState('');
  const visible = jobs?.filter((job) => filter === 'all' || job.status === filter);
  return <>
    <PageHeader title="Exports" description="Monitor render jobs and download validated MP4 files."
      action={<button onClick={() => setReload(reload + 1)}><RefreshCw size={15}/>Refresh</button>}/>
    {error && <Alert>{error}</Alert>}
    {actionError && <Alert>{actionError}</Alert>}
    {jobs === null && !error && <div className="loading" role="status">Loading export history…</div>}
    {jobs !== null && <>
      <div className="filterbar">
        <select aria-label="Export status" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All exports</option><option value="queued">Queued</option>
          <option value="running">Running</option><option value="succeeded">Completed</option>
          <option value="failed">Failed</option><option value="cancelled">Cancelled</option>
        </select>
      </div>
      {visible?.length ? <ul className="export-list" aria-label="Export history">{visible.map((job) => <li className="panel export-row" key={job.id}>
        <div>
          <h3>{job.title}</h3>
          <p className="muted">{new Date(job.createdAt).toLocaleString()} · Edit revision {job.editRevision}</p>
          <p>{job.stage}{job.status === 'running' && job.progress !== null ? ` · ${Math.round(job.progress)}%` : ''}</p>
          {job.status === 'running' && <progress aria-label={`Rendering ${job.title}`} max={100} value={job.progress ?? undefined}/>}
          {job.status === 'succeeded' && job.metadata && <p className="muted">{job.metadata.width} × {job.metadata.height} · {timecode(job.metadata.durationMs)} · {job.metadata.hasAudio ? 'AAC audio' : 'Silent'}</p>}
          {job.error && <p className="danger-text">{job.error}</p>}
          {job.logs.length > 0 && <details><summary>Render log</summary><ul>{job.logs.map((entry, index) => <li key={index}>{entry}</li>)}</ul></details>}
        </div>
        <div className="export-actions">
          {(job.status === 'queued' || job.status === 'running') && <button disabled={pending !== null || job.stage === 'Cancelling'} onClick={() => { setActionError(''); void changeJob(job.id, 'cancel'); }}>Cancel</button>}
          {(job.status === 'failed' || job.status === 'cancelled') && <button disabled={pending !== null} onClick={() => { setActionError(''); void changeJob(job.id, 'retry'); }}>Retry</button>}
          {job.status === 'succeeded' && <a className="button primary" href={mediaUrl(`/api/exports/${job.id}/download`)}><Download size={15}/>Download MP4</a>}
        </div>
      </li>)}</ul> : <Empty title={jobs.length ? 'No matching exports' : 'No exports yet'} description={jobs.length ? 'Choose another status to see more jobs.' : 'Open a clip from your imported footage and select Export.'}>
        {!jobs.length && <Link className="button" href="/projects">Open projects</Link>}
      </Empty>}
    </>}
  </>;
}
