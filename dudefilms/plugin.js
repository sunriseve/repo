(function() {
    const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    
    const CINEMETA_URL = "https://v3-cinemeta.strem.io/meta";
    const DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
    
    let cachedBaseUrl = null;
    
    function getBaseUrl() {
        return cachedBaseUrl || manifest.baseUrl;
    }

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

    function extractQuality(text) {
        if (!text) return "";
        const match = text.match(/\b(2160|1440|1080|720|576|540|480)\s*[pP]\b/);
        return match ? match[0] : "";
    }

    function extractSize(text) {
        if (!text) return "";
        const match = text.match(/\[(\d+\.?\d*)\s*(GB|MB|gb|mb)\]/i);
        if (match) return match[1] + " " + match[2].toUpperCase();
        return "";
    }

    function getSourceName(url, text) {
        const combined = (url + " " + text).toLowerCase();
        if (combined.includes("hubcloud")) return "HubCloud";
        if (combined.includes("gdflix") || combined.includes("g-drive") || combined.includes("gdrive")) return "GDFlix";
        if (combined.includes("pixeldrain")) return "PixelDrain";
        if (combined.includes("gofile")) return "Gofile";
        if (combined.includes("kraken")) return "Krakenfiles";
        if (combined.includes("mega")) return "Mega";
        if (combined.includes("dotflix")) return "DotFlix";
        if (combined.includes("filepress") || combined.includes("filebee")) return "FileBee";
        if (combined.includes("doodstream") || combined.includes("dood")) return "DoodStream";
        if (combined.includes("streamwish")) return "StreamWish";
        if (combined.includes("gkyfilehost")) return "GKYFileHost";
        if (combined.includes("instant")) return "GDFlix [Instant]";
        if (combined.includes("cf") || combined.includes("cloudflare")) return "GDFlix [CF]";
        if (combined.includes("fsl") || combined.includes("fast server")) return "FSL Server";
        if (combined.includes("krakenfiles")) return "Krakenfiles";
        return "Download";
    }

    function getSearchQuality(check) {
        if (!check) return null;
        const s = check.toLowerCase();
        if (/\b(4k|ds4k|uhd|2160p)\b/.test(s)) return "FourK";
        if (/\b(hdts|hdcam|hdtc)\b/.test(s)) return "HdCam";
        if (/\b(camrip|cam[- ]?rip)\b/.test(s)) return "CamRip";
        if (/\b(cam)\b/.test(s)) return "Cam";
        if (/\b(web[- ]?dl|webrip|webdl)\b/.test(s)) return "WebRip";
        if (/\b(bluray|bdrip|blu[- ]?ray)\b/.test(s)) return "BlueRay";
        if (/\b(1080p|fullhd)\b/.test(s)) return "HD";
        if (/\b(720p)\b/.test(s)) return "SD";
        if (/\b(hdrip|hdtv)\b/.test(s)) return "HD";
        return null;
    }

    function isBlockedButton(href) {
        if (!href) return true;
        const blocked = ["zipfile", "torrent", "rar", "7z", "password"];
        const h = href.toLowerCase();
        return blocked.some(b => h.includes(b));
    }

    function parseSearchResult(element, baseUrl) {
        const titleEl = element.querySelector("h3");
        const anchor = element.querySelector("h3 a");
        const img = element.querySelector("img");
        
        const title = cleanTitle(titleEl ? titleEl.textContent : "");
        const href = anchor ? anchor.getAttribute("href") : "";
        const posterUrl = img ? (img.getAttribute("data-src") || img.getAttribute("src")) : "";
        
        const isSeries = title.toLowerCase().includes("season") || 
                         title.toLowerCase().includes("web series") ||
                         href.includes("/web-series/");
        
        return new MultimediaItem({
            title,
            url: fixUrl(href, baseUrl),
            posterUrl: fixUrl(posterUrl, baseUrl),
            type: isSeries ? "tvseries" : "movie",
            quality: getSearchQuality(title)
        });
    }

    async function getHome(cb) {
        try {
            cachedBaseUrl = null;
            
            try {
                const res = await http_get(DOMAINS_URL, { "User-Agent": UA });
                if (res && res.body) {
                    const json = JSON.parse(res.body);
                    cachedBaseUrl = json.dudefilms || manifest.baseUrl;
                }
            } catch (e) {}
            
            if (!cachedBaseUrl) {
                cachedBaseUrl = manifest.baseUrl;
            }
            
            const baseUrl = cachedBaseUrl;
            const categories = [
                { key: "", name: "Trending" },
                { key: "category/bollywood", name: "Bollywood" },
                { key: "category/hollywood", name: "Hollywood" },
                { key: "category/gujarati", name: "Gujarati" },
                { key: "category/southindian", name: "South Indian" },
                { key: "category/webseries", name: "Web Series" }
            ];

            const homeData = {};
            
            for (const cat of categories) {
                try {
                    const url = cat.key ? baseUrl + "/" + cat.key : baseUrl;
                    const res = await http_get(url, { "User-Agent": UA });
                    
                    if (res && res.body) {
                        const doc = await parseHtml(res.body);
                        const items = [];
                        const cards = doc.querySelectorAll("div.simple-grid-grid-post");
                        for (const card of cards) {
                            const item = parseSearchResult(card, baseUrl);
                            if (item && item.title) items.push(item);
                        }
                        if (items.length > 0) {
                            homeData[cat.name] = items.slice(0, 20);
                        }
                    }
                } catch (e) {
                    console.log("[DudeFilms getHome " + cat.name + "] " + e.message);
                }
            }

            cb({ success: true, data: homeData });
        } catch (e) {
            cb({ success: false, message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            if (!cachedBaseUrl) {
                try {
                    const res = await http_get(DOMAINS_URL, { "User-Agent": UA });
                    if (res && res.body) {
                        const json = JSON.parse(res.body);
                        cachedBaseUrl = json.dudefilms || manifest.baseUrl;
                    }
                } catch (e) {}
            }
            
            const baseUrl = cachedBaseUrl || manifest.baseUrl;
            const results = [];
            
            try {
                const url = baseUrl + "/page/1/?s=" + encodeURIComponent(query);
                const res = await http_get(url, { "User-Agent": UA });
                
                if (res && res.body) {
                    const doc = await parseHtml(res.body);
                    const cards = doc.querySelectorAll("div.simple-grid-grid-post");
                    
                    for (const card of cards) {
                        const item = parseSearchResult(card, baseUrl);
                        if (item && item.title) results.push(item);
                        if (results.length >= 30) break;
                    }
                }
            } catch (e) {
                console.log("[DudeFilms search] " + e.message);
            }

            cb({ success: true, data: results.slice(0, 30) });
        } catch (e) {
            cb({ success: false, message: e.message });
        }
    }

    async function load(url, cb) {
        try {
            if (!cachedBaseUrl) {
                try {
                    const res = await http_get(DOMAINS_URL, { "User-Agent": UA });
                    if (res && res.body) {
                        const json = JSON.parse(res.body);
                        cachedBaseUrl = json.dudefilms || manifest.baseUrl;
                    }
                } catch (e) {}
            }
            
            const baseUrl = cachedBaseUrl || manifest.baseUrl;
            const res = await http_get(url, { "User-Agent": UA });
            
            if (!res || !res.body) {
                cb({ success: false, message: "Failed to load page" });
                return;
            }
            
            const doc = await parseHtml(res.body);
            
            const titleEl = doc.querySelector("h1.post-title a, h1.post-title");
            let title = titleEl ? cleanTitle(titleEl.textContent) : "Unknown";
            
            const posterEl = doc.querySelector('[property="og:image"]');
            let poster = posterEl ? posterEl.getAttribute("content") : "";
            
            let description = "";
            const descEl = doc.querySelector("p");
            if (descEl) description = descEl.textContent.trim();
            
            const titleLower = title.toLowerCase();
            const isSeries = titleLower.includes("season") || 
                             titleLower.includes("web series") ||
                             titleLower.includes("episode") ||
                             url.includes("/web-series/") ||
                             url.match(/-s\d/i);
            
            let year = null;
            const yearMatch = title.match(/\((\d{4})\)/);
            if (yearMatch) year = parseInt(yearMatch[1]);
            
            let imdbId = "";
            const imdbLink = doc.querySelector("a[href*='imdb.com/title']");
            if (imdbLink) {
                const href = imdbLink.getAttribute("href") || "";
                imdbId = href.split("title/")[1]?.split("/")[0] || "";
            }

            let metadata = null;
            if (imdbId) {
                try {
                    const typeset = isSeries ? "series" : "movie";
                    const metaRes = await http_get(CINEMETA_URL + "/" + typeset + "/" + imdbId + ".json", { "User-Agent": UA });
                    if (metaRes && metaRes.body && metaRes.body.startsWith("{")) {
                        metadata = JSON.parse(metaRes.body);
                    }
                } catch (e) {}
            }

            if (metadata && metadata.meta) {
                if (metadata.meta.name) title = metadata.meta.name;
                if (metadata.meta.description) description = metadata.meta.description;
                if (metadata.meta.background) poster = metadata.meta.background;
                if (metadata.meta.poster) poster = metadata.meta.poster;
                if (metadata.meta.year) year = parseInt(metadata.meta.year.split("-")[0]);
            }

            const episodes = [];
            
            const dflinks = [];
            const qualityMap = {};
            
            const allElements = doc.querySelectorAll("h4, a.maxbutton");
            let currentQuality = "";
            let currentSize = "";
            
            for (const el of allElements) {
                if (el.tagName && el.tagName.toLowerCase() === "h4") {
                    const text = el.textContent || "";
                    currentQuality = extractQuality(text);
                    currentSize = extractSize(text);
                } else {
                    const href = el.getAttribute("href");
                    if (href && !isBlockedButton(href) && (href.includes("dflinks") || href.includes("dudefilms"))) {
                        qualityMap[href] = { quality: currentQuality || "Auto", size: currentSize };
                        dflinks.push(href);
                    }
                }
            }

            if (dflinks.length > 0) {
                if (isSeries) {
                    const allEpisodes = {};
                    
                    for (const dflink of dflinks) {
                        try {
                            const dfRes = await http_get(dflink, { "User-Agent": UA });
                            if (dfRes && dfRes.body) {
                                const dfDoc = await parseHtml(dfRes.body);
                                const epButtons = dfDoc.querySelectorAll("a.maxbutton");
                                
                                for (const btn of epButtons) {
                                    const href = btn.getAttribute("href");
                                    const text = btn.textContent ? btn.textContent.trim() : "";
                                    
                                    if (!href || isBlockedButton(href)) continue;
                                    
                                    const epMatch = text.match(/(?:Episode|Ep|E)\s*(\d+)/i);
                                    if (epMatch) {
                                        const epNum = parseInt(epMatch[1]);
                                        if (!allEpisodes[epNum]) {
                                            allEpisodes[epNum] = [];
                                        }
                                        allEpisodes[epNum].push({ url: href, source: getSourceName(href, text) });
                                    }
                                }
                            }
                        } catch (e) {
                            console.log("[DudeFilms parse episode] " + e.message);
                        }
                    }
                    
                    const epNums = Object.keys(allEpisodes).map(Number).sort((a, b) => a - b);
                    for (const epNum of epNums) {
                        episodes.push(new Episode({
                            name: "Episode " + epNum,
                            url: JSON.stringify(allEpisodes[epNum]),
                            season: 1,
                            episode: epNum
                        }));
                    }
                    
                    if (episodes.length === 0) {
                        episodes.push(new Episode({
                            name: "All Episodes",
                            url: JSON.stringify(dflinks.map(u => ({ url: u, source: "Quality" }))),
                            season: 1,
                            episode: 1
                        }));
                    }
                } else {
                    for (const dflink of dflinks) {
                        const qInfo = qualityMap[dflink] || { quality: "Auto", size: "" };
                        const quality = qInfo.quality || "Auto";
                        const size = qInfo.size || "";
                        const sizeStr = size ? " [" + size + "]" : "";
                        
                        const dfRes = await http_get(dflink, { "User-Agent": UA });
                        if (dfRes && dfRes.body) {
                            const dfDoc = await parseHtml(dfRes.body);
                            const sources = [];
                            const sourceButtons = dfDoc.querySelectorAll("a.maxbutton");
                            
                            for (const btn of sourceButtons) {
                                const href = btn.getAttribute("href");
                                const text = btn.textContent ? btn.textContent.trim() : "";
                                
                                if (!href || isBlockedButton(href)) continue;
                                
                                sources.push({
                                    url: href,
                                    source: getSourceName(href, text),
                                    quality: quality
                                });
                            }
                            
                            if (sources.length > 0) {
                                episodes.push(new Episode({
                                    name: "Play (" + quality + sizeStr + ")",
                                    url: JSON.stringify(sources),
                                    season: 1,
                                    episode: 1
                                }));
                            }
                        }
                    }
                    
                    if (episodes.length === 0) {
                        episodes.push(new Episode({
                            name: "Play",
                            url: JSON.stringify(dflinks.map(u => ({ url: u, source: "Quality" }))),
                            season: 1,
                            episode: 1
                        }));
                    }
                }
            }

            cb({
                success: true,
                data: {
                    title: title,
                    url: url,
                    posterUrl: fixUrl(poster, baseUrl),
                    type: isSeries ? "tvseries" : "movie",
                    year: year,
                    description: description,
                    episodes: episodes.length > 0 ? episodes : undefined
                }
            });
        } catch (e) {
            cb({ success: false, message: e.message });
        }
    }

    async function extractHubCloudStream(hubcloudUrl) {
        const streams = [];
        try {
            const res = await http_get(hubcloudUrl, { "User-Agent": UA });
            if (!res || !res.body) return streams;
            
            const bypassMatch = res.body.match(/gamerxyt\.com\/hubcloud\.php\?host=([^"&]+)&id=([^"&]+)&token=([^"&]+)/);
            if (bypassMatch) {
                const bypassUrl = `https://gamerxyt.com/hubcloud.php?host=${bypassMatch[1]}&id=${bypassMatch[2]}&token=${bypassMatch[3]}`;
                const bypassRes = await http_get(bypassUrl, { "User-Agent": UA });
                if (bypassRes && bypassRes.body) {
                    const s3Match = bypassRes.body.match(/(https:\/\/cdn\.fsl-buckets\.work\/[^?"\s]+)/);
                    if (s3Match) {
                        streams.push(new StreamResult({
                            url: s3Match[1],
                            quality: "1080",
                            source: "HubCloud [S3 Direct]"
                        }));
                    }
                    const fslMatch = bypassRes.body.match(/(https:\/\/hub\.yummy\.monster\/[^?"\s]+)/);
                    if (fslMatch) {
                        streams.push(new StreamResult({
                            url: fslMatch[1],
                            quality: "1080",
                            source: "HubCloud [FSL Server]"
                        }));
                    }
                    const pixelMatch = bypassRes.body.match(/(https:\/\/pixeldrain\.dev\/u\/[^\s"']+)/);
                    if (pixelMatch) {
                        streams.push(new StreamResult({
                            url: pixelMatch[1],
                            quality: "1080",
                            source: "HubCloud [PixelDrain]"
                        }));
                    }
                }
            }
        } catch (e) {}
        return streams;
    }

    async function loadStreams(url, cb) {
        try {
            let sources = [];
            
            try {
                sources = JSON.parse(url);
                if (!Array.isArray(sources)) sources = [sources];
            } catch (e) {
                sources = [{ url: url, source: "Direct" }];
            }

            const streams = [];
            
            for (const src of sources) {
                const sourceUrl = typeof src === "string" ? src : src.url;
                const sourceName = typeof src === "string" ? "Source" : (src.source || "Source");
                const quality = typeof src === "object" ? (src.quality || "Auto") : "Auto";
                
                if (!sourceUrl || !sourceUrl.startsWith("http")) continue;
                
                if (sourceUrl.includes("hubcloud")) {
                    const hubStreams = await extractHubCloudStream(sourceUrl);
                    if (hubStreams.length > 0) {
                        for (const s of hubStreams) {
                            s.quality = quality !== "Auto" ? quality : s.quality;
                            streams.push(s);
                        }
                    } else {
                        streams.push(new StreamResult({
                            url: sourceUrl,
                            quality: quality,
                            source: "HubCloud"
                        }));
                    }
                } else if (sourceUrl.includes("dflinks") || sourceUrl.includes("dudefilms")) {
                    try {
                        const res = await http_get(sourceUrl, { "User-Agent": UA });
                        if (res && res.body) {
                            const doc = await parseHtml(res.body);
                            const buttons = doc.querySelectorAll("a.maxbutton");
                            
                            for (const btn of buttons) {
                                const href = btn.getAttribute("href");
                                const text = btn.textContent ? btn.textContent.trim() : "";
                                
                                if (!href || isBlockedButton(href)) continue;
                                
                                const name = getSourceName(href, text);
                                const q = extractQuality(text) || quality;
                                const s = extractSize(text);
                                const sStr = s ? " [" + s + "]" : "";
                                
                                if (href.includes("hubcloud")) {
                                    const hubStreams = await extractHubCloudStream(href);
                                    for (const hs of hubStreams) {
                                        hs.quality = q !== "Auto" ? q : hs.quality;
                                        streams.push(hs);
                                    }
                                } else {
                                    streams.push(new StreamResult({
                                        url: href,
                                        quality: q,
                                        source: name + sStr
                                    }));
                                }
                            }
                        }
                    } catch (e) {}
                } else {
                    streams.push(new StreamResult({
                        url: sourceUrl,
                        quality: quality,
                        source: sourceName
                    }));
                }
            }

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, message: e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
