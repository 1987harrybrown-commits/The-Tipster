const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL  = 'https://eyhlzzaaxrwisrtwyoyh.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aGx6emFheHJ3aXNydHd5b3loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNzkyNzcsImV4cCI6MjA4ODk1NTI3N30.iqIk52att2Lv2o6m70Ht1LVWVgqbmLwptDqTxDq12AI';

const db = createClient(SUPABASE_URL, SUPABASE_ANON);

// Escape anything interpolated into the HTML below. None of these fields is
// meant to contain markup — they are team names, leagues and selections that
// originate from an upstream feed — so a stray < or & should render, not parse.
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}


function fmt(n,d=2){return(n>=0?'+':'')+parseFloat(n).toFixed(d);}
function fmtDate(d){return new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'});}

module.exports = async (req, res) => {
  const [{ data: history }, { data: stats }] = await Promise.all([
    db.from('results_history').select('*').order('settled_at',{ascending:false}).limit(100),
    db.from('stats_cache').select('*').eq('id',1).single()
  ]);

  // Staked bets only, so win rate and P/L describe the same population.
  // Short-price "insight" picks carry stake 0 and were never advised as bets:
  // they counted towards win rate but contributed nothing to profit.
  const staked = r => r.tier !== 'insight' && parseFloat(r.stake ?? 1) > 0;
  const rows      = (history || []).filter(staked);
  const won       = rows.filter(r=>r.result==='WON').length;
  const lost      = rows.filter(r=>r.result==='LOST').length;
  const total     = won + lost;
  const winRate   = stats?.win_rate || (total>0?((won/total)*100).toFixed(1):0);
  const pl        = stats?.total_pl || rows.reduce((s,r)=>s+parseFloat(r.profit_loss||0),0);
  const roi       = stats?.roi || 0;
  const totalWon  = stats?.total_won || won;
  const totalLost = stats?.total_lost || lost;

  // Last 30 days by day
  const byDay = {};
  const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate()-30);
  rows.filter(r=>new Date(r.settled_at)>=thirtyAgo).forEach(r=>{
    const day = r.settled_at?.slice(0,10) || new Date(r.settled_at).toISOString().slice(0,10);
    if(!byDay[day]) byDay[day]={won:0,lost:0,pl:0};
    if(r.result==='WON') byDay[day].won++;
    if(r.result==='LOST') byDay[day].lost++;
    byDay[day].pl += parseFloat(r.profit_loss||0);
  });

  const dayRows = Object.entries(byDay).sort((a,b)=>b[0].localeCompare(a[0])).map(([day,d])=>`
    <tr>
      <td>${fmtDate(day)}</td>
      <td>${d.won+d.lost}</td>
      <td style="color:#18e07a">${d.won}</td>
      <td style="color:#ff3d5a">${d.lost}</td>
      <td style="color:#18e07a">${d.won+d.lost>0?((d.won/(d.won+d.lost))*100).toFixed(0)+'%':'—'}</td>
      <td style="color:${d.pl>=0?'#18e07a':'#ff3d5a'};font-family:monospace">${fmt(d.pl)}u</td>
    </tr>`).join('');

  const recentRows = rows.slice(0,30).map(r=>`
    <tr>
      <td>${fmtDate(r.settled_at)}</td>
      <td>${esc(r.sport||'')}</td>
      <td>${esc(r.event||'')}</td>
      <td>${esc(r.selection||'')}</td>
      <td style="color:#f0b429;font-family:monospace">${parseFloat(r.odds||0).toFixed(2)}</td>
      <td><span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:700;font-family:monospace;background:${r.result==='WON'?'rgba(24,224,122,0.1)':'rgba(255,61,90,0.1)'};color:${r.result==='WON'?'#18e07a':'#ff3d5a'}">${esc(r.result)}</span></td>
      <td style="color:${parseFloat(r.profit_loss||0)>=0?'#18e07a':'#ff3d5a'};font-family:monospace">${fmt(parseFloat(r.profit_loss||0))}u</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Verified Betting Tips Track Record — ${winRate}% Win Rate | The Tipster</title>
<meta name="description" content="Fully transparent verified betting tips track record. ${totalWon} winners from ${totalWon+totalLost} settled tips. ${winRate}% win rate. ${fmt(pl)}u profit. Every result published — nothing excluded.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://www.thetipsteredge.com/results">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<script type="application/ld+json">${JSON.stringify({
  "@context":"https://schema.org",
  "@type":"Dataset",
  "name":"The Tipster — Verified Betting Tips Track Record",
  "description":`Complete betting tips results history. ${totalWon} winners from ${totalWon+totalLost} tips. ${winRate}% win rate.`,
  "url":"https://www.thetipsteredge.com/results",
  "publisher":{"@type":"Organization","name":"The Tipster","url":"https://www.thetipsteredge.com"}
})}</script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#07090d;color:#dde6f0;font-family:system-ui,-apple-system,sans-serif;line-height:1.6;}
nav{background:#0c0f15;border-bottom:1px solid #1c2535;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;}
.logo{font-size:20px;font-weight:800;color:#dde6f0;text-decoration:none;}
.logo em{color:#18e07a;font-style:normal;}
.nav-cta{background:#18e07a;color:#07090d;padding:8px 18px;border-radius:5px;text-decoration:none;font-weight:700;font-size:13px;}
.wrap{max-width:1000px;margin:0 auto;padding:48px 24px 80px;}
.page-label{font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#18e07a;margin-bottom:10px;}
h1{font-size:clamp(22px,5vw,38px);font-weight:800;line-height:1.15;margin-bottom:8px;}
.page-sub{font-size:15px;color:#4a5a70;margin-bottom:32px;}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:1px;background:#1c2535;border-radius:8px;overflow:hidden;margin-bottom:32px;}
.kpi{background:#0f141c;padding:18px 16px;}
.kpi-label{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#4a5a70;margin-bottom:8px;font-family:monospace;}
.kpi-val{font-size:26px;font-weight:800;font-family:monospace;line-height:1;}
.green{color:#18e07a;} .red{color:#ff3d5a;} .gold{color:#f0b429;} .white{color:#dde6f0;}
h2{font-size:20px;font-weight:800;margin:36px 0 16px;}
.tbl-wrap{overflow-x:auto;margin-bottom:32px;}
table{width:100%;border-collapse:collapse;font-size:13px;}
th{text-align:left;padding:10px 12px;background:#0c0f15;color:#4a5a70;border-bottom:1px solid #1c2535;font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:1px;}
td{padding:10px 12px;border-bottom:1px solid #1c2535;color:#8a9bb0;}
tr:hover td{background:#0f141c;}
.content-block{background:#0f141c;border:1px solid #1c2535;border-radius:8px;padding:24px;margin-bottom:20px;}
.content-block h2{font-size:18px;margin-top:0;}
.content-block p{font-size:14px;color:#4a5a70;line-height:1.8;margin-bottom:10px;}
.breadcrumb{font-size:12px;color:#4a5a70;margin-bottom:24px;}
.breadcrumb a{color:#4a5a70;text-decoration:none;}
footer{background:#0c0f15;border-top:1px solid #1c2535;padding:24px;text-align:center;font-size:12px;color:#4a5a70;}
footer a{color:#4a5a70;text-decoration:none;margin:0 8px;}
</style>
</head>
<body>
<nav>
  <a class="logo" href="/">The <em>Tipster</em></a>
  <a class="nav-cta" href="/">View Today's Tips →</a>
</nav>
<div class="wrap">
  <nav class="breadcrumb"><a href="/">Home</a> › Verified Track Record</nav>
  <div class="page-label">100% Transparent — Nothing Excluded</div>
  <h1>Verified Betting Tips Track Record</h1>
  <p class="page-sub">Every tip logged from the moment it's published. Results recorded automatically. Nothing deleted, edited or cherry-picked.</p>

  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Win Rate</div><div class="kpi-val green">${winRate}%</div></div>
    <div class="kpi"><div class="kpi-label">Tips Won</div><div class="kpi-val green">${totalWon}</div></div>
    <div class="kpi"><div class="kpi-label">Tips Lost</div><div class="kpi-val red">${totalLost}</div></div>
    <div class="kpi"><div class="kpi-label">Total Tips</div><div class="kpi-val white">${totalWon+totalLost}</div></div>
    <div class="kpi"><div class="kpi-label">Net Profit</div><div class="kpi-val ${pl>=0?'green':'red'}">${fmt(pl)}u</div></div>
    <div class="kpi"><div class="kpi-label">ROI</div><div class="kpi-val gold">${fmt(roi,1)}%</div></div>
  </div>

  <h2>Daily Results — Last 30 Days</h2>
  <div class="tbl-wrap">
    <table>
      <thead><tr><th>Date</th><th>Tips</th><th>Won</th><th>Lost</th><th>Win Rate</th><th>P&amp;L</th></tr></thead>
      <tbody>${dayRows || '<tr><td colspan="6" style="text-align:center;padding:24px;color:#4a5a70">Loading...</td></tr>'}</tbody>
    </table>
  </div>

  <h2>Recent Results</h2>
  <div class="tbl-wrap">
    <table>
      <thead><tr><th>Date</th><th>Sport</th><th>Match</th><th>Selection</th><th>Odds</th><th>Result</th><th>P&amp;L</th></tr></thead>
      <tbody>${recentRows || '<tr><td colspan="7" style="text-align:center;padding:24px;color:#4a5a70">No results yet</td></tr>'}</tbody>
    </table>
  </div>

  <div class="content-block">
    <h2>How Results Are Tracked</h2>
    <p>Every tip published on The Tipster is assigned a unique reference and timestamped the moment it goes live. When the fixture completes, our engine automatically fetches the final score from the Odds API and records the result. No manual intervention — no opportunity to exclude losses.</p>
    <p>The win rate, P&L and ROI figures you see are calculated directly from this database. Every settled tip is included regardless of outcome. This is the only honest way to present a betting tips track record.</p>
    <p>Stake recommendations use fractional Kelly sizing (0.25 Kelly) based on the confidence and edge of each tip. This approach maximises long-term growth while managing risk — stakes range from 1u to 3u depending on model conviction.</p>
  </div>

  <div class="content-block">
    <h2>What Do the Stats Mean?</h2>
    <p><strong style="color:#dde6f0">Win Rate</strong> — the percentage of settled tips that were correct predictions. Our all-time win rate across football, NHL and NBA is shown above.</p>
    <p><strong style="color:#dde6f0">P&L (Profit & Loss)</strong> — measured in units (u). 1 unit = your base stake. A positive P&L means our tips have returned more than staked over this period.</p>
    <p><strong style="color:#dde6f0">ROI (Return on Investment)</strong> — total profit divided by total amount staked, expressed as a percentage. A positive ROI demonstrates long-term profitability.</p>
    <p><strong style="color:#dde6f0">Value Edge</strong> — the gap between our model's probability and the bookmaker's implied probability. Only tips with a positive edge are published.</p>
  </div>
</div>
<footer>
  <p style="margin-bottom:10px">© 2026 The Tipster · Verified betting tips track record · 18+ only · Please gamble responsibly</p>
  <div>
    <a href="/">Home</a><a href="/tips">Today's Tips</a><a href="/football-tips-today">Football</a>
    <a href="/nhl-tips-today">NHL</a><a href="/nba-tips-today">NBA</a>
    <a href="/terms.html">Terms</a><a href="/responsible-gambling.html">Responsible Gambling</a>
  </div>
</footer>
</body>
</html>`;

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=1800');
  res.status(200).send(html);
};
