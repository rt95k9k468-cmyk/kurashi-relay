/* =========================================================
   くらしノート — 中継所（Cloudflare Worker）
   =========================================================

   郵便受けです。それ以上のことはしません。

     POST   <URL>            本文をしまう（同じ差出人の前の便は「ひとつ前」へ下がる）
     GET    <URL>            しまってあるものを**ぜんぶ**渡す。**消しません**
     GET    <URL>?since=版   版が変わっていなければ 204（＝新しい便は無い）
     POST   <URL>?slot=add   受け箱へ継ぎ足す（Siri から買うものへ。下の「受け箱」）
     DELETE <URL>            ぜんぶ捨てる（?slot=名前 でその差出人だけ）
     POST   <URL>?bell=…     閉じていても鳴る通知（下の「鳴らす役」。棚とは別の鍵）

   ---- 仕切りが要る理由 ----

   郵便受けは一つでした。ショートカットが一本のうちは足りていましたが、
   二本になった時点で壊れました——「からだ（歩数・消費）」を置いた上に
   「睡眠」を置くと、からだのほうが読まれないまま消えます。

   だから仕切りを入れます。**差出人ごとに一つずつ**しまい、GET でぜんぶ
   まとめて渡します。差出人は ?slot= で名乗れます。名乗らなければ、本文の
   一文字目で分けます——`{` か `[` で始まれば "json"（睡眠のような生の記録）、
   それ以外は "text"（key=value の書式）。中身は相変わらず読みません。

   ---- 「渡したら消す」をやめた理由 ----

   前は、GET で渡した便をその場で消していました。同じ便を二度読ませない
   ためです。ところがそれは、**読む側がしくじったら、その一回ぶんが
   永久に消える**ということでもありました。

   実際に起きていたのはこれです。iPhoneがロックされているあいだ HealthKit は
   読めないので、無人のショートカットは 0 の羅列を置きます。アプリはそれを
   正しく断ります（0 で塗り替えないため）。**しかし郵便受けはもう空**なので、
   次にショートカットが走るまで何も入りません。一時間おきに仕掛けていても、
   ロックされたまま鳴った回はまるごと空振りになります。

   だから消すのをやめて、**版（ver）で新しさを言う**ことにしました。版は
   「いちばん新しい便を置いた時刻」です。アプリは最後に見た版を覚えていて、
   `?since=` で送ります。変わっていなければ 204——中身を読まずに済むので、
   何度覗いてもタダです。取りこぼしも、二度取り込みも、これで消えます。

   ---- ひとつ前も残す理由 ----

   消さなくても、**次の便が前の便を差し替える**ことは変わりません。9時に
   入った良い便は、10時の空振りの便に上書きされます。それでは同じことです。

   だから、差し替えるときに前の一通を `:prev` へ下ろします。GET は
   **ひとつ前 → いま**の順に並べて渡すので、読む側は順に取り込めば
   「いまの便が読めればそれが残り、読めなければひとつ前が残る」に
   なります。中身は相変わらず読みません——**順番だけ**で決めています。

   ---- 受け箱（?slot=add）だけは、差し替えずに溜める ----

   Siri から「牛乳」「卵」と続けて足すと、差し替える棚では三つ目で一つ目が
   消えます。健康データは新しい一通が古い一通を含んでいますが、買うものは
   一通ずつが別の頼みなので、**溜めないと取りこぼします**。

   だから `?slot=add` の棚だけは、一通ごとに**置いた時刻（版と同じ数え方で、
   必ず前より大きい）**を添えて後ろへ継ぎ足します。消すのは一週間経った
   ものだけ。読む側は「どこまで足したか」をその数で覚えておけば、何度
   渡されても二度足しません——消さないので、取りに行ったあいだに置かれた
   一通を消してしまう心配もありません。中身は相変わらず読みません
   （JSON の文字列に包むだけです）。

   ---- 鳴らす役（?bell=、2026年9月27日） ----

   アプリを閉じていても、やることの時刻に iPhone を鳴らすための口です。
   ここが知るのは**時刻の列と押し先だけ**——題もメモも来ません。題は端末の
   中の写しから Service Worker が出します（利用者が決めたこと）。

     POST ?bell=key    署名の鍵（VAPID）の公開のほうを渡す。無ければ作って置く
     POST ?bell=sub    押し先（pushManager.subscribe の JSON）を置く
     POST ?bell=times  時刻の列（エポックのミリ秒の JSON 配列）を置く
     POST ?bell=off    押し先と時刻の列を捨てる

   どれも**棚（box:）とは別の鍵**（bell:）に置き、GET の「ぜんぶ渡す」にも
   控え（box:slots）にも混ぜません——混ぜると、アプリの取り込みが健康データ
   として読んでしまいます。

   ぜんぶ POST にしてあるのは、**古い中継所に届いたときに害が無いように**
   です。古い中継所は ?bell= を知らないので、DELETE なら郵便受けがまるごと
   空になり、本文つきの POST なら健康データの棚にしまわれます。key と off は
   本文なしで送るので、古い中継所は「空です」で断ります。アプリは key が
   取れた中継所にだけ sub と times を送ります。

   押すのは毎分の見回り（scheduled、wrangler.jsonc の crons）。中身なしの
   押し（payload なし）なので、中身の暗号（RFC 8291）は要らず、VAPID の
   署名（ES256）だけで済みます。

   **URLの道そのものが合言葉です。** 当てられない長い道にしてください。
   ここに認証ヘッダを足さないのは手抜きではなく、追加のヘッダを付けると
   ブラウザが事前問い合わせ（preflight）を挟み、受け止める作りが要るからです。
   合言葉を道に含めれば、ただの GET と POST で済みます。

   建て方は relay/README.md にあります。 */

/* 合言葉になる道は、環境変数 RELAY_PATH として渡されます（Cloudflare の
   Settings → Variables and Secrets に **Secret** として置きます。GitHubから
   配置すると、.dev.vars.example を見て途中で尋ねてきます）。

   ここに直接書かないのは、この設計図が公開のリポジトリに入っているから、
   そして人が考えた「ランダム」はだいたいランダムではないからです。 */
const TTL = 60 * 60 * 24 * 7;  // 置かれたまま一週間経った便は捨てる
const MAX = 64 * 1024;         // 健康データ一日ぶんは数百バイト。桁で余裕を見ています

/* 便と便の仕切り。ASCII の RS（レコード区切り）。健康データの文字列には
   出てこない字なので、本文を壊しません。 */
const SEP = "\u001E";

/* しまってある差出人の一覧と、それぞれをいつ置いたか。KV の list() を
   使わずに済ませるための控えです（list() は結果整合の揺れが大きく、
   置いた直後に見えないことがあります）。 */
const INDEX = "box:slots";

/* 受け箱。この棚だけは差し替えずに継ぎ足します（頭のコメント）。
   一行目の印で、読む側は健康データの便と見分けます。 */
const INBOX = "add";
const INBOX_HEAD = "kn-inbox";
const INBOX_MAX = 200;          // 一週間でこれを越えることはまず無い。越えたら古いほうから

const slotOf = (url, body) => {
  const q = url.searchParams.get("slot");
  if (q && /^[a-zA-Z0-9_-]{1,16}$/.test(q)) return q;
  return /^\s*[[{]/.test(body) ? "json" : "text";
};

/* このアプリのページから読めるようにするための約束。GETに custom header を
   付けないので、これだけで足ります（DELETE だけは単純な動詞ではないので
   ブラウザが先に OPTIONS を投げますが、それは下で受けています）。 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/* ブラウザは、許した名前のヘッダしか読めません。版が読めないと、アプリは
   この中継所を「古い形」と判断して昔の道に落ちます。 */
const EXPOSE = "X-Kn-Ver, X-Kn-Parts, X-Kn-Inbox, X-Kn-Bell";

/* 受け箱・鳴らす役を持っている中継所だ、という印。アプリの「確かめる」が
   これを見て、古いコードのままなら置き直しを勧めます。 */
const CAN = { "X-Kn-Inbox": "1", "X-Kn-Bell": "1" };

/* ---------------- 鳴らす役（頭のコメントの「鳴らす役」） ---------------- */

const BELL_KEY = "bell:vapid";     // 署名の鍵の組（公開と秘密）。期限なし
const BELL_SUB = "bell:sub";       // 押し先
const BELL_TIMES = "bell:times";   // {times:[…], rung:最後に鳴らした時刻}
const BELL_LATE = 10 * 60 * 1000;  // これより古い時刻は、鳴らさずに捨てる
const BELL_AHEAD = 9 * 86400 * 1000;  // アプリが送るのは7日先まで。余裕を見て
const BELL_MAX = 300;              // 7日ぶん。一日四十を越える時刻はまず無い
/* JWT の sub（連絡先）。Apple は無いと断ります。人の名前やメールを置かないで
   済むよう、公開のリポジトリを指します。 */
const BELL_CONTACT = "https://github.com/rt95k9k468-cmyk/kaimono-note";

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uText = (s) => b64u(new TextEncoder().encode(s));

/** 鍵の組を読みます。無ければ作って置きます——利用者に Secret を一つ増やさせない。 */
async function bellKeys(kv) {
  const raw = await kv.get(BELL_KEY);
  if (raw) {
    try {
      const o = JSON.parse(raw);
      if (o && o.pub && o.jwk) return o;
    } catch (err) { /* 壊れていたら作り直す（押し先はアプリが作り直す） */ }
  }
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = b64u(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const o = { pub, jwk };
  await kv.put(BELL_KEY, JSON.stringify(o));
  return o;
}

/** 押し先の持ち主へ名乗る印（VAPID の JWT、ES256）。 */
async function vapidJwt(keys, endpoint, now) {
  const head = b64uText(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64uText(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: BELL_CONTACT,
  }));
  const key = await crypto.subtle.importKey("jwk", keys.jwk,
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  /* WebCrypto の ECDSA は r‖s の64バイトを返します。JWT の ES256 がそのまま
     その形なので、DER からの詰め直しは要りません。 */
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key,
    new TextEncoder().encode(head + "." + body));
  return head + "." + body + "." + b64u(sig);
}

async function readTimes(kv) {
  const raw = await kv.get(BELL_TIMES);
  if (!raw) return { times: [], rung: 0 };
  try {
    const o = JSON.parse(raw);
    return {
      times: Array.isArray(o.times) ? o.times.filter(Number.isFinite) : [],
      rung: Number(o.rung) || 0,
    };
  } catch (err) { return { times: [], rung: 0 }; }
}

const writeTimes = (kv, o) => kv.put(BELL_TIMES, JSON.stringify(o));

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** 押します。中身なし。返すのは押し先の返事の番号（押せなければ 0）。 */
async function bellPush(env, now) {
  const raw = await env.MAIL.get(BELL_SUB);
  if (!raw) return 0;
  let sub;
  try { sub = JSON.parse(raw); } catch (err) { return 0; }
  if (!sub || !/^https:\/\//.test(sub.endpoint || "")) return 0;
  const keys = await bellKeys(env.MAIL);
  const jwt = await vapidJwt(keys, sub.endpoint, now);
  let res;
  try {
    res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        TTL: "600",          // 10分で届かなければ、もう遅い
        Urgency: "high",
        Authorization: `vapid t=${jwt}, k=${keys.pub}`,
        "Content-Length": "0",
      },
    });
  } catch (err) { return 0; }
  /* 押し先がもう無い（アプリを消した・通知を切った）。捨てておけば、毎分
     押しに行かずに済みます。アプリは次に開いたとき作り直します。 */
  if (res.status === 404 || res.status === 410) await env.MAIL.delete(BELL_SUB);
  return res.status;
}

/** 毎分の見回り。いま（30秒先まで）に来た時刻を押して、列から外します。 */
async function bellRound(env, now) {
  if (!env.MAIL) return { pushed: 0 };
  const cur = await readTimes(env.MAIL);
  if (!cur.times.length) return { pushed: 0 };
  const due = cur.times.filter((t) => t <= now + 30 * 1000);
  if (!due.length) return { pushed: 0 };
  const fresh = due.filter((t) => t >= now - BELL_LATE);
  const rest = cur.times.filter((t) => t > now + 30 * 1000);
  /* 先に列から外してから押します。押している最中に次の見回りが来ても、
     同じ時刻を二度押さないように。 */
  await writeTimes(env.MAIL, { times: rest, rung: Math.max(cur.rung, ...due) });
  /* 同じ分に三つあっても、押すのは一度（題は端末がまとめて出します）。 */
  const status = fresh.length ? await bellPush(env, now) : 0;
  return { pushed: fresh.length ? 1 : 0, status };
}

/** ?bell= の口。棚の道より先に受けます。 */
async function bell(request, env, url) {
  const what = url.searchParams.get("bell");
  const ok = (body, extra) => new Response(body, {
    status: 200,
    headers: { ...CORS, ...CAN, "Content-Type": "text/plain; charset=utf-8",
               "Cache-Control": "no-store", "Access-Control-Expose-Headers": EXPOSE,
               ...(extra || {}) },
  });
  const bad = (status, msg) => new Response(msg, { status, headers: { ...CORS, ...CAN,
    "Access-Control-Expose-Headers": EXPOSE } });
  if (request.method !== "POST") return bad(405, "bell は POST だけです");
  const body = await request.text();
  if (body.length > 16 * 1024) return bad(413, "大きすぎます");

  if (what === "key") return ok((await bellKeys(env.MAIL)).pub);

  if (what === "sub") {
    let sub;
    try { sub = JSON.parse(body); } catch (err) { return bad(400, "押し先が読めません"); }
    if (!sub || !/^https:\/\/\S+$/.test(sub.endpoint || "") || body.length > 4096) {
      return bad(400, "押し先が読めません");
    }
    /* 同じなら書きません（KV の書き込みは一日千回まで）。 */
    if ((await env.MAIL.get(BELL_SUB)) !== body) await env.MAIL.put(BELL_SUB, body);
    return ok("ok");
  }

  if (what === "times") {
    let list;
    try { list = JSON.parse(body); } catch (err) { return bad(400, "時刻の列が読めません"); }
    if (!Array.isArray(list)) return bad(400, "時刻の列が読めません");
    const now = Date.now();
    const cur = await readTimes(env.MAIL);
    /* もう鳴らした時刻（rung）までは入れ直しません。アプリが鳴る直前に
       送った列が、見回りのあとに着いても、同じ時刻を二度押さないように。 */
    const next = [...new Set(list.map(Number).filter((t) =>
      Number.isFinite(t) && t > cur.rung && t > now - BELL_LATE && t < now + BELL_AHEAD))]
      .sort((a, b) => a - b).slice(0, BELL_MAX);
    if (!sameList(next, cur.times)) await writeTimes(env.MAIL, { times: next, rung: cur.rung });
    return ok(String(next.length));
  }

  if (what === "off") {
    await env.MAIL.delete(BELL_SUB);
    await env.MAIL.delete(BELL_TIMES);
    return ok("ok");
  }

  return bad(400, "知らない bell です");
}

/** 受け箱の中身を、一週間より古いものと多すぎるぶんを落として読みます。 */
function inboxLines(raw, now) {
  if (!raw) return [];
  return raw.split("\n").slice(1).filter((line) => {
    try { return now - Number(JSON.parse(line).at) < TTL * 1000; }
    catch (err) { return false; }
  }).slice(-(INBOX_MAX - 1));
}

/** 控えを読みます。古い形（"text,json" のコンマ並び）も読めます。 */
async function readIndex(kv) {
  const raw = await kv.get(INDEX);
  if (!raw) return {};
  if (raw.charAt(0) === "{") {
    try {
      const o = JSON.parse(raw);
      if (o && o.slots && typeof o.slots === "object") return o.slots;
    } catch (err) { /* 下で古い形として読みます */ }
  }
  const out = {};
  raw.split(",").filter(Boolean).forEach((s) => { out[s] = 0; });
  return out;
}

const writeIndex = (kv, slots) =>
  kv.put(INDEX, JSON.stringify({ v: 2, slots }), { expirationTtl: TTL });

/* 版＝いちばん新しい「置いた時刻」。

   "0" だけが「何も無い」を意味します。だから、時刻を持たない古い控えから
   読んだときは "1" を返します——中身はあるのに "0" を返すと、`?since=0` を
   送ってきたアプリに「新しいものは無い」と嘘をつくことになります。 */
function verOf(slots) {
  const keys = Object.keys(slots);
  if (!keys.length) return "0";
  let max = 0;
  for (const k of keys) {
    const n = Number(slots[k]) || 0;
    if (n > max) max = n;
  }
  return String(max || 1);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    /* 道が違えば、それ以上何も言いません。「そこは違う」と教えるのは、
       総当たりで探している相手への手がかりになります。

       RELAY_PATH を置き忘れたまま公開すると、道が「合言葉なし」になって
       しまいます。だから未設定は 404 ではなく、はっきり止めます。 */
    if (!env.RELAY_PATH || !/^\/\S{8,}$/.test(env.RELAY_PATH)) {
      return new Response(
        "RELAY_PATH が設定されていません（Settings → Variables and Secrets に Secret で置いてください）",
        { status: 500, headers: CORS });
    }
    if (url.pathname !== env.RELAY_PATH) {
      return new Response("not found", { status: 404, headers: CORS });
    }
    if (!env.MAIL) {
      return new Response("KV が結ばれていません（binding 名は MAIL）", { status: 500, headers: CORS });
    }

    /* 鳴らす役は棚の道より先に。棚の POST・DELETE に落ちると、健康データの
       棚にしまわれたり、郵便受けが空になったりします。 */
    if (url.searchParams.has("bell")) return bell(request, env, url);

    if (request.method === "POST" || request.method === "PUT") {
      const body = await request.text();
      if (body.length > MAX) {
        return new Response("大きすぎます", { status: 413, headers: CORS });
      }
      if (!body.trim()) {
        return new Response("空です", { status: 400, headers: CORS });
      }
      /* 差出人ごとの棚にしまいます。同じ差出人の前の便は「ひとつ前」へ
         下ろしますが、**別の差出人の便には触れません**。

         同じ中身がもう一度来たときは下ろしません——同じものを二通持っても、
         読む側にできることは増えないので。 */
      const slot = slotOf(url, body);
      /* 受け箱に来るのは品物の名前一つか二つです。一通を小さく抑えて、
         二百通溜まっても棚が膨らまないようにします。 */
      if (slot === INBOX && body.length > 1024) {
        return new Response("大きすぎます", { status: 413, headers: CORS });
      }

      /* 版は**必ず進めます**。時計の分解能はミリ秒なので、二本の
         ショートカットが同じ拍で置くと同じ数になり、読む側が「変わって
         いない」と読んでしまいます。前より大きいことだけが要るので、
         同じか古ければ 1 足します。受け箱の一通に添える数もこれです。 */
      const slots = await readIndex(env.MAIL);
      const now = Date.now();
      const top = Number(verOf(slots)) || 0;
      const stamp = now > top ? now : top + 1;

      if (slot === INBOX) {
        const kept = inboxLines(await env.MAIL.get("box:" + slot), now);
        kept.push(JSON.stringify({ at: stamp, text: body }));
        await env.MAIL.put("box:" + slot, [INBOX_HEAD].concat(kept).join("\n"),
          { expirationTtl: TTL });
      } else {
        const cur = await env.MAIL.get("box:" + slot);
        if (cur != null && cur !== body) {
          await env.MAIL.put("box:" + slot + ":prev", cur, { expirationTtl: TTL });
        }
        await env.MAIL.put("box:" + slot, body, { expirationTtl: TTL });
      }

      slots[slot] = stamp;
      await writeIndex(env.MAIL, slots);

      return new Response("ok", {
        status: 200,
        headers: { ...CORS, ...CAN, "Content-Type": "text/plain; charset=utf-8",
                   "Access-Control-Expose-Headers": EXPOSE,
                   "X-Kn-Ver": verOf(slots) },
      });
    }

    if (request.method === "GET") {
      const slots = await readIndex(env.MAIL);

      /* 仕切りの無かったころの "box"。差出人の棚へ移してから渡します
         ——移さずに毎回そのまま渡すと、版の外に置かれたものが混じって、
         「変わっていないのに 200 が返る」ことになります。 */
      const legacy = await env.MAIL.get("box");
      if (legacy != null) {
        await env.MAIL.put("box:legacy", legacy, { expirationTtl: TTL });
        await env.MAIL.delete("box");
        slots.legacy = Date.now();
        await writeIndex(env.MAIL, slots);
      }

      const ver = verOf(slots);
      const head = {
        ...CORS,
        ...CAN,
        "Cache-Control": "no-store",
        "Access-Control-Expose-Headers": EXPOSE,
        "X-Kn-Ver": ver,
      };

      /* 版が同じなら、中身は読みません。ここが「何度覗いてもタダ」の本体で、
         アプリが数分おきに覗けるのはこの 204 があるからです。 */
      const since = url.searchParams.get("since");
      if (ver === "0" || (since && since === ver)) {
        return new Response(null, { status: 204, headers: head });
      }

      /* **ひとつ前 → いま** の順に並べます。読む側は順に取り込むので、
         後に来たほうが勝ちます——いまの便が読めれば、それが残ります。 */
      const parts = [];
      for (const slot of Object.keys(slots)) {
        const prev = await env.MAIL.get("box:" + slot + ":prev");
        if (prev != null) parts.push(prev);
        const one = await env.MAIL.get("box:" + slot);
        if (one != null) parts.push(one);
      }
      /* 控えには名前が残っているが、中身はTTLで消えた——というときです。
         異常ではないので、空と同じに答えます。 */
      if (!parts.length) return new Response(null, { status: 204, headers: head });

      return new Response(parts.join(SEP), {
        status: 200,
        headers: { ...head, "Content-Type": "text/plain; charset=utf-8",
                   "X-Kn-Parts": String(parts.length) },
      });
    }

    /* 捨てる口。渡しても消えなくなったぶん、**意図して空にする道**が要ります
       ——アプリの「中継所を確かめる」が置いた試しの便を片づけるのは、ここです
       （片づけないと、試すたびに歩数 1234 が記録に入ります）。 */
    if (request.method === "DELETE") {
      const slots = await readIndex(env.MAIL);
      const q = url.searchParams.get("slot");
      const names = q ? [q] : Object.keys(slots);
      for (const s of names) {
        await env.MAIL.delete("box:" + s);
        await env.MAIL.delete("box:" + s + ":prev");
        delete slots[s];
      }
      if (!q) await env.MAIL.delete("box");
      await writeIndex(env.MAIL, slots);
      return new Response("ok", {
        status: 200,
        headers: { ...CORS, ...CAN, "Content-Type": "text/plain; charset=utf-8",
                   "Access-Control-Expose-Headers": EXPOSE,
                   "X-Kn-Ver": verOf(slots) },
      });
    }

    return new Response("method not allowed", { status: 405, headers: CORS });
  },

  /* 毎分の見回り（wrangler.jsonc の triggers.crons）。時刻の列が空なら、
     読むのは KV の一回だけです——一日1,440回で、無料枠（10万回）に遠い。 */
  async scheduled(event, env, ctx) {
    const run = bellRound(env, Number(event && event.scheduledTime) || Date.now());
    if (ctx && ctx.waitUntil) ctx.waitUntil(run);
    return run;
  },
};
