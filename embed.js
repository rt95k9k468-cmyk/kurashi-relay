/* relay/worker.js を、アプリの中から一発でコピーできるように埋め込みます。
   実行： node relay/embed.js

   なぜ埋め込むのか。パソコンを持っていない人にとって、いちばん難しいのは
   「90行のコードをクリップボードに載せる」ところです。GitHubを開いて、
   raw を出して、全部を選んで、コピーして——iPhoneの指では、ここで落ちます。
   アプリの中に「コードをコピー」の一つボタンがあれば、その難所が消えます。

   写しを持つと元とずれます。だから **ずれたらテストが落ちる** ようにして
   あります（relay/worker.test.mjs の最後）。直すのはいつも worker.js の
   ほうで、こちらは作り直すだけです。 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const SRC = join(here, "worker.js");
export const OUT = join(here, "..", "js", "relay-code.js");

/* JSON.stringify に任せます。中の正規表現には \S のような並びがあるので、
   自分で引用符を組み立てると、その一本の斜線で意味が変わります。 */
export function render(source) {
  return "/* 自動生成。直すのは relay/worker.js のほうで、ここは `node relay/embed.js` で作り直します。 */\n"
    + '(function () {\n  "use strict";\n  window.KN = window.KN || {};\n  window.KN.relayCode = '
    + JSON.stringify(source) + ";\n})();\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const src = readFileSync(SRC, "utf8");
  writeFileSync(OUT, render(src));
  console.log(`js/relay-code.js を作り直しました（${src.length} 文字）`);
}
