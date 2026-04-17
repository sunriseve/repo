(function() {

    const BASE_URL = manifest && manifest.baseUrl ? manifest.baseUrl : "https://cinemacity.cc";
    
    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": "dle_user_id=32729; dle_password=894171c6a8dab18ee594d5c652009a35;"
    };
    
    const PLAYBACK_HEADERS = {
        "Referer": BASE_URL + "/",
        "Cookie": "dle_user_id=32729; dle_password=894171c6a8dab18ee594d5c652009a35;",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
    };

    const HOME_SECTIONS = [
        { name: "Movies", path: "/movies" },
        { name: "TV Series", path: "/tv-series" },
        { name: "Anime", path: "/xfsearch/genre/anime" },
        { name: "Asian", path: "/xfsearch/genre/asian" },
        { name: "Animation", path: "/xfsearch/genre/animation" },
        { name: "Documentary", path: "/xfsearch/genre/documentary" }
    ];

    // --- DOM Helpers ---
    function textOf(el) { return el ? (el.textContent || el.innerText || "").trim() : ""; }
    function getAttr(el, attr) { return el && el.getAttribute ? (el.getAttribute(attr) || "") : ""; }
    function queryOne(doc, selector) { return doc.querySelector ? doc.querySelector(selector) : null; }
    function queryAll(doc, selector) { return doc.querySelectorAll ? Array.from(doc.querySelectorAll(selector)) : []; }

    // --- Quality Extraction ---
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

    async function fetchPage(url) {
        try {
            const res = await http_get(url, { headers: HEADERS });
            if (res && res.body) return res;
        } catch (e) {}
        return null;
    }

    // --- Subtitle Parsing ---
    function parseSubtitles(raw) {
        const tracks = [];
        if (!raw || typeof raw !== "string") return tracks;
        raw.split(",").forEach(function(entry) {
            const trimmed = entry.trim();
            if (!trimmed) return;
            const match = trimmed.match(/^\[([^\]]+)\](https?:\/\/.+\.vtt[^,\s]*)$/);
            if (match) {
                tracks.push({ language: match[1], subtitleUrl: match[2] });
            }
        });
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
                    if (decoded.includes("new Playerjs(")) return decoded;
                    
                    // Nested atob
                    if (decoded.includes("atob(")) {
                        const nested = decoded.match(/atob\s*\(\s*["']([^"']+)["']\s*\)/g) || [];
                        for (const n of nested) {
                            const nm = n.match(/atob\s*\(\s*["']([^"']+)["']\s*\)/);
                            if (nm && atob(nm[1]).includes("new Playerjs(")) {
                                return atob(nm[1]);
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
            const end = afterStart.lastIndexOf(");");
            if (end === -1) return null;
            
            let jsonStr = afterStart.substring(0, end).trim();
            if (jsonStr.startsWith("(") && jsonStr.endsWith(")")) {
                jsonStr = jsonStr.slice(1, -1);
            }
            
            try {
                return JSON.parse(jsonStr);
            } catch (e) {
                // Try fixing single quotes
                return JSON.parse(jsonStr.replace(/'/g, '"'));
            }
        } catch (e) { return null; }
    }

    function parseFileArray(rawFile) {
        if (!rawFile) return [];
        if (Array.isArray(rawFile)) return rawFile;
        if (typeof rawFile === "string") {
            const v = rawFile.trim();
            if (v.startsWith("[") && v.endsWith("]")) {
                try { return JSON.parse(v); } catch (e) { return []; }
            }
            if (v.startsWith("{") && v.endsWith("}")) {
                try { return [JSON.parse(v)]; } catch (e) { return []; }
            }
            if (v) return [{ file: v }];
        }
        return [];
    }

    // Extract direct video URLs from a file string
    function extractVideoUrls(fileValue) {
        const urls = [];
        if (!fileValue || typeof fileValue !== "string") return urls;
        fileValue.split(",").forEach(function(part) {
            const t = part.trim();
            if (!t) return;
            if (/\.(m3u8|mp4|mkv|avi|webm)(\?.*)?$/i.test(t) || t.includes(".urlset/")) {
                urls.push(t);
            }
        });
        return urls;
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
            // Fetch all sections in PARALLEL for speed
            const sectionPromises = HOME_SECTIONS.map(function(section) {
                return new Promise(async function(resolve) {
                    const url = BASE_URL + section.path;
                    const res = await fetchPage(url);
                    if (!res) return resolve([section.name, []]);
                    
                    try {
                        const doc = await parseHtml(res.body);
                        const cards = queryAll(doc, "div.dar-short_item");
                        const items = [];
                        for (let i = 0; i < cards.length && items.length < 20; i++) {
                            const item = parseItemFromCard(cards[i]);
                            if (item) items.push(item);
                        }
                        resolve([section.name, items]);
                    } catch (e) {
                        resolve([section.name, []]);
                    }
                });
            });
            
            const results = await Promise.all(sectionPromises);
            const categories = {};
            results.forEach(function(result) {
                if (result[1].length > 0) categories[result[0]] = result[1];
            });
            
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
            for (let i = 0; i < cards.length && results.length < 30; i++) {
                const item = parseItemFromCard(cards[i]);
                if (item) results.push(item);
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
            
            // Basic metadata from page ONLY - no external APIs for speed
            const ogTitle = getAttr(queryOne(doc, 'meta[property="og:title"]'), "content");
            const title = cleanTitle(ogTitle || textOf(queryOne(doc, "h1")) || "Unknown");
            const poster = getAttr(queryOne(doc, 'meta[property="og:image"]'), "content");
            const description = textOf(queryOne(doc, "#about .ta-full_text1")) || "";
            const year = String(ogTitle || "").match(/\((\d{4})\)/) 
                ? parseInt(ogTitle.match(/\((\d{4})\)/)[1], 10) 
                : null;
            
            const tvtype = url.includes("/tv-series/") ? "series" : "movie";
            
            // Extract PlayerJS from the page
            const playerScript = extractPlayerScript(doc);
            let playerJson = null;
            let fileArray = [];
            
            if (playerScript) {
                playerJson = parsePlayerData(playerScript);
                if (playerJson) {
                    fileArray = parseFileArray(playerJson.file);
                }
            }
            
            const globalSubtitle = playerJson ? playerJson.subtitle : null;
            
            if (tvtype === "series") {
                const episodes = [];
                
                for (let i = 0; i < fileArray.length; i++) {
                    const seasonObj = fileArray[i];
                    if (!seasonObj || typeof seasonObj !== "object") continue;
                    
                    const seasonTitle = String(seasonObj.title || "");
                    const seasonMatch = seasonTitle.match(/Season\s*(\d+)/i);
                    if (!seasonMatch) continue;
                    
                    const seasonNum = parseInt(seasonMatch[1], 10);
                    const folders = seasonObj.folder;
                    if (!Array.isArray(folders)) continue;
                    
                    for (let j = 0; j < folders.length; j++) {
                        const epObj = folders[j];
                        if (!epObj || typeof epObj !== "object") continue;
                        
                        const epTitle = String(epObj.title || "");
                        const epMatch = epTitle.match(/Episode\s*(\d+)/i);
                        if (!epMatch) continue;
                        
                        const epNum = parseInt(epMatch[1], 10);
                        
                        // Collect video URLs
                        const streamUrls = [];
                        streamUrls.push(...extractVideoUrls(epObj.file));
                        
                        if (Array.isArray(epObj.folder)) {
                            for (let k = 0; k < epObj.folder.length; k++) {
                                const src = epObj.folder[k];
                                if (src && src.file) {
                                    streamUrls.push(...extractVideoUrls(src.file));
                                }
                            }
                        }
                        
                        if (streamUrls.length === 0) continue;
                        
                        // Subtitles: episode-specific first, then global fallback
                        const epSubs = parseSubtitles(epObj.subtitle);
                        const subtitleTracks = epSubs.length > 0 ? epSubs : parseSubtitles(globalSubtitle);
                        
                        // Store extracted streams as JSON in episode URL
                        // This matches the Bollyflix/HDHub4u reference pattern
                        const epData = JSON.stringify({
                            streams: streamUrls,
                            subtitleTracks: subtitleTracks
                        });
                        
                        episodes.push(new Episode({
                            name: "S" + seasonNum + "E" + epNum,
                            url: epData,
                            season: seasonNum,
                            episode: epNum
                        }));
                    }
                }
                
                if (episodes.length === 0) {
                    // Fallback: single episode
                    episodes.push(new Episode({
                        name: "Episode 1",
                        url: JSON.stringify({ streams: [], subtitleTracks: [] }),
                        season: 1,
                        episode: 1
                    }));
                }
                
                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: title,
                        url: url,
                        posterUrl: poster || "",
                        description: description,
                        year: year,
                        type: "series",
                        episodes: episodes
                    })
                });
            } else {
                // Movie: extract all video URLs from file array
                const movieUrls = [];
                for (let i = 0; i < fileArray.length; i++) {
                    const obj = fileArray[i];
                    if (obj && obj.file) {
                        movieUrls.push(...extractVideoUrls(obj.file));
                    }
                }
                
                // Also try direct file from playerJson
                if (movieUrls.length === 0 && playerJson && playerJson.file) {
                    movieUrls.push(...extractVideoUrls(playerJson.file));
                }
                
                const subtitleTracks = parseSubtitles(globalSubtitle);
                
                // Store as JSON - matches Kotlin extension structure
                const movieData = JSON.stringify({
                    streamUrl: movieUrls.join(","),
                    subtitleTracks: subtitleTracks
                });
                
                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: title,
                        url: url,
                        posterUrl: poster || "",
                        description: description,
                        year: year,
                        type: "movie",
                        episodes: [
                            new Episode({
                                name: "Full Movie",
                                url: movieData,
                                season: 1,
                                episode: 1
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
            
            // Parse the JSON data stored in episode URL by load()
            let data;
            try {
                data = JSON.parse(trimmed);
            } catch (e) {
                return cb({ success: true, data: [] });
            }
            
            const videoUrls = [];
            
            // Series format: { streams: ["url1", "url2"], subtitleTracks: [...] }
            if (data.streams && Array.isArray(data.streams)) {
                videoUrls.push(...data.streams);
            }
            // Movie format: { streamUrl: "url1,url2", subtitleTracks: [...] }
            else if (data.streamUrl && typeof data.streamUrl === "string") {
                const parts = data.streamUrl.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
                for (let i = 0; i < parts.length; i++) {
                    const p = parts[i];
                    if (/\.(m3u8|mp4|mkv|avi|webm)(\?.*)?$/i.test(p) || p.includes(".urlset/")) {
                        videoUrls.push(p);
                    }
                }
            }
            
            if (videoUrls.length === 0) {
                return cb({ success: true, data: [] });
            }
            
            // Build subtitle array for StreamResult
            const subs = [];
            const rawSubs = data.subtitleTracks || [];
            for (let i = 0; i < rawSubs.length; i++) {
                const s = rawSubs[i];
                if (s && s.subtitleUrl) {
                    subs.push({
                        url: s.subtitleUrl,
                        label: s.language || "Sub",
                        lang: s.language || "en"
                    });
                }
            }
            
            // Build StreamResult array with DIRECT DDL URLs
            const results = [];
            for (let i = 0; i < videoUrls.length; i++) {
                const vUrl = videoUrls[i];
                const quality = extractQuality(vUrl);
                
                results.push(new StreamResult({
                    url: vUrl,
                    quality: quality || "Auto",
                    source: quality ? "Cinemacity " + quality : "Cinemacity",
                    headers: PLAYBACK_HEADERS,
                    subtitles: subs
                }));
            }
            
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
