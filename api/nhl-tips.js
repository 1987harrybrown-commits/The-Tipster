const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL  = 'https://eyhlzzaaxrwisrtwyoyh.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aGx6emFheHJ3aXNydHd5b3loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNzkyNzcsImV4cCI6MjA4ODk1NTI3N30.iqIk52att2Lv2o6m70Ht1LVWVgqbmLwptDqTxDq12AI';
const db = createClient(SUPABASE_URL, SUPABASE_ANON);
function fmtDate(d){return new Date(d).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});}
function fmtTime(d){return new Date(d).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'});}

module.exports = async (req, res) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const tom = new Date(today); tom.setDate(tom.getDate()+2);
  const todayStr = fmtDate(new Date());

  const [{ data: tips }, { data: history }] = await Promise.all([
    db.from('tips').select('*').eq('sport','Ice Hockey').eq('status','pending')
      .gte('event_time', today.toISOString()).lte('event_time', tom.toISOString())
      .order('confidence',{ascending:false}).limit(10),
    db.from('results_history').select('result,profit_loss').eq('sport','Ice Hockey')
  ]);

  const h = history||[];
  const won = h.filter(r=>r.result==='WON').length;
  const total = h.filter(r=>r.result==='WON'||r.result==='LOST').length;
  const winRate = total>0?((won/total)*100).toFixed(1):0;
  const pl = h.reduce((s,r)=>s+parseFloat(r.profit_loss||0),0);
  const freeTips = (tips||[]).slice(0,3);

  const tipCards = freeTips.map(t=>`
    <article class="tip-card">
      <div class="tip-league">🏒 ${t.league}</div>
      <h3>${t.home_team} vs ${t.away_team}</h3>
      <div class="tip-row"><span>📌 ${t.selection}</span><span style="color:#f0b429;font-family:monospace;font-weight:700">${parseFloat(t.odds).toFixed(2)}</span></div>
      <div class="tip-row"><span style="color:#4a5a70">🕐 ${fmtTime(t.event_time)} UK</span><span style="color:#4a5a70">Conf: ${t.confidence}%</span></div>
    </article>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Free NHL Ice Hockey Tips Today — ${todayStr} | The Tipster</title>
<meta name="description" content="Free NHL ice hockey betting tips for ${todayStr}. Data-driven predictions with ${winRate}% win rate. Poisson model analysis across all NHL games. Updated every 15 minutes.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://www.thetipsteredge.com/nhl-tips-today">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#07090d;color:#dde6f0;font-family:system-ui,-apple-system,sans-serif;line-height:1.6;}
nav{background:#0c0f15;border-bottom:1px solid #1c2535;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;}
.logo{font-size:20px;font-weight:800;color:#dde6f0;text-decoration:none;} .logo em{color:#18e07a;font-style:normal;}
.nav-cta{background:#18e07a;color:#07090d;padding:8px 18px;border-radius:5px;text-decoration:none;font-weight:700;font-size:13px;}
.wrap{max-width:900px;margin:0 auto;padding:48px 24px 80px;}
.label{font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#18e07a;margin-bottom:10px;}
h1{font-size:clamp(22px,5vw,38px);font-weight:800;margin-bottom:8px;}
h2{font-size:20px;font-weight:800;margin:32px 0 16px;}
.sub{font-size:15px;color:#4a5a70;margin-bottom:32px;}
.stats{display:flex;gap:20px;flex-wrap:wrap;background:#0f141c;border:1px solid #1c2535;border-radius:8px;padding:16px 20px;margin-bottom:32px;}
.stat .sl{font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#4a5a70;} .stat .sv{font-size:22px;font-weight:800;font-family:monospace;}
.tips-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-bottom:32px;}
.tip-card{background:#0f141c;border:1px solid #1c2535;border-radius:8px;padding:16px;border-top:3px solid #18e07a;}
.tip-league{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#4a5a70;margin-bottom:6px;}
.tip-card h3{font-size:14px;font-weight:800;margin-bottom:10px;}
.tip-row{display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;}
.locked{background:#0f141c;border:1px solid rgba(240,180,41,0.2);border-radius:8px;padding:20px;text-align:center;border-top:3px solid #f0b429;}
.locked p{font-size:13px;color:#4a5a70;margin-bottom:12px;}
.locked a{display:inline-block;background:#f0b429;color:#07090d;padding:8px 20px;border-radius:5px;text-decoration:none;font-weight:700;font-size:13px;}
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
<nav><a class="logo" href="/">The <em>Tipster</em></a><a class="nav-cta" href="/">View All Tips →</a></nav>
<div class="wrap">
  <nav class="breadcrumb"><a href="/">Home</a> › <a href="/tips">Betting Tips</a> › NHL Ice Hockey Tips</nav>
  <div class="label">NHL Primary Market</div>
  <h1>Free NHL Ice Hockey Tips — ${todayStr}</h1>
  <p class="sub">Poisson-model NHL predictions covering all regular season and playoff games. Ice hockey is our primary market — the most inefficient major betting league.</p>
  <div class="stats">
    <div class="stat"><div class="sl">NHL Win Rate</div><div class="sv" style="color:#18e07a">${winRate}%</div></div>
    <div class="stat"><div class="sl">Tips Won</div><div class="sv" style="color:#18e07a">${won}</div></div>
    <div class="stat"><div class="sl">Total Tips</div><div class="sv" style="color:#dde6f0">${total}</div></div>
    <div class="stat"><div class="sl">Net P&L</div><div class="sv" style="color:${pl>=0?'#18e07a':'#ff3d5a'};font-family:monospace">${pl>=0?'+':''}${pl.toFixed(1)}u</div></div>
  </div>
  <div class="label">Today's NHL Picks</div>
  <h2>Free NHL Tips — ${todayStr}</h2>
  <div class="tips-grid">
    ${tipCards||'<p style="color:#4a5a70;grid-column:1/-1">No NHL tips right now — check back later today.</p>'}
    <div class="locked"><p>🔒 Pro members get the full NHL card with value edge % and stake recommendations</p><a href="/">Unlock Pro →</a></div>
  </div>
  <div class="block">
    <h2>Why NHL is Our Primary Market</h2>
    <p>NHL ice hockey offers the best value betting opportunities of any major professional sport. Bookmakers systematically misprice NHL lines due to lower market liquidity compared to football or basketball, creating consistent opportunities for data-driven models to find edge.</p>
    <p>Our Poisson goals model is specifically calibrated for NHL hockey, incorporating 5-on-5 Corsi and Fenwick metrics, goaltending save percentages, power play efficiency, home ice advantage, back-to-back game fatigue, and travel schedule factors.</p>
  </div>
  <div class="block">
    <h2>NHL Betting Tips Model</h2>
    <p>For each NHL game, our model calculates the expected goals for each team based on their season-long offensive and defensive performance metrics relative to league averages. These expected goals feed into a bivariate Poisson distribution to generate win, loss and overtime probabilities.</p>
    <p>We compare these probabilities against the best available odds from 40+ UK-licensed bookmakers. Tips are only published when we identify a value edge of 8% or more — meaning our model gives significantly better odds than the bookmaker implies.</p>
  </div>
  <div class="block">
    <h2>NHL Regular Season vs Playoffs</h2>
    <p>Our NHL coverage runs throughout the regular season (October to April) and the Stanley Cup Playoffs (April to June). Playoff hockey has different statistical dynamics — teams are more evenly matched and series history becomes more relevant — and our model adjusts accordingly.</p>
  </div>
</div>
<footer>
  <p style="margin-bottom:10px">© 2026 The Tipster · Free NHL betting tips · 18+ only · Please gamble responsibly</p>
  <div><a href="/">Home</a><a href="/tips">All Tips</a><a href="/results">Track Record</a><a href="/football-tips-today">Football Tips</a><a href="/nba-tips-today">NBA Tips</a><a href="/responsible-gambling.html">Responsible Gambling</a></div>
</footer>
</body>
</html>`;

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=1800');
  res.status(200).send(html);
};
