/* =========================================================
   くらしノート — 中継所（Cloudflare Worker）
   =========================================================

   郵便受けです。それ以上のことはしません。

     POST <URL>   本文をしまう（同じ差出人の前の便だけを差し替え）
     GET  <URL>   しまってあるものを**ぜんぶ**渡して、消す
                  何も無ければ 204（「空」であって、異常ではありません）

   ---- 仕切りが要る理由 ----

   郵便受けは一つでした。ショートカットが一本のうちは足りていましたが、
   二本になった時点で壊れました——「からだ（歩数・消費）」を置いた上に
   「睡眠」を置くと、からだのほうが読まれないまま消えます。一時間ごとに
   両方が走れば、アプリが取りに来たとき残っているのは最後の一通だけ。
   「たまに4件まとめて入る」「ふだんは更新されない」はこれでした。

   だから仕切りを入れます。**差出人ごとに一つずつ**しまい、GET でぜんぶ
   まとめて渡します。同じ差出人の新しい便は前のを差し替えるので、溜まって
   膨らむこともありません（一時間ごとに同じ睡眠を置いても、残るのは一通）。

   差出人は ?slot= で名乗れます。名乗らなければ、本文の一文字目で分けます
   ——`{` か `[` で始まれば "json"（睡眠のような生の記録）、それ以外は
   "text"（key=value の書式）。中身は相変わらず読みません。一文字だけ見ます。

   ショートカットが POST し、くらしノートが GET します。あいだに何も
   解釈しません——本文はただの文字列として通します。ここで形を検査すると、
   アプリ側の読み方を変えるたびに中継所も直す羽目になります。

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
const TTL = 60 * 60 * 24 * 7;  // 取りに来ないまま一週間経った便は捨てる
const MAX = 64 * 1024;         // 健康データ一日ぶんは数百バイト。桁で余裕を見ています

/* 便と便の仕切り。ASCII の RS（レコード区切り）。健康データの文字列には
   出てこない字なので、本文を壊しません。 */
const SEP = "\u001E";

/* しまってある差出人の一覧。KV の list() を使わずに済ませるための控えです
   （list() は結果整合の揺れが大きく、置いた直後に見えないことがあります）。 */
const INDEX = "box:slots";

const slotOf = (url, body) => {
  const q = url.searchParams.get("slot");
  if (q && /^[a-zA-Z0-9_-]{1,16}$/.test(q)) return q;
  return /^\s*[[{]/.test(body) ? "json" : "text";
};

/* このアプリのページから読めるようにするための約束。GETに custom header を
   付けないので、これだけで足ります。 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

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
      /* 差出人ごとの棚にしまいます。同じ差出人の前の便は差し替えますが、
         **別の差出人の便には触れません**——ここが仕切りの本体です。 */
      const slot = slotOf(url, body);
      await env.MAIL.put("box:" + slot, body, { expirationTtl: TTL });

      const raw = await env.MAIL.get(INDEX);
      const slots = raw ? raw.split(",").filter(Boolean) : [];
      if (!slots.includes(slot)) {
        slots.push(slot);
        await env.MAIL.put(INDEX, slots.join(","), { expirationTtl: TTL });
      }
      return new Response("ok", {
        status: 200,
        headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (request.method === "GET") {
      /* しまってあるものを**ぜんぶ**渡します。仕切りで繋いで一本の文字列に
         するので、受け取る側は SEP で切って一通ずつ読みます。

         古い形（仕切りの無かったころの "box"）も一緒に拾います——この
         worker を入れ替えた時点で郵便受けに残っていた便を、捨てないため。 */
      const raw = await env.MAIL.get(INDEX);
      const slots = raw ? raw.split(",").filter(Boolean) : [];
      const parts = [];
      const legacy = await env.MAIL.get("box");
      if (legacy != null) parts.push(legacy);
      for (const slot of slots) {
        const one = await env.MAIL.get("box:" + slot);
        if (one != null) parts.push(one);
      }
      if (!parts.length) return new Response(null, { status: 204, headers: CORS });

      /* 渡したら消します。同じ便を二度読ませないためで、これが無いと
         タブを開くたびに同じ日のデータを取り込み直すことになります。

         ただし KV は結果整合です。置いたことも消したことも、世界中に
         伝わるまで最大60秒ほどかかります。だから稀に同じ便が二度渡ること
         があります——アプリ側は同じ日の同じ種類を差し替えるので、二度
         入っても記録は増えません。ここは「たいてい一度」で足ります。 */
      if (legacy != null) await env.MAIL.delete("box");
      for (const slot of slots) await env.MAIL.delete("box:" + slot);
      await env.MAIL.delete(INDEX);
      await env.MAIL.delete("box:replaced");   // 古い形の名残

      return new Response(parts.join(SEP), {
        status: 200,
        headers: {
          ...CORS,
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Expose-Headers": "X-Kn-Parts",
          // 何通まとめて渡したか。アプリはこれを見て切り分けます。
          "X-Kn-Parts": String(parts.length),
        },
      });
    }

    return new Response("method not allowed", { status: 405, headers: CORS });
  },
};
