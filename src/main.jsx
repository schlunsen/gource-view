import { createRoot } from 'react-dom/client'
import './styles/global.css'
import Landing from './Landing.jsx'

// Preserve existing repository share links.
const legacy = new URLSearchParams(location.search).has('repo')
if (legacy) location.replace(`${import.meta.env.BASE_URL}viewer.html${location.search}${location.hash}`)
else createRoot(document.getElementById('root')).render(<Landing />)
