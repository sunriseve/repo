(function() {

    const BASE_URL = manifest && manifest.baseUrl ? manifest.baseUrl : "https://cinemacity.cc";
    
    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": "dle_user_id=32729; dle_password=894171c6a8dab18ee594d5c652009a35;"
    };

    // Debug logging helper
    function debug(msg, data) {
        console.log("[Cinemacity] " + msg, data || "");
    }

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
            debug("Fetching: " + url);
            const res = await http_get(url, { headers: HEADERS });
            if (res && res.body) {
                debug("Fetch success, body length: " + res.body.length);
                return res;
            }
        } catch (e) {
            debug("Fetch error: " + e.message);
        }
        return null;
    }

    // --- Subtitle Parsing ---
    function parseSubtitles(raw) {
        const tracks = [];
        if (!raw || typeof raw !== "string") return tracks;
        
        raw.split(",").forEach(function(entry) {
            const trimmed = entry.trim();
            if (!trimmed) return;
            // Match [Language]https://...vtt
            const match = trimmed.match(/^\[([^\]]+)\](https?:\/\/.+\.vtt[^,\s]*)$/);
            if (match) {
                tracks.push({ language: match[1], subtitleUrl: match[2] });
                debug("Found subtitle: " + match[1]);
            }
        });
        return tracks;
    }

    // --- PlayerJS Extraction (Fixed to match Kotlin exactly) ---
    function extractPlayerScript(doc) {
        // Get ALL scripts containing "atob"
        const allScripts = queryAll(doc, "script");
        const atobScripts = [];
        
        for (let i = 0; i < allScripts.length; i++) {
            const text = allScripts[i].textContent || "";
            if (text.includes("atob")) {
                atobScripts.push({ index: i, text: text, element: allScripts[i] });
            }
        }
        
        debug("Found " + atobScripts.length + " scripts with 'atob'");
        
        // Kotlin uses .getOrNull(1) - the SECOND script (index 1)
        if (atobScripts.length < 2) {
            debug("ERROR: Need at least 2 atob scripts, found " + atobScripts.length);
            return null;
        }
        
        const targetScript = atobScripts[1]; // Index 1 as per Kotlin
        debug("Using script index: " + targetScript.index);
        
        // Extract atob content - handle multiple atob calls
        const atobMatches = targetScript.text.match(/atob\s*\(\s*["']([^"']+)["']\s*\)/g);
        if (!atobMatches) {
            debug("ERROR: No atob patterns found in script");
            return null;
        }
        
        debug("Found " + atobMatches.length + " atob patterns");
        
        // Try each atob match
        for (let i = 0; i < atobMatches.length; i++) {
            const match = atobMatches[i].match(/atob\s*\(\s*["']([^"']+)["']\s*\)/);
            if (!match) continue;
            
            try {
                let decoded = atob(match[1]);
                debug("Decoded atob " + i + ", length: " + decoded.length);
                
                // Check if this contains PlayerJS
                if (decoded.includes("new Playerjs(")) {
                    debug("Found PlayerJS in decoded content");
                    return decoded;
                }
                
                // Check for nested atob (double-encoded)
                if (decoded.includes("atob(")) {
                    debug("Found nested atob, decoding...");
                    const nestedMatches = decoded.match(/atob\s*\(\s*["']([^"']+)["']\s*\)/g) || [];
                    for (let j = 0; j < nestedMatches.length; j++) {
                        const nestedMatch = nestedMatches[j].match(/atob\s*\(\s*["']([^"']+)["']\s*\)/);
                        if (nestedMatch) {
                            try {
                                const nestedDecoded = atob(nestedMatch[1]);
                                if (nestedDecoded.includes("new Playerjs(")) {
                                    debug("Found PlayerJS in nested decode");
                                    return nestedDecoded;
                                }
                            } catch (e) {}
                        }
                    }
                }
            } catch (e) {
                debug("Failed to decode atob " + i + ": " + e.message);
            }
        }
        
        return null;
    }

    function parsePlayerData(scriptContent) {
        if (!scriptContent) {
            debug("ERROR: No script content to parse");
            return null;
        }
        
        try {
            const start = scriptContent.indexOf("new Playerjs(");
            if (start === -1) {
                debug("ERROR: 'new Playerjs(' not found");
                return null;
            }
            
            const afterStart = scriptContent.substring(start + "new Playerjs(".length);
            // Find the matching closing ); - count braces
            let braceCount = 0;
            let end = -1;
            for (let i = 0; i < afterStart.length; i++) {
                if (afterStart[i] === '(' || afterStart[i] === '{' || afterStart[i] === '[') braceCount++;
                else if (afterStart[i] === ')' || afterStart[i] === '}' || afterStart[i] === ']') {
                    braceCount--;
                    if (braceCount < 0 && afterStart[i] === ')') {
                        // Check if this is the ); terminator
                        if (afterStart.substring(i, i+2) === ");") {
                            end = i;
                            break;
                        }
                    }
                }
            }
            
            if (end === -1) end = afterStart.lastIndexOf(");");
            if (end === -1) {
                debug("ERROR: Could not find closing );");
                return null;
            }
            
            let jsonStr = afterStart.substring(0, end).trim();
            debug("Extracted JSON string length: " + jsonStr.length);
            debug("JSON preview: " + jsonStr.substring(0, 100));
            
            try {
                return JSON.parse(jsonStr);
            } catch (e) {
                // Try fixing common JSON issues
                try {
                    // Replace single quotes with double quotes
                    const fixed = jsonStr.replace(/'/g, '"');
                    return JSON.parse(fixed);
                } catch (e2) {
                    debug("ERROR: JSON parse failed: " + e.message);
                    return null;
                }
            }
        } catch (e) {
            debug("ERROR: parsePlayerData exception: " + e.message);
            return null;
        }
    }

    function parseFileArray(rawFile) {
        if (!rawFile) {
            debug("WARNING: rawFile is null/undefined");
            return [];
        }
        if (Array.isArray(rawFile)) {
            debug("rawFile is already array, length: " + rawFile.length);
            return rawFile;
        }
        if (typeof rawFile === "string") {
            const value = rawFile.trim();
            debug("rawFile is string, length: " + value.length);
            
            if (value.startsWith("[") && value.endsWith("]")) {
                try { 
                    const parsed = JSON.parse(value);
                    debug("Parsed as JSON array, length: " + parsed.length);
                    return parsed; 
                } catch (e) { 
                    debug("ERROR: Failed to parse JSON array: " + e.message);
                    return []; 
                }
            }
            if (value.startsWith("{") && value.endsWith("}")) {
                try { 
                    const parsed = JSON.parse(value);
                    debug("Parsed as JSON object, wrapping in array");
                    return [parsed]; 
                } catch (e) { 
                    debug("ERROR: Failed to parse JSON object: " + e.message);
                    return []; 
                }
            }
            if (value) {
                debug("Wrapping plain string as file object");
                return [{ file: value }];
            }
        }
        debug("WARNING: Unsupported rawFile type: " + typeof rawFile);
        return [];
    }

    // Extract video URLs from a file string (handles comma-separated)
    function extractVideoUrls(fileValue) {
        const urls = [];
        if (!fileValue || typeof fileValue !== "string") return urls;
        
        const parts = fileValue.split(",");
        for (let i = 0; i < parts.length; i++) {
            const t = parts[i].trim();
            if (!t) continue;
            
            // Check if it's a subtitle track [lang]url.vtt - skip these
            if (t.match(/^\[[^\]]+\]\.vtt/i)) continue;
            
            // Check if it's a video URL
            if (/\.(m3u8|mp4|mkv|avi|webm)(\?.*)?$/i.test(t) || t.includes(".urlset/")) {
                urls.push(t);
                debug("Found video URL: " + t.substring(0, 50) + "...");
            }
        }
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
        debug("=== LOAD START ===");
        debug("URL: " + url);
        
        try {
            const res = await fetchPage(url);
            if (!res) {
                debug("ERROR: Failed to fetch page");
                return cb({ success: false, errorCode: "LOAD_ERROR", message: "Failed to load page" });
            }
            
            const doc = await parseHtml(res.body);
            debug("HTML parsed successfully");
            
            const ogTitle = getAttr(queryOne(doc, 'meta[property="og:title"]'), "content");
            const title = cleanTitle(ogTitle || textOf(queryOne(doc, "h1")) || "Unknown");
            const poster = getAttr(queryOne(doc, 'meta[property="og:image"]'), "content");
            const description = textOf(queryOne(doc, "#about .ta-full_text1")) || "";
            const year = String(ogTitle || "").match(/\((\d{4})\)/) 
                ? parseInt(ogTitle.match(/\((\d{4})\)/)[1], 10) 
                : null;
            
            const tvtype = url.includes("/tv-series/") ? "series" : "movie";
            debug("Type detected: " + tvtype);
            
            // Extract PlayerJS
            debug("Extracting PlayerJS...");
            const playerScript = extractPlayerScript(doc);
            
            let playerJson = null;
            let fileArray = [];
            let globalSubtitle = null;
            
            if (playerScript) {
                debug("PlayerJS script found, parsing...");
                playerJson = parsePlayerData(playerScript);
                
                if (playerJson) {
                    debug("PlayerJSON parsed successfully");
                    debug("PlayerJSON keys: " + Object.keys(playerJson).join(", "));
                    
                    fileArray = parseFileArray(playerJson.file);
                    globalSubtitle = playerJson.subtitle;
                    debug("Global subtitle: " + (globalSubtitle ? "present" : "none"));
                    debug("File array length: " + fileArray.length);
                } else {
                    debug("ERROR: Failed to parse PlayerJSON");
                }
            } else {
                debug("ERROR: No PlayerJS script found");
            }
            
            if (tvtype === "series") {
                debug("Processing as series...");
                const episodes = [];
                
                for (let i = 0; i < fileArray.length; i++) {
                    const seasonObj = fileArray[i];
                    if (!seasonObj || typeof seasonObj !== "object") {
                        debug("Skipping invalid seasonObj at index " + i);
                        continue;
                    }
                    
                    const seasonTitle = String(seasonObj.title || "");
                    const seasonMatch = seasonTitle.match(/Season\s*(\d+)/i);
                    if (!seasonMatch) {
                        debug("No season number found in: " + seasonTitle);
                        continue;
                    }
                    
                    const seasonNum = parseInt(seasonMatch[1], 10);
                    debug("Processing Season " + seasonNum);
                    
                    const folders = seasonObj.folder;
                    if (!Array.isArray(folders)) {
                        debug("ERROR: folders is not array for season " + seasonNum);
                        continue;
                    }
                    
                    debug("Found " + folders.length + " episodes in season " + seasonNum);
                    
                    for (let j = 0; j < folders.length; j++) {
                        const epObj = folders[j];
                        if (!epObj || typeof epObj !== "object") {
                            debug("Skipping invalid epObj at index " + j);
                            continue;
                        }
                        
                        const epTitle = String(epObj.title || "");
                        const epMatch = epTitle.match(/Episode\s*(\d+)/i);
                        if (!epMatch) {
                            debug("No episode number found in: " + epTitle);
                            continue;
                        }
                        
                        const epNum = parseInt(epMatch[1], 10);
                        
                        // Collect video URLs
                        const streamUrls = [];
                        
                        // Primary file
                        if (epObj.file) {
                            const urls = extractVideoUrls(epObj.file);
                            streamUrls.push(...urls);
                            debug("Episode " + epNum + " primary file: " + urls.length + " URLs");
                        }
                        
                        // Nested alternative sources (folder array inside episode)
                        if (Array.isArray(epObj.folder)) {
                            debug("Episode " + epNum + " has " + epObj.folder.length + " alternative sources");
                            for (let k = 0; k < epObj.folder.length; k++) {
                                const src = epObj.folder[k];
                                if (src && src.file) {
                                    const urls = extractVideoUrls(src.file);
                                    streamUrls.push(...urls);
                                    debug("  Alt source " + k + ": " + urls.length + " URLs");
                                }
                            }
                        }
                        
                        if (streamUrls.length === 0) {
                            debug("WARNING: No stream URLs found for S" + seasonNum + "E" + epNum);
                            continue;
                        }
                        
                        debug("Total URLs for S" + seasonNum + "E" + epNum + ": " + streamUrls.length);
                        
                        // Subtitles
                        const epSubs = parseSubtitles(epObj.subtitle);
                        const subtitleTracks = epSubs.length > 0 ? epSubs : parseSubtitles(globalSubtitle);
                        debug("Subtitle tracks: " + subtitleTracks.length);
                        
                        // Store as JSON
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
                        
                        debug("Added episode S" + seasonNum + "E" + epNum);
                    }
                }
                
                debug("Total episodes created: " + episodes.length);
                
                if (episodes.length === 0) {
                    debug("WARNING: No episodes found, adding fallback");
                    episodes.push(new Episode({
                        name: "Episode 1",
                        url: JSON.stringify({ streams: [], subtitleTracks: [] }),
                        season: 1,
                        episode: 1
                    }));
                }
                
                debug("=== LOAD SUCCESS (series) ===");
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
                debug("Processing as movie...");
                const movieUrls = [];
                
                // Extract from file array
                for (let i = 0; i < fileArray.length; i++) {
                    const obj = fileArray[i];
                    if (obj && obj.file) {
                        const urls = extractVideoUrls(obj.file);
                        movieUrls.push(...urls);
                        debug("File array item " + i + ": " + urls.length + " URLs");
                    }
                }
                
                // Direct file from playerJson
                if (movieUrls.length === 0 && playerJson && playerJson.file) {
                    const urls = extractVideoUrls(playerJson.file);
                    movieUrls.push(...urls);
                    debug("Direct playerJson.file: " + urls.length + " URLs");
                }
                
                debug("Total movie URLs: " + movieUrls.length);
                
                const subtitleTracks = parseSubtitles(globalSubtitle);
                
                const movieData = JSON.stringify({
                    streamUrl: movieUrls.join(","),
                    subtitleTracks: subtitleTracks
                });
                
                debug("=== LOAD SUCCESS (movie) ===");
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
            debug("ERROR in load: " + e.message);
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    async function loadStreams(url, cb) {
        debug("=== LOADSTREAMS START ===");
        debug("Input URL length: " + (url ? url.length : 0));
        
        try {
            const trimmed = String(url || "").trim();
            
            let data;
            try {
                data = JSON.parse(trimmed);
                debug("JSON parsed successfully");
                debug("Data keys: " + Object.keys(data).join(", "));
            } catch (e) {
                debug("ERROR: Failed to parse JSON: " + e.message);
                debug("Raw input: " + trimmed.substring(0, 100));
                return cb({ success: true, data: [] });
            }
            
            const videoUrls = [];
            
            // Series format: { streams: ["url1", "url2"] }
            if (data.streams && Array.isArray(data.streams)) {
                videoUrls.push(...data.streams);
                debug("Found streams array: " + data.streams.length + " items");
            }
            // Movie format: { streamUrl: "url1,url2" }
            else if (data.streamUrl && typeof data.streamUrl === "string") {
                const parts = data.streamUrl.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
                for (let i = 0; i < parts.length; i++) {
                    const p = parts[i];
                    if (/\.(m3u8|mp4|mkv|avi|webm)(\?.*)?$/i.test(p) || p.includes(".urlset/")) {
                        videoUrls.push(p);
                    }
                }
                debug("Parsed streamUrl string: " + videoUrls.length + " valid URLs");
            } else {
                debug("WARNING: No streams or streamUrl found in data");
            }
            
            if (videoUrls.length === 0) {
                debug("ERROR: No video URLs extracted");
                return cb({ success: true, data: [] });
            }
            
            // Build subtitles
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
            debug("Subtitles: " + subs.length);
            
            // Build StreamResults
            const results = [];
            for (let i = 0; i < videoUrls.length; i++) {
                const vUrl = videoUrls[i];
                const quality = extractQuality(vUrl);
                
                results.push(new StreamResult({
                    url: vUrl,
                    quality: quality || "Auto",
                    source: quality ? "Cinemacity " + quality : "Cinemacity",
                    headers: {
                        "Referer": BASE_URL + "/",
                        "Cookie": "dle_user_id=32729; dle_password=894171c6a8dab18ee594d5c652009a35;"
                    },
                    subtitles: subs
                }));
                
                debug("Created StreamResult " + (i+1) + ": " + (quality || "Auto"));
            }
            
            debug("=== LOADSTREAMS SUCCESS: " + results.length + " streams ===");
            cb({ success: true, data: results });
        } catch (e) {
            debug("ERROR in loadStreams: " + e.message);
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
