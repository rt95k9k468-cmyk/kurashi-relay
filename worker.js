/* =========================================================
   くらしノート — 中継所（Cloudflare Worker）
   =========================================================

   郵便受けです。それ以上のことはしません。

     POST   <URL>            本文をしまう（同じ差出人の前の便は「ひとつ前」へ下がる）
     GET    <URL>            しまってあるものを**ぜんぶ**渡す。**消しません**
     GET    <URL>?since=版   版が変わっていなければ 204（＝新しい便は無い）
     DELETE <URL>            ぜんぶ捨てる（?slot=名前 でその差出人だけ）

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
const EXPOSE = "X-Kn-Ver, X-Kn-Parts";

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
      const cur = await env.MAIL.get("box:" + slot);
      if (cur != null && cur !== body) {
        await env.MAIL.put("box:" + slot + ":prev", cur, { expirationTtl: TTL });
      }
      await env.MAIL.put("box:" + slot, body, { expirationTtl: TTL });

      /* 版は**必ず進めます**。時計の分解能はミリ秒なので、二本の
         ショートカットが同じ拍で置くと同じ数になり、読む側が「変わって
         いない」と読んでしまいます。前より大きいことだけが要るので、
         同じか古ければ 1 足します。 */
      const slots = await readIndex(env.MAIL);
      const now = Date.now();
      const top = Number(verOf(slots)) || 0;
      slots[slot] = now > top ? now : top + 1;
      await writeIndex(env.MAIL, slots);

      return new Response("ok", {
        status: 200,
        headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8",
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
        headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8",
                   "Access-Control-Expose-Headers": EXPOSE,
                   "X-Kn-Ver": verOf(slots) },
      });
    }

    return new Response("method not allowed", { status: 405, headers: CORS });
  },
};
