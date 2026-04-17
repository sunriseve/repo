(function() {

    const BASE_URL = manifest && manifest.baseUrl ? manifest.baseUrl : "https://cinemacity.cc";
    
    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": "dle_user_id=32729; dle_password=894171c6a8dab18ee594d5c652009a35;"
    };
    
    const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
    const CINEMETA_URL = "https://v3-cinemeta.strem.io/meta";
    
    const HOME_SECTIONS = [
        { name: "Movies", path: "/movies" },
        { name: "TV Series", path: "/tv-series" },
        { name: "Anime", path: "/xfsearch/genre/anime" },
        { name: "Asian", path: "/xfsearch/genre/asian" },
        { name: "Animation", path: "/xfsearch/genre/animation" },
        { name: "Documentary", path: "/xfsearch/genre/documentary" }
    ];
    
    // --- DOM Helpers ---
    
    function textOf(el) {
        return el ? (el.textContent || el.innerText || "").trim() : "";
    }
    
    function getAttr(el, attr) {
        if (!el) return "";
        return el.getAttribute ? (el.getAttribute(attr) || "") : "";
    }
    
    function queryOne(doc, selector) {
        return doc.querySelector ? doc.querySelector(selector) : null;
    }
    
    function queryAll(doc, selector) {
        return doc.querySelectorAll ? Array.from(doc.querySelectorAll(selector)) : [];
    }
    
    // --- Encoding Helpers ---
    
    function toBase64(str) {
        return btoa(unescape(encodeURIComponent(str)));
    }
    
    function fromBase64(str) {
        return decodeURIComponent(escape(atob(str)));
    }
    
    // --- Quality & Parsing Helpers ---
    
    function extractQuality(url) {
        if (!url) return null;
        const u = url.toLowerCase();
        if (u.includes("2160p") || u.includes("4k")) return "2160p";
        if (u.includes("1440p")) return "1440p";
        if (u.includes("1080p") || u.includes("fhd")) return "1080p";
        if (u.includes("720p") || u.includes("hd")) return "720p";
        if (u.includes("480p")) return "480p";
        if (u.includes("360p")) return "360p";
        return null;
    }
    
    function cleanTitle(title) {
        return String(title || "")
            .replace(/\s*\(\d{4}\)\s*$/, "")
            .replace(/\s*».*$/, "")
            .replace(/\s*-\s*$/, "")
            .trim();
    }
    
    async function fetchPage(url, extraHeaders) {
        const h = Object.assign({}, HEADERS, extraHeaders || {});
        try {
            const res = await http_get(url, { headers: h });
            if (res && res.body) return res;
        } catch (e) {}
        return null;
    }
    
    // --- Subtitle Parsing ---
    
    function parseSubtitles(raw) {
        const tracks = [];
        if (!raw || typeof raw !== "string") return tracks;
        
        const parts = raw.split(",");
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            
            const match = trimmed.match(/^\[([^\]]+)\](https?:\/\/.+\.vtt[^,\s]*)$/);
            if (match) {
                tracks.push({
                    url: match[2],
                    label: match[1],
                    lang: match[1]
                });
            }
        }
        return tracks;
    }
    
    // --- PlayerJS Extraction ---
    
    function extractPlayerScript(doc) {
        const scripts = queryAll(doc, "script");
        for (const script of scripts) {
            const text = script.textContent || "";
            if (!text.includes("atob")) continue;
            
            const matches = text.match(/atob\s*\(\s*["']([^"']+)["']\s*\)/g);
            if (!matches) continue;
            
            for (const match of matches) {
                const b64Match = match.match(/atob\s*\(\s*["']([^"']+)["']\s*\)/);
                if (!b64Match) continue;
                
                try {
                    const decoded = atob(b64Match[1]);
                    if (decoded.includes("new Playerjs(")) {
                        return decoded;
                    }
                    
                    // Nested atob handling
                    if (decoded.includes("atob(")) {
                        const nestedMatches = decoded.match(/atob\s*\(\s*["']([^"']+)["']\s*\)/g) || [];
                        for (const nested of nestedMatches) {
                            const nestedB64Match = nested.match(/atob\s*\(\s*["']([^"']+)["']\s*\)/);
                            if (nestedB64Match) {
                                const nestedDecoded = atob(nestedB64Match[1]);
                                if (nestedDecoded.includes("new Playerjs(")) {
                                    return nestedDecoded;
                                }
                            }
                        }
                    }
                } catch (e) {}
            }
        }
        return null;
    }
    
    function parsePlayerData(scriptContent) {
        if (!scriptContent) return null;
        try {
            const start = scriptContent.indexOf("new Playerjs(");
            if (start === -1) return null;
            
            const afterStart = scriptContent.substring(start + "new Playerjs(".length);
            let end = afterStart.lastIndexOf(");");
            if (end === -1) return null;
            
            let jsonStr = afterStart.substring(0, end).trim();
            if (jsonStr.startsWith("(") && jsonStr.endsWith(")")) {
                jsonStr = jsonStr.slice(1, -1);
            }
            
            try {
                return JSON.parse(jsonStr);
            } catch (e) {
                // Fallback manual extraction if JSON is malformed
                const result = {};
                const fileMatch = jsonStr.match(/file\s*:\s*["']([^"']+)["']/);
                if (fileMatch) result.file = fileMatch[1];
                const subMatch = jsonStr.match(/subtitle\s*:\s*["']([^"']+)["']/);
                if (subMatch) result.subtitle = subMatch[1];
                return Object.keys(result).length > 0 ? result : null;
            }
        } catch (e) { return null; }
    }
    
    function parseFileArray(rawFile) {
        if (!rawFile) return [];
        if (Array.isArray(rawFile)) return rawFile;
        if (typeof rawFile === "string") {
            const value = rawFile.trim();
            if (value.startsWith("[") && value.endsWith("]")) {
                try { return JSON.parse(value); } catch (e) { return []; }
            }
            if (value.startsWith("{") && value.endsWith("}")) {
                try { return [JSON.parse(value)]; } catch (e) { return []; }
            }
            if (value) return [{ file: value }];
        }
        return [];
    }
    
    // --- Video URL Extraction ---
    
    function extractVideoUrls(fileValue) {
        const urls = [];
        if (!fileValue || typeof fileValue !== "string") return urls;
        
        const parts = fileValue.split(",");
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            if (/\.(m3u8|mp4|mkv|avi|webm)(\?.*)?$/i.test(trimmed) || trimmed.includes(".urlset/")) {
                urls.push(trimmed);
            }
        }
        return urls;
    }
    
    // --- Stream Builders ---
    
    function buildEpisodeStreams(fileArray, seasonNum, episodeNum, globalSubtitle) {
        const results = [];
        
        for (const seasonObj of fileArray) {
            if (!seasonObj || typeof seasonObj !== "object") continue;
            
            const seasonTitle = String(seasonObj.title || "");
            const seasonMatch = seasonTitle.match(/Season\s*(\d+)/i);
            if (!seasonMatch) continue;
            
            const sNum = parseInt(seasonMatch[1], 10);
            if (sNum !== seasonNum) continue;
            
            const episodes = seasonObj.folder;
            if (!Array.isArray(episodes)) continue;
            
            for (const epObj of episodes) {
                if (!epObj || typeof epObj !== "object") continue;
                
                const epTitle = String(epObj.title || "");
                const epMatch = epTitle.match(/Episode\s*(\d+)/i);
                if (!epMatch) continue;
                
                const eNum = parseInt(epMatch[1], 10);
                if (eNum !== episodeNum) continue;
                
                // Collect video URLs from episode file and nested sources
                const videoUrls = [];
                videoUrls.push(...extractVideoUrls(epObj.file));
                
                if (Array.isArray(epObj.folder)) {
                    for (const src of epObj.folder) {
                        if (src && src.file) {
                            videoUrls.push(...extractVideoUrls(src.file));
                        }
                    }
                }
                
                if (videoUrls.length === 0) continue;
                
                // Subtitles: episode-specific first, then global fallback
                const epSubs = parseSubtitles(epObj.subtitle);
                const subs = epSubs.length > 0 ? epSubs : parseSubtitles(globalSubtitle);
                
                for (const vUrl of videoUrls) {
                    const quality = extractQuality(vUrl);
                    results.push(new StreamResult({
                        url: vUrl,
                        quality: quality || "Auto",
                        source: quality ? `Cinemacity - ${quality}` : "Cinemacity",
                        headers: { Referer: BASE_URL + "/" },
                        subtitles: subs
                    }));
                }
                
                return results; // Matching episode found
            }
        }
        return results;
    }
    
    function buildMovieStreams(fileArray, subtitleString) {
        const results = [];
        const subs = parseSubtitles(subtitleString);
        const videoUrls = [];
        
        if (Array.isArray(fileArray)) {
            for (const obj of fileArray) {
                if (obj && obj.file) {
                    videoUrls.push(...extractVideoUrls(obj.file));
                }
                if (obj && obj.subtitle && !subtitleString) {
                    const objSubs = parseSubtitles(obj.subtitle);
                    if (objSubs.length > 0) {
                        subs.push(...objSubs);
                    }
                }
            }
        }
        
        for (const vUrl of videoUrls) {
            const quality = extractQuality(vUrl);
            results.push(new StreamResult({
                url: vUrl,
                quality: quality || "Auto",
                source: quality ? `Cinemacity - ${quality}` : "Cinemacity",
                headers: { Referer: BASE_URL + "/" },
                subtitles: subs
            }));
        }
        return results;
    }
    
    // --- Internal Stream URL Encoding ---
    
    function encodeStreams(streams) {
        const simplified = streams.map(function(s) {
            return {
                u: s.url || "",
                q: s.quality || "Auto",
                src: s.source || "Cinemacity",
                h: s.headers || null,
                sub: s.subtitles || null
            };
        });
        return toBase64(JSON.stringify(simplified));
    }
    
    function buildEmbeddedStreamUrl(encodedStreams, seasonNum, episodeNum, isMovie) {
        const payload = {
            s: seasonNum,
            e: episodeNum,
            m: isMovie ? 1 : 0,
            d: encodedStreams
        };
        return "cinemastream://" + toBase64(JSON.stringify(payload));
    }
    
    function decodeStreamUrl(streamUrl) {
        if (!streamUrl || typeof streamUrl !== "string") return null;
        const trimmed = streamUrl.trim();
        if (!trimmed.startsWith("cinemastream://")) return null;
        
        try {
            const encoded = trimmed.replace("cinemastream://", "");
            const payload = JSON.parse(fromBase64(encoded));
            const streamData = JSON.parse(fromBase64(payload.d));
            
            const streams = streamData.map(function(s) {
                return new StreamResult({
                    url: s.u,
                    quality: s.q || "Auto",
                    source: s.src || "Cinemacity",
                    headers: s.h || null,
                    subtitles: s.sub || null
                });
            });
            
            return { streams, payload };
        } catch (e) {
            return null;
        }
    }
    
    // --- Fallback Page Extraction ---
    
    async function extractStreamsFromPage(pageUrl, seasonNum, episodeNum, isMovie) {
        const res = await fetchPage(pageUrl);
        if (!res) return [];
        
        const doc = await parseHtml(res.body);
        if (!doc) return [];
        
        const playerScript = extractPlayerScript(doc);
        if (!playerScript) return [];
        
        const playerJson = parsePlayerData(playerScript);
        if (!playerJson) return [];
        
        const fileArray = parseFileArray(playerJson.file);
        
        if (isMovie) {
            return buildMovieStreams(fileArray, playerJson.subtitle);
        } else {
            return buildEpisodeStreams(fileArray, seasonNum, episodeNum, playerJson.subtitle);
        }
    }
    
    // --- Card Parser ---
    
    function parseItemFromCard(card) {
        const titleAnchor = queryOne(card, "a.e-nowrap");
        const titleHref = titleAnchor ? getAttr(titleAnchor, "href") : "";
        if (!titleHref) return null;
        
        const title = textOf(titleAnchor).split("(")[0].trim();
        const bgDiv = queryOne(card, "div.dar-short_bg.e-cover a");
        const posterUrl = bgDiv ? getAttr(bgDiv, "href") : "";
        
        let quality = "HD";
        const qualityDiv = queryOne(card, "div.dar-short_bg.e-cover > div");
        if (qualityDiv) {
            const q = textOf(qualityDiv);
            if (q.toLowerCase().includes("ts")) quality = "TS";
        }
        
        const type = titleHref.includes("/tv-series/") ? "series" : "movie";
        
        return new MultimediaItem({
            title: title,
            url: titleHref.startsWith("http") ? titleHref : BASE_URL + titleHref,
            posterUrl: posterUrl.startsWith("http") ? posterUrl : BASE_URL + posterUrl,
            type: type,
            quality: quality
        });
    }
    
    // ==================== CORE FUNCTIONS ====================
    
    async function getHome(cb) {
        try {
            const categories = {};
            
            for (const section of HOME_SECTIONS) {
                const url = BASE_URL + section.path;
                const res = await fetchPage(url);
                if (!res) continue;
                
                const doc = await parseHtml(res.body);
                const cards = queryAll(doc, "div.dar-short_item");
                const items = [];
                
                for (const card of cards) {
                    const item = parseItemFromCard(card);
                    if (item) items.push(item);
                    if (items.length >= 30) break;
                }
                
                if (items.length > 0) categories[section.name] = items;
            }
            
            cb({ success: true, data: categories });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }
    
    async function search(query, cb) {
        try {
            const encoded = encodeURIComponent(query);
            const url = BASE_URL + "/index.php?do=search&subaction=search&search_start=1&full_search=0&story=" + encoded;
            const res = await fetchPage(url);
            if (!res) return cb({ success: true, data: [] });
            
            const doc = await parseHtml(res.body);
            const cards = queryAll(doc, "div.dar-short_item");
            const results = [];
            
            for (const card of cards) {
                const item = parseItemFromCard(card);
                if (item) results.push(item);
                if (results.length >= 50) break;
            }
            
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }
    
    async function load(url, cb) {
        try {
            const res = await fetchPage(url);
            if (!res) {
                return cb({ success: false, errorCode: "LOAD_ERROR", message: "Failed to load page" });
            }
            
            const doc = await parseHtml(res.body);
            
            const ogTitle = getAttr(queryOne(doc, 'meta[property="og:title"]'), "content");
            const title = cleanTitle(ogTitle || textOf(queryOne(doc, "h1")) || "Unknown");
            const poster = getAttr(queryOne(doc, 'meta[property="og:image"]'), "content");
            const description = textOf(queryOne(doc, "#about .ta-full_text1")) || "";
            const year = String(ogTitle || "").match(/\((\d{4})\)/) 
                ? parseInt(ogTitle.match(/\((\d{4})\)/)[1], 10) 
                : null;
            
            // Audio languages
            const liElements = queryAll(doc, "#main li");
            let audioLanguages = null;
            for (const li of liElements) {
                const spans = queryAll(li, "span");
                if (spans.length >= 2) {
                    const label = textOf(spans[0]).toLowerCase();
                    if (label.includes("audio language")) {
                        const langSpans = queryAll(li, "span a");
                        audioLanguages = langSpans.map(s => textOf(s)).filter(Boolean).join(", ");
                        break;
                    }
                }
            }
            
            // IMDB ID extraction
            const ratingDivs = queryAll(doc, "div.ta-full_rating1 > div");
            let imdbId = null;
            for (const div of ratingDivs) {
                const onclick = getAttr(div, "onclick");
                const m = onclick ? String(onclick).match(/tt\d+/) : null;
                if (m) { imdbId = m[0]; break; }
            }
            
            const tvtype = url.includes("/tv-series/") ? "series" : "movie";
            const tmdbMetaType = tvtype === "series" ? "tv" : "movie";
            
            // TMDB lookup
            let tmdbId = null;
            if (imdbId) {
                try {
                    const tmdbRes = await http_get(
                        "https://api.themoviedb.org/3/find/" + imdbId + 
                        "?api_key=" + TMDB_API_KEY + "&external_source=imdb_id",
                        { headers: HEADERS }
                    );
                    if (tmdbRes && tmdbRes.body) {
                        const tmdbData = JSON.parse(tmdbRes.body);
                        const results = tmdbData.movie_results || tmdbData.tv_results || [];
                        if (results.length > 0) tmdbId = String(results[0].id);
                    }
                } catch (e) {}
            }
            
            // Cinemeta lookup
            let metaJson = null;
            if (tmdbId) {
                const metaUrl = CINEMETA_URL + "/" + tmdbMetaType + "/" + tmdbId + ".json";
                try {
                    const mr = await http_get(metaUrl, { headers: HEADERS });
                    if (mr && mr.body && mr.body.trim().startsWith("{")) {
                        metaJson = JSON.parse(mr.body);
                    }
                } catch (e) {}
            }
            
            const metaName = metaJson && metaJson.meta && metaJson.meta.name;
            const metaDesc = metaJson && metaJson.meta && metaJson.meta.description;
            const metaBg = metaJson && metaJson.meta && metaJson.meta.background;
            const metaYear = metaJson && metaJson.meta && metaJson.meta.year 
                ? parseInt(metaJson.meta.year, 10) 
                : null;
            const metaScore = metaJson && metaJson.meta && metaJson.meta.imdbRating 
                ? parseFloat(metaJson.meta.imdbRating) 
                : null;
            
            const metaVideos = (metaJson && metaJson.meta && metaJson.meta.videos) || [];
            const epMetaMap = {};
            for (const v of metaVideos) {
                if (v.season != null && v.episode != null) {
                    epMetaMap[String(v.season) + ":" + String(v.episode)] = v;
                }
            }
            
            // Extract PlayerJS config
            const playerScript = extractPlayerScript(doc);
            let playerJson = null;
            let fileArray = [];
            
            if (playerScript) {
                playerJson = parsePlayerData(playerScript);
                if (playerJson) {
                    fileArray = parseFileArray(playerJson.file);
                }
            }
            
            // Build description/plot
            const plotParts = [];
            if (metaDesc) plotParts.push(metaDesc);
            if (description) plotParts.push(description);
            if (audioLanguages) plotParts.push("Audio: " + audioLanguages);
            const plot = plotParts.join(" - ");
            
            if (tvtype === "series") {
                const episodes = [];
                
                for (const seasonObj of fileArray) {
                    if (!seasonObj || typeof seasonObj !== "object") continue;
                    
                    const seasonTitle = String(seasonObj.title || "");
                    const seasonMatch = seasonTitle.match(/Season\s*(\d+)/i);
                    if (!seasonMatch) continue;
                    
                    const seasonNum = parseInt(seasonMatch[1], 10);
                    const folders = seasonObj.folder;
                    if (!Array.isArray(folders)) continue;
                    
                    for (const epObj of folders) {
                        if (!epObj || typeof epObj !== "object") continue;
                        
                        const epTitle = String(epObj.title || "");
                        const epMatch = epTitle.match(/Episode\s*(\d+)/i);
                        if (!epMatch) continue;
                        
                        const epNum = parseInt(epMatch[1], 10);
                        const metaKey = seasonNum + ":" + epNum;
                        const epMeta = epMetaMap[metaKey];
                        
                        // Build streams and encode into custom URL
                        const epStreams = buildEpisodeStreams(
                            fileArray, seasonNum, epNum, 
                            playerJson ? playerJson.subtitle : null
                        );
                        const encodedStreams = encodeStreams(epStreams);
                        const streamUrl = buildEmbeddedStreamUrl(encodedStreams, seasonNum, epNum, false);
                        
                        episodes.push(new Episode({
                            name: epMeta && epMeta.name ? epMeta.name : "S" + seasonNum + "E" + epNum,
                            url: streamUrl,
                            season: seasonNum,
                            episode: epNum,
                            description: epMeta && epMeta.overview ? epMeta.overview : null,
                            posterUrl: epMeta && epMeta.thumbnail 
                                ? epMeta.thumbnail 
                                : (metaJson && metaJson.meta && metaJson.meta.poster) 
                                    ? metaJson.meta.poster 
                                    : poster,
                            airDate: epMeta && epMeta.released ? epMeta.released : null
                        }));
                    }
                }
                
                // Fallback for empty episode list
                if (episodes.length === 0) {
                    const fallbackStreams = buildEpisodeStreams(fileArray, 1, 1, playerJson ? playerJson.subtitle : null);
                    const encodedStreams = encodeStreams(fallbackStreams);
                    const streamUrl = buildEmbeddedStreamUrl(encodedStreams, 1, 1, false);
                    
                    episodes.push(new Episode({
                        name: "Episode 1",
                        url: streamUrl,
                        season: 1,
                        episode: 1
                    }));
                }
                
                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: metaName || title,
                        url: url,
                        posterUrl: poster || metaBg || "",
                        description: plot || "",
                        year: year || metaYear || null,
                        score: metaScore || null,
                        type: "series",
                        episodes: episodes
                    })
                });
            } else {
                // Movie handling
                const movieStreams = buildMovieStreams(fileArray, playerJson ? playerJson.subtitle : null);
                const encodedStreams = encodeStreams(movieStreams);
                const streamUrl = buildEmbeddedStreamUrl(encodedStreams, 1, 1, true);
                
                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: metaName || title,
                        url: url,
                        posterUrl: poster || metaBg || "",
                        description: plot || "",
                        year: year || metaYear || null,
                        score: metaScore || null,
                        type: "movie",
                        episodes: [
                            new Episode({
                                name: "Full Movie",
                                url: streamUrl,
                                season: 1,
                                episode: 1,
                                posterUrl: poster || ""
                            })
                        ]
                    })
                });
            }
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }
    
    async function loadStreams(url, cb) {
        try {
            const trimmed = String(url || "").trim();
            
            // Primary: pre-encoded streams from load()
            if (trimmed.startsWith("cinemastream://")) {
                const decoded = decodeStreamUrl(trimmed);
                if (decoded && decoded.streams && decoded.streams.length > 0) {
                    return cb({ success: true, data: decoded.streams });
                }
                return cb({ success: true, data: [] });
            }
            
            // Legacy protocol support
            if (trimmed.startsWith("cinemacity://")) {
                const afterProtocol = trimmed.replace("cinemacity://", "");
                const hashIdx = afterProtocol.indexOf("#");
                const b64Part = hashIdx >= 0 ? afterProtocol.substring(0, hashIdx) : afterProtocol;
                const hashPart = hashIdx >= 0 ? afterProtocol.substring(hashIdx + 1) : "";
                
                let decodedUrl;
                try {
                    decodedUrl = fromBase64(b64Part);
                } catch (e) {
                    return cb({ success: true, data: [] });
                }
                
                let seasonNum = 1, episodeNum = 1, isMovie = false;
                if (hashPart.includes("s=") && hashPart.includes("e=")) {
                    const sMatch = hashPart.match(/[?&]s=(\d+)/);
                    const eMatch = hashPart.match(/[?&]e=(\d+)/);
                    seasonNum = sMatch ? parseInt(sMatch[1], 10) : 1;
                    episodeNum = eMatch ? parseInt(eMatch[1], 10) : 1;
                } else if (hashPart === "movie") {
                    isMovie = true;
                } else {
                    return cb({ success: true, data: [] });
                }
                
                const results = await extractStreamsFromPage(decodedUrl, seasonNum, episodeNum, isMovie);
                return cb({ success: true, data: results });
            }
            
            // Direct HTTP URL fallback (re-extract from page)
            if (trimmed.startsWith("http")) {
                const isMovie = !trimmed.includes("/tv-series/");
                let seasonNum = 1, episodeNum = 1;
                
                try {
                    const urlObj = new URL(trimmed);
                    const sParam = urlObj.searchParams.get("s");
                    const eParam = urlObj.searchParams.get("e");
                    seasonNum = sParam ? parseInt(sParam, 10) : 1;
                    episodeNum = eParam ? parseInt(eParam, 10) : 1;
                } catch (e) {
                    const sMatch = trimmed.match(/[?&]s=(\d+)/);
                    const eMatch = trimmed.match(/[?&]e=(\d+)/);
                    seasonNum = sMatch ? parseInt(sMatch[1], 10) : 1;
                    episodeNum = eMatch ? parseInt(eMatch[1], 10) : 1;
                }
                
                const results = await extractStreamsFromPage(trimmed, seasonNum, episodeNum, isMovie);
                return cb({ success: true, data: results });
            }
            
            cb({ success: true, data: [] });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }
    
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
    
})();
