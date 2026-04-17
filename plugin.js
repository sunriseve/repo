(function() {
    const BASE_URL = "https://a.111477.xyz";

    async function fetch(url) {
        const res = await http_get(url, {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        });
        return res.body || "";
    }

    function extractYear(title) {
        const match = title.match(/\((\d{4})\)/);
        return match ? parseInt(match[1]) : null;
    }

    function parseDirectoryListings(html, type) {
        const results = [];
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let match;
        
        while ((match = rowRegex.exec(html)) !== null) {
            const row = match[1];
            const linkMatch = row.match(/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]+)<\/a>/i);
            if (!linkMatch) continue;
            
            const href = linkMatch[1];
            const name = linkMatch[2].trim();
            
            if (href === "../" || name === "Parent Directory" || name === "../") continue;
            if (!name) continue;
            
            const isDir = href.endsWith("/");
            const cleanName = name.replace(/\/$/, "").trim();
            
            let title = cleanName;
            let year = extractYear(cleanName);
            
            let posterUrl = "https://placehold.co/400x600/1a1a2e/FFF?text=" + encodeURIComponent(title.substring(0, 30));
            
            const fullUrl = href.startsWith("http") ? href : BASE_URL + href;
            
            let itemType = isDir ? "series" : "movie";
            if (type === "asiandrama" || type === "kdrama") itemType = "series";
            if (type === "movies") itemType = "movie";
            
            results.push(new MultimediaItem({
                url: fullUrl,
                title: title,
                posterUrl: posterUrl,
                type: itemType,
                year: year,
                description: ""
            }));
        }
        
        return results;
    }

    async function getHome(cb) {
        try {
            const home = {};
            
            const latestMoviesHtml = await fetch(BASE_URL + "/movies/");
            const latestMovies = parseDirectoryListings(latestMoviesHtml, "movies").slice(0, 30);
            if (latestMovies.length) home["Latest Movies"] = latestMovies;
            
            const popularHtml = await fetch(BASE_URL + "/tvs/");
            const popularShows = parseDirectoryListings(popularHtml, "tvs").slice(0, 30);
            if (popularShows.length) home["Popular TV Shows"] = popularShows;
            
            const dramaHtml = await fetch(BASE_URL + "/asiandrama/");
            const dramas = parseDirectoryListings(dramaHtml, "asiandrama").slice(0, 30);
            if (dramas.length) home["Asian Drama"] = dramas;
            
            const kdramaHtml = await fetch(BASE_URL + "/kdrama/");
            const kdramas = parseDirectoryListings(kdramaHtml, "kdrama").slice(0, 30);
            if (kdramas.length) home["Korean Drama"] = kdramas;
            
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
                { path: "/movies/", type: "movies" },
                { path: "/tvs/", type: "tvs" },
                { path: "/asiandrama/", type: "asiandrama" },
                { path: "/kdrama/", type: "kdrama" }
            ];
            
            for (const dir of dirs) {
                try {
                    const html = await fetch(BASE_URL + dir.path);
                    const items = parseDirectoryListings(html, dir.type);
                    const filtered = items.filter(item => 
                        item.title.toLowerCase().includes(searchTerm)
                    );
                    results.push(...filtered);
                } catch (e) {}
            }
            
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR" });
        }
    }

    async function load(url, cb) {
        try {
            const html = await fetch(url);
            const isDirectory = html.includes("Index of");
            
            let title = "";
            const titleMatch = url.match(/\/([^\/]+)\/$/);
            if (titleMatch) {
                title = decodeURIComponent(titleMatch[1]).replace(/\.\d{4}p.*$/i, "").replace(/\.S\d{2}.*$/i, "");
            }
            
            let posterUrl = "https://placehold.co/400x600/1a1a2e/FFF?text=" + encodeURIComponent(title.substring(0, 20));
            
            let episodes = [];
            if (isDirectory) {
                const items = parseDirectoryListings(html, "series");
                
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    const epMatch = item.title.match(/S(\d{2})E(\d{2})/i);
                    if (epMatch) {
                        episodes.push(new Episode({
                            name: "S" + epMatch[1] + "E" + epMatch[2],
                            url: item.url,
                            season: parseInt(epMatch[1]),
                            episode: parseInt(epMatch[2]),
                            posterUrl: posterUrl
                        }));
                    }
                }
                
                if (episodes.length === 0) {
                    episodes = items.slice(0, 50).map((item, idx) => new Episode({
                        name: item.title,
                        url: item.url,
                        season: 1,
                        episode: idx + 1,
                        posterUrl: posterUrl
                    }));
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
            const html = await fetch(url);
            const items = parseDirectoryListings(html, "files");
            
            const streams = [];
            
            for (const item of items.slice(0, 10)) {
                const filename = item.title.toLowerCase();
                
                let quality = "720p";
                if (filename.includes("2160p") || filename.includes("4k")) quality = "4K";
                else if (filename.includes("1080p")) quality = "1080p";
                else if (filename.includes("720p")) quality = "720p";
                else if (filename.includes("480p")) quality = "480p";
                
                streams.push(new StreamResult({
                    url: item.url,
                    quality: quality,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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