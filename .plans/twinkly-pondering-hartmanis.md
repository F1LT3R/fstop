# Singleton markserv with browser-managed file opening

## Context

Currently `openMdPreview()` spawns a new markserv process per `.md` file click (killing the previous one). The new behavior: fstop owns a single headless markserv instance for the whole project directory and opens specific file URLs in the browser itself.

## File: `bin/watch.mjs`

### 1. Add a free-port helper (no new dependency)

Use Node's built-in `net` module — bind to port 0, read the assigned port, close:

```javascript
import { createServer } from 'net'

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}
```

### 2. Change global state

Add `mdPreviewPort` alongside the existing `mdPreviewProcess`:

```javascript
let mdPreviewProcess = null
let mdPreviewPort = null
```

### 3. Rewrite `openMdPreview()`

- First call: spawn markserv once for the whole project on a free port with `--browser false`
- Every call: open `http://localhost:{port}/{relative-path}` in the browser

```javascript
async function openMdPreview(filePath) {
  // First call: spawn markserv once for the whole project
  if (!mdPreviewProcess) {
    mdPreviewPort = await getFreePort()
    mdPreviewProcess = spawn(mdPreviewCmd, [watchPath, '--port', String(mdPreviewPort), '--browser', 'false'], {
      cwd: watchPath,
      stdio: 'ignore',
      detached: false,
    })
    mdPreviewProcess.on('error', () => { mdPreviewProcess = null; mdPreviewPort = null })
    mdPreviewProcess.on('exit', () => { mdPreviewProcess = null; mdPreviewPort = null })
  }

  // Open the specific file URL in the browser
  const relPath = relative(watchPath, filePath)
  const url = `http://localhost:${mdPreviewPort}/${relPath}`
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
  exec(`${opener} "${url}"`)
}
```

### 4. Existing cleanup — no changes needed

The exit handler already kills `mdPreviewProcess` and nulls it. Works as-is.

## Verification

1. `fstop ~/repos/markserv --markdown-preview markserv`
2. Click a `.md` file — markserv spawns once, browser opens to `http://localhost:{port}/{file}`
3. Click a different `.md` file — same markserv instance, new browser tab
4. `Ctrl+C` — markserv process is killed

---

![fstop word cloud](../wordcloud.png)
