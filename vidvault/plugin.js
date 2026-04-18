(function() {
    const API_KEY = "sk_ShuzW72PgYVS-faA9CP_nnKAUr87ln47";
    
    const USER_AGENT = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

    function getHeaders() {
        return {
            "x-api-key": API_KEY,
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json"
        };
    }

    async function apiRequest(endpoint, params = {}) {
        const url = new URL(manifest.baseUrl + endpoint);
        for (const key in params) {
            url.searchParams.append(key, params[key]);
        }
        
        const res = await http_get(url.toString(), { headers: getHeaders() });
        return JSON.parse(res.body);
    }

    function getPosterUrl(path) {
        if (!path) return "";
        if (path.startsWith("http")) return path;
        return "https://image.tmdb.org/t/p/w500" + path.replace(/^\//, "");
    }

    function toMediaItem(item, type) {
        const title = item.title || item.name || "Unknown";
        const id = item.id;
        const poster = item.poster_path || item.poster;
        const backdrop = item.backdrop_path;
        
        const mediaType = item.type === "movie" ? "movie" : type || "movie";
        const url = `skystream://load?id=${id}&source=kmmovies`;
        
        return new MultimediaItem({
            title: title,
            url: url,
            posterUrl: getPosterUrl(poster),
            bannerUrl: backdrop ? getPosterUrl(backdrop) : "",
            type: mediaType,
            year: item.year || (item.release_date ? parseInt(item.release_date.split("-")[0]) : 0),
            score: item.rating || item.vote_average || 0,
            description: item.synopsis || item.overview || "",
            syncData: { id: String(id), source: "kmmovies" }
        });
    }

    function isValidUrl(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    async function getHome(cb) {
        try {
            const homeData = {};
            
            const [moviesRes, netmirrorRes] = await Promise.all([
                apiRequest("/api/kmmovies"),
                apiRequest("/api/netmirror")
            ]);
            
            if (moviesRes?.data?.length) {
                homeData["Trending"] = moviesRes.data.slice(0, 10).map(item => toMediaItem(item, "movie"));
                homeData["Latest Movies"] = moviesRes.data.slice(10, 30).map(item => toMediaItem(item, "movie"));
            }
            
            if (netmirrorRes?.data?.length) {
                homeData["NetMirror"] = netmirrorRes.data.slice(0, 20).map(item => {
                    const itemCopy = Object.assign({}, item);
                    itemCopy.source = "netmirror";
                    return toMediaItem(itemCopy, "movie");
                });
            }
            
            cb({ success: true, data: homeData });
        } catch (e) {
            console.error("getHome Error:", e);
            cb({ success: false, message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const [moviesRes, netmirrorRes] = await Promise.all([
                apiRequest("/api/kmmovies/search", { q: query }),
                apiRequest("/api/netmirror/search", { q: query })
            ]);
            
            const items = [];
            const seen = new Set();
            
            if (moviesRes?.data?.length) {
                moviesRes.data.forEach(item => {
                    if (!seen.has(item.id)) {
                        seen.add(item.id);
                        items.push(toMediaItem(item, "movie"));
                    }
                });
            }
            
            if (netmirrorRes?.data?.length) {
                netmirrorRes.data.forEach(item => {
                    if (!seen.has(item.id)) {
                        seen.add(item.id);
                        const itemCopy = Object.assign({}, item);
                        itemCopy.source = "netmirror";
                        items.push(toMediaItem(itemCopy, "movie"));
                    }
                });
            }
            
            cb({ success: true, data: items.slice(0, 30) });
        } catch (e) {
            console.error("search Error:", e);
            cb({ success: false, message: e.message });
        }
    }

    async function load(url, cb) {
        try {
            let id, source;
            
            if (url.startsWith("skystream://")) {
                const urlStr = url.replace("skystream://", "");
                const params = new URLSearchParams(urlStr);
                id = params.get("id");
                source = params.get("source") || "kmmovies";
            } else if (isValidUrl(url)) {
                const urlObj = new URL(url);
                id = urlObj.searchParams.get("id");
                source = urlObj.searchParams.get("source") || "kmmovies";
            } else {
                id = url;
                source = "kmmovies";
            }
            
            let detailsRes;
            if (source === "netmirror") {
                detailsRes = await apiRequest("/api/netmirror/getpost", { id: id });
            } else {
                detailsRes = await apiRequest("/api/kmmovies/details", { id: id });
            }
            
            if (!detailsRes?.data) {
                cb({ success: false, message: "Item not found" });
                return;
            }
            
            const item = detailsRes.data;
            
            const episodes = [];
            
            if (item.episodes?.length) {
                item.episodes.forEach(ep => {
                    episodes.push(new Episode({
                        name: ep.title || ep.name || `Episode ${ep.number}`,
                        url: "skystream://stream?id=" + id + "&source=" + source + "&episode=" + ep.number,
                        season: ep.season || 1,
                        episode: ep.number || 1,
                        description: ep.synopsis || "",
                        posterUrl: ep.poster ? getPosterUrl(ep.poster) : getPosterUrl(item.poster),
                        airDate: ep.airDate || "",
                        streams: []
                    }));
                });
            } else {
                episodes.push(new Episode({
                    name: "Watch Now",
                    url: "skystream://stream?id=" + id + "&source=" + source,
                    season: 1,
                    episode: 1,
                    streams: []
                }));
            }
            
            const multimediaItem = new MultimediaItem({
                title: item.title || item.name || "Unknown",
                url: url,
                posterUrl: getPosterUrl(item.poster_path || item.poster),
                bannerUrl: getPosterUrl(item.backdrop_path),
                type: item.type === "movie" ? "movie" : "movie",
                year: item.year || (item.release_date ? parseInt(item.release_date.split("-")[0]) : 0),
                score: item.rating || item.vote_average || 0,
                description: item.synopsis || item.overview || "",
                genres: item.genres || [],
                status: "completed",
                playbackPolicy: "none",
                episodes: episodes
            });
            
            cb({ success: true, data: multimediaItem });
        } catch (e) {
            console.error("load Error:", e);
            cb({ success: false, message: e.message });
        }
    }

    async function loadStreams(url, cb) {
        try {
            let id, source;
            
            if (url.startsWith("skystream://")) {
                let urlStr = url.replace("skystream://stream", "").replace("skystream://load", "");
                if (urlStr.startsWith("?")) {
                    urlStr = urlStr.substring(1);
                }
                const params = new URLSearchParams(urlStr);
                id = params.get("id");
                source = params.get("source") || "kmmovies";
            } else if (isValidUrl(url)) {
                const urlObj = new URL(url);
                id = urlObj.searchParams.get("id");
                source = urlObj.searchParams.get("source") || "kmmovies";
            } else {
                id = url;
                source = "kmmovies";
            }
            
            let streams = [];
            
            if (source === "netmirror") {
                const streamRes = await apiRequest("/api/netmirror/stream", { id: id });
                if (streamRes?.data?.streams) {
                    streams = streamRes.data.streams.map(s => new StreamResult({
                        url: s.url,
                        quality: s.quality || "Auto",
                        headers: { "Referer": manifest.baseUrl }
                    }));
                }
            } else {
                const magicRes = await apiRequest("/api/kmmovies/magiclinks", { id: id });
                if (magicRes?.data?.length) {
                    streams = magicRes.data.map(s => new StreamResult({
                        url: s.url,
                        quality: s.quality || "720p",
                        headers: { "Referer": manifest.baseUrl }
                    }));
                }
            }
            
            if (streams.length === 0) {
                streams.push(new StreamResult({
                    url: manifest.baseUrl + "/api/kmmovies/magiclinks?id=" + id,
                    quality: "Auto",
                    headers: { "Referer": manifest.baseUrl }
                }));
            }
            
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