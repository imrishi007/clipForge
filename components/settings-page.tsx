'use client';

import Link from 'next/link';
import { useState } from 'react';
import { templates, type Settings } from '@/lib/model';
import { Alert, Field, PageHeader } from './ui';
import { useWorkspace } from './workspace-context';
import { request } from '@/lib/repository';

type Resources = { logicalCpus: number; availableRamMiB?: number; ramMiB?: number; heavyJobs: number;
  gpu?: { name: string; usedMiB: number | null; totalMiB: number | null; temperatureC: number | null } };
const encoderLabels = { libx264: 'Software (H.264)', h264_nvenc: 'NVIDIA NVENC', h264_qsv: 'Intel Quick Sync', h264_amf: 'AMD AMF' };

export function SettingsPage() {
  const workspace = useWorkspace();
  const [draft, setDraft] = useState<Partial<Settings>>({});
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [resources, setResources] = useState<Resources>();
  const [hardware, setHardware] = useState<Record<string, { available: boolean; detail: string }>>({});
  const settings = { ...workspace.data.settings, ...draft };
  const update = (patch: Partial<Settings>) => setDraft((value) => ({ ...value, ...patch }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await workspace.saveSettings(settings);
      setDraft({});
      workspace.notify('Preferences saved.');
    } catch (error) {
      workspace.notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setChecking(true);
    try {
      await workspace.refresh();
      const [resources, hardware] = await Promise.all([
        request<Resources>('/api/performance'),
        request<Record<string, { available: boolean; detail: string }>>('/api/performance/hardware', { signal: AbortSignal.timeout(60000) }),
      ]);
      setResources(resources);
      setHardware(hardware);
    } catch (error) {
      workspace.notify((error as Error).message);
    } finally { setChecking(false); }
  }

  return <>
    <PageHeader title="Settings" description="Manage project defaults and check the local media service."/>
    <div className="dashboard-grid">
      <form className="campaign-panel" onSubmit={save}>
        <h2>Workspace preferences</h2>
        <div className="form-grid">
          <Field label="Workspace appearance"><select value={settings.theme} onChange={(event) => update({ theme: event.target.value as Settings['theme'] })}>
            <option value="auto">Workspace theme</option><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
          </select></Field>
          <Field label="Export encoder"><select value={settings.exportEncoder ?? 'libx264'} onChange={event =>
            update({ exportEncoder: event.target.value as Settings['exportEncoder'] })}>
            {Object.entries(encoderLabels).map(([id, label]) => <option key={id} value={id}
              disabled={id !== 'libx264' && !hardware[id]?.available && settings.exportEncoder !== id}>{label}</option>)}
          </select></Field>
          <Field label="Default source language"><select value={settings.language} onChange={(event) => update({ language: event.target.value })}>
            {['English', 'Hindi', 'Hinglish', 'Auto', 'Other'].map((item) => <option key={item}>{item}</option>)}
          </select></Field>
          <Field label="Default clip length (seconds)"><input required type="number" min={1} max={3600} value={settings.defaultDuration} onChange={(event) => update({ defaultDuration: Number(event.target.value) })}/></Field>
          <Field label="Default output aspect"><select value={settings.defaultRatio} onChange={(event) => update({ defaultRatio: event.target.value })}>
            {['9:16', '4:5', '1:1', '16:9'].map((item) => <option key={item}>{item}</option>)}
          </select></Field>
          <Field label="Default caption style"><select value={settings.defaultCaption} onChange={(event) => update({ defaultCaption: event.target.value })}>
            {templates.map((item) => <option key={item.name}>{item.name}</option>)}
          </select></Field>
          <Field label="Performance profile"><select value={settings.performanceProfile ?? 'lite'} onChange={event =>
            update({ performanceProfile: event.target.value as Settings['performanceProfile'] })}>
            <option value="lite">Lite · 360p preview</option>
            <option value="balanced">Balanced · 540p preview</option>
            <option value="quality">Maximum Quality · 720p preview</option>
          </select></Field>
        </div>
        <p className="hint">Lite is recommended if playback freezes. Your export resolution and quality stay set by the clip.</p>
        <div className="dialog-actions"><button className="primary" disabled={busy}>Save preferences</button></div>
      </form>
      <section className="campaign-panel">
        <h2>Media service</h2>
        {workspace.online ? <dl>
          <dt>Storage</dt><dd>Local</dd>
          <dt>Worker</dt><dd>{workspace.diagnostics.workerRunning ? 'Running' : 'Stopped'}</dd>
          <dt>FFmpeg</dt><dd>{workspace.diagnostics.ffmpeg ? 'Available' : 'Unavailable'}</dd>
          <dt>ffprobe</dt><dd>{workspace.diagnostics.ffprobe ? 'Available' : 'Unavailable'}</dd>
        </dl> : <Alert>Service offline. Start the local API to check media tools and render exports.</Alert>}
        <button disabled={checking} onClick={() => void check()}>{checking ? 'Checking…' : 'Check connection and hardware'}</button>
        {resources && <dl>
          <dt>Processor</dt><dd>{resources.logicalCpus} logical cores · {resources.heavyJobs} queued job at a time</dd>
          {resources.ramMiB != null && <><dt>Memory available</dt><dd>{resources.availableRamMiB} / {resources.ramMiB} MiB</dd></>}
          {resources.gpu && <><dt>{resources.gpu.name}</dt><dd>{resources.gpu.usedMiB ?? '—'} / {resources.gpu.totalMiB ?? '—'} MiB VRAM
            {resources.gpu.temperatureC != null && ` · ${resources.gpu.temperatureC} °C`}</dd></>}
          {Object.entries(hardware).map(([id, result]) => <div className="row-between" key={id} title={result.detail}>
            <dt>{encoderLabels[id as keyof typeof encoderLabels] ?? 'NVIDIA decode'}</dt><dd>{result.available ? 'Verified' : 'Unavailable'}</dd>
          </div>)}
        </dl>}
        <p className="hint">Source files and exports are stored on this computer.</p>
        <Link href="/help">Keyboard shortcuts and workflow help</Link>
      </section>
    </div>
  </>;
}
