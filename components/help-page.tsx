'use client';

import Link from 'next/link';
import { useState } from 'react';
import { editorShortcuts } from '@/lib/shortcuts';
import { PageHeader } from './ui';

export function HelpPage() {
  const [query, setQuery] = useState('');
  const visible = ([['Ctrl + K', 'Find a project'], ...editorShortcuts] as const)
    .filter(([key, action]) => `${key} ${action}`.toLowerCase().includes(query.trim().toLowerCase()));

  return <>
    <PageHeader title="Help & shortcuts" description="Import, edit and export from the local workspace."/>
    <div className="dashboard-grid">
      <section className="campaign-panel">
        <h2>Keyboard shortcuts</h2>
        <div className="filterbar"><input aria-label="Search shortcuts" placeholder="Search shortcuts…" value={query} onChange={(event) => setQuery(event.target.value)}/></div>
        <p className="hint">Editor shortcuts pause while you type or use a dialog.</p>
        {visible.length ? <table className="shortcut-table"><thead><tr><th scope="col">Action</th><th scope="col">Shortcut</th></tr></thead>
          <tbody>{visible.map(([key, action]) => <tr key={key}><td>{action}</td><td><kbd>{key}</kbd></td></tr>)}</tbody>
        </table> : <p role="status">No shortcuts match your search.</p>}
      </section>
      <section className="campaign-panel">
        <h2>From source to MP4</h2>
        <ol>
          <li>Import a video you have permission to edit.</li>
          <li>Create a manual clip and choose its start and end times.</li>
          <li>Frame it, add captions, then render from the editor.</li>
          <li>Download the validated file from Exports.</li>
        </ol>
        <Link className="button" href="/settings">Check media service</Link>
      </section>
    </div>
  </>;
}
