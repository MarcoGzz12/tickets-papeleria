// Servidor local para probar la app: node serve.mjs → http://localhost:4190
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('.', import.meta.url));
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

createServer(async (req, res) => {
  const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const archivo = join(raiz, ruta || 'index.html');
    if (!archivo.startsWith(raiz)) throw new Error('fuera');
    const contenido = await readFile(archivo);
    res.writeHead(200, { 'Content-Type': (tipos[extname(archivo)] ?? 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(contenido);
  } catch {
    res.writeHead(404).end('No encontrado');
  }
}).listen(4190, () => console.log('http://localhost:4190'));
