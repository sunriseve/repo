(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    // --- Constants ---
    const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
    const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
    const TMDB_API_BASE = "https://api.themoviedb.org/3";

    // Streaming source URLs - multiple sources for redundancy
    const STREAM_SOURCES = {
        vidsrc: {
            movie: (id) => `https://vidsrc.to/embed/movie/${id}`,
            tv: (id, season, episode) => `https://vidsrc.to/embed/tv/${id}/${season}/${episode}`,
            name: "VidSrc"
        },
        vidsrcPremium: {
            movie: (id) => `https://vidsrc.xyz/embed/movie/${id}`,
            tv: (id, season, episode) => `https://vidsrc.xyz/embed/tv/${id}/${season}/${episode}`,
            name: "VidSrc Premium"
        },
        vidplay: {
            movie: (id) => `https://vidplay.online/embed/${id}`,
            tv: (id, season, episode) => `https://vidplay.online/embed/tv/${id}/${season}/${episode}`,
            name: "VidPlay"
        },
        superstream: {
            movie: (id) => `https://player.superstream.app/movie/${id}`,
            tv: (id, season, episode) => `https://player.superstream.app/tv/${id}/${season}/${episode}`,
            name: "SuperStream"
        },
        autoembed: {
            movie: (id) => `https://autoembed.co/embed/tmdb/movie/${id}`,
            tv: (id, season, episode) => `https://autoembed.co/embed/tmdb/tv/${id}`,
            name: "AutoEmbed"
        }
    };

    const DEFAULT_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": manifest.baseUrl
    };

    // --- HTML Parser (Minimal) ---
    class HtmlParser {
        constructor(html) {
            this.html = html || "";
            this.pos = 0;
        }

        skipWhitespace() {
            while (this.pos < this.html.length && /\s/.test(this.html[this.pos])) {
                this.pos++;
            }
        }

        readTagName() {
            const start = this.pos;
            while (this.pos < this.html.length && /[a-zA-Z0-9]/.test(this.html[this.pos])) {
                this.pos++;
            }
            return this.html.substring(start, this.pos).toLowerCase();
        }

        readAttributeName() {
            const start = this.pos;
            while (this.pos < this.html.length && /[a-zA-Z0-9_-]/.test(this.html[this.pos])) {
                this.pos++;
            }
            return this.html.substring(start, this.pos);
        }

        readAttributeValue() {
            this.skipWhitespace();
            if (this.pos >= this.html.length) return "";
            const ch = this.html[this.pos];
            if (ch === '"' || ch === "'") {
                this.pos++;
                const start = this.pos;
                while (this.pos < this.html.length && this.html[this.pos] !== ch) {
                    this.pos++;
                }
                const val = this.html.substring(start, this.pos);
                this.pos++; // skip closing quote
                return val;
            }
            const start = this.pos;
            while (this.pos < this.html.length && /[^"'=\s]/.test(this.html[this.pos])) {
                this.pos++;
            }
            return this.html.substring(start, this.pos);
        }

        parseTag() {
            this.skipWhitespace();
            if (this.pos >= this.html.length || this.html[this.pos] !== '<') {
                return { type: 'text', content: '' };
            }
            this.pos++; // skip '<'

            if (this.html[this.pos] === '/') {
                this.pos++;
                const tagName = this.readTagName();
                this.skipWhitespace();
                if (this.html[this.pos] === '>') this.pos++;
                return { type: 'close', tagName };
            }

            if (this.html[this.pos] === '!') {
                this.pos++;
                if (this.html.substring(this.pos, this.pos + 2) === '--') {
                    // HTML comment
                    this.pos += 2;
                    const end = this.html.indexOf('-->', this.pos);
                    if (end !== -1) {
                        this.pos = end + 3;
                    }
                }
                return { type: 'comment' };
            }

            const tagName = this.readTagName();
            const attrs = {};

            while (this.pos < this.html.length && this.html[this.pos] !== '>') {
                this.skipWhitespace();
                if (this.pos >= this.html.length || this.html[this.pos] === '>') break;

                const attrName = this.readAttributeName();
                if (!attrName) break;

                let attrValue = "";
                this.skipWhitespace();
                if (this.pos < this.html.length && this.html[this.pos] === '=') {
                    this.pos++;
                    attrValue = this.readAttributeValue();
                }
                attrs[attrName] = attrValue;
            }

            if (this.pos < this.html.length && this.html[this.pos] === '>') {
                this.pos++;
            }

            const selfClosing = ['br', 'hr', 'img', 'input', 'meta', 'link'].includes(tagName);

            return { type: 'open', tagName, attrs, selfClosing };
        }

        parseText() {
            const start = this.pos;
            while (this.pos < this.html.length && this.html[this.pos] !== '<') {
                this.pos++;
            }
            return this.html.substring(start, this.pos).trim();
        }

        extractLinks(pattern) {
            const results = [];
            const regex = new RegExp(pattern, 'gi');
            let match;
            while ((match = regex.exec(this.html)) !== null) {
                results.push(match[1] || match[0]);
            }
            return results;
        }
    }

    // --- Helper Functions ---
    function fixUrl(url) {
        if (!url) return "";
        if (url.startsWith("//")) return "https:" + url;
        if (url.startsWith("/")) return manifest.baseUrl + url;
        return url;
    }

    function extractTmdbId(url) {
        if (!url) return null;
        const match = url.match(/\/details\/(?:movie|tv)\/(\d+)/);
        return match ? match[1] : null;
    }

    function extractType(url) {
        if (!url) return "movie";
        if (url.includes("/tv/") || url.includes("/details/tv/")) return "tv";
        return "movie";
    }

    async function fetchPage(url, headers) {
        try {
            const res = await http_get(fixUrl(url), headers || DEFAULT_HEADERS);
            if (res.status !== 200) {
                throw new Error(`HTTP ${res.status}`);
            }
            return res.body || "";
        } catch (e) {
            console.error("Fetch error:", e.message);
            return "";
        }
    }

    async function tmdbRequest(endpoint) {
        try {
            const url = `${TMDB_API_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${TMDB_API_KEY}`;
            const res = await http_get(url, { "User-Agent": DEFAULT_HEADERS["User-Agent"] });
            if (res.status === 200) {
                return JSON.parse(res.body);
            }
        } catch (e) {
            console.error("TMDB API error:", e.message);
        }
        return null;
    }

    // --- Content Parsing ---
    function parseCard(cardHtml) {
        try {
            const parser = new HtmlParser(cardHtml);

            // Extract image
            let posterUrl = "";
            const imgMatch = cardHtml.match(/src="([^"]*(?:w500|w300)[^"]*)"/);
            if (imgMatch) {
                posterUrl = imgMatch[1];
            } else {
                const imgMatch2 = cardHtml.match(/src="(https:\/\/image\.tmdb\.org[^"]+)"/);
                if (imgMatch2) posterUrl = imgMatch2[1];
            }

            // Extract title
            let title = "";
            const titleMatch = cardHtml.match(/<h3[^>]*>([^<]+)<\/h3>/);
            if (titleMatch) {
                title = titleMatch[1].trim();
            } else {
                const aMatch = cardHtml.match(/<a[^>]*>([^<]+)<\/a>/);
                if (aMatch) title = aMatch[1].trim();
            }

            // Extract URL
            let url = "";
            const urlMatch = cardHtml.match(/href="([^"]+(?:\/details\/movie|\/details\/tv)[^"]*)"/);
            if (urlMatch) url = urlMatch[1];

            // Extract year and type
            let year = null;
            let type = "movie";
            const metaMatch = cardHtml.match(/(\d{4})\s*[•·]\s*(movie|tv)/i);
            if (metaMatch) {
                year = parseInt(metaMatch[1]);
                type = metaMatch[2].toLowerCase();
            }

            // Extract rating
            let rating = null;
            const ratingMatch = cardHtml.match(/(\d+\.?\d*)\s*(?:<\/div>|<\/span>|\s*<)/);
            if (ratingMatch) {
                rating = parseFloat(ratingMatch[1]);
            }

            if (!title || !url) return null;

            return new MultimediaItem({
                title: title,
                url: url,
                posterUrl: posterUrl,
                type: type,
                year: year,
                score: rating
            });
        } catch (e) {
            return null;
        }
    }

    function parseCards(html) {
        const items = [];
        // Match card patterns
        const cardRegex = /<a\s+[^>]*href=["']([^"']*(?:\/details\/movie|\/details\/tv)[^"']*)["'][^>]*>[\s\S]*?<\/a>/g;
        let match;

        // Also try to extract individual cards
        const cards = html.split(/<a\s+[^>]*href=["']([^"']*(?:\/details\/movie|\/details\/tv)[^"']*)["']/);
        if (cards.length > 1) {
            for (let i = 1; i < cards.length; i += 2) {
                const href = cards[i];
                const cardContent = cards[i] + cards[i + 1];
                const card = parseCard(`<a href="${href}">${cardContent}</a>`);
                if (card) items.push(card);
            }
        }

        return items;
    }

    // --- Core Functions ---

    async function getHome(cb) {
        try {
            const homeData = {};

            // Fetch movies page
            const moviesHtml = await fetchPage("/movies", DEFAULT_HEADERS);
            const movies = parseCards(moviesHtml);
            if (movies.length > 0) {
                homeData["Movies"] = movies.slice(0, 20);
            }

            // Fetch TV shows page
            const tvHtml = await fetchPage("/tv", DEFAULT_HEADERS);
            const tvShows = parseCards(tvHtml);
            if (tvShows.length > 0) {
                homeData["TV Shows"] = tvShows.slice(0, 20);
            }

            // Add Trending category for hero carousel
            const trendingData = await tmdbRequest("/trending/all/week?page=1");
            if (trendingData && trendingData.results) {
                const trending = trendingData.results.slice(0, 10).map(item => {
                    const posterPath = item.poster_path ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` : "";
                    return new MultimediaItem({
                        title: item.title || item.name || "Unknown",
                        url: `/details/${item.media_type}/${item.id}`,
                        posterUrl: posterPath,
                        type: item.media_type === "tv" ? "tv" : "movie",
                        year: parseInt((item.release_date || item.first_air_date || "0000").substring(0, 4)),
                        score: item.vote_average ? item.vote_average / 2 : null // Convert to 10 scale
                    });
                });
                if (trending.length > 0) {
                    homeData["Trending"] = trending;
                }
            }

            // Popular Movies
            const popularMovies = await tmdbRequest("/movie/popular?page=1");
            if (popularMovies && popularMovies.results) {
                const popular = popularMovies.results.slice(0, 10).map(item => {
                    const posterPath = item.poster_path ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` : "";
                    return new MultimediaItem({
                        title: item.title || "Unknown",
                        url: `/details/movie/${item.id}`,
                        posterUrl: posterPath,
                        type: "movie",
                        year: parseInt((item.release_date || "0000").substring(0, 4)),
                        score: item.vote_average ? item.vote_average / 2 : null
                    });
                });
                if (popular.length > 0) {
                    homeData["Popular Movies"] = popular;
                }
            }

            // Popular TV Shows
            const popularTv = await tmdbRequest("/tv/popular?page=1");
            if (popularTv && popularTv.results) {
                const popular = popularTv.results.slice(0, 10).map(item => {
                    const posterPath = item.poster_path ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` : "";
                    return new MultimediaItem({
                        title: item.name || "Unknown",
                        url: `/details/tv/${item.id}`,
                        posterUrl: posterPath,
                        type: "tv",
                        year: parseInt((item.first_air_date || "0000").substring(0, 4)),
                        score: item.vote_average ? item.vote_average / 2 : null
                    });
                });
                if (popular.length > 0) {
                    homeData["Popular TV Shows"] = popular;
                }
            }

            if (Object.keys(homeData).length === 0) {
                return cb({ success: false, errorCode: "PARSE_ERROR", message: "No content found on home page" });
            }

            cb({ success: true, data: homeData });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    async function search(query, cb) {
        try {
            // Search using TMDB API
            const results = [];

            // Search movies
            const movieData = await tmdbRequest(`/search/movie?query=${encodeURIComponent(query)}&page=1`);
            if (movieData && movieData.results) {
                for (const item of movieData.results) {
                    const posterPath = item.poster_path ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` : "";
                    results.push(new MultimediaItem({
                        title: item.title || "Unknown",
                        url: `/details/movie/${item.id}`,
                        posterUrl: posterPath,
                        type: "movie",
                        year: parseInt((item.release_date || "0000").substring(0, 4)),
                        description: item.overview || "",
                        score: item.vote_average ? item.vote_average / 2 : null
                    }));
                }
            }

            // Search TV shows
            const tvData = await tmdbRequest(`/search/tv?query=${encodeURIComponent(query)}&page=1`);
            if (tvData && tvData.results) {
                for (const item of tvData.results) {
                    const posterPath = item.poster_path ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` : "";
                    results.push(new MultimediaItem({
                        title: item.name || "Unknown",
                        url: `/details/tv/${item.id}`,
                        posterUrl: posterPath,
                        type: "tv",
                        year: parseInt((item.first_air_date || "0000").substring(0, 4)),
                        description: item.overview || "",
                        score: item.vote_average ? item.vote_average / 2 : null
                    }));
                }
            }

            cb({ success: true, data: results.slice(0, 50) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    async function load(url, cb) {
        try {
            const type = extractType(url);
            const tmdbId = extractTmdbId(url);

            if (!tmdbId) {
                return cb({ success: false, errorCode: "NOT_FOUND", message: "Invalid URL - no TMDB ID found" });
            }

            const isMovie = type === "movie";
            let data;

            if (isMovie) {
                data = await tmdbRequest(`/movie/${tmdbId}?append_to_response=credits,videos`);
            } else {
                data = await tmdbRequest(`/tv/${tmdbId}?append_to_response=credits,videos, seasons`);
            }

            if (!data || !data.id) {
                return cb({ success: false, errorCode: "NOT_FOUND", message: "Content not found in TMDB" });
            }

            const posterUrl = data.poster_path ? `${TMDB_IMAGE_BASE}/w500${data.poster_path}` : "";
            const bannerUrl = data.backdrop_path ? `${TMDB_IMAGE_BASE}/original${data.backdrop_path}` : "";
            const logoUrl = data.images?.logos?.length > 0
                ? `${TMDB_IMAGE_BASE}/w500${data.images.logos[0].file_path}`
                : "";

            const genres = (data.genres || []).map(g => g.name);
            const tags = (data.tagline || "").split(/[,|]/).map(t => t.trim()).filter(Boolean);

            const cast = (data.credits?.cast || []).slice(0, 10).map(c => new Actor({
                name: c.name || "Unknown",
                role: c.character || "",
                image: c.profile_path ? `${TMDB_IMAGE_BASE}/w300${c.profile_path}` : ""
            }));

            const trailers = (data.videos?.results || [])
                .filter(v => v.site === "YouTube" && v.type === "Trailer")
                .slice(0, 3)
                .map(v => new Trailer({
                    name: v.name || "Trailer",
                    url: `https://www.youtube.com/watch?v=${v.key}`
                }));

            const episodes = [];

            if (!isMovie) {
                // Load seasons for TV shows
                const seasons = data.seasons || [];

                for (const season of seasons) {
                    if (season.season_number === 0) continue; // Skip specials

                    // Get season details
                    const seasonData = await tmdbRequest(`/tv/${tmdbId}/season/${season.season_number}`);

                    if (seasonData && seasonData.episodes) {
                        for (const ep of seasonData.episodes) {
                            const stillPath = ep.still_path ? `${TMDB_IMAGE_BASE}/w500${ep.still_path}` : posterUrl;
                            episodes.push(new Episode({
                                name: ep.name || `Episode ${ep.episode_number}`,
                                url: `${tmdbId}|${type}|${season.season_number}|${ep.episode_number}`,
                                season: season.season_number,
                                episode: ep.episode_number,
                                description: ep.overview || "",
                                posterUrl: stillPath,
                                runtime: ep.runtime || seasonData.runtime || null,
                                airDate: ep.air_date || null
                            }));
                        }
                    }
                }
            } else {
                // For movies, create a single "episode"
                episodes.push(new Episode({
                    name: "Full Movie",
                    url: `${tmdbId}|${type}|1|1`,
                    season: 1,
                    episode: 1,
                    posterUrl: posterUrl
                }));
            }

            const result = new MultimediaItem({
                title: isMovie ? data.title : data.name,
                url: url,
                posterUrl: posterUrl,
                bannerUrl: bannerUrl,
                logoUrl: logoUrl,
                type: type,
                description: data.overview || "",
                year: parseInt((isMovie ? data.release_date : data.first_air_date || "0000").substring(0, 4)),
                score: data.vote_average ? data.vote_average / 2 : null,
                status: data.status || "",
                genres: genres,
                tags: tags,
                duration: data.runtime || null,
                cast: cast,
                trailers: trailers,
                episodes: episodes
            });

            cb({ success: true, data: result });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const parts = url.split("|");
            const tmdbId = parts[0];
            const type = parts[1] || "movie";
            const season = parseInt(parts[2]) || 1;
            const episode = parseInt(parts[3]) || 1;

            if (!tmdbId) {
                return cb({ success: false, errorCode: "NOT_FOUND", message: "Invalid stream URL" });
            }

            const isMovie = type === "movie";
            const streamResults = [];

            // Add streams from multiple sources
            for (const [sourceKey, source] of Object.entries(STREAM_SOURCES)) {
                try {
                    let streamUrl;

                    if (isMovie) {
                        streamUrl = source.movie(tmdbId);
                    } else {
                        streamUrl = source.tv(tmdbId, season, episode);
                    }

                    streamResults.push(new StreamResult({
                        url: streamUrl,
                        source: source.name,
                        quality: "HD",
                        headers: {
                            "User-Agent": DEFAULT_HEADERS["User-Agent"],
                            "Referer": manifest.baseUrl
                        }
                    }));

                    // Also add lower quality option
                    if (sourceKey === "vidsrc") {
                        streamResults.push(new StreamResult({
                            url: streamUrl.replace("vidsrc.to", "vidsrc.cc"),
                            source: `${source.name} (Alt)`,
                            quality: "SD",
                            headers: {
                                "User-Agent": DEFAULT_HEADERS["User-Agent"],
                                "Referer": manifest.baseUrl
                            }
                        }));
                    }
                } catch (e) {
                    // Skip this source if it fails
                    console.log(`Source ${sourceKey} failed:`, e.message);
                }
            }

            // Add VidSrc Pro sources with different patterns
            streamResults.push(new StreamResult({
                url: `https://vidsrc.pro/embed/${isMovie ? 'movie' : 'tv'}/${tmdbId}`,
                source: "VidSrc Pro",
                quality: "HD",
                headers: {
                    "User-Agent": DEFAULT_HEADERS["User-Agent"],
                    "Referer": "https://vidsrc.pro"
                }
            }));

            if (!isMovie) {
                streamResults.push(new StreamResult({
                    url: `https://vidsrc.pro/embed/tv/${tmdbId}/${season}/${episode}`,
                    source: "VidSrc Pro (Episode)",
                    quality: "HD",
                    headers: {
                        "User-Agent": DEFAULT_HEADERS["User-Agent"],
                        "Referer": "https://vidsrc.pro"
                    }
                }));
            }

            // Add MultiEmbed source
            streamResults.push(new StreamResult({
                url: `https://multiembed.mov/?video_id=${tmdbId}&season=${isMovie ? '' : season}&episode=${isMovie ? '' : episode}`,
                source: "MultiEmbed",
                quality: "HD",
                headers: {
                    "User-Agent": DEFAULT_HEADERS["User-Agent"],
                    "Referer": "https://multiembed.mov"
                }
            }));

            if (streamResults.length === 0) {
                return cb({ success: false, errorCode: "STREAM_ERROR", message: "No streaming sources found" });
            }

            cb({ success: true, data: streamResults });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    // --- Exports ---
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
