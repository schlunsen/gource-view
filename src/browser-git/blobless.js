// Stage a blobless partial clone into a real isomorphic-git repository: fetch
// the filtered pack ourselves, index it, then point a ref at the tip. From
// there every ordinary read (log, readTree) works; only readBlob is absent.
import * as git from 'isomorphic-git'
import { lsRefs, fetchPack } from './protocol.js'

const PACK = 'objects/pack/pack-blobless.pack'

export async function cloneBlobless({ fs, dir, url, corsProxy, ref = '', depth, maxBytes, onProgress = () => {}, signal }) {
  const gitdir = `${dir}/.git`
  onProgress({ pct: 4, detail: 'Finding repository branches…' })
  const refs = await lsRefs({ url, corsProxy, signal })
  const branch = ref || refs.defaultRef
  const want = ref ? refs.oidOf(ref) : refs.head
  if (!want) throw new Error('This repository is empty or the selected branch does not exist.')

  await git.init({ fs, dir, gitdir, defaultBranch: branch || 'main' })
  const { pack, shallow } = await fetchPack({
    url, corsProxy, want, depth, maxBytes, signal,
    onProgress: received => onProgress({ pct: 5 + Math.min(30, received / 1048576 * 4), detail: `Downloading history · ${(received / 1048576).toFixed(1)} MB (no file contents)` }),
  })
  onProgress({ pct: 38, detail: 'Preparing history…' })
  await fs.promises.mkdir(`${gitdir}/objects`, { recursive: true }).catch(() => {})
  await fs.promises.mkdir(`${gitdir}/objects/pack`, { recursive: true }).catch(() => {})
  await fs.promises.writeFile(`${gitdir}/${PACK}`, pack)
  await git.indexPack({ fs, dir, gitdir, filepath: `.git/${PACK}` })
  // The shallow boundary stops the walk where the server truncated it.
  await fs.promises.writeFile(`${gitdir}/shallow`, shallow.map(oid => `${oid}\n`).join(''))
  await git.writeRef({ fs, dir, gitdir, ref: `refs/heads/${branch}`, value: want, force: true })
  await git.writeRef({ fs, dir, gitdir, ref: 'HEAD', value: `refs/heads/${branch}`, force: true, symbolic: true })
  return { ref: branch, defaultRef: refs.defaultRef, branches: refs.branches.length ? refs.branches : [branch] }
}
