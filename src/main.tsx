import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';

const boards = ['Customer Commitments', 'Production Issues', 'Release Management'];
const metrics = [
  { label: 'DEPLOYMENTS TODAY', icon: '↗', note: 'Planned start date is today' },
  { label: 'IN ROLLOUT', icon: '◷', note: 'At least one step in progress' },
  { label: 'OPEN PROD ISSUES', icon: '!', note: 'High  ·  Medium  ·  Low' },
  { label: 'COMMITMENTS AT RISK', icon: '◇', note: 'Past due or due within 7 days' },
  { label: 'CLOSED YESTERDAY', icon: '✓', note: 'Completed in the last 24 hours', featured: true },
];

function App() {
  return (
    <main className="app-shell" aria-label="Daily R&D Sync">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Daily R&D Sync home">
          <img src="/src/assets/check-point-logo-reversed.svg" alt="Check Point" />
          <span>Daily R&amp;D Sync</span>
        </a>
        <button className="date-stamp" type="button" aria-label="Meeting date: Monday, 12 October 2026">
          <span aria-hidden="true">▦</span> MON 12 OCT 2026
        </button>
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input type="search" placeholder="Search boards" aria-label="Search all boards" />
          <kbd>⌘ K</kbd>
        </label>
        <div className="presence" aria-label="Presence">
          <span className="presence-dot" /> <span>TEAM</span>
          <div className="avatar-stack" aria-hidden="true"><i>AM</i><i>YK</i><i>+4</i></div>
        </div>
        <button className="meeting-button" type="button"><span aria-hidden="true">▶</span> Meeting Mode</button>
        <button className="user-menu" type="button" aria-label="User menu for Noam"><span className="user-avatar">N</span><span className="user-name">Noam</span><span aria-hidden="true">⌄</span></button>
      </header>

      <div className="page-content">
        <nav className="board-tabs" aria-label="Boards" role="tablist">
          {boards.map((board, index) => (
            <button key={board} className={`board-tab${index === 0 ? ' active' : ''}`} type="button" role="tab" aria-selected={index === 0}>
              {board}<span className="count-badge" aria-label="0 active items">0</span>{index === 0 && <span className="changed-dot" aria-label="Changed since last viewed" />}
            </button>
          ))}
        </nav>

        <section className="summary-section" aria-label="Daily summary">
          <div className="summary-heading"><div><p className="eyebrow">MONDAY, OCTOBER 12</p><h1>Daily overview</h1></div><span className="summary-caption">LIVE MEETING SNAPSHOT</span></div>
          <div className="summary-grid">
            {metrics.map((metric) => (
              <button className={`summary-card${metric.featured ? ' featured' : ''}`} type="button" key={metric.label}>
                <span className="metric-label"><span className="metric-symbol" aria-hidden="true">{metric.icon}</span>{metric.label}</span>
                <span className="metric-empty"><strong>—</strong><small>items</small></span>
                <span className="metric-foot">{metric.note}<span className="metric-arrow" aria-hidden="true">↗</span></span>
              </button>
            ))}
          </div>
        </section>
        <section className="board-placeholder" aria-label="Board content">
          <div className="placeholder-top"><div><span className="placeholder-mark" aria-hidden="true">◈</span><div><p className="eyebrow">BOARD 01</p><h2>Customer Commitments</h2></div></div><span className="unit-tag">0 ACTIVE</span></div>
          <div className="empty-board"><span className="empty-icon" aria-hidden="true">⌕</span><p>Board content will appear here</p><span>Daily meeting updates at a glance</span></div>
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
