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

// 2. Extracción de dominio, respaldo por defecto y validación de URLs http(s)
assert.strictEqual(m.host("https://www.ejemplo.com/x"), "ejemplo.com");
assert.strictEqual(m.host(undefined), "news.ycombinator.com");
assert.strictEqual(m.safeUrl("https://ejemplo.com/nota?a=1"), "https://ejemplo.com/nota?a=1");
assert.strictEqual(m.safeUrl("javascript:alert(1)"), "");
assert.strictEqual(m.safeUrl("no-es-url"), "");

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

// 6. Sanitizador HTML (XSS) usando DOMParser provisto por jsdom (opcional)
try {
  const { JSDOM } = require("jsdom");
  global.DOMParser = new JSDOM("").window.DOMParser;

  const out = m.clean(
    '<p>ok <a href="javascript:alert(1)" onclick="x()">l</a>' +
      '<a href="https://a.com">s</a><script>alert(1)</script><img src=x onerror=alert(1)></p>'
  );

  assert.ok(!/script|onerror|onclick|javascript:|<img/i.test(out));
  assert.ok(out.includes('href="https://a.com"'));
  console.log("sanitizador OK");
} catch (e) {
  if (e.code === "MODULE_NOT_FOUND") {
    console.log("jsdom no instalado: se omitió el test del sanitizador");
  } else {
    throw e;
  }
}

console.log("tests OK");
