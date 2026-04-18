(function() {
    'use strict';

    // Configuration
    const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c"; // Primary API key
    const TMDB_BACKUP_KEY = "1865f43a0549ca50d341dd9ab8b29f49"; // Backup API key
    const TMDB_BASE_URL = "https://api.themoviedb.org/3";
    const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
    const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/original";
    const VIDVAULT_BASE = "https://vidvault.ru";
    
    // Mobile browser headers to bypass Cloudflare
    const MOBILE_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://vidvault.ru/',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'sec-ch-ua': '"Chromium";v="125", "Not.A/Brand";v="24"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'sec-ch-ua-platform-version': '"14"'
    };

    // Helper function for TMDB API calls
    async function fetchTMDB(endpoint, params = {}) {
        try {
            const queryParams = new URLSearchParams({
                api_key: TMDB_API_KEY,
                language: 'en-US',
                ...params
            });
            const url = `${TMDB_BASE_URL}${endpoint}?${queryParams}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`TMDB API error: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('TMDB fetch error:', error);
            return null;
        }
    }

    // Helper to create MultimediaItem from TMDB data
    function createMediaItem(tmdbItem, type = 'movie') {
        const mediaType = type === 'tv' ? 'series' : 'movie';
        const year = tmdbItem.release_date ? parseInt(tmdbItem.release_date.split('-')[0]) : 
                     (tmdbItem.first_air_date ? parseInt(tmdbItem.first_air_date.split('-')[0]) : null);
        
        return new MultimediaItem({
            title: tmdbItem.title || tmdbItem.name,
            url: `tmdb://${type}/${tmdbItem.id}`,
            posterUrl: tmdbItem.poster_path ? `${TMDB_IMAGE_BASE}${tmdbItem.poster_path}` : '',
            bannerUrl: tmdbItem.backdrop_path ? `${TMDB_BACKDROP_BASE}${tmdbItem.backdrop_path}` : '',
            type: mediaType,
            year: year,
            score: tmdbItem.vote_average || 0,
            description: tmdbItem.overview || '',
            contentRating: tmdbItem.adult ? '18+' : 'PG-13',
            syncData: { tmdb: tmdbItem.id.toString() }
        });
    }

    // 1. getHome: Returns categories for the dashboard
    async function getHome(cb) {
        try {
            const categories = {};
            
            // Fetch trending (all types) - Will appear in Hero Carousel
            const trendingData = await fetchTMDB('/trending/all/week');
            if (trendingData && trendingData.results) {
                categories["Trending Now"] = trendingData.results
                    .slice(0, 10)
                    .map(item => createMediaItem(item, item.media_type || 'movie'));
            }

            // Fetch now playing movies (Theatrical + OTT releases)
            const nowPlayingData = await fetchTMDB('/movie/now_playing', { region: 'US' });
            if (nowPlayingData && nowPlayingData.results) {
                categories["Now Playing / OTT Releases"] = nowPlayingData.results
                    .slice(0, 15)
                    .map(item => createMediaItem(item, 'movie'));
            }

            // Fetch popular movies
            const popularMoviesData = await fetchTMDB('/movie/popular');
            if (popularMoviesData && popularMoviesData.results) {
                categories["Popular Hollywood Movies"] = popularMoviesData.results
                    .slice(0, 15)
                    .map(item => createMediaItem(item, 'movie'));
            }

            // Fetch top rated movies
            const topRatedMoviesData = await fetchTMDB('/movie/top_rated');
            if (topRatedMoviesData && topRatedMoviesData.results) {
                categories["Top Rated Movies"] = topRatedMoviesData.results
                    .slice(0, 15)
                    .map(item => createMediaItem(item, 'movie'));
            }

            // Fetch popular TV series (Hollywood/Bollywood/Tollywood mix)
            const popularTVData = await fetchTMDB('/tv/popular');
            if (popularTVData && popularTVData.results) {
                categories["Popular Web Series"] = popularTVData.results
                    .slice(0, 15)
                    .map(item => createMediaItem(item, 'tv'));
            }

            // Fetch trending TV shows
            const trendingTVData = await fetchTMDB('/trending/tv/week');
            if (trendingTVData && trendingTVData.results) {
                categories["Trending Series"] = trendingTVData.results
                    .slice(0, 15)
                    .map(item => createMediaItem(item, 'tv'));
            }

            // Fetch Bollywood (Hindi) movies using Hindi language filter
            const bollywoodData = await fetchTMDB('/discover/movie', { 
                with_original_language: 'hi',
                sort_by: 'popularity.desc',
                region: 'IN'
            });
            if (bollywoodData && bollywoodData.results) {
                categories["Bollywood Movies"] = bollywoodData.results
                    .slice(0, 15)
                    .map(item => createMediaItem(item, 'movie'));
            }

            // Fetch Tollywood (Telugu) movies
            const tollywoodData = await fetchTMDB('/discover/movie', { 
                with_original_language: 'te',
                sort_by: 'popularity.desc',
                region: 'IN'
            });
            if (tollywoodData && tollywoodData.results) {
                categories["Tollywood Movies"] = tollywoodData.results
                    .slice(0, 15)
                    .map(item => createMediaItem(item, 'movie'));
            }

            // Fetch upcoming movies
            const upcomingData = await fetchTMDB('/movie/upcoming', { region: 'US' });
            if (upcomingData && upcomingData.results) {
                categories["Coming Soon"] = upcomingData.results
                    .slice(0, 10)
                    .map(item => createMediaItem(item, 'movie'));
            }

            cb({ success: true, data: categories });
        } catch (error) {
            console.error('getHome error:', error);
            cb({ success: false, error: error.message });
        }
    }

    // 2. search: Handles user queries
    async function search(query, cb) {
        try {
            if (!query || query.trim().length === 0) {
                cb({ success: true, data: [] });
                return;
            }

            const searchData = await fetchTMDB('/search/multi', { 
                query: encodeURIComponent(query.trim()),
                include_adult: false
            });

            if (searchData && searchData.results) {
                const results = searchData.results
                    .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
                    .map(item => createMediaItem(item, item.media_type));
                
                cb({ success: true, data: results });
            } else {
                cb({ success: true, data: [] });
            }
        } catch (error) {
            console.error('search error:', error);
            cb({ success: false, error: error.message });
        }
    }

    // 3. load: Fetches full details for a specific item
    async function load(url, cb) {
        try {
            // Parse URL format: tmdb://type/id or tmdb://type/id/season/episode
            const match = url.match(/tmdb:\/\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/);
            if (!match) {
                cb({ success: false, error: 'Invalid URL format' });
                return;
            }

            const [, type, id, seasonNum, episodeNum] = match;
            
            if (type === 'movie') {
                // Fetch movie details
                const movieData = await fetchTMDB(`/movie/${id}`, { append_to_response: 'credits,videos' });
                if (!movieData) {
                    cb({ success: false, error: 'Movie not found' });
                    return;
                }

                const item = createMediaItem(movieData, 'movie');
                
                // Add cast information
                if (movieData.credits && movieData.credits.cast) {
                    item.cast = movieData.credits.cast.slice(0, 10).map(actor => new Actor({
                        name: actor.name,
                        role: actor.character,
                        image: actor.profile_path ? `${TMDB_IMAGE_BASE}${actor.profile_path}` : ''
                    }));
                }

                // Add trailers
                if (movieData.videos && movieData.videos.results) {
                    const trailers = movieData.videos.results.filter(v => v.type === 'Trailer' && v.site === 'YouTube');
                    if (trailers.length > 0) {
                        item.trailers = trailers.map(t => new Trailer({
                            url: `https://youtube.com/watch?v=${t.key}`
                        }));
                    }
                }

                // Set duration
                if (movieData.runtime) {
                    item.duration = movieData.runtime;
                }

                cb({ success: true, data: item });
            } else {
                // Fetch TV series details
                const tvData = await fetchTMDB(`/tv/${id}`, { append_to_response: 'credits,videos' });
                if (!tvData) {
                    cb({ success: false, error: 'TV series not found' });
                    return;
                }

                const item = createMediaItem(tvData, 'tv');
                
                // Add cast
                if (tvData.credits && tvData.credits.cast) {
                    item.cast = tvData.credits.cast.slice(0, 10).map(actor => new Actor({
                        name: actor.name,
                        role: actor.character,
                        image: actor.profile_path ? `${TMDB_IMAGE_BASE}${actor.profile_path}` : ''
                    }));
                }

                // Add trailers
                if (tvData.videos && tvData.videos.results) {
                    const trailers = tvData.videos.results.filter(v => v.type === 'Trailer' && v.site === 'YouTube');
                    if (trailers.length > 0) {
                        item.trailers = trailers.map(t => new Trailer({
                            url: `https://youtube.com/watch?v=${t.key}`
                        }));
                    }
                }

                // Fetch episodes for the specific season or all seasons
                const seasons = [];
                if (tvData.seasons) {
                    for (const season of tvData.seasons) {
                        if (season.season_number === 0) continue; // Skip specials usually
                        
                        const seasonData = await fetchTMDB(`/tv/${id}/season/${season.season_number}`);
                        if (seasonData && seasonData.episodes) {
                            const episodes = seasonData.episodes.map(ep => new Episode({
                                name: ep.name || `S${ep.season_number}E${ep.episode_number}`,
                                url: `tmdb://tv/${id}/${ep.season_number}/${ep.episode_number}`,
                                season: ep.season_number,
                                episode: ep.episode_number,
                                rating: ep.vote_average,
                                runtime: ep.runtime,
                                airDate: ep.air_date,
                                description: ep.overview || ''
                            }));
                            seasons.push(...episodes);
                        }
                    }
                }
                
                item.seasons = seasons;
                cb({ success: true, data: item });
            }
        } catch (error) {
            console.error('load error:', error);
            cb({ success: false, error: error.message });
        }
    }

    // 4. loadStreams: Provides playable video links from vidvault.ru
    async function loadStreams(url, cb) {
        try {
            // Parse URL to extract TMDB ID and type
            const match = url.match(/tmdb:\/\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/);
            if (!match) {
                cb({ success: false, error: 'Invalid URL format' });
                return;
            }

            const [, type, tmdbId, seasonNumber, episodeNumber] = match;
            
            // Build vidvault.ru URL
            let vidvaultUrl;
            if (type === 'movie') {
                vidvaultUrl = `${VIDVAULT_BASE}/movie/${tmdbId}`;
            } else {
                if (seasonNumber && episodeNumber) {
                    vidvaultUrl = `${VIDVAULT_BASE}/tv/${tmdbId}/${seasonNumber}/${episodeNumber}`;
                } else {
                    // Default to season 1 episode 1 if not specified
                    vidvaultUrl = `${VIDVAULT_BASE}/tv/${tmdbId}/1/1`;
                }
            }

            console.log('Fetching streams from:', vidvaultUrl);

            // Attempt to fetch with mobile headers to bypass Cloudflare
            const streams = [];
            
            try {
                // Method 1: Direct fetch with mobile headers
                const response = await fetch(vidvaultUrl, {
                    method: 'GET',
                    headers: MOBILE_HEADERS,
                    redirect: 'follow'
                });

                if (response.ok) {
                    const html = await response.text();
                    const extractedStreams = extractStreamsFromHTML(html, vidvaultUrl);
                    streams.push(...extractedStreams);
                }
            } catch (e) {
                console.log('Direct fetch failed, trying alternative methods:', e.message);
            }

            // Method 2: Try with different referer and mobile simulation
            if (streams.length === 0) {
                try {
                    const altHeaders = {
                        ...MOBILE_HEADERS,
                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
                        'Referer': 'https://www.google.com/'
                    };
                    
                    const response = await fetch(vidvaultUrl, {
                        method: 'GET',
                        headers: altHeaders
                    });
                    
                    if (response.ok) {
                        const html = await response.text();
                        const extractedStreams = extractStreamsFromHTML(html, vidvaultUrl);
                        streams.push(...extractedStreams);
                    }
                } catch (e) {
                    console.log('Alternative fetch failed:', e.message);
                }
            }

            // Method 3: Construct direct CDN URLs based on known patterns
            if (streams.length === 0) {
                // Try to construct potential stream URLs based on common patterns
                const potentialStreams = constructPotentialStreams(tmdbId, type, seasonNumber, episodeNumber);
                streams.push(...potentialStreams);
            }

            if (streams.length > 0) {
                cb({ success: true, data: streams });
            } else {
                cb({ success: false, error: 'No streams found. Cloudflare protection may be active.' });
            }

        } catch (error) {
            console.error('loadStreams error:', error);
            cb({ success: false, error: error.message });
        }
    }

    // Helper function to extract streams from HTML
    function extractStreamsFromHTML(html, referer) {
        const streams = [];
        
        // Look for m3u8 links
        const m3u8Regex = /(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/gi;
        const m3u8Matches = html.match(m3u8Regex);
        if (m3u8Matches) {
            m3u8Matches.forEach(url => {
                streams.push(new StreamResult({
                    url: url,
                    quality: 'Auto',
                    headers: { 
                        'Referer': referer,
                        'User-Agent': MOBILE_HEADERS['User-Agent']
                    }
                }));
            });
        }

        // Look for MP4 links
        const mp4Regex = /(https?:\/\/[^"'\s]+\.mp4[^"'\s]*)/gi;
        const mp4Matches = html.match(mp4Regex);
        if (mp4Matches) {
            mp4Matches.forEach(url => {
                // Extract quality from URL if present
                let quality = 'Unknown';
                if (url.includes('1080')) quality = '1080p';
                else if (url.includes('720')) quality = '720p';
                else if (url.includes('480')) quality = '480p';
                else if (url.includes('360')) quality = '360p';
                
                streams.push(new StreamResult({
                    url: url,
                    quality: quality,
                    headers: { 
                        'Referer': referer,
                        'User-Agent': MOBILE_HEADERS['User-Agent']
                    }
                }));
            });
        }

        // Look for source tags
        const sourceRegex = /<source[^>]+src=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = sourceRegex.exec(html)) !== null) {
            const url = match[1];
            if (url.includes('.m3u8') || url.includes('.mp4')) {
                streams.push(new StreamResult({
                    url: url.startsWith('http') ? url : `${VIDVAULT_BASE}${url}`,
                    quality: 'Auto',
                    headers: { 
                        'Referer': referer,
                        'User-Agent': MOBILE_HEADERS['User-Agent']
                    }
                }));
            }
        }

        // Look for JSON data containing stream sources
        const jsonRegex = /sources\s*:\s*(\[[^\]]+\])/i;
        const jsonMatch = html.match(jsonRegex);
        if (jsonMatch) {
            try {
                const sources = JSON.parse(jsonMatch[1]);
                sources.forEach(source => {
                    if (source.file || source.src) {
                        streams.push(new StreamResult({
                            url: source.file || source.src,
                            quality: source.label || 'Auto',
                            headers: { 
                                'Referer': referer,
                                'User-Agent': MOBILE_HEADERS['User-Agent']
                            }
                        }));
                    }
                });
            } catch (e) {
                console.log('Failed to parse sources JSON');
            }
        }

        return streams;
    }

    // Helper to construct potential stream URLs based on common patterns
    function constructPotentialStreams(tmdbId, type, season, episode) {
        const streams = [];
        
        // Common patterns used by streaming sites
        const qualities = ['1080p', '720p', '480p', '360p'];
        
        // Pattern 1: Direct vidvault CDN patterns (hypothetical patterns based on common practices)
        // These would need to be updated based on actual vidvault.ru URL structure
        
        return streams;
    }

    // Export functions to SkyStream
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;

})();
