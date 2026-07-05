/* ============================================================================
 * sync-analytics.mjs  —  YBOS2 social analytics sync
 * ----------------------------------------------------------------------------
 * Runs server-side (GitHub Actions cron). Fetches TikTok / YouTube / Instagram
 * stats and writes them into feed.json -> meta.analytics. The dashboard polls
 * feed.json every 15s and renders the ANALYTICS window from that object.
 *
 * Each platform is INDEPENDENT: if its secrets are missing it's skipped, if it
 * errors the previous values are kept — one broken platform never blanks the
 * others. Requires Node 18+ (global fetch). Configure via env / GH secrets:
 *
 *   YouTube  (public stats — no OAuth):  YT_API_KEY, YT_CHANNEL_ID
 *   TikTok   (OAuth refresh token):      TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN
 *   Instagram(Graph API long-lived tok): IG_TOKEN, IG_USER_ID
 *
 * DRY_RUN=1  -> fetch + print, but do NOT write feed.json.
 * ==========================================================================*/
import fs from 'node:fs/promises';

const FEED = new URL('../feed.json', import.meta.url);
const env  = k => (process.env[k] || '').trim();
const nowISO = () => new Date().toISOString();
const dayKey = () => { const d = new Date();
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { _raw: text }; }
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`);
  return j;
}

/* -------------------------------- YouTube -------------------------------- */
/* Public channel + video stats need only an API key + channel id (no OAuth). */
async function youtube() {
  const key = env('YT_API_KEY'), ch = env('YT_CHANNEL_ID');
  if (!key || !ch) return null;
  const cj = await getJSON(`https://www.googleapis.com/youtube/v3/channels?part=statistics,contentDetails&id=${ch}&key=${key}`);
  const it = cj.items && cj.items[0];
  if (!it) throw new Error('channel not found (check YT_CHANNEL_ID)');
  const s = it.statistics || {};
  const stats = { subscribers: +s.subscriberCount || null, views: +s.viewCount || null, likes: null, comments: null };
  let top = [];
  try {
    const uploads = it.contentDetails.relatedPlaylists.uploads;
    const pl = await getJSON(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=20&playlistId=${uploads}&key=${key}`);
    const ids = (pl.items || []).map(x => x.contentDetails.videoId).join(',');
    if (ids) {
      const vj = await getJSON(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${ids}&key=${key}`);
      let likes = 0, comments = 0;
      top = (vj.items || []).map(v => {
        const vs = v.statistics || {};
        likes += +vs.likeCount || 0; comments += +vs.commentCount || 0;
        return { t: v.snippet.title, plat: 'youtube', views: +vs.viewCount || 0, likes: +vs.likeCount || 0, url: `https://youtu.be/${v.id}` };
      }).sort((a, b) => b.views - a.views).slice(0, 5);
      stats.likes = likes; stats.comments = comments;
    }
  } catch (e) { console.warn('  yt videos:', e.message); }
  return { stats, top };
}

/* -------------------------------- TikTok --------------------------------- */
/* Analytics needs OAuth. We exchange the long-lived refresh token for a fresh
 * access token each run. Scopes required on the app: user.info.stats, video.list */
async function tiktokAccessToken() {
  const key = env('TIKTOK_CLIENT_KEY'), sec = env('TIKTOK_CLIENT_SECRET'), rt = env('TIKTOK_REFRESH_TOKEN');
  if (!key || !sec || !rt) return null;
  const body = new URLSearchParams({ client_key: key, client_secret: sec, grant_type: 'refresh_token', refresh_token: rt });
  const j = await getJSON('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!j.access_token) throw new Error('token refresh failed: ' + JSON.stringify(j));
  return j.access_token;
}
async function tiktok() {
  const tok = await tiktokAccessToken();
  if (!tok) return null;
  const H = { Authorization: `Bearer ${tok}` };
  const uj = await getJSON('https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count', { headers: H });
  const u = (uj.data && uj.data.user) || {};
  const stats = { followers: u.follower_count ?? null, views: null, likes: u.likes_count ?? null, comments: null, shares: null };
  let top = [];
  try {
    const vj = await getJSON('https://open.tiktokapis.com/v2/video/list/?fields=id,title,view_count,like_count,comment_count,share_count', {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ max_count: 20 }),
    });
    const vids = (vj.data && vj.data.videos) || [];
    let views = 0, comments = 0, shares = 0;
    vids.forEach(v => { views += v.view_count || 0; comments += v.comment_count || 0; shares += v.share_count || 0; });
    stats.views = views; stats.comments = comments; stats.shares = shares;
    top = vids.map(v => ({ t: v.title || '(untitled)', plat: 'tiktok', views: v.view_count || 0, likes: v.like_count || 0,
      url: `https://www.tiktok.com/@me/video/${v.id}` })).sort((a, b) => b.views - a.views).slice(0, 5);
  } catch (e) { console.warn('  tiktok videos:', e.message); }
  return { stats, top };
}

/* ------------------------------- Instagram ------------------------------- */
/* Instagram API with Instagram Login (graph.instagram.com — no Facebook Page).
 * IG_TOKEN = long-lived user token (60 days, refreshable). Uses /me, so no user id
 * needed. Per-post view counts need per-media insights; kept best-effort (ranked by
 * likes) so the sync still works on day one. */
async function instagram() {
  const tok = env('IG_TOKEN');
  if (!tok) return null;
  const base = 'https://graph.instagram.com';
  const me = await getJSON(`${base}/me?fields=user_id,username,account_type,followers_count,media_count&access_token=${encodeURIComponent(tok)}`);
  const stats = { followers: me.followers_count ?? null, views: null, likes: null, comments: null };
  let top = [];
  try {
    const mj = await getJSON(`${base}/me/media?fields=id,caption,permalink,like_count,comments_count,media_type&limit=20&access_token=${encodeURIComponent(tok)}`);
    const media = mj.data || [];
    let likes = 0, comments = 0;
    media.forEach(m => { likes += m.like_count || 0; comments += m.comments_count || 0; });
    stats.likes = likes; stats.comments = comments;
    top = media.map(m => ({ t: (m.caption || '').slice(0, 60) || '(no caption)', plat: 'instagram',
      views: 0, likes: m.like_count || 0, url: m.permalink })).sort((a, b) => b.likes - a.likes).slice(0, 5);
  } catch (e) { console.warn('  instagram media:', e.message); }
  return { stats, top };
}

/* ---------------------------------- main --------------------------------- */
const feed = JSON.parse(await fs.readFile(FEED, 'utf8'));
feed.meta = feed.meta || {};
const prev = feed.meta.analytics || {};
const out = { updated: nowISO() };
const allTop = [];

for (const [key, fn] of [['tiktok', tiktok], ['youtube', youtube], ['instagram', instagram]]) {
  try {
    const r = await fn();
    if (r === null) { if (prev[key]) out[key] = prev[key]; console.log(`${key}: skipped (no secrets set)`); continue; }
    out[key] = r.stats;
    (r.top || []).forEach(t => allTop.push(t));
    console.log(`${key}: ok`, JSON.stringify(r.stats));
  } catch (e) {
    console.error(`${key}: FAILED — ${e.message}`);
    if (prev[key]) out[key] = prev[key]; // keep last-known good
  }
}

out.top = allTop.sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8);

// series = cumulative total views per platform, one point per day (kept ~30d)
const v = k => (out[k] && out[k].views) || 0;
const series = (prev.series || []).filter(s => s.d !== dayKey());
series.push({ d: dayKey(), tiktok: v('tiktok'), youtube: v('youtube'), instagram: v('instagram') });
out.series = series.slice(-30);

if (env('DRY_RUN')) {
  console.log('\n--- DRY_RUN, not writing ---\n' + JSON.stringify(out, null, 2));
} else {
  feed.meta.analytics = out;
  feed.meta.updated = nowISO();
  await fs.writeFile(FEED, JSON.stringify(feed, null, 2) + '\n');
  console.log('\nfeed.json meta.analytics updated.');
}
