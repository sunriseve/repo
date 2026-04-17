(function() {
    const BASE_URL = "https://a.111477.xyz";
    const REDIRECT_URL = "https://p.111477.xyz";

    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": BASE_URL + "/"
    };

    async function get(url) {
        const res = await http_get(url, HEADERS);
        return res.body || res;
    }

    function parseYear(name) {
        const m = name.match(/\((\d{4})\)/);
        return m ? parseInt(m[1]) : null;
    }

    function getQuality(name) {
        const l = name.toLowerCase();
        if (l.includes("2160p") || l.includes("4k")) return "4K";
        if (l.includes("1080p")) return "1080p";
        if (l.includes("720p")) return "720p";
        if (l.includes("480p")) return "480p";
        if (l.includes("360p")) return "360p";
        return "720p";
    }

    function parseLinks(html) {
        const items = [];
        const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let match;
        while ((match = trRegex.exec(html)) !== null) {
            const row = match[1];
            const aMatch = row.match(/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]+)<\/a>/i);
            if (!aMatch) continue;
            const href = aMatch[1];
            const name = aMatch[2].trim();
            if (!name || name === "Parent Directory" || href === "../") continue;
            const isDir = href.endsWith("/");
            const cleanName = name.replace(/\/$/, "").trim();
            const fullUrl = href.startsWith("http") ? href : BASE_URL + href;
            items.push({ name: cleanName, url: fullUrl, isDir: isDir });
        }
        return items;
    }

    async function getHome(cb) {
        try {
            const home = {};
            const sections = [
                { p: "/movies/", n: "Latest Movies", t: "movie" },
                { p: "/tvs/", n: "Popular TV Shows", t: "series" },
                { p: "/asiandrama/", n: "Asian Drama", t: "series" },
                { p: "/kdrama/", n: "Korean Drama", t: "series" }
            ];
            
            for (const s of sections) {
                try {
                    const html = await get(BASE_URL + s.p);
                    const items = parseLinks(html);
                    const movies = items.slice(0, 30).map(i => new MultimediaItem({
                        url: i.url,
                        title: i.name,
                        posterUrl: "https://placehold.co/400x600/1a1a2e/FFF?text=" + encodeURIComponent(i.name.substring(0, 20)),
                        type: s.t,
                        year: parseYear(i.name)
                    }));
                    if (movies.length) home[s.n] = movies;
                } catch (e) {}
            }
            cb({ success: true, data: home });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.toString() });
        }
    }

    async function search(query, cb) {
        try {
            const results = [];
            const q = query.toLowerCase();
            const dirs = [
                { p: "/movies/", t: "movie" },
                { p: "/tvs/", t: "series" },
                { p: "/asiandrama/", t: "series" },
                { p: "/kdrama/", t: "series" }
            ];
            
            for (const d of dirs) {
                try {
                    const html = await get(BASE_URL + d.p);
                    const items = parseLinks(html);
                    const filtered = items.filter(i => i.name.toLowerCase().includes(q));
                    filtered.forEach(i => {
                        results.push(new MultimediaItem({
                            url: i.url,
                            title: i.name,
                            posterUrl: "https://placehold.co/400x600/1a1a2e/FFF?text=" + encodeURIComponent(i.name.substring(0, 20)),
                            type: d.t,
                            year: parseYear(i.name)
                        }));
                    });
                } catch (e) {}
            }
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR" });
        }
    }

    async function load(url, cb) {
        try {
            const html = await get(url);
            const isIndex = html.includes("Index of") || html.includes("index of");
            
            let title = "";
            const parts = url.split("/").filter(Boolean);
            if (parts.length > 0) {
                title = decodeURIComponent(parts[parts.length - 1]);
                title = title.replace(/\.\d{4}p.*$/i, "").replace(/\.S\d{2}.*$/i, "");
            }
            
            const poster = "https://placehold.co/400x600/1a1a2e/FFF?text=" + encodeURIComponent(title.substring(0, 15));
            let episodes = [];
            let itemType = "movie";
            
            if (isIndex) {
                const items = parseLinks(html);
                const files = items.filter(i => !i.isDir);
                const dirs = items.filter(i => i.isDir);
                
                if (dirs.length > 0) {
                    itemType = "series";
                    dirs.forEach((d, idx) => {
                        episodes.push(new Episode({
                            name: d.name,
                            url: d.url,
                            season: 1,
                            episode: idx + 1,
                            posterUrl: poster
                        }));
                    });
                } else if (files.length > 0) {
                    files.forEach((f, idx) => {
                        const epMatch = f.name.match(/S(\d{2})E(\d{2})/i);
                        if (epMatch) {
                            episodes.push(new Episode({
                                name: "S" + epMatch[1] + "E" + epMatch[2],
                                url: f.url,
                                season: parseInt(epMatch[1]),
                                episode: parseInt(epMatch[2]),
                                posterUrl: poster
                            }));
                        } else {
                            episodes.push(new Episode({
                                name: f.name,
                                url: f.url,
                                season: 1,
                                episode: idx + 1,
                                posterUrl: poster
                            }));
                        }
                    });
                }
            }
            
            const year = parseYear(url);
            
            const item = new MultimediaItem({
                url: url,
                title: title,
                posterUrl: poster,
                type: itemType,
                year: year,
                description: episodes.length > 0 ? `${episodes.length} items` : "Movie",
                episodes: episodes
            });
            
            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.toString() });
        }
    }

    async function loadStreams(url, cb) {
        try {
            let items = [];
            
            if (url.includes(BASE_URL) && !url.endsWith("/")) {
                const dirUrl = url.substring(0, url.lastIndexOf("/") + 1);
                const filename = url.substring(url.lastIndexOf("/") + 1);
                const html = await get(dirUrl);
                const allItems = parseLinks(html);
                const matched = allItems.filter(i => i.name === decodeURIComponent(filename));
                if (matched.length) {
                    items = matched;
                } else {
                    items = allItems.filter(i => !i.isDir).slice(0, 1);
                    if (items.length) items[0].url = url;
                }
            } else {
                const html = await get(url);
                const allItems = parseLinks(html);
                items = allItems.filter(i => !i.isDir);
            }
            
            if (items.length === 0) {
                cb({ success: true, data: [] });
                return;
            }
            
            const streams = [];
            for (const item of items.slice(0, 10)) {
                const quality = getQuality(item.name);
                const streamUrl = REDIRECT_URL + "/bulk?u=" + encodeURIComponent(item.url);
                
                streams.push(new StreamResult({
                    url: streamUrl,
                    quality: quality,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Referer": BASE_URL + "/"
                    }
                }));
            }
            
            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.toString() });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();