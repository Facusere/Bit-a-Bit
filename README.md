# Bit a Bit · Lector visual de Hacker News

Lector web moderno para **Hacker News** desarrollado íntegramente con **HTML, CSS y JavaScript puro** (*Zero-Dependencies*): sin bundlers, sin frameworks, sin paso de compilación y sin base de datos propia.

---

## ¿De qué se trata Bit a Bit?

**Bit a Bit** transforma el feed clásico minimalista de Hacker News en una **experiencia de lectura visual orientada a tarjetas y lectura en ventana modal**, manteniendo la ligereza y velocidad de una aplicación estática.

Al pulsar cualquier tarjeta (portada, título o cuerpo), la noticia no te saca inmediatamente del lector: **se abre en una ventana modal centrada con scroll** donde podés leer la **noticia completa** (en **Modo lectura** limpio o **Vista web** embebida), ir a la fuente con el botón **"Ir a la página oficial ↗"** o abrir la sección de **"Ver comentarios (N)"** únicamente cuando quieras ver la discusión. Si pulsás directamente el botón de comentarios de una tarjeta, el modal abre directo en la vista de comentarios.

El proyecto gira en torno a una **identidad visual binaria**:
- **Logo en código binario**: los 8 cuadrados de la cabecera representan `01000010`, el código binario de la letra **`B`** en ASCII.
- **Indicador de lectura ("Bit")**: cada historia tiene un cuadradito indicador. Mientras no la hayas abierto permanece relleno (estado `1`); al abrir su panel de lectura o comentarios, pasa a estar vacío (estado `0`) y se recuerda localmente en tu navegador.
- **Fondo matricial interactivo**: un lienzo `<canvas>` detrás de la interfaz genera un flujo suave de ceros y unos en múltiples capas de profundidad.

---

## Funcionalidades principales

- **Ventana modal de lectura (`<dialog>`)**:
  - Ventana centrada y compacta (`min(760px, 92vw)`, `86vh` de alto máximo) con scroll interno, barras de desplazamiento personalizadas según el tema claro/oscuro y barra superior fija (*sticky*).
  - **Modo Noticia / Video / Podcast (`openItem(id, "story")`)**: al seleccionar una tarjeta muestra título, metadatos, botón **"Ir a la página oficial ↗"**, botón **"Ver comentarios (N)"** (los comentarios no se muestran hasta que los solicites) y:
    - En **Videos** (YouTube): reproductor embebido 16:9 directo (`youtube-nocookie.com`).
    - En **Podcasts** (Spotify, Apple Podcasts o blogs de episodios): reproductor de audio embebido (cuando la plataforma lo soporta) junto a las notas y transcripción del episodio.
    - En **Artículos**: selector entre **Modo lectura** (obtiene el artículo vía Jina Reader `r.jina.ai` con respaldo en `api.microlink.io`, lo convierte con `mdToHtml()` / `extractArticle()` y lo sanitiza con `clean()`) y **Vista web** (`<iframe>` con atributo `sandbox`, usado también como respaldo automático si el sitio es interactivo y no expone texto plano).
  - **Modo Comentarios (`openItem(id, "comments")`)**: al pulsar el botón de comentarios de una tarjeta o **"Ver comentarios"**, muestra únicamente el **árbol recursivo de comentarios** con `<details>` colapsables abiertos hasta el **nivel 3** y un botón para volver a la noticia o video.
- **Secciones de Hacker News y Multimedia**: pestañas de noticias (**Top**, **Nuevas**, **Mejores**, **Ask**, **Show**) separadas visualmente del bloque multimedia (**▶ Videos** y **🎙 Podcasts**) sobre temas de tecnología, programación e IA.
- **Buscador integrado**: búsqueda *full-text* mediante Algolia HN Search con paginación y retorno automático a la pestaña activa al vaciar el campo.
- **Tarjetas uniformes con portada dinámica**:
  - Miniaturas oficiales HD (`i.ytimg.com`) para enlaces de YouTube y capturas del sitio enlazado vía [thum.io](https://image.thum.io/) para artículos (limpiando parámetros *query* y fragmentos de la URL antes de enviarla).
  - Insignias multimedia (`▶ Video` y `🎙 Podcast`) sobre la portada cuando corresponde.
  - **Portada procedural de respaldo**: si la imagen falla o la historia no tiene URL externa, se genera un gradiente determinista basado en el hash del dominio junto a su inicial.
- **Deep-linking compartible**: cada hilo actualiza la ruta (`#/item/ID`) para compartir enlaces directos y navegar hacia atrás o adelante con el historial del navegador (`hashchange`).
- **Scroll infinito, caché y cancelación de red**: carga automática por lotes de 20 historias (`IntersectionObserver` + botón **"Cargar más"**), caché en memoria (`Map`) para no repetir peticiones al cambiar de pestaña y cancelación de solicitudes pendientes con `AbortController`.
- **Tema claro/oscuro, scrollbars y atajos de teclado**: respeta `prefers-color-scheme`, declara `color-scheme` nativo y estiliza las barras de scroll (`scrollbar-color`, `::-webkit-scrollbar`) para evitar barras blancas en modo oscuro; persiste la elección en `localStorage` y permite usar **`/`** para enfocar el buscador y **`T`** (o **`Alt+T`**) para alternar el tema.
- **Estados de interfaz y accesibilidad**: skeletons proporcionales a las tarjetas para evitar saltos de diseño, manejo de errores con botón **"Reintentar"**, foco visible (`:focus-visible`), atributos dinámicos `aria-pressed` y `aria-busy`, regiones `aria-live="polite"` / `role="status"` y soporte para `prefers-reduced-motion`.

---

## Arquitectura y flujo de datos

El lector utiliza una **arquitectura híbrida sin backend** combinando dos APIs públicas y gratuitas (sin necesidad de *API key*):

1. **Hacker News Firebase API** (`/v0/{top|new|best|ask|show}stories.json` e `/v0/item/{id}.json`):
   - Obtiene la lista de IDs de cada sección y pide los metadatos por **lotes de 20 elementos en paralelo con `Promise.all`**, resolviendo el problema N+1 de forma controlada y paginada, con caché en memoria (`itemCache` y `storyMap`).
2. **Algolia HN Search API** (`/api/v1/search`, `/api/v1/search_by_date` y `/api/v1/items/{id}`):
   - Alimenta el buscador por palabra clave y las secciones multimedia (**▶ Videos** y **🎙 Podcasts**) filtradas por temas publicados en Hacker News.
   - Permite descargar el **árbol completo de comentarios de una historia en una sola petición HTTP**, evitando cientos de llamadas recursivas por cada `kid` contra Firebase.

```mermaid
flowchart LR
  UI["Interfaz (index.html + app.js)"] -->|"Tabs: Top / New / Best / Ask / Show"| FB["HN Firebase API"]
  FB -->|"Lotes de 20 con Promise.all + itemCache"| NORMF["Normalizador normF()"]
  UI -->|"Buscador (#sf) + Videos / Podcasts"| ALGS["Algolia Search API"]
  ALGS -->|"Resultados paginados"| NORMA["Normalizador normA()"]
  NORMF --> CARDS["Grilla de Tarjetas (#list + storyMap)"]
  NORMA --> CARDS
  CARDS -->|"Clic en tarjeta -> openItem(id, 'story')"| MODAL["Ventana Modal: Noticia / Video / Podcast / Comentarios"]
  MODAL -->|"YouTube / Spotify / Apple"| PLAYER["Reproductor embebido"]
  MODAL -->|"Modo lectura: r.jina.ai + microlink"| ARTICLE["Artículo sanitizado o Vista web"]
  MODAL -->|"Clic en Ver comentarios / boton .cb"| ALGI["Algolia Items API"]
  ALGI -->|"Árbol completo en 1 petición"| CLEAN["Sanitizador clean() + comment()"]
  CLEAN --> MODAL
```

---

## Seguridad (Sanitización XSS)

Los comentarios, publicaciones propias y artículos extraídos pasan por `clean()` en [`app.js`](app.js), que procesa el HTML en un documento aislado con `DOMParser` siguiendo una **lista blanca estricta**:

- **Etiquetas permitidas**: `P`, `I`, `B`, `EM`, `STRONG`, `A`, `PRE`, `CODE`, `BR`, `H2`, `H3`, `H4`, `UL`, `OL`, `LI`, `BLOCKQUOTE`. Cualquier otra etiqueta (como `<script>`, `<img>`, `<iframe>`, etc.) se reemplaza por su texto/hijos o se descarta.
- **Atributos y enlaces**: se eliminan todos los atributos salvo `href` en enlaces `<a>`, validando que el protocolo sea exclusivamente `http://` o `https://` (bloqueando esquemas `javascript:`) y añadiendo `target="_blank"` y `rel="noopener noreferrer nofollow"`.
- **Validación de URLs y escape**: `safeUrl()` valida las URLs externas de noticias antes de enlazarlas o cargarlas en el `<iframe>` embebido (`sandbox`), y `esc()` escapa cualquier campo de texto plano en las plantillas.

---

## Animación de fondo y rendimiento

La función `bg()` en [`app.js`](app.js) renderiza el fondo matricial sobre `#bg` priorizando la fluidez y el bajo consumo de recursos:

- **Capas de profundidad (*parallax*)**: cada partícula (`0` o `1`) posee un factor de profundidad `z` (`0.4` a `1.0`) que regula simultáneamente su tamaño, opacidad y velocidad de ascenso.
- **Oscilación sinusoidal y cambio de bits**: deriva horizontal suave (`Math.sin`) y mutaciones aleatorias esporádicas (`0` ↔ `1`) acompañadas de un breve pulso de opacidad.
- **Interacción sutil con el cursor**: las partículas cercanas al puntero dentro de un radio reactivo se desplazan suavemente y aumentan ligeramente su brillo.
- **Optimización y ahorro de batería**:
  - Reescalado proporcional de partículas cuando solo cambia la altura de la ventana (evitando reinicios bruscos en móviles al ocultarse la barra del navegador durante el scroll).
  - Cachea el color `--ac` mediante `MutationObserver` sobre `data-theme`, evitando invocar `getComputedStyle` en cada frame.
  - Se detiene automáticamente cuando la pestaña queda oculta (`visibilitychange` / `document.hidden`).
  - Se mantiene estática si el usuario tiene activado `prefers-reduced-motion: reduce`.

---

## Estructura del proyecto

| Archivo | Responsabilidad |
| :--- | :--- |
| [`index.html`](index.html) | Estructura semántica, favicon SVG binario, barra de herramientas (`.toolbar`), grilla y ventana modal `<dialog>`. |
| [`style.css`](style.css) | Sistema de diseño con variables CSS, temas claro/oscuro, grilla responsive, modal centrado, skeletons y accesibilidad. |
| [`app.js`](app.js) | Lógica de datos, caché (`itemCache` / `storyMap`), `AbortController`, sanitizador XSS, canvas y controlador (`init()`). |
| [`test.js`](test.js) | Suite de pruebas unitarias con `assert` nativo de Node.js. |
| [`package.json`](package.json) | Script `npm test` y dependencia de desarrollo opcional (`jsdom`) para el test del sanitizador. |
| [`README.md`](README.md) | Documentación técnica y guía de uso del proyecto. |

---

## Cómo ejecutarlo

Al ser un proyecto estático, podés iniciarlo de cualquiera de estas maneras:

1. **Directamente en el navegador**: abrí [`index.html`](index.html).
2. **Con servidor local** (recomendado):
   ```bash
   npx serve .
   ```
   *(También funciona con Live Server, `python -m http.server` o cualquier hosting estático como GitHub Pages, Netlify o Vercel).*

### Ejecutar pruebas

La suite de pruebas utiliza el módulo nativo `assert` de Node.js:

```bash
npm test
# o directamente:
node test.js
```

> **Nota sobre el test del sanitizador**: `clean()` depende de `DOMParser`. Si querés incluir la prueba unitaria de sanitización XSS en Node.js, ejecutá `npm install` (instala `jsdom` como `devDependency` sin afectar la app web estática); de lo contrario, `test.js` ejecutará el resto de las pruebas y omitirá ese bloque sin fallar.

---

## Limitaciones conocidas

- **Modo lectura y Vista web (`iframe`)**: la lectura del artículo completo utiliza el servicio público `r.jina.ai` con respaldo en `api.microlink.io` (con límite de 6 segundos por endpoint); si un sitio bloquea ambos extractores o es una aplicación interactiva sin texto plano y además restringe marcos (`X-Frame-Options` / `CSP`), podés abrirlo directamente con **"Ir a la página oficial ↗"**.
- **Disponibilidad de miniaturas**: las portadas dependen del servicio gratuito externo `thum.io`; ante bloqueos, límites de tasa o ausencia de URL externa, la tarjeta muestra automáticamente la portada procedural generada con el dominio.
- **Desfase temporal en Algolia**: los puntajes y conteos de comentarios devueltos por Algolia pueden presentar una leve diferencia respecto a los valores en tiempo real de Firebase.
- **Hilos masivos**: publicaciones con miles de comentarios anidados pueden tardar unos instantes adicionales al construir los nodos `<details>` en el DOM.

## Ideas futuras

- Marcadores o favoritos persistentes separados del historial de lectura.
- Filtro rápido por dominio.
- Soporte offline e instalabilidad como **PWA**.
