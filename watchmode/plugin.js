(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    const WATCHMODE_API = "https://api.watchmode.com/v1";
    const TMDB_API = "https://api.themoviedb.org/3";
    const WATCHMODE_KEY = "88uVsfUYsL7VwyegVGFipHnTXxde7l5qHraX6IXq";
    const TMDB_KEY = "439c478a771f35c05022f9feabcca01c";

    const SOURCE_TYPE_LABELS = {
        "sub": "Subscription",
        "free": "Free",
        "rent": "Rent",
        "buy": "Buy",
        "tv_everywhere": "TV Everywhere"
    };

    function buildQueryString(params) {
        const parts = [];
        for (const key in params) {
            const value = params[key];
            if (value !== undefined && value !== null) {
                if (Array.isArray(value)) {
                    value.forEach(v => parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(v)));
                } else {
                    parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
                }
            }
        }
        return parts.join("&");
    }

    async function watchmodeFetch(endpoint, params = {}) {
        const allParams = { apiKey: WATCHMODE_KEY, ...params };
        const queryString = buildQueryString(allParams);
        const url = `${WATCHMODE_API}${endpoint}?${queryString}`;
        const res = await http_get(url);
        if (!res.body) throw new Error("Empty response from WatchMode");
        return JSON.parse(res.body);
    }

    async function tmdbFetch(endpoint, params = {}) {
        const allParams = { api_key: TMDB_KEY, ...params };
        const queryString = buildQueryString(allParams);
        const url = `${TMDB_API}${endpoint}?${queryString}`;
        const res = await http_get(url);
        if (!res.body) throw new Error("Empty response from TMDB");
        return JSON.parse(res.body);
    }

    function toMultimediaItem(result, region = "US") {
        if (!result) return null;
        const isMovie = result.type === "movie" || result.type === "tv_movie";
        return new MultimediaItem({
            title: result.title || result.name || "Unknown Title",
            url: String(result.id),
            posterUrl: result.poster || result.poster_url || null,
            type: isMovie ? "movie" : "series",
            year: result.year ? parseInt(result.year) : undefined,
            score: result.user_rating || result.vote_average || undefined,
            description: result.plot_overview || result.overview || undefined,
            syncData: {
                watchmode: result.id,
                tmdb: result.tmdb_id || result.tmdbId,
                imdb: result.imdb_id || result.imdbId
            }
        });
    }

    async function getTmdbImages(tmdbId, type) {
        if (!tmdbId) return {};
        try {
            const endpoint = type === "movie" ? `/movie/${tmdbId}/images` : `/tv/${tmdbId}/images`;
            const data = await tmdbFetch(endpoint);
            return {
                posterUrl: data.posters?.[0] ? `https://image.tmdb.org/t/p/w500${data.posters[0].file_path}` : null,
                backdrop: data.backdrops?.[0] ? `https://image.tmdb.org/t/p/original${data.backdrops[0].file_path}` : null,
                logo: data.logos?.find(l => l.iso_639_1 === "en") ? `https://image.tmdb.org/t/p/w500${data.logos.find(l => l.iso_639_1 === "en").file_path}` : (data.logos?.[0] ? `https://image.tmdb.org/t/p/w500${data.logos[0].file_path}` : null)
            };
        } catch (e) {
            return {};
        }
    }

    async function getTmdbDetails(tmdbId, type) {
        if (!tmdbId) return {};
        try {
            const endpoint = type === "movie" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
            const data = await tmdbFetch(endpoint, { language: "en-US" });
            return {
                backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null,
                logo: null,
                runtime: data.runtime || data.episode_run_time?.[0] || null,
                status: data.status?.toLowerCase() === "returning series" ? "ongoing" : "completed",
                tagline: data.tagline || null,
                cast: (data.credits?.cast || []).slice(0, 10).map(c => new Actor({
                    name: c.name,
                    role: c.character,
                    image: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null
                })).filter(a => a.name)
            };
        } catch (e) {
            return {};
        }
    }

    async function getTmdbTrailers(tmdbId, type) {
        if (!tmdbId) return [];
        try {
            const endpoint = type === "movie" ? `/movie/${tmdbId}/videos` : `/tv/${tmdbId}/videos`;
            const data = await tmdbFetch(endpoint);
            return (data.results || [])
                .filter(v => v.site === "YouTube" && v.type === "Trailer")
                .slice(0, 3)
                .map(v => new Trailer({
                    name: v.name || "Trailer",
                    url: `https://www.youtube.com/watch?v=${v.key}`
                }));
        } catch (e) {
            return [];
        }
    }

    async function getTmdbSimilar(tmdbId, type) {
        if (!tmdbId) return [];
        try {
            const endpoint = type === "movie" ? `/movie/${tmdbId}/similar` : `/tv/${tmdbId}/similar`;
            const data = await tmdbFetch(endpoint, { language: "en-US", page: 1 });
            return (data.results || [])
                .slice(0, 10)
                .map(m => new MultimediaItem({
                    title: m.title || m.name,
                    url: String(m.id),
                    posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
                    type: type,
                    year: m.release_date ? new Date(m.release_date).getFullYear() : (m.first_air_date ? new Date(m.first_air_date).getFullYear() : undefined),
                    score: m.vote_average ? m.vote_average / 2 : undefined,
                    syncData: { tmdb: m.id }
                }));
        } catch (e) {
            return [];
        }
    }

    async function getHome(cb) {
        try {
            const home = {};
            
            const moviesUrl = `${WATCHMODE_API}/list-titles/?apiKey=${WATCHMODE_KEY}&types=movie&sort_by=popularity_desc&regions=US&limit=20&sourceTypes=sub,free`;
            const tvUrl = `${WATCHMODE_API}/list-titles/?apiKey=${WATCHMODE_KEY}&types=tv&sort_by=popularity_desc&regions=US&limit=20&sourceTypes=sub,free`;
            
            const [moviesRes, tvRes] = await Promise.all([
                http_get(moviesUrl).then(r => JSON.parse(r.body)),
                http_get(tvUrl).then(r => JSON.parse(r.body))
            ]);

            const trendingMovies = (moviesRes.titles || []).slice(0, 15).map(m => toMultimediaItem(m));
            const trendingTv = (tvRes.titles || []).slice(0, 15).map(m => toMultimediaItem(m));

            if (trendingMovies.length > 0) {
                home["Trending Movies"] = trendingMovies;
            }
            if (trendingTv.length > 0) {
                home["Trending TV Shows"] = trendingTv;
            }

            // Fetch additional free content
            try {
                const freeUrl = `${WATCHMODE_API}/list-titles/?apiKey=${WATCHMODE_KEY}&types=movie,tv&sort_by=release_date_desc&regions=US&limit=20&sourceTypes=free`;
                const freeRes = await http_get(freeUrl).then(r => JSON.parse(r.body));
                const freeItems = (freeRes.titles || []).slice(0, 15).map(m => toMultimediaItem(m));
                if (freeItems.length > 0) {
                    home["Free to Watch"] = freeItems;
                }
            } catch (e) {}

            cb({ success: true, data: home });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            const res = await watchmodeFetch("/search/", {
                search_field: "name",
                search_value: query,
                types: "movie,tv"
            });

            const results = (res.title_results || []).map(m => toMultimediaItem(m));
            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    async function load(url, cb) {
        try {
            const watchmodeId = url;
            const details = await watchmodeFetch(`/title/${watchmodeId}/details/`, {
                append_to_response: "sources,seasons,episodes"
            });

            if (!details || !details.id) {
                return cb({ success: false, message: "Title not found" });
            }

            const isMovie = details.type === "movie" || details.type === "tv_movie";
            const tmdbId = details.tmdb_id;
            const tmdbType = details.tmdb_type || (isMovie ? "movie" : "tv");

            // Fetch enhanced data from TMDB in parallel
            const [tmdbImages, tmdbDetails, trailers, similar] = await Promise.all([
                getTmdbImages(tmdbId, tmdbType),
                getTmdbDetails(tmdbId, tmdbType),
                getTmdbTrailers(tmdbId, tmdbType),
                getTmdbSimilar(tmdbId, tmdbType)
            ]);

            const posterUrl = tmdbImages.posterUrl || details.poster || details.posterMedium || details.posterLarge;
            const backdrop = tmdbImages.backdrop || details.backdrop;
            const logoUrl = tmdbImages.logo;

            const result = new MultimediaItem({
                title: details.title || details.original_title || "Unknown",
                url: url,
                posterUrl: posterUrl,
                bannerUrl: backdrop,
                logoUrl: logoUrl,
                type: isMovie ? "movie" : "series",
                year: details.year ? parseInt(details.year) : undefined,
                score: details.user_rating ? details.user_rating / 2 : (details.critic_score ? details.critic_score / 10 : undefined),
                description: details.plot_overview || tmdbDetails.tagline,
                status: tmdbDetails.status || (details.type === "tv_series" ? "ongoing" : "completed"),
                duration: tmdbDetails.runtime || details.runtime_minutes,
                contentRating: details.us_rating,
                cast: tmdbDetails.cast || [],
                trailers: trailers,
                recommendations: similar,
                syncData: {
                    watchmode: details.id,
                    tmdb: tmdbId,
                    imdb: details.imdb_id
                }
            });

            // Add episodes for TV series
            if (!isMovie && details.episodes && details.episodes.length > 0) {
                result.episodes = details.episodes.map(ep => new Episode({
                    name: ep.name || `Episode ${ep.episode_number}`,
                    url: JSON.stringify({
                        watchmodeId: details.id,
                        episodeId: ep.id,
                        tmdbId: ep.tmdb_id,
                        season: ep.season_number,
                        episode: ep.episode_number
                    }),
                    season: ep.season_number,
                    episode: ep.episode_number,
                    posterUrl: ep.thumbnail_url || posterUrl,
                    description: ep.overview,
                    runtime: ep.runtime_minutes,
                    airDate: ep.release_date
                }));
            }

            // Add seasons info
            if (!isMovie && details.seasons && details.seasons.length > 0) {
                result.seasonCount = details.seasons.length;
                result.seasons = details.seasons.map(s => ({
                    number: s.number,
                    name: s.name,
                    posterUrl: s.poster_url,
                    episodeCount: s.episode_count,
                    airDate: s.air_date
                }));
            }

            // Add available sources summary
            if (details.sources && details.sources.length > 0) {
                const sourcesSummary = {};
                details.sources.forEach(src => {
                    const key = `${src.name} (${SOURCE_TYPE_LABELS[src.type] || src.type})`;
                    sourcesSummary[key] = src.web_url;
                });
                result.sourcesInfo = sourcesSummary;
            }

            cb({ success: true, data: result });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    async function loadStreams(url, cb) {
        try {
            let watchmodeId, episodeId, tmdbId, season, episode;
            
            try {
                const parsed = JSON.parse(url);
                if (typeof parsed === 'object' && parsed !== null && parsed.watchmodeId) {
                    watchmodeId = String(parsed.watchmodeId);
                    episodeId = parsed.episodeId;
                    tmdbId = parsed.tmdbId;
                    season = parsed.season;
                    episode = parsed.episode;
                } else {
                    watchmodeId = String(parsed);
                }
            } catch (e) {
                watchmodeId = String(url);
            }

            let sourcesList = [];
            
            if (episodeId) {
                const details = await watchmodeFetch(`/title/${watchmodeId}/details/`, {
                    append_to_response: "episodes"
                });
                const episodeData = (details.episodes || []).find(ep => ep.id === parseInt(episodeId));
                if (episodeData && episodeData.sources) {
                    sourcesList = episodeData.sources;
                }
            } else {
                const sourcesUrl = `${WATCHMODE_API}/title/${watchmodeId}/sources/?apiKey=${WATCHMODE_KEY}`;
                const sourcesRes = await http_get(sourcesUrl);
                const sourcesData = JSON.parse(sourcesRes.body);
                sourcesList = Array.isArray(sourcesData) ? sourcesData : [];
            }

            const streams = [];
            const seenUrls = new Set();

            for (const source of sourcesList) {
                if (!source.web_url || seenUrls.has(source.web_url)) continue;
                seenUrls.add(source.web_url);

                const sourceType = SOURCE_TYPE_LABELS[source.type] || source.type;
                const quality = source.format || "HD";
                const sourceName = `${source.name} - ${sourceType}`;
                
                let streamUrl = source.web_url;
                let headers = {};

                if (streamUrl.includes("netflix.com")) {
                    headers = { "Referer": "https://www.netflix.com/" };
                } else if (streamUrl.includes("primevideo.com") || streamUrl.includes("amazon.com")) {
                    headers = { "Referer": "https://www.primevideo.com/" };
                } else if (streamUrl.includes("disneyplus.com")) {
                    headers = { "Referer": "https://www.disneyplus.com/" };
                } else if (streamUrl.includes("hulu.com")) {
                    headers = { "Referer": "https://www.hulu.com/" };
                } else if (streamUrl.includes("hbomax.com") || streamUrl.includes("max.com")) {
                    headers = { "Referer": "https://www.max.com/" };
                } else if (streamUrl.includes("peacocktv.com")) {
                    headers = { "Referer": "https://www.peacocktv.com/" };
                } else if (streamUrl.includes("paramount.com") || streamUrl.includes("paramountplus.com")) {
                    headers = { "Referer": "https://www.paramountplus.com/" };
                } else if (streamUrl.includes("crackle.com")) {
                    headers = { "Referer": "https://www.crackle.com/" };
                } else if (streamUrl.includes("tubi.tv")) {
                    headers = { "Referer": "https://tubi.tv/" };
                } else if (streamUrl.includes("pluto.tv")) {
                    headers = { "Referer": "https://pluto.tv/" };
                } else if (streamUrl.includes("freevee")) {
                    headers = { "Referer": "https://www.amazon.com/" };
                }

                streams.push(new StreamResult({
                    url: streamUrl,
                    quality: quality,
                    source: sourceName,
                    headers: headers
                }));
            }

            const typeOrder = { "sub": 0, "free": 1, "rent": 2, "buy": 3 };
            streams.sort((a, b) => {
                const aType = Object.keys(typeOrder).find(t => a.source?.includes(t)) || "buy";
                const bType = Object.keys(typeOrder).find(t => b.source?.includes(t)) || "buy";
                return (typeOrder[aType] || 99) - (typeOrder[bType] || 99);
            });

            if (streams.length === 0) {
                cb({ success: false, errorCode: "NO_STREAMS", message: "No streaming sources found" });
            } else {
                cb({ success: true, data: streams });
            }
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
