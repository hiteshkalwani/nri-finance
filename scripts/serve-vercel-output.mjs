// Serves a Vercel Build Output API v3 directory the way Vercel routes it, for the local integration check:
// header routes, /api/* to the bundled function, files under static/, then the SPA fallback.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
}

export function createOutputServer(outputDir) {
  const root = resolve(outputDir)
  const staticDir = join(root, 'static')
  const routes = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')).routes.map((r) => ({
    ...r,
    re: r.src ? new RegExp(`^${r.src}$`) : null,
  }))
  const handlers = new Map()
  const fnDir = (dest) => join(root, 'functions', `${dest.replace(/^\//, '')}.func`)
  const handler = async (dest) => {
    if (!handlers.has(dest)) handlers.set(dest, (await import(pathToFileURL(join(fnDir(dest), 'index.mjs')).href)).default)
    return handlers.get(dest)
  }
  // Resolves a URL path to a file inside static/, or null. Never returns a path outside static/.
  const staticFile = (p) => {
    const file = resolve(staticDir, `.${p}`)
    if (file !== staticDir && !file.startsWith(staticDir + sep)) return null
    return existsSync(file) && statSync(file).isFile() ? file : null
  }
  const send = (res, file) => {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  }

  return createServer(async (req, res) => {
    try {
      let path
      try {
        path = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname)
      } catch {
        res.writeHead(400).end()
        return
      }
      if (path.split('/').includes('..')) {
        res.writeHead(404).end()
        return
      }
      for (const route of routes) {
        if (route.handle === 'filesystem') {
          const file = staticFile(path)
          if (file) return send(res, file)
          continue
        }
        if (!route.re?.test(path)) continue
        for (const [k, v] of Object.entries(route.headers ?? {})) res.setHeader(k, v)
        if (route.continue || !route.dest) continue
        if (existsSync(fnDir(route.dest))) return await (await handler(route.dest))(req, res)
        const file = staticFile(route.dest)
        if (file) return send(res, file)
      }
      res.writeHead(404).end()
    } catch (e) {
      console.error(e)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? '.vercel/output'
  const port = Number(process.env.PORT ?? 3000)
  createOutputServer(dir).listen(port, '0.0.0.0', () => console.log(`serving ${dir} on :${port}`))
}
