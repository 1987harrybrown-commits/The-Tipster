const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL  = 'https://eyhlzzaaxrwisrtwyoyh.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aGx6emFheHJ3aXNydHd5b3loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNzkyNzcsImV4cCI6MjA4ODk1NTI3N30.iqIk52att2Lv2o6m70Ht1LVWVgqbmLwptDqTxDq12AI';
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

// PostgREST caps every response at 1000 rows, so an unbounded select over
// results_history silently truncates and every figure derived from it is wrong
// once the ledger passes that. Returns { data } to match the shape the callers
// already destructure.
async function selectAllRows(table, columns, applyFilters) {
  const PAGE = 1000;
  let out = [], from = 0;
  for (;;) {
    let q = db.from(table).select(columns).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (applyFilters) q = applyFilters(q);
    const { data, error } = await q;
    if (error) { console.error('selectAllRows(' + table + '):', error.message); break; }
    if (!data || !data.length) break;
    out = out.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { data: out };
}


// Escape anything interpolated into the HTML below. None of these fields is
// meant to contain markup — they are team names, leagues and selections that
// originate from an upstream feed — so a stray < or & should render, not parse.
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmt(n,d=2){return(n>=0?'+':'')+parseFloat(n).toFixed(d);}

module.exports = async (req, res) => {
  const [{ data: history }, { data: stats }] = await Promise.all([
    selectAllRows('results_history','sport,result,profit_loss,stake,odds'),
    db.from('stats_cache').select('*').eq('id',1).single()
  ]);

  const rows = history||[];
  const bySport = {};
  rows.forEach(r=>{
    if(!bySport[r.sport]) bySport[r.sport]={won:0,lost:0,pl:0,staked:0,odds:[]};
    if(r.result==='WON') bySport[r.sport].won++;
    if(r.result==='LOST') bySport[r.sport].lost++;
    bySport[r.sport].pl+=parseFloat(r.profit_loss||0);
    bySport[r.sport].staked+=parseFloat(r.stake??1);
    if(r.odds) bySport[r.sport].odds.push(parseFloat(r.odds));
  });

  const sportRows = Object.entries(bySport).map(([sport,d])=>{
    const total=d.won+d.lost;
    const wr=total>0?((d.won/total)*100).toFixed(1):0;
    const roi=d.staked>0?((d.pl/d.staked)*100).toFixed(1):0;
    const avgOdds=d.odds.length>0?(d.odds.reduce((a,b)=>a+b,0)/d.odds.length).toFixed(2):0;
    const icon={Football:'⚽',Basketball:'🏀','Ice Hockey':'🏒'}[sport]||'🏅';
    return `<tr>
      <td style="font-weight:700">${icon} ${esc(sport)}</td>
      <td>${total}</td>
      <td style="color:#18e07a">${d.won}</td>
      <td style="color:#ff3d5a">${d.lost}</td>
      <td style="color:#18e07a;font-family:monospace">${wr}%</td>
      <td style="color:${d.pl>=0?'#18e07a':'#ff3d5a'};font-family:monospace">${fmt(d.pl)}u</td>
      <td style="color:${parseFloat(roi)>=0?'#18e07a':'#ff3d5a'};font-family:monospace">${fmt(parseFloat(roi),1)}%</td>
      <td style="color:#f0b429;font-family:monospace">${avgOdds}</td>
    </tr>`;
  }).join('');

  const winRate = stats?.win_rate||0;
  const pl = stats?.total_pl||0;
  const roi = stats?.roi||0;
  const tw = stats?.total_won||0;
  const tl = stats?.total_lost||0;

  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Betting Tips Statistics — Win Rate, ROI & P&L by Sport | The Tipster</title>
<meta name="description" content="Detailed betting tips statistics by sport. Overall ${winRate}% win rate. Full breakdown of football tips, NHL tips and NBA tips performance with ROI, P&L and average odds.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://www.thetipsteredge.com/betting-stats">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#07090d;color:#dde6f0;font-family:system-ui,-apple-system,sans-serif;line-height:1.6;}
nav{background:#0c0f15;border-bottom:1px solid #1c2535;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;}
.logo{font-size:20px;font-weight:800;color:#dde6f0;text-decoration:none;} .logo em{color:#18e07a;font-style:normal;}
.nav-cta{background:#18e07a;color:#07090d;padding:8px 18px;border-radius:5px;text-decoration:none;font-weight:700;font-size:13px;}
.wrap{max-width:1000px;margin:0 auto;padding:48px 24px 80px;}
.label{font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#18e07a;margin-bottom:10px;}
h1{font-size:clamp(22px,5vw,38px);font-weight:800;margin-bottom:8px;}
h2{font-size:20px;font-weight:800;margin:32px 0 16px;}
.sub{font-size:15px;color:#4a5a70;margin-bottom:32px;}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:1px;background:#1c2535;border-radius:8px;overflow:hidden;margin-bottom:32px;}
.kpi{background:#0f141c;padding:18px 16px;}
.kpi-label{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#4a5a70;margin-bottom:8px;font-family:monospace;}
.kpi-val{font-size:24px;font-weight:800;font-family:monospace;}
.tbl-wrap{overflow-x:auto;margin-bottom:32px;}
table{width:100%;border-collapse:collapse;font-size:13px;}
th{text-align:left;padding:10px 12px;background:#0c0f15;color:#4a5a70;border-bottom:1px solid #1c2535;font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:1px;}
td{padding:10px 12px;border-bottom:1px solid #1c2535;color:#8a9bb0;}
.block{background:#0f141c;border:1px solid #1c2535;border-radius:8px;padding:24px;margin-bottom:16px;}
.block h2{font-size:18px;font-weight:800;margin-bottom:12px;margin-top:0;}
.block p{font-size:14px;color:#4a5a70;line-height:1.8;margin-bottom:10px;}
.breadcrumb{font-size:12px;color:#4a5a70;margin-bottom:24px;}
.breadcrumb a{color:#4a5a70;text-decoration:none;}
footer{background:#0c0f15;border-top:1px solid #1c2535;padding:24px;text-align:center;font-size:12px;color:#4a5a70;}
footer a{color:#4a5a70;text-decoration:none;margin:0 8px;}
</style>
</head>
<body>
<nav><a class="logo" href="/">The <em>Tipster</em></a><a class="nav-cta" href="/">View Today's Tips →</a></nav>
<div class="wrap">
  <nav class="breadcrumb"><a href="/">Home</a> › Betting Statistics</nav>
  <div class="label">Fully Verified — Nothing Excluded</div>
  <h1>Betting Tips Statistics — Win Rate, ROI & P&L</h1>
  <p class="sub">Complete performance breakdown across all sports. Every result included. Updated automatically after each settlement.</p>

  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Overall Win Rate</div><div class="kpi-val" style="color:#18e07a">${winRate}%</div></div>
    <div class="kpi"><div class="kpi-label">Total Won</div><div class="kpi-val" style="color:#18e07a">${tw}</div></div>
    <div class="kpi"><div class="kpi-label">Total Lost</div><div class="kpi-val" style="color:#ff3d5a">${tl}</div></div>
    <div class="kpi"><div class="kpi-label">Net Profit</div><div class="kpi-val" style="color:${pl>=0?'#18e07a':'#ff3d5a'}">${fmt(pl)}u</div></div>
    <div class="kpi"><div class="kpi-label">Overall ROI</div><div class="kpi-val" style="color:#f0b429">${fmt(roi,1)}%</div></div>
  </div>

  <h2>Performance by Sport</h2>
  <div class="tbl-wrap">
    <table>
      <thead><tr><th>Sport</th><th>Total Tips</th><th>Won</th><th>Lost</th><th>Win Rate</th><th>P&L</th><th>ROI</th><th>Avg Odds</th></tr></thead>
      <tbody>${sportRows||'<tr><td colspan="8" style="text-align:center;padding:24px;color:#4a5a70">Loading...</td></tr>'}</tbody>
    </table>
  </div>

  <div class="block">
    <h2>Understanding Our Statistics</h2>
    <p>All statistics on this page are calculated directly from our results database. Every tip published on The Tipster is automatically tracked and settled — there is no manual intervention and nothing is excluded from the record.</p>
    <p><strong style="color:#dde6f0">Win Rate</strong> is the percentage of settled tips that were correct. A win rate above 55% is generally considered profitable at average odds of 1.90 or higher.</p>
    <p><strong style="color:#dde6f0">ROI</strong> (Return on Investment) divides net profit by total stakes. Our target ROI is 15%+ which, if sustained, represents exceptional long-term performance for a betting tips service.</p>
    <p><strong style="color:#dde6f0">Average Odds</strong> tells you the typical price of our tips. Higher average odds require a lower win rate to be profitable — our model calibrates stakes accordingly using fractional Kelly sizing.</p>
  </div>

  <div class="block">
    <h2>Why We Publish Everything</h2>
    <p>Most betting tips services are selective about what they publish — showing only winning runs, deleting losing tips, or cherry-picking start dates. We publish every tip and every result from day one.</p>
    <p>This is the only honest way to demonstrate long-term edge. Our verified track record is our strongest selling point — and it only has value if every result is included.</p>
  </div>
</div>
<footer>
  <p style="margin-bottom:10px">© 2026 The Tipster · Verified betting statistics · 18+ only · Please gamble responsibly</p>
  <div><a href="/">Home</a><a href="/tips">Today's Tips</a><a href="/results">Full Results</a><a href="/football-tips-today">Football</a><a href="/nhl-tips-today">NHL</a><a href="/nba-tips-today">NBA</a><a href="/responsible-gambling.html">Responsible Gambling</a></div>
</footer>
</body>
</html>`;

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=1800, stale-while-revalidate=3600');
  res.status(200).send(html);
};
