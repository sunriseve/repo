(function() {
    const PROVIDERS = {
        movieblast: {
            name: "MovieBlast",
            baseUrl: "https://app.cloud-mb.xyz"
        },
        funmovieslix: {
            name: "Funmovieslix",
            baseUrl: "https://funmovieslix.com"
        }
    };

    const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    function fixUrl(url, base) {
        if (!url) return "";
        if (url.startsWith("http")) return url;
        if (url.startsWith("//")) return "https:" + url;
        if (url.startsWith("/")) return base + url;
        return base + "/" + url;
    }

    function cleanTitle(title) {
        if (!title) return "";
        return String(title).replace(/\s*\(\d{4}\)\s*/g, " ").trim();
    }

    async function getHome() {
        const sections = [];

        try {
            const prov = PROVIDERS.movieblast;
            const token = "jdvhjv25vghhgdhvfch256565jhdgchgfdg==";
            const res = await http_get(prov.baseUrl + "/api/genres/pinned/all/" + token, { "User-Agent": UA });
            if (res && res.body) {
                const json = JSON.parse(res.body);
                const items = (json.data || []).slice(0, 20).map(item => {
                    const isSeries = item.type && item.type.toLowerCase().includes("series");
                    const path = isSeries ? "series/show" : "media/detail";
                    return new MultimediaItem({
                        title: item.name,
                        url: prov.baseUrl + "/api/" + path + "/" + item.id + "/" + token,
                        posterUrl: item.posterPath || "",
                        type: isSeries ? "tvseries" : "movie",
                        source: prov.name
                    });
                });
                if (items.length > 0) sections.push({ name: "MovieBlast Latest", items });
            }
        } catch (e) { console.log("[MovieBlast] " + e.message); }

        try {
            const prov = PROVIDERS.funmovieslix;
            const res = await http_get(prov.baseUrl + "/category/action/page/1", { "User-Agent": UA });
            if (res && res.body) {
                const doc = await parseHtml(res.body);
                const cards = doc.querySelectorAll("#gmr-main-load div.movie-card");
                const items = [];
                for (const card of cards) {
                    const titleEl = card.querySelector("h3");
                    const anchor = card.querySelector("a");
                    if (titleEl && anchor) {
                        items.push(new MultimediaItem({
                            title: cleanTitle(titleEl.textContent.trim()),
                            url: fixUrl(anchor.getAttribute("href") || "", prov.baseUrl),
                            type: "movie",
                            source: prov.name
                        }));
                    }
                    if (items.length >= 20) break;
                }
                if (items.length > 0) sections.push({ name: "Funmovieslix Action", items });
            }
        } catch (e) { console.log("[Funmovieslix] " + e.message); }

        return sections;
    }

    async function search(query) {
        const results = [];

        try {
            const prov = PROVIDERS.movieblast;
            const safeQuery = query.trim().replace(" ", "%20");
            const token = "jdvhjv25vghhgdhvfch256565jhdgchgfdg==";
            const res = await http_get(prov.baseUrl + "/api/search/" + safeQuery + "/" + token, {
                "User-Agent": UA,
                "hash256": "86dc03244adddb3cbedbf0ae36074a736ee293a6477b4b18e82a624eafd0df30",
                "packagename": "com.movieblast\n"
            });
            if (res && res.body) {
                const json = JSON.parse(res.body);
                for (const item of (json.search || []).slice(0, 15)) {
                    if (!item.name || !item.id) continue;
                    const isSeries = item.type && item.type.toLowerCase().includes("serie");
                    const path = isSeries ? "series/show" : "media/detail";
                    results.push(new MultimediaItem({
                        title: item.name,
                        url: prov.baseUrl + "/api/" + path + "/" + item.id + "/" + token,
                        posterUrl: item.posterPath || "",
                        type: isSeries ? "tvseries" : "movie",
                        source: prov.name
                    }));
                }
            }
        } catch (e) { console.log("[MovieBlast Search] " + e.message); }

        try {
            const prov = PROVIDERS.funmovieslix;
            const res = await http_get(prov.baseUrl + "/?s=" + encodeURIComponent(query), { "User-Agent": UA });
            if (res && res.body) {
                const doc = await parseHtml(res.body);
                const cards = doc.querySelectorAll("#gmr-main-load div.movie-card");
                for (const card of cards) {
                    const titleEl = card.querySelector("h3");
                    const anchor = card.querySelector("a");
                    if (titleEl && anchor) {
                        results.push(new MultimediaItem({
                            title: cleanTitle(titleEl.textContent.trim()),
                            url: fixUrl(anchor.getAttribute("href") || "", prov.baseUrl),
                            type: "movie",
                            source: prov.name
                        }));
                    }
                    if (results.length >= 30) break;
                }
            }
        } catch (e) { console.log("[Funmovieslix Search] " + e.message); }

        return results.slice(0, 30);
    }

    async function load(url) {
        const res = await http_get(url, { "User-Agent": UA });
        if (!res || !res.body) return null;

        const doc = await parseHtml(res.body);
        let title = "Unknown";
        let poster = "";
        let description = "";
        let isSeries = url.includes("/series/") || url.includes("/tv/");
        const episodes = [];

        const titleEl = doc.querySelector("h1, h2.page-title, meta[property='og:title']");
        if (titleEl) {
            title = titleEl.getAttribute ? (titleEl.getAttribute("content") || titleEl.textContent) : titleEl.textContent;
            title = cleanTitle(title.split("(")[0].split("-")[0].trim());
        }

        const posterEl = doc.querySelector("meta[property='og:image'], #poster img");
        if (posterEl) poster = posterEl.getAttribute("content") || posterEl.getAttribute("src") || "";

        const descEl = doc.querySelector("div.desc-box p, div.fimm p, .description");
        if (descEl) description = descEl.textContent.trim();

        const epLinks = doc.querySelectorAll("div.gmr-listseries a, #sesh a.ste, a[href*='episode']");
        for (const link of epLinks) {
            const href = link.getAttribute("href") || "";
            const text = link.textContent || "";
            if (href) {
                const sMatch = text.match(/S(\d+)/i);
                const eMatch = text.match(/E?p?s?(\d+)/i);
                episodes.push(new Episode({
                    name: text.trim() || "Episode",
                    url: fixUrl(href, url),
                    season: sMatch ? parseInt(sMatch[1]) : 1,
                    episode: eMatch ? parseInt(eMatch[1]) : 1
                }));
            }
        }

        if (episodes.length > 0) isSeries = true;

        return new MultimediaItem({
            title,
            url,
            posterUrl: fixUrl(poster, url),
            type: isSeries ? "tvseries" : "movie",
            description,
            episodes: episodes.length > 0 ? episodes : undefined
        });
    }

    async function loadStreams(url) {
        const res = await http_get(url, { "User-Agent": UA });
        if (!res || !res.body) return [];

        const streams = [];
        const m3u8Matches = res.body.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi) || [];
        for (const match of m3u8Matches) {
            const cleanUrl = match.replace(/\\+/g, "");
            if (!streams.find(s => s.url === cleanUrl)) {
                streams.push(new StreamResult({ url: cleanUrl, quality: "Auto", source: "HLS" }));
            }
        }

        const doc = await parseHtml(res.body);
        const iframes = doc.querySelectorAll("iframe[src]");
        for (const iframe of iframes) {
            const src = iframe.getAttribute("src") || "";
            if (src.startsWith("http") && !streams.find(s => s.url === src)) {
                streams.push(new StreamResult({ url: src, quality: "Auto", source: "Embed" }));
            }
        }

        return streams;
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
