import { useEffect, useRef, useState } from 'react'
import { musicTracks, musicFileUrl } from './api.js'

async function api(url, options) {
  const response = await fetch(url, options)
  const data = await response.json()
  if (!response.ok) { const error = new Error(data.error || 'Could not contact the export server.'); error.status = response.status; throw error }
  return data
}

export default function ExportVideo({ repo, privacy: viewerPrivacy = 'off', clock = true, staticDemo = false, repoUrl = '' }) {
  const dialog = useRef(null)
  const [job, setJob] = useState(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resolution, setResolution] = useState('1080p')
  const [orientation, setOrientation] = useState('landscape')
  const [sound, setSound] = useState('ambient')
  const [music, setMusic] = useState('floating-cities')
  const [privacy, setPrivacy] = useState(viewerPrivacy)
  useEffect(() => { setPrivacy(viewerPrivacy) }, [viewerPrivacy])
  const [tracks, setTracks] = useState([])
  const [customTrack, setCustomTrack] = useState(null) // { name, data }
  const [copied, setCopied] = useState(false)
  // Browser build: the render runs in this tab (WebCodecs + in-memory MP4 muxing).
  const [support, setSupport] = useState(null)
  const controller = useRef(null)
  useEffect(() => {
    if (!staticDemo) { api('/api/music').then(d => setTracks(d.tracks || [])).catch(() => setTracks([])); return }
    musicTracks().then(setTracks).catch(() => setTracks([]))
    import('./browser-export/render.js').then(m => m.browserExportSupport()).then(setSupport).catch(e => setSupport({ ok: false, reason: e.message }))
  }, [staticDemo])
  async function pickFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 25 * 1024 * 1024) { setError('Custom music must be 25 MB or smaller.'); e.target.value = ''; return }
    const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(file) })
    setCustomTrack({ name: file.name, data, file }); setMusic('custom'); setError('')
  }
  const [fps, setFps] = useState(30)
  const [duration, setDuration] = useState(30)
  const [title, setTitle] = useState('')
  const active = job && ['rendering', 'cancelling'].includes(job.status)

  // Keep the job ID through a page refresh; the server owns the render lifecycle.
  useEffect(() => {
    if (staticDemo) return // browser renders live in this tab only
    let cancelled = false
    const id = sessionStorage.getItem('gource-export')
    if (id) api(`/api/exports/${id}`).then(data => { if (!cancelled) setJob(data) }).catch(() => { sessionStorage.removeItem('gource-export') })
    return () => { cancelled = true }
  }, [staticDemo])
  useEffect(() => {
    if (!active || job?.local) return // local jobs report progress directly
    let cancelled = false, timer
    async function poll() {
      try {
        const next = await api(`/api/exports/${job.id}`)
        if (!cancelled) { setJob(next); setError('') }
      } catch (e) {
        if (!cancelled) { setError(e.message); if (e.status === 404) setJob(previous => ({ ...previous, status: 'error', error: e.message })) }
      }
      if (!cancelled) timer = setTimeout(poll, 1000)
    }
    timer = setTimeout(poll, 1000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [active, job?.id, job?.local])

  async function startInBrowser() {
    const { browserExportOptions } = await import('./browser-export/options.js')
    const { renderBrowserVideo } = await import('./browser-export/render.js')
    const options = browserExportOptions({ resolution, orientation, sound, music, privacy, clock, fps: resolution === '4k' ? 30 : fps, duration, title, file: customTrack?.file }, tracks)
    const id = `browser-${Date.now()}`
    controller.current = new AbortController()
    if (job?.download) URL.revokeObjectURL(job.download)
    setJob({ id, status: 'rendering', stage: 'starting', pct: 0, repo: repo.repo, options, local: true })
    setSubmitting(false)
    try {
      const out = await renderBrowserVideo({ repo, options, musicUrl: music !== 'none' && music !== 'custom' ? musicFileUrl(music) : '', musicFile: music === 'custom' ? customTrack.file : null, signal: controller.current.signal,
        onProgress: p => setJob(prev => prev?.id === id ? { ...prev, ...p } : prev) })
      setJob(prev => prev?.id === id ? { ...prev, status: 'done', pct: 100, download: URL.createObjectURL(out.blob), filename: out.filename, bytes: out.blob.size, codecs: `${out.video === 'avc' ? 'H.264' : 'VP9'}${out.audio === 'none' ? '' : out.audio === 'aac' ? ' · AAC' : ' · Opus'}` } : prev)
    } catch (e) {
      setJob(prev => prev?.id === id ? { ...prev, status: e.name === 'AbortError' ? 'cancelled' : 'error', error: e.name === 'AbortError' ? '' : e.message } : prev)
    }
  }
  async function start(e) {
    e.preventDefault(); setError(''); setSubmitting(true)
    if (staticDemo) { try { await startInBrowser() } catch (e) { setError(e.message); setSubmitting(false) } return }
    try {
      const next = await api('/api/exports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: repo.jobKey, generatedAt: repo.generatedAt, options: { resolution, orientation, sound, music, privacy, clock, ...(music === 'custom' ? { track: customTrack?.data } : {}), fps: resolution === '4k' ? 30 : fps, duration, title } }),
      })
      setJob(next); sessionStorage.setItem('gource-export', next.id)
    } catch (e) { setError(e.message) }
    finally { setSubmitting(false) }
  }
  async function cancel() {
    if (job?.local) { controller.current?.abort(); setJob(prev => ({ ...prev, status: 'cancelling' })); return }
    try { setJob(await api(`/api/exports/${job.id}`, { method: 'DELETE' })); setError('') }
    catch (e) { setError(e.message) }
  }
  function newVideo() { if (job?.download && job.local) URL.revokeObjectURL(job.download); setJob(null); setError(''); sessionStorage.removeItem('gource-export') }
  const canExport = !!repo?.commits?.length
  return <>
    <button className="export-button" disabled={!canExport && !job} onClick={() => dialog.current.showModal()}>
      {active ? `Exporting ${job.pct}%` : job?.status === 'done' ? 'Video ready ↓' : 'Export video ↗'}
    </button>
    <dialog ref={dialog} className="export-dialog" aria-labelledby="export-heading">
      <div className="export-top"><span className="eyebrow">CREATE A VIDEO</span><button aria-label="Close export dialog" onClick={() => dialog.current.close()}>×</button></div>
      <h2 id="export-heading">Your history. In motion.</h2>
      <p className="export-description">Download an MP4 ready for YouTube or your editor. The video covers the full loaded history with an automatic camera and no playback controls.</p>
      {staticDemo && support && !support.ok ? <div className="export-result">
        <p className="export-status" role="status">{support.reason}</p>
        <p className="export-note">Self-host it (one Docker image: git + Chromium + FFmpeg) to render 720p/1080p/4K MP4s of any repository with music and a title card. <a className="export-link" href={repoUrl} target="_blank" rel="noreferrer">Get it on GitHub →</a></p>
        <p className="export-note">Tip: ▶ Video plays the same composition fullscreen right here.</p>
      </div> : staticDemo && !support ? <p className="export-note">Checking video support…</p> : job ? <div className="export-result">
        <div className="export-summary">{job.repo}<br /><span>{job.options.resolution}{job.options.orientation === 'portrait' ? ' portrait' : ''} · {job.options.fps} fps · {job.options.duration + (job.options.intro || 0) + (job.options.outro || 0)} seconds · {job.options.music !== 'none' ? `music: ${job.options.musicTitle}` : job.options.sound === 'none' ? 'silent' : 'effects only'} · MP4</span></div>
        {active && <>
          <div role="status" className="export-status">{job.status === 'cancelling' ? 'Cancelling…' : job.stage === 'starting' ? 'Preparing the renderer…' : job.stage === 'soundtrack' ? 'Composing the soundtrack…' : job.stage === 'encoding' ? 'Finishing your MP4…' : `Rendering frames · ${job.pct}%`}</div>
          <progress value={job.pct} max="100" aria-label="Video export progress" />
          <p className="export-note">{job.local ? 'Rendering in this tab — keep it open. Large graphs, 4K and 60 fps take longer.' : 'You can close this dialog while the server renders. Large graphs and 60 fps exports take longer.'}</p>
          <button className="export-secondary" disabled={job.status === 'cancelling'} onClick={cancel}>Cancel export</button>
        </>}
        {job.status === 'done' && <>
          <p className="export-status">Your video is ready.</p>
          <a className="export-primary" href={job.download} download={job.filename || true}>Download MP4 ↓{job.bytes ? ` · ${(job.bytes / 1048576).toFixed(1)} MB` : ''}</a>
          {job.options.credit && <p className="export-note export-credit">{job.options.credit}<br /><button type="button" className="export-link" onClick={async () => { try { await navigator.clipboard.writeText(job.options.credit); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ } }}>{copied ? 'Copied' : 'Copy credit for your description'}</button></p>}
          <p className="export-note">{job.local ? `Rendered in your browser (${job.codecs}). The download lasts until you leave the page.` : 'Available for one hour.'}</p>
          <button className="export-secondary" onClick={newVideo}>Create another video</button>
        </>}
        {['error', 'cancelled'].includes(job.status) && <>
          <p role={job.status === 'error' ? 'alert' : 'status'}>{job.error || 'Export cancelled.'}</p>
          <button className="export-secondary" onClick={newVideo}>Back to settings</button>
        </>}
      </div> : <form onSubmit={start}>
        <label className="export-field">Video title <input value={title} onChange={e => setTitle(e.target.value)} maxLength={100} placeholder={repo?.repo || 'Repository history'} /></label>
        <div className="export-options">
          <label className="export-field">Resolution<select value={resolution} onChange={e => setResolution(e.target.value)}><option value="1080p">1080p · Full HD</option><option value="720p">720p · Faster</option><option value="4k">4K · UHD (slow)</option></select></label>
          <label className="export-field">Format<select value={orientation} onChange={e => setOrientation(e.target.value)}><option value="landscape">Landscape 16:9 · YouTube</option><option value="portrait">Portrait 9:16 · Shorts / Reels</option></select></label>
          <label className="export-field">Frame rate<select value={resolution === '4k' ? 30 : fps} disabled={resolution === '4k'} onChange={e => setFps(+e.target.value)}><option value={30}>30 fps</option><option value={60}>60 fps</option></select></label>
          <label className="export-field">Music<select value={music} onChange={e => { const v = e.target.value; if (v === 'custom' && !customTrack) { document.getElementById('export-music-file')?.click(); return } setMusic(v) }}>
            {tracks.map(t => <option key={t.id} value={t.id}>{t.title} · {t.mood}</option>)}
            <option value="custom">{customTrack ? `Your track · ${customTrack.name}` : 'Upload your own…'}</option>
            <option value="none">No music</option>
          </select></label>
          <label className="export-field">Privacy<select value={privacy} onChange={e => setPrivacy(e.target.value)}><option value="off">Show everything</option><option value="paths">Hide file &amp; folder names</option><option value="all">Hide names and contributors</option></select></label>
          <label className="export-field">Sound effects<select value={sound} onChange={e => setSound(e.target.value)}><option value="ambient">Subtle · a blip per commit</option><option value="none">Off</option></select></label>
          <input id="export-music-file" type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac" hidden onChange={pickFile} aria-label="Upload music" />
          <label className="export-field">History length<select value={duration} onChange={e => setDuration(+e.target.value)}><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>60 seconds</option></select></label>
        </div>
        <div className="export-summary">{repo?.repo}<span> · {repo?.stats.commits ?? 0} loaded commits</span></div>
        <p className="export-note">{staticDemo ? 'Rendered right here in your browser — ' : ''}H.264 MP4{sound === 'none' && music === 'none' ? ' · no audio' : ' · AAC audio'} · adds a 3 s title card and a 4 s contributor leaderboard around the history.{resolution === '4k' ? (staticDemo ? ' 4K renders at 30 fps, needs a capable machine and takes several minutes.' : ' 4K renders at 30 fps and can take 10–30 minutes.') : ''}</p>
        {music !== 'none' && music !== 'custom' && <p className="export-note">Bundled music is by Kevin MacLeod (incompetech.com), CC BY 4.0 — the credit is shown on the closing card and offered for your video description.</p>}
        {privacy !== 'off' && <p className="export-note">Privacy: {privacy === 'all' ? 'file/folder names are hidden and contributors appear as “Contributor N” without photos' : 'file and folder names are hidden'}; the repository path is replaced by your title{title ? '' : ' (or “Private repository”)'}. Folder structure, colours and activity still show.</p>}
        {music === 'custom' && <p className="export-note">Your track is looped to the video length with fades. Make sure you hold the rights to publish it. <button type="button" className="export-link" onClick={() => document.getElementById('export-music-file')?.click()}>Choose a different file</button></p>}
        <button className="export-primary" type="submit" disabled={!canExport || submitting}>{submitting ? 'Starting…' : 'Render video →'}</button>
      </form>}
      {error && <p className="export-error" role="alert">{error}</p>}
    </dialog>
  </>
}
