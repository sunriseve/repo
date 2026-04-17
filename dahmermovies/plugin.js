(function() {
    const BASE_URL = "https://a.111477.xyz";
    const REDIRECT_URL = "https://p.111477.xyz";

    function getHeaders() {
        return {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5"
        };
    }

    function parseLinks(html) {
        const links = [];
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let match;
        
        while ((match = rowRegex.exec(html)) !== null) {
            const row = match[1];
            const linkMatch = row.match(/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]+)<\/a>/i);
            if (!linkMatch) continue;
            
            const href = linkMatch[1];
            const text = linkMatch[2].trim();
            
            if (!text || href === "../" || text === "../" || text === "Parent Directory") continue;
            
            const isDir = href.endsWith("/");
            const cleanText = text.replace(/\/$/, "").trim();
            
            let fullUrl;
            if (href.startsWith("http")) {
                fullUrl = href;
            } else if (href.startsWith("/")) {
                fullUrl = BASE_URL + href;
            } else {
                fullUrl = BASE_URL + "/" + href;
            }
            
            links.push({
                name: cleanText,
                url: fullUrl,
                isDir: isDir
            });
        }
        
        return links;
    }

    function extractYear(title) {
        const match = title.match(/\((\d{4})\)/);
        return match ? parseInt(match[1]) : null;
    }

    function getQuality(filename) {
        const lower = filename.toLowerCase();
        if (lower.includes("2160p") || lower.includes("4k")) return "4K";
        if (lower.includes("1080p")) return "1080p";
        if (lower.includes("720p")) return "720p";
        if (lower.includes("480p")) return "480p";
        if (lower.includes("360p")) return "360p";
        return "720p";
    }

    async function getHome(cb) {
        try {
            const home = {};
            const dirs = [
                { path: "/movies/", name: "Latest Movies", type: "movie" },
                { path: "/tvs/", name: "Popular TV Shows", type: "series" },
                { path: "/asiandrama/", name: "Asian Drama", type: "series" },
                { path: "/kdrama/", name: "Korean Drama", type: "series" }
            ];
            
            for (const dir of dirs) {
                try {
                    const res = await http_get(BASE_URL + dir.path, getHeaders());
                    const html = res.body || res;
                    const items = parseLinks(html);
                    
                    const multimediaItems = items.slice(0, 30).map(item => new MultimediaItem({
                        url: item.url,
                        title: item.name,
                        posterUrl: "https://placehold.co/400x600/1a1a2e/FFF?text=" + encodeURIComponent(item.name.substring(0, 25)),
                        type: dir.type,
                        year: extractYear(item.name)
                    }));
                    
                    if (multimediaItems.length) home[dir.name] = multimediaItems;
                } catch (e) {
                    console.log("[DahmerMovies getHome] Error: " + e.message);
                }
            }
            
            cb({ success: true, data: home });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: e.toString() });
        }
    }

    async function search(query, cb) {
        try {
            const results = [];
            const searchTerm = query.toLowerCase();
            const dirs = [
                { path: "/movies/", type: "movie" },
                { path: "/tvs/", type: "series" },
                { path: "/asiandrama/", type: "series" },
                { path: "/kdrama/", type: "series" }
            ];
            
            for (const dir of dirs) {
                try {
                    const res = await http_get(BASE_URL + dir.path, getHeaders());
                    const html = res.body || res;
                    const items = parseLinks(html);
                    
                    const filtered = items.filter(item => 
                        item.name.toLowerCase().includes(searchTerm)
                    );
                    
                    filtered.forEach(item => {
                        results.push(new MultimediaItem({
                            url: item.url,
                            title: item.name,
                            posterUrl: "https://placehold.co/400x600/1a1a2e/FFF?text=" + encodeURIComponent(item.name.substring(0, 25)),
                            type: dir.type,
                            year: extractYear(item.name)
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
            const res = await http_get(url, getHeaders());
            const html = res.body || res;
            const isDirectory = html.includes("Index of") || html.includes("index of");
            
            let title = "";
            const parts = url.split("/").filter(Boolean);
            if (parts.length > 0) {
                title = decodeURIComponent(parts[parts.length - 1]);
                title = title.replace(/\.\d{4}p.*$/i, "").replace(/\.S\d{2}.*$/i, "");
            }
            
            let posterUrl = "https://placehold.co/400x600/1a1a2e/FFF?text=" + encodeURIComponent(title.substring(0, 20));
            
            let episodes = [];
            if (isDirectory) {
                const items = parseLinks(html);
                const fileItems = items.filter(item => !item.isDir);
                
                fileItems.forEach((item, idx) => {
                    const epMatch = item.name.match(/S(\d{2})E(\d{2})/i);
                    if (epMatch) {
                        episodes.push(new Episode({
                            name: "S" + epMatch[1] + "E" + epMatch[2],
                            url: item.url,
                            season: parseInt(epMatch[1]),
                            episode: parseInt(epMatch[2]),
                            posterUrl: posterUrl
                        }));
                    } else {
                        episodes.push(new Episode({
                            name: item.name,
                            url: item.url,
                            season: 1,
                            episode: idx + 1,
                            posterUrl: posterUrl
                        }));
                    }
                });
                
                if (episodes.length === 0) {
                    cb({ success: true, data: {
                        url: url,
                        title: title,
                        posterUrl: posterUrl,
                        type: "movie",
                        description: "Movie"
                    }});
                    return;
                }
            }
            
            const yearMatch = url.match(/\((\d{4})\)/);
            const year = yearMatch ? parseInt(yearMatch[1]) : null;
            
            const movie = new MultimediaItem({
                url: url,
                title: title,
                posterUrl: posterUrl,
                type: episodes.length > 0 ? "series" : "movie",
                year: year,
                description: isDirectory ? `Contains ${episodes.length} episodes` : "Movie",
                episodes: episodes
            });
            
            cb({ success: true, data: movie });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.toString() });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const res = await http_get(url, getHeaders());
            const html = res.body || res;
            const items = parseLinks(html);
            
            const fileItems = items.filter(item => !item.isDir);
            
            if (fileItems.length === 0) {
                cb({ success: true, data: [] });
                return;
            }
            
            const streams = [];
            
            for (const item of fileItems.slice(0, 10)) {
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