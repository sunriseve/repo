(function () {
    "use strict";

    // ─── MANIFEST ─────────────────────────────────────────────────────────────
    const BASE_URL =
        (typeof manifest !== "undefined" && manifest && manifest.baseUrl)
            ? manifest.baseUrl.replace(/\/$/, "")
            : "https://cinemacity.cc";

    // Cookie decoded from Kotlin base64: "ZGxlX3VzZXJfaWQ9MzI3Mjk7IGRsZV9wYXNzd29yZD04OTQxNzFjNmE4ZGFiMThlZTU5NGQ1YzY1MjAwOWEzNTs="
    const COOKIE = "dle_user_id=32729; dle_password=894171c6a8dab18ee594d5c652009a35;";

    const HEADERS = {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": COOKIE
    };

    // Headers sent alongside each stream URL so the player is authenticated
    const STREAM_HEADERS = {
        "Referer": BASE_URL + "/",
        "Cookie": COOKIE,
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    };

    const TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
    const TMDB_IMG = "https://image.tmdb.org/t/p/original";
    const CINEMETA = "https://v3-cinemeta.strem.io/meta";

    const HOME_SECTIONS = [
        { name: "Movies",       path: "/movies" },
        { name: "TV Series",    path: "/tv-series" },
        { name: "Anime",        path: "/xfsearch/genre/anime" },
        { name: "Asian",        path: "/xfsearch/genre/asian" },
        { name: "Animation",    path: "/xfsearch/genre/animation" },
        { name: "Documentary",  path: "/xfsearch/genre/documentary" }
    ];

    // ─── UTILITIES ────────────────────────────────────────────────────────────

    function fixUrl(href) {
        if (!href) return "";
        if (href.startsWith("http")) return href;
        return BASE_URL + (href.startsWith("/") ? "" : "/") + href;
    }

    function safeJson(text, fallback) {
        try { return JSON.parse(text); } catch (_) { return fallback; }
    }

    /** Decode one (or two) levels of base64 atob() calls embedded in a script */
    function decodeAtob(scriptText) {
        const matches = [...scriptText.matchAll(/atob\s*\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/g)];
        for (const m of matches) {
            try {
                const decoded = atob(m[1]);
                if (decoded.includes("new Playerjs(")) return decoded;
                // One level deeper
                const inner = [...decoded.matchAll(/atob\s*\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/g)];
                for (const im of inner) {
                    try {
                        const d2 = atob(im[1]);
                        if (d2.includes("new Playerjs(")) return d2;
                    } catch (_) {}
                }
            } catch (_) {}
        }
        return null;
    }

    /**
     * Extract the Playerjs config object from decoded script text.
     * Uses brace-balancing to find the exact JSON extent — safer than lastIndexOf.
     */
    function extractPlayerjsConfig(scriptText) {
        const start = scriptText.indexOf("new Playerjs(");
        if (start === -1) return null;
        let i = start + "new Playerjs(".length;
        // skip optional leading (
        while (i < scriptText.length && scriptText[i] === "(") i++;
        if (scriptText[i] !== "{") return null;
        let depth = 0;
        let jsonStart = i;
        for (; i < scriptText.length; i++) {
            if (scriptText[i] === "{") depth++;
            else if (scriptText[i] === "}") {
                depth--;
                if (depth === 0) { i++; break; }
            }
        }
        const jsonStr = scriptText.slice(jsonStart, i);
        try { return JSON.parse(jsonStr); } catch (_) {
            // Try single-quote fixup
            try { return JSON.parse(jsonStr.replace(/'/g, '"')); } catch (_2) { return null; }
        }
    }

    /**
     * Find and decode the Playerjs config from a parsed HTML document.
     * Kotlin does: doc.select("script:containsData(atob)").getOrNull(1)
     * We mirror this: prefer index 1, then scan all.
     */
    function getPlayerjsConfig(doc) {
        const scripts = Array.from(doc.querySelectorAll("script"));
        const atobScripts = scripts.filter(s => (s.textContent || "").includes("atob"));

        // Mirror Kotlin's getOrNull(1) — try the second atob script first
        const candidates = atobScripts.length >= 2
            ? [atobScripts[1], ...atobScripts.filter((_, i) => i !== 1)]
            : atobScripts;

        for (const script of candidates) {
            const decoded = decodeAtob(script.textContent || "");
            if (!decoded) continue;
            const config = extractPlayerjsConfig(decoded);
            if (config && config.file !== undefined) return config;
        }
        return null;
    }

    /**
     * Parse the [Label]url,[Label]url,... multi-quality format used by CinemaCity.
     * Returns an array of { label, url }.
     * Also handles plain single URLs with no label prefix.
     */
    function parseMultiQuality(fileStr) {
        if (!fileStr || typeof fileStr !== "string") return [];
        const result = [];
        // Try labelled format first: [Label]https://...
        const labelPattern = /\[([^\]]+)\](https?:\/\/[^,\s\[]+)/g;
        let m;
        while ((m = labelPattern.exec(fileStr)) !== null) {
            result.push({ label: m[1].trim(), url: m[2].trim() });
        }
        if (result.length > 0) return result;

        // No labels — split by comma and return raw URLs
        fileStr.split(",").forEach(part => {
            const t = part.trim();
            if (t && /^https?:\/\//i.test(t)) {
                result.push({ label: null, url: t });
            }
        });
        return result;
    }

    /**
     * Determine quality label for a StreamResult.
     * Priority: explicit label from PlayerJS > URL pattern match > null
     */
    function qualityLabel(label, url) {
        if (label) return label;
        const u = (url || "").toLowerCase();
        if (u.includes("2160p") || u.includes("4k"))  return "4K";
        if (u.includes("1440p"))                        return "1440p";
        if (u.includes("1080p") || u.includes("fhd"))  return "1080p";
        if (u.includes("720p")  || u.includes("/hd/")) return "720p";
        if (u.includes("480p"))                         return "480p";
        if (u.includes("360p"))                         return "360p";
        return null;
    }

    /**
     * Parse CinemaCity subtitle string format: [Language]https://sub.vtt,[Language]https://sub2.vtt
     * Returns array of { language, subtitleUrl }
     */
    function parseSubtitles(raw) {
        const tracks = [];
        if (!raw || typeof raw !== "string" || !raw.trim()) return tracks;
        // Pattern: [LangLabel]url  — url can have query strings, no .vtt requirement
        const re = /\[([^\]]+)\](https?:\/\/[^\s,\[]+)/g;
        let m;
        while ((m = re.exec(raw)) !== null) {
            tracks.push({ language: m[1].trim(), subtitleUrl: m[2].trim() });
        }
        return tracks;
    }

    /**
     * Recursively collect all stream { label, url } pairs from a PlayerJS file node.
     * Handles: plain string, [label]url string, array of folder objects, nested folders.
     */
    function collectStreams(fileNode, subtitleNode) {
        const streams = [];
        const subtitles = parseSubtitles(subtitleNode);

        if (typeof fileNode === "string") {
            const multi = parseMultiQuality(fileNode);
            multi.forEach(item => streams.push({ ...item, subtitles }));
            return streams;
        }

        if (Array.isArray(fileNode)) {
            fileNode.forEach(item => {
                if (item && item.file) {
                    const sub = item.subtitle || subtitleNode;
                    const multi = parseMultiQuality(item.file);
                    const itemSubs = parseSubtitles(sub);
                    multi.forEach(entry => streams.push({ ...entry, subtitles: itemSubs.length ? itemSubs : subtitles }));
                }
                if (item && item.folder) {
                    item.folder.forEach(sub2 => {
                        if (sub2 && sub2.file) {
                            const multi = parseMultiQuality(sub2.file);
                            const s = parseSubtitles(sub2.subtitle || subtitleNode);
                            multi.forEach(entry => streams.push({ ...entry, subtitles: s.length ? s : subtitles }));
                        }
                    });
                }
            });
        }

        return streams;
    }

    // ─── CARD PARSER ──────────────────────────────────────────────────────────

    function parseCard(card) {
        const anchor = card.querySelector("a.e-nowrap") || card.querySelector("a");
        if (!anchor) return null;
        const href = anchor.getAttribute("href") || "";
        if (!href) return null;

        const title = (anchor.textContent || "").split("(")[0].trim();
        const bgAnchor = card.querySelector("div.dar-short_bg a, div.dar-short_bg.e-cover a");
        const posterUrl = bgAnchor ? (bgAnchor.getAttribute("href") || "") : "";
        const type = href.includes("/tv-series/") ? "series" : "movie";

        return new MultimediaItem({
            title: title,
            url: fixUrl(href),
            posterUrl: fixUrl(posterUrl),
            type: type
        });
    }

    // ─── HTTP HELPERS ─────────────────────────────────────────────────────────

    async function fetchHtml(url) {
        try {
            const res = await http_get(url, { headers: HEADERS });
            if (res && res.body) return res.body;
        } catch (_) {}
        return null;
    }

    async function fetchJson(url) {
        try {
            const res = await http_get(url, {
                headers: { "User-Agent": HEADERS["User-Agent"], "Accept": "application/json" }
            });
            if (res && res.body) return safeJson(res.body, null);
        } catch (_) {}
        return null;
    }

    function parseHtmlBody(html) {
        if (!html) return null;
        try {
            const p = new DOMParser();
            return p.parseFromString(html, "text/html");
        } catch (_) { return null; }
    }

    // ─── METADATA ENRICHMENT ──────────────────────────────────────────────────

    async function getImdbId(doc) {
        const divs = Array.from(doc.querySelectorAll("div.ta-full_rating1 > div"));
        for (const d of divs) {
            const onclick = d.getAttribute("onclick") || "";
            const m = onclick.match(/tt\d+/);
            if (m) return m[0];
        }
        return null;
    }

    async function getTmdbId(imdbId, type) {
        if (!imdbId) return null;
        try {
            const data = await fetchJson(
                `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`
            );
            if (!data) return null;
            const arr = type === "series"
                ? (data.tv_results || [])
                : (data.movie_results || []);
            return arr[0]?.id ? String(arr[0].id) : null;
        } catch (_) { return null; }
    }

    async function getTmdbCredits(tmdbId, type) {
        if (!tmdbId) return [];
        const endpoint = type === "series" ? "tv" : "movie";
        try {
            const data = await fetchJson(
                `https://api.themoviedb.org/3/${endpoint}/${tmdbId}/credits?api_key=${TMDB_KEY}&language=en-US`
            );
            if (!data || !Array.isArray(data.cast)) return [];
            return data.cast.slice(0, 15).map(c => new Actor({
                name: c.name || c.original_name || "",
                image: c.profile_path ? `${TMDB_IMG}${c.profile_path}` : undefined,
                role: c.character || undefined
            }));
        } catch (_) { return []; }
    }

    async function getCinemetaMeta(imdbId, type) {
        if (!imdbId) return null;
        const metaType = type === "series" ? "series" : "movie";
        try {
            const data = await fetchJson(`${CINEMETA}/${metaType}/${imdbId}.json`);
            return data?.meta || null;
        } catch (_) { return null; }
    }

    // Build an episodeMeta lookup map from Cinemeta videos array
    function buildEpMetaMap(videos) {
        if (!Array.isArray(videos)) return {};
        const map = {};
        videos.forEach(v => {
            if (v.season != null && v.episode != null) {
                map[`${v.season}:${v.episode}`] = v;
            }
        });
        return map;
    }

    // ─── GETHOOME ─────────────────────────────────────────────────────────────

    async function getHome(cb) {
        try {
            const promises = HOME_SECTIONS.map(async section => {
                try {
                    const html = await fetchHtml(BASE_URL + section.path);
                    const doc = parseHtmlBody(html);
                    if (!doc) return [section.name, []];
                    const cards = Array.from(doc.querySelectorAll("div.dar-short_item"));
                    const items = cards.map(parseCard).filter(Boolean);
                    return [section.name, items];
                } catch (_) {
                    return [section.name, []];
                }
            });

            const results = await Promise.all(promises);
            const data = {};
            results.forEach(([name, items]) => { data[name] = items; });

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, error: String(e) });
        }
    }

    // ─── SEARCH ───────────────────────────────────────────────────────────────

    async function search(query, cb) {
        try {
            const encoded = encodeURIComponent(query);
            const url = `${BASE_URL}/index.php?do=search&subaction=search&search_start=0&full_search=0&story=${encoded}`;
            const html = await fetchHtml(url);
            const doc = parseHtmlBody(html);
            if (!doc) return cb({ success: false, error: "No results page" });

            const cards = Array.from(doc.querySelectorAll("div.dar-short_item"));
            const items = cards.map(parseCard).filter(Boolean);
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, error: String(e) });
        }
    }

    // ─── LOAD ─────────────────────────────────────────────────────────────────

    async function load(url, cb) {
        try {
            const html = await fetchHtml(url);
            const doc = parseHtmlBody(html);
            if (!doc) return cb({ success: false, error: "Failed to load page" });

            // ── Basic metadata ──────────────────────────────────────────
            const ogTitle  = (doc.querySelector("meta[property='og:title']")?.getAttribute("content") || "").trim();
            const title    = ogTitle.split("(")[0].trim();
            const poster   = doc.querySelector("meta[property='og:image']")?.getAttribute("content") || "";
            const bgPoster = doc.querySelector("div.dar-full_bg a")?.getAttribute("href") || poster;
            const trailer  = doc.querySelector("div.dar-full_bg.e-cover > div")?.getAttribute("data-vbg") || "";
            const yearStr  = ogTitle.match(/\((\d{4})\)/)?.[1];
            const year     = yearStr ? parseInt(yearStr) : undefined;
            const desc     = doc.querySelector("#about div.ta-full_text1")?.textContent?.trim() || "";
            const isMovie  = url.includes("/movies/");
            const type     = isMovie ? "movie" : "series";

            // Audio language tag
            const audioEl = Array.from(doc.querySelectorAll("li")).find(li =>
                li.querySelector("span")?.textContent?.trim()?.toLowerCase() === "audio language"
            );
            const audio = audioEl
                ? Array.from(audioEl.querySelectorAll("span:nth-child(2) a")).map(a => a.textContent.trim()).filter(Boolean).join(", ")
                : "";

            // Recommendations
            const recItems = Array.from(doc.querySelectorAll("div.ta-rel > div.ta-rel_item")).map(el => {
                const a    = el.querySelector("a");
                const href = a?.getAttribute("href") || "";
                const t    = (a?.textContent || "").split("(")[0].trim();
                const p    = el.querySelector("div > a")?.getAttribute("href") || "";
                if (!href || !t) return null;
                return new MultimediaItem({ title: t, url: fixUrl(href), posterUrl: fixUrl(p), type: "movie" });
            }).filter(Boolean);

            // ── IDs & enrichment ────────────────────────────────────────
            const imdbId  = await getImdbId(doc);
            const tmdbId  = await getTmdbId(imdbId, type);
            const cast    = await getTmdbCredits(tmdbId, type);
            const meta    = await getCinemetaMeta(imdbId, type);

            const finalTitle  = meta?.name  || title;
            const description = meta?.description || desc;
            const finalBg     = meta?.background  || bgPoster;
            const genres      = meta?.genres      || [];
            const rating      = meta?.imdbRating  || undefined;
            const cert        = meta?.appExtras?.certification || meta?.certification || undefined;
            const logoPath    = imdbId ? `https://live.metahub.space/logo/medium/${imdbId}/img` : undefined;
            const epMetaMap   = buildEpMetaMap(meta?.videos);

            // Trailer
            const trailerObjs = trailer
                ? [new Trailer({ url: trailer })]
                : (Array.isArray(meta?.trailers)
                    ? meta.trailers.slice(0, 1).map(t2 => new Trailer({ url: t2.source || t2.url || "" })).filter(t2 => t2.url)
                    : []);

            // ── PlayerJS extraction ─────────────────────────────────────
            const config = getPlayerjsConfig(doc);
            if (!config) {
                return cb({ success: false, error: "PlayerJS config not found on page" });
            }

            const rawFile    = config.file;
            const globalSubs = config.subtitle || null;

            // Normalise file to an array of objects
            let fileArray = [];
            if (Array.isArray(rawFile)) {
                fileArray = rawFile;
            } else if (typeof rawFile === "string") {
                const s = rawFile.trim();
                if (s.startsWith("[") && s.endsWith("]")) {
                    fileArray = safeJson(s, []);
                } else if (s.startsWith("{") && s.endsWith("}")) {
                    fileArray = [safeJson(s, { file: s })];
                } else if (s) {
                    fileArray = [{ file: s }];
                }
            }

            // ── Movie path ──────────────────────────────────────────────
            if (isMovie) {
                const firstItem  = fileArray[0] || {};
                const hasFolder  = Array.isArray(firstItem.folder);

                let movieStreamStr;
                let movieSubs;

                if (!hasFolder && firstItem.file) {
                    // Simple movie: file field holds the stream URL(s)
                    movieStreamStr = firstItem.file;
                    movieSubs = parseSubtitles(firstItem.subtitle || globalSubs);
                } else if (hasFolder) {
                    // Quality folder at root level
                    const urls = firstItem.folder
                        .filter(f => f && f.file)
                        .map(f => {
                            const q = parseMultiQuality(f.file);
                            const label2 = f.title || (q[0]?.label) || null;
                            const fileUrl = q[0]?.url || f.file;
                            return label2 ? `[${label2}]${fileUrl}` : fileUrl;
                        }).join(",");
                    movieStreamStr = urls;
                    movieSubs = parseSubtitles(firstItem.subtitle || globalSubs);
                } else {
                    // fileArray is direct stream strings
                    movieStreamStr = rawFile;
                    movieSubs = parseSubtitles(globalSubs);
                }

                const movieData = JSON.stringify({
                    streamUrl: movieStreamStr,
                    subtitleTracks: movieSubs
                });

                const item = new MultimediaItem({
                    title:           finalTitle,
                    url:             movieData,
                    posterUrl:       poster,
                    bannerUrl:       finalBg,
                    type:            "movie",
                    year:            year,
                    score:           rating ? parseFloat(rating) : undefined,
                    contentRating:   cert,
                    description:     audio ? `${description}\n\nAudio: ${audio}` : description,
                    cast:            cast,
                    trailers:        trailerObjs,
                    recommendations: recItems,
                    logoUrl:         logoPath,
                    tags:            genres
                });
                return cb({ success: true, data: item });
            }

            // ── Series path ─────────────────────────────────────────────
            const seasonRegex  = /Season\s*(\d+)/i;
            const episodeRegex = /Episode\s*(\d+)/i;
            const episodes = [];

            for (const seasonObj of fileArray) {
                if (!seasonObj || typeof seasonObj !== "object") continue;
                const sMatch = seasonRegex.exec(seasonObj.title || "");
                if (!sMatch) continue;
                const seasonNum = parseInt(sMatch[1]);

                const epList = Array.isArray(seasonObj.folder) ? seasonObj.folder : [];
                for (const epObj of epList) {
                    if (!epObj || typeof epObj !== "object") continue;
                    const eMatch = episodeRegex.exec(epObj.title || "");
                    if (!eMatch) continue;
                    const epNum = parseInt(eMatch[1]);

                    // Collect all stream sources for this episode
                    // Episodes may have a direct file or a nested folder of quality sources
                    const streamSources = [];

                    if (epObj.file) {
                        streamSources.push(epObj.file);
                    }

                    if (Array.isArray(epObj.folder)) {
                        epObj.folder.forEach(qObj => {
                            if (qObj && qObj.file) {
                                // Represent as [Title]url if title present
                                const label3 = qObj.title ? qObj.title.trim() : null;
                                const multi  = parseMultiQuality(qObj.file);
                                if (label3 && multi.length > 0) {
                                    multi.forEach(e2 => streamSources.push(`[${label3}]${e2.url}`));
                                } else {
                                    streamSources.push(qObj.file);
                                }
                            }
                        });
                    }

                    if (streamSources.length === 0) continue;

                    const epSubs    = parseSubtitles(epObj.subtitle || globalSubs);
                    const metaKey   = `${seasonNum}:${epNum}`;
                    const epMeta    = epMetaMap[metaKey];

                    const epData = JSON.stringify({
                        streams: streamSources,
                        subtitleTracks: epSubs
                    });

                    episodes.push(new Episode({
                        name:        epMeta?.name || `S${String(seasonNum).padStart(2,"0")}E${String(epNum).padStart(2,"0")}`,
                        url:         epData,
                        season:      seasonNum,
                        episode:     epNum,
                        airDate:     epMeta?.released || undefined,
                        description: epMeta?.overview || undefined,
                        posterUrl:   epMeta?.thumbnail || undefined
                    }));
                }
            }

            const seriesItem = new MultimediaItem({
                title:           finalTitle,
                url:             url,
                posterUrl:       poster,
                bannerUrl:       finalBg,
                type:            "series",
                year:            year,
                score:           rating ? parseFloat(rating) : undefined,
                contentRating:   cert,
                description:     audio ? `${description}\n\nAudio: ${audio}` : description,
                cast:            cast,
                trailers:        trailerObjs,
                recommendations: recItems,
                logoUrl:         logoPath,
                tags:            genres,
                episodes:        episodes
            });
            cb({ success: true, data: seriesItem });

        } catch (e) {
            cb({ success: false, error: String(e) });
        }
    }

    // ─── LOADSTREAMS ──────────────────────────────────────────────────────────
    
    async function loadStreams(url, cb) {
        try {
            const payload = safeJson(url, null);

            if (!payload) {
                // Fallback: maybe it's a raw stream URL (shouldn't happen with this plugin)
                if (url && /^https?:\/\//i.test(url)) {
                    return cb({
                        success: true,
                        data: [new StreamResult({
                            url: url,
                            quality: qualityLabel(null, url),
                            headers: STREAM_HEADERS
                        })]
                    });
                }
                return cb({ success: false, error: "Invalid stream payload" });
            }

            const results = [];
            const subtitleTracks = Array.isArray(payload.subtitleTracks) ? payload.subtitleTracks : [];

            // Convert subtitle tracks to StreamResult subtitles format
            const subs = subtitleTracks.map(st => ({
                url:   st.subtitleUrl || st.url || "",
                label: st.language || "Unknown",
                lang:  st.language || "und"
            })).filter(s => s.url);

            // ── Movie: single streamUrl string (may contain [label]url,... list) ──
            if (payload.streamUrl !== undefined) {
                const entries = parseMultiQuality(payload.streamUrl);

                if (entries.length > 0) {
                    entries.forEach(({ label, url: streamUrl }) => {
                        if (!streamUrl) return;
                        results.push(new StreamResult({
                            url:       streamUrl,
                            quality:   qualityLabel(label, streamUrl),
                            headers:   STREAM_HEADERS,
                            subtitles: subs
                        }));
                    });
                } else if (payload.streamUrl) {
                    // Plain URL fallback
                    results.push(new StreamResult({
                        url:       payload.streamUrl,
                        quality:   qualityLabel(null, payload.streamUrl),
                        headers:   STREAM_HEADERS,
                        subtitles: subs
                    }));
                }
            }

            // ── Episode: array of stream source strings ──────────────────────
            if (Array.isArray(payload.streams)) {
                payload.streams.forEach(srcStr => {
                    if (!srcStr) return;
                    const entries = parseMultiQuality(srcStr);
                    if (entries.length > 0) {
                        entries.forEach(({ label, url: streamUrl }) => {
                            if (!streamUrl) return;
                            results.push(new StreamResult({
                                url:       streamUrl,
                                quality:   qualityLabel(label, streamUrl),
                                headers:   STREAM_HEADERS,
                                subtitles: subs
                            }));
                        });
                    } else {
                        // Plain URL
                        results.push(new StreamResult({
                            url:       srcStr,
                            quality:   qualityLabel(null, srcStr),
                            headers:   STREAM_HEADERS,
                            subtitles: subs
                        }));
                    }
                });
            }

            if (results.length === 0) {
                return cb({ success: false, error: "No playable streams found in payload" });
            }

            cb({ success: true, data: results });

        } catch (e) {
            cb({ success: false, error: String(e) });
        }
    }

    // ─── EXPORT ───────────────────────────────────────────────────────────────
    globalThis.getHome      = getHome;
    globalThis.search       = search;
    globalThis.load         = load;
    globalThis.loadStreams  = loadStreams;

})();
