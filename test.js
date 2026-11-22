/**
 * Suite de pruebas unitarias para Bit a Bit usando `assert` nativo de Node.js.
 * Ejecutar con: `npm test` o `node test.js`.
 */
"use strict";

const assert = require("assert");
const m = require("./app.js");

// 1. Escape de caracteres HTML peligrosos
assert.strictEqual(
  m.esc('<a href="x">&'),
  "&lt;a href=&quot;x&quot;&gt;&amp;"
);

// 2. Extracción de dominio, validación de URLs http(s) y detección multimedia (YouTube / Podcasts)
assert.strictEqual(m.host("https://www.ejemplo.com/x"), "ejemplo.com");
assert.strictEqual(m.host(undefined), "news.ycombinator.com");
assert.strictEqual(m.safeUrl("https://ejemplo.com/nota?a=1"), "https://ejemplo.com/nota?a=1");
assert.strictEqual(m.safeUrl("javascript:alert(1)"), "");
assert.strictEqual(m.safeUrl("no-es-url"), "");

assert.strictEqual(m.ytId("https://www.youtube.com/watch?v=lwfewYL7X0o"), "lwfewYL7X0o");
assert.strictEqual(m.ytId("https://youtu.be/-TLCGUpoD6c?t=30"), "-TLCGUpoD6c");
assert.strictEqual(m.ytId("https://www.youtube.com/shorts/7_JF3etiAv8"), "7_JF3etiAv8");
assert.strictEqual(m.ytId("https://ejemplo.com/watch?v=12345678901"), "");

assert.deepStrictEqual(m.mediaEmbed("https://www.youtube.com/watch?v=lwfewYL7X0o"), {
  kind: "video",
  src: "https://www.youtube-nocookie.com/embed/lwfewYL7X0o"
});
assert.deepStrictEqual(
  m.mediaEmbed("https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk?si=abc"),
  {
    kind: "podcast",
    src: "https://open.spotify.com/embed/episode/4rOoJ6Egrf8K2IrywzwOMk"
  }
);
assert.deepStrictEqual(
  m.mediaEmbed("https://podcasts.apple.com/us/podcast/demo/id1515786216?i=1000793842983"),
  {
    kind: "podcast",
    src: "https://embed.podcasts.apple.com/us/podcast/demo/id1515786216?i=1000793842983"
  }
);
assert.strictEqual(m.mediaEmbed("https://ejemplo.com/articulo"), null);

// 3. Formato de tiempo relativo ("hace X")
assert.match(m.ago(Date.now() / 1e3 - 7200), /^2 h$/);
assert.match(m.ago(Date.now() / 1e3 - 120), /^2 min$/);
assert.match(m.ago(Date.now() / 1e3 - 172800), /^2 d$/);

// 4. Normalizadores de Firebase HN y Algolia
assert.strictEqual(
  m.normF({ id: 1, title: "t", by: "u", time: 1, score: 5, descendants: 2 }).comments,
  2
);
assert.strictEqual(m.normF({ id: 1, deleted: true }), null);
assert.strictEqual(m.normF({ id: 1, dead: true, title: "x" }), null);
assert.strictEqual(m.normA({ objectID: "9", title: "x", points: null }).points, 0);
assert.strictEqual(m.normA({ objectID: "9", title: "" }), null);

// 5. Conteo y render recursivo del árbol de comentarios
const tree = {
  children: [
    {
      author: "a",
      text: "hola",
      created_at_i: 1,
      children: [{ author: "b", text: "resp", created_at_i: 1, children: [] }]
    },
    { author: "c", text: null, children: [] }
  ]
};

assert.strictEqual(m.countC(tree), 2);
const html = tree.children.map(c => m.comment(c, x => x)).join("");
assert.strictEqual((html.match(/<details/g) || []).length, 2);
assert.ok(!html.includes("[borrado]"));

// 6. Conversor seguro de Markdown a HTML para Modo lectura
const mdHtml = m.mdToHtml(
  "# Titular\n\n" +
    "Texto con **negrita**, *cursiva*, `código` y <script>alert(1)</script>.\n\n" +
    "![foto](https://ejemplo.com/img.png)\n\n" +
    "- Punto 1 con [enlace seguro](https://ejemplo.com/guia)\n" +
    "- Punto 2 con [enlace inseguro](javascript:alert(1))\n\n" +
    "```js\nconst x = 1 < 2;\n```"
);
assert.ok(mdHtml.includes("<h2>Titular</h2>"));
assert.ok(mdHtml.includes("<strong>negrita</strong>"));
assert.ok(mdHtml.includes("<em>cursiva</em>"));
assert.ok(mdHtml.includes("<code>código</code>"));
assert.ok(mdHtml.includes('href="https://ejemplo.com/guia"'));
assert.ok(mdHtml.includes("<pre><code>const x = 1 &lt; 2;</code></pre>"));
assert.ok(!mdHtml.includes("<script>"));
assert.ok(!mdHtml.includes("<img"));
assert.ok(!mdHtml.includes("javascript:"));

// 7. Sanitizador HTML (XSS) usando DOMParser provisto por jsdom (opcional)
try {
  const { JSDOM } = require("jsdom");
  global.DOMParser = new JSDOM("").window.DOMParser;

  const out = m.clean(
    '<p>ok <a href="javascript:alert(1)" onclick="x()">l</a>' +
      '<a href="https://a.com">s</a><script>alert(1)</script><img src=x onerror=alert(1)></p>'
  );

  assert.ok(!/script|onerror|onclick|javascript:|<img/i.test(out));
  assert.ok(out.includes('href="https://a.com"'));

  const art = m.extractArticle(
    '<header><nav>Menu</nav></header><article><h2>Titular del artículo</h2>' +
      '<p>Este es un párrafo suficientemente extenso de prueba para validar la extracción de contenido principal de artículos externos en Bit a Bit.</p>' +
      '<blockquote><p>Cita importante con <a href="/rel">enlace relativo</a>.</p></blockquote>' +
      '<script>evil()</script></article>',
    "https://ejemplo.com/post"
  );
  assert.ok(art.includes("<h2>Titular del artículo</h2>"));
  assert.ok(art.includes('href="https://ejemplo.com/rel"'));
  assert.ok(!/Menu|evil|<script/i.test(art));
  console.log("sanitizador y extractor OK");
} catch (e) {
  if (e.code === "MODULE_NOT_FOUND") {
    console.log("jsdom no instalado: se omitió el test del sanitizador");
  } else {
    throw e;
  }
}

console.log("tests OK");
