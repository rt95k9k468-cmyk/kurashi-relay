/* 中継所のふるまい。KVの偽物を渡して、外に出ずに確かめます。
   実行： node relay/worker.test.mjs                        */
import worker from "./worker.js";
import { readFileSync } from "node:fs";
import { SRC, OUT, render } from "./embed.js";

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
};

const PATH = "/kn-7f3a9c1d4e8b2";

/* KVの偽物。put の TTL も控えておいて、渡し忘れていないか見ます。 */
function fakeKV() {
  const m = new Map();
  const puts = [];
  return {
    _m: m, _puts: puts,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, opts) { puts.push(opts || {}); m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}

const call = (env, method, path, body) =>
  worker.fetch(new Request("https://relay.test" + path, {
    method,
    body: body === undefined ? undefined : body,
  }), env);

const env0 = () => ({ RELAY_PATH: PATH, MAIL: fakeKV() });

/* ---------- 置いて、取って、消える ---------- */
{
  const env = env0();
  const put = await call(env, "POST", PATH, "day=2026-08-18\nsteps=8432");
  check("POST は 200", put.status === 200, String(put.status));

  const get1 = await call(env, "GET", PATH);
  check("GET は 200", get1.status === 200, String(get1.status));
  check("置いたものがそのまま返る",
    (await get1.text()) === "day=2026-08-18\nsteps=8432");
  check("文字化けしない指定がある",
    /charset=utf-8/i.test(get1.headers.get("content-type") || ""),
    get1.headers.get("content-type"));
  check("途中で覚え込まれない",
    /no-store/.test(get1.headers.get("cache-control") || ""),
    get1.headers.get("cache-control"));

  const get2 = await call(env, "GET", PATH);
  check("渡したら消える（二度目は 204）", get2.status === 204, String(get2.status));
  check("204 に中身は無い", (await get2.text()) === "");
}

/* ---------- 日本語も、そのまま往復する ---------- */
{
  const env = env0();
  const text = "day=2026-08-18\nworkout=ウォーキング,42,210";
  await call(env, "POST", PATH, text);
  const got = await call(env, "GET", PATH);
  check("日本語がそのまま戻る", (await got.text()) === text);
}

/* ---------- 新しい便が古い便を上書きする ---------- */
{
  const env = env0();
  await call(env, "POST", PATH, "steps=1");
  await call(env, "POST", PATH, "steps=2");
  check("郵便受けは一つだけ", env.MAIL._m.size === 1, String(env.MAIL._m.size));
  const got = await call(env, "GET", PATH);
  check("あとから置いたほうが残る", (await got.text()) === "steps=2");
}

/* ---------- 取りに来ない便は、いつか捨てる ---------- */
{
  const env = env0();
  await call(env, "POST", PATH, "steps=1");
  const ttl = env.MAIL._puts[0].expirationTtl;
  check("TTL を渡している", typeof ttl === "number", String(ttl));
  check("TTL は KV の下限（60秒）以上", ttl >= 60, String(ttl));
  check("TTL は一週間", ttl === 604800, String(ttl));
}

/* ---------- 道が合言葉 ---------- */
{
  const env = env0();
  await call(env, "POST", PATH, "steps=1");
  const wrong = await call(env, "GET", "/kn-7f3a9c1d4e8b3");
  check("道が違えば渡さない", wrong.status === 404, String(wrong.status));
  check("道が違っても、中身は残っている", env.MAIL._m.size === 1);
  const root = await call(env, "GET", "/");
  check("根っこには何も無い", root.status === 404, String(root.status));
  const wrongBody = await wrong.text();
  check("違う道に、手がかりを返さない", !/kn-|中継|relay/i.test(wrongBody), wrongBody);
}

/* ---------- 置き忘れは、黙って通さない ---------- */
{
  const env = { MAIL: fakeKV() };                       // RELAY_PATH なし
  const r = await call(env, "GET", "/");
  check("RELAY_PATH が無ければ 500（誰でも開ける状態で公開させない）",
    r.status === 500, String(r.status));
  const short = { RELAY_PATH: "/kn", MAIL: fakeKV() };  // 短すぎる道
  const r2 = await call(short, "GET", "/kn");
  check("短すぎる道も断る", r2.status === 500, String(r2.status));
}

/* ---------- KV を結び忘れたとき ---------- */
{
  const r = await call({ RELAY_PATH: PATH }, "GET", PATH);
  check("KV が無ければ 500", r.status === 500, String(r.status));
  check("何を直せばいいか書いてある", /MAIL/.test(await r.text()));
}

/* ---------- 入れ物の大きさ ---------- */
{
  const env = env0();
  const big = await call(env, "POST", PATH, "x".repeat(64 * 1024 + 1));
  check("大きすぎるものは断る", big.status === 413, String(big.status));
  check("断ったものは置かない", env.MAIL._m.size === 0, String(env.MAIL._m.size));

  const empty = await call(env, "POST", PATH, "   \n  ");
  check("空の便は断る", empty.status === 400, String(empty.status));
  check("断った空も置かない", env.MAIL._m.size === 0, String(env.MAIL._m.size));

  const ok = await call(env, "POST", PATH, "x".repeat(64 * 1024));
  check("ちょうどの大きさは通る", ok.status === 200, String(ok.status));
}

/* ---------- ブラウザから読める約束 ---------- */
{
  const env = env0();
  const pre = await call(env, "OPTIONS", PATH);
  check("OPTIONS は 204", pre.status === 204, String(pre.status));
  check("どこからでも読める", pre.headers.get("access-control-allow-origin") === "*");
  await call(env, "POST", PATH, "steps=1");
  const got = await call(env, "GET", PATH);
  check("GET にも約束が付いている",
    got.headers.get("access-control-allow-origin") === "*");
  const nf = await call(env, "GET", "/よそ");
  check("404 にも付いている（付いていないと理由が読めない）",
    nf.headers.get("access-control-allow-origin") === "*");
}

/* ---------- 知らない動詞 ---------- */
{
  const env = env0();
  const r = await call(env, "DELETE", PATH);
  check("DELETE は断る（消すのは受け取ったときだけ）", r.status === 405, String(r.status));
  const r2 = await call(env, "PUT", PATH, "steps=1");
  check("PUT は POST と同じに扱う", r2.status === 200, String(r2.status));
}

/* ---------- アプリに埋めた写しが、元とずれていない ---------- */
{
  /* アプリの「コードをコピー」が配るのは js/relay-code.js の中の文字列です。
     元を直して作り直し忘れると、**古い中継所を配り続ける** ことになります。
     気づけないので、ここで落とします。直し方は `node relay/embed.js`。 */
  const fresh = render(readFileSync(SRC, "utf8"));
  const onDisk = readFileSync(OUT, "utf8");
  check("アプリに埋めたコードが worker.js と同じ", fresh === onDisk,
    fresh === onDisk ? "" : "ずれています → node relay/embed.js で作り直してください");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
