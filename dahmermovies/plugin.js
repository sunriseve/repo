(function() {
    const BASE_URL = "https://a.111477.xyz";

    async function fetch(url, options = {}) {
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            ...options.headers
        };
        const res = await http_get(url, headers);
        return res;
    }

    async function resolveRedirect(url, maxRedirects = 5) {
        try {
            let finalUrl = url;
            for (let i = 0; i < maxRedirects; i++) {
                const res = await fetch(finalUrl, { 
                    method: 'HEAD',
                    redirect: 'manual'
                });
                
                if (res.status >= 300 && res.status < 400) {
                    const location = res.headers && (res.headers.location || res.headers.Location);
                    if (location) {
                        finalUrl = location.startsWith('http') ? location : new URL(location, finalUrl).href;
                    } else {
                        break;
                    }
                } else if (res.status === 200) {
                    return finalUrl;
                } else {
                    break;
                }
            }
            return finalUrl;
        } catch (e) {
            return url;
        }
    }

    function extractYear(title) {
        const match = title.match(/\((\d{4})\)/);
        return match ? parseInt(match[1]) : null;
    }

    function parseDirectoryListings(html) {
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
            const fullUrl = href.startsWith("http") ? href : BASE_URL + href;
            
            results.push({
                name: cleanName,
                url: fullUrl,
                isDir: isDir
            });
        }
        
        return results;
    }

    function detectType(name) {
        const lower = name.toLowerCase();
        if (lower.includes('kdrama') || lower.includes('asiandrama') || lower.includes('drama')) return 'series';
        if (lower.includes('movie') || /1080p|720p|2160p|4k/i.test(name)) return 'movie';
        return 'movie';
    }

    async function getHome(cb) {
        try {
            const home = {};
            
            const latestMoviesHtml = await fetch(BASE_URL + "/movies/");
            const latestMovies = parseDirectoryListings(latestMoviesHtml.body || latestMoviesHtml);
            const movieItems = latestMovies.slice(0, 30).map(item => new MultimediaItem({
                url: item.url,
                title: item.name,
                posterUrl: "https://placehold.co/400x600/1a1a2e/FFF?text=" + encodeURIComponent(item.name.substring(0, 25)),
                type: "movie",
                year: extractYear(item.name)
            }));
            if (movieItems.length) home["Latest Movies"] = movieItems;
            
            const popularHtml = await fetch(BASE_URL + "/tvs/");
            const popularShows = parseDirectoryListings(popularHtml.body || popularHtml);
            const tvItems = popularShows.slice(0, 30).map(item => new MultimediaItem({
                url: item.url,
                title: item.name,
                posterUrl: "https://placehold.co/400x600/1a1a2e/FFF?text=" + encodeURIComponent(item.name.substring(0, 25)),
                type: "series",
                year: extractYear(item.name)
            }));
            if (tvItems.length) home["Popular TV Shows"] = tvItems;
            
            const dramaHtml = await fetch(BASE_URL + "/asiandrama/");
            const dramas = parseDirectoryListings(dramaHtml.body || dramaHtml);
            const dramaItems = dramas.slice(0, 30).map(item => new MultimediaItem({
                url: item.url,
                title: item.name,
                posterUrl: "https://placehold.co/400x600/1a1a2e/FFF?text=" + encodeURIComponent(item.name.substring(0, 25)),
                type: "series",
                year: extractYear(item.name)
            }));
            if (dramaItems.length) home["Asian Drama"] = dramaItems;
            
            const kdramaHtml = await fetch(BASE_URL + "/kdrama/");
            const kdramas = parseDirectoryListings(kdramaHtml.body || kdramaHtml);
            const kdramaItems = kdramas.slice(0, 30).map(item => new MultimediaItem({
                url: item.url,
                title: item.name,
                posterUrl: "https://placehold.co/400x600/1a1a2e/FFF?text=" + encodeURIComponent(item.name.substring(0, 25)),
                type: "series",
                year: extractYear(item.name)
            }));
            if (kdramaItems.length) home["Korean Drama"] = kdramaItems;
            
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
                    const res = await fetch(BASE_URL + dir.path);
                    const html = res.body || res;
                    const items = parseDirectoryListings(html);
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
            const res = await fetch(url);
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
                const items = parseDirectoryListings(html);
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
            const res = await fetch(url);
            const html = res.body || res;
            const items = parseDirectoryListings(html);
            
            const fileItems = items.filter(item => !item.isDir);
            
            if (fileItems.length === 0) {
                cb({ success: true, data: [] });
                return;
            }
            
            const streams = [];
            
            for (const item of fileItems.slice(0, 10)) {
                const filename = item.name.toLowerCase();
                
                let quality = "720p";
                if (filename.includes("2160p") || filename.includes("4k")) quality = "4K";
                else if (filename.includes("1080p")) quality = "1080p";
                else if (filename.includes("720p")) quality = "720p";
                else if (filename.includes("480p")) quality = "480p";
                else if (filename.includes("360p")) quality = "360p";
                
                const fileUrl = item.url;
                
                streams.push(new StreamResult({
                    url: fileUrl,
                    quality: quality,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Referer": BASE_URL + "/",
                        "Origin": BASE_URL
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