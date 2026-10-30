# Visor HTML

Web app para abrir y ver archivos HTML en iPhone y iPad, gratis y sin conexión.
Los archivos se guardan solo en el dispositivo (no se suben a internet).

## Cómo usarla

1. Abre la dirección de GitHub Pages en **Safari**.
2. Toca **Compartir** → **Agregar a inicio**.
3. Abre la app desde el icono y toca **Abrir archivo HTML**.

Si el HTML usa imágenes, CSS o JS aparte, selecciónalos junto con el HTML.

Desde WhatsApp: abre el archivo → Compartir → **Guardar en Archivos**, y luego ábrelo desde la app.

## Para desarrolladores

Archivos estáticos sin dependencias: `index.html`, `styles.css`, `app.js`, `sw.js` (caché sin conexión) y `manifest.webmanifest`.
Al cambiar cualquier archivo, sube `VERSION` en `sw.js` para que los dispositivos reciban la actualización.
