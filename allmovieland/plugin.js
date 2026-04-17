(function() {
    const BASE_URL = manifest && manifest.baseUrl ? manifest.baseUrl : "https://allmovieland.you";
    
    const DEFAULT_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    };

    function fixUrl(url) {
        if (!url) return "";
        if (url.startsWith("http")) return url;
        if (url.startsWith("//")) return "https:" + url;
        if (url.startsWith("/")) return BASE_URL + url;
        return BASE_URL + "/" + url;
    }

    function getQuality(text) {
        if (!text) return "Auto";
        const l = text.toLowerCase();
        if (l.includes("2160p") || l.includes("4k")) return "2160p";
        if (l.includes("1080p")) return "1080p";
        if (l.includes("720p")) return "720p";
        if (l.includes("480p")) return "480p";
        if (l.includes("360p")) return "360p";
        return "Auto";
    }

    function cleanTitle(title) {
        if (!title) return "";
        return String(title).replace(/\s*\(\d{4}\)\s*/g, "").replace("Download", "").trim();
    }

    function parseItemFromCard(card) {
        const anchor = card.querySelector("a");
        if (!anchor) return null;
        
        const href = anchor.getAttribute("href") || "";
        if (!href || href.includes("javascript")) return null;
        
        const titleEl = card.querySelector("h3") || card.querySelector("h2") || card.querySelector("h4") || card.querySelector(".title") || anchor;
        let title = titleEl ? (titleEl.textContent || "").trim() : "";
        title = cleanTitle(title);
        if (!title) return null;
        
        const img = card.querySelector("img");
        let poster = "";
        if (img) {
            poster = img.getAttribute("data-src") || img.getAttribute("src") || "";
        }
        
        const typeSpan = card.querySelector(".new-short__cats") || card.querySelector(".cats") || card.querySelector(".type");
        let typeText = typeSpan ? typeSpan.textContent || "" : "";
        
        let mediaType = "movie";
        if (typeText.toLowerCase().includes("series") || href.includes("/series/")) {
            mediaType = "tvseries";
        }
        
        return new MultimediaItem({
            title: title,
            url: fixUrl(href),
            posterUrl: fixUrl(poster),
            type: mediaType
        });
    }

    async function getHome(cb) {
        try {
            const sections = [
                { name: "Movies", path: "/films/" },
                { name: "Bollywood Movies", path: "/bollywood/" },
                { name: "Hollywood Movies", path: "/hollywood/" },
                { name: "TV Shows", path: "/series/" },
                { name: "Cartoons", path: "/cartoon/" }
            ];

            const homeData = {};
            
            for (const section of sections) {
                try {
                    const url = BASE_URL + section.path;
                    const res = await http_get(url, DEFAULT_HEADERS);
                    if (!res || !res.body) continue;
                    
                    const doc = await parseHtml(res.body);
                    const cards = doc.querySelectorAll("article.short-mid, .short-mid, article[class*='short'], div[class*='short']");
                    
                    const items = [];
                    for (const card of cards) {
                        const item = parseItemFromCard(card);
                        if (item) items.push(item);
                        if (items.length >= 20) break;
                    }
                    
                    if (items.length > 0) {
                        homeData[section.name] = items;
                    }
                } catch (e) {
                    console.error(`[AllMovieLand] Error in ${section.name}:`, e.message);
                }
            }

            cb({ success: true, data: homeData });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const encoded = encodeURIComponent(query);
            const searchUrls = [
                BASE_URL + "/?do=search&subaction=search&search_start=1&full_search=1&story=" + encoded,
                BASE_URL + "/index.php?do=search&subaction=search&search_start=0&full_search=1&result_from=1&story=" + encoded,
                BASE_URL + "/search/" + encoded + "/"
            ];
            
            let results = [];
            
            for (const searchUrl of searchUrls) {
                try {
                    const headers = {
                        ...DEFAULT_HEADERS,
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Referer": BASE_URL + "/"
                    };
                    
                    let res;
                    if (searchUrl.includes("index.php")) {
                        const body = "do=search&subaction=search&search_start=0&full_search=1&result_from=1&story=" + encoded;
                        res = await http_post(searchUrl, headers, body);
                    } else {
                        res = await http_get(searchUrl, headers);
                    }
                    
                    if (!res || !res.body) continue;
                    
                    const doc = await parseHtml(res.body);
                    const cards = doc.querySelectorAll("article.short-mid, .short-mid, article[class*='short'], div[class*='short'], .search-item, .result-item, .movie-item");
                    
                    for (const card of cards) {
                        const item = parseItemFromCard(card);
                        if (item && item.title && item.title.length > 1) {
                            results.push(item);
                        }
                        if (results.length >= 30) break;
                    }
                    
                    if (results.length > 0) break;
                } catch (e) {
                    console.error(`[AllMovieLand] Search URL failed: ${searchUrl}`, e.message);
                }
            }

            cb({ success: true, data: results });
        } catch (e) {
            console.error("[AllMovieLand] Search error:", e.message);
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    function extractPlayerDomain(html) {
        const match = html.match(/AwsIndStreamDomain\s*=\s*['"]([^'"]+)['"]/);
        return match ? match[1] : null;
    }

    function extractId(html) {
        const patterns = [
            /src\s*:\s*['"]?([^'"]+\/play\/(\d+))['"]?/,
            /playerId\s*[=:]\s*['"]?(\d+)/,
            /\/play\/(\d+)/,
        ];
        
        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) return match[2] || match[1];
        }
        return null;
    }

    async function load(url, cb) {
        try {
            const res = await http_get(url, DEFAULT_HEADERS);
            if (!res || !res.body) {
                return cb({ success: false, errorCode: "LOAD_ERROR", message: "Failed to load page" });
            }

            const doc = await parseHtml(res.body);
            
            const titleEl = doc.querySelector("h1.fs__title") || doc.querySelector("h1");
            let title = titleEl ? (titleEl.textContent || "").trim() : "Unknown";
            title = cleanTitle(title);
            
            const posterEl = doc.querySelector("img.fs__poster-img") || doc.querySelector("meta[property='og:image']");
            const poster = posterEl ? (posterEl.getAttribute("content") || posterEl.getAttribute("src") || "") : "";
            
            const descEl = doc.querySelector("div.fs__descr--text") || doc.querySelector(".description");
            const description = descEl ? (descEl.textContent || "").trim() : "";
            
            const yearMatch = title.match(/\((\d{4})\)/);
            const year = yearMatch ? parseInt(yearMatch[1]) : null;
            
            const ratingEl = doc.querySelector("b.imdb__value") || doc.querySelector(".rating");
            const ratingStr = ratingEl ? (ratingEl.textContent || "").replace(",", ".") : "";
            const rating = ratingStr ? parseFloat(ratingStr) : null;
            
            const genreEls = doc.querySelectorAll("div.xfs__item--value[itemprop='genre'] a, .genre a");
            const genres = Array.from(genreEls).map(el => (el.textContent || "").trim()).filter(Boolean);
            
            const isSeries = genres.some(g => g.toLowerCase().includes("series")) || url.includes("/series/");
            const mediaType = isSeries ? "tvseries" : "movie";
            
            const playerDomain = extractPlayerDomain(res.body);
            const mediaId = extractId(res.body);
            
            const episodes = [];
            
            if (isSeries && playerDomain && mediaId) {
                const embedUrl = playerDomain + "/play/" + mediaId;
                
                try {
                    const embedRes = await http_get(embedUrl, Object.assign({}, DEFAULT_HEADERS, { "Referer": url }));
                    if (embedRes && embedRes.body) {
                        const scriptMatch = embedRes.body.match(/player\.src\(['"]([^'"]+)['"]/);
                        if (scriptMatch) {
                            const streamUrl = scriptMatch[1];
                            episodes.push(new Episode({
                                name: "Episode 1",
                                url: JSON.stringify({ playerDomain, mediaId, streamUrl }),
                                season: 1,
                                episode: 1
                            }));
                        }
                    }
                } catch (e) {
                    console.error("[AllMovieLand] Episode fetch error:", e.message);
                }
            } else if (!isSeries && playerDomain && mediaId) {
                const streamPayload = {
                    playerDomain: playerDomain,
                    mediaId: mediaId
                };
                
                episodes.push(new Episode({
                    name: "Watch Movie",
                    url: JSON.stringify(streamPayload),
                    season: 1,
                    episode: 1
                }));
            }

            const result = new MultimediaItem({
                title: title,
                url: url,
                posterUrl: fixUrl(poster),
                type: mediaType,
                description: description,
                year: year,
                score: rating ? rating / 10 : null,
                genres: genres.length > 0 ? genres : undefined,
                episodes: episodes.length > 0 ? episodes : undefined
            });

            cb({ success: true, data: result });
        } catch (e) {
            console.error("[AllMovieLand] Load error:", e.message);
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    async function loadStreams(url, cb) {
        try {
            let payload;
            try {
                payload = JSON.parse(url);
            } catch (e) {
                return cb({ success: false, errorCode: "STREAM_ERROR", message: "Invalid stream data" });
            }

            const streams = [];
            
            if (payload.streamUrl && payload.streamUrl.startsWith("http")) {
                streams.push(new StreamResult({
                    url: payload.streamUrl,
                    quality: "Auto",
                    source: "AllMovieLand",
                    headers: { "Referer": BASE_URL + "/" }
                }));
            }
            
            if (payload.playerDomain && payload.mediaId) {
                const headers = {
                    "Referer": BASE_URL + "/",
                    "User-Agent": DEFAULT_HEADERS["User-Agent"]
                };
                
                streams.push(new StreamResult({
                    url: payload.playerDomain + "/v/" + payload.mediaId + ".m3u8",
                    quality: "Auto",
                    source: "AllMovieLand HLS",
                    headers: headers
                }));
            }

            cb({ success: true, data: streams });
        } catch (e) {
            console.error("[AllMovieLand] Streams error:", e.message);
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
