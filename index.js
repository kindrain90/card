export default {
    async fetch(request) {
        const url = new URL(request.url);

        // preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        const cardAdId = url.searchParams.get("cardAdId");
        if (!cardAdId) return json({ error: "cardAdId required" }, 400);

        const target = `https://card-search.naver.com/item?cardAdId=${encodeURIComponent(cardAdId)}`;

        const upstream = await fetch(target, {
            headers: { "User-Agent": "Mozilla/5.0" }
        });

        if (!upstream.ok) {
            return json({ error: "upstream error", status: upstream.status }, 502);
        }

        const html = await upstream.text();

        // HTML -> 텍스트 라인(간단 변환)
        const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(p|div|li|h\d)>/gi, "\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">");

        const lines = text
            .split("\n")
            .map(s => s.trim())
            .filter(Boolean);

        function sliceBetween(startRe, endRe) {
            const s = lines.findIndex(l => startRe.test(l));
            if (s === -1) return null;
            const e = lines.findIndex((l, i) => i > s && endRe.test(l));
            return lines.slice(s, e === -1 ? lines.length : e);
        }

        // CGV/메가박스 제거(롯데시네마는 살림)
        function sanitize(s) {
            let out = s;

            // "CGV·롯데시네마" -> "롯데시네마"
            out = out.replace(/\bCGV\b\s*[·,/|]\s*/gi, "");
            out = out.replace(/\b메가박스\b\s*[·,/|]\s*/gi, "");

            // 단독 단어 제거
            out = out.replace(/\bCGV\b/gi, "");
            out = out.replace(/\b메가박스\b/gi, "");

            // 정리
            out = out.replace(/\s+/g, " ").trim();
            out = out.replace(/^·\s*|·\s*$/g, "").trim();

            return out;
        }

        // 1) 영화 섹션: "##### 영화" ~ 다음 "##### ..."
        const movieBlock = sliceBetween(/^#####\s*영화\b/, /^#####\s+\S/);
        let movieTitle = null;
        let movieDetail = null;

        if (movieBlock && movieBlock.length) {
            movieTitle = sanitize(movieBlock[0].replace(/^#####\s*/, ""));
            movieDetail = movieBlock.slice(1).map(sanitize).filter(Boolean).join("\n") || null;
        }

        // 2) 공통기준/제외대상
        const commonRules = sliceBetween(/^\[.*공통기준\]$/, /^\[.*\]$/);
        const exclusions = sliceBetween(/^\[캐시백 적용 제외 대상\]$/, /^\[.*\]$/);

        return json({
            cardAdId,
            sourceUrl: target,
            movieTitle,
            movieDetail,
            commonRules: commonRules ? commonRules.map(sanitize).filter(Boolean).join("\n") : null,
            exclusions: exclusions ? exclusions.map(sanitize).filter(Boolean).join("\n") : null
        });
    }
};

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };
}

function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            ...corsHeaders()
        }
    });
}
