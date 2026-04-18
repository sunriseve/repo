(function() {
    const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
    const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
    const POSTER_SIZE = "w500";
    const BACKDROP_SIZE = "w1280";
    
    const USER_AGENT = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

    function getPosterUrl(path) {
        if (!path) return "";
        path = path.replace(/^\//, "");
        return TMDB_IMAGE_BASE + "/" + POSTER_SIZE + "/" + path;
    }

    function getBackdropUrl(path) {
        if (!path) return "";
        path = path.replace(/^\//, "");
        return TMDB_IMAGE_BASE + "/" + BACKDROP_SIZE + "/" + path;
    }

    async function tmdbRequest(endpoint, params = {}) {
        const queryParams = { api_key: TMDB_API_KEY, ...params };
        const url = "https://api.themoviedb.org/3" + endpoint + "?" + new URLSearchParams(queryParams);
        
        const res = await http_get(url, { headers: { "User-Agent": USER_AGENT } });
        return JSON.parse(res.body);
    }

    function toMediaItem(item) {
        const mediaType = item.media_type === "movie" ? "movie" : 
                      item.media_type === "tv" ? "series" : "movie";
        
        const tmdbId = item.id;
        const url = mediaType === "movie" 
            ? "skystream://movie/" + tmdbId 
            : "skystream://tv/" + tmdbId;
        
        return new MultimediaItem({
            title: item.title || item.name || "Unknown",
            url: url,
            posterUrl: getPosterUrl(item.poster_path),
            bannerUrl: getBackdropUrl(item.backdrop_path),
            type: mediaType,
            year: item.release_date ? parseInt(item.release_date.split("-")[0]) :
                  item.first_air_date ? parseInt(item.first_air_date.split("-")[0]) : 0,
            score: item.vote_average ? Math.round(item.vote_average * 10) / 10 : 0,
            description: item.overview || "",
            syncData: { tmdb: String(tmdbId) }
        });
    }

    async function getHome(cb) {
        try {
            const homeData = {};
            
            const [trendingRes, popularMoviesRes, popularTvRes, topRatedMoviesRes, topRatedTvRes] = await Promise.all([
                tmdbRequest("/trending/all/week", { language: "en-US" }),
                tmdbRequest("/movie/popular", { language: "en-US", page: 1 }),
                tmdbRequest("/tv/popular", { language: "en-US", page: 1 }),
                tmdbRequest("/movie/top_rated", { language: "en-US", page: 1 }),
                tmdbRequest("/tv/top_rated", { language: "en-US", page: 1 })
            ]);
            
            if (trendingRes?.results?.length) {
                homeData["Trending"] = trendingRes.results.slice(0, 10).map(toMediaItem);
            }
            
            if (popularMoviesRes?.results?.length) {
                homeData["Popular Movies"] = popularMoviesRes.results.slice(0, 20).map(toMediaItem);
            }
            
            if (popularTvRes?.results?.length) {
                homeData["Popular TV Shows"] = popularTvRes.results.slice(0, 20).map(toMediaItem);
            }
            
            if (topRatedMoviesRes?.results?.length) {
                homeData["Top Rated Movies"] = topRatedMoviesRes.results.slice(0, 20).map(toMediaItem);
            }
            
            if (topRatedTvRes?.results?.length) {
                homeData["Top Rated TV"] = topRatedTvRes.results.slice(0, 20).map(toMediaItem);
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
                .map(toMediaItem);
            
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
            
            const parts = url.split("/").filter(p => p);
            const tmdbId = parts[1];
            const mediaType = isMovie ? "movie" : "tv";
            
            const [detailsRes, creditsRes, videosRes] = await Promise.all([
                tmdbRequest("/" + mediaType + "/" + tmdbId, { language: "en-US" }),
                tmdbRequest("/" + mediaType + "/" + tmdbId + "/credits", { language: "en-US" }),
                tmdbRequest("/" + mediaType + "/" + tmdbId + "/videos", { language: "en-US" })
            ]);
            
            if (!detailsRes) {
                cb({ success: false, message: "Failed to load metadata" });
                return;
            }
            
            const details = detailsRes;
            const title = details.title || details.name || "Unknown";
            
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
                    url: "https://www.youtube.com/watch?v=" + v.key
                }));
            
            const episodes = [];
            
            if (isMovie) {
                episodes.push(new Episode({
                    name: "Watch Movie",
                    url: "skystream://stream/" + tmdbId + "/1/1",
                    season: 1,
                    episode: 1,
                    streams: []
                }));
            } else {
                const seasons = details.seasons || [];
                
                for (const season of seasons) {
                    if (season.season_number === 0) continue;
                    
                    const seasonDetail = await tmdbRequest("/tv/" + tmdbId + "/season/" + season.season_number, { language: "en-US" });
                    
                    if (seasonDetail?.episodes?.length) {
                        for (const ep of seasonDetail.episodes) {
                            episodes.push(new Episode({
                                name: "S" + String(ep.season_number).padStart(2, "0") + "E" + String(ep.episode_number).padStart(2, "0"),
                                url: "skystream://stream/" + tmdbId + "/" + ep.season_number + "/" + ep.episode_number,
                                season: ep.season_number,
                                episode: ep.episode_number,
                                description: ep.overview,
                                posterUrl: ep.still_path ? getPosterUrl(ep.still_path) : getPosterUrl(details.poster_path),
                                airDate: ep.air_date,
                                rating: ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : 0,
                                runtime: ep.runtime || 0,
                                streams: []
                            }));
                        }
                    }
                }
            }
            
            const multimediaItem = new MultimediaItem({
                title: title,
                url: url,
                posterUrl: getPosterUrl(details.poster_path),
                bannerUrl: getBackdropUrl(details.backdrop_path),
                type: mediaType === "movie" ? "movie" : "series",
                year: details.release_date ? parseInt(details.release_date.split("-")[0]) :
                      details.first_air_date ? parseInt(details.first_air_date.split("-")[0]) : 0,
                score: details.vote_average ? Math.round(details.vote_average * 10) / 10 : 0,
                description: details.overview || "",
                genres: genres,
                cast: cast,
                trailers: trailers,
                status: details.status === "Released" ? "completed" : "ongoing",
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
            const parts = url.split("/").filter(p => p);
            const tmdbId = parts[1];
            const season = parts[2] ? parseInt(parts[2]) : null;
            const episode = parts[3] ? parseInt(parts[3]) : null;
            
            const isMovie = url.includes("/movie/");
            const isTv = url.includes("/tv/");
            const mediaType = isMovie ? "movie" : "tv";
            
            const streamUrl = manifest.baseUrl + "/stream?id=" + tmdbId + "&type=" + mediaType + 
                          (season ? "&season=" + season : "") + 
                          (episode ? "&episode=" + episode : "");
            
            const streams = [
                new StreamResult({
                    url: streamUrl,
                    quality: "Auto",
                    headers: { "User-Agent": USER_AGENT }
                })
            ];
            
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