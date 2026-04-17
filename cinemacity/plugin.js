(function() {

    const BASE_URL = manifest && manifest.baseUrl ? manifest.baseUrl : "https://cinemacity.cc";
    const _streamCache = {};

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
        if (trimmed.startsWith("cinemastream://")) {
            try {
                const encoded = trimmed.replace("cinemastream://", "");
                const payload = JSON.parse(fromBase64(encoded));
                const streams = JSON.parse(fromBase64(payload.d));
                return { streams, payload };
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    function toBase64(str) {
        return btoa(unescape(encodeURIComponent(str)));
    }

    function fromBase64(str) {
        return decodeURIComponent(escape(atob(str)));
    }

    function encodeStreams(streams) {
        const simplified = streams.map(function(s) {
            return {
                u: s.url || "",
                q: s.quality || "Auto",
                src: s.source || "Cinemacity",
                h: s.headers || null
            };
        });
        return toBase64(JSON.stringify(simplified));
    }
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

    function textOf(el) {
        return (el ? (el.textContent || el.innerText || "").trim() : "");
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

    function extractQuality(url) {
        if (!url) return null;
        const u = url.toLowerCase();
        if (u.includes("2160p")) return "2160p";
        if (u.includes("1440p")) return "1440p";
        if (u.includes("1080p")) return "1080p";
        if (u.includes("720p")) return "720p";
        if (u.includes("480p")) return "480p";
        if (u.includes("360p")) return "360p";
        return null;
    }

    function decodeB64(str) {
        try { return fromBase64(str); } catch (e) { return null; }
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
        const res = await http_get(url, { headers: h });
        if (!res || !res.body) return null;
        return res;
    }

    function parseItemFromCard(card) {
        const titleAnchor = queryOne(card, "a.e-nowrap");
        const titleHref = titleAnchor ? getAttr(titleAnchor, "href") : "";
        if (!titleHref) return null;
        const title = textOf(titleAnchor).split("(")[0].trim();
        const bgDiv = queryOne(card, "div.dar-short_bg.e-cover a");
        const bgHref = bgDiv ? getAttr(bgDiv, "href") : "";
        const qualityDiv = queryOne(card, "div.dar-short_bg.e-cover > div");
        let quality = "HD";
        if (qualityDiv) {
            const q = textOf(qualityDiv);
            if (q.toLowerCase().includes("ts")) quality = "TS";
        }
        const type = titleHref.includes("/tv-series/") ? "series" : "movie";
        return new MultimediaItem({
            title,
            url: titleHref.startsWith("http") ? titleHref : BASE_URL + titleHref,
            posterUrl: bgHref.startsWith("http") ? bgHref : BASE_URL + bgHref,
            type,
            score: null,
            quality
        });
    }

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

    function extractPlayerScript(bodyHtml) {
        const allAtobMatches = bodyHtml.match(/atob\s*\([^)]+\)/g) || [];
        for (let i = 0; i < allAtobMatches.length; i++) {
            const call = allAtobMatches[i];
            const innerMatch = call.match(/atob\s*\(\s*(.+?)\s*\)\s*$/);
            if (!innerMatch || !innerMatch[1]) continue;
            const b64 = innerMatch[1].trim();
            const firstChar = b64[0];
            const lastIdx = b64.lastIndexOf(firstChar);
            if (lastIdx > 0) {
                const b64Content = b64.substring(1, lastIdx);
                const decoded = decodeB64(b64Content);
                if (decoded && decoded.includes("new Playerjs(")) {
                    return decoded;
                }
                if (decoded && decoded.includes("atob(")) {
                    const nestedMatches = decoded.match(/atob\s*\([^)]+\)/g) || [];
                    for (let j = 0; j < nestedMatches.length; j++) {
                        const nestedCall = nestedMatches[j];
                        const nestedMatch = nestedCall.match(/atob\s*\(\s*(.+?)\s*\)\s*$/);
                        if (!nestedMatch || !nestedMatch[1]) continue;
                        const nestedB64 = nestedMatch[1].trim();
                        const nFirstChar = nestedB64[0];
                        const nLastIdx = nestedB64.lastIndexOf(nFirstChar);
                        if (nLastIdx > 0) {
                            const nestedContent = nestedB64.substring(1, nLastIdx);
                            const nestedDecoded = decodeB64(nestedContent);
                            if (nestedDecoded && nestedDecoded.includes("new Playerjs(")) {
                                return nestedDecoded;
                            }
                        }
                    }
                }
            }
        }
        return null;
    }

    function parsePlayerData(scriptContent) {
        if (!scriptContent) return null;
        try {
            const start = scriptContent.indexOf("new Playerjs(");
            if (start === -1) return null;
            const end = scriptContent.indexOf(");", start);
            if (end === -1) return null;
            const inner = scriptContent.substring(start + "new Playerjs(".length, end);
            if (!inner.trim().startsWith("{")) return null;
            try { return JSON.parse(inner.trim()); }
            catch (e) {
                const result = {};
                const findStringValue = (text, key) => {
                    const keyIdx = text.indexOf(key);
                    if (keyIdx < 0) return null;
                    const afterKey = text.substring(keyIdx + key.length).trimStart();
                    if (!afterKey) return null;
                    const quote = afterKey[0];
                    if (quote !== "'" && quote !== '"') return null;
                    const endQuote = quote;
                    let i = 1;
                    while (i < afterKey.length) {
                        if (afterKey[i] === "\\") { i += 2; continue; }
                        if (afterKey[i] === endQuote) {
                            return afterKey.substring(1, i);
                        }
                        i++;
                    }
                    return null;
                };
                const extractQuotedValue = (text, key) => {
                    const keyIdx = text.indexOf(key);
                    if (keyIdx < 0) return null;
                    const afterKey = text.substring(keyIdx + key.length).trimStart();
                    if (!afterKey) return null;
                    const firstChar = afterKey[0];
                    if (firstChar !== '"' && firstChar !== "'") return null;
                    const stack = [firstChar];
                    for (let i = 1; i < afterKey.length; i++) {
                        const c = afterKey[i];
                        const prev = afterKey[i - 1];
                        if ((c === '"' || c === "'") && prev !== "\\") {
                            if (stack[stack.length - 1] === c) {
                                stack.pop();
                                if (stack.length === 0) {
                                    return afterKey.substring(1, i);
                                }
                            } else {
                                stack.push(c);
                            }
                        }
                    }
                    return null;
                };
                result.file = extractQuotedValue(inner, "file:");
                const rawSub = extractQuotedValue(inner, "subtitle:");
                if (rawSub) {
                    try { result.subtitle = JSON.parse('"' + rawSub + '"'); }
                    catch (e) { result.subtitle = rawSub; }
                }
                return Object.keys(result).length > 0 ? result : null;
            }
        } catch (e) { return null; }
    }

    function parseFileArray(rawFile) {
        if (!rawFile) return [];
        if (Array.isArray(rawFile)) return rawFile;
        if (typeof rawFile === "string") {
            const trimmed = rawFile.trim();
            if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
                try {
                    const arr = JSON.parse(trimmed);
                    const result = [];
                    for (const item of arr) {
                        if (typeof item === "object" && item !== null && item.file) {
                            const fileVal = item.file;
                            if (typeof fileVal === "string" && fileVal.includes(",")) {
                                const pubIdx = fileVal.indexOf("/public_files/");
                                const baseMatch = pubIdx >= 0
                                    ? fileVal.substring(0, pubIdx + "/public_files/".length)
                                    : "";
                                const afterBase = baseMatch ? fileVal.substring(baseMatch.length) : fileVal;
                                const parts = afterBase.split(",");
                                for (const p of parts) {
                                    const pt = p.trim();
                                    if (!pt) continue;
                                    const isMedia = /\.(m3u8|mp4|m4a|mkv|avi|webm)(\?|$)/i.test(pt);
                                    const isMaster = pt.startsWith(".urlset/");
                                    if (isMedia || isMaster) {
                                        result.push({ title: item.title, file: baseMatch + pt, subtitle: item.subtitle });
                                    }
                                }
                            } else if (typeof fileVal === "string" && fileVal.trim()) {
                                result.push({ title: item.title, file: fileVal.trim(), subtitle: item.subtitle });
                            }
                        } else if (typeof item === "object" && item !== null) {
                            result.push(item);
                        } else {
                            result.push(item);
                        }
                    }
                    return result;
                } catch (e) { return []; }
            }
            if (trimmed.startsWith("{")) {
                try {
                    const obj = JSON.parse(trimmed);
                    if (obj.file) return [{ file: obj.file }];
                    return [obj];
                } catch (e) { return []; }
            }
            if (trimmed) return [{ file: trimmed }];
        }
        return [];
    }

    function parseSubtitleTracks(raw) {
        const tracks = [];
        const videos = [];
        if (!raw || typeof raw !== "string") return { tracks, videos };

        const baseUrlMatch = raw.match(/(https?:\/\/[^\/]+\/[^\/]+\/public_files\/)/);
        const baseUrl = baseUrlMatch ? baseUrlMatch[1] : "";

        const parts = raw.split(",");
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            const langMatch = trimmed.match(/^\[([^\]]+)\](https?:\/\/.+\.vtt[^\s,]*)/);
            if (langMatch) {
                tracks.push({ language: langMatch[1], subtitleUrl: langMatch[2] });
                continue;
            }

            if (/^https?:\/\/.+\.(m3u8|mp4|mkv|avi|webm)(\?|$)/i.test(trimmed)) {
                videos.push(trimmed);
            } else if (/^\d{4}-\d{2}\//.test(trimmed)) {
                if (/\.(m3u8|mp4|mkv|avi|webm)(\?|$)/i.test(trimmed)) {
                    videos.push(baseUrl + trimmed);
                }
            } else if (trimmed.startsWith(".urlset/") && /\.(m3u8)(\?|$)/i.test(trimmed)) {
                videos.push(baseUrl + trimmed);
            }
        }
        return { tracks, videos };
    }

    function buildStreamResults(playerJson, fileArray, isMovie, seasonNum, episodeNum) {
        const results = [];
        if (!isMovie) {
            for (const seasonObj of fileArray) {
                const seasonTitle = seasonObj && seasonObj.title ? String(seasonObj.title) : "";
                const seasonMatch = seasonTitle.match(/Season\s*(\d+)/i);
                if (!seasonMatch) continue;
                const sNum = parseInt(seasonMatch[1], 10);
                if (sNum !== seasonNum) continue;
                const folders = seasonObj && seasonObj.folder;
                if (!folders || !Array.isArray(folders)) continue;
                for (const epObj of folders) {
                    const epTitle = epObj && epObj.title ? String(epObj.title) : "";
                    const epMatch = epTitle.match(/Episode\s*(\d+)/i);
                    if (!epMatch) continue;
                    const eNum = parseInt(epMatch[1], 10);
                    if (eNum !== episodeNum) continue;
                    const { tracks: subs, videos: epVideos } = parseSubtitleTracks(epObj && epObj.subtitle);
                    for (const s of subs) {
                        if (s.subtitleUrl) results.push(new StreamResult({
                            url: s.subtitleUrl, quality: "Subtitle", source: s.language || "Subtitle"
                        }));
                    }
                    const streamUrls = [];
                    for (const v of epVideos) streamUrls.push(v);
                    const epFile = epObj && epObj.file;
                    if (epFile && typeof epFile === "string" && epFile.trim()) {
                        const { videos: fileVideos } = parseSubtitleTracks(epFile);
                        for (const v of fileVideos) streamUrls.push(v);
                    }
                    const epFolders = epObj && epObj.folder;
                    if (epFolders && Array.isArray(epFolders)) {
                        for (const src of epFolders) {
                            if (src && src.file && typeof src.file === "string" && src.file.trim()) {
                                const { videos: folderVideos } = parseSubtitleTracks(src.file);
                                for (const v of folderVideos) streamUrls.push(v);
                            }
                        }
                    }
                    for (const sUrl of streamUrls) {
                        const quality = extractQuality(sUrl);
                        results.push(new StreamResult({
                            url: sUrl, quality: quality || "Auto",
                            source: quality ? "Cinemacity - " + quality : "Cinemacity",
                            headers: { Referer: BASE_URL + "/" }
                        }));
                    }
                    return results;
                }
            }
        } else {
            for (const obj of fileArray) {
                if (obj && obj.file && typeof obj.file === "string" && obj.file.trim()) {
                    const quality = extractQuality(obj.file);
                    results.push(new StreamResult({
                        url: obj.file.trim(), quality: quality || "Auto",
                        source: quality ? "Cinemacity - " + quality : "Cinemacity",
                        headers: { Referer: BASE_URL + "/" }
                    }));
                }
            }
            const { tracks: subs, videos: movieVideos } = parseSubtitleTracks(playerJson.subtitle || (fileArray[0] && fileArray[0].subtitle));
            for (const v of movieVideos) {
                const quality = extractQuality(v);
                results.push(new StreamResult({
                    url: v, quality: quality || "Auto",
                    source: quality ? "Cinemacity - " + quality : "Cinemacity",
                    headers: { Referer: BASE_URL + "/" }
                }));
            }
            for (const s of subs) {
                if (s.subtitleUrl) results.push(new StreamResult({
                    url: s.subtitleUrl, quality: "Subtitle", source: s.language || "Subtitle"
                }));
            }
        }
        return results;
    }

    async function extractStreamsFromPage(pageUrl, seasonNum, episodeNum, isMovie) {
        const res = await fetchPage(pageUrl);
        if (!res) return [];
        const doc = await parseHtml(res.body);
        if (!doc) return [];
        const bodyHtml = (doc.body ? doc.body.innerHTML : null) || (doc.documentElement ? doc.documentElement.innerHTML : null) || "";
        const playerScript = extractPlayerScript(bodyHtml);
        if (!playerScript) return [];
        const playerJson = parsePlayerData(playerScript);
        if (!playerJson) return [];
        const rawFile = playerJson.file;
        if (!rawFile) return [];
        const fileArray = parseFileArray(rawFile);
        return buildStreamResults(playerJson, fileArray, isMovie, seasonNum, episodeNum);
    }

    async function load(url, cb) {
        try {
            const res = await fetchPage(url);
            if (!res) return cb({ success: false, errorCode: "LOAD_ERROR", message: "Failed to load page" });
            const doc = await parseHtml(res.body);

            const ogTitle = getAttr(queryOne(doc, 'meta[property="og:title"]'), "content");
            const title = cleanTitle(ogTitle || textOf(queryOne(doc, "h1")) || "Unknown");
            const poster = getAttr(queryOne(doc, 'meta[property="og:image"]'), "content");
            const description = textOf(queryOne(doc, "#about .ta-full_text1")) || "";
            const year = String(ogTitle || "").match(/\((\d{4})\)/) ? parseInt(ogTitle.match(/\((\d{4})\)/)[1], 10) : null;

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

            const ratingDivs = queryAll(doc, "div.ta-full_rating1 > div");
            let imdbId = null;
            for (const div of ratingDivs) {
                const onclick = getAttr(div, "onclick");
                const m = onclick ? String(onclick).match(/tt\d+/) : null;
                if (m) { imdbId = m[0]; break; }
            }

            const tvtype = url.includes("/tv-series/") ? "series" : "movie";
            const tmdbMetaType = tvtype === "series" ? "tv" : "movie";

            let tmdbId = null;
            if (imdbId) {
                try {
                    const tmdbRes = await http_get(
                        "https://api.themoviedb.org/3/find/" + imdbId + "?api_key=" + TMDB_API_KEY + "&external_source=imdb_id",
                        { headers: HEADERS }
                    );
                    if (tmdbRes && tmdbRes.body) {
                        const tmdbData = JSON.parse(tmdbRes.body);
                        const results = tmdbData.movie_results || tmdbData.tv_results || [];
                        if (results.length > 0) tmdbId = String(results[0].id);
                    }
                } catch (e) { }
            }

            let metaJson = null;
            if (imdbId && tmdbId) {
                const metaUrl = CINEMETA_URL + "/" + tmdbMetaType + "/" + tmdbId + ".json";
                try {
                    const mr = await http_get(metaUrl, { headers: HEADERS });
                    if (mr && mr.body && mr.body.trim().startsWith("{")) {
                        metaJson = JSON.parse(mr.body);
                    }
                } catch (e) { }
            }

            const metaName = metaJson && metaJson.meta && metaJson.meta.name;
            const metaDesc = metaJson && metaJson.meta && metaJson.meta.description;
            const metaBg = metaJson && metaJson.meta && metaJson.meta.background;
            const metaYear = metaJson && metaJson.meta && metaJson.meta.year ? parseInt(metaJson.meta.year, 10) : null;
            const metaScore = metaJson && metaJson.meta && metaJson.meta.imdbRating ? parseFloat(metaJson.meta.imdbRating) : null;
            const metaVideos = (metaJson && metaJson.meta && metaJson.meta.videos) || [];
            const epMetaMap = {};
            for (const v of metaVideos) {
                if (v.season != null && v.episode != null) {
                    epMetaMap[String(v.season) + ":" + String(v.episode)] = v;
                }
            }

            const loadHtml = (doc.body ? doc.body.innerHTML : null) || res.body || "";
            const playerScript = extractPlayerScript(loadHtml);
            let playerJson = null;
            if (playerScript) playerJson = parsePlayerData(playerScript);
            const rawFile = playerJson && playerJson.file;
            const fileArray = parseFileArray(rawFile);

            const plotParts = [];
            if (metaDesc) plotParts.push(metaDesc);
            if (description) plotParts.push(description);
            if (audioLanguages) plotParts.push("Audio: " + audioLanguages);
            const plot = plotParts.join(" - ");

            if (tvtype === "series") {
                const episodes = [];
                for (const seasonObj of fileArray) {
                    const seasonTitle = seasonObj && seasonObj.title ? String(seasonObj.title) : "";
                    const seasonMatch = seasonTitle.match(/Season\s*(\d+)/i);
                    if (!seasonMatch) continue;
                    const seasonNum = parseInt(seasonMatch[1], 10);
                    const folders = seasonObj && seasonObj.folder;
                    if (!folders || !Array.isArray(folders)) continue;
                    for (const epObj of folders) {
                        const epTitle = epObj && epObj.title ? String(epObj.title) : "";
                        const epMatch = epTitle.match(/Episode\s*(\d+)/i);
                        if (!epMatch) continue;
                        const epNum = parseInt(epMatch[1], 10);
                        const epStreams = playerJson ? buildStreamResults(playerJson, fileArray, false, seasonNum, epNum) : [];
                        const metaKey = seasonNum + ":" + epNum;
                        const epMeta = epMetaMap[metaKey];
                        episodes.push(new Episode({
                            name: epMeta && epMeta.name ? epMeta.name : "S" + seasonNum + "E" + epNum,
                            url: url + "?s=" + seasonNum + "&e=" + epNum,
                            season: seasonNum,
                            episode: epNum,
                            description: epMeta && epMeta.overview ? epMeta.overview : null,
                            posterUrl: epMeta && epMeta.thumbnail ? epMeta.thumbnail : (metaJson && metaJson.meta && metaJson.meta.poster) ? metaJson.meta.poster : poster,
                            streams: epStreams
                        }));
                    }
                }

                if (episodes.length === 0) {
                    const fallbackStreams = playerJson ? buildStreamResults(playerJson, fileArray, false, 1, 1) : [];
                    episodes.push(new Episode({
                        name: "Episode 1",
                        url: url + "?s=1&e=1",
                        season: 1,
                        episode: 1,
                        streams: fallbackStreams
                    }));
                }

                cb({
                    success: true,
                    data: new MultimediaItem({
                        title: metaName || title,
                        url: url,
                        posterUrl: poster || metaBg || "",
                        description: metaDesc || description || "",
                        year: year || metaYear || null,
                        score: metaScore || null,
                        type: "series",
                        episodes: episodes
                    })
                });
            } else {
                const movieStreams = playerJson ? buildStreamResults(playerJson, fileArray, true, 1, 1) : [];
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
                                url: url + "?s=1&e=1",
                                season: 1,
                                episode: 1,
                                posterUrl: poster || "",
                                streams: movieStreams
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

            if (trimmed.startsWith("cinemastream://")) {
                const decoded = decodeStreamUrl(trimmed);
                if (decoded && decoded.streams) {
                    const results = decoded.streams.map(function(s) {
                        return new StreamResult({
                            url: s.u,
                            quality: s.q || "Auto",
                            source: s.src || "Cinemacity",
                            headers: s.h || null
                        });
                    });
                    if (cb) cb({ success: true, data: results });
                    else return results;
                    return;
                }
                if (cb) cb({ success: true, data: [] });
                return;
            }

            if (trimmed.startsWith("cinemacity://")) {
                const afterProtocol = trimmed.replace("cinemacity://", "");
                const hashIdxInProtocol = afterProtocol.indexOf("#");
                const b64Part = hashIdxInProtocol >= 0 ? afterProtocol.substring(0, hashIdxInProtocol) : afterProtocol;
                const hashPart = hashIdxInProtocol >= 0 ? afterProtocol.substring(hashIdxInProtocol + 1) : "";
                const decodedUrl = fromBase64(b64Part);
                let seasonNum = 1, episodeNum = 1, isMovie = false;
                if (hashPart.includes("s=") && hashPart.includes("e=")) {
                    const sMatch = hashPart.match(/[?&]s=(\d+)/);
                    const eMatch = hashPart.match(/[?&]e=(\d+)/);
                    seasonNum = sMatch ? parseInt(sMatch[1], 10) : 1;
                    episodeNum = eMatch ? parseInt(eMatch[1], 10) : 1;
                } else if (hashPart === "movie") {
                    isMovie = true;
                } else {
                    if (cb) cb({ success: true, data: [] });
                    return;
                }
                const results = await extractStreamsFromPage(decodedUrl, seasonNum, episodeNum, isMovie);
                if (cb) cb({ success: true, data: results });
                else return results;
                return;
            }

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
                if (cb) cb({ success: true, data: results });
                else return results;
                return;
            }

            if (cb) cb({ success: true, data: [] });
        } catch (e) {
            if (cb) cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
            else throw e;
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
