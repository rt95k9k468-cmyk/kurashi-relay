/* =========================================================
   くらしノート — 中継所（Cloudflare Worker）
   =========================================================

   郵便受けです。それ以上のことはしません。

     POST <URL>   本文をしまう（前の便は上書き）
     GET  <URL>   しまってあるものを渡して、消す
                  何も無ければ 204（「空」であって、異常ではありません）

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
      await env.MAIL.put("box", body, { expirationTtl: TTL });
      return new Response("ok", {
        status: 200,
        headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (request.method === "GET") {
      const body = await env.MAIL.get("box");
      if (body == null) return new Response(null, { status: 204, headers: CORS });
      /* 渡したら消します。同じ便を二度読ませないためで、これが無いと
         タブを開くたびに同じ日のデータを取り込み直すことになります。

         ただし KV は結果整合です。置いたことも消したことも、世界中に
         伝わるまで最大60秒ほどかかります。だから稀に同じ便が二度渡ること
         があります——アプリ側は同じ日の同じ種類を差し替えるので、二度
         入っても記録は増えません。ここは「たいてい一度」で足ります。 */
      await env.MAIL.delete("box");
      return new Response(body, {
        status: 200,
        headers: {
          ...CORS,
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response("method not allowed", { status: 405, headers: CORS });
  },
};
