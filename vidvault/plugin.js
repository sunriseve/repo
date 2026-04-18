(function() {
    /**
     * VidVault Plugin for SkyStream
     * Uses TMDB API for metadata and VidVault for DDL links
     */

    const TMDB_API_KEYS = [
        "439c478a771f35c05022f9feabcca01c",
        "1865f43a0549ca50d341dd9ab8b29f49"
    ];
    const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
    const POSTER_SIZE = "w500";
    const BACKDROP_SIZE = "w1280";

    const VIDVAULT_BASE = "https://vidvault.ru";
    const VIDVAULT_API = "https://vidvault.ru/api";
    const VIDVAULT_DL = "https://dl.gemlelispe.workers.dev";

    const USER_AGENT = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

    let currentApiKeyIndex = 0;

    function getApiKey() {
        return TMDB_API_KEYS[currentApiKeyIndex];
    }

    function rotateApiKey() {
        currentApiKeyIndex = (currentApiKeyIndex + 1) % TMDB_API_KEYS.length;
        return getApiKey();
    }

    function getPosterUrl(path) {
        if (!path) return "";
        path = path.replace(/^\//, "");
        return "https://image.tmdb.org/t/p/" + POSTER_SIZE + "/" + path;
    }

    function getBackdropUrl(path) {
        if (!path) return "";
        path = path.replace(/^\//, "");
        return "https://image.tmdb.org/t/p/" + BACKDROP_SIZE + "/" + path;
    }

    function formatBytes(bytes) {
        if (bytes <= 0) return "0 B";
        const sizes = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(1) + " " + sizes[Math.min(i, sizes.length - 1)];
    }

    async function fetchVidVaultStreams(type, tmdbId, season, episode) {
        const streams = [];
        
        try {
            const tokenRes = await http_get(VIDVAULT_API + "/get-token", {
                headers: { "User-Agent": USER_AGENT }
            });
            const tokenData = JSON.parse(tokenRes.body);
            const requestToken = tokenData?.t || "";

            const bodyObj = {
                type: type,
                tmdbId: parseInt(tmdbId),
                season: season ? parseInt(season) : undefined,
                episode: episode ? parseInt(episode) : undefined
            };

            const downloadRes = await http_get(VIDVAULT_API + "/download-proxy?type=" + type + "&tmdbId=" + tmdbId + (season ? "&season=" + season : "") + (episode ? "&episode=" + episode : "") + "&token=" + requestToken, {
                headers: { 
                    "User-Agent": USER_AGENT,
                    "Content-Type": "application/json"
                }
            });

            const downloadData = JSON.parse(downloadRes.body);
            const extractData = downloadData?.extractData;
            const data = extractData?.data || extractData;

            if (data?.streams) {
                for (const stream of data.streams) {
                    streams.push(new StreamResult({
                        url: stream.url,
                        source: "VidVault",
                        quality: stream.resolution || stream.resolutions || "720p",
                        headers: { "User-Agent": USER_AGENT }
                    }));
                }
            }

            if (data?.downloads) {
                for (const dl of data.downloads) {
                    streams.push(new StreamResult({
                        url: dl.url,
                        source: "VidVault",
                        quality: dl.resolution || "720p",
                        headers: { "User-Agent": USER_AGENT }
                    }));
                }
            }

            const mkvData = downloadData?.mkvData;
            if (mkvData?.files?.[0]?.url) {
                streams.push(new StreamResult({
                    url: mkvData.files[0].url,
                    source: "VidVault",
                    quality: "480p",
                    format: "MKV",
                    headers: { "User-Agent": USER_AGENT }
                }));
            }
        } catch (e) {
            console.error("[VidVault] API Error:", e.message);
        }

        return streams;
    }

    function buildQueryString(params) {
        const pairs = [];
        for (const key in params) {
            pairs.push(encodeURIComponent(key) + "=" + encodeURIComponent(params[key]));
        }
        return pairs.join("&");
    }

    async function tmdbRequest(endpoint, params = {}) {
        const apiKey = getApiKey();
        const queryParams = { api_key: apiKey, ...params };
        const url = `https://api.themoviedb.org/3${endpoint}?${buildQueryString(queryParams)}`;

        try {
            const res = await http_get(url);
            if (res.status === 401) {
                rotateApiKey();
                return tmdbRequest(endpoint, params);
            }
            return JSON.parse(res.body);
        } catch (e) {
            console.error("TMDB Request Error:", e.message);
            return null;
        }
    }

    function extractQuality(text) {
        if (!text) return "";
        const qualities = ["2160p", "4K", "1440p", "1080p", "720p", "480p", "360p", "240p"];
        for (const q of qualities) {
            if (text.toLowerCase().includes(q)) return q.replace("4K", "2160p");
        }
        return "";
    }

    async function fetchVidVaultPage(url) {
        try {
            const res = await http_get(url, {
                headers: {
                    "User-Agent": USER_AGENT,
                    "Referer": VIDVAULT_BASE + "/",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5"
                }
            });
            return res.body;
        } catch (e) {
            console.error("VidVault fetch error:", e.message);
            return "";
        }
    }

    function parseDownloadLinks(html, baseUrl) {
        const streams = [];
        const qualityPattern = /(?:href|src|url)\s*[:=]\s*["']([^"']+\.(?:mp4|mkv|avi|mov|webm)[^"']*)["']|(\d{3,4}p?\s*[-–]?\s*(?:HEVC|x265|x264|H264|AAC|Dual|Multi)[^\n<]*)/gi;
        const linkPattern = /href\s*=\s*["']([^"']+)["']|>([^<]+(?:\d{3,4}p)[^<]*)/gi;

        const linkMatches = html.match(/(?:href|src)\s*=\s*["']([^"']+\.(?:mp4|mkv|avi|mov|webm|pdf)[^"']*)["']/gi);
        const qualityMatches = html.match(/\d{3,4}p[^\n<]*/gi);

        if (linkMatches) {
            linkMatches.forEach((match, idx) => {
                const urlMatch = match.match(/["']([^"']+)["']/);
                if (urlMatch && urlMatch[1]) {
                    let url = urlMatch[1];
                    if (url.startsWith("//")) {
                        url = "https:" + url;
                    } else if (url.startsWith("/")) {
                        url = VIDVAULT_BASE + url;
                    }

                    let quality = "720p";
                    if (qualityMatches && qualityMatches[idx]) {
                        quality = extractQuality(qualityMatches[idx]);
                    }

                    if (quality === "p") {
                        quality = "720p";
                    }

                    streams.push(new StreamResult({
                        url: url,
                        source: "VidVault",
                        quality: quality || "720p",
                        headers: {
                            "User-Agent": USER_AGENT,
                            "Referer": baseUrl || VIDVAULT_BASE + "/"
                        }
                    }));
                }
            });
        }

        const directLinks = html.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|mkv|avi|mov|webm)[^\s"'<>]*/g);
        if (directLinks) {
            directLinks.forEach(link => {
                if (!streams.some(s => s.url === link)) {
                    const quality = extractQuality(link);
                    streams.push(new StreamResult({
                        url: link,
                        source: "VidVault",
                        quality: quality || "720p",
                        headers: {
                            "User-Agent": USER_AGENT
                        }
                    }));
                }
            });
        }

        const patterns = [
            /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>.*?(\d{3,4}p)/gi,
            /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([^<]*\d{3,4}p[^<]*)/gi,
            /file:\s*["']([^"']+)["'][^}]*(?:label|title)\s*:\s*["']?(\d{3,4}p)/gi
        ];

        patterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                const url = match[1];
                const quality = match[2] || extractQuality(match[0]);
                if (url && (url.includes(".mp4") || url.includes(".mkv") || url.includes(".webm") || url.includes(".m3u8"))) {
                    if (!streams.some(s => s.url === url)) {
                        streams.push(new StreamResult({
                            url: url,
                            source: "VidVault",
                            quality: quality || "720p",
                            headers: {
                                "User-Agent": USER_AGENT,
                                "Referer": baseUrl || VIDVAULT_BASE + "/"
                            }
                        }));
                    }
                }
            }
        });

        if (streams.length === 0) {
            const iframeMatch = html.match(/iframe[^>]+src\s*=\s*["']([^"']+)["']/i);
            if (iframeMatch && iframeMatch[1]) {
                let iframeUrl = iframeMatch[1];
                if (iframeUrl.startsWith("//")) {
                    iframeUrl = "https:" + iframeUrl;
                }
                streams.push(new StreamResult({
                    url: iframeUrl,
                    source: "VidVault Embed",
                    quality: "Auto",
                    headers: {
                        "User-Agent": USER_AGENT,
                        "Referer": baseUrl || VIDVAULT_BASE + "/"
                    }
                }));
            }
        }

        return streams;
    }

    function toMediaItem(item, type) {
        const title = item.title || item.name || "Unknown";
        const id = item.id;
        const poster = item.poster_path || item.still_path;
        const backdrop = item.backdrop_path;

        const mediaType = type === "movie" ? "movie" : "series";
        const year = item.release_date ? parseInt(item.release_date.split("-")[0]) :
                   item.first_air_date ? parseInt(item.first_air_date.split("-")[0]) : 0;

        const score = item.vote_average ? Math.round(item.vote_average * 10) / 10 : 0;

        const category = mediaType === "movie" ? "movie" : "series";
        const url = category === "movie"
            ? `${VIDVAULT_BASE}/movie/${id}`
            : `${VIDVAULT_BASE}/tv/${id}`;

        return new MultimediaItem({
            title: title,
            url: url,
            posterUrl: getPosterUrl(poster),
            bannerUrl: getBackdropUrl(backdrop),
            type: mediaType,
            year: year,
            score: score,
            description: item.overview || "",
            syncData: { tmdb: String(id) }
        });
    }

    async function getHome(cb) {
        try {
            const homeData = {};

            const [
                trendingRes,
                popularMoviesRes,
                popularTvRes,
                topRatedMoviesRes,
                topRatedTvRes,
                upcomingRes,
                nowPlayingRes,
                onAirTvRes
            ] = await Promise.all([
                tmdbRequest("/trending/all/week", { language: "en-US" }),
                tmdbRequest("/movie/popular", { language: "en-US", page: 1 }),
                tmdbRequest("/tv/popular", { language: "en-US", page: 1 }),
                tmdbRequest("/movie/top_rated", { language: "en-US", page: 1 }),
                tmdbRequest("/tv/top_rated", { language: "en-US", page: 1 }),
                tmdbRequest("/movie/upcoming", { language: "en-US", page: 1 }),
                tmdbRequest("/movie/now_playing", { language: "en-US", page: 1 }),
                tmdbRequest("/tv/on_the_air", { language: "en-US", page: 1 })
            ]);

            if (trendingRes?.results?.length) {
                homeData["Trending"] = trendingRes.results.slice(0, 10).map(item => toMediaItem(item, item.media_type));
            }

            if (popularMoviesRes?.results?.length) {
                homeData["Popular Movies"] = popularMoviesRes.results.slice(0, 20).map(item => toMediaItem(item, "movie"));
            }

            if (popularTvRes?.results?.length) {
                homeData["Popular TV Shows"] = popularTvRes.results.slice(0, 20).map(item => toMediaItem(item, "tv"));
            }

            if (nowPlayingRes?.results?.length) {
                homeData["Now Playing"] = nowPlayingRes.results.slice(0, 10).map(item => toMediaItem(item, "movie"));
            }

            if (upcomingRes?.results?.length) {
                homeData["Upcoming Movies"] = upcomingRes.results.slice(0, 10).map(item => toMediaItem(item, "movie"));
            }

            if (onAirTvRes?.results?.length) {
                homeData["On TV"] = onAirTvRes.results.slice(0, 10).map(item => toMediaItem(item, "tv"));
            }

            if (topRatedMoviesRes?.results?.length) {
                homeData["Top Rated Movies"] = topRatedMoviesRes.results.slice(0, 20).map(item => toMediaItem(item, "movie"));
            }

            if (topRatedTvRes?.results?.length) {
                homeData["Top Rated TV"] = topRatedTvRes.results.slice(0, 20).map(item => toMediaItem(item, "tv"));
            }

            cb({ success: true, data: homeData });
        } catch (e) {
            console.error("getHome Error:", e);
            cb({ success: false, message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const res = await tmdbRequest("/search/multi", {
                language: "en-US",
                query: query,
                include_adult: false
            });

            if (!res?.results?.length) {
                cb({ success: true, data: [] });
                return;
            }

            const items = res.results
                .filter(item => item.media_type === "movie" || item.media_type === "tv")
                .slice(0, 30)
                .map(item => toMediaItem(item, item.media_type));

            cb({ success: true, data: items });
        } catch (e) {
            console.error("search Error:", e);
            cb({ success: false, message: e.message });
        }
    }

    async function load(url, cb) {
        try {
            const isMovie = url.includes("/movie/");
            const isTv = url.includes("/tv/");

            if (!isMovie && !isTv) {
                cb({ success: false, message: "Invalid URL format" });
                return;
            }

            const tmdbId = url.split("/").pop();
            const mediaType = isMovie ? "movie" : "tv";

            const [detailsRes, creditsRes, videosRes] = await Promise.all([
                tmdbRequest(`/${mediaType}/${tmdbId}`, { language: "en-US" }),
                tmdbRequest(`/${mediaType}/${tmdbId}/credits`, { language: "en-US" }),
                tmdbRequest(`/${mediaType}/${tmdbId}/videos`, { language: "en-US" })
            ]);

            if (!detailsRes) {
                cb({ success: false, message: "Failed to load metadata" });
                return;
            }

            const details = detailsRes;
            const title = details.title || details.name || "Unknown";
            const poster = details.poster_path;
            const backdrop = details.backdrop_path;
            const year = details.release_date ? parseInt(details.release_date.split("-")[0]) :
                         details.first_air_date ? parseInt(details.first_air_date.split("-")[0]) : 0;
            const score = details.vote_average ? Math.round(details.vote_average * 10) / 10 : 0;
            const description = details.overview || "";

            const genres = details.genres?.map(g => g.name) || [];

            const cast = (creditsRes?.cast || []).slice(0, 10).map(actor => new Actor({
                name: actor.name,
                role: actor.character,
                image: actor.profile_path ? getPosterUrl(actor.profile_path) : ""
            }));

            const trailers = (videosRes?.results || [])
                .filter(v => v.type === "Trailer" && v.site === "YouTube")
                .slice(0, 3)
                .map(v => new Trailer({
                    name: v.name || "Trailer",
                    url: `https://www.youtube.com/watch?v=${v.key}`
                }));

            const item = {
                title: title,
                url: url,
                posterUrl: getPosterUrl(poster),
                bannerUrl: getBackdropUrl(backdrop),
                type: mediaType,
                year: year,
                score: score,
                description: description,
                genres: genres,
                cast: cast,
                trailers: trailers,
                status: details.status === "Released" ? "completed" : "ongoing",
                playbackPolicy: "none",
                episodes: []
            };

            if (isMovie) {
                const movieUrl = `${VIDVAULT_BASE}/movie/${tmdbId}`;
                item.episodes = [
                    new Episode({
                        name: "Watch Movie",
                        url: movieUrl,
                        season: 1,
                        episode: 1,
                        streams: []
                    })
                ];
            } else {
                const episodesList = [];
                const seasons = details.seasons || [];

                for (const season of seasons) {
                    if (season.season_number === 0) continue;

                    const seasonDetail = await tmdbRequest(`/tv/${tmdbId}/season/${season.season_number}`, { language: "en-US" });

                    if (seasonDetail?.episodes?.length) {
                        for (const ep of seasonDetail.episodes) {
                            const epUrl = `${VIDVAULT_BASE}/tv/${tmdbId}/${season.season_number}/${ep.episode_number}`;

                            episodesList.push(new Episode({
                                name: `S${String(ep.season_number).padStart(2, "0")}E${String(ep.episode_number).padStart(2, "0")} - ${ep.name || "Episode " + ep.episode_number}`,
                                url: epUrl,
                                season: ep.season_number,
                                episode: ep.episode_number,
                                description: ep.overview,
                                posterUrl: ep.still_path ? getPosterUrl(ep.still_path) : getPosterUrl(poster),
                                airDate: ep.air_date,
                                rating: ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : 0,
                                runtime: ep.runtime || 0,
                                streams: []
                            }));
                        }
                    }
                }

                item.episodes = episodesList;
            }

            cb({ success: true, data: new MultimediaItem(item) });
        } catch (e) {
            console.error("load Error:", e);
            cb({ success: false, message: e.message });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const isMovie = url.includes("/movie/");
            const isTv = url.includes("/tv/");

            if (!isMovie && !isTv) {
                cb({ success: false, message: "Invalid URL format" });
                return;
            }

            const parts = url.split("/").filter(p => p);
            let vidvaultUrl = url;
            let tmdbId = parts[1];
            let season = isTv ? parseInt(parts[2]) : null;
            let episode = isTv ? parseInt(parts[3]) : null;
            let mediaType = isMovie ? "movie" : "tv";

            if (parts[0] === "movie" && parts[1]) {
                vidvaultUrl = `${VIDVAULT_BASE}/movie/${parts[1]}`;
            } else if (parts[0] === "tv" && parts[1] && parts[2] && parts[3]) {
                vidvaultUrl = `${VIDVAULT_BASE}/tv/${parts[1]}/${parts[2]}/${parts[3]}`;
            }

            console.log("[VidVault] Fetching streams from API:", vidvaultUrl);

            const streams = await fetchVidVaultStreams(mediaType, tmdbId, season, episode);

            if (streams.length === 0) {
                console.log("[VidVault] No streams from API, using direct URL");
                streams.push(new StreamResult({
                    url: vidvaultUrl,
                    source: "VidVault",
                    quality: "Auto",
                    headers: {
                        "User-Agent": USER_AGENT,
                        "Referer": VIDVAULT_BASE + "/"
                    }
                }));
            }

            console.log(`[VidVault] Found ${streams.length} stream(s)`);

            streams.sort((a, b) => {
                const qualA = parseInt(a.quality.replace("p", "")) || 0;
                const qualB = parseInt(b.quality.replace("p", "")) || 0;
                return qualB - qualA;
            });

            cb({ success: true, data: streams });
        } catch (e) {
            console.error("loadStreams Error:", e);
            cb({ success: false, message: e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
